// データの保存先。config.js に Supabase の URL とキーがあれば Supabase、なければデモモード（このブラウザだけに保存）。
import { DEFAULT_SETTINGS } from './stats.js';

const cfg = window.GOLF_CONFIG || {};
export const DEMO = !(cfg.supabaseUrl && cfg.supabaseAnonKey);
/** 会員共通の閲覧用アカウント（会員はパスワードだけ入力する） */
export const MEMBER_EMAIL = cfg.memberEmail || '';

// ---- 行の変換（DB の列名 ⇔ 画面で使う名前） ----
const toPlayer = r => ({ id: r.id, number: r.number, name: r.name, category: r.category, nonMember: r.non_member });
const fromPlayer = p => ({ id: p.id, number: p.number ?? '', name: p.name, category: p.category, non_member: !!p.nonMember });
const toEvent = r => ({ id: r.id, roundNo: r.round_no, date: r.date, label: r.label, kind: r.kind, cancelled: r.cancelled });
const fromEvent = e => ({ id: e.id, round_no: e.roundNo ?? null, date: e.date, label: e.label, kind: e.kind, cancelled: !!e.cancelled });
const toScore = r => ({ eventId: r.event_id, playerId: r.player_id, score: r.score, nr: !!r.nr });
const fromScore = s => ({ event_id: s.eventId, player_id: s.playerId, score: s.score, nr: !!s.nr });

function supabaseStore() {
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  const must = ({ data, error }) => { if (error) throw new Error(translate(error)); return data; };

  // 1回で取れる件数に上限があるため、ページを分けて全件読む
  async function all(table, order) {
    const out = [];
    for (let from = 0; ; from += 1000) {
      let q = sb.from(table).select('*').range(from, from + 999);
      for (const o of order) q = q.order(o);
      const rows = must(await q);
      out.push(...rows);
      if (rows.length < 1000) return out;
    }
  }

  return {
    async load() {
      const [players, events, scores, settings] = await Promise.all([
        all('players', ['id']), all('events', ['date', 'id']), all('scores', ['event_id', 'player_id']),
        sb.from('settings').select('*').eq('id', 1).maybeSingle().then(must),
      ]);
      return {
        players: players.map(toPlayer), events: events.map(toEvent), scores: scores.map(toScore),
        settings: settings ? { ...DEFAULT_SETTINGS, yellowMax: settings.yellow_max, blueMax: settings.blue_max, par: settings.par } : { ...DEFAULT_SETTINGS },
      };
    },
    async session() {
      const { data } = await sb.auth.getSession();
      const user = data.session?.user;
      if (!user) return { user: null, admin: false };
      const rows = must(await sb.from('admins').select('user_id').eq('user_id', user.id));
      return { user: { email: user.email }, admin: rows.length > 0 };
    },
    async signIn(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw new Error('メールアドレスかパスワードが違います');
    },
    async signOut() { await sb.auth.signOut(); },
    async savePlayer(p) { must(await sb.from('players').upsert({ ...fromPlayer(p), updated_at: new Date().toISOString() })); },
    async deletePlayer(id) { must(await sb.from('players').delete().eq('id', id)); },
    async saveEvent(e) { must(await sb.from('events').upsert({ ...fromEvent(e), updated_at: new Date().toISOString() })); },
    async deleteEvent(id) { must(await sb.from('events').delete().eq('id', id)); },
    async replaceEventScores(eventId, rows) {
      must(await sb.rpc('replace_event_scores', { p_event_id: eventId, p_scores: rows.map(r => ({ player_id: r.playerId, score: r.score, nr: !!r.nr })) }));
    },
    async saveSettings(s) { must(await sb.from('settings').upsert({ id: 1, yellow_max: s.yellowMax, blue_max: s.blueMax, par: s.par, updated_at: new Date().toISOString() })); },
    async importData({ players, events, scores }) {
      const chunks = (arr, n = 500) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
      for (const c of chunks(players || [])) must(await sb.from('players').upsert(c.map(fromPlayer)));
      for (const c of chunks(events || [])) must(await sb.from('events').upsert(c.map(fromEvent)));
      for (const c of chunks(scores || [])) must(await sb.from('scores').upsert(c.map(fromScore)));
    },
  };
}

function translate(error) {
  const m = error.message || String(error);
  if (/row-level security|permission denied|42501/.test(m + error.code)) return '書き込みの権限がありません（管理者でログインしてください）';
  if (/foreign key/.test(m)) return 'この選手・開催回にはスコアがあるため、削除できません';
  if (/Failed to fetch|NetworkError/.test(m)) return '通信できませんでした。電波の状態を確認してください';
  return m;
}

// ---- デモモード：このブラウザの localStorage に保存（共有はされない） ----
function demoStore() {
  const KEY = 'golf-kenzankai-demo-v1';
  const read = () => {
    try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; }
  };
  let db = read() || { players: [], events: [], scores: [], settings: { ...DEFAULT_SETTINGS } };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* 保存できなくても画面は動かす */ } };
  const upsert = (list, item, key) => {
    const i = list.findIndex(x => key(x) === key(item));
    if (i >= 0) list[i] = item; else list.push(item);
  };
  const clone = x => JSON.parse(JSON.stringify(x));
  return {
    async load() { return clone(db); },
    async session() { return { user: { email: 'デモ' }, admin: true }; },
    async signIn() {}, async signOut() {},
    async savePlayer(p) { upsert(db.players, { ...p }, x => x.id); save(); },
    async deletePlayer(id) {
      if (db.scores.some(s => s.playerId === id)) throw new Error('この選手にはスコアがあるため、削除できません');
      db.players = db.players.filter(p => p.id !== id); save();
    },
    async saveEvent(e) { upsert(db.events, { ...e }, x => x.id); save(); },
    async deleteEvent(id) { db.events = db.events.filter(e => e.id !== id); db.scores = db.scores.filter(s => s.eventId !== id); save(); },
    async replaceEventScores(eventId, rows) {
      db.scores = db.scores.filter(s => s.eventId !== eventId).concat(rows.map(r => ({ eventId, playerId: r.playerId, score: r.score, nr: !!r.nr })));
      save();
    },
    async saveSettings(s) { db.settings = { ...db.settings, ...s }; save(); },
    async importData({ players, events, scores }) {
      (players || []).forEach(p => upsert(db.players, p, x => x.id));
      (events || []).forEach(e => upsert(db.events, e, x => x.id));
      const pids = new Set(db.players.map(p => p.id)), eids = new Set(db.events.map(e => e.id));
      const bad = (scores || []).filter(s => !pids.has(s.playerId) || !eids.has(s.eventId));
      if (bad.length) throw new Error(`登録されていない選手・開催回のスコアが${bad.length}件あります（先に選手と開催回を読み込んでください）`);
      (scores || []).forEach(s => upsert(db.scores, s, x => x.eventId + '|' + x.playerId));
      save();
    },
  };
}

export const store = DEMO ? demoStore() : supabaseStore();
