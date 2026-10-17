-- Voxen cloud v1. No provider keys, passwords, audio, or machine settings.
-- Prepared 2026-10-16. Run as one transaction after reviewing the project.
begin;

create function public.voxen_valid_state(s jsonb) returns boolean
language plpgsql immutable security invoker set search_path = pg_catalog
as $$
declare k text; collection text; item jsonb; field text; spec jsonb;
  collections jsonb := '{"dictionary":{"Id":"id","Term":80},"replacements":{"Id":"id","Heard":200,"ReplaceWith":2000},"styleProfiles":{"Id":"id","Application":80,"CleanupMode":"mode","Tone":20},"transforms":{"Id":"id","Name":60,"Instruction":3000},"notes":{"Id":"id","Title":120,"Body":200000,"Pinned":"flag","UpdatedAt":50,"Revision":"id"},"history":{"Id":"id","CreatedAt":50,"Application":160,"RawText":200000,"FinalText":200000,"WordCount":"count","DurationSeconds":"duration","Corrections":"count","Favorite":"flag"}}';
begin
  if s is null or jsonb_typeof(s) <> 'object' or octet_length(s::text) > 8388608 then return false; end if;
  if s->'schema' is distinct from '1'::jsonb or not (s ?& array['preferences','dictionary','replacements','styleProfiles','transforms','notes','history','scope']) then return false; end if;
  if exists (select 1 from jsonb_object_keys(s) x where x not in ('schema','preferences','dictionary','replacements','styleProfiles','transforms','notes','history','scope')) then return false; end if;
  if jsonb_typeof(s->'preferences') <> 'object' or jsonb_typeof(s->'scope') <> 'object' then return false; end if;
  if not ((s->'scope') ?& array['libraries','notes','history','preferences']) then return false; end if;
  for k in select jsonb_object_keys(s->'scope') loop
    if k not in ('libraries','notes','history','preferences') or jsonb_typeof(s->'scope'->k) <> 'boolean' then return false; end if;
  end loop;
  for k in select jsonb_object_keys(s->'preferences') loop
    if k not in ('FirstName','Language','CleanupEnabled','CleanupMode','RewriteModel','TypingSpeed','HistoryEnabled') then return false; end if;
    case k
      when 'FirstName' then if jsonb_typeof(s->'preferences'->k)<>'string' or length(s->'preferences'->>k)>60 then return false; end if;
      when 'Language' then if jsonb_typeof(s->'preferences'->k)<>'string' or (s->'preferences'->>k) not in ('fr','en','de','es','it') then return false; end if;
      when 'RewriteModel' then if jsonb_typeof(s->'preferences'->k)<>'string' or length(s->'preferences'->>k) not between 1 and 150 then return false; end if;
      when 'CleanupMode' then if (s->'preferences'->k) not in ('0'::jsonb,'1'::jsonb,'2'::jsonb) then return false; end if;
      when 'TypingSpeed' then if jsonb_typeof(s->'preferences'->k)<>'number' then return false; end if; if (s->'preferences'->>k)::numeric not between 5 and 250 then return false; end if;
      else if jsonb_typeof(s->'preferences'->k)<>'boolean' then return false; end if;
    end case;
  end loop;
  if s->'scope'->'preferences'='false'::jsonb and s->'preferences'<>'{}'::jsonb then return false; end if;
  for collection in select jsonb_object_keys(collections) loop
    if jsonb_typeof(s->collection) <> 'array' then return false; end if;
    if jsonb_array_length(s->collection) > (case collection when 'dictionary' then 3000 when 'replacements' then 1000 when 'styleProfiles' then 200 when 'transforms' then 200 when 'notes' then 500 else 2000 end) then return false; end if;
    if (collection in ('dictionary','replacements','styleProfiles','transforms') and s->'scope'->'libraries'='false'::jsonb or collection='notes' and s->'scope'->'notes'='false'::jsonb or collection='history' and s->'scope'->'history'='false'::jsonb) and jsonb_array_length(s->collection)>0 then return false; end if;
    for item in select value from jsonb_array_elements(s->collection) loop
      if jsonb_typeof(item)<>'object' then return false; end if;
      -- Favorite is optional for compatibility with older local histories.
      for field in select jsonb_object_keys(collections->collection) loop
        if not (item ? field) and not (collection='history' and field='Favorite') then return false; end if;
      end loop;
      for field in select jsonb_object_keys(item) loop
        if not ((collections->collection) ? field) then return false; end if;
        spec:=collections->collection->field;
        if jsonb_typeof(spec)='number' then
          if jsonb_typeof(item->field)<>'string' or length(item->>field) > (spec::text)::int then return false; end if;
        elsif spec='"id"'::jsonb then
          if jsonb_typeof(item->field)<>'number' then return false; end if;
          if (item->>field)::numeric not between 1 and 9007199254740991 or trunc((item->>field)::numeric)<>(item->>field)::numeric then return false; end if;
        elsif spec='"mode"'::jsonb then
          if (item->field) not in ('0'::jsonb,'1'::jsonb,'2'::jsonb) then return false; end if;
        elsif spec='"flag"'::jsonb then
          if (item->field) not in ('0'::jsonb,'1'::jsonb) then return false; end if;
        else
          if jsonb_typeof(item->field)<>'number' then return false; end if;
          if (item->>field)::numeric not between 0 and 9007199254740991 then return false; end if;
          if spec='"count"'::jsonb and trunc((item->>field)::numeric)<>(item->>field)::numeric then return false; end if;
        end if;
      end loop;
      if collection='styleProfiles' and item->>'Tone' not in ('natural','professional','casual') then return false; end if;
      if collection='dictionary' and length(btrim(item->>'Term'))=0 then return false; end if;
      if collection='replacements' and (length(btrim(item->>'Heard'))=0 or length(btrim(item->>'ReplaceWith'))=0) then return false; end if;
      if collection='transforms' and (length(btrim(item->>'Name'))=0 or length(btrim(item->>'Instruction'))=0) then return false; end if;
      if collection='notes' and (item->>'UpdatedAt') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$' then return false; end if;
      if collection='history' and (item->>'CreatedAt') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$' then return false; end if;
      if collection='notes' then perform (item->>'UpdatedAt')::timestamptz; end if;
      if collection='history' then perform (item->>'CreatedAt')::timestamptz; end if;
    end loop;
    if exists (select 1 from jsonb_array_elements(s->collection) a group by a->>'Id' having count(*)>1) then return false; end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(s->'dictionary') a group by lower(a->>'Term') having count(*)>1) or exists(select 1 from jsonb_array_elements(s->'replacements') a group by lower(a->>'Heard') having count(*)>1) or exists(select 1 from jsonb_array_elements(s->'styleProfiles') a group by lower(a->>'Application') having count(*)>1) then return false; end if;
  return true;
exception when others then return false;
end;
$$;
revoke all on function public.voxen_valid_state(jsonb) from public,anon,authenticated;
grant execute on function public.voxen_valid_state(jsonb) to authenticated;

create table public.voxen_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check(length(display_name)<=60),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.voxen_devices (
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null,
  label text not null default 'Ordinateur' check(length(label) between 1 and 80),
  app_version text not null default '' check(length(app_version)<=40),
  last_seen timestamptz not null default now(),
  primary key(user_id,device_id)
);
create table public.voxen_workspaces (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null check(revision between 1 and 9007199254740991),
  state jsonb not null check(public.voxen_valid_state(state)),
  updated_at timestamptz not null default now(), updated_by uuid not null,
  foreign key(user_id,updated_by) references public.voxen_devices(user_id,device_id)
);
create table public.voxen_workspace_versions (
  user_id uuid not null references auth.users(id) on delete cascade,
  revision bigint not null check(revision between 1 and 9007199254740991),
  state jsonb not null check(public.voxen_valid_state(state)),
  created_at timestamptz not null default now(),
  primary key(user_id,revision)
);

alter table public.voxen_profiles enable row level security;
alter table public.voxen_devices enable row level security;
alter table public.voxen_workspaces enable row level security;
alter table public.voxen_workspace_versions enable row level security;
create policy voxen_profiles_owner on public.voxen_profiles for all to authenticated using ((select auth.uid())=user_id and coalesce((select auth.jwt()->>'is_anonymous'),'false')='false') with check ((select auth.uid())=user_id and coalesce((select auth.jwt()->>'is_anonymous'),'false')='false');
create policy voxen_devices_owner on public.voxen_devices for all to authenticated using ((select auth.uid())=user_id and coalesce((select auth.jwt()->>'is_anonymous'),'false')='false') with check ((select auth.uid())=user_id and coalesce((select auth.jwt()->>'is_anonymous'),'false')='false');
create policy voxen_workspaces_owner on public.voxen_workspaces for all to authenticated using ((select auth.uid())=user_id and coalesce((select auth.jwt()->>'is_anonymous'),'false')='false') with check ((select auth.uid())=user_id and coalesce((select auth.jwt()->>'is_anonymous'),'false')='false');
create policy voxen_versions_owner on public.voxen_workspace_versions for all to authenticated using ((select auth.uid())=user_id and coalesce((select auth.jwt()->>'is_anonymous'),'false')='false') with check ((select auth.uid())=user_id and coalesce((select auth.jwt()->>'is_anonymous'),'false')='false');
revoke all on public.voxen_profiles,public.voxen_devices,public.voxen_workspaces,public.voxen_workspace_versions from public,anon,authenticated;
grant select,insert,update on public.voxen_profiles,public.voxen_devices,public.voxen_workspaces to authenticated;
grant select,insert,delete on public.voxen_workspace_versions to authenticated;

create function public.voxen_get_workspace() returns jsonb
language plpgsql stable security invoker set search_path=pg_catalog
as $$
declare result jsonb;
begin
  if auth.uid() is null or coalesce(auth.jwt()->>'is_anonymous','false')<>'false' then raise exception 'Connexion permanente requise' using errcode='42501'; end if;
  select jsonb_build_object('revision',revision,'state',state,'updated_at',updated_at) into result from public.voxen_workspaces where user_id=(select auth.uid());
  return coalesce(result,jsonb_build_object('revision',0,'state',null,'updated_at',null));
end;
$$;

create function public.voxen_put_workspace(p_state jsonb,p_expected_revision bigint,p_device_id uuid) returns jsonb
language plpgsql volatile security invoker set search_path=pg_catalog
as $$
declare uid uuid:=auth.uid(); current_row public.voxen_workspaces%rowtype; new_revision bigint; stamp timestamptz;
begin
  if uid is null or coalesce(auth.jwt()->>'is_anonymous','false')<>'false' then raise exception 'Connexion permanente requise' using errcode='42501'; end if;
  if p_expected_revision is null or p_expected_revision not between 0 and 9007199254740990 or p_device_id is null or not public.voxen_valid_state(p_state) then raise exception 'Snapshot ou révision invalide' using errcode='22023'; end if;
  -- Per-user transaction lock also covers the absent-row / first-upload case.
  -- Hash collision only serializes unrelated users; it cannot disclose their data.
  perform pg_advisory_xact_lock(hashtextextended('voxen:'||uid::text,0));
  select * into current_row from public.voxen_workspaces where user_id=uid for update;
  if coalesce(current_row.revision,0)<>p_expected_revision then
    return jsonb_build_object('conflict',true,'revision',coalesce(current_row.revision,0),'updated_at',current_row.updated_at);
  end if;
  new_revision:=p_expected_revision+1; stamp:=clock_timestamp();
  insert into public.voxen_devices(user_id,device_id,last_seen) values(uid,p_device_id,stamp)
    on conflict(user_id,device_id) do update set last_seen=excluded.last_seen;
  insert into public.voxen_workspaces(user_id,revision,state,updated_at,updated_by) values(uid,new_revision,p_state,stamp,p_device_id)
    on conflict(user_id) do update set revision=excluded.revision,state=excluded.state,updated_at=excluded.updated_at,updated_by=excluded.updated_by;
  insert into public.voxen_workspace_versions(user_id,revision,state,created_at) values(uid,new_revision,p_state,stamp);
  delete from public.voxen_workspace_versions where user_id=uid and revision not in
    (select revision from public.voxen_workspace_versions where user_id=uid order by revision desc limit 20);
  return jsonb_build_object('conflict',false,'revision',new_revision,'updated_at',stamp);
end;
$$;
revoke all on function public.voxen_get_workspace(), public.voxen_put_workspace(jsonb,bigint,uuid) from public,anon,authenticated;
grant execute on function public.voxen_get_workspace(), public.voxen_put_workspace(jsonb,bigint,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
