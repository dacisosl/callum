// PostgREST 오류를 분류합니다. 저장소나 네트워크와 무관한 순수 판정이라 따로 두고 시험합니다.

export interface RpcError {
  code?: string;
  message?: string;
}

// 그 이름·인자의 데이터베이스 함수가 아직 없을 때 나는 오류인지. 보드 주인이 최신
// supabase/schema.sql 을 아직 실행하지 않은 경우입니다. PostgREST 는 코드 PGRST202 를 주는데,
// 버전에 따라 코드 없이 문구만 오기도 해서 둘 다 봅니다.
export function isMissingFunction(error: RpcError | null | undefined): boolean {
  if (!error) return false;
  return error.code === "PGRST202" || (error.message ?? "").includes("Could not find the function");
}
