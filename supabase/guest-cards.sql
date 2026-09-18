-- 공유받은 사람의 카드 작성·수정 부분만 담은 스크립트입니다.
-- Supabase 대시보드 > SQL Editor 에 통째로 붙여 넣고 Run 하세요. 여러 번 실행해도 안전합니다.
-- schema.sql 전체를 실행해도 같은 내용이 들어갑니다. 긴 파일이 붙여넣기 중 잘릴 때 이 파일을 쓰세요.
--
-- 이 파일을 실행하면 손님이 자기가 올린 글을 나중에 고칠 수 있게 됩니다.
-- 실행하지 않아도 글 올리기와 파일 첨부는 예전처럼 동작합니다(수정만 안 됩니다).

-- 6. 공유받은 사람의 카드 작성·수정: 보드의 data->>'guestPostEnabled' 가 true 일 때만 동작합니다.
--    주인의 보드 데이터(jsonb) 안에 카드를 직접 덧붙이므로 주인이 보는 화면과 같은 카드가 됩니다.

-- 손님이 자기 글을 고칠 때 쓰는 열쇠의 지문. 손님은 로그인을 하지 않아 신원을 증명할 수 없으므로,
-- 글을 올릴 때 브라우저에 비밀 열쇠를 저장하고 서버에는 이 지문만 남깁니다. 지문은 보드 데이터에
-- 들어가 공유 링크로 읽히지만, 지문만으로는 원래 열쇠를 알 수 없어 남의 글을 고칠 수 없습니다.
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

-- 손님 첨부 검사. 우리 저장소의 guest/{이 보드}/ 경로에 올라간 이미지·PDF 만, 최대 10개까지 받습니다.
-- 카드 작성과 수정이 같은 규칙을 쓰도록 함수로 빼 두었습니다.
create or replace function public.clean_guest_attachments(board_id text, raw jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  attachment jsonb;
  result jsonb := '[]'::jsonb;
begin
  if raw is null or jsonb_typeof(raw) <> 'array' then
    return '[]'::jsonb;
  end if;
  if jsonb_array_length(raw) > 10 then
    raise exception '첨부는 카드당 10개까지 올릴 수 있습니다.';
  end if;
  for attachment in select * from jsonb_array_elements(raw) loop
    if jsonb_typeof(attachment) <> 'object'
       or coalesce(attachment ->> 'kind', '') not in ('image', 'pdf')
       or coalesce(attachment ->> 'storagePath', '') not like ('guest/' || board_id || '/%')
       or coalesce(attachment ->> 'url', '') not like ('%/storage/v1/object/public/attachments/guest/' || board_id || '/%')
       or coalesce((attachment ->> 'size')::bigint, 0) < 0
       or coalesce((attachment ->> 'size')::bigint, 0) > 31457280 then
      raise exception '첨부 정보가 올바르지 않습니다.';
    end if;
    -- PDF 첫 쪽 썸네일도 같은 guest/{이 보드}/ 경로일 때만 받고, 아니면 버립니다.
    result := result || jsonb_strip_nulls(jsonb_build_object(
      'id', left(coalesce(attachment ->> 'id', 'file-' || gen_random_uuid()::text), 80),
      'name', left(coalesce(attachment ->> 'name', '첨부'), 200),
      'kind', attachment ->> 'kind',
      'mimeType', left(coalesce(attachment ->> 'mimeType', ''), 100),
      'size', coalesce((attachment ->> 'size')::bigint, 0),
      'url', attachment ->> 'url',
      'storagePath', attachment ->> 'storagePath',
      'thumbnailUrl', case when coalesce(attachment ->> 'thumbnailUrl', '') like ('%/storage/v1/object/public/attachments/guest/' || board_id || '/%') then attachment ->> 'thumbnailUrl' end,
      'thumbnailPath', case when coalesce(attachment ->> 'thumbnailPath', '') like ('guest/' || board_id || '/%') then attachment ->> 'thumbnailPath' end
    ));
  end loop;
  return result;
end;
$$;

-- 매개변수가 바뀌었으므로 예전 시그니처를 지우고 다시 만듭니다(그냥 만들면 오버로드가 남아 호출이 모호해집니다).
drop function if exists public.add_shared_card(text, text, text, text, text, jsonb, text);
drop function if exists public.add_shared_card(text, text, text, text, text, jsonb, text, jsonb);

create or replace function public.add_shared_card(
  token text,
  card_id text,
  target_column text,
  card_title text,
  card_body text,
  card_link jsonb,
  author text,
  card_attachments jsonb default '[]'::jsonb,
  card_edit_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.boards%rowtype;
  new_card jsonb;
  card_total int;
  now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  select * into target
  from public.boards b
  where b.share_enabled = true
    and token <> ''
    and b.share_token = token
    and coalesce((b.data ->> 'guestPostEnabled')::boolean, false)
  limit 1;
  if not found then
    raise exception '이 보드에는 카드를 올릴 수 없습니다.';
  end if;

  if card_id is null or length(card_id) = 0 or length(card_id) > 80 then
    raise exception '카드 ID가 올바르지 않습니다.';
  end if;
  if card_title is null or length(btrim(card_title)) = 0 then
    raise exception '카드 제목을 입력해 주세요.';
  end if;
  if length(card_title) > 120 or length(coalesce(card_body, '')) > 3000 then
    raise exception '카드 내용이 너무 깁니다.';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(coalesce(target.data -> 'columns', '[]'::jsonb)) col
    where col ->> 'id' = target_column
  ) then
    raise exception '칼럼을 찾을 수 없습니다.';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(coalesce(target.data -> 'columns', '[]'::jsonb)) col,
         jsonb_array_elements(coalesce(col -> 'cards', '[]'::jsonb)) card
    where card ->> 'id' = card_id
  ) then
    raise exception '같은 ID의 카드가 이미 있습니다.';
  end if;

  -- 공개 쓰기 경로이므로 보드 하나가 무한히 커지지 않도록 상한을 둡니다.
  select count(*) into card_total
  from jsonb_array_elements(coalesce(target.data -> 'columns', '[]'::jsonb)) col,
       jsonb_array_elements(coalesce(col -> 'cards', '[]'::jsonb)) card;
  if card_total >= 2000 then
    raise exception '이 보드에는 더 이상 카드를 올릴 수 없습니다.';
  end if;

  new_card := jsonb_strip_nulls(jsonb_build_object(
    'id', card_id,
    'title', left(btrim(card_title), 120),
    'body', left(btrim(coalesce(card_body, '')), 3000),
    'attachments', public.clean_guest_attachments(target.id, card_attachments),
    'link', card_link,
    'guestAuthor', left(coalesce(nullif(btrim(author), ''), '익명'), 40),
    'editKeyHash', public.guest_edit_hash(card_edit_key),
    'createdAt', now_ms,
    'updatedAt', now_ms
  ));

  -- 대상 칼럼의 카드 목록 맨 앞에 새 카드를 넣습니다. 다른 칼럼은 그대로 둡니다.
  update public.boards b
  set data = jsonb_set(
        b.data,
        '{columns}',
        (
          select coalesce(jsonb_agg(
            case
              when col ->> 'id' = target_column
                then jsonb_set(col, '{cards}', new_card || coalesce(col -> 'cards', '[]'::jsonb))
              else col
            end
            order by ordinality
          ), '[]'::jsonb)
          from jsonb_array_elements(coalesce(b.data -> 'columns', '[]'::jsonb)) with ordinality as t(col, ordinality)
        )
      ) || jsonb_build_object('updatedAt', now_ms),
      updated_at = now_ms
  where b.id = target.id;

  return new_card;
end;
$$;

grant execute on function public.add_shared_card(text, text, text, text, text, jsonb, text, jsonb, text) to anon, authenticated;

-- 손님이 자기가 올린 글을 고칩니다. 글을 올릴 때 받은 열쇠가 맞아야만 통과하므로 남의 글은 못 고칩니다.
-- 칼럼은 옮기지 않고, 작성자·작성 시각·카드 색은 그대로 둡니다. 삭제는 보드 주인만 할 수 있습니다.
create or replace function public.update_shared_card(
  token text,
  card_id text,
  card_title text,
  card_body text,
  card_link jsonb,
  edit_key text,
  card_attachments jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.boards%rowtype;
  existing jsonb;
  updated jsonb;
  now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  select * into target
  from public.boards b
  where b.share_enabled = true
    and token <> ''
    and b.share_token = token
    and coalesce((b.data ->> 'guestPostEnabled')::boolean, false)
  limit 1;
  if not found then
    raise exception '이 보드의 글은 수정할 수 없습니다.';
  end if;

  select card into existing
  from jsonb_array_elements(coalesce(target.data -> 'columns', '[]'::jsonb)) col,
       jsonb_array_elements(coalesce(col -> 'cards', '[]'::jsonb)) card
  where card ->> 'id' = card_id
  limit 1;
  if existing is null then
    raise exception '글을 찾을 수 없습니다.';
  end if;

  if coalesce(existing ->> 'editKeyHash', '') = ''
     or existing ->> 'editKeyHash' is distinct from public.guest_edit_hash(edit_key) then
    raise exception '이 글을 수정할 권한이 없습니다. 글을 올린 브라우저에서만 고칠 수 있습니다.';
  end if;

  if card_title is null or length(btrim(card_title)) = 0 then
    raise exception '카드 제목을 입력해 주세요.';
  end if;
  if length(card_title) > 120 or length(coalesce(card_body, '')) > 3000 then
    raise exception '카드 내용이 너무 깁니다.';
  end if;

  updated := jsonb_strip_nulls(
    (existing - 'link') || jsonb_build_object(
      'title', left(btrim(card_title), 120),
      'body', left(btrim(coalesce(card_body, '')), 3000),
      'attachments', public.clean_guest_attachments(target.id, card_attachments),
      'link', card_link,
      'updatedAt', now_ms
    )
  );

  update public.boards b
  set data = jsonb_set(
        b.data,
        '{columns}',
        (
          select coalesce(jsonb_agg(
            jsonb_set(col, '{cards}', (
              select coalesce(jsonb_agg(
                case when c ->> 'id' = card_id then updated else c end
                order by card_order
              ), '[]'::jsonb)
              from jsonb_array_elements(coalesce(col -> 'cards', '[]'::jsonb)) with ordinality as k(c, card_order)
            ))
            order by ordinality
          ), '[]'::jsonb)
          from jsonb_array_elements(coalesce(b.data -> 'columns', '[]'::jsonb)) with ordinality as t(col, ordinality)
        )
      ) || jsonb_build_object('updatedAt', now_ms),
      updated_at = now_ms
  where b.id = target.id;

  return updated;
end;
$$;

grant execute on function public.update_shared_card(text, text, text, text, jsonb, text, jsonb) to anon, authenticated;

-- 확인용. 아래 세 함수가 모두 보이면 정상입니다.
select p.proname as 함수, pg_get_function_identity_arguments(p.oid) as 인자
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('add_shared_card', 'update_shared_card', 'guest_edit_hash')
order by 1;
