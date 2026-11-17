// 成績の集計（純粋関数）。画面やデータの保存方法には依存しない。
// players: [{id, number, name, category, nonMember}]
// events:  [{id, roundNo, date, label, kind, cancelled}]
// scores:  [{eventId, playerId, score}]

export const CATEGORIES = ['一般', 'J', '女子'];
export const RANK_MIN_ROUNDS = 8;

/** 表示名。他クラブ・未入会なら先頭に「*」 */
export function displayName(p) {
  return (p.nonMember ? '*' : '') + p.name;
}

/** 開催回を日付順（同日は開催ID順）に並べる */
export function sortEvents(events) {
  return [...events].sort((a, b) =>
    a.date === b.date ? a.id.localeCompare(b.id) : a.date.localeCompare(b.date));
}

/** 少ない方から n 個の合計。n 個に満たなければ null */
function bestSum(sortedScores, n) {
  if (sortedScores.length < n) return null;
  let s = 0;
  for (let i = 0; i < n; i++) s += sortedScores[i];
  return s;
}

/** 選手ごとの集計 */
export function playerStats(players, events, scores) {
  const evOrder = new Map(sortEvents(events).map((e, i) => [e.id, i]));
  const byPlayer = new Map(players.map(p => [p.id, []]));
  for (const s of scores) {
    if (!byPlayer.has(s.playerId) || !evOrder.has(s.eventId)) continue;
    byPlayer.get(s.playerId).push(s);
  }
  const result = new Map();
  for (const p of players) {
    const rounds = byPlayer.get(p.id).sort((a, b) => evOrder.get(a.eventId) - evOrder.get(b.eventId));
    // スコアの少ない順。同じスコアは開催の早い方を先にする（ベスト8の強調表示で使う）
    const ascending = [...rounds].sort((a, b) => a.score - b.score || evOrder.get(a.eventId) - evOrder.get(b.eventId));
    const values = ascending.map(r => r.score);
    const n = values.length;
    const total = values.reduce((a, b) => a + b, 0);
    const best7 = bestSum(values, 7);
    const best8 = bestSum(values, 8);
    result.set(p.id, {
      player: p,
      rounds,                                   // 開催順のスコア
      count: n,
      total,
      best7,
      best8,
      avg8: best8 === null ? null : best8 / 8,
      avgAll: n === 0 ? null : total / n,
      bestScore: n === 0 ? null : values[0],
      best8EventIds: new Set(n >= 8 ? ascending.slice(0, 8).map(r => r.eventId) : []),
    });
  }
  return result;
}

/** 区分ごとの順位。ranked は順位付き、unranked は「順位外」 */
export function rankCategory(statsMap, category) {
  const list = [...statsMap.values()].filter(s => s.player.category === category);
  const byNumber = (a, b) => compareNumber(a.player, b.player);
  const key = (a, b) => a.best8 - b.best8 || b.count - a.count || a.total - b.total || compareRecent(a, b);
  const ranked = list.filter(s => s.count >= RANK_MIN_ROUNDS).sort((a, b) => key(a, b) || byNumber(a, b));
  // 4つの条件（ベスト8・回数・全計・直近のスコア）がすべて同じなら同順位
  let prev = null;
  ranked.forEach((s, i) => {
    const same = prev && key(prev, s) === 0;
    s.rank = same ? prev.rank : i + 1;
    prev = s;
  });
  const unranked = list.filter(s => s.count < RANK_MIN_ROUNDS).sort((a, b) => b.count - a.count || byNumber(a, b));
  return { ranked, unranked };
}

/** 直近のスコアから順に比べ、少ない方を上にする（幹事回答 2026-11：同点は直近のスコアが良い方を上） */
export function compareRecent(a, b) {
  const n = Math.min(a.rounds.length, b.rounds.length);
  for (let i = 1; i <= n; i++) {
    const d = a.rounds[a.rounds.length - i].score - b.rounds[b.rounds.length - i].score;
    if (d) return d;
  }
  return 0;
}

/** 番号の自然順（1,2,…,10 / J1,J2,…） */
export function compareNumber(a, b) {
  const ka = numberKey(a.number), kb = numberKey(b.number);
  return ka[0].localeCompare(kb[0]) || ka[1] - kb[1] || a.id.localeCompare(b.id);
}
function numberKey(num) {
  const m = String(num ?? '').match(/^(\D*)(\d*)$/);
  return m ? [m[1], m[2] === '' ? Infinity : Number(m[2])] : [String(num), Infinity];
}

/** 全体の集計 */
export function overallStats(events, scores) {
  const perEvent = new Map(events.map(e => [e.id, 0]));
  let total = 0;
  for (const s of scores) {
    if (!perEvent.has(s.eventId)) continue;
    perEvent.set(s.eventId, perEvent.get(s.eventId) + 1);
    total++;
  }
  const held = events.filter(e => !e.cancelled).length;
  return { perEvent, total, held, average: held === 0 ? null : total / held };
}

/** 色分け。'yellow' | 'blue' | null */
export function scoreColor(score, settings) {
  if (score == null) return null;
  if (score <= settings.yellowMax) return 'yellow';
  if (score <= settings.blueMax) return 'blue';
  return null;
}

/** 小数を指定桁で四捨五入した文字列。null は「—」 */
export function fmtDecimal(v, digits) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const f = 10 ** digits;
  // 浮動小数点の誤差（例：x.xx4999…）で切り捨てられないよう、わずかに補正して丸める
  const r = Math.round(v * f + (v >= 0 ? 1e-9 : -1e-9)) / f;
  return r.toFixed(digits);
}

export function fmtInt(v) {
  return v === null || v === undefined ? '—' : v.toLocaleString('ja-JP');
}

export const DEFAULT_SETTINGS = { yellowMax: 79, blueMax: 82, par: 72, warnMin: 50, warnMax: 150 };

/** 区分の表示名（データ上は「J」のまま） */
export const CATEGORY_LABEL = { '一般': '一般', 'J': 'J（準会員）', '女子': '女子' };

/** スコアの文字の印。'nr'＝途中棄権（オレンジ）、'under'＝アンダー（赤）、null＝なし */
export function scoreMark(s, settings) {
  if (s.nr) return 'nr';
  if (s.score < settings.par) return 'under';
  return null;
}

/** スコアの入力値チェック。{ok, warn, message} */
export function checkScore(value, settings = DEFAULT_SETTINGS) {
  const s = String(value ?? '').trim();
  if (s === '') return { ok: true, empty: true };
  if (!/^\d+$/.test(s)) return { ok: false, message: '数字で入力してください' };
  const n = Number(s);
  if (n < 1 || n > 300) return { ok: false, message: '1〜300で入力してください' };
  if (n < settings.warnMin || n > settings.warnMax) {
    return { ok: true, warn: true, value: n, message: `${settings.warnMin}〜${settings.warnMax}の範囲外です` };
  }
  return { ok: true, value: n };
}

// ---------- シーズンと選手選考（競技会細則（2）・幹事回答 2026-11） ----------

/** シーズン中の開催回だけにする。seasonStart〜（selectionDate があればその日まで） */
export function seasonEvents(events, { seasonStart = null, selectionDate = null } = {}) {
  return events.filter(e => (!seasonStart || e.date >= seasonStart) && (!selectionDate || e.date <= selectionDate));
}

/** 選考の年。選考日があればその年、なければシーズン開始の翌年、どちらもなければ今日から見た次の5月の年 */
export function selectionYear({ seasonStart = null, selectionDate = null, today }) {
  if (selectionDate) return Number(selectionDate.slice(0, 4));
  if (seasonStart) return Number(seasonStart.slice(0, 4)) + 1;
  const [y, m] = today.split('-').map(Number);
  return m >= 6 ? y + 1 : y;
}

export const SELECTION_RECENT = 12;      // 直近12枚
export const SELECTION_NEW_SEASON = 3;   // 新シーズン（4月〜選考日）に3枚以上

/**
 * 推薦選手の選考順位。
 * 合計 = ベスト8 + 直近12枚の平均（小数第1位まで、2位以下切り捨て）。少ない方が上。
 * 対象：一般で「*」の付かない選手会員、シーズン中12枚以上、4月〜選考日に3枚以上。
 * 同点：直近12枚の平均が良い方を上（幹事回答【8】A）。
 * 選考日を過ぎるまでは「暫定」とし、4月以降の枚数が足りない人も順位に含めて印を付ける。
 */
export function selectionRanking(players, events, scores, opts) {
  const { today } = opts;
  const evs = seasonEvents(events, opts);
  const targets = players.filter(p => p.category === '一般' && !p.nonMember);
  const st = playerStats(targets, evs, scores);
  const year = selectionYear(opts);
  const newSeasonFrom = `${year}-04-01`;
  const dateOf = new Map(evs.map(e => [e.id, e.date]));
  const final = !!opts.selectionDate && today >= opts.selectionDate;

  const rows = [...st.values()].map(s => {
    const recent = s.rounds.slice(-SELECTION_RECENT);
    const recentSum = recent.reduce((a, r) => a + r.score, 0);
    const avg12 = recent.length >= SELECTION_RECENT ? Math.floor(recentSum * 10 / SELECTION_RECENT) / 10 : null;
    const newSeason = s.rounds.filter(r => dateOf.get(r.eventId) >= newSeasonFrom).length;
    return {
      ...s,
      avg12,
      points: avg12 === null || s.best8 === null ? null : Math.round((s.best8 + avg12) * 10) / 10,
      newSeason,
      newSeasonOk: newSeason >= SELECTION_NEW_SEASON,
      recentEventIds: new Set(recent.map(r => r.eventId)),
    };
  });

  const key = (a, b) => a.points - b.points || a.avg12 - b.avg12;
  const pool = rows.filter(r => r.points !== null && (!final || r.newSeasonOk));
  const ranked = pool.sort((a, b) => key(a, b) || compareRecent(a, b) || compareNumber(a.player, b.player));
  let prev = null;
  ranked.forEach((r, i) => { r.rank = prev && key(prev, r) === 0 ? prev.rank : i + 1; prev = r; });
  const excluded = rows.filter(r => !pool.includes(r))
    .sort((a, b) => b.count - a.count || compareNumber(a.player, b.player));
  return { ranked, excluded, final, newSeasonFrom, year };
}
