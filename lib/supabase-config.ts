// Supabase URL과 anon 키는 브라우저에 노출되는 공개값입니다. 접근 제어는
// supabase/schema.sql의 RLS 정책이 담당합니다. 값을 저장소에 두면 GitHub에서
// 코드를 고쳐도 별도 설정 없이 바로 빌드·배포됩니다. 환경 변수가 있으면 우선합니다.
const defaults = {
  url: "",
  anonKey: "",
};

export const supabaseConfig = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL || defaults.url,
  anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || defaults.anonKey,
};

export const supabaseConfigured = Boolean(supabaseConfig.url && supabaseConfig.anonKey);
