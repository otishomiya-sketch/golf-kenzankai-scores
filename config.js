// Supabase の接続先。空のままならデモモード（このブラウザだけに保存）で動く。
// 公開時はここに Supabase の Project URL と anon / publishable key を書く。
// anon key は公開して問題のない鍵（書き込みはデータベース側の RLS で管理者だけに制限している）。
window.GOLF_CONFIG = {
  supabaseUrl: 'https://lmaehrxuzlpliwnregpw.supabase.co',
  supabaseAnonKey: 'sb_publishable_q81GUdfbcpf6ncH4RmClMw_wMOT3zdA',
  // 会員共通の閲覧用アカウント。Supabase の Authentication → Users でこのメールアドレスのユーザーを作る（パスワードは会員に案内する）
  memberEmail: 'kenzankai.member@example.com',
  // スコアカード読み取りの Edge Function の名前（Supabase の Edge Functions の一覧に出ている名前）
  scorecardFunction: 'bright-processor',
};
