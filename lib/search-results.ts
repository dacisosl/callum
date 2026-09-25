// 편집창 링크 검색에 쓰는 순수 함수. 검색은 구글을 새 창으로 열고, 찾은 주소를 복사해 와서 붙입니다.
// 구글 화면은 다른 사이트 안에 넣어 보여 줄 수 없게 막혀 있어 새 창으로 엽니다.

export const MAX_QUERY_LENGTH = 100;

export function webSearchUrl(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(query.replace(/\s+/g, " ").trim())}`;
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
