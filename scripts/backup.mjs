// データのバックアップ：選手・開催回・スコア・スコアカード（ホール別）を CSV に書き出す。
// 定期実行（Claude のルーティン）から使う。管理画面の「CSV」と同じ形式（BOM付き UTF-8・Excel で開ける）。
//
// 使い方：
//   GOLF_MEMBER_PASSWORD=<会員用パスワード> node scripts/backup.mjs <出力フォルダ>
// 会員用（閲覧用）アカウントでログインして読むだけ。データは変更しない。
// 最後に「この接続だけ」ログアウトする（ほかの端末のログインには影響しない）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { playersCsv, eventsCsv, scoresCsv, toCsv } from '../js/csv.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const configText = fs.readFileSync(path.join(here, '..', 'config.js'), 'utf8');
const pick = key => (configText.match(new RegExp(`${key}: '([^']+)'`)) || [])[1];
const URL = pick('supabaseUrl'), KEY = pick('supabaseAnonKey'), EMAIL = pick('memberEmail');
const PASSWORD = process.env.GOLF_MEMBER_PASSWORD;
const outDir = process.argv[2];
if (!URL || !KEY || !EMAIL) throw new Error('config.js から接続先を読めませんでした');
if (!PASSWORD || !outDir) { console.error('使い方：GOLF_MEMBER_PASSWORD=... node scripts/backup.mjs <出力フォルダ>'); process.exit(2); }

const api = async (p, opts = {}) => {
  const res = await fetch(URL + p, { ...opts, headers: { apikey: KEY, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${p} → ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
};

const login = await api('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
const auth = { Authorization: `Bearer ${login.access_token}` };
try {
  // 1回に読める件数に上限があるので、1000件ずつ全部読む
  const all = async (table, order) => {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const rows = await api(`/rest/v1/${table}?select=*&order=${order}`, { headers: { ...auth, Range: `${from}-${from + 999}` } });
      out.push(...rows);
      if (rows.length < 1000) return out;
    }
  };
  const players = (await all('players', 'id')).map(r => ({ id: r.id, number: r.number, name: r.name, category: r.category, nonMember: r.non_member }));
  const events = (await all('events', 'date,id')).map(r => ({ id: r.id, roundNo: r.round_no, date: r.date, label: r.label, kind: r.kind, cancelled: r.cancelled }));
  const scores = (await all('scores', 'event_id,player_id')).map(r => ({ eventId: r.event_id, playerId: r.player_id, score: r.score, nr: r.nr }));
  let cards = [];
  try { cards = await all('hole_cards', 'event_id,player_id'); } catch { /* ホール別の表がまだない場合は飛ばす */ }

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'players.csv'), playersCsv(players));
  fs.writeFileSync(path.join(outDir, 'events.csv'), eventsCsv(events));
  fs.writeFileSync(path.join(outDir, 'scores.csv'), scoresCsv(scores, events, players));
  const pname = new Map(players.map(p => [p.id, p.name]));
  fs.writeFileSync(path.join(outDir, 'hole_cards.csv'), toCsv(
    ['開催ID', '選手ID', '氏名', ...Array.from({ length: 18 }, (_, i) => `${i + 1}番`), '合計', '登録方法', '更新日時'],
    cards.map(c => [c.event_id, c.player_id, pname.get(c.player_id) ?? '', ...c.strokes, c.strokes.reduce((a, b) => a + b, 0), c.source, c.updated_at]),
  ));
  console.log(JSON.stringify({ players: players.length, events: events.length, scores: scores.length, hole_cards: cards.length, outDir }));
} finally {
  await fetch(`${URL}/auth/v1/logout?scope=local`, { method: 'POST', headers: { apikey: KEY, ...auth } }).catch(() => {});
}
