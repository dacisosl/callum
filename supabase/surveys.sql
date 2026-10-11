-- 설문 섹션의 응답을 받는 부분만 담은 스크립트입니다.
-- Supabase 대시보드 > SQL Editor 에 통째로 붙여 넣고 Run 하세요. 여러 번 실행해도 안전합니다.
-- schema.sql 전체를 실행해도 같은 내용이 들어갑니다.
--
-- 응답은 공유 링크로 읽히지 않도록 보드 데이터 밖의 survey_responses 표에 따로 두고,
-- 보드 주인만 읽고 지울 수 있습니다. 실행하기 전에는 공유받은 사람이 설문에 응답할 수 없습니다.

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

create table if not exists public.survey_responses (
  id text primary key,
  board_id text not null references public.boards (id) on delete cascade,
  column_id text not null,
  answers jsonb not null,
  key_hash text not null,
  created_at bigint not null,
  updated_at bigint not null
);

create index if not exists survey_responses_board_idx on public.survey_responses (board_id, column_id);

alter table public.survey_responses enable row level security;

drop policy if exists "survey owner select" on public.survey_responses;
drop policy if exists "survey owner delete" on public.survey_responses;

create policy "survey owner select" on public.survey_responses
  for select to authenticated
  using (exists (select 1 from public.boards b where b.id = board_id and b.owner_id = auth.uid()));
create policy "survey owner delete" on public.survey_responses
  for delete to authenticated
  using (exists (select 1 from public.boards b where b.id = board_id and b.owner_id = auth.uid()));

-- 응답 제출과 수정. 보드가 공유 중이고 그 칼럼에 마감되지 않은 설문이 있을 때만 받습니다.
-- 답은 설문 정의에 맞춰 서버에서 다시 거릅니다(없는 질문·보기는 버리고, 필수 질문이 비면 거부).
-- 같은 response_id 로 다시 보내면 열쇠 지문이 맞을 때만 고칩니다.
create or replace function public.submit_survey_response(
  token text,
  target_column text,
  response_id text,
  response_answers jsonb,
  edit_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_board jsonb;
  v_board_id text;
  v_survey jsonb;
  v_question jsonb;
  v_value jsonb;
  v_clean jsonb := '{}'::jsonb;
  v_option_ids text[];
  v_picked text[];
  v_hash text;
  v_existing jsonb;
  v_total int;
  now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  v_board := (
    select to_jsonb(b)
    from public.boards b
    where b.share_enabled = true
      and token <> ''
      and b.share_token = token
    limit 1
  );
  if v_board is null then
    raise exception '이 설문에 응답할 수 없습니다.';
  end if;
  v_board_id := v_board ->> 'id';

  v_survey := (
    select col -> 'survey'
    from jsonb_array_elements(coalesce(v_board -> 'data' -> 'columns', '[]'::jsonb)) col
    where col ->> 'id' = target_column
    limit 1
  );
  if v_survey is null
     or jsonb_typeof(v_survey -> 'questions') is distinct from 'array'
     or jsonb_array_length(v_survey -> 'questions') = 0 then
    raise exception '설문을 찾을 수 없습니다.';
  end if;
  if coalesce((v_survey ->> 'closed')::boolean, false) then
    raise exception '응답이 마감된 설문입니다.';
  end if;
  if response_id is null or length(response_id) = 0 or length(response_id) > 80 then
    raise exception '응답 ID가 올바르지 않습니다.';
  end if;
  if edit_key is null or length(edit_key) < 16 or length(edit_key) > 200 then
    raise exception '응답 열쇠가 올바르지 않습니다.';
  end if;
  if response_answers is null or jsonb_typeof(response_answers) <> 'object' then
    raise exception '응답이 올바르지 않습니다.';
  end if;

  for v_question in select q from jsonb_array_elements(v_survey -> 'questions') q loop
    v_value := response_answers -> (v_question ->> 'id');
    v_option_ids := array(
      select o ->> 'id' from jsonb_array_elements(coalesce(v_question -> 'options', '[]'::jsonb)) o
    );
    if v_question ->> 'type' = 'text' then
      if jsonb_typeof(v_value) = 'string' and length(btrim(v_value #>> '{}')) > 0 then
        v_clean := v_clean || jsonb_build_object(v_question ->> 'id', left(btrim(v_value #>> '{}'), 1000));
      end if;
    elsif v_question ->> 'type' = 'multiple' then
      if jsonb_typeof(v_value) = 'array' then
        v_picked := array(
          select distinct v from jsonb_array_elements_text(v_value) v where v = any(v_option_ids)
        );
        if coalesce(array_length(v_picked, 1), 0) > 0 then
          v_clean := v_clean || jsonb_build_object(v_question ->> 'id', to_jsonb(v_picked));
        end if;
      end if;
    else
      if jsonb_typeof(v_value) = 'string' and (v_value #>> '{}') = any(v_option_ids) then
        v_clean := v_clean || jsonb_build_object(v_question ->> 'id', v_value #>> '{}');
      end if;
    end if;
    if coalesce((v_question ->> 'required')::boolean, false) and not (v_clean ? (v_question ->> 'id')) then
      raise exception '꼭 답해야 하는 질문이 비어 있습니다: %', v_question ->> 'title';
    end if;
  end loop;

  if v_clean = '{}'::jsonb then
    raise exception '하나 이상 답해 주세요.';
  end if;

  v_hash := public.guest_edit_hash(edit_key);
  v_existing := (
    select to_jsonb(r) from public.survey_responses r where r.id = response_id
  );

  if v_existing is not null then
    if v_existing ->> 'key_hash' is distinct from v_hash
       or v_existing ->> 'board_id' is distinct from v_board_id
       or v_existing ->> 'column_id' is distinct from target_column then
      raise exception '이 응답을 고칠 수 없습니다.';
    end if;
    update public.survey_responses r
    set answers = v_clean, updated_at = now_ms
    where r.id = response_id;
  else
    -- 공개 쓰기 경로이므로 보드 하나의 응답이 끝없이 늘지 않도록 상한을 둡니다.
    v_total := (select count(*) from public.survey_responses r where r.board_id = v_board_id);
    if v_total >= 5000 then
      raise exception '이 보드에는 더 이상 응답을 받을 수 없습니다.';
    end if;
    insert into public.survey_responses (id, board_id, column_id, answers, key_hash, created_at, updated_at)
    values (response_id, v_board_id, target_column, v_clean, v_hash, now_ms, now_ms);
  end if;

  return jsonb_build_object('id', response_id, 'answers', v_clean, 'updatedAt', now_ms);
end;
$$;

grant execute on function public.submit_survey_response(text, text, text, jsonb, text) to anon, authenticated;

-- 확인용. survey_responses 표와 submit_survey_response 함수가 보이면 정상입니다.
select 'survey_responses' as 이름, count(*)::text as 응답수 from public.survey_responses
union all
select p.proname, pg_get_function_identity_arguments(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'submit_survey_response';
