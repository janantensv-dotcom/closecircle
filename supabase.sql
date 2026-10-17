-- CHAT VERDE: esquema completo para una instalación NUEVA.
-- En Supabase: SQL Editor > New query > pega todo este archivo > Run.
-- Incluye perfiles, mensajes privados y de grupo, miembros de grupo y almacenamiento privado.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (char_length(username) between 3 and 24),
  created_at timestamptz not null default now()
);

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 60),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index if not exists group_members_user_idx on public.group_members(user_id, group_id);

create table if not exists public.messages (
  id bigint generated always as identity primary key,
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid references auth.users(id) on delete cascade,
  group_id uuid references public.groups(id) on delete cascade,
  body text,
  file_path text,
  file_name text,
  file_type text,
  created_at timestamptz not null default now(),
  constraint message_has_destination check (
    (group_id is not null and recipient_id is null) or
    (group_id is null and recipient_id is not null and sender_id <> recipient_id)
  ),
  constraint message_has_content check (
    (body is not null and char_length(body) between 1 and 4000) or file_path is not null
  ),
  constraint message_file_fields check (
    (file_path is null and file_name is null and file_type is null) or
    (file_path is not null and file_name is not null and file_type is not null)
  )
);
create index if not exists messages_dm_sender_recipient_created_idx on public.messages(sender_id, recipient_id, created_at) where group_id is null;
create index if not exists messages_dm_recipient_sender_created_idx on public.messages(recipient_id, sender_id, created_at) where group_id is null;
create index if not exists messages_group_created_idx on public.messages(group_id, created_at) where group_id is not null;

-- Crear perfil automáticamente al registrarse. Si el nombre ya existe, añade un sufijo corto.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare requested_name text; base_name text;
begin
  requested_name := coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1));
  requested_name := left(regexp_replace(requested_name, '[^[:alnum:] _.-]', '', 'g'), 24);
  if char_length(requested_name) < 3 then requested_name := 'user_' || left(replace(new.id::text, '-', ''), 8); end if;
  base_name := left(requested_name, 18);
  if exists (select 1 from public.profiles p where lower(p.username) = lower(requested_name)) then
    requested_name := base_name || '_' || left(replace(new.id::text, '-', ''), 5);
  end if;
  insert into public.profiles (id, username) values (new.id, requested_name) on conflict (id) do nothing;
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.messages enable row level security;

-- Función auxiliar SECURITY DEFINER para comprobar membresías sin recursión RLS.
create or replace function public.is_group_member(_group_id uuid, _user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.group_members gm where gm.group_id = _group_id and gm.user_id = _user_id);
$$;
revoke all on function public.is_group_member(uuid, uuid) from public;
grant execute on function public.is_group_member(uuid, uuid) to authenticated;

drop policy if exists "Signed-in users can view profiles" on public.profiles;
create policy "Signed-in users can view profiles" on public.profiles for select to authenticated using (true);
drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile" on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

drop policy if exists "Members can view their groups" on public.groups;
create policy "Members can view their groups" on public.groups for select to authenticated using (
  public.is_group_member(id, (select auth.uid()))
  or created_by = (select auth.uid())
);
drop policy if exists "Authenticated users can create groups as themselves" on public.groups;
create policy "Authenticated users can create groups as themselves" on public.groups for insert to authenticated with check (created_by = (select auth.uid()));

drop policy if exists "Members can view group memberships" on public.group_members;
create policy "Members can view group memberships" on public.group_members for select to authenticated using (
  user_id = (select auth.uid()) or public.is_group_member(group_id, (select auth.uid()))
);
drop policy if exists "Only creator can add group members" on public.group_members;
create policy "Only creator can add group members" on public.group_members for insert to authenticated with check (
  exists (select 1 from public.groups g where g.id = group_id and g.created_by = (select auth.uid()))
);

drop policy if exists "Participants can read messages" on public.messages;
create policy "Participants can read messages" on public.messages for select to authenticated using (
  (group_id is null and ((select auth.uid()) = sender_id or (select auth.uid()) = recipient_id))
  or (group_id is not null and public.is_group_member(messages.group_id, (select auth.uid())))
);
drop policy if exists "Users can send as themselves to valid conversations" on public.messages;
create policy "Users can send as themselves to valid conversations" on public.messages for insert to authenticated with check (
  sender_id = (select auth.uid()) and (
    (group_id is null and recipient_id is not null and sender_id <> recipient_id)
    or (group_id is not null and recipient_id is null and public.is_group_member(messages.group_id, (select auth.uid())))
  )
);

revoke all on public.profiles from anon;
revoke all on public.groups from anon;
revoke all on public.group_members from anon;
revoke all on public.messages from anon;
grant select, update on public.profiles to authenticated;
grant select, insert on public.groups to authenticated;
grant select, insert on public.group_members to authenticated;
grant select, insert on public.messages to authenticated;
grant usage, select on sequence public.messages_id_seq to authenticated;

-- Bucket privado de archivos con límite de 10 MB por archivo.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-files', 'chat-files', false, 10485760, null)
on conflict (id) do update set public = false, file_size_limit = 10485760, allowed_mime_types = null;

drop policy if exists "Chat participants can upload attachments" on storage.objects;
create policy "Chat participants can upload attachments" on storage.objects for insert to authenticated with check (
  bucket_id = 'chat-files' and (
    (storage.foldername(name))[1] like 'dm_%' and (select auth.uid())::text = any(string_to_array(substr((storage.foldername(name))[1], 4), '_'))
    or (storage.foldername(name))[1] like 'group_%' and public.is_group_member(substr((storage.foldername(name))[1], 7)::uuid, (select auth.uid()))
  )
);
drop policy if exists "Chat participants can read attachments" on storage.objects;
create policy "Chat participants can read attachments" on storage.objects for select to authenticated using (
  bucket_id = 'chat-files' and (
    ((storage.foldername(name))[1] like 'dm_%' and (select auth.uid())::text = any(string_to_array(substr((storage.foldername(name))[1], 4), '_')))
    or ((storage.foldername(name))[1] like 'group_%' and public.is_group_member(substr((storage.foldername(name))[1], 7)::uuid, (select auth.uid())))
  )
);

-- Activar realtime para los mensajes nuevos.
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages') then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;
