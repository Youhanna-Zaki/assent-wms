-- Run once in Supabase: SQL Editor > New query > paste > Run.

-- 1. Shared data: the four collections of the app (inventory, transactions, receipts, delivery notes)
create table if not exists public.kv_store (
  key         text primary key check (key in (
                'ASSENT_WMS_INVENTORY_DATA_V1',
                'ASSENT_WMS_TRANSACTIONS_V1',
                'ASSENT_WMS_RECEIPTS_V1',
                'ASSENT_WMS_DELIVERY_NOTES_V1')),
  value       jsonb,
  version     integer not null default 1,   -- used to refuse a save made from stale data
  updated_by  text,
  updated_at  timestamptz not null default now()
);

alter table public.kv_store enable row level security;

drop policy if exists "signed-in users read and write" on public.kv_store;
create policy "signed-in users read and write" on public.kv_store
  for all to authenticated using (true) with check (true);

-- live "another user changed the data" notice
alter publication supabase_realtime add table public.kv_store;

-- 2. Private file storage for the original scanned PDFs
insert into storage.buckets (id, name, public)
values ('scans', 'scans', false)
on conflict (id) do nothing;

drop policy if exists "signed-in users use scans" on storage.objects;
create policy "signed-in users use scans" on storage.objects
  for all to authenticated
  using (bucket_id = 'scans') with check (bucket_id = 'scans');
