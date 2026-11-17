// 画面。URL の「#/…」で画面を切り替える1ページのアプリ。
import {
  CATEGORIES, RANK_MIN_ROUNDS, displayName, sortEvents, playerStats, rankCategory, overallStats,
  scoreColor, scoreMark, fmtDecimal, fmtInt, checkScore, compareNumber, DEFAULT_SETTINGS, CATEGORY_LABEL,
  seasonEvents, selectionRanking, SELECTION_RECENT, SELECTION_NEW_SEASON,
} from './stats.js';
import { parseCsv, detectKind, recordsToData, playersCsv, eventsCsv, scoresCsv, defaultLabel } from './csv.js';
import { store, DEMO, MEMBER_EMAIL } from './store.js';
import { gameBoard } from './game.js';

const $app = document.getElementById('app');
const state = { data: null, stats: null, overall: null, session: { user: null, admin: false } };

// ---------- 共通 ----------
const h = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const colorClass = s => { const c = scoreColor(s, state.data.settings); return c ? `c-${c}` : ''; };
// 文字の印：アンダー＝赤、NR（途中棄権）＝オレンジ
const markClass = s => { const m = scoreMark(s, state.data.settings); return m ? `t-${m}` : ''; };
const markTitle = s => s.nr ? '途中棄権（NR）' : s.score < state.data.settings.par ? 'アンダー' : '';
const kindBadge = e => e.kind === 'CT' ? '<span class="badge">CT</span>' : e.kind === '納会' ? '<span class="badge nk">納会</span>' : '';

function toast(msg, isError = false) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = isError ? 'error' : ''; t.hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { t.hidden = true; }, isError ? 6000 : 2500);
}

function route() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, query] = raw.split('?');
  return { parts: path.split('/').filter(Boolean), q: new URLSearchParams(query || '') };
}
const go = hash => { if (location.hash === hash) render(); else location.hash = hash; };

async function reload() {
  state.data = await store.load();
  state.data.settings = { ...DEFAULT_SETTINGS, ...state.data.settings };
  // 順位・成績一覧などは「今シーズン」の回だけで集計する（選考日以降の回も、次の切り替えまでは表示する）
  state.events = seasonEvents(state.data.events, { seasonStart: state.data.settings.seasonStart });
  state.stats = playerStats(state.data.players, state.events, state.data.scores);
  state.overall = overallStats(state.events, state.data.scores);
}

function nav(active) {
  const items = signedOut() ? [] : [['ranking', '#/', '順位表'], ['grid', '#/grid', '成績一覧'], ['selection', '#/selection', '選手選考']];
  if (state.session.admin) items.push(['input', '#/input', 'スコア入力'], ['admin', '#/admin', '管理']);
  document.getElementById('nav').innerHTML = items.map(([k, href, label]) =>
    `<a href="${href}" class="${k === active ? 'on' : ''}">${label}</a>`).join('');
  const foot = document.getElementById('foot');
  if (DEMO) foot.innerHTML = '';
  else if (state.session.admin) foot.innerHTML = `${h(state.session.user.email)}（管理者） ・ <a href="#/account">パスワード変更</a> ・ <a href="#" data-act="logout">ログアウト</a>`;
  else if (state.session.user) foot.innerHTML = '会員としてログイン中 ・ <a href="#" data-act="logout">ログアウト</a>';
  else foot.innerHTML = active === 'login' ? '<a href="#/">会員の方はこちら</a>' : '<a href="#/login">管理者ログイン</a>';
}

// ---------- 1. 順位表 ----------
// ---------- 1. 順位表（ゲームのように「あと何打で上へ」を見せる） ----------
const MY_KEY = 'golf-kenzankai-my-player';
const myPlayerId = () => { try { return localStorage.getItem(MY_KEY) || ''; } catch { return ''; } };
const setMyPlayer = id => { try { id ? localStorage.setItem(MY_KEY, id) : localStorage.removeItem(MY_KEY); } catch { /* 保存できなくても表示は続ける */ } };

function moveTag(m) {
  if (m === 'new') return '<span class="mv new" title="今回ランキング入り">NEW</span>';
  if (m > 0) return `<span class="mv up" title="前回から${m}つ上がった">▲${m}</span>`;
  if (m < 0) return `<span class="mv down" title="前回から${-m}つ下がった">▼${-m}</span>`;
  return '';
}
const badgeHtml = bs => bs.map(b => `<span class="bdg" title="${h(b.label)}" aria-label="${h(b.label)}">${b.icon}</span>`).join('');
const plink = (s, inner) => `<a href="#/p/${encodeURIComponent(s.player.id)}">${inner}</a>`;

function goalText(r) {
  if (r.lead !== null && r.lead !== undefined) return r.lead > 0 ? `2位まで <b>${r.lead}打</b> リード` : '首位タイ';
  if (r.target) return `次のラウンド <b>${r.target}以下</b> で ${r.above.rank}位に浮上`;
  if (r.gapUp !== null) return r.gapUp === 0 ? `${r.above.rank}位と同スコア（回数・全計の差）` : `${r.above.rank}位まで あと <b>${r.gapUp}打</b>`;
  return '';
}

function viewRanking(q) {
  const cat = CATEGORIES.includes(q.get('c')) ? q.get('c') : '一般';
  const board = gameBoard(state.data.players, state.events, state.data.scores, cat, state.data.settings);
  const { rows, waiting, latest } = board;
  const o = state.overall;
  const mine = myPlayerId();
  const myRow = rows.find(r => r.player.id === mine);
  const myWait = waiting.find(r => r.player.id === mine);
  const myPlayer = state.data.players.find(p => p.id === mine);

  // マイ選手（この端末に記憶）
  let myCard = '';
  if (myRow) {
    myCard = `<div class="mine anim" style="--i:0">
      <div class="mine-rank"><small>あなたの順位</small><b>${myRow.rank}<i>位</i></b>${moveTag(myRow.move)}</div>
      <div class="mine-body"><div class="mine-name">${h(displayName(myRow.player))} ${badgeHtml(myRow.badges)}</div>
        <div class="mine-goal">${goalText(myRow)}</div>
        <div class="small muted">ベスト8 ${fmtInt(myRow.best8)}・回数 ${myRow.count}</div></div>
      <button type="button" class="linkish" data-act="my-change">変更</button></div>`;
  } else if (myWait) {
    myCard = `<div class="mine anim" style="--i:0">
      <div class="mine-rank"><small>ランキング入りまで</small><b>${myWait.toGo}<i>回</i></b></div>
      <div class="mine-body"><div class="mine-name">${h(displayName(myWait.player))} ${badgeHtml(myWait.badges)}</div>
        <div class="dots" aria-label="${myWait.count}/${RANK_MIN_ROUNDS}ラウンド">${dots(myWait.count)}</div></div>
      <button type="button" class="linkish" data-act="my-change">変更</button></div>`;
  } else if (!myPlayer || myPlayer.category === cat) {
    const opts = state.data.players.filter(p => p.category === cat).sort(compareNumber)
      .map(p => `<option value="${h(p.id)}">${h(displayName(p))}</option>`).join('');
    myCard = `<div class="mine pick anim" style="--i:0"><label class="grow">⛳ 自分を選ぶと、順位と「次の目標スコア」をいつもここに表示します
      <select id="my-select"><option value="">選んでください</option>${opts}</select></label></div>`;
  }

  const top = rows.filter(r => r.rank <= 3);
  const rest = rows.filter(r => r.rank > 3);
  const medal = { 1: '🥇', 2: '🥈', 3: '🥉' };
  const podium = top.length >= 3 && new Set(top.map(r => r.rank)).size === 3 ? `<div class="podium">${[top[1], top[0], top[2]].map((r, i) => `
      <div class="pod p${r.rank} anim ${r.player.id === mine ? 'me' : ''}" style="--i:${[2, 1, 3][i]}">
        ${plink(r, `<div class="medal">${medal[r.rank]}</div><div class="pod-name">${h(displayName(r.player))}</div>
        <div class="pod-score">${fmtInt(r.best8)}</div><div class="pod-sub">${moveTag(r.move)} ${badgeHtml(r.badges)}</div>
        <div class="pod-goal">${goalText(r)}</div>`)}
        <div class="pod-base">${r.rank}</div></div>`).join('')}</div>` : '';
  const listRows = podium ? rest : rows;

  const card = (r, i) => `<li class="rk anim ${r.player.id === mine ? 'me' : ''}" style="--i:${Math.min(i + 4, 20)}">
    ${plink(r, `<span class="rk-no">${r.rank}</span>
      <span class="rk-main"><span class="rk-name">${h(displayName(r.player))} ${badgeHtml(r.badges)}</span>
        <span class="rk-goal">${goalText(r)}</span></span>
      <span class="rk-side"><b>${fmtInt(r.best8)}</b>${moveTag(r.move)}</span>`)}</li>`;

  return `
    <div class="hero anim" style="--i:0">
      <div><small>${latest ? `${h(latest.label)} 終了時点` : 'シーズン開始前'}</small><b>年間ランキング</b></div>
      <div class="hero-stats"><span><b>${o.held}</b>戦</span><span><b>${fmtInt(o.total)}</b>人</span></div>
    </div>
    <div class="tabs" role="tablist">${CATEGORIES.map(c => `<a role="tab" aria-selected="${c === cat}" class="${c === cat ? 'on' : ''}" href="#/?c=${encodeURIComponent(c)}">${CATEGORY_LABEL[c]}</a>`).join('')}</div>
    ${myCard}
    ${rows.length ? podium + `<ol class="board">${listRows.map(card).join('')}</ol>` : `<p class="muted">${RANK_MIN_ROUNDS}ラウンド以上の選手はまだいません。</p>`}
    ${waiting.length ? `<h2>ランキング入りまで、あと少し</h2><ul class="waiting">${waiting.map((w, i) => `
      <li class="anim ${w.player.id === mine ? 'me' : ''}" style="--i:${Math.min(i + 6, 20)}">${plink(w, `<span class="w-name">${h(displayName(w.player))} ${badgeHtml(w.badges)}</span>
        <span class="dots" aria-label="${w.count}/${RANK_MIN_ROUNDS}">${dots(w.count)}</span><span class="w-left">あと${w.toGo}回</span>`)}</li>`).join('')}</ul>` : ''}
    <details class="small muted legend-box"><summary>見方</summary>
      <p>数字はベスト8の合計（少ないほど上）。「次のラウンド○以下で浮上」は、次の1ラウンドでそのスコア以下を出せば1つ上に上がれる目安です。▲▼は前回の開催からの順位の変化。</p>
      <p>🔥 好調（直近3回が平均より2打以上良い）　🎯 前回自己ベスト　🦅 アンダーを出した　💪 参加回数が最多</p>
      <p>同点は回数の多い順 → 全計の少ない順 → 直近のスコアが良い順。氏名の「*」は未入会・他クラブ。</p></details>`;
}
const dots = n => Array.from({ length: RANK_MIN_ROUNDS }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('');

// ---------- 2. 成績一覧（選手×開催回） ----------
function viewGrid(q) {
  const cat = CATEGORIES.includes(q.get('c')) ? q.get('c') : '';
  const events = sortEvents(state.events);
  const scoreMap = new Map(state.data.scores.map(s => [s.eventId + '|' + s.playerId, s]));
  const o = state.overall;
  const s = state.data.settings;
  const cats = cat ? [cat] : CATEGORIES;
  const head = `<tr><th class="nm">氏名</th>${events.map(e => `<th class="${e.cancelled ? 'c-cancel' : ''}" title="${h(e.date)}">
      ${kindBadge(e)}<span class="ev-label">${h(e.label)}</span><span class="ev-no">${e.cancelled ? '中止' : e.roundNo ? `第${e.roundNo}回` : '&nbsp;'}</span></th>`).join('')}
      <th class="sum">ベスト7</th><th class="sum">ベスト8</th><th class="sum">平均⑧</th><th class="sum">全計</th><th class="sum">回数</th><th class="sum">全平均</th></tr>`;
  const body = cats.map(c => {
    const players = state.data.players.filter(p => p.category === c).sort(compareNumber);
    if (!players.length) return '';
    return `<tr class="cat"><td class="nm">${CATEGORY_LABEL[c]}</td><td colspan="${events.length + 6}"></td></tr>` + players.map(p => {
      const st = state.stats.get(p.id);
      return `<tr><td class="nm"><span class="num">${h(p.number)}</span><a href="#/p/${encodeURIComponent(p.id)}">${h(displayName(p))}</a></td>
        ${events.map(e => {
          const v = scoreMap.get(e.id + '|' + p.id);
          if (!v) return `<td class="${e.cancelled ? 'c-cancel' : ''}"></td>`;
          const cls = (e.cancelled ? 'c-cancel' : colorClass(v.score)) + ' ' + markClass(v);
          return `<td class="${cls}" ${markTitle(v) ? `title="${markTitle(v)}"` : ''}>${v.score}</td>`;
        }).join('')}
        <td class="sum">${fmtInt(st.best7)}</td><td class="sum">${fmtInt(st.best8)}</td><td class="sum">${fmtDecimal(st.avg8, 3)}</td>
        <td class="sum">${st.count ? fmtInt(st.total) : '—'}</td><td class="sum">${st.count}</td><td class="sum">${fmtDecimal(st.avgAll, 2)}</td></tr>`;
    }).join('');
  }).join('');
  const foot = `<tr><th class="nm">参加人数</th>${events.map(e => `<td class="${e.cancelled ? 'c-cancel' : ''}">${e.cancelled ? '' : o.perEvent.get(e.id)}</td>`).join('')}
    <td colspan="6" style="text-align:left">延べ ${fmtInt(o.total)}人 ／ 開催 ${o.held}回 ／ 1回平均 ${fmtDecimal(o.average, 2)}人</td></tr>`;
  return `
    <div class="tabs">${['', ...CATEGORIES].map(c => `<a class="${c === cat ? 'on' : ''}" href="#/grid${c ? '?c=' + encodeURIComponent(c) : ''}">${c ? CATEGORY_LABEL[c] : '全員'}</a>`).join('')}</div>
    <div class="legend">
      <span><i class="c-yellow"></i>${s.yellowMax}以下</span><span><i class="c-blue"></i>${s.yellowMax + 1}〜${s.blueMax}</span>
      <span><i class="c-cancel"></i>中止</span><span><b class="t-under">赤字</b>アンダー（${s.par - 1}以下）</span><span><b class="t-nr">オレンジ</b>途中棄権（NR）</span>
      <span><span class="badge">CT</span> チャンピオンティー</span><span>横にスクロールできます</span>
    </div>
    <div class="grid-wrap"><table class="grid"><thead>${head}</thead><tbody>${body}</tbody><tfoot>${foot}</tfoot></table></div>`;
}

// ---------- 選手選考（細則（2）：ベスト8＋直近12枚の平均） ----------
function todayJst() { return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }); }
function viewSelection() {
  const s = state.data.settings;
  const r = selectionRanking(state.data.players, state.data.events, state.data.scores, { seasonStart: s.seasonStart, selectionDate: s.selectionDate, today: todayJst() });
  const fmtDate = d => d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : '';
  const head = r.final
    ? `<div class="notice">選考確定（${h(s.selectionDate.replaceAll('-', '/'))} 締め）</div>`
    : `<div class="notice">暫定順位です。${s.selectionDate ? `選考の締め日：${h(s.selectionDate.replaceAll('-', '/'))}` : '選考の締め日は未定です'}。
       締め日の時点で ${r.year}年4月以降のスコアが${SELECTION_NEW_SEASON}枚に満たない人は対象外になります。</div>`;
  const row = x => `<tr>
    <td class="rank">${x.rank}</td>
    <td class="name"><a href="#/p/${encodeURIComponent(x.player.id)}">${h(displayName(x.player))}</a></td>
    <td>${fmtInt(x.best8)}</td><td>${x.avg12.toFixed(1)}</td><td><b>${x.points.toFixed(1)}</b></td>
    <td class="${x.newSeasonOk ? '' : 'warn'}">${x.newSeason}/${SELECTION_NEW_SEASON}</td></tr>`;
  return `<h1>選手選考 <span class="small muted">${r.year}年</span></h1>${head}
    <table class="list">
      <thead><tr><th class="rank">順位</th><th class="name">氏名</th><th>ベスト8</th><th>12枚平均</th><th>合計</th><th>4月〜</th></tr></thead>
      <tbody>${r.ranked.map(row).join('') || `<tr><td colspan="6" class="name muted">対象者はまだいません</td></tr>`}</tbody>
    </table>
    <p class="small muted">合計＝ベスト8＋直近${SELECTION_RECENT}枚の平均（小数第1位まで・以下切り捨て）。少ない順。同点は12枚平均の良い方が上。
      対象は選手会員（一般で「*」の付かない方）で、今シーズン${SELECTION_RECENT}枚以上。「4月〜」は${fmtDate(r.newSeasonFrom)}以降の枚数。</p>
    ${r.excluded.length ? `<h2>対象外（${r.final ? `${SELECTION_RECENT}枚未満、または4月以降${SELECTION_NEW_SEASON}枚未満` : `${SELECTION_RECENT}枚未満`}）</h2>
      <p class="small">${r.excluded.map(x => `${h(displayName(x.player))}（${x.count}枚）`).join('、')}</p>` : ''}`;
}

// ---------- 3. 選手ページ ----------
function viewPlayer(id) {
  const st = state.stats.get(id);
  if (!st) return '<p>選手が見つかりません。</p>';
  const p = st.player;
  const evMap = new Map(state.data.events.map(e => [e.id, e]));
  const { ranked } = rankCategory(state.stats, p.category);
  const me = ranked.find(r => r.player.id === id);
  return `
    <p class="small"><a href="#/?c=${encodeURIComponent(p.category)}">← ${h(p.category)}の順位表</a></p>
    <h1>${h(displayName(p))} <span class="small muted">${h(p.category)} ${h(p.number)}</span></h1>
    ${playerGoal(p)}
    <div class="stats">
      <div class="stat"><b>${me ? `${me.rank}位` : '順位外'}</b><span>${h(p.category)}の順位</span></div>
      <div class="stat"><b>${st.bestScore ?? '—'}</b><span>ベストスコア</span></div>
      <div class="stat"><b>${fmtInt(st.best8)}</b><span>ベスト8</span></div>
      <div class="stat"><b>${fmtDecimal(st.avg8, 3)}</b><span>平均⑧</span></div>
      <div class="stat"><b>${fmtInt(st.best7)}</b><span>ベスト7</span></div>
      <div class="stat"><b>${st.count}</b><span>回数</span></div>
      <div class="stat"><b>${st.count ? fmtInt(st.total) : '—'}</b><span>全計</span></div>
      <div class="stat"><b>${fmtDecimal(st.avgAll, 2)}</b><span>全平均</span></div>
    </div>
    ${st.count ? `<div class="card">${chart(st, evMap)}</div>` : '<p class="muted">まだスコアがありません。</p>'}
    ${st.count ? `<h2>スコア一覧</h2>
    <table class="list"><thead><tr><th class="name">日付</th><th class="name">回</th><th>スコア</th><th class="name">　</th></tr></thead><tbody>
      ${[...st.rounds].reverse().map(r => { const e = evMap.get(r.eventId); const b8 = st.best8EventIds.has(r.eventId); return `<tr>
        <td class="name">${h(e.date.replaceAll('-', '/'))}</td><td class="name">${h(e.label)} ${kindBadge(e)}</td>
        <td class="${colorClass(r.score)} ${markClass(r)} ${b8 ? 'b8' : ''}">${r.score}</td><td class="name small">${[b8 ? 'ベスト8' : '', markTitle(r)].filter(Boolean).join('・')}</td></tr>`; }).join('')}
    </tbody></table>
    <p class="small muted">${st.count >= 8 ? '枠で囲んだスコアがベスト8の計算に使われています（同じスコアは早い回を優先）。' : `${RANK_MIN_ROUNDS}ラウンドに達するとベスト8が計算されます。`}</p>` : ''}`;
}

// 選手ページの「次の目標」
function playerGoal(p) {
  const { rows, waiting } = gameBoard(state.data.players, state.events, state.data.scores, p.category, state.data.settings);
  const r = rows.find(x => x.player.id === p.id), w = waiting.find(x => x.player.id === p.id);
  const isMine = myPlayerId() === p.id;
  const mineBtn = isMine ? '<span class="small muted">⛳ この端末の「自分」に設定中</span>'
    : `<button type="button" class="btn sub sm" data-act="my-set" data-id="${h(p.id)}">これは自分（順位表に表示）</button>`;
  if (r) return `<div class="goal anim" style="--i:0"><div class="goal-rank">${r.rank}<i>位</i> ${moveTag(r.move)}</div>
    <div class="goal-text">${goalText(r)} ${badgeHtml(r.badges)}</div>${mineBtn}</div>`;
  if (w) return `<div class="goal anim" style="--i:0"><div class="goal-rank">あと${w.toGo}<i>回</i></div>
    <div class="goal-text">ランキング入りまで <span class="dots">${dots(w.count)}</span> ${badgeHtml(w.badges)}</div>${mineBtn}</div>`;
  return `<div class="goal">${mineBtn}</div>`;
}

function chart(st, evMap) {
  // 画面の幅に合わせて実寸で描く（拡大して文字や点が大きくなりすぎないように）。高さは幅の約3分の1、180〜240px
  const W = Math.round(Math.min(1060, Math.max(300, ($app.clientWidth || 390) - 60)));
  const H = Math.round(Math.min(240, Math.max(180, W * 0.32)));
  const L = 30, R = 10, T = 12, B = 26;
  const pts = st.rounds;
  const vals = pts.map(r => r.score);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  lo = Math.floor((lo - 2) / 5) * 5; hi = Math.ceil((hi + 2) / 5) * 5;
  const x = i => pts.length === 1 ? (L + W - R) / 2 : L + (W - L - R) * i / (pts.length - 1);
  const y = v => T + (H - T - B) * (hi - v) / (hi - lo);
  const ticks = []; for (let v = lo; v <= hi; v += (hi - lo > 30 ? 10 : 5)) ticks.push(v);
  const avg = st.avgAll;
  const step = Math.max(1, Math.ceil(pts.length / Math.max(2, Math.floor((W - L - R) / 70))));  // 日付ラベルは約70pxおき
  const showLabel = i => i === pts.length - 1 || (i % step === 0 && x(pts.length - 1) - x(i) >= 50);
  return `<svg class="chart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="スコアの推移">
    ${ticks.map(v => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join('')}
    <line x1="${L}" x2="${W - R}" y1="${y(avg)}" y2="${y(avg)}" stroke="var(--accent)" stroke-dasharray="4 4"/>
    <text x="${W - R}" y="${y(avg) - 4}" text-anchor="end">平均 ${fmtDecimal(avg, 2)}</text>
    <polyline fill="none" stroke="var(--chart-line)" stroke-width="1.5" points="${pts.map((r, i) => `${x(i)},${y(r.score)}`).join(' ')}"/>
    ${pts.map((r, i) => { const b8 = st.best8EventIds.has(r.eventId); return `<circle cx="${x(i)}" cy="${y(r.score)}" r="${b8 ? 5 : 4}" fill="${b8 ? 'var(--accent)' : 'var(--surface)'}" stroke="var(--accent)" stroke-width="1.5"><title>${h(evMap.get(r.eventId).label)}：${r.score}</title></circle>`; }).join('')}
    ${pts.map((r, i) => showLabel(i) ? `<text x="${x(i)}" y="${H - 8}" text-anchor="${pts.length > 1 && i === pts.length - 1 ? 'end' : i === 0 && pts.length > 1 ? 'start' : 'middle'}">${h(evMap.get(r.eventId).label)}</text>` : '').join('')}
  </svg><p class="small muted" style="margin:4px 0 0">● 塗りつぶし＝ベスト8に使われたスコア　点線＝全平均</p>`;
}

// ---------- 4. スコア入力 ----------
const entry = { eventId: null, rows: [], dirty: false };

function viewInput(q) {
  const events = sortEvents(state.data.events);
  if (!events.length) return '<p>開催回がありません。</p><p><a class="btn" href="#/admin?t=csv">CSV を取り込む</a> <a class="btn sub" href="#/admin?t=events">開催回を追加</a></p>';
  const want = q.get('e');
  if (want && want !== entry.eventId) loadEntry(want);
  if (!entry.eventId || !events.some(e => e.id === entry.eventId)) {
    // 既定：今日以前で最も新しい中止でない回
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
    const def = [...events].reverse().find(e => !e.cancelled && e.date <= today) || events[events.length - 1];
    loadEntry(def.id);
  }
  const ev = events.find(e => e.id === entry.eventId);
  const prev = previousParticipants(ev);
  const inList = new Set(entry.rows.map(r => r.playerId));
  const suggestions = prev.filter(p => !inList.has(p.id));
  const players = [...state.data.players].sort((a, b) => CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category) || compareNumber(a, b));
  return `
    <h1>スコア入力</h1>
    <label class="f">開催回
      <select id="ev-select">${[...events].reverse().map(e => `<option value="${h(e.id)}" ${e.id === ev.id ? 'selected' : ''}>${h(e.label)}（${h(e.date)}）${e.kind !== '通常' ? ' ' + e.kind : ''}${e.cancelled ? ' 中止' : ''}</option>`).join('')}</select>
    </label>
    ${ev.cancelled ? '<div class="notice">この回は「中止」に設定されています。スコアを入れる場合は、管理画面で中止を外してください。</div>' : ''}
    ${suggestions.length ? `<div class="small muted">前回（${h(prev.eventLabel)}）の参加者：タップで追加</div>
      <div class="chips">${suggestions.map(p => `<button type="button" class="chip" data-act="add-player" data-id="${h(p.id)}">＋${h(displayName(p))}</button>`).join('')}
      <button type="button" class="chip" data-act="add-all-prev">全員追加</button></div>` : ''}
    <div class="row">
      <input id="add-name" class="grow" list="player-list" placeholder="選手を追加（番号か氏名）" autocomplete="off">
      <button type="button" class="btn sub" data-act="add-typed">追加</button>
    </div>
    <datalist id="player-list">${players.map(p => `<option value="${h(p.category === '一般' ? '' : p.category)}${h(p.number)} ${h(displayName(p))}">`).join('')}</datalist>
    <table class="entry" style="margin-top:10px"><tbody id="entry-rows">${entryRows()}</tbody></table>
    <div class="sticky-actions row">
      <span class="grow small muted" id="entry-count">${entrySummary()}</span>
      <button type="button" class="btn" data-act="save-entry">保存</button>
    </div>`;
}

function loadEntry(eventId) {
  entry.eventId = eventId;
  const pl = new Map(state.data.players.map(p => [p.id, p]));
  entry.rows = state.data.scores.filter(s => s.eventId === eventId)
    .map(s => ({ playerId: s.playerId, value: String(s.score), nr: !!s.nr }))
    .sort((a, b) => compareNumber(pl.get(a.playerId) || { number: '', id: a.playerId }, pl.get(b.playerId) || { number: '', id: b.playerId }));
  entry.dirty = false;
}

function previousParticipants(ev) {
  const events = sortEvents(state.data.events);
  const idx = events.findIndex(e => e.id === ev.id);
  for (let i = idx - 1; i >= 0; i--) {
    const e = events[i];
    if (e.cancelled) continue;
    const ids = state.data.scores.filter(s => s.eventId === e.id).map(s => s.playerId);
    if (!ids.length) continue;
    const list = state.data.players.filter(p => ids.includes(p.id)).sort(compareNumber);
    list.eventLabel = e.label;
    return list;
  }
  return Object.assign([], { eventLabel: '' });
}

function entryRows() {
  const pl = new Map(state.data.players.map(p => [p.id, p]));
  if (!entry.rows.length) return '<tr><td class="muted">参加者を追加してください。</td></tr>';
  return entry.rows.map((r, i) => {
    const p = pl.get(r.playerId);
    const c = checkScore(r.value, state.data.settings);
    const msg = !c.ok ? `<span class="err">${c.message}</span>` : c.warn ? `<span class="warn">${c.message}</span>` : c.empty ? '<span class="muted">未入力</span>' : '';
    return `<tr data-i="${i}">
      <td>${p ? h(displayName(p)) : h(r.playerId)}<div class="msg">${msg}</div></td>
      <td style="width:3.5em" class="small"><label title="途中棄権"><input type="checkbox" class="nr" data-i="${i}" ${r.nr ? 'checked' : ''}> NR</label></td>
      <td style="width:6em"><input class="sc ${c.ok && !c.empty ? colorClass(c.value) + ' ' + markClass({ score: c.value, nr: r.nr }) : ''}" inputmode="numeric" pattern="[0-9]*" maxlength="3" value="${h(r.value)}" data-i="${i}" aria-label="${p ? h(p.name) : ''}のスコア"></td>
      <td style="width:2.5em"><button type="button" class="btn danger sm" data-act="remove-row" data-i="${i}" aria-label="削除">×</button></td></tr>`;
  }).join('');
}
function entrySummary() {
  const filled = entry.rows.filter(r => checkScore(r.value, state.data.settings).value != null).length;
  return `${entry.rows.length}人（入力済み ${filled}人）${entry.dirty ? '・未保存' : ''}`;
}
function addToEntry(ids) {
  const have = new Set(entry.rows.map(r => r.playerId));
  const added = ids.filter(id => !have.has(id));
  added.forEach(id => entry.rows.push({ playerId: id, value: '', nr: false }));
  if (added.length) entry.dirty = true;
  render();
  if (added.length === 1) document.querySelector(`#entry-rows input.sc[data-i="${entry.rows.length - 1}"]`)?.focus();
}
function resolveTyped(text) {
  const t = text.trim().replace(/\s+/g, ' ');
  if (!t) return null;
  const ps = state.data.players;
  const label = p => `${p.category === '一般' ? '' : p.category}${p.number} ${displayName(p)}`;
  return ps.find(p => label(p) === t)
    || ps.find(p => p.name.replace(/\s|　/g, '') === t.replace(/^\*/, '').replace(/\s|　/g, ''))
    || ps.find(p => p.category === '一般' && p.number === t)
    || (ps.filter(p => p.name.includes(t)).length === 1 ? ps.find(p => p.name.includes(t)) : null);
}

async function saveEntry() {
  const results = entry.rows.map(r => ({ r, c: checkScore(r.value, state.data.settings) }));
  const bad = results.filter(x => !x.c.ok);
  if (bad.length) { toast('正しくないスコアがあります。赤字の行を直してください', true); return; }
  const empty = results.filter(x => x.c.empty);
  const warns = results.filter(x => x.c.warn);
  const pl = new Map(state.data.players.map(p => [p.id, p]));
  const lines = [];
  if (warns.length) lines.push(`${state.data.settings.warnMin}〜${state.data.settings.warnMax}の範囲外：` + warns.map(x => `${pl.get(x.r.playerId)?.name} ${x.c.value}`).join('、'));
  if (empty.length) lines.push(`未入力の${empty.length}人は保存されません`);
  if (lines.length && !confirm(lines.join('\n') + '\n\nこのまま保存しますか？')) return;
  const rows = results.filter(x => !x.c.empty).map(x => ({ playerId: x.r.playerId, score: x.c.value, nr: !!x.r.nr }));
  await withBusy(async () => {
    await store.replaceEventScores(entry.eventId, rows);
    await reload();
    loadEntry(entry.eventId);
    toast(`保存しました（${rows.length}人）`);
  });
}

// ---------- 5. 管理 ----------
function nextId(prefix, list) {
  const max = list.reduce((m, x) => { const n = Number(String(x.id).replace(/^\D+/, '')); return Number.isFinite(n) && n > m ? n : m; }, 0);
  return prefix + String(max + 1).padStart(3, '0');
}

function viewAdmin(q) {
  const tab = ['players', 'events', 'settings', 'season', 'csv'].includes(q.get('t')) ? q.get('t') : 'events';
  const tabs = [['events', '開催回'], ['players', '選手'], ['season', 'シーズン'], ['settings', '色分け'], ['csv', 'CSV']];
  const body = { players: adminPlayers, events: adminEvents, settings: adminSettings, season: adminSeason, csv: adminCsv }[tab]();
  return `<h1>管理</h1><div class="tabs">${tabs.map(([k, l]) => `<a class="${k === tab ? 'on' : ''}" href="#/admin?t=${k}">${l}</a>`).join('')}</div>${body}`;
}

function adminPlayers() {
  const players = [...state.data.players].sort((a, b) => CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category) || compareNumber(a, b));
  const form = (p, isNew) => `<form class="edit-item" data-form="player" data-id="${h(p.id)}" data-new="${isNew ? 1 : ''}">
    <div class="row">
      <label class="f">番号<input name="number" value="${h(p.number)}" required></label>
      <label class="f" style="flex:2 1 160px">氏名<input name="name" value="${h(p.name)}" required></label>
      <label class="f">区分<select name="category">${CATEGORIES.map(c => `<option value="${c}" ${c === p.category ? 'selected' : ''}>${CATEGORY_LABEL[c]}</option>`).join('')}</select></label>
    </div>
    <div class="row">
      <label class="small grow"><input type="checkbox" name="nonMember" ${p.nonMember ? 'checked' : ''}> 未入会・他クラブ（氏名の前に「*」）</label>
      <span class="small muted">${h(p.id)}${isNew ? '' : ` ・ ${state.stats.get(p.id)?.count ?? 0}回`}</span>
      <button class="btn sm">${isNew ? '追加' : '保存'}</button>
      ${isNew ? '' : `<button type="button" class="btn danger sm" data-act="delete-player" data-id="${h(p.id)}">削除</button>`}
    </div></form>`;
  return `<h2>選手を追加</h2>${form({ id: nextId('P', state.data.players), number: '', name: '', category: '一般', nonMember: false }, true)}
    <h2>登録済み（${players.length}人）</h2><div class="edit-list">${players.map(p => form(p, false)).join('')}</div>
    <p class="small muted">スコアがある選手は削除できません。区分を変えると、順位表もその区分に移ります。</p>`;
}

function adminEvents() {
  const events = sortEvents(state.data.events).reverse();
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  const maxRound = state.data.events.reduce((m, e) => Math.max(m, e.roundNo || 0), 0);
  const form = (e, isNew) => `<form class="edit-item ${e.cancelled ? 'cancelled' : ''}" data-form="event" data-id="${h(e.id)}" data-new="${isNew ? 1 : ''}">
    <div class="row">
      <label class="f">日付<input type="date" name="date" value="${h(e.date)}" required></label>
      <label class="f">表示名<input name="label" value="${h(e.label)}" placeholder="例：9/6①"></label>
      <label class="f">回番号<input name="roundNo" inputmode="numeric" value="${e.roundNo ?? ''}" placeholder="空欄可"></label>
      <label class="f">種別<select name="kind">${['通常', 'CT', '納会'].map(k => `<option ${k === e.kind ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
    </div>
    <div class="row">
      <label class="small grow"><input type="checkbox" name="cancelled" ${e.cancelled ? 'checked' : ''}> 中止</label>
      <span class="small muted">${h(e.id)}${isNew ? '' : ` ・ ${state.overall.perEvent.get(e.id) ?? 0}人`}</span>
      ${isNew ? '' : `<a class="btn sub sm" href="#/input?e=${encodeURIComponent(e.id)}">スコア</a>`}
      <button class="btn sm">${isNew ? '追加' : '保存'}</button>
      ${isNew ? '' : `<button type="button" class="btn danger sm" data-act="delete-event" data-id="${h(e.id)}">削除</button>`}
    </div></form>`;
  return `<h2>開催回を追加</h2>${form({ id: nextId('E', state.data.events), date: today, label: '', roundNo: maxRound + 1, kind: '通常', cancelled: false }, true)}
    <p class="small muted">表示名を空欄にすると日付（例：${h(defaultLabel(today))}）になります。同じ日に2回ある場合は「9/6①」「9/6②」のように分けてください。</p>
    <h2>登録済み（${events.length}回）</h2><div class="edit-list">${events.map(e => form(e, false)).join('')}</div>`;
}

function adminSettings() {
  const s = state.data.settings;
  return `<form class="card" data-form="settings" style="max-width:420px">
    <label class="f">黄色にする上限（この数字以下）<input type="number" name="yellowMax" value="${s.yellowMax}" min="1" max="300" required></label>
    <label class="f">水色にする上限（黄色の次〜この数字）<input type="number" name="blueMax" value="${s.blueMax}" min="1" max="300" required></label>
    <label class="f">パー（これより少ないスコアを赤字＝アンダーにする）<input type="number" name="par" value="${s.par}" min="1" max="300" required></label>
    <div class="legend" id="settings-preview"></div>
    <button class="btn">保存</button></form>
    <p class="small muted">スコア入力の警告は ${s.warnMin}〜${s.warnMax} の範囲外で出ます。</p>`;
}
function settingsPreview(form) {
  const y = Number(form.yellowMax.value), b = Number(form.blueMax.value);
  const el = document.getElementById('settings-preview');
  if (!el) return;
  el.innerHTML = y < b ? `<span><i class="c-yellow"></i>${y}以下</span><span><i class="c-blue"></i>${y + 1}〜${b}</span>` : '<span class="err">水色の上限は黄色の上限より大きくしてください</span>';
}

function adminSeason() {
  const s = state.data.settings;
  return `<form class="card" data-form="season" style="max-width:460px">
    <label class="f">今シーズンの開始日（これより前の回は、順位表・成績一覧に出さない）<input type="date" name="seasonStart" value="${h(s.seasonStart || '')}"></label>
    <label class="f">選手選考の締め日（決まったら入れる。この日までのスコアで選考）<input type="date" name="selectionDate" value="${h(s.selectionDate || '')}"></label>
    <button class="btn">保存</button></form>
    <h2>シーズンの切り替え手順</h2>
    <ol class="small">
      <li>選考の締め日を入れて保存し、「選手選考」画面で結果を確認する</li>
      <li>下のボタンで、順位表・成績一覧・選手選考を <b>PDFに保存</b> する（印刷画面で「PDFに保存」を選ぶ）</li>
      <li>「CSV」タブで3つのファイルを書き出して保管する</li>
      <li>新しいシーズンの開始日（締め日の翌日など）を入れ、選考の締め日を空にして保存する</li>
    </ol>
    <div class="row">
      <a class="btn sub" href="#/?print=1">順位表を印刷</a>
      <a class="btn sub" href="#/grid?print=1">成績一覧を印刷</a>
      <a class="btn sub" href="#/selection?print=1">選手選考を印刷</a>
    </div>
    <p class="small muted">過去のスコアは消さずに残ります。開始日を前の日付に戻せば、前のシーズンをもう一度表示できます。</p>`;
}

const pendingImport = { files: [], data: null };
function adminCsv() {
  const pi = pendingImport;
  return `<h2>書き出し</h2>
    <div class="row"><button class="btn sub" data-act="export" data-kind="players">players.csv</button>
      <button class="btn sub" data-act="export" data-kind="events">events.csv</button>
      <button class="btn sub" data-act="export" data-kind="scores">scores.csv</button></div>
    <p class="small muted">Excel でそのまま開けます（文字化けしない形式）。定期的に書き出して保管しておくと、万一のときに戻せます。</p>
    <h2>読み込み</h2>
    <input type="file" id="csv-files" accept=".csv,text/csv" multiple>
    <p class="small muted">players.csv・events.csv・scores.csv（どれか1つでも、まとめてでも可）。同じIDの行は上書き、新しいIDの行は追加します。ファイルにない行は消しません。</p>
    ${pi.data ? `<div class="card"><b>読み込み内容の確認</b><ul>
      ${pi.files.map(f => `<li>${h(f.name)}：${f.kind ? `${{ players: '選手', events: '開催回', scores: 'スコア' }[f.kind]} ${f.count}件` : '<span class="err">種類を判別できません（見出し行を確認してください）</span>'}
        ${f.errors.length ? `<div class="err small">${f.errors.slice(0, 5).map(h).join('<br>')}${f.errors.length > 5 ? `<br>ほか${f.errors.length - 5}件` : ''}</div>` : ''}</li>`).join('')}</ul>
      ${pi.files.every(f => f.kind && !f.errors.length) ? '<button class="btn" data-act="import">取り込む</button>' : '<p class="err small">問題を直してから、もう一度ファイルを選んでください。</p>'}</div>` : ''}`;
}
async function onCsvFiles(input) {
  const files = [...input.files];
  pendingImport.files = []; pendingImport.data = { players: [], events: [], scores: [] };
  for (const f of files) {
    const text = await readText(f);
    const { header, records } = parseCsv(text);
    const kind = detectKind(header);
    const { items, errors } = kind ? recordsToData(kind, records) : { items: [], errors: [] };
    if (kind) pendingImport.data[kind].push(...items);
    pendingImport.files.push({ name: f.name, kind, count: items.length, errors });
  }
  render();
}
// Excel が Shift_JIS で保存した CSV も読めるようにする
async function readText(file) {
  const buf = await file.arrayBuffer();
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch { return new TextDecoder('shift_jis').decode(buf); }
}
function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- ログイン ----------
// 会員だけが見られるようにするため、ログインしていない人には閲覧用のパスワード入力だけを出す
const signedOut = () => !DEMO && !state.session.user;
function viewMemberLogin() {
  return `<h1>研鑽会 成績表</h1><form class="card" data-form="member-login" style="max-width:380px">
    <p class="small muted" style="margin-top:0">会員専用のページです。研鑽会でお知らせしているパスワードを入力してください。一度入力すると、この端末では次回から入力不要です。</p>
    <label class="f">パスワード<input type="password" name="password" autocomplete="current-password" required></label>
    <button class="btn">見る</button></form>`;
}

// 管理者が自分のパスワードを変える（仮パスワードで作ったアカウント用）
function viewAccount() {
  return `<h1>パスワード変更</h1><form class="card" data-form="password" style="max-width:380px">
    <p class="small muted" style="margin-top:0">${h(state.session.user?.email || '')} のパスワードを変更します。10文字以上で、英字と数字を混ぜてください。</p>
    <label class="f">新しいパスワード<input type="password" name="pw1" autocomplete="new-password" minlength="10" required></label>
    <label class="f">もう一度<input type="password" name="pw2" autocomplete="new-password" minlength="10" required></label>
    <button class="btn">変更する</button></form>`;
}

function viewLogin() {
  return `<h1>管理者ログイン</h1><form class="card" data-form="login" style="max-width:380px">
    <label class="f">メールアドレス<input type="email" name="email" autocomplete="username" required></label>
    <label class="f">パスワード<input type="password" name="password" autocomplete="current-password" required></label>
    <button class="btn">ログイン</button></form>`;
}

// ---------- 描画と操作 ----------
async function withBusy(fn) {
  document.body.style.cursor = 'progress';
  document.querySelectorAll('button').forEach(b => { b.disabled = true; });
  try { await fn(); render(); } catch (e) { toast(e.message || String(e), true); render(); }
  finally { document.body.style.cursor = ''; }
}

function render() {
  const { parts, q } = route();
  const page = parts[0] || 'ranking';
  if (signedOut() && page !== 'login') { nav('member-login'); $app.innerHTML = viewMemberLogin(); return; }
  if (!state.data && page !== 'login') { $app.innerHTML = '<p class="muted pad">読み込み中…</p>'; return; }
  const needAdmin = ['input', 'admin', 'account'].includes(page);
  if (needAdmin && !state.session.admin) { go('#/login'); return; }
  nav(page === 'p' ? 'ranking' : page);
  const views = {
    ranking: () => viewRanking(q), grid: () => viewGrid(q), p: () => viewPlayer(decodeURIComponent(parts[1] || '')),
    input: () => viewInput(q), admin: () => viewAdmin(q), login: viewLogin, selection: viewSelection, account: viewAccount,
  };
  $app.innerHTML = (views[page] || views.ranking)();
  // 用紙：成績一覧は列が多いので A3 横、それ以外は A4 縦
  document.getElementById('page-size').textContent = `@page { size: ${page === 'grid' ? 'A3 landscape' : 'A4 portrait'}; margin: 8mm; }`;
  // 「印刷」ボタンから来たときは、描画のあと印刷画面を開く（PDF保存用）
  if (q.get('print') === '1') setTimeout(() => window.print(), 300);
  const sf = document.querySelector('form[data-form="settings"]'); if (sf) settingsPreview(sf);
}

document.addEventListener('click', async ev => {
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  if (act === 'logout') { ev.preventDefault(); await store.signOut(); state.session = await store.session(); state.data = null; go('#/'); return; }
  if (act === 'my-change') { setMyPlayer(''); return render(); }
  if (act === 'my-set') { setMyPlayer(el.dataset.id); toast('この端末の「自分」に設定しました'); return render(); }
  if (act === 'add-player') return addToEntry([el.dataset.id]);
  if (act === 'add-all-prev') return addToEntry(previousParticipants(state.data.events.find(e => e.id === entry.eventId)).map(p => p.id));
  if (act === 'add-typed') {
    const input = document.getElementById('add-name');
    const p = resolveTyped(input.value);
    if (!p) { toast('選手が見つかりません。候補から選んでください', true); return; }
    if (entry.rows.some(r => r.playerId === p.id)) { toast(`${p.name}さんは追加済みです`); input.value = ''; return; }
    return addToEntry([p.id]);
  }
  if (act === 'remove-row') { entry.rows.splice(Number(el.dataset.i), 1); entry.dirty = true; return render(); }
  if (act === 'save-entry') return saveEntry();
  if (act === 'export') {
    const { players, events, scores } = state.data;
    const k = el.dataset.kind;
    return download(`${k}.csv`, k === 'players' ? playersCsv(players) : k === 'events' ? eventsCsv(events) : scoresCsv(scores, events, players));
  }
  if (act === 'import') {
    const d = pendingImport.data;
    if (!confirm(`選手${d.players.length}件・開催回${d.events.length}件・スコア${d.scores.length}件を取り込みます。よろしいですか？`)) return;
    return withBusy(async () => {
      await store.importData(d);
      pendingImport.files = []; pendingImport.data = null;
      await reload();
      toast('取り込みました');
    });
  }
  if (act === 'delete-player') {
    const p = state.data.players.find(x => x.id === el.dataset.id);
    if ((state.stats.get(p.id)?.count ?? 0) > 0) { toast('スコアがある選手は削除できません', true); return; }
    if (!confirm(`${p.name}さんを削除しますか？`)) return;
    return withBusy(async () => { await store.deletePlayer(p.id); await reload(); toast('削除しました'); });
  }
  if (act === 'delete-event') {
    const e = state.data.events.find(x => x.id === el.dataset.id);
    const n = state.overall.perEvent.get(e.id) || 0;
    if (!confirm(`${e.label}（${e.date}）を削除しますか？${n ? `\nこの回のスコア${n}件も削除されます。` : ''}`)) return;
    return withBusy(async () => { await store.deleteEvent(e.id); await reload(); toast('削除しました'); });
  }
});

document.addEventListener('input', ev => {
  const t = ev.target;
  if (t.matches('#entry-rows input.sc[data-i]')) {
    const i = Number(t.dataset.i);
    entry.rows[i].value = t.value.replace(/[０-９]/g, d => String.fromCharCode(d.charCodeAt(0) - 0xFEE0)).replace(/\D/g, '');
    if (t.value !== entry.rows[i].value) t.value = entry.rows[i].value;
    entry.dirty = true;
    // 入力欄は作り直さず（スマホのキーボードが閉じないように）、色と注意書きだけ更新する
    const c = checkScore(t.value, state.data.settings);
    t.className = 'sc ' + (c.ok && !c.empty ? colorClass(c.value) + ' ' + markClass({ score: c.value, nr: entry.rows[i].nr }) : '');
    t.closest('tr').querySelector('.msg').innerHTML = !c.ok ? `<span class="err">${c.message}</span>` : c.warn ? `<span class="warn">${c.message}</span>` : c.empty ? '<span class="muted">未入力</span>' : '';
    document.getElementById('entry-count').textContent = entrySummary();
  }
  if (t.closest('form[data-form="settings"]')) settingsPreview(t.form);
});

document.addEventListener('keydown', ev => {
  const t = ev.target;
  if (ev.key === 'Enter' && t.matches('#entry-rows input.sc[data-i]')) {
    ev.preventDefault();
    const next = document.querySelector(`#entry-rows input.sc[data-i="${Number(t.dataset.i) + 1}"]`);
    if (next) next.focus(); else document.getElementById('add-name')?.focus();
  }
  if (ev.key === 'Enter' && t.id === 'add-name') { ev.preventDefault(); document.querySelector('[data-act="add-typed"]').click(); }
});

document.addEventListener('change', ev => {
  const t = ev.target;
  if (t.matches('#entry-rows input.nr')) {
    const i = Number(t.dataset.i);
    entry.rows[i].nr = t.checked; entry.dirty = true;
    const c = checkScore(entry.rows[i].value, state.data.settings);
    const sc = t.closest('tr').querySelector('input.sc');
    sc.className = 'sc ' + (c.ok && !c.empty ? colorClass(c.value) + ' ' + markClass({ score: c.value, nr: t.checked }) : '');
    document.getElementById('entry-count').textContent = entrySummary();
  }
  if (t.id === 'ev-select') {
    if (entry.dirty && !confirm('保存していない入力があります。破棄して別の回を開きますか？')) { t.value = entry.eventId; return; }
    loadEntry(t.value); go(`#/input?e=${encodeURIComponent(t.value)}`);
  }
  if (t.id === 'csv-files') onCsvFiles(t);
  if (t.id === 'my-select') { setMyPlayer(t.value); render(); }
});

document.addEventListener('submit', async ev => {
  const f = ev.target.closest('form[data-form]');
  if (!f) return;
  ev.preventDefault();
  const kind = f.dataset.form;
  if (kind === 'login') {
    return withBusy(async () => {
      await store.signIn(f.email.value.trim(), f.password.value);
      state.session = await store.session();
      await reload();
      if (!state.session.admin) { toast('このアカウントは管理者に登録されていません', true); go('#/'); return; }
      go('#/input');
    });
  }
  if (kind === 'member-login') {
    return withBusy(async () => {
      if (!MEMBER_EMAIL) throw new Error('閲覧用アカウントが設定されていません（config.js の memberEmail）');
      try { await store.signIn(MEMBER_EMAIL, f.password.value); } catch { throw new Error('パスワードが違います'); }
      state.session = await store.session();
      await reload();
      go('#/');
    });
  }
  if (kind === 'player') {
    const p = { id: f.dataset.id, number: f.number.value.trim(), name: f.name.value.trim(), category: f.category.value, nonMember: f.nonMember.checked };
    if (!p.name) { toast('氏名を入力してください', true); return; }
    return withBusy(async () => { await store.savePlayer(p); await reload(); toast(f.dataset.new ? `${p.name}さんを追加しました` : '保存しました'); });
  }
  if (kind === 'event') {
    const rn = f.roundNo.value.trim();
    if (rn && !/^\d+$/.test(rn)) { toast('回番号は数字で入力してください', true); return; }
    const e = { id: f.dataset.id, date: f.date.value, label: f.label.value.trim() || defaultLabel(f.date.value), roundNo: rn ? Number(rn) : null, kind: f.kind.value, cancelled: f.cancelled.checked };
    if (e.cancelled && (state.overall.perEvent.get(e.id) || 0) > 0 && !confirm('この回にはスコアが入っています。中止にしてもスコアは消えず、集計にも残ります。よろしいですか？')) return;
    return withBusy(async () => { await store.saveEvent(e); await reload(); toast(f.dataset.new ? `${e.label}を追加しました` : '保存しました'); });
  }
  if (kind === 'password') {
    const pw = f.pw1.value;
    if (pw !== f.pw2.value) { toast('2つの入力が一致しません', true); return; }
    if (pw.length < 10 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw)) { toast('10文字以上で、英字と数字を混ぜてください', true); return; }
    return withBusy(async () => { await store.changePassword(pw); toast('パスワードを変更しました'); go('#/input'); });
  }
  if (kind === 'season') {
    const s = { ...state.data.settings, seasonStart: f.seasonStart.value || null, selectionDate: f.selectionDate.value || null };
    if (s.seasonStart && s.selectionDate && s.selectionDate < s.seasonStart) { toast('締め日はシーズン開始日より後にしてください', true); return; }
    return withBusy(async () => { await store.saveSettings(s); await reload(); toast('保存しました'); });
  }
  if (kind === 'settings') {
    const s = { ...state.data.settings, yellowMax: Number(f.yellowMax.value), blueMax: Number(f.blueMax.value), par: Number(f.par.value) };
    if (!(s.yellowMax < s.blueMax)) { toast('水色の上限は黄色の上限より大きくしてください', true); return; }
    return withBusy(async () => { await store.saveSettings(s); await reload(); toast('保存しました'); });
  }
});

window.addEventListener('hashchange', () => {
  const { parts } = route();
  if (entry.dirty && parts[0] !== 'input' && !confirm('保存していないスコアがあります。破棄して移動しますか？')) {
    history.back(); return;
  }
  if (parts[0] !== 'input') entry.dirty = false;
  render();
  window.scrollTo(0, 0);
});
// 選手ページのグラフは幅に合わせて描き直す
let resizeTimer = 0, lastWidth = window.innerWidth;
window.addEventListener('resize', () => {
  if (window.innerWidth === lastWidth || route().parts[0] !== 'p') return;
  lastWidth = window.innerWidth; clearTimeout(resizeTimer); resizeTimer = setTimeout(render, 200);
});
window.addEventListener('beforeunload', ev => { if (entry.dirty) { ev.preventDefault(); ev.returnValue = ''; } });

(async function start() {
  if (DEMO) document.getElementById('banner').innerHTML = '<div class="banner">デモモード：データはこのブラウザにだけ保存されます（Supabase 未設定）</div>';
  try {
    state.session = await store.session();
    if (!signedOut()) await reload();
    render();
  } catch (e) {
    $app.innerHTML = `<p class="err pad">データを読み込めませんでした：${h(e.message)}</p><p class="pad"><button class="btn" onclick="location.reload()">再読み込み</button></p>`;
  }
})();
