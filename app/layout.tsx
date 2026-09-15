import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "Pillar — 칼럼형 자료 보드",
  description: "링크, 이미지, PDF를 칼럼으로 가볍게 정리하는 개인 보드",
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
