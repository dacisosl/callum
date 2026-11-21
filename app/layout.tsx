import type { Metadata } from "next";
import "./styles.css";
import { siteOrigin } from "@/lib/shared-board-server";

export const metadata: Metadata = {
  // og:image 같은 상대 주소를 절대 주소로 바꿀 때 쓰는 기준. Vercel 고정 도메인을 우선 씁니다.
  metadataBase: new URL(siteOrigin()),
  title: "Padlet-Lite — 칼럼형 자료 보드",
  description: "링크, 이미지, PDF를 칼럼으로 가볍게 정리하는 개인 보드",
  openGraph: { type: "website", locale: "ko_KR", siteName: "Padlet-Lite", title: "Padlet-Lite — 칼럼형 자료 보드", description: "링크, 이미지, PDF를 칼럼으로 가볍게 정리하는 개인 보드", images: [{ url: "/api/og", width: 1200, height: 630 }] },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <head>
        {/* 한글 본문 글꼴. 받지 못하면 시스템 글꼴(맑은 고딕·애플 SD 고딕)로 그립니다. */}
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="anonymous" />
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css" />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
