// 会員向け演出の計算のテスト
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playerStats, rankCategory } from '../js/stats.js';
import { scoreToPass, gameBoard } from '../js/game.js';

const P = (id, number) => ({ id, number, name: id, category: '一般', nonMember: false });
const E = (id, date) => ({ id, roundNo: null, date, label: date, kind: '通常', cancelled: false });

test('次のラウンドで上の人を抜くのに必要なスコア（このスコア以下なら抜ける）', () => {
  const players = [P('A', '1'), P('B', '2')];
  const events = Array.from({ length: 9 }, (_, i) => E(`E${i}`, `2026-01-0${i + 1}`));
  const scores = [];
  [80, 80, 80, 80, 80, 80, 80, 80].forEach((s, i) => scores.push({ eventId: `E${i}`, playerId: 'A', score: s })); // 640
  [80, 80, 80, 80, 80, 80, 80, 85].forEach((s, i) => scores.push({ eventId: `E${i}`, playerId: 'B', score: s })); // 645
  const { ranked } = rankCategory(playerStats(players, events, scores), '一般');
  const [a, b] = ranked;
  // B が 80 を出すと 85 が外れて 640 で並び、回数が多い（9回）ので A を上回る
  assert.equal(scoreToPass(b, a), 80);
});

test('順位表の演出：首位のリード、上との差、前回からの変動、ランキング入りまでの回数', () => {
  const players = [P('A', '1'), P('B', '2'), P('C', '3')];
  const events = Array.from({ length: 9 }, (_, i) => E(`E${i}`, `2026-01-0${i + 1}`));
  const scores = [];
  const add = (pid, list) => list.forEach((s, i) => s && scores.push({ eventId: `E${i}`, playerId: pid, score: s }));
  add('A', [80, 80, 80, 80, 80, 80, 80, 80, 90]);
  add('B', [82, 82, 82, 82, 82, 82, 82, 82, 60]);   // 最終回の60で 634 となり A（640）を逆転
  add('C', [85, 85, 85, 0, 0, 0, 0, 0, 0]);
  const g = gameBoard(players, events, scores, '一般', { par: 72 });
  assert.equal(g.rows[0].player.id, 'B');
  assert.equal(g.rows[0].move, 1);                    // 2位 → 1位
  assert.equal(g.rows[1].move, -1);
  assert.equal(g.rows[0].lead, g.rows[1].best8 - g.rows[0].best8);
  assert.equal(g.rows[1].gapUp, g.rows[1].best8 - g.rows[0].best8);
  assert.ok(g.rows[0].badges.some(b => b.icon === '🦅'));   // 60 はアンダー
  assert.equal(g.waiting[0].toGo, 5);
});
