-- Callum Board 스키마. Supabase 대시보드 > SQL Editor에 통째로 붙여 넣고 Run 하세요.
-- 여러 번 실행해도 안전합니다.

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
values ('attachments', 'attachments', true, 15728640, array['image/*', 'application/pdf'])
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
