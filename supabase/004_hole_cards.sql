-- ホール別スコア（スコアカード）の保存（2026-11 大宮さん指示）
-- 会員本人（共通の閲覧用アカウント）も登録・上書きできる。そのかわり、すべての登録を
-- 履歴（hole_card_log）に自動で残し、管理者が元に戻せるようにする。
-- 写真そのものは保存しない（読み取ったら捨てる）。公式の順位（scores）には影響させない。
-- SQL Editor に貼り付けて1回実行する（何度実行しても問題ない）。

create table if not exists public.hole_cards (
  event_id    text not null references public.events(id) on delete cascade,
  player_id   text not null references public.players(id) on delete cascade,
  strokes     integer[] not null,
  source      text not null default 'manual' check (source in ('ai', 'manual')),
  updated_by  uuid default auth.uid(),
  updated_at  timestamptz not null default now(),
  primary key (event_id, player_id),
  constraint hole_cards_18 check (array_length(strokes, 1) = 18 and 1 <= all(strokes) and 15 >= all(strokes))
);

-- 登録の履歴（消せない・書き換えられない。中身を見られるのは管理者だけ）
create table if not exists public.hole_card_log (
  id          bigserial primary key,
  event_id    text not null,
  player_id   text not null,
  strokes     integer[],
  source      text,
  action      text not null,
  created_by  uuid,
  created_at  timestamptz not null default now()
);

create or replace function public.log_hole_card() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    insert into public.hole_card_log (event_id, player_id, strokes, source, action, created_by)
    values (old.event_id, old.player_id, old.strokes, old.source, 'delete', auth.uid());
    return old;
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  insert into public.hole_card_log (event_id, player_id, strokes, source, action, created_by)
  values (new.event_id, new.player_id, new.strokes, new.source, lower(tg_op), auth.uid());
  return new;
end $$;
drop trigger if exists hole_cards_log on public.hole_cards;
create trigger hole_cards_log before insert or update or delete on public.hole_cards
  for each row execute function public.log_hole_card();

-- AI 読み取りの回数（使いすぎ防止。Edge Function が1日の上限を数えるのに使う）
create table if not exists public.ai_reads (
  id          bigserial primary key,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);

alter table public.hole_cards    enable row level security;
alter table public.hole_card_log enable row level security;
alter table public.ai_reads      enable row level security;

drop policy if exists "read_members" on public.hole_cards;
drop policy if exists "members_insert" on public.hole_cards;
drop policy if exists "members_update" on public.hole_cards;
drop policy if exists "admin_delete" on public.hole_cards;
create policy "read_members"   on public.hole_cards for select to authenticated using (true);
create policy "members_insert" on public.hole_cards for insert to authenticated with check (true);
create policy "members_update" on public.hole_cards for update to authenticated using (true) with check (true);
create policy "admin_delete"   on public.hole_cards for delete to authenticated using (public.is_admin());

drop policy if exists "admin_read" on public.hole_card_log;
create policy "admin_read" on public.hole_card_log for select to authenticated using (public.is_admin());

drop policy if exists "members_insert" on public.ai_reads;
drop policy if exists "members_read" on public.ai_reads;
create policy "members_insert" on public.ai_reads for insert to authenticated with check (true);
create policy "members_read"   on public.ai_reads for select to authenticated using (true);

revoke all on public.hole_cards, public.hole_card_log, public.ai_reads from anon;
grant select, insert, update, delete on public.hole_cards to authenticated;
grant select on public.hole_card_log to authenticated;
grant select, insert on public.ai_reads to authenticated;
grant usage on sequence public.ai_reads_id_seq to authenticated;
