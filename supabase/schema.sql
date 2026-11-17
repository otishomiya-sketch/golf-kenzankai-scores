-- ゴルフ研鑽会 成績表：Supabase のテーブル定義
-- Supabase の「SQL Editor」に全文を貼り付けて1回実行する（何度実行しても壊れない）。
-- 読み取り：ログインした人だけ（会員は共通の閲覧用アカウント、管理者は個人のアカウント）
-- 書き込み：admins テーブルに登録された管理者だけ

create table if not exists public.players (
  id          text primary key,                         -- 例：P001
  number      text not null default '',                 -- 例：1、J3
  name        text not null,
  category    text not null check (category in ('一般', 'J', '女子')),
  non_member  boolean not null default false,           -- 未入会・他クラブ（氏名の前に「*」）
  updated_at  timestamptz not null default now()
);

create table if not exists public.events (
  id          text primary key,                         -- 例：E001
  round_no    integer,                                  -- 回番号（空欄あり）
  date        date not null,
  label       text not null,                            -- 表示名（例：9/6①）
  kind        text not null default '通常' check (kind in ('通常', 'CT', '納会')),
  cancelled   boolean not null default false,
  updated_at  timestamptz not null default now()
);

create table if not exists public.scores (
  event_id    text not null references public.events(id) on delete cascade,
  player_id   text not null references public.players(id) on delete restrict,
  score       integer not null check (score between 1 and 300),
  nr          boolean not null default false,               -- 途中棄権（NR）
  updated_at  timestamptz not null default now(),
  primary key (event_id, player_id)
);
alter table public.scores add column if not exists nr boolean not null default false;
create index if not exists scores_player_idx on public.scores(player_id);

create table if not exists public.settings (
  id          integer primary key default 1 check (id = 1),
  yellow_max  integer not null default 79,
  blue_max    integer not null default 82,
  par         integer not null default 72,                  -- これより少ないスコアを赤字（アンダー）にする
  updated_at  timestamptz not null default now()
);
alter table public.settings add column if not exists par integer not null default 72;
insert into public.settings (id) values (1) on conflict (id) do nothing;

-- 管理者（Supabase の Authentication で作ったユーザーの ID を登録する）
create table if not exists public.admins (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  note        text,
  created_at  timestamptz not null default now()
);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- 行単位のアクセス制御（RLS）
alter table public.players  enable row level security;
alter table public.events   enable row level security;
alter table public.scores   enable row level security;
alter table public.settings enable row level security;
alter table public.admins   enable row level security;

do $$
declare t text;
begin
  foreach t in array array['players', 'events', 'scores', 'settings'] loop
    execute format('drop policy if exists "read_all" on public.%I', t);
    execute format('drop policy if exists "read_members" on public.%I', t);
    execute format('drop policy if exists "admin_write" on public.%I', t);
    execute format('create policy "read_members" on public.%I for select to authenticated using (true)', t);
    execute format('create policy "admin_write" on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

-- admins は本人が自分の行だけ読める（画面で「管理者かどうか」を判定するため）。書き込みは SQL Editor からのみ。
drop policy if exists "self_read" on public.admins;
create policy "self_read" on public.admins for select to authenticated using (user_id = auth.uid());

-- 1回分のスコアをまとめて置き換える（削除と登録を1つの処理で行い、途中で失敗しても半端に残らない）
create or replace function public.replace_event_scores(p_event_id text, p_scores jsonb)
returns void language plpgsql security invoker set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception '管理者のみ実行できます' using errcode = '42501';
  end if;
  delete from public.scores where event_id = p_event_id;
  insert into public.scores (event_id, player_id, score, nr)
  select p_event_id, x.player_id, x.score, coalesce(x.nr, false)
  from jsonb_to_recordset(p_scores) as x(player_id text, score integer, nr boolean);
end $$;
revoke all on function public.replace_event_scores(text, jsonb) from public, anon;
grant execute on function public.replace_event_scores(text, jsonb) to authenticated;

-- テーブルへの権限（Supabase の既定でも付くが、明示しておく）
revoke all on public.players, public.events, public.scores, public.settings, public.admins from anon;
grant select on public.players, public.events, public.scores, public.settings to authenticated;
grant insert, update, delete on public.players, public.events, public.scores, public.settings to authenticated;
grant select on public.admins to authenticated;
