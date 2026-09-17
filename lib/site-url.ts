// 앱의 고정 주소. 공유 링크, 링크 미리보기(og:url, og:image) 는 항상 이 주소를 기준으로 만듭니다.
// Vercel 이 배포마다 만드는 `callum-xxxxxxxx-....vercel.app` 같은 배포 전용 주소는 절대 쓰지 않습니다.

// Vercel 프로젝트의 프로덕션 도메인. 나만의 도메인을 연결했다면 NEXT_PUBLIC_SITE_URL 로 바꿔 넣으세요.
export const DEFAULT_SITE_URL = "https://callum-eight.vercel.app";

function fromEnv(): string | null {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  // Vercel 이 빌드 시 넣어 주는 프로덕션 도메인(연결한 도메인이 있으면 그 도메인).
  const vercel = process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
  return null;
}

function isLocalHost(host: string) {
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost");
}

// 브라우저에서 공유 링크를 만들 때 쓰는 주소. 로컬 개발 서버에서만 현재 주소를 그대로 씁니다.
export function publicSiteOrigin(): string {
  const env = fromEnv();
  if (env) return env;
  if (typeof window !== "undefined" && isLocalHost(window.location.hostname)) return window.location.origin;
  return DEFAULT_SITE_URL;
}

// 서버(메타데이터, OG 이미지)에서 쓰는 주소.
export function siteOrigin(): string {
  const env = fromEnv();
  if (env) return env;
  if (process.env.NODE_ENV === "development") return "http://localhost:3000";
  return DEFAULT_SITE_URL;
}

export function shareLink(origin: string, token: string) {
  return `${origin}/?share=${token}`;
}
