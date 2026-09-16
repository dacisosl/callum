import type { Metadata } from "next";
import { BoardApp } from "./board-app";
import { boardSummary, loadSharedBoardOnServer, siteOrigin } from "@/lib/shared-board-server";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// 공유 주소(?share=토큰)로 들어오면 보드 제목과 미리보기 이미지를 링크 미리보기(카카오톡 등)에 실어 보냅니다.
export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const params = await searchParams;
  const token = typeof params.share === "string" ? params.share : "";
  if (!token) return {};
  const board = await loadSharedBoardOnServer(token);
  const origin = siteOrigin();
  if (!board) {
    return {
      title: "공유 보드 · Pillar",
      description: "링크가 만료되었거나 공유가 해제된 보드입니다.",
      openGraph: { title: "공유 보드 · Pillar", description: "링크가 만료되었거나 공유가 해제된 보드입니다.", type: "website", locale: "ko_KR", url: `${origin}/?share=${token}` },
    };
  }
  const { cardCount, columnCount, columnTitles } = boardSummary(board);
  const description = `칼럼 ${columnCount}개 · 카드 ${cardCount}개 · ${columnTitles.slice(0, 4).join(", ")}${columnTitles.length > 4 ? " 외" : ""}`;
  const image = `${origin}/api/og?share=${encodeURIComponent(token)}`;
  return {
    title: `${board.title} · Pillar`,
    description,
    openGraph: {
      title: board.title,
      description,
      type: "website",
      locale: "ko_KR",
      siteName: "Pillar",
      url: `${origin}/?share=${token}`,
      images: [{ url: image, width: 1200, height: 630, alt: `${board.title} 보드 미리보기` }],
    },
    twitter: { card: "summary_large_image", title: board.title, description, images: [image] },
  };
}

export default function Home() {
  return <BoardApp />;
}
