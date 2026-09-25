// 네이버 검색 API 응답을 앱이 쓰는 모양으로 바꿉니다. 네트워크와 무관한 순수 함수라 따로 시험합니다.
// 실제 호출은 app/api/link-search/route.ts 가 맡습니다.

export type SearchKind = "webkr" | "blog" | "news";

export const SEARCH_KINDS: { value: SearchKind; label: string }[] = [
  { value: "webkr", label: "웹" },
  { value: "blog", label: "블로그" },
  { value: "news", label: "뉴스" },
];

export interface SearchResult {
  title: string;
  url: string;
  description: string;
  siteName: string;
  // 블로그·뉴스의 날짜. "2026. 9. 25." 처럼 읽기 좋은 모양입니다.
  date?: string;
}

export const MAX_QUERY_LENGTH = 100;

export function isSearchKind(value: unknown): value is SearchKind {
  return value === "webkr" || value === "blog" || value === "news";
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

// 네이버는 검색어와 맞는 부분을 <b> 로 감싸 보내고, 따옴표 등을 HTML 엔티티로 보냅니다.
export function cleanText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
      if (code[0] === "#") {
        const point = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(point) && point > 0 && point < 0x110000 ? String.fromCodePoint(point) : whole;
      }
      return ENTITIES[code.toLowerCase()] ?? whole;
    })
    .replace(/\s+/g, " ")
    .trim();
}

function httpUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function hostOf(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

// 블로그 postdate 는 "20260925", 뉴스 pubDate 는 "Thu, 25 Sep 2026 09:00:00 +0900" 모양입니다.
function readableDate(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const compact = value.trim().match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return `${compact[1]}. ${Number(compact[2])}. ${Number(compact[3])}.`;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return undefined;
  const date = new Date(parsed);
  return `${date.getFullYear()}. ${date.getMonth() + 1}. ${date.getDate()}.`;
}

export function normalizeNaverItems(kind: SearchKind, items: unknown): SearchResult[] {
  if (!Array.isArray(items)) return [];
  const seen = new Set<string>();
  const results: SearchResult[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    // 뉴스는 네이버 뉴스 주소보다 언론사 원문 주소가 카드 링크로 더 알맞습니다.
    const url = kind === "news" ? httpUrl(item.originallink) || httpUrl(item.link) : httpUrl(item.link);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const host = hostOf(url);
    results.push({
      title: cleanText(item.title) || host,
      url,
      description: cleanText(item.description),
      siteName: kind === "blog" ? cleanText(item.bloggername) || host : host,
      date: kind === "blog" ? readableDate(item.postdate) : kind === "news" ? readableDate(item.pubDate) : undefined,
    });
  }
  return results;
}

// 링크 칸에 들어온 글이 주소가 아니라 검색어인지. 주소라면 첫 단어에 점이 있거나(`padlet.com`,
// `편함.com`) `://` 가 들어 있습니다. 그렇지 않은 글("생성형 AI 수업", "패들렛")은 검색어로 봅니다.
export function looksLikeQuery(value: string): boolean {
  const text = value.trim();
  if (!text || text.includes("://")) return false;
  const first = text.split(/\s+/)[0] ?? "";
  if (first.includes(".")) return false;
  if (/^localhost(:\d+)?(\/|$)/i.test(first)) return false;
  return true;
}

// 네이버가 키를 거절(401·403)했을 때 돌려주는 errorMessage 를 보고, 보드 주인이 고칠 곳을 한 줄로 알려 줍니다.
// errorMessage 에는 키 값이 들어 있지 않아 그대로 보여 줘도 됩니다.
export function naverKeyHint(status: number, errorMessage: unknown): string {
  const text = typeof errorMessage === "string" ? errorMessage : "";
  if (/scope status invalid/i.test(text)) return "네이버 애플리케이션에 '검색' API 가 추가되어 있지 않습니다. 네이버 개발자센터 → 내 애플리케이션 → API 설정에서 '검색' 을 추가해 주세요.";
  if (/not exist client id/i.test(text)) return "Client ID 가 틀렸습니다. Vercel 의 NAVER_CLIENT_ID 값을 네이버 개발자센터의 Client ID 로 다시 넣고 Redeploy 해 주세요.";
  if (/client secret/i.test(text)) return "Client Secret 이 틀렸습니다. Vercel 의 NAVER_CLIENT_SECRET 값을 다시 넣고 Redeploy 해 주세요.";
  if (status === 403) return "네이버가 이 키의 검색 사용을 막았습니다. 네이버 개발자센터 → 내 애플리케이션에서 '검색' API 와 서비스 상태를 확인해 주세요.";
  return "네이버가 키를 받아 주지 않았습니다. Client ID 와 Client Secret 이 서로 바뀌지 않았는지, 끝까지 복사했는지 확인하고 Redeploy 해 주세요.";
}

// 새 창에서 여는 일반 인터넷 검색. 키가 필요 없어 네이버 검색 API 가 막혀 있어도 늘 됩니다.
export type WebSearchEngine = "google" | "naver";

export const WEB_SEARCH_ENGINES: { value: WebSearchEngine; label: string }[] = [
  { value: "google", label: "구글" },
  { value: "naver", label: "네이버" },
];

export function webSearchUrl(engine: WebSearchEngine, query: string): string {
  const text = encodeURIComponent(query.replace(/\s+/g, " ").trim());
  return engine === "google" ? `https://www.google.com/search?q=${text}` : `https://search.naver.com/search.naver?query=${text}`;
}

// 복사해 온 글에서 첫 주소를 꺼냅니다. 휴대폰 앱의 "공유 → 복사" 는 "제목 https://…" 처럼 제목이 앞에 붙기도 합니다.
export function extractUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s<>"'`]+/i);
  if (!match) return null;
  const url = match[0].replace(/[),.;!?\]}>」』”’]+$/u, "");
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}
