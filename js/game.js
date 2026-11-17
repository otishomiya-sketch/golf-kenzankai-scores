// 会員向けの「頑張りたくなる」演出のための計算（純粋関数）。
// 差は「上に上がるまで、あと何打」という前向きな形だけで見せる（下位の人をさらさない）。
import { playerStats, rankCategory, compareRecent, sortEvents, RANK_MIN_ROUNDS } from './stats.js';

const sum = a => a.reduce((x, y) => x + y, 0);
// 年間順位と同じ並べ方（ベスト8 → 回数 → 全計 → 直近のスコア）
const rankKey = (a, b) => a.best8 - b.best8 || b.count - a.count || a.total - b.total || compareRecent(a, b);

/** 次のラウンドでスコア x を出したと仮定したときの成績 */
export function withNextRound(s, x) {
  const rounds = [...s.rounds, { eventId: '__next__', playerId: s.player.id, score: x }];
  const vals = rounds.map(r => r.score).sort((a, b) => a - b);
  return {
    ...s, rounds, count: vals.length, total: s.total + x,
    best8: vals.length >= RANK_MIN_ROUNDS ? sum(vals.slice(0, RANK_MIN_ROUNDS)) : null,
  };
}

/**
 * 次のラウンドで target（自分より上の選手）を抜くために必要なスコア。
 * 「このスコア以下なら抜ける」という一番高い値を返す。1ラウンドで届かなければ null。
 */
export function scoreToPass(me, target, { min = 50, max = 150 } = {}) {
  for (let x = max; x >= min; x--) {
    const next = withNextRound(me, x);
    if (next.best8 !== null && rankKey(next, target) < 0) return x;
  }
  return null;
}

/** 区分の順位に、上との差・次の目標・前回からの順位変動・バッジを付ける */
export function gameBoard(players, events, scores, category, settings) {
  const st = playerStats(players, events, scores);
  const { ranked, unranked } = rankCategory(st, category);

  // 前回からの順位変動：最新の開催回（スコアのある回）を除いて計算し直す
  const held = sortEvents(events).filter(e => scores.some(s => s.eventId === e.id));
  const latest = held[held.length - 1];
  const prevRank = new Map();
  if (latest) {
    const before = rankCategory(playerStats(players, events.filter(e => e.id !== latest.id), scores), category);
    before.ranked.forEach(s => prevRank.set(s.player.id, s.rank));
  }

  const maxCount = Math.max(0, ...[...ranked, ...unranked].map(s => s.count));
  const decorate = s => ({
    ...s,
    badges: badges(s, { maxCount, par: settings.par, latestEventId: latest?.id }),
    playedLatest: !!latest && s.rounds.some(r => r.eventId === latest.id),
  });

  const rows = ranked.map((s, i) => {
    const above = ranked.slice(0, i).reverse().find(a => a.rank < s.rank);
    const prev = prevRank.get(s.player.id);
    return {
      ...decorate(s),
      gapUp: above ? s.best8 - above.best8 : null,          // 上の人まで、ベスト8であと何打
      above: above || null,
      target: above ? realistic(scoreToPass(s, above), settings.par) : null,
      lead: i === 0 && ranked[1] ? ranked[1].best8 - s.best8 : null,
      move: prev === undefined ? 'new' : prev - s.rank,       // ＋なら上がった
    };
  });
  const waiting = unranked.filter(s => s.count > 0).map(s => ({ ...decorate(s), toGo: RANK_MIN_ROUNDS - s.count }));
  return { rows, waiting, latest };
}

/** パーより7打以上良いスコアは「目標」として現実的でないので出さない */
const realistic = (x, par) => (x !== null && x >= par - 6 ? x : null);

/** バッジ。ありすぎると読みにくいので最大3つ */
export function badges(s, { maxCount, par, latestEventId }) {
  const out = [];
  const vals = s.rounds.map(r => r.score);
  const last = s.rounds[s.rounds.length - 1];
  if (vals.length >= 5) {
    const recent = vals.slice(-3);
    if (sum(recent) / 3 <= s.avgAll - 2) out.push({ icon: '🔥', label: '好調（直近3回が平均より2打以上良い）' });
  }
  if (last && vals.length >= 2 && last.eventId === latestEventId && last.score === Math.min(...vals)) {
    out.push({ icon: '🎯', label: '前回、自己ベストを出した' });
  }
  if (vals.some(v => v < par)) out.push({ icon: '🦅', label: 'アンダーを出した' });
  if (s.count > 0 && s.count === maxCount) out.push({ icon: '💪', label: '参加回数がこの区分で最多' });
  return out.slice(0, 3);
}
