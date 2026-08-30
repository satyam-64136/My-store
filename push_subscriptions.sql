-- Run this once in Supabase Dashboard → SQL Editor.
-- Stores the push subscription your phone creates when you log into
-- admin.html. One row per device/browser you've logged in from.

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text unique not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz default now()
);

alter table push_subscriptions enable row level security;

-- Only your admin account (the same email admin.html already checks)
-- may create, read, or delete subscription rows. Since this project has
-- exactly one admin, this stays intentionally simple.
create policy "admin can manage own subscriptions"
on push_subscriptions
for all
to authenticated
using (auth.jwt() ->> 'email' = 'satyam64136@gmail.com')
with check (auth.jwt() ->> 'email' = 'satyam64136@gmail.com');
