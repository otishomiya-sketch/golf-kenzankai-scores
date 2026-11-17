// スコアカード登録の通しテスト（AIの読み取り結果はテスト用の値に差し替える）
// 使い方：静的サーバー起動後、 node tests/card.e2e.cjs <CSVのフォルダ> <出力フォルダ> <適当な画像ファイル>
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  const D = process.argv[2], OUT = process.argv[3], IMG = process.argv[4];
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text())); p.on('dialog', d => d.accept());
  await p.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript', body: 'window.GOLF_CONFIG = {};' }));
  // 11/15（E075）の組：高山秀樹(83→80?)… 公式：高山秀樹 80、西島郷史 87
  const par = [5,3,4,5,4,4,4,3,4,5,5,3,4,4,4,4,3,4];
  const takayama = [6,3,5,5,4,5,5,3,5, 5,5,3,5,5,4,4,4,4];   // 41+39=80
  const nishijima = [6,4,5,6,5,5,4,3,5, 6,5,4,5,5,4,5,4,6];  // 87
  await p.addInitScript(r => { window.GOLF_TEST_READ = r; }, { is_scorecard: true, note: '3番の数字が少しかすれています', players: [
    { name_on_card: '高山', roster_match: '高山秀樹', holes: takayama, out_total: 41, in_total: 39, total: 80 },
    { name_on_card: '西島', roster_match: '西島郷史', holes: nishijima, out_total: 43, in_total: 44, total: 87 },
    { name_on_card: '???', roster_match: '', holes: [...par.slice(0, 17), null], out_total: null, in_total: null, total: null },
  ]});
  await p.goto('http://localhost:8765/#/admin?t=csv');
  await p.setInputFiles('#csv-files', ['players.csv', 'events.csv', 'scores.csv'].map(f => `${D}/${f}`));
  await p.click('[data-act="import"]'); await p.waitForSelector('#toast:not([hidden])');
  // 選手ページ → 登録ボタン
  await p.goto('http://localhost:8765/#/p/P003'); await p.reload(); await p.waitForSelector('a[href^="#/card"]');
  await p.click('a[href^="#/card"]'); await p.waitForTimeout(800);  await p.waitForSelector('#card-photo', { state: 'attached' });
  console.log('default round:', await p.$eval('#card-event', s => s.options[s.selectedIndex].text));
  await p.setInputFiles('#card-photo', IMG); await p.waitForSelector('.read-box');
  console.log('read box:', (await p.innerText('.read-box')).replace(/\s+/g, ' '));
  console.log('match:', await p.innerText('main >> text=/公式スコア/ >> nth=-1').catch(() => ''));
  const totalLine = (await p.innerText('main')).match(/合計 \S+\s+.*$/m)?.[0]; console.log(totalLine);
  assert.match(totalLine, /一致/);
  await p.check('.other-pick');           // 西島さんの分も
  await p.screenshot({ path: `${OUT}/card-entry.png`, fullPage: true });
  await p.click('[data-act=save-card]'); await p.waitForSelector('.holes-wrap');
  console.log('toast:', await p.textContent('#toast'));
  const sec = (await p.innerText('main')).split('ホール別の分析')[1]?.slice(0, 500).replace(/\s+/g, ' ');
  console.log('analysis:', sec);
  await p.evaluate(() => document.querySelector('.holes-wrap').scrollIntoView());
  await p.screenshot({ path: `${OUT}/card-analysis.png`, fullPage: true });
  // 手入力：別のラウンドで、数字を打つと次の欄へ進む
  await p.goto('http://localhost:8765/#/card?p=P003&e=E074'); await p.waitForSelector('input.hs');
  await p.click('input.hs[data-h="0"]'); await p.keyboard.type('534543534'); 
  const out = await p.$$eval('.entry-holes td.t', t => t.map(x => x.textContent)); console.log('manual OUT total:', out);
  assert.equal(out[0], '36');
  console.log('西島 page has card:', await (async () => { await p.goto('http://localhost:8765/#/p/P002'); await p.waitForSelector('main h1'); return (await p.innerText('main')).includes('スコアカード 1枚'); })());
  console.log('width', await p.evaluate(() => document.documentElement.scrollWidth), 'errors', errs);
  await b.close();
})().catch(e => { console.error('失敗', e.message); process.exit(1); });
