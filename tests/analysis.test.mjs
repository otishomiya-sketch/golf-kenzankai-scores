// 選手の分析のテスト
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playerStats, DEFAULT_SETTINGS } from '../js/stats.js';
import { playerAnalysis, insights } from '../js/analysis.js';

const P = id => ({ id, number: id, name: id, category: '一般', nonMember: false });
test('CTの日と通常の日、月別、直近の調子、同じ日の参加者との差', () => {
  const players = [P('A'), P('B'), P('C')];
  const events = [
    ['E1', '2026-06-01', '通常'], ['E2', '2026-06-08', '通常'], ['E3', '2026-07-01', 'CT'],
    ['E4', '2026-07-08', 'CT'], ['E5', '2026-08-01', '通常'], ['E6', '2026-08-08', '通常'],
  ].map(([id, date, kind]) => ({ id, date, label: date, kind, cancelled: false, roundNo: null }));
  const scores = [];
  const add = (pid, list) => list.forEach((s, i) => scores.push({ eventId: `E${i + 1}`, playerId: pid, score: s }));
  add('A', [80, 82, 86, 88, 78, 76]);
  add('B', [90, 90, 90, 90, 90, 90]);
  add('C', [92, 92, 92, 92, 92, 92]);
  const st = playerStats(players, events, scores);
  const a = playerAnalysis(st.get('A'), events, scores, DEFAULT_SETTINGS);
  assert.deepEqual(a.ctCompare, { ctAvg: 87, ctN: 2, regAvg: 79, regN: 4, diff: 8 });
  assert.equal(a.bestMonth.ym, '2026-08');
  assert.equal(a.field.diff, -9.3);         // 他の2人の平均は毎回91。A の平均 81.67 との差 → -9.3
  assert.equal(a.good.count, 2);            // 79以下は 78 と 76
});

test('他の人より悪い比較・黄色0%は出さない（前向きな表示）', () => {
  const players = [P('A'), P('B'), P('C')];
  const events = [1, 2, 3, 4].map(i => ({ id: `E${i}`, date: `2026-06-0${i}`, label: '', kind: '通常', cancelled: false, roundNo: null }));
  const scores = [];
  [1, 2, 3, 4].forEach(i => { scores.push({ eventId: `E${i}`, playerId: 'A', score: 100 }, { eventId: `E${i}`, playerId: 'B', score: 80 }, { eventId: `E${i}`, playerId: 'C', score: 82 }); });
  const a = playerAnalysis(playerStats(players, events, scores).get('A'), events, scores, DEFAULT_SETTINGS);
  const texts = insights(a).map(i => i.text).join('\n');
  assert.ok(!texts.includes('同じ日に回った'));
  assert.ok(!texts.includes('黄色'));
});
