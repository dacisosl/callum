-- Callum Board 스키마. Supabase 대시보드 > SQL Editor에 통째로 붙여 넣고 Run 하세요.
-- 여러 번 실행해도 안전합니다.
--
-- 주의: 함수 본문 안에서 `select ... into 변수` 를 쓰지 마세요. Supabase 대시보드의 SQL Editor 는
-- 그것을 "새 표를 만드는 SELECT INTO" 로 오해해서 본문 한가운데에
-- `ALTER TABLE 변수 ENABLE ROW LEVEL SECURITY;` 를 끼워 넣습니다. 그러면 $$ 로 감싼 본문이 깨져
-- "unterminated dollar-quoted string" 오류가 납니다. 아래 함수들은 모두 `변수 := (select ...)`
-- 대입문으로 씁니다.

-- 1. 보드 테이블: 보드 하나가 한 행, 내용 전체는 data(jsonb)에 들어갑니다.
create table if not exists public.boards (
  id text primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  title text not null default '',
  data jsonb not null,
  share_enabled boolean not null default false,
  share_token text not null default '',
  created_at bigint not null,
  updated_at bigint not null
);

create index if not exists boards_owner_id_idx on public.boards (owner_id);
create unique index if not exists boards_share_token_idx
  on public.boards (share_token) where share_token <> '';

-- 2. 행 수준 보안: 소유자만 자기 보드를 읽고 씁니다.
alter table public.boards enable row level security;

drop policy if exists "boards owner select" on public.boards;
drop policy if exists "boards owner insert" on public.boards;
drop policy if exists "boards owner update" on public.boards;
drop policy if exists "boards owner delete" on public.boards;

create policy "boards owner select" on public.boards
  for select to authenticated using (auth.uid() = owner_id);
create policy "boards owner insert" on public.boards
  for insert to authenticated with check (auth.uid() = owner_id);
create policy "boards owner update" on public.boards
  for update to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "boards owner delete" on public.boards
  for delete to authenticated using (auth.uid() = owner_id);

-- 3. 공유 보드 조회: 토큰을 정확히 아는 사람만 읽을 수 있고, 공유 목록은 열거할 수 없습니다.
create or replace function public.get_shared_board(token text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select data
  from public.boards
  where share_enabled = true
    and token <> ''
    and share_token = token
  limit 1;
$$;

grant execute on function public.get_shared_board(text) to anon, authenticated;

-- 4. 첨부파일 버킷: 공개 읽기(공유 링크용), 쓰기는 자기 폴더({user_id}/...)에만 허용합니다.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
-- 파일당 30MB. 앱의 MAX_CLOUD_FILE 과 같은 값입니다.
values ('attachments', 'attachments', true, 31457280, array['image/*', 'application/pdf'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "attachments owner select" on storage.objects;
drop policy if exists "attachments owner insert" on storage.objects;
drop policy if exists "attachments owner update" on storage.objects;
drop policy if exists "attachments owner delete" on storage.objects;

create policy "attachments owner select" on storage.objects
  for select to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "attachments owner insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "attachments owner update" on storage.objects
  for update to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "attachments owner delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);

-- 공유받은 사람의 첨부: guest/{보드ID}/... 경로에만, 그 보드가 공유 중이고 글쓰기가 켜져 있을 때만 올릴 수 있습니다.
-- 파일 크기·형식 제한은 버킷 설정이 맡습니다. 주인은 자기 보드의 손님 파일을 읽고 지울 수 있습니다.
--
-- 중요: 이 검사를 정책 안에 `select ... from public.boards` 로 직접 쓰면 안 됩니다. 정책 안의
-- 조회에도 boards 의 RLS 가 그대로 걸리는데, boards 는 주인(authenticated)만 읽을 수 있어
-- 손님(anon)에게는 언제나 0건이 나옵니다. 그러면 공유와 글쓰기를 켜 두어도 손님 업로드가
-- 전부 거부됩니다. 그래서 RLS 를 우회하는 security definer 함수로 확인합니다.
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
drop policy if exists "attachments guest files owner select" on storage.objects;
drop policy if exists "attachments guest files owner delete" on storage.objects;

create policy "attachments guest insert" on storage.objects
  for insert to anon, authenticated
  with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = 'guest'
    and public.board_accepts_guest_files((storage.foldername(name))[2])
  );
create policy "attachments guest files owner select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = 'guest'
    and exists (select 1 from public.boards b where b.id = (storage.foldername(name))[2] and b.owner_id = auth.uid())
  );
create policy "attachments guest files owner delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = 'guest'
    and exists (select 1 from public.boards b where b.id = (storage.foldername(name))[2] and b.owner_id = auth.uid())
  );

-- 5. 카드 댓글: 보드 주인은 RLS로 직접 읽고 쓰고 지우며, 공유 링크를 받은 사람은
--    아래 함수 두 개로만 읽고 씁니다. 보드의 data->>'commentsEnabled' 가 true 일 때만 동작합니다.
create table if not exists public.card_comments (
  id text primary key,
  board_id text not null references public.boards (id) on delete cascade,
  card_id text not null,
  author_name text not null default '',
  author_id uuid references auth.users (id) on delete set null,
  body text not null,
  created_at bigint not null
);

create index if not exists card_comments_board_card_idx on public.card_comments (board_id, card_id, created_at);

alter table public.card_comments enable row level security;

drop policy if exists "comments owner select" on public.card_comments;
drop policy if exists "comments owner insert" on public.card_comments;
drop policy if exists "comments owner delete" on public.card_comments;

create policy "comments owner select" on public.card_comments
  for select to authenticated
  using (exists (select 1 from public.boards b where b.id = board_id and b.owner_id = auth.uid()));
create policy "comments owner insert" on public.card_comments
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and exists (select 1 from public.boards b where b.id = board_id and b.owner_id = auth.uid())
  );
create policy "comments owner delete" on public.card_comments
  for delete to authenticated
  using (exists (select 1 from public.boards b where b.id = board_id and b.owner_id = auth.uid()));

-- 공유 보드의 댓글 읽기. 주인의 사용자 ID는 노출하지 않고 by_owner 플래그만 내려 줍니다.
create or replace function public.get_shared_comments(token text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'board_id', c.board_id,
        'card_id', c.card_id,
        'author_name', c.author_name,
        'body', c.body,
        'created_at', c.created_at,
        'by_owner', c.author_id is not null
      )
      order by c.created_at
    ),
    '[]'::jsonb
  )
  from public.card_comments c
  join public.boards b on b.id = c.board_id
  where b.share_enabled = true
    and token <> ''
    and b.share_token = token
    and coalesce((b.data ->> 'commentsEnabled')::boolean, false);
$$;

-- 공유 보드에 댓글 쓰기. 토큰이 맞고 댓글이 켜져 있으며 카드가 실제로 있을 때만 저장합니다.
create or replace function public.add_shared_comment(
  token text,
  comment_id text,
  target_card text,
  author text,
  content text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target jsonb;
  board_id text;
  saved_author text;
  saved_body text;
  now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  target := (
    select to_jsonb(b)
    from public.boards b
    where b.share_enabled = true
      and token <> ''
      and b.share_token = token
      and coalesce((b.data ->> 'commentsEnabled')::boolean, false)
    limit 1
  );
  if target is null then
    raise exception '이 보드에는 댓글을 남길 수 없습니다.';
  end if;
  board_id := target ->> 'id';
  if comment_id is null or length(comment_id) = 0 or length(comment_id) > 80 then
    raise exception '댓글 ID가 올바르지 않습니다.';
  end if;
  if content is null or length(btrim(content)) = 0 then
    raise exception '댓글 내용을 입력해 주세요.';
  end if;
  if length(content) > 1000 then
    raise exception '댓글은 1000자 이하로 입력해 주세요.';
  end if;
  if not exists (
    select 1
    from jsonb_array_elements(coalesce(target -> 'data' -> 'columns', '[]'::jsonb)) col,
         jsonb_array_elements(coalesce(col -> 'cards', '[]'::jsonb)) card
    where card ->> 'id' = target_card
  ) then
    raise exception '카드를 찾을 수 없습니다.';
  end if;

  saved_author := left(coalesce(nullif(btrim(author), ''), '익명'), 40);
  saved_body := left(btrim(content), 1000);

  insert into public.card_comments (id, board_id, card_id, author_name, author_id, body, created_at)
  values (comment_id, board_id, target_card, saved_author, null, saved_body, now_ms);

  return jsonb_build_object(
    'id', comment_id,
    'board_id', board_id,
    'card_id', target_card,
    'author_name', saved_author,
    'body', saved_body,
    'created_at', now_ms,
    'by_owner', false
  );
end;
$$;

grant execute on function public.get_shared_comments(text) to anon, authenticated;
grant execute on function public.add_shared_comment(text, text, text, text, text) to anon, authenticated;

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
  target jsonb;
  board_id text;
  board_data jsonb;
  new_card jsonb;
  card_total int;
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
    raise exception '이 보드에는 카드를 올릴 수 없습니다.';
  end if;
  board_id := target ->> 'id';
  board_data := target -> 'data';

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
    select 1 from jsonb_array_elements(coalesce(board_data -> 'columns', '[]'::jsonb)) col
    where col ->> 'id' = target_column
  ) then
    raise exception '칼럼을 찾을 수 없습니다.';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(coalesce(board_data -> 'columns', '[]'::jsonb)) col,
         jsonb_array_elements(coalesce(col -> 'cards', '[]'::jsonb)) card
    where card ->> 'id' = card_id
  ) then
    raise exception '같은 ID의 카드가 이미 있습니다.';
  end if;

  -- 공개 쓰기 경로이므로 보드 하나가 무한히 커지지 않도록 상한을 둡니다.
  card_total := (
    select count(*)
    from jsonb_array_elements(coalesce(board_data -> 'columns', '[]'::jsonb)) col,
         jsonb_array_elements(coalesce(col -> 'cards', '[]'::jsonb)) card
  );
  if card_total >= 2000 then
    raise exception '이 보드에는 더 이상 카드를 올릴 수 없습니다.';
  end if;

  new_card := jsonb_strip_nulls(jsonb_build_object(
    'id', card_id,
    'title', left(btrim(card_title), 120),
    'body', left(btrim(coalesce(card_body, '')), 3000),
    'attachments', public.clean_guest_attachments(board_id, card_attachments),
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
  where b.id = board_id;

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
  target jsonb;
  board_id text;
  board_data jsonb;
  existing jsonb;
  updated jsonb;
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
    raise exception '이 보드의 글은 수정할 수 없습니다.';
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
      'attachments', public.clean_guest_attachments(board_id, card_attachments),
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
  where b.id = board_id;

  return updated;
end;
$$;

grant execute on function public.update_shared_card(text, text, text, text, jsonb, text, jsonb) to anon, authenticated;

-- 손님이 자기가 올린 글을 지웁니다. 수정과 같은 열쇠 검사를 거치므로 남의 글은 못 지웁니다.
-- 첨부 파일 자체는 저장소에 남습니다(손님에게는 저장소 삭제 권한이 없습니다). 보드를 지우면 함께 정리됩니다.
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

-- 7. 내 사용량: 홈 화면 대시보드용. 내 보드 데이터와 댓글이 차지하는 바이트를 돌려줍니다.
--    security invoker 이므로 RLS 가 그대로 적용되어 남의 보드는 세지 않습니다.
create or replace function public.get_my_usage()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'board_count', (select count(*) from public.boards b where b.owner_id = auth.uid()),
    'board_bytes', (select coalesce(sum(pg_column_size(b.data)), 0) from public.boards b where b.owner_id = auth.uid()),
    'comment_count', (select count(*) from public.card_comments c join public.boards b on b.id = c.board_id where b.owner_id = auth.uid()),
    'comment_bytes', (select coalesce(sum(pg_column_size(c.*)), 0) from public.card_comments c join public.boards b on b.id = c.board_id where b.owner_id = auth.uid())
  );
$$;

grant execute on function public.get_my_usage() to authenticated;
