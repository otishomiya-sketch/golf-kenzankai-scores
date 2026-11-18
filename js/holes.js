// ホール別の分析（スコアカードを登録したラウンドだけが対象）。純粋関数。
import { COURSE, HOLES } from './course.js';

const round1 = v => Math.round(v * 10) / 10;
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;

/**
 * @param cards [{ eventId, strokes: number[18] }]
 * @returns null（カードがない）または分析結果
 */
export function holeAnalysis(cards, par = COURSE.par) {
  const list = cards.filter(c => Array.isArray(c.strokes) && c.strokes.length === HOLES);
  if (!list.length) return null;
  const n = list.length;
  const holes = par.map((p, i) => {
    const vals = list.map(c => c.strokes[i]);
    const avg = mean(vals);
    return { hole: i + 1, par: p, avg: round1(avg), over: round1(avg - p) };
  });

  const byPar = [3, 4, 5].map(p => {
    const hs = holes.filter(h => h.par === p);
    return { par: p, holes: hs.length, over: round1(mean(hs.map(h => h.avg - h.par))) };
  });

  const half = (from, to) => round1(mean(list.map(c => c.strokes.slice(from - 1, to).reduce((a, b) => a + b, 0))));
  const outAvg = half(COURSE.out.from, COURSE.out.to), inAvg = half(COURSE.in.from, COURSE.in.to);

  // 結果の内訳：バーディ以上 / パー / ボギー / ダブルボギー / それ以上
  const dist = { birdie: 0, par: 0, bogey: 0, double: 0, worse: 0 };
  for (const c of list) c.strokes.forEach((s, i) => {
    const d = s - par[i];
    if (d <= -1) dist.birdie++; else if (d === 0) dist.par++; else if (d === 1) dist.bogey++; else if (d === 2) dist.double++; else dist.worse++;
  });
  const total = n * HOLES;
  const rate = k => Math.round(dist[k] / total * 100);

  const sorted = [...holes].sort((a, b) => a.over - b.over || a.hole - b.hole);
  return {
    n, holes, byPar,
    out: { avg: outAvg, par: par.slice(0, 9).reduce((a, b) => a + b, 0) },
    in: { avg: inAvg, par: par.slice(9).reduce((a, b) => a + b, 0) },
    dist, rates: { birdie: rate('birdie'), par: rate('par'), bogey: rate('bogey'), double: rate('double'), worse: rate('worse') },
    best: sorted.slice(0, 3),
    worst: sorted.slice(-3).reverse(),
  };
}

/** 分析から短い一言（前向きな言い方にする） */
export function holeInsights(a) {
  if (!a) return [];
  const sign = d => (d > 0 ? `+${d}` : d === 0 ? '±0' : `${d}`);
  const out = [];
  out.push({ icon: '💪', text: `得意なホール：${a.best.map(h => `${h.hole}番（パー${h.par}・平均${sign(h.over)}）`).join('、')}` });
  out.push({ icon: '🎯', text: `伸びしろのあるホール：${a.worst.map(h => `${h.hole}番（パー${h.par}・平均${sign(h.over)}）`).join('、')}` });
  const bp = [...a.byPar].sort((x, y) => x.over - y.over);
  out.push({ icon: '⛳', text: `パー3／4／5 の平均（パーとの差）：${a.byPar.map(b => `パー${b.par} ${sign(b.over)}`).join('・')}。得意はパー${bp[0].par}` });
  const d = round1((a.out.avg - a.out.par) - (a.in.avg - a.in.par));
  out.push({ icon: '🗾', text: Math.abs(d) < 0.5 ? `${COURSE.out.label} と ${COURSE.in.label} はほぼ互角（アウト平均 ${a.out.avg}・イン平均 ${a.in.avg}）`
    : `${d < 0 ? COURSE.out.label : COURSE.in.label} の方が得意（アウト平均 ${a.out.avg}・イン平均 ${a.in.avg}）` });
  out.push({ icon: '📊', text: `パー以上で上がった割合 ${a.rates.birdie + a.rates.par}%（バーディ以上 ${a.rates.birdie}%）・ボギー ${a.rates.bogey}%・ダブルボギー以上 ${a.rates.double + a.rates.worse}%` });
  return out;
}
