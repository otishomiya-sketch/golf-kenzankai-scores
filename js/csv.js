// CSV の読み書き。書き出しは Excel で文字化けしないよう BOM 付き UTF-8・CRLF。
import { sortEvents, compareNumber } from './stats.js';

export function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
      } else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const nonEmpty = rows.filter(r => r.some(v => v.trim() !== ''));
  if (!nonEmpty.length) return { header: [], records: [] };
  const header = nonEmpty[0].map(h => h.trim());
  const records = nonEmpty.slice(1).map(r => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
  return { header, records };
}

function esc(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
export function toCsv(header, rows) {
  return '﻿' + [header, ...rows].map(r => r.map(esc).join(',')).join('\r\n') + '\r\n';
}

export const HEADERS = {
  players: ['選手ID', '番号', '氏名', '区分', '未入会_他クラブ'],
  events: ['開催ID', '回番号', '日付', '表示', '種別', '中止'],
  scores: ['開催ID', '日付', '選手ID', '氏名', 'スコア'],
};

/** ヘッダーからファイルの種類を判定 */
export function detectKind(header) {
  for (const [kind, h] of Object.entries(HEADERS)) {
    const required = kind === 'scores' ? ['開催ID', '選手ID', 'スコア'] : h;
    if (required.every(x => header.includes(x))) return kind;
  }
  return null;
}

const KINDS = ['通常', 'CT', '納会'];

/** 2026-09-06 → 9/6 */
export function defaultLabel(date) {
  const [, m, d] = date.split('-');
  return `${Number(m)}/${Number(d)}`;
}

/** CSV の行をアプリのデータに変換。errors に行番号付きの問題を入れる */
export function recordsToData(kind, records) {
  const errors = [], items = [];
  records.forEach((r, i) => {
    const line = i + 2;
    try {
      if (kind === 'players') {
        if (!r['選手ID'] || !r['氏名']) throw new Error('選手IDと氏名は必須です');
        if (!['一般', 'J', '女子'].includes(r['区分'])) throw new Error(`区分「${r['区分']}」が不正です`);
        items.push({ id: r['選手ID'], number: r['番号'], name: r['氏名'], category: r['区分'], nonMember: r['未入会_他クラブ'] === '1' });
      } else if (kind === 'events') {
        if (!r['開催ID'] || !/^\d{4}-\d{2}-\d{2}$/.test(r['日付'])) throw new Error('開催IDと日付（YYYY-MM-DD）は必須です');
        if (!KINDS.includes(r['種別'] || '通常')) throw new Error(`種別「${r['種別']}」が不正です`);
        items.push({
          id: r['開催ID'], roundNo: r['回番号'] === '' ? null : Number(r['回番号']), date: r['日付'],
          label: r['表示'] || defaultLabel(r['日付']),
          kind: r['種別'] || '通常', cancelled: r['中止'] === '1',
        });
      } else if (kind === 'scores') {
        const score = Number(r['スコア']);
        if (!r['開催ID'] || !r['選手ID'] || !Number.isInteger(score) || score < 1 || score > 300) throw new Error('開催ID・選手ID・スコア（1〜300の整数）が必要です');
        items.push({ eventId: r['開催ID'], playerId: r['選手ID'], score });
      }
    } catch (e) { errors.push(`${line}行目：${e.message}`); }
  });
  return { items, errors };
}

export function playersCsv(players) {
  return toCsv(HEADERS.players, [...players].sort(compareCategoryNumber)
    .map(p => [p.id, p.number, p.name, p.category, p.nonMember ? 1 : 0]));
}
function compareCategoryNumber(a, b) {
  const order = { '一般': 0, 'J': 1, '女子': 2 };
  return (order[a.category] ?? 9) - (order[b.category] ?? 9) || compareNumber(a, b);
}
export function eventsCsv(events) {
  return toCsv(HEADERS.events, sortEvents(events)
    .map(e => [e.id, e.roundNo ?? '', e.date, e.label, e.kind, e.cancelled ? 1 : 0]));
}
export function scoresCsv(scores, events, players) {
  const ev = new Map(events.map(e => [e.id, e]));
  const pl = new Map(players.map(p => [p.id, p]));
  const order = new Map(sortEvents(events).map((e, i) => [e.id, i]));
  return toCsv(HEADERS.scores, [...scores]
    .sort((a, b) => (order.get(a.eventId) ?? 1e9) - (order.get(b.eventId) ?? 1e9) || a.playerId.localeCompare(b.playerId))
    .map(s => [s.eventId, ev.get(s.eventId)?.date ?? '', s.playerId, pl.get(s.playerId)?.name ?? '', s.score]));
}
