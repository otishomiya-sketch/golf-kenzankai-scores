-- 会員だけが見られるようにする（2026-11 幹事回答【1】B）
-- すでに schema.sql を実行済みのデータベースで、SQL Editor に貼り付けて1回実行する。
-- 実行後は、ログインしていない人はデータを一切読めない。
do $$
declare t text;
begin
  foreach t in array array['players', 'events', 'scores', 'settings'] loop
    execute format('drop policy if exists "read_all" on public.%I', t);
    execute format('drop policy if exists "read_members" on public.%I', t);
    execute format('create policy "read_members" on public.%I for select to authenticated using (true)', t);
  end loop;
end $$;

revoke all on public.players, public.events, public.scores, public.settings, public.admins from anon;
grant select on public.players, public.events, public.scores, public.settings to authenticated;
