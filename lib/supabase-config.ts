// Supabase URL과 publishable 키는 브라우저에 노출되는 공개값입니다. 접근 제어는
// supabase/schema.sql의 RLS 정책이 담당합니다. 값을 저장소에 두면 GitHub에서
// 코드를 고쳐도 별도 설정 없이 바로 빌드·배포됩니다. 환경 변수가 있으면 우선합니다.
const defaults = {
  url: "https://jvgpznfwjakxpygpidzo.supabase.co",
  anonKey: "sb_publishable_Xkjf-Nw5EU0LbxihQxO3zQ_mVrI7XWx",
};

export const supabaseConfig = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL || defaults.url,
  anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || defaults.anonKey,
};

// 로컬에서 UI만 확인할 때 NEXT_PUBLIC_DEMO_MODE=1 을 주면 서버 없이 브라우저 데모 모드로 실행됩니다.
export const supabaseConfigured =
  process.env.NEXT_PUBLIC_DEMO_MODE !== "1" && Boolean(supabaseConfig.url && supabaseConfig.anonKey);
