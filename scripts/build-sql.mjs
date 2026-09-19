// supabase/schema.sql 하나를 원본으로 삼아 짧은 스크립트들과 앱이 복사해 줄 문자열을 만듭니다.
//
// 손으로 떼어 만들면 schema.sql 이 바뀔 때 조용히 어긋납니다. 그래서 여기서 한 번에 만듭니다.
// `npm run sql` 로 직접 돌리고, `npm run build` 앞에서도 자동으로 돌아 배포에 낡은 내용이 실리지
// 않게 합니다. 구간 표시를 못 찾으면 빈 파일을 만들지 않고 소리 내어 실패합니다.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const schema = readFileSync(join(root, "supabase/schema.sql"), "utf8");
const lines = schema.split("\n");

// 시작 표시가 있는 줄부터 끝 표시가 있는 줄까지를 그대로 떼어 옵니다.
// endInclusive 가 false 면 끝 표시 줄은 빼고, 그 앞의 빈 줄도 다듬습니다.
function section(startsWith, endStartsWith, { endInclusive = true, after = 0 } = {}) {
  const start = lines.findIndex((line, index) => index >= after && line.startsWith(startsWith));
  if (start < 0) throw new Error(`schema.sql 에서 시작 표시를 찾지 못했습니다: ${startsWith}`);
  const end = lines.findIndex((line, index) => index > start && line.startsWith(endStartsWith));
  if (end < 0) throw new Error(`schema.sql 에서 끝 표시를 찾지 못했습니다: ${endStartsWith}`);
  const slice = lines.slice(start, endInclusive ? end + 1 : end);
  while (slice.length && slice[slice.length - 1].trim() === "") slice.pop();
  return slice.join("\n");
}

const CHECK_FUNCTIONS = `
-- 확인용. 아래 네 함수가 모두 보이면 정상입니다.
select p.proname as 함수, pg_get_function_identity_arguments(p.oid) as 인자
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('add_shared_card', 'update_shared_card', 'delete_shared_card', 'guest_edit_hash')
order by 1;
`;

const uploads = `-- 공유받은 사람(손님)의 이미지·PDF 업로드가 막히는 문제만 고치는 짧은 스크립트입니다.
-- Supabase 대시보드 > SQL Editor 에 통째로 붙여 넣고 Run 하세요. 여러 번 실행해도 안전합니다.
-- schema.sql 전체를 실행해도 같은 내용이 들어갑니다. 긴 파일이 붙여넣기 중 잘릴 때 이 파일을 쓰세요.

-- 왜 막혔나: 예전 정책은 손님 업로드를 허용할지 판단할 때 정책 안에서 boards 표를 직접 조회했습니다.
-- 정책 안의 조회에도 boards 의 RLS 가 그대로 걸리는데 boards 는 로그인한 주인만 읽을 수 있어,
-- 익명인 손님에게는 결과가 항상 0건이 됩니다. 그래서 공유와 글쓰기를 켜 두어도 모든 손님 업로드가
-- 거부되었습니다. 아래 security definer 함수는 RLS 를 우회하므로 판단이 제대로 이루어집니다.

${section("create or replace function public.board_accepts_guest_files", "grant execute on function public.board_accepts_guest_files")}

drop policy if exists "attachments guest insert" on storage.objects;

${section('create policy "attachments guest insert"', 'create policy "attachments guest files owner select"', { endInclusive: false })}

-- 확인용. 공유와 글쓰기를 켠 보드는 마지막 열이 true 로 나와야 합니다.
select id, title, share_enabled, public.board_accepts_guest_files(id) as 손님_업로드_허용
from public.boards
order by updated_at desc;
`;

const cards = `-- 공유받은 사람의 카드 작성·수정·삭제 부분만 담은 스크립트입니다.
-- Supabase 대시보드 > SQL Editor 에 통째로 붙여 넣고 Run 하세요. 여러 번 실행해도 안전합니다.
-- schema.sql 전체를 실행해도 같은 내용이 들어갑니다.
--
-- 이 파일을 실행하면 손님이 자기가 올린 글을 나중에 고치거나 지울 수 있게 됩니다.
-- 실행하지 않아도 글 올리기와 파일 첨부는 예전처럼 동작합니다.

${section("-- 6. 공유받은", "grant execute on function public.delete_shared_card")}
${CHECK_FUNCTIONS}`;

// 삭제만 빠진 사람을 위한 최소 조합. 열쇠 지문 함수는 delete_shared_card 가 쓰므로 함께 넣습니다.
const deleteOnly = `-- 손님이 자기가 올린 글을 지우는 기능만 담은 짧은 스크립트입니다.
-- Supabase 대시보드 > SQL Editor 에 통째로 붙여 넣고 Run 하세요. 여러 번 실행해도 안전합니다.
-- supabase/guest-cards.sql 이나 supabase/schema.sql 전체를 실행해도 같은 내용이 들어갑니다.
--
-- 이 파일이 필요한 이유: 글쓰기와 수정은 되는데 삭제만
-- "이 보드는 아직 글 삭제를 받을 준비가 되지 않았습니다" 가 뜬다면 delete_shared_card 가 없는 것입니다.
-- 삭제 기능이 나중에 추가되어, 그 전에 실행한 스크립트에는 들어 있지 않습니다.

${section("create or replace function public.guest_edit_hash", "$$;")}

${section("create or replace function public.delete_shared_card", "grant execute on function public.delete_shared_card")}
${CHECK_FUNCTIONS}`;

const files = {
  "supabase/fix-guest-uploads.sql": uploads,
  "supabase/guest-cards.sql": cards,
  "supabase/guest-card-delete.sql": deleteOnly,
};

for (const [path, body] of Object.entries(files)) {
  writeFileSync(join(root, path), body);
}

// 앱이 "SQL 복사" 버튼에서 쓰는 문자열. 누를 때만 불러오도록 따로 둡니다.
const quote = (text) => JSON.stringify(text);
const generated = `// 이 파일은 scripts/build-sql.mjs 가 supabase/schema.sql 에서 만들어 냅니다. 손으로 고치지 마세요.
// 고칠 내용은 supabase/schema.sql 에 반영한 뒤 \`npm run sql\` 을 돌리세요.

export const GUEST_UPLOADS_SQL = ${quote(uploads)};

export const GUEST_CARDS_SQL = ${quote(cards)};

export const GUEST_CARD_DELETE_SQL = ${quote(deleteOnly)};
`;

mkdirSync(join(root, "lib"), { recursive: true });
writeFileSync(join(root, "lib/generated-sql.ts"), generated);

const sizes = Object.entries(files).map(([path, body]) => `${path} ${body.split("\n").length}줄`);
console.log(`supabase/schema.sql 에서 만들었습니다: ${sizes.join(", ")}, lib/generated-sql.ts`);
