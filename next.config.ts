import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 상위 폴더의 관계없는 package-lock.json을 빌드 루트로 잡지 않도록 고정합니다.
  turbopack: {
    root: import.meta.dirname,
  },
};

export default nextConfig;
