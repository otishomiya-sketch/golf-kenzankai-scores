// ホール別分析のテスト
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { holeAnalysis, holeInsights } from '../js/holes.js';
import { COURSE, PAR_TOTAL } from '../js/course.js';

test('コース情報：パー72（アウト36・イン36）', () => {
  assert.equal(PAR_TOTAL, 72);
  assert.equal(COURSE.par.slice(0, 9).reduce((a, b) => a + b), 36);
});

test('ホール別の平均、パー3/4/5、アウト/イン、結果の内訳、得意・伸びしろ', () => {
  const par = COURSE.par;
  // 1枚目：全ホールパー（72）、2枚目：2番（パー3）だけ +2、10番（パー5）で -1
  const c1 = [...par];
  const c2 = [...par]; c2[1] = 5; c2[9] = 4;
  const a = holeAnalysis([{ eventId: 'E1', strokes: c1 }, { eventId: 'E2', strokes: c2 }]);
  assert.equal(a.n, 2);
  assert.equal(a.holes[1].avg, 4); assert.equal(a.holes[1].over, 1);
  assert.equal(a.holes[9].over, -0.5);
  assert.equal(a.worst[0].hole, 2);
  assert.equal(a.best[0].hole, 10);
  assert.equal(a.out.avg, 37); assert.equal(a.in.avg, 35.5);
  assert.equal(a.dist.birdie, 1); assert.equal(a.dist.double, 1); assert.equal(a.dist.par, 34);
  const p3 = a.byPar.find(b => b.par === 3);
  assert.equal(p3.over, 0.3);   // パー3は4ホール、合計 +1 → 平均 +0.25 → 0.3
  const texts = holeInsights(a).map(i => i.text).join('\n');
  assert.match(texts, /得意なホール：10番/);
  assert.match(texts, /イン（義経） の方が得意/);
});

test('カードがなければ分析しない', () => {
  assert.equal(holeAnalysis([]), null);
  assert.deepEqual(holeInsights(null), []);
});
