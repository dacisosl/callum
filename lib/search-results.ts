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
