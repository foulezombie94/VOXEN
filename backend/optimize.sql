begin;
create index voxen_workspaces_device_idx on public.voxen_workspaces(user_id,updated_by);
alter policy voxen_profiles_owner on public.voxen_profiles using ((select auth.uid())=user_id and coalesce((select auth.jwt())->>'is_anonymous','false')='false') with check ((select auth.uid())=user_id and coalesce((select auth.jwt())->>'is_anonymous','false')='false');
alter policy voxen_devices_owner on public.voxen_devices using ((select auth.uid())=user_id and coalesce((select auth.jwt())->>'is_anonymous','false')='false') with check ((select auth.uid())=user_id and coalesce((select auth.jwt())->>'is_anonymous','false')='false');
alter policy voxen_workspaces_owner on public.voxen_workspaces using ((select auth.uid())=user_id and coalesce((select auth.jwt())->>'is_anonymous','false')='false') with check ((select auth.uid())=user_id and coalesce((select auth.jwt())->>'is_anonymous','false')='false');
alter policy voxen_versions_owner on public.voxen_workspace_versions using ((select auth.uid())=user_id and coalesce((select auth.jwt())->>'is_anonymous','false')='false') with check ((select auth.uid())=user_id and coalesce((select auth.jwt())->>'is_anonymous','false')='false');
commit;
