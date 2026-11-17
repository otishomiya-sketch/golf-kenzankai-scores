// 画面の通しテスト（デモモード）。
// 使い方：静的サーバーを起動（python3 -m http.server 8765）してから
//   GOLF_DATA_DIR=<CSVのフォルダ> node tests/e2e.cjs [スクリーンショットの保存先]
// 実データ（会員の個人情報）はリポジトリに入れないため、CSV のフォルダは外から渡す。
const { chromium } = require('playwright');
const assert = require('node:assert/strict');

const D = process.env.GOLF_DATA_DIR;
const OUT = process.argv[2];
const BASE = process.env.BASE_URL || 'http://localhost:8765/';
if (!D) { console.error('GOLF_DATA_DIR を指定してください'); process.exit(2); }

const txt = s => s.replace(/\s+/g, ' ').trim();

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', d => d.accept());
  // 通しテストはデモモード（ブラウザ内保存）で行う。本番の接続先は使わない
  await page.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript', body: 'window.GOLF_CONFIG = {};' }));
  const shot = async name => { if (OUT) await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }); };
  const toast = async () => { await page.waitForSelector('#toast:not([hidden])'); const t = await page.textContent('#toast'); await page.evaluate(() => { document.getElementById('toast').hidden = true; }); return t; };

  // 6. CSV の読み込み
  await page.goto(BASE + '#/admin?t=csv');
  await page.setInputFiles('#csv-files', ['players.csv', 'events.csv', 'scores.csv'].map(f => `${D}/${f}`));
  await page.waitForSelector('[data-act="import"]');
  const preview = txt(await page.innerText('.card'));
  console.log('取り込み確認:', preview);
  assert.match(preview, /選手 54件/); assert.match(preview, /開催回 75件/); assert.match(preview, /スコア 394件/);
  await page.click('[data-act="import"]');
  console.log('→', await toast());

  // 1. 順位表（ゲーム風：表彰台＋「あと何打」）
  await page.goto(BASE + '#/'); await page.reload(); await page.waitForSelector('.podium');
  const hero = txt(await page.innerText('.hero'));
  console.log('ヘッダー:', hero);
  assert.match(hero, /50 ?戦/); assert.match(hero, /394 ?人/);
  const pod = await page.$$eval('.pod', ps => ps.map(p => p.innerText.replace(/\s+/g, ' ')));
  console.log('表彰台:', pod);
  assert.match(pod[1], /下屋敷千尋 599/); assert.match(pod[1], /2位まで 31打 リード/);
  assert.match(pod[0], /西島郷史 630/); assert.match(pod[2], /高山秀樹 630/);
  const board = await page.$$eval('.board .rk', rs => rs.slice(0, 3).map(r => r.innerText.replace(/\s+/g, ' ')));
  console.log('4位〜:', board);
  assert.match(board[0], /^4 坂本 亮/); assert.match(board[0], /次のラウンド 79以下 で 3位に浮上/);
  // 自分を選ぶと上にカードが出る（この端末に記憶）
  await page.selectOption('#my-select', 'P005'); await page.waitForSelector('.mine-rank');
  assert.match(txt(await page.innerText(".mine")), /5 ?位/);
  await page.reload(); await page.waitForSelector('.mine-rank');
  await shot('1-ranking');
  await page.click('[data-act=my-change]'); await page.waitForSelector('#my-select');
  await page.goto(BASE + '#/?c=J'); await page.waitForTimeout(200);
  const j = txt(await page.innerText('main'));
  console.log('J:', j.slice(0, 160));
  assert.ok(j.includes('*大宮久司'), '未入会は「*」付き');
  assert.match(j, /あと7回/);

  // 2. 成績一覧
  await page.goto(BASE + '#/grid'); await page.waitForSelector('.grid');
  const honda = txt(await page.$eval('xpath=//tbody/tr[.//a[contains(.,"本田")]]', t => t.innerText));
  console.log('本田さんの行（末尾）:', honda.slice(-30));
  assert.match(honda, /181 2 90\.50$/);
  const foot = txt(await page.innerText('.grid tfoot'));
  assert.match(foot, /延べ 394人 ／ 開催 50回 ／ 1回平均 7\.88人/);
  const counts = await page.evaluate(() => ({
    yellow: document.querySelectorAll('.grid tbody td.c-yellow').length,
    blue: document.querySelectorAll('.grid tbody td.c-blue').length,
    cancelHeads: document.querySelectorAll('.grid thead th.c-cancel').length,
    errorText: /#NUM!|#DIV\/0!|NaN|undefined|Infinity/.test(document.body.innerText),
  }));
  console.log('色:', counts);
  assert.equal(counts.cancelHeads, 25);
  // 赤字＝アンダー（パー72未満：71の1件）、オレンジ＝NR（CSV の NR 列が1の行）
  const marks = await page.evaluate(() => ({
    under: [...document.querySelectorAll('.grid tbody td.t-under')].map(td => td.textContent),
    nr: [...document.querySelectorAll('.grid tbody td.t-nr')].map(td => td.textContent),
  }));
  console.log('文字の印:', marks);
  assert.deepEqual(marks.under, ['71']);
  if (process.env.EXPECT_NR) assert.deepEqual(marks.nr, ['120']);
  assert.ok((await page.innerText('.tabs')).includes('J（準会員）'));
  assert.equal(counts.errorText, false);
  await page.screenshot({ path: OUT ? `${OUT}/2-grid.png` : undefined });
  await page.evaluate(() => { document.querySelector('.grid-wrap').scrollLeft = 900; });
  if (OUT) await page.screenshot({ path: `${OUT}/2-grid-scrolled.png` });

  // 3. 選手ページ
  await page.goto(BASE + '#/p/P001'); await page.waitForSelector('svg.chart');
  const pst = txt(await page.innerText('.stats'));
  console.log('下屋敷さん:', pst);
  assert.match(pst, /1位/); assert.match(pst, /71 ベストスコア/); assert.match(pst, /522 ベスト7/); assert.match(pst, /1,313 全計/);
  assert.equal(await page.$$eval('td.b8', x => x.length), 8);
  await shot('3-player');

  // 4. スコア入力：新しい開催回を作って、前回の参加者から入力
  await page.goto(BASE + '#/admin?t=events');
  await page.fill('form[data-new="1"] input[name=date]', '2026-11-21');
  await page.click('form[data-new="1"] button.btn');
  console.log('→', await toast());
  await page.goto(BASE + '#/input?e=E076'); await page.waitForSelector('#entry-rows');
  const chips = await page.$$eval('.chip', x => x.map(c => c.textContent));
  console.log('前回の参加者の候補:', chips);
  assert.equal(chips.length, 10); // 11/15 の9人＋「全員追加」
  await page.click('[data-act="add-all-prev"]');
  const inputs = await page.$$('#entry-rows input.sc');
  await inputs[0].fill('78');
  await inputs[1].fill('160');
  await page.check('#entry-rows input.nr[data-i="1"]');
  assert.match(await page.getAttribute('#entry-rows input.sc[data-i="1"]', 'class'), /t-nr/);
  assert.match(await page.textContent('#entry-rows .warn'), /範囲外/);
  await page.fill('#add-name', '大宮');
  await page.click('[data-act="add-typed"]');
  await page.keyboard.type('88');
  await shot('4-input');
  await page.click('[data-act="save-entry"]');
  console.log('→', await toast());
  await page.goto(BASE + '#/'); await page.waitForSelector('.hero');
  const after = txt(await page.innerText('.hero'));
  console.log('保存後の全体:', after);
  assert.match(after, /51 ?戦/); assert.match(after, /397 ?人/);

  // 5. 管理：色の境目を変える
  await page.goto(BASE + '#/admin?t=settings');
  await page.fill('input[name=yellowMax]', '80');
  await page.click('form[data-form=settings] button');
  console.log('→', await toast());
  await page.goto(BASE + '#/grid'); await page.waitForSelector('.grid');
  const y80 = await page.$$eval('.grid tbody td.c-yellow', x => x.length);
  console.log('黄色のセル数 79以下→80以下:', counts.yellow, '→', y80);
  assert.ok(y80 > counts.yellow);
  // 区分の変更
  await page.goto(BASE + '#/admin?t=players');
  await shot('5-admin-players');

  // 6. CSV 書き出し→中身を確認
  await page.goto(BASE + '#/admin?t=csv');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act=export][data-kind=scores]')]);
  const fs = require('node:fs');
  const p = await dl.path();
  const buf = fs.readFileSync(p);
  assert.equal(buf.subarray(0, 3).toString('hex'), 'efbbbf', 'BOM 付き');
  const lines = buf.toString('utf8').trim().split('\r\n');
  console.log('書き出し scores.csv:', lines.length - 1, '件 先頭:', lines[0].replace('﻿', ''));
  assert.equal(lines.length - 1, 397);
  assert.equal(lines[0].replace('\uFEFF', ''), '開催ID,日付,選手ID,氏名,スコア,NR');
  assert.equal(lines.filter(l => l.endsWith(',1')).length, process.env.EXPECT_NR ? 2 : 1);

  // 画面幅：ページ全体に横スクロールが出ないこと
  for (const r of ['#/', '#/grid', '#/p/P002', '#/admin?t=events', '#/input']) {
    await page.goto(BASE + r); await page.waitForTimeout(150);
    const w = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(w <= 390, `${r} の幅 ${w}`);
  }
  assert.deepEqual(errors, []);
  console.log('すべて合格');
  await browser.close();
})().catch(e => { console.error('失敗:', e.message); process.exit(1); });
