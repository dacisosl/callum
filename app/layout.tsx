import type { Metadata } from "next";
import "./styles.css";
import { siteOrigin } from "@/lib/shared-board-server";

export const metadata: Metadata = {
  // og:image 같은 상대 주소를 절대 주소로 바꿀 때 쓰는 기준. Vercel 고정 도메인을 우선 씁니다.
  metadataBase: new URL(siteOrigin()),
  title: "Pillar — 칼럼형 자료 보드",
  description: "링크, 이미지, PDF를 칼럼으로 가볍게 정리하는 개인 보드",
  openGraph: { type: "website", locale: "ko_KR", siteName: "Pillar", title: "Pillar — 칼럼형 자료 보드", description: "링크, 이미지, PDF를 칼럼으로 가볍게 정리하는 개인 보드", images: [{ url: "/api/og", width: 1200, height: 630 }] },
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
      <body className="antialiased">{children}</body>
    </html>
  );
}
