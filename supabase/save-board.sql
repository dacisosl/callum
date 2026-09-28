-- 주인이 저장할 때 손님 카드를 잃지 않도록 서버 안에서 합치는 함수만 담은 스크립트입니다.
-- Supabase 대시보드 > SQL Editor 에 통째로 붙여 넣고 Run 하세요. 여러 번 실행해도 안전합니다.
-- schema.sql 전체를 실행해도 같은 내용이 들어갑니다.
--
-- 왜 필요한가: 주인 화면은 보드를 통째로 저장합니다. 여러 사람이 동시에 글을 올리는 동안 주인이
-- 카드를 옮기거나 고치면, 저장하는 짧은 순간에 올라온 손님 글이 덮여 사라질 수 있습니다.
-- 이 함수는 행을 잠근 채 합쳐 저장해 그 틈을 없앱니다. 실행하지 않아도 앱은 예전 방식으로 저장됩니다.

create or replace function public.save_board(
  board_id text,
  board jsonb,
  removed_card_ids text[] default '{}'
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_data jsonb;
  merged jsonb;
  mine_ids text[];
  restored jsonb;
begin
  if board_id is null or board_id = '' or board is null or jsonb_typeof(board) <> 'object' then
    raise exception '보드가 올바르지 않습니다.';
  end if;
  if board ->> 'id' is distinct from board_id then
    raise exception '보드 ID가 맞지 않습니다.';
  end if;

  -- 같은 행을 고치는 손님 함수가 끝날 때까지 기다리고, 끝난 뒤에는 그쪽이 기다립니다.
  perform 1 from public.boards b where b.id = board_id for update;
  current_data := (select b.data from public.boards b where b.id = board_id);

  merged := board;
  if current_data is not null and jsonb_typeof(current_data -> 'columns') = 'array' then
    mine_ids := array(
      select card ->> 'id'
      from jsonb_array_elements(coalesce(board -> 'columns', '[]'::jsonb)) col,
           jsonb_array_elements(coalesce(col -> 'cards', '[]'::jsonb)) card
    );
    -- 내 화면에 없는 손님 카드를 칼럼마다 맨 앞에 되살립니다. 손님 함수도 항상 맨 앞에 붙입니다.
    restored := (
      select coalesce(jsonb_agg(
        case when missing.cards is null then c.col
             else jsonb_set(c.col, '{cards}', missing.cards || coalesce(c.col -> 'cards', '[]'::jsonb)) end
        order by c.idx), '[]'::jsonb)
      from jsonb_array_elements(coalesce(board -> 'columns', '[]'::jsonb)) with ordinality as c(col, idx)
      left join lateral (
        select jsonb_agg(r.card order by r.idx) as cards
        from jsonb_array_elements(coalesce(current_data -> 'columns', '[]'::jsonb)) rc,
             jsonb_array_elements(coalesce(rc -> 'cards', '[]'::jsonb)) with ordinality as r(card, idx)
        where rc ->> 'id' = c.col ->> 'id'
          and coalesce(r.card ->> 'guestAuthor', '') <> ''
          and not (r.card ->> 'id' = any(mine_ids))
          and not (r.card ->> 'id' = any(coalesce(removed_card_ids, '{}')))
      ) missing on true
    );
    merged := jsonb_set(board, '{columns}', restored);
  end if;

  insert into public.boards (id, owner_id, title, data, share_enabled, share_token, created_at, updated_at)
  values (
    board_id,
    auth.uid(),
    coalesce(merged ->> 'title', ''),
    merged,
    coalesce((merged ->> 'shareEnabled')::boolean, false),
    coalesce(merged ->> 'shareToken', ''),
    coalesce((merged ->> 'createdAt')::bigint, (extract(epoch from now()) * 1000)::bigint),
    coalesce((merged ->> 'updatedAt')::bigint, (extract(epoch from now()) * 1000)::bigint)
  )
  on conflict (id) do update set
    owner_id = excluded.owner_id,
    title = excluded.title,
    data = excluded.data,
    share_enabled = excluded.share_enabled,
    share_token = excluded.share_token,
    updated_at = excluded.updated_at;

  return merged;
end;
$$;

grant execute on function public.save_board(text, jsonb, text[]) to authenticated;

-- 확인용. save_board 가 보이면 정상입니다.
select p.proname as 함수, pg_get_function_identity_arguments(p.oid) as 인자
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'save_board';
