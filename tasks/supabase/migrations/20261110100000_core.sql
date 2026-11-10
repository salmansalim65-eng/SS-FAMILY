-- SS Tasks: workspaces (companies), members and guests, projects, board
-- buckets, tasks with assignees / checklist / comments, and in-app
-- notifications. Every table is behind Row Level Security:
--   * workspace owners / admins / members see every project of the workspace;
--   * guests see only the projects they were added to;
--   * people outside a workspace see nothing of it.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null default '',
  color text not null default '#6366f1',
  created_at timestamptz not null default now()
);

-- Accounts are made only through an invite: a sign-up whose email has no
-- open invitation is refused, so the app isn't open to anyone on the internet.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.invitations
    where email = lower(new.email) and accepted_at is null and expires_at > now()
  ) then
    raise exception 'Sign-up needs an invitation.';
  end if;
  insert into public.profiles (id, email, full_name)
  values (new.id, lower(new.email), coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Workspaces and membership
-- ---------------------------------------------------------------------------
create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 80),
  color text not null default '#4f46e5',
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now()
);

create type public.member_role as enum ('owner', 'admin', 'member', 'guest');

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.member_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index on public.workspace_members (user_id);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  description text not null default '',
  color text not null default '#0ea5e9',
  archived boolean not null default false,
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now()
);
create index on public.projects (workspace_id);

-- Guests are added to individual projects; members may be too (for "people on this project").
create table public.project_members (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index on public.project_members (user_id);

-- Invite links: anyone with the link and the right email may join.
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  token text not null unique default encode(gen_random_bytes(18), 'hex'),
  workspace_id uuid references public.workspaces (id) on delete cascade,
  project_id uuid references public.projects (id) on delete cascade,
  email text not null check (email = lower(email)),
  role public.member_role not null default 'member',
  invited_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  check (role <> 'guest' or project_id is not null)
);

-- ---------------------------------------------------------------------------
-- Access helpers (security definer, so RLS policies can use them without recursion)
-- ---------------------------------------------------------------------------
create or replace function public.ws_role(p_ws uuid)
returns public.member_role language sql stable security definer set search_path = public as $$
  select role from public.workspace_members where workspace_id = p_ws and user_id = auth.uid();
$$;

create or replace function public.is_ws_admin(p_ws uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.ws_role(p_ws) in ('owner', 'admin'), false);
$$;

create or replace function public.can_see_project(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.projects p
    join public.workspace_members m on m.workspace_id = p.workspace_id and m.user_id = auth.uid()
    where p.id = p_project
      and (m.role <> 'guest' or exists (select 1 from public.project_members pm where pm.project_id = p.id and pm.user_id = auth.uid()))
  );
$$;

-- Whether the caller was added to a project (how guests see it).
create or replace function public.is_project_member(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.project_members where project_id = p_project and user_id = auth.uid());
$$;

-- Two people can see each other when they share a workspace.
create or replace function public.shares_workspace(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_user = auth.uid() or exists (
    select 1 from public.workspace_members a join public.workspace_members b on a.workspace_id = b.workspace_id
    where a.user_id = auth.uid() and b.user_id = p_user
  );
$$;

-- ---------------------------------------------------------------------------
-- Board, tasks, checklist, comments
-- ---------------------------------------------------------------------------
create table public.buckets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 60),
  position double precision not null default 0
);
create index on public.buckets (project_id);

create type public.task_priority as enum ('urgent', 'important', 'medium', 'low');

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  bucket_id uuid references public.buckets (id) on delete set null,
  title text not null check (length(trim(title)) between 1 and 300),
  notes text not null default '',
  priority public.task_priority,
  start_date date,
  due_date date,
  done boolean not null default false,
  done_at timestamptz,
  position double precision not null default 0,
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.tasks (project_id);
create index on public.tasks (due_date) where not done;

create or replace function public.can_see_task(p_task uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_see_project((select project_id from public.tasks where id = p_task));
$$;

create table public.task_assignees (
  task_id uuid not null references public.tasks (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  assigned_by uuid default auth.uid() references public.profiles (id),
  assigned_at timestamptz not null default now(),
  primary key (task_id, user_id)
);
create index on public.task_assignees (user_id);

create table public.checklist_items (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 300),
  done boolean not null default false,
  position double precision not null default 0
);
create index on public.checklist_items (task_id);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id),
  body text not null check (length(trim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index on public.comments (task_id);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null default '',
  project_id uuid references public.projects (id) on delete cascade,
  task_id uuid references public.tasks (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.notifications (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Triggers: bookkeeping and notifications
-- ---------------------------------------------------------------------------
create or replace function public.touch_task()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if new.done and not coalesce(old.done, false) then new.done_at := now(); end if;
  if not new.done then new.done_at := null; end if;
  return new;
end;
$$;
create trigger tasks_touch before update on public.tasks for each row execute function public.touch_task();

-- A new project gets the three standard columns.
create or replace function public.project_default_buckets()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.buckets (project_id, name, position)
  values (new.id, 'To do', 1), (new.id, 'In progress', 2), (new.id, 'Done', 3);
  return new;
end;
$$;
create trigger projects_buckets after insert on public.projects for each row execute function public.project_default_buckets();

-- Whoever makes a workspace owns it.
create or replace function public.workspace_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.workspace_members (workspace_id, user_id, role) values (new.id, new.created_by, 'owner')
  on conflict do nothing;
  return new;
end;
$$;
create trigger workspaces_owner after insert on public.workspaces for each row execute function public.workspace_owner();

create or replace function public.notify_assignee()
returns trigger language plpgsql security definer set search_path = public as $$
declare t public.tasks;
begin
  if new.user_id = auth.uid() then return new; end if;
  select * into t from public.tasks where id = new.task_id;
  insert into public.notifications (user_id, kind, title, body, project_id, task_id, actor_id)
  values (new.user_id, 'assigned',
          coalesce((select full_name from public.profiles where id = auth.uid()), 'Someone') || ' assigned you a task',
          t.title, t.project_id, t.id, auth.uid());
  return new;
end;
$$;
create trigger task_assignees_notify after insert on public.task_assignees for each row execute function public.notify_assignee();

create or replace function public.notify_comment()
returns trigger language plpgsql security definer set search_path = public as $$
declare t public.tasks;
begin
  select * into t from public.tasks where id = new.task_id;
  insert into public.notifications (user_id, kind, title, body, project_id, task_id, actor_id)
  select distinct u, 'comment',
         coalesce((select full_name from public.profiles where id = new.user_id), 'Someone') || ' commented on "' || left(t.title, 80) || '"',
         left(new.body, 200), t.project_id, t.id, new.user_id
  from (select user_id as u from public.task_assignees where task_id = t.id union select t.created_by) x
  where u <> new.user_id;
  return new;
end;
$$;
create trigger comments_notify after insert on public.comments for each row execute function public.notify_comment();

-- ---------------------------------------------------------------------------
-- Joining by invite link (called by the signed-in invitee)
-- ---------------------------------------------------------------------------
-- What an invite link is for, shown before signing in (no secrets in it).
create or replace function public.get_invitation(p_token text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'email', i.email,
    'role', i.role,
    'workspace', w.name,
    'project', p.name,
    'invited_by', (select full_name from public.profiles where id = i.invited_by),
    'valid', i.accepted_at is null and i.expires_at > now(),
    'has_account', exists (select 1 from public.profiles where email = i.email)
  )
  from public.invitations i
  left join public.projects p on p.id = i.project_id
  left join public.workspaces w on w.id = coalesce(i.workspace_id, p.workspace_id)
  where i.token = p_token;
$$;

-- Makes a workspace (company) owned by the caller; returns its id.
create or replace function public.create_workspace(p_name text, p_color text default '#4f46e5')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  insert into public.workspaces (name, color, created_by) values (trim(p_name), coalesce(p_color, '#4f46e5'), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.accept_invitation(p_token text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  inv public.invitations;
  my_email text := (select email from public.profiles where id = auth.uid());
  v_ws uuid;
begin
  select * into inv from public.invitations where token = p_token for update;
  if not found or inv.accepted_at is not null or inv.expires_at < now() then
    raise exception 'This invite link is not valid any more.';
  end if;
  if inv.email <> my_email then
    raise exception 'This invite is for %, not for you.', inv.email;
  end if;
  -- A guest invite names only the project; its workspace comes with it.
  v_ws := coalesce(inv.workspace_id, (select workspace_id from public.projects where id = inv.project_id));
  if v_ws is not null then
    insert into public.workspace_members (workspace_id, user_id, role) values (v_ws, auth.uid(), inv.role)
    on conflict (workspace_id, user_id) do update
      set role = case when public.workspace_members.role = 'guest' and excluded.role <> 'guest' then excluded.role else public.workspace_members.role end;
  end if;
  if inv.project_id is not null then
    insert into public.project_members (project_id, user_id) values (inv.project_id, auth.uid()) on conflict do nothing;
  end if;
  update public.invitations set accepted_at = now() where id = inv.id;
  return v_ws;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.invitations enable row level security;
alter table public.buckets enable row level security;
alter table public.tasks enable row level security;
alter table public.task_assignees enable row level security;
alter table public.checklist_items enable row level security;
alter table public.comments enable row level security;
alter table public.notifications enable row level security;

create policy "see people I work with" on public.profiles for select to authenticated using (public.shares_workspace(id));
create policy "edit my profile" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "see my workspaces" on public.workspaces for select to authenticated using (public.ws_role(id) is not null);
create policy "anyone signed in can make a workspace" on public.workspaces for insert to authenticated with check (created_by = auth.uid());
create policy "admins edit workspace" on public.workspaces for update to authenticated using (public.is_ws_admin(id));
create policy "owner deletes workspace" on public.workspaces for delete to authenticated using (public.ws_role(id) = 'owner');

create policy "see fellow members" on public.workspace_members for select to authenticated using (public.ws_role(workspace_id) is not null);
create policy "admins manage members" on public.workspace_members for all to authenticated
  using (public.is_ws_admin(workspace_id) and role <> 'owner')
  with check (public.is_ws_admin(workspace_id) and role <> 'owner');
create policy "leave a workspace" on public.workspace_members for delete to authenticated using (user_id = auth.uid() and role <> 'owner');

-- The row itself decides (not can_see_project), so INSERT ... RETURNING sees the project it just made.
create policy "see visible projects" on public.projects for select to authenticated
  using (public.ws_role(workspace_id) in ('owner', 'admin', 'member')
         or (public.ws_role(workspace_id) = 'guest' and public.is_project_member(id)));
create policy "members make projects" on public.projects for insert to authenticated
  with check (public.ws_role(workspace_id) in ('owner', 'admin', 'member') and created_by = auth.uid());
create policy "members edit projects" on public.projects for update to authenticated using (public.ws_role(workspace_id) in ('owner', 'admin', 'member'));
create policy "admins delete projects" on public.projects for delete to authenticated using (public.is_ws_admin(workspace_id) or created_by = auth.uid());

create policy "see project people" on public.project_members for select to authenticated using (public.can_see_project(project_id));
create policy "members manage project people" on public.project_members for all to authenticated
  using (public.ws_role((select workspace_id from public.projects where id = project_id)) in ('owner', 'admin', 'member'))
  with check (public.ws_role((select workspace_id from public.projects where id = project_id)) in ('owner', 'admin', 'member'));

create policy "admins see invites" on public.invitations for select to authenticated
  using (public.is_ws_admin(coalesce(workspace_id, (select workspace_id from public.projects where id = project_id))) or invited_by = auth.uid());
create policy "members invite" on public.invitations for insert to authenticated
  with check (
    invited_by = auth.uid() and (
      (role = 'guest' and public.ws_role((select workspace_id from public.projects where id = project_id)) in ('owner', 'admin', 'member'))
      or (role in ('admin', 'member') and public.is_ws_admin(workspace_id))
    )
  );
create policy "cancel invites" on public.invitations for delete to authenticated
  using (invited_by = auth.uid() or public.is_ws_admin(workspace_id));

create policy "see buckets" on public.buckets for select to authenticated using (public.can_see_project(project_id));
create policy "edit buckets" on public.buckets for all to authenticated using (public.can_see_project(project_id)) with check (public.can_see_project(project_id));

create policy "see tasks" on public.tasks for select to authenticated using (public.can_see_project(project_id));
create policy "add tasks" on public.tasks for insert to authenticated with check (public.can_see_project(project_id) and created_by = auth.uid());
create policy "edit tasks" on public.tasks for update to authenticated using (public.can_see_project(project_id)) with check (public.can_see_project(project_id));
create policy "delete tasks" on public.tasks for delete to authenticated
  using (created_by = auth.uid() or public.ws_role((select workspace_id from public.projects where id = project_id)) in ('owner', 'admin', 'member'));

create policy "see assignees" on public.task_assignees for select to authenticated using (public.can_see_task(task_id));
create policy "assign" on public.task_assignees for all to authenticated using (public.can_see_task(task_id)) with check (public.can_see_task(task_id));

create policy "see checklist" on public.checklist_items for select to authenticated using (public.can_see_task(task_id));
create policy "edit checklist" on public.checklist_items for all to authenticated using (public.can_see_task(task_id)) with check (public.can_see_task(task_id));

create policy "see comments" on public.comments for select to authenticated using (public.can_see_task(task_id));
create policy "comment" on public.comments for insert to authenticated with check (public.can_see_task(task_id) and user_id = auth.uid());
create policy "delete my comment" on public.comments for delete to authenticated using (user_id = auth.uid());

create policy "my notifications" on public.notifications for select to authenticated using (user_id = auth.uid());
create policy "read my notifications" on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "clear my notifications" on public.notifications for delete to authenticated using (user_id = auth.uid());

revoke all on all tables in schema public from anon;
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke execute on function public.accept_invitation(text) from anon, public;
grant execute on function public.accept_invitation(text) to authenticated;
revoke execute on function public.create_workspace(text, text) from anon, public;
grant execute on function public.create_workspace(text, text) to authenticated;
grant execute on function public.get_invitation(text) to anon, authenticated;

-- Live updates for the board and the bell.
alter publication supabase_realtime add table public.tasks, public.task_assignees, public.checklist_items, public.comments, public.notifications;
