-- 이미지·PDF 말고 일반 파일(HTML, 한글, 엑셀 등)도 첨부할 수 있게 하는 스크립트입니다.
-- Supabase 대시보드 > SQL Editor 에 통째로 붙여 넣고 Run 하세요. 여러 번 실행해도 안전합니다.
-- schema.sql 전체를 실행해도 같은 내용이 들어갑니다.
--
-- 일반 파일은 앱이 내려받기 전용 형식(application/octet-stream)으로 올리므로, 공개 주소를 열어도 웹 페이지로
-- 실행되지 않습니다. 실행 파일(exe, bat 등)은 손님 첨부에서 서버가 한 번 더 막습니다.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
-- 파일당 30MB. 앱의 MAX_CLOUD_FILE 과 같은 값입니다.
-- 이미지·PDF 가 아닌 파일(HTML, 한글, 엑셀 등)은 앱이 application/octet-stream 으로 올립니다. 그래야 공개 주소를
-- 열어도 웹 페이지로 실행되지 않고 내려받기만 됩니다. 그래서 허용 형식은 이 셋만 둡니다.
values ('attachments', 'attachments', true, 31457280, array['image/*', 'application/pdf', 'application/octet-stream'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.attachments_accept_files()
returns boolean
language sql
stable
security definer
set search_path = public, storage
as $$
  select coalesce((
    select b.allowed_mime_types is null or 'application/octet-stream' = any(b.allowed_mime_types)
    from storage.buckets b
    where b.id = 'attachments'
  ), false);
$$;

grant execute on function public.attachments_accept_files() to anon, authenticated;

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
       or coalesce(attachment ->> 'kind', '') not in ('image', 'pdf', 'file')
       -- 내려받아 누르면 바로 실행되는 형식은 받지 않습니다. 앱의 lib/file-kinds.ts 와 같은 목록입니다.
       or lower(coalesce(attachment ->> 'name', '')) ~ '\.(exe|msi|bat|cmd|com|scr|pif|cpl|hta|jar|lnk|reg|vbs|vbe|wsf|wsh|ps1|psm1|apk|app|dmg|pkg|deb|rpm|sh)$'
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

-- 확인용. 마지막 열이 true 면 정상입니다.
select id, allowed_mime_types, public.attachments_accept_files() as 일반_파일_허용
from storage.buckets
where id = 'attachments';
