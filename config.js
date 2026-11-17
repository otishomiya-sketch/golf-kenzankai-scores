// Supabase の接続先。空のままならデモモード（このブラウザだけに保存）で動く。
// 公開時は GitHub Actions がリポジトリの Variables（SUPABASE_URL / SUPABASE_ANON_KEY）から上書きする。
// anon key は公開して問題のない鍵（書き込みはデータベース側の RLS で管理者だけに制限している）。
window.GOLF_CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: '',
};
