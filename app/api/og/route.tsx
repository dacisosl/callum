import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";
import { boardSummary, loadSharedBoardOnServer } from "@/lib/shared-board-server";

// 공유 링크의 미리보기 이미지(1200×630). 카카오톡·슬랙 등이 og:image 로 가져갑니다.
// 한글을 그리려면 글꼴이 필요해 Google Fonts 에서 제목에 쓰인 글자만 부분 집합으로 받아 옵니다.

const FALLBACK_TITLE = "Padlet-Lite 보드";

async function loadKoreanFont(text: string): Promise<ArrayBuffer | null> {
  try {
    const unique = Array.from(new Set(text.split(""))).join("");
    const css = await fetch(
      `https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@700&text=${encodeURIComponent(unique)}`,
      // 이 옛 브라우저 UA 로 요청하면 satori 가 읽을 수 있는 TTF 주소를 돌려줍니다.
      { headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/46.0.2490.86 Safari/537.36" }, signal: AbortSignal.timeout(6000) },
    ).then((response) => (response.ok ? response.text() : ""));
    const url = css.match(/src:\s*url\(([^)]+)\)\s*format\(['"](?:truetype|opentype)['"]\)/)?.[1];
    if (!url) return null;
    const font = await fetch(url, { signal: AbortSignal.timeout(6000) });
    return font.ok ? font.arrayBuffer() : null;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("share")?.trim() ?? "";
  const board = token ? await loadSharedBoardOnServer(token) : null;
  // 로컬 데모에서 모양을 볼 때만 제목을 직접 넣을 수 있습니다.
  const demoTitle = process.env.NEXT_PUBLIC_DEMO_MODE === "1" ? request.nextUrl.searchParams.get("title") : null;

  const title = board?.title || demoTitle || FALLBACK_TITLE;
  const summary = board ? boardSummary(board) : null;
  const chips = summary ? summary.columnTitles.slice(0, 5) : demoTitle ? ["수집함", "정리 중", "완료"] : [];
  const meta = summary
    ? `칼럼 ${summary.columnCount}개 · 카드 ${summary.cardCount}개`
    : board === null && token
      ? "링크가 만료되었거나 공유가 해제된 보드입니다"
      : "링크, 이미지, PDF를 칼럼으로 정리하는 보드";
  const footer = board ? "공유 보드 · 링크를 가진 사람은 읽을 수 있습니다" : "Padlet-Lite";

  const fontData = await loadKoreanFont(`${title}${meta}${footer}${chips.join("")}Padlet-Lite공유 보드`);
  const fonts = fontData ? [{ name: "NotoSansKR", data: fontData, weight: 700 as const, style: "normal" as const }] : undefined;

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", padding: 56, background: "linear-gradient(160deg, #f9e2e9 0%, #ede6f7 42%, #dbe8f8 100%)", fontFamily: fonts ? "NotoSansKR" : "sans-serif" }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "52px 60px", borderRadius: 36, background: "white", boxShadow: "0 30px 80px rgba(24,34,42,.14)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <div style={{ width: 64, height: 64, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 20, background: "#155eef", color: "white", fontSize: 34, fontWeight: 700 }}>P</div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: 22, color: "#66727c", fontWeight: 700 }}>{board ? "공유 보드" : "Padlet-Lite"}</div>
              <div style={{ fontSize: 26, color: "#172027", fontWeight: 700 }}>Padlet-Lite</div>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
            <div style={{ fontSize: title.length > 18 ? 58 : 72, lineHeight: 1.15, color: "#172027", fontWeight: 700, letterSpacing: -1.5, display: "-webkit-box", overflow: "hidden", maxHeight: 180 }}>{title}</div>
            <div style={{ fontSize: 28, color: "#5e6b75", fontWeight: 700 }}>{meta}</div>
            {chips.length > 0 && (
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {chips.map((chip, index) => (
                  <div key={`${chip}-${index}`} style={{ padding: "10px 20px", borderRadius: 999, background: index % 2 ? "#eef2f5" : "#e9f0ff", color: index % 2 ? "#4b5964" : "#0d47b5", fontSize: 24, fontWeight: 700 }}>{chip}</div>
                ))}
              </div>
            )}
          </div>
          <div style={{ fontSize: 22, color: "#8a969e", fontWeight: 700 }}>{footer}</div>
        </div>
      </div>
    ),
    { width: 1200, height: 630, fonts, headers: { "cache-control": "public, max-age=600, s-maxage=86400, stale-while-revalidate=604800" } },
  );
}
