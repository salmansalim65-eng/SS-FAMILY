-- Attachments on tasks. Files live in the private Storage bucket
-- "task-files" at <task id>/<random>-<file name>; task_attachments keeps one
-- row per file. Whoever can see the task can see and add its files; a file
-- is removed by whoever added it or a workspace owner/admin.

insert into storage.buckets (id, name, public, file_size_limit)
values ('task-files', 'task-files', false, 26214400)  -- 25 MB a file
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

create or replace function public.try_uuid(p text)
returns uuid language plpgsql immutable as $$
begin
  return p::uuid;
exception when others then
  return null;
end;
$$;

create table if not exists public.task_attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  name text not null check (length(name) between 1 and 255),
  path text not null unique,
  size bigint,
  mime text,
  uploaded_by uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists task_attachments_task on public.task_attachments (task_id);
alter table public.task_attachments enable row level security;

create or replace function public.can_remove_attachment(p_task uuid, p_uploader uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_see_task(p_task)
     and (p_uploader = auth.uid()
          or public.is_ws_admin((select p.workspace_id from public.tasks t join public.projects p on p.id = t.project_id where t.id = p_task)));
$$;
revoke all on function public.can_remove_attachment(uuid, uuid) from public, anon;
grant execute on function public.can_remove_attachment(uuid, uuid) to authenticated;

drop policy if exists "see attachments" on public.task_attachments;
create policy "see attachments" on public.task_attachments for select to authenticated
  using (public.can_see_task(task_id));
drop policy if exists "add attachments" on public.task_attachments;
create policy "add attachments" on public.task_attachments for insert to authenticated
  with check (public.can_see_task(task_id) and uploaded_by = auth.uid() and path like task_id::text || '/%');
drop policy if exists "remove attachments" on public.task_attachments;
create policy "remove attachments" on public.task_attachments for delete to authenticated
  using (public.can_remove_attachment(task_id, uploaded_by));
grant select, insert, delete on public.task_attachments to authenticated;

-- The files themselves.
drop policy if exists "task files: read" on storage.objects;
create policy "task files: read" on storage.objects for select to authenticated
  using (bucket_id = 'task-files' and public.can_see_task(public.try_uuid((storage.foldername(name))[1])));
drop policy if exists "task files: upload" on storage.objects;
create policy "task files: upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'task-files' and public.can_see_task(public.try_uuid((storage.foldername(name))[1])));
drop policy if exists "task files: remove" on storage.objects;
create policy "task files: remove" on storage.objects for delete to authenticated
  using (bucket_id = 'task-files'
         and public.can_remove_attachment(public.try_uuid((storage.foldername(name))[1]), public.try_uuid(owner_id)));

-- The task panel (dashboard / ERPs) lists the files too.
create or replace function public.task_hub_detail(p_task uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  t public.tasks;
  v_ws uuid;
begin
  if not public.can_see_task(p_task) then raise exception 'Task not found.'; end if;
  select * into t from public.tasks where id = p_task;
  select workspace_id into v_ws from public.projects where id = t.project_id;
  return jsonb_build_object(
    'id', t.id, 'title', t.title, 'notes', coalesce(t.notes, ''), 'start', t.start_date, 'due', t.due_date,
    'priority', t.priority, 'done', t.done, 'project_id', t.project_id, 'bucket_id', t.bucket_id,
    'buckets', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name) order by b.position)
                           from public.buckets b where b.project_id = t.project_id), '[]'::jsonb),
    'people', public.erp_project_people(t.project_id),
    'assignee_ids', coalesce((select jsonb_agg(a.user_id) from public.task_assignees a where a.task_id = t.id), '[]'::jsonb),
    'checklist', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title, 'done', c.done) order by c.position, c.id)
                             from public.checklist_items c where c.task_id = t.id), '[]'::jsonb),
    'comments', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'body', m.body, 'created_at', m.created_at, 'mine', m.user_id = v_me,
                                                              'name', coalesce(nullif(pr.full_name, ''), pr.email, 'Someone')) order by m.created_at)
                            from public.comments m left join public.profiles pr on pr.id = m.user_id where m.task_id = t.id), '[]'::jsonb),
    'attachments', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'size', f.size, 'created_at', f.created_at) order by f.created_at)
                               from public.task_attachments f where f.task_id = t.id), '[]'::jsonb),
    'can_delete', t.created_by = v_me or public.is_ws_admin(v_ws)
  );
end;
$$;
revoke all on function public.task_hub_detail(uuid) from public, anon, authenticated;
