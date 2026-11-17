// 集計ロジックのテスト。実行：node --test tests/
// 実データでの検証は、環境変数 GOLF_DATA_DIR に players.csv / events.csv / scores.csv を置いたフォルダを指定したときだけ行う
// （会員の個人情報をリポジトリに入れないため）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { selectionRanking, seasonEvents, selectionYear, playerStats, rankCategory, overallStats, fmtDecimal, scoreColor, scoreMark, checkScore, displayName, DEFAULT_SETTINGS } from '../js/stats.js';
import { parseCsv, recordsToData, detectKind, scoresCsv, playersCsv, eventsCsv } from '../js/csv.js';

const P = (id, number, category = '一般', nonMember = false) => ({ id, number, name: id, category, nonMember });
const E = (id, date, cancelled = false) => ({ id, roundNo: null, date, label: date, kind: '通常', cancelled });

function fixture() {
  const players = [P('A', '1'), P('B', '2'), P('C', '3'), P('D', '4'), P('W', '1', '女子')];
  const events = Array.from({ length: 10 }, (_, i) => E(`E${i}`, `2026-01-${String(i + 1).padStart(2, '0')}`));
  events.push(E('X', '2026-02-01', true));
  const scores = [];
  const add = (pid, list) => list.forEach((s, i) => scores.push({ eventId: `E${i}`, playerId: pid, score: s }));
  add('A', [80, 81, 82, 83, 84, 85, 86, 87, 100]);   // 9回 ベスト8=668
  add('B', [80, 81, 82, 83, 84, 85, 86, 87]);        // 8回 ベスト8=668 → 回数の少ないBが下
  add('C', [70, 70, 70, 70, 70, 70, 70]);            // 7回 → 順位外
  add('D', [90]);
  return { players, events, scores };
}

test('ベスト7・ベスト8・平均の計算', () => {
  const { players, events, scores } = fixture();
  const st = playerStats(players, events, scores);
  const a = st.get('A');
  assert.equal(a.best7, 581);
  assert.equal(a.best8, 668);
  assert.equal(fmtDecimal(a.avg8, 3), '83.500');
  assert.equal(a.total, 768);
  assert.equal(a.count, 9);
  assert.equal(fmtDecimal(a.avgAll, 2), '85.33');
  assert.equal(st.get('C').best8, null);
  assert.equal(st.get('C').best7, 490);
  assert.equal(st.get('W').avgAll, null);
  assert.equal(fmtDecimal(st.get('W').avgAll, 2), '—');
});

test('順位：ベスト8→回数→全計。8回未満は順位外（回数の多い順）', () => {
  const { players, events, scores } = fixture();
  const { ranked, unranked } = rankCategory(playerStats(players, events, scores), '一般');
  assert.deepEqual(ranked.map(s => [s.player.id, s.rank]), [['A', 1], ['B', 2]]);
  assert.deepEqual(unranked.map(s => s.player.id), ['C', 'D']);
});

test('3条件すべて同じなら同順位', () => {
  const players = [P('A', '1'), P('B', '2')];
  const events = Array.from({ length: 8 }, (_, i) => E(`E${i}`, `2026-01-0${i + 1}`));
  const scores = [];
  for (const pid of ['A', 'B']) for (let i = 0; i < 8; i++) scores.push({ eventId: `E${i}`, playerId: pid, score: 80 });
  const { ranked } = rankCategory(playerStats(players, events, scores), '一般');
  assert.deepEqual(ranked.map(s => s.rank), [1, 1]);
});

test('ベスト8・回数・全計が同じなら、直近のスコアが良い方を上（幹事回答）', () => {
  const players = [P('A', '1'), P('B', '2')];
  const events = Array.from({ length: 9 }, (_, i) => E(`E${i}`, `2026-01-0${i + 1}`));
  const scores = [];
  // 2人とも同じ9スコアだが順番が違う。最後の回：A=85、B=80 → B が上
  [80, 81, 82, 83, 84, 85, 86, 87, 80].forEach((s, i) => scores.push({ eventId: `E${i}`, playerId: 'A', score: [80, 81, 82, 83, 84, 80, 86, 87, 85][i] }));
  [80, 81, 82, 83, 84, 85, 86, 87, 80].forEach((s, i) => scores.push({ eventId: `E${i}`, playerId: 'B', score: s }));
  const { ranked } = rankCategory(playerStats(players, events, scores), '一般');
  assert.deepEqual(ranked.map(s => [s.player.id, s.rank]), [['B', 1], ['A', 2]]);
});

test('ベスト8に使うスコアは、同点なら早い開催を優先', () => {
  const players = [P('A', '1')];
  const events = Array.from({ length: 9 }, (_, i) => E(`E${i}`, `2026-01-0${i + 1}`));
  const scores = events.map((e, i) => ({ eventId: e.id, playerId: 'A', score: i < 7 ? 80 : 90 }));
  const st = playerStats(players, events, scores).get('A');
  assert.ok(st.best8EventIds.has('E7'));
  assert.ok(!st.best8EventIds.has('E8'));
});

test('全体の集計（中止は開催回数に含めない）', () => {
  const { events, scores } = fixture();
  const o = overallStats(events, scores);
  assert.equal(o.total, 25);
  assert.equal(o.held, 10);
  assert.equal(fmtDecimal(o.average, 2), '2.50');
  assert.equal(o.perEvent.get('X'), 0);
});

test('色分けと入力チェック', () => {
  assert.equal(scoreColor(79, DEFAULT_SETTINGS), 'yellow');
  assert.equal(scoreColor(80, DEFAULT_SETTINGS), 'blue');
  assert.equal(scoreColor(82, DEFAULT_SETTINGS), 'blue');
  assert.equal(scoreColor(83, DEFAULT_SETTINGS), null);
  assert.equal(scoreColor(80, { yellowMax: 80, blueMax: 85 }), 'yellow');
  assert.equal(checkScore('151').warn, true);
  assert.equal(checkScore('49').warn, true);
  assert.equal(checkScore('85').warn, undefined);
  assert.equal(checkScore('8a').ok, false);
  assert.equal(checkScore('').empty, true);
});

test('文字の印：パー未満は赤（アンダー）、NR はオレンジ（NR を優先）', () => {
  const st = { ...DEFAULT_SETTINGS, par: 72 };
  assert.equal(scoreMark({ score: 71 }, st), 'under');
  assert.equal(scoreMark({ score: 72 }, st), null);
  assert.equal(scoreMark({ score: 120, nr: true }, st), 'nr');
  assert.equal(scoreMark({ score: 70, nr: true }, st), 'nr');
});

test('CSV：NR 列あり・なしの両方を読める', () => {
  const withNr = recordsToData('scores', parseCsv('開催ID,日付,選手ID,氏名,スコア,NR\nE1,2026-01-01,P1,a,120,1\n').records).items;
  assert.equal(withNr[0].nr, true);
  const without = recordsToData('scores', parseCsv('開催ID,日付,選手ID,氏名,スコア\nE1,2026-01-01,P1,a,80\n').records).items;
  assert.equal(without[0].nr, false);
  const out = scoresCsv(withNr, [{ id: 'E1', date: '2026-01-01' }], [{ id: 'P1', name: 'a' }]);
  assert.match(out, /E1,2026-01-01,P1,a,120,1/);
});

test('選手選考：ベスト8＋直近12枚平均（切り捨て）。12枚未満と「*」は対象外、締め日後は4月以降3枚未満も対象外', () => {
  const players = [P('A', '1'), P('B', '2'), P('C', '3'), { ...P('D', '4'), nonMember: true }, P('W', '1', '女子')];
  // 2026-05〜2027-05 のシーズン。14回分（最後の3回は2027年4〜5月）
  const dates = ['2026-06-01','2026-06-08','2026-06-15','2026-06-22','2026-07-01','2026-07-08','2026-07-15','2026-08-01','2026-08-08','2026-09-01','2026-10-01','2027-04-10','2027-04-20','2027-05-01'];
  const events = dates.map((d, i) => E(`E${i}`, d));
  const scores = [];
  const add = (pid, list, from = 0) => list.forEach((s, i) => scores.push({ eventId: `E${from + i}`, playerId: pid, score: s }));
  add('A', [80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 80, 81, 82]);   // 14枚、4月〜3枚
  add('B', [80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91]);            // 12枚、4月〜1枚
  add('C', [80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90]);                // 11枚 → 対象外
  add('D', [70, 70, 70, 70, 70, 70, 70, 70, 70, 70, 70, 70, 70, 70]);    // 「*」→ 対象外
  add('W', [70, 70, 70, 70, 70, 70, 70, 70, 70, 70, 70, 70, 70, 70]);    // 女子 → 対象外
  const opts = { seasonStart: '2026-05-17', selectionDate: '2027-05-15', today: '2027-01-10' };
  let r = selectionRanking(players, events, scores, opts);
  const a = r.ranked.find(x => x.player.id === 'A');
  // A：ベスト8 = 80+80+81+81+82+82+83+84 = 653、直近12 = 82..90,80,81,82 の合計 1017 → 84.75 → 84.7（切り捨て）
  assert.equal(a.best8, 653); assert.equal(a.avg12, 84.7); assert.equal(a.points, 737.7); assert.equal(a.newSeason, 3);
  assert.deepEqual(r.ranked.map(x => x.player.id), ['A', 'B']);        // 締め日前は B も暫定で入る
  assert.equal(r.final, false);
  assert.deepEqual(r.excluded.map(x => x.player.id), ['C']);
  r = selectionRanking(players, events, scores, { ...opts, today: '2027-05-15' });
  assert.equal(r.final, true);
  assert.deepEqual(r.ranked.map(x => x.player.id), ['A']);             // 締め日後は4月以降1枚の B が外れる
  assert.equal(selectionYear({ today: '2026-11-17' }), 2027);
  assert.equal(seasonEvents(events, { seasonStart: '2027-01-01' }).length, 3);
});

test('表示名：未入会・他クラブは「*」', () => {
  assert.equal(displayName({ name: '山田', nonMember: true }), '*山田');
  assert.equal(displayName({ name: '山田', nonMember: false }), '山田');
});

test('CSV：引用符・BOM・CRLF を読み、書き出しを読み直しても同じ', () => {
  const { header, records } = parseCsv('﻿選手ID,番号,氏名,区分,未入会_他クラブ\r\nP1,1,"山田,太郎",一般,1\r\n');
  assert.equal(detectKind(header), 'players');
  const { items, errors } = recordsToData('players', records);
  assert.deepEqual(errors, []);
  assert.equal(items[0].name, '山田,太郎');
  assert.equal(items[0].nonMember, true);
  const again = parseCsv(playersCsv(items));
  assert.deepEqual(recordsToData('players', again.records).items, items);
});

test('CSV：不正な行は行番号付きで報告', () => {
  const { records } = parseCsv('開催ID,日付,選手ID,氏名,スコア\nE1,2026-01-01,P1,a,abc\n');
  const { errors } = recordsToData('scores', records);
  assert.match(errors[0], /^2行目/);
});

// ---- 実データでの検証（依頼書の検証項目） ----
const dir = process.env.GOLF_DATA_DIR;
test('実データ：依頼書の検証値と一致する', { skip: !dir && 'GOLF_DATA_DIR 未指定' }, () => {
  const load = name => {
    const { header, records } = parseCsv(fs.readFileSync(path.join(dir, name), 'utf8'));
    const kind = detectKind(header);
    const { items, errors } = recordsToData(kind, records);
    assert.deepEqual(errors, [], name);
    return items;
  };
  const players = load('players.csv'), events = load('events.csv'), scores = load('scores.csv');
  assert.equal(scores.length, 394);
  const st = playerStats(players, events, scores);
  const byName = n => [...st.values()].find(s => s.player.name === n);

  const shimo = byName('下屋敷千尋');
  assert.deepEqual([shimo.best7, shimo.best8, shimo.total, shimo.count], [522, 599, 1313, 17]);
  const nishi = byName('西島郷史');
  assert.deepEqual([nishi.best8, nishi.total, nishi.count], [630, 2060, 25]);
  const taka = byName('高山秀樹');
  assert.deepEqual([taka.best8, taka.total, taka.count], [630, 1579, 19]);
  const honda = byName('本田　強');
  assert.deepEqual([honda.total, honda.count, fmtDecimal(honda.avgAll, 2)], [181, 2, '90.50']);

  const { ranked } = rankCategory(st, '一般');
  const idx = n => ranked.findIndex(s => s.player.name === n);
  assert.ok(idx('西島郷史') < idx('高山秀樹'), '同点は回数の多い西島さんが上');
  assert.ok(ranked[idx('西島郷史')].rank < ranked[idx('高山秀樹')].rank);

  const o = overallStats(events, scores);
  assert.equal(o.total, 394);
  assert.equal(o.held, 50);
  assert.equal(fmtDecimal(o.average, 2), '7.88');

  // 書き出し→読み込みで件数・内容が変わらない
  const back = recordsToData('scores', parseCsv(scoresCsv(scores, events, players)).records).items;
  assert.equal(back.length, 394);
  const evBack = recordsToData('events', parseCsv(eventsCsv(events)).records).items;
  assert.equal(evBack.find(e => e.id === 'E028').roundNo, null);
});
