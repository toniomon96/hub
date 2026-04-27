-- Consulting console operational slice.
-- Apply in Supabase before enabling the deployed full-stack console.

create extension if not exists "pgcrypto";

create table if not exists public.admin_todos (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 1 and 180),
  status text not null default 'open' check (status in ('open', 'done', 'archived')),
  priority text not null default 'normal' check (priority in ('normal', 'high')),
  week_of date not null,
  source text not null default 'console' check (char_length(trim(source)) between 1 and 80),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.outreach_events (
  id uuid primary key default gen_random_uuid(),
  happened_on date not null,
  name text not null check (char_length(trim(name)) between 1 and 160),
  channel text not null check (char_length(trim(channel)) between 1 and 80),
  ask text not null check (char_length(trim(ask)) between 1 and 240),
  status text not null default 'sent' check (status in ('sent', 'replied', 'declined', 'converted', 'stale')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.intake_submissions (
  id uuid primary key default gen_random_uuid(),
  submitted_at timestamptz not null default now(),
  name text not null check (char_length(trim(name)) between 1 and 160),
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  project text not null check (char_length(trim(project)) between 1 and 180),
  messy_context text not null check (char_length(trim(messy_context)) between 1 and 1400),
  already_tried text,
  thirty_day_target text not null check (char_length(trim(thirty_day_target)) between 1 and 1000),
  private_context text,
  source text not null default 'tonimontez.co',
  status text not null default 'new' check (status in ('new', 'reviewed', 'fit', 'not_fit', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists admin_todos_set_updated_at on public.admin_todos;
create trigger admin_todos_set_updated_at
before update on public.admin_todos
for each row execute function public.set_updated_at();

drop trigger if exists outreach_events_set_updated_at on public.outreach_events;
create trigger outreach_events_set_updated_at
before update on public.outreach_events
for each row execute function public.set_updated_at();

drop trigger if exists intake_submissions_set_updated_at on public.intake_submissions;
create trigger intake_submissions_set_updated_at
before update on public.intake_submissions
for each row execute function public.set_updated_at();

create index if not exists admin_todos_status_week_idx
  on public.admin_todos (status, week_of desc, created_at desc);

create index if not exists admin_todos_created_at_idx
  on public.admin_todos (created_at desc);

create index if not exists outreach_events_status_date_idx
  on public.outreach_events (status, happened_on desc, created_at desc);

create index if not exists outreach_events_happened_on_idx
  on public.outreach_events (happened_on desc);

create index if not exists intake_submissions_status_submitted_idx
  on public.intake_submissions (status, submitted_at desc);

alter table public.admin_todos enable row level security;
alter table public.outreach_events enable row level security;
alter table public.intake_submissions enable row level security;

comment on table public.admin_todos is
  'Private consulting console todo records. Access through Hub server-side functions only.';

comment on table public.outreach_events is
  'Private referral and outbound outreach log for Toni Montez Consulting.';

comment on table public.intake_submissions is
  'Public consulting intake submissions stored for private operator review.';
