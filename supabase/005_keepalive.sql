-- 無料プランの一時停止（1週間アクセスがないと止まる）を防ぐための確認用の関数
-- GitHub Actions（.github/workflows/keepalive.yml）が3日ごとに呼ぶ。
-- ログインなしで呼べるが、現在時刻を返すだけで、会員のデータは一切返さない。
-- SQL Editor に貼り付けて1回実行する（何度実行しても問題ない）。
create or replace function public.keepalive() returns timestamptz
language sql stable security definer set search_path = public as $$
  select now();
$$;
revoke all on function public.keepalive() from public;
grant execute on function public.keepalive() to anon, authenticated;
