import { NextRequest, NextResponse } from "next/server";
import { isSearchKind, MAX_QUERY_LENGTH, normalizeNaverItems, type SearchResult } from "@/lib/search-results";

// 편집창의 링크 검색. 네이버 검색 API 를 서버에서 대신 불러 결과를 돌려줍니다.
// 키(NAVER_CLIENT_ID, NAVER_CLIENT_SECRET)는 이 경로에서만 읽고 브라우저로는 절대 내보내지 않습니다.
// 공유 링크의 손님도 쓰므로 접속 주소별 횟수 제한과 결과 기억으로 무료 할당량을 아낍니다.

export const dynamic = "force-dynamic";

const PER_MINUTE = 20;
const CACHE_MS = 10 * 60 * 1000;
const MAX_CACHE = 500;

// 서버 인스턴스 메모리라 인스턴스가 여럿이면 느슨해지지만, 네이버 하루 한도에 비하면 충분한 방어입니다.
const hits = new Map<string, number[]>();
const cache = new Map<string, { at: number; results: SearchResult[] }>();

function clientKey(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "unknown";
}

function allow(key: string, now: number) {
  const recent = (hits.get(key) ?? []).filter((time) => now - time < 60_000);
  if (recent.length >= PER_MINUTE) { hits.set(key, recent); return false; }
  recent.push(now);
  hits.set(key, recent);
  // 오래 쓰지 않은 접속 기록이 쌓이지 않게 가끔 비웁니다.
  if (hits.size > 5000) for (const [entry, times] of hits) if (!times.some((time) => now - time < 60_000)) hits.delete(entry);
  return true;
}

function fail(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status, headers: { "cache-control": "no-store" } });
}

export async function GET(request: NextRequest) {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  if (!clientId || !clientSecret) return fail(503, "setup", "검색 키가 아직 설정되지 않았습니다.");

  const query = (request.nextUrl.searchParams.get("q") ?? "").replace(/\s+/g, " ").trim();
  const kindParam = request.nextUrl.searchParams.get("kind") ?? "webkr";
  if (!query) return fail(400, "query", "검색어를 입력해 주세요.");
  if (query.length > MAX_QUERY_LENGTH) return fail(400, "query", `검색어는 ${MAX_QUERY_LENGTH}자까지입니다.`);
  if (!isSearchKind(kindParam)) return fail(400, "kind", "검색 종류가 올바르지 않습니다.");
  const kind = kindParam;

  const now = Date.now();
  const cacheKey = `${kind}\u0000${query.toLowerCase()}`;
  const cached = cache.get(cacheKey);
  if (cached && now - cached.at < CACHE_MS) return NextResponse.json({ kind, query, results: cached.results });

  if (!allow(clientKey(request), now)) return fail(429, "rate", "검색을 너무 자주 했습니다. 잠시 뒤 다시 검색해 주세요.");

  // 시험할 때만 가짜 서버로 바꿀 수 있습니다. 평소에는 네이버 주소입니다.
  const base = (process.env.NAVER_SEARCH_BASE || "https://openapi.naver.com").replace(/\/$/, "");
  const target = `${base}/v1/search/${kind}.json?query=${encodeURIComponent(query)}&display=10`;
  let response: Response;
  try {
    response = await fetch(target, {
      headers: { "X-Naver-Client-Id": clientId, "X-Naver-Client-Secret": clientSecret },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
  } catch {
    return fail(502, "upstream", "검색 서비스에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
  }

  if (response.status === 401 || response.status === 403) return fail(502, "key", "검색 키가 올바르지 않습니다. 보드 주인에게 알려 주세요.");
  if (response.status === 429) return fail(429, "quota", "오늘 검색 한도를 넘었습니다. 내일 다시 쓸 수 있습니다.");
  if (!response.ok) return fail(502, "upstream", "검색 서비스가 응답하지 않습니다. 잠시 뒤 다시 시도해 주세요.");

  let body: unknown;
  try { body = await response.json(); } catch { return fail(502, "upstream", "검색 결과를 읽지 못했습니다."); }
  const results = normalizeNaverItems(kind, (body as { items?: unknown })?.items);

  cache.set(cacheKey, { at: now, results });
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value as string);
  return NextResponse.json({ kind, query, results });
}
