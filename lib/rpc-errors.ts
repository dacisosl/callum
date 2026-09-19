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

// 손님 기능 중 데이터베이스에 갖춰진 것들.
export interface GuestFunctions {
  post: boolean;
  edit: boolean;
  remove: boolean;
  upload: boolean;
}

// 화면에 보여 줄 "빠진 기능" 이름들. 갖춰졌으면 빈 배열입니다.
export function missingGuestFeatures(found: GuestFunctions | null): string[] {
  if (!found) return [];
  return [
    !found.post && "글쓰기",
    !found.edit && "글 수정",
    !found.remove && "글 삭제",
    !found.upload && "파일 업로드",
  ].filter((item): item is string => Boolean(item));
}

// 빠진 것을 메우는 데 필요한 최소한의 SQL 이 무엇인지. 실제 내용은 lib/generated-sql.ts 에 있고,
// 여기서는 어느 것을 쓸지만 고릅니다.
export type SqlChoice = "none" | "uploads" | "cards" | "delete" | "uploads+cards";

export function sqlChoiceFor(found: GuestFunctions | null): SqlChoice {
  if (!found) return "none";
  const cardsMissing = !found.post || !found.edit || !found.remove;
  if (!found.upload && cardsMissing) return "uploads+cards";
  if (!found.upload) return "uploads";
  if (!cardsMissing) return "none";
  // 삭제만 빠진 경우가 가장 흔하고, 그때는 제일 짧은 스크립트면 충분합니다.
  if (found.post && found.edit) return "delete";
  return "cards";
}
