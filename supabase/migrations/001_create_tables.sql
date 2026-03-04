-- Create extensions if not exists
create extension if not exists "uuid-ossp";

-- Users table
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  name text not null,
  email_verified boolean default false not null,
  theme text default 'Purple',
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Notes table
create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  title text not null,
  body text not null,
  category text not null check (category in ('time', 'mood', 'achievement', 'reflection')),
  unlock_at timestamp with time zone,
  unlock_mood text,
  is_locked boolean default true,
  is_read boolean default false,
  is_pinned boolean default false,
  email_sent boolean default false,
  deleted_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Create indexes for performance
create index if not exists idx_notes_user_id on public.notes(user_id);
create index if not exists idx_notes_category on public.notes(category);
create index if not exists idx_notes_unlock_at on public.notes(unlock_at);
create index if not exists idx_notes_email_sent on public.notes(email_sent);
create index if not exists idx_notes_email_ready on public.notes(category, email_sent, unlock_at)
  where category = 'time' and email_sent = false;
create index if not exists idx_users_email_verified on public.users(email_verified);

-- Create view for notes ready to send reminders
create or replace view public.notes_ready_for_reminder as
select 
  n.id,
  n.user_id,
  n.title,
  n.unlock_at,
  n.category,
  n.email_sent,
  u.id as user_id_alt,
  u.email,
  u.name,
  u.email_verified
from public.notes n
join public.users u on n.user_id = u.id
where 
  n.category = 'time'
  and n.email_sent = false
  and n.unlock_at <= now()
  and u.email_verified = true;

-- Enable RLS (Row Level Security)
alter table public.users enable row level security;
alter table public.notes enable row level security;

-- RLS Policies for users table
create policy "users_self_read" on public.users
  for select using (auth.uid() = id);

create policy "users_self_update" on public.users
  for update using (auth.uid() = id);

-- RLS Policies for notes table
create policy "notes_user_read" on public.notes
  for select using (auth.uid() = user_id);

create policy "notes_user_insert" on public.notes
  for insert with check (auth.uid() = user_id);

create policy "notes_user_update" on public.notes
  for update using (auth.uid() = user_id);

create policy "notes_user_delete" on public.notes
  for delete using (auth.uid() = user_id);

-- Grant permissions to service role (needed for edge functions)
grant all privileges on public.users to postgres;
grant all privileges on public.notes to postgres;
grant select on public.notes_ready_for_reminder to postgres;
