-- Ustoz Shifu: Weekly Payment sozlamalari jadvali (bir marta ishga tushiring)
create table if not exists public.wp_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,                    -- wm_id | adj | manual
  k text not null,                       -- ism kaliti yoki unit raqami
  week text not null default '',         -- masalan 2026-42 (wm_id uchun bo'sh)
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now(),
  unique (user_id, kind, k, week)
);
alter table public.wp_settings enable row level security;
create policy "wp own rows" on public.wp_settings for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
