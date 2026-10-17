-- Synthetic integration tests. Run with an administrative connection AFTER schema.sql.
-- No real user, email, API key or audio. All fixtures are rolled back.
begin;
create temporary table voxen_test_fixture as
select gen_random_uuid() a,gen_random_uuid() b,gen_random_uuid() device,
 '{"schema":1,"preferences":{"Language":"fr","CleanupEnabled":true,"CleanupMode":1,"FirstName":"Test","RewriteModel":"openai/gpt-4.1-mini","TypingSpeed":45,"HistoryEnabled":true},"dictionary":[{"Id":1,"Term":"Voxen"}],"replacements":[],"styleProfiles":[],"transforms":[],"notes":[],"history":[],"scope":{"libraries":true,"notes":false,"history":false,"preferences":true}}'::jsonb state;
grant select on voxen_test_fixture to authenticated;
insert into auth.users(id) select a from voxen_test_fixture union all select b from voxen_test_fixture;
select set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated','is_anonymous',false)::text,true) from voxen_test_fixture;
set local role authenticated;
do $$
declare f record; r jsonb; i int; denied boolean; invalid jsonb; valid_note jsonb;
begin
 select * into f from voxen_test_fixture;
 if public.voxen_get_workspace()->>'revision'<>'0' then raise exception 'Absent workspace'; end if;
 r:=public.voxen_put_workspace(f.state,0,f.device);
 if r->'conflict'<>'false'::jsonb or r->>'revision'<>'1' then raise exception 'Initial CAS'; end if;
 r:=public.voxen_put_workspace(f.state,0,f.device);
 if r->'conflict'<>'true'::jsonb or r->>'revision'<>'1' then raise exception 'Stale CAS'; end if;
 if public.voxen_get_workspace()->'state'<>f.state then raise exception 'Owner read'; end if;
 for i in 1..25 loop
   r:=public.voxen_put_workspace(f.state,i,f.device);
   if r->'conflict'<>'false'::jsonb or (r->>'revision')::int<>i+1 then raise exception 'CAS sequence'; end if;
 end loop;
 if (select count(*) from public.voxen_workspace_versions)<>20 then raise exception 'Retention'; end if;
 if (select min(revision) from public.voxen_workspace_versions)<>7 then raise exception 'Retention recent'; end if;
 insert into public.voxen_profiles(user_id,display_name) values(f.a,'Alice');
 update public.voxen_devices set label='PC test' where user_id=f.a;
 if (select label from public.voxen_devices where user_id=f.a)<>'PC test' then raise exception 'Device edit'; end if;
 denied:=false;
 begin insert into public.voxen_profiles(user_id,display_name) values(f.b,'Forbidden'); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Cross insert allowed'; end if;
 denied:=false;
 begin update public.voxen_profiles set user_id=f.b where user_id=f.a; exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Ownership reassignment allowed'; end if;
 if public.voxen_valid_state(jsonb_set(f.state,'{preferences,DeepgramKey}','"forbidden"')) then raise exception 'Unknown preference accepted'; end if;
 if public.voxen_valid_state(jsonb_set(f.state,'{preferences,Language}','null')) then raise exception 'Null language accepted'; end if;
 if public.voxen_valid_state(jsonb_set(f.state,'{audio}','"forbidden"')) then raise exception 'Unknown top field accepted'; end if;
 if public.voxen_valid_state(jsonb_set(f.state,'{notes}','[{"Id":1,"Title":"Test","Body":"x","Pinned":0,"UpdatedAt":"2026-10-16T10:00:00Z","Revision":1}]')) then raise exception 'Disabled notes accepted'; end if;
 if public.voxen_valid_state(jsonb_set(f.state,'{dictionary}','[{"Id":1,"Term":"a"},{"Id":1,"Term":"b"}]')) then raise exception 'Duplicate IDs accepted'; end if;
 if public.voxen_valid_state(jsonb_set(f.state,'{dictionary}','[{"Id":1,"Term":"a","Secret":"x"}]')) then raise exception 'Unknown record field accepted'; end if;
 denied:=false;
 begin perform public.voxen_put_workspace(jsonb_set(f.state,'{schema}','2'),26,f.device); exception when invalid_parameter_value then denied:=true; end;
 if not denied then raise exception 'RPC accepted malformed state'; end if;
 if not public.voxen_valid_state(f.state) then raise exception 'Valid state rejected'; end if;
 valid_note:=jsonb_set(jsonb_set(f.state,'{scope,notes}','true'),'{notes}','[{"Id":1,"Title":"Test","Body":"x","Pinned":0,"UpdatedAt":"2026-10-16T10:00:00Z","Revision":1}]');
 if not public.voxen_valid_state(valid_note) then raise exception 'Valid note rejected'; end if;
 if public.voxen_valid_state(null) then raise exception 'SQL NULL accepted'; end if;
 -- 25 separate malformed snapshots: nulls, missing keys, types, ranges, limits.
 for invalid in select value from jsonb_array_elements(jsonb_build_array(
   'null'::jsonb,
   '{}'::jsonb,
   '[]'::jsonb,
   f.state-'scope',
   f.state-'notes',
   jsonb_set(f.state,'{scope}','null'),
   jsonb_set(f.state,'{scope,notes}','null'),
   jsonb_set(f.state,'{scope,notes}','"false"'),
   jsonb_set(f.state,'{scope}',(f.state->'scope')-'history'),
   jsonb_set(f.state,'{preferences}','null'),
   jsonb_set(f.state,'{preferences,FirstName}','null'),
   jsonb_set(f.state,'{preferences,Language}','42'),
   jsonb_set(f.state,'{preferences,TypingSpeed}','null'),
   jsonb_set(f.state,'{preferences,CleanupMode}','null'),
   jsonb_set(f.state,'{preferences,HistoryEnabled}','null'),
   jsonb_set(f.state,'{dictionary}','null'),
   jsonb_set(f.state,'{dictionary}','[null]'),
   jsonb_set(f.state,'{dictionary}','[{"Id":null,"Term":"x"}]'),
   jsonb_set(f.state,'{dictionary}','[{"Id":1}]'),
   jsonb_set(f.state,'{dictionary}','[{"Id":0,"Term":"x"}]'),
   jsonb_set(f.state,'{dictionary}','[{"Id":1.5,"Term":"x"}]'),
   jsonb_set(valid_note,'{notes,0,Pinned}','null'),
   jsonb_set(valid_note,'{notes,0,UpdatedAt}','"2026-99-99T10:00:00Z"'),
   jsonb_set(valid_note,'{notes,0,Body}',to_jsonb(repeat('x',200001))),
   jsonb_set(valid_note,'{notes,0,Body}',to_jsonb(repeat('x',8388609)))
 )) loop
   if public.voxen_valid_state(invalid) then raise exception 'Invalid JSON variant accepted'; end if;
 end loop;
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',b,'role','authenticated','is_anonymous',false)::text,true) from voxen_test_fixture;
set local role authenticated;
do $$
declare f record; r jsonb; n int;
begin
 select * into f from voxen_test_fixture;
 if exists(select 1 from public.voxen_workspaces) or exists(select 1 from public.voxen_profiles) or exists(select 1 from public.voxen_devices) or exists(select 1 from public.voxen_workspace_versions) then raise exception 'Cross-user read'; end if;
 update public.voxen_workspaces set revision=99 where user_id=f.a; get diagnostics n=row_count;
 if n<>0 then raise exception 'Cross-user update'; end if;
 delete from public.voxen_workspace_versions where user_id=f.a; get diagnostics n=row_count;
 if n<>0 then raise exception 'Cross-user delete'; end if;
 r:=public.voxen_put_workspace(f.state,0,f.device);
 if r->>'revision'<>'1' or r->'conflict'<>'false'::jsonb then raise exception 'Second user RPC'; end if;
 if (select count(*) from public.voxen_workspaces)<>1 then raise exception 'Second user isolation'; end if;
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated','is_anonymous',true)::text,true) from voxen_test_fixture;
set local role authenticated;
do $$
declare denied boolean:=false;
begin
 if exists(select 1 from public.voxen_workspaces) then raise exception 'Anonymous account read'; end if;
 begin perform public.voxen_get_workspace(); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Anonymous account RPC'; end if;
end $$;
reset role;
set local role anon;
do $$
declare denied boolean:=false;
begin
 begin perform public.voxen_get_workspace(); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Anon execute'; end if;
 denied:=false;
 begin perform 1 from public.voxen_workspaces; exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Anon table'; end if;
end $$;
reset role;
do $$
begin
 if has_function_privilege('anon','public.voxen_put_workspace(jsonb,bigint,uuid)','EXECUTE') or has_function_privilege('anon','public.voxen_valid_state(jsonb)','EXECUTE') then raise exception 'Anon function grants'; end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'voxen_%' and p.prosecdef) then raise exception 'Unexpected SECURITY DEFINER'; end if;
end $$;
select 'PASS: owner isolation, permanent sessions, strict snapshots, CAS, retention, grants' as result;
rollback;
