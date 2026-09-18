-- 공유받은 사람(손님)의 이미지·PDF 업로드가 막히는 문제만 고치는 짧은 스크립트입니다.
-- Supabase 대시보드 > SQL Editor 에 통째로 붙여 넣고 Run 하세요. 여러 번 실행해도 안전합니다.
-- schema.sql 전체를 실행해도 같은 내용이 들어갑니다. 긴 파일이 붙여넣기 중 잘릴 때 이 파일을 쓰세요.

-- 왜 막혔나: 예전 정책은 손님 업로드를 허용할지 판단할 때 정책 안에서 boards 표를 직접 조회했습니다.
-- 정책 안의 조회에도 boards 의 RLS 가 그대로 걸리는데 boards 는 로그인한 주인만 읽을 수 있어,
-- 익명인 손님에게는 결과가 항상 0건이 됩니다. 그래서 공유와 글쓰기를 켜 두어도 모든 손님 업로드가
-- 거부되었습니다. 아래 security definer 함수는 RLS 를 우회하므로 판단이 제대로 이루어집니다.

create or replace function public.board_accepts_guest_files(board_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.boards b
    where b.id = board_id
      and b.share_enabled = true
      and coalesce((b.data ->> 'guestPostEnabled')::boolean, false)
  );
$$;

grant execute on function public.board_accepts_guest_files(text) to anon, authenticated;

drop policy if exists "attachments guest insert" on storage.objects;

create policy "attachments guest insert" on storage.objects
  for insert to anon, authenticated
  with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = 'guest'
    and public.board_accepts_guest_files((storage.foldername(name))[2])
  );

-- 확인용. 공유와 글쓰기를 켠 보드는 마지막 열이 true 로 나와야 합니다.
select id, title, share_enabled, public.board_accepts_guest_files(id) as 손님_업로드_허용
from public.boards
order by updated_at desc;
