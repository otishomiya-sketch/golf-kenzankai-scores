// 選手ごとの分析（合計スコアだけで分かること）。純粋関数。
// ホール別のスコアは記録していないので、ホール・コース別の得意不得意はここでは出さない。

const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const round1 = v => Math.round(v * 10) / 10;

/**
 * @param st      playerStats の1人分（rounds は開催順）
 * @param events  今シーズンの開催回
 * @param scores  全スコア（その日の参加者平均を出すのに使う）
 * @param settings 色分けの設定（yellowMax）
 */
export function playerAnalysis(st, events, scores, settings) {
  const n = st.rounds.length;
  if (n < 3) return null;
  const ev = new Map(events.map(e => [e.id, e]));
  const rounds = st.rounds.filter(r => ev.has(r.eventId)).map(r => ({ ...r, event: ev.get(r.eventId) }));
  const vals = rounds.map(r => r.score);
  const avg = mean(vals);

  // CT（チャンピオンティー）の日と、それ以外の日
  const ct = rounds.filter(r => r.event.kind === 'CT').map(r => r.score);
  const reg = rounds.filter(r => r.event.kind !== 'CT').map(r => r.score);
  const ctCompare = ct.length >= 2 && reg.length >= 2
    ? { ctAvg: round1(mean(ct)), ctN: ct.length, regAvg: round1(mean(reg)), regN: reg.length, diff: round1(mean(ct) - mean(reg)) }
    : null;

  // 月別の平均（2回以上の月だけ「得意な月」の候補にする）
  const byMonth = new Map();
  for (const r of rounds) {
    const ym = r.event.date.slice(0, 7);
    if (!byMonth.has(ym)) byMonth.set(ym, []);
    byMonth.get(ym).push(r.score);
  }
  const months = [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([ym, list]) => ({ ym, avg: round1(mean(list)), n: list.length }));
  const candidates = months.filter(m => m.n >= 2);
  const bestMonth = candidates.length >= 2 ? candidates.reduce((a, b) => (b.avg < a.avg ? b : a)) : null;

  // 最近の調子：直近5回の平均と、シーズン平均の差（6回以上で）
  const trend = n >= 6 ? { recentAvg: round1(mean(vals.slice(-5))), diff: round1(mean(vals.slice(-5)) - avg) } : null;

  // 同じ日に回った人たちの平均との差（天気やコースの状態の影響を除いた実力の目安）
  const diffs = [];
  for (const r of rounds) {
    const others = scores.filter(s => s.eventId === r.eventId && s.playerId !== st.player.id).map(s => s.score);
    if (others.length >= 2) diffs.push(r.score - mean(others));
  }
  const field = diffs.length >= 3 ? { diff: round1(mean(diffs)), n: diffs.length } : null;

  // 黄色（例：79以下）を出した割合、ばらつき
  const goodCount = vals.filter(v => v <= settings.yellowMax).length;
  const sd = Math.sqrt(mean(vals.map(v => (v - avg) ** 2)));

  return {
    avg: round1(avg), n,
    ctCompare, months, bestMonth, trend, field,
    good: { count: goodCount, rate: Math.round(goodCount / n * 100), max: settings.yellowMax },
    sd: round1(sd),
  };
}

/** 分析から、短い一言を作る（差が小さいときは「ほぼ同じ」と言う） */
export function insights(a) {
  if (!a) return [];
  const out = [];
  const sign = d => (d > 0 ? `+${d}` : `${d}`);
  if (a.trend) {
    const d = a.trend.diff;
    out.push(d <= -1.5 ? { icon: '📈', text: `上り調子：直近5回の平均 ${a.trend.recentAvg}（シーズン平均より ${sign(d)}打）` }
      : d >= 1.5 ? { icon: '💡', text: `巻き返しのチャンス：直近5回の平均 ${a.trend.recentAvg}（シーズン平均 ${a.avg}）` }
      : { icon: '➡️', text: `安定：直近5回の平均 ${a.trend.recentAvg}（シーズン平均とほぼ同じ）` });
  }
  // 他の人との比較は、良いときだけ出す（下位の人をさらさない方針）
  if (a.field && a.field.diff <= -0.5) {
    out.push({ icon: '👥', text: `同じ日に回った人たちの平均より、平均 ${-a.field.diff}打良い（${a.field.n}回）` });
  }
  if (a.ctCompare) {
    const c = a.ctCompare;
    out.push({ icon: '⛳', text: Math.abs(c.diff) < 1 ? `CT（チャンピオンティー）の日も、通常の日とほぼ同じ（CT ${c.ctAvg}・通常 ${c.regAvg}）`
      : c.diff > 0 ? `CTの日は 平均 ${sign(c.diff)}打（CT ${c.ctAvg}／${c.ctN}回・通常 ${c.regAvg}／${c.regN}回）`
      : `CTの日の方が 平均 ${-c.diff}打良い（CT ${c.ctAvg}／${c.ctN}回・通常 ${c.regAvg}／${c.regN}回）` });
  }
  if (a.bestMonth) out.push({ icon: '📅', text: `一番良かった月：${Number(a.bestMonth.ym.slice(5))}月（平均 ${a.bestMonth.avg}・${a.bestMonth.n}回）` });
  if (a.good.count > 0) out.push({ icon: '🟨', text: `${a.good.max}以下（黄色）を出した割合：${a.good.rate}%（${a.good.count}／${a.n}回）` });
  out.push({ icon: '🎢', text: a.sd <= 3 ? `スコアの波が小さい安定型（ばらつき ±${a.sd}）` : a.sd >= 6 ? `日によって波がある（ばらつき ±${a.sd}）` : `ばらつきは標準的（±${a.sd}）` });
  return out;
}
