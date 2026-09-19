-- 손님이 자기가 올린 글을 지우는 기능만 담은 짧은 스크립트입니다.
-- Supabase 대시보드 > SQL Editor 에 통째로 붙여 넣고 Run 하세요. 여러 번 실행해도 안전합니다.
-- supabase/guest-cards.sql 이나 supabase/schema.sql 전체를 실행해도 같은 내용이 들어갑니다.
--
-- 이 파일이 필요한 이유: 글쓰기와 수정은 되는데 삭제만
-- "이 보드는 아직 글 삭제를 받을 준비가 되지 않았습니다" 가 뜬다면 delete_shared_card 가 없는 것입니다.
-- 삭제 기능이 나중에 추가되어, 그 전에 실행한 스크립트에는 들어 있지 않습니다.

create or replace function public.guest_edit_hash(edit_key text)
returns text
language sql
immutable
as $$
  select case
    when coalesce(btrim(edit_key), '') = '' then null
    else encode(sha256(convert_to(edit_key, 'UTF8')), 'hex')
  end;
$$;

create or replace function public.delete_shared_card(
  token text,
  card_id text,
  edit_key text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  target jsonb;
  board_id text;
  board_data jsonb;
  existing jsonb;
  now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  target := (
    select to_jsonb(b)
    from public.boards b
    where b.share_enabled = true
      and token <> ''
      and b.share_token = token
      and coalesce((b.data ->> 'guestPostEnabled')::boolean, false)
    limit 1
  );
  if target is null then
    raise exception '이 보드의 글은 지울 수 없습니다.';
  end if;
  board_id := target ->> 'id';
  board_data := target -> 'data';

  existing := (
    select card
    from jsonb_array_elements(coalesce(board_data -> 'columns', '[]'::jsonb)) col,
         jsonb_array_elements(coalesce(col -> 'cards', '[]'::jsonb)) card
    where card ->> 'id' = card_id
    limit 1
  );
  if existing is null then
    raise exception '글을 찾을 수 없습니다.';
  end if;

  if coalesce(existing ->> 'editKeyHash', '') = ''
     or existing ->> 'editKeyHash' is distinct from public.guest_edit_hash(edit_key) then
    raise exception '이 글을 지울 권한이 없습니다. 글을 올린 브라우저에서만 지울 수 있습니다.';
  end if;

  update public.boards b
  set data = jsonb_set(
        b.data,
        '{columns}',
        (
          select coalesce(jsonb_agg(
            jsonb_set(col, '{cards}', (
              select coalesce(jsonb_agg(c order by card_order), '[]'::jsonb)
              from jsonb_array_elements(coalesce(col -> 'cards', '[]'::jsonb)) with ordinality as k(c, card_order)
              where c ->> 'id' <> card_id
            ))
            order by ordinality
          ), '[]'::jsonb)
          from jsonb_array_elements(coalesce(b.data -> 'columns', '[]'::jsonb)) with ordinality as t(col, ordinality)
        )
      ) || jsonb_build_object('updatedAt', now_ms),
      updated_at = now_ms
  where b.id = board_id;

  return true;
end;
$$;

grant execute on function public.delete_shared_card(text, text, text) to anon, authenticated;

-- 확인용. 아래 네 함수가 모두 보이면 정상입니다.
select p.proname as 함수, pg_get_function_identity_arguments(p.oid) as 인자
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('add_shared_card', 'update_shared_card', 'delete_shared_card', 'guest_edit_hash')
order by 1;
