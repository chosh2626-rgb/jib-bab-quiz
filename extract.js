// 올린 파일에서 글자를 꺼낸다. 결과: {rows:[[...]]} (표 파일) 또는 {lines:[...]} (문서; 표의 한 행은 칸을 탭으로 이은 한 줄)
const path = require('path');

function decodeText(buf) {
  let s;
  try { s = new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch (e) { s = new TextDecoder('euc-kr').decode(buf); }
  return s.replace(/^﻿/, '');
}
const ENT = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: ' ' };
const unent = s => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
  e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : (ENT[e] ?? m));

// 워드·한글(hwpx)·오픈오피스·파워포인트 XML을 줄로 바꾸는 공통 처리
function xmlToLines(xml, T) {
  const lines = [];
  const re = /<(\/?)([\w:.-]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|([^<]+)/g;
  let m, para = null, inText = 0, tblDepth = 0, row = null, cell = null, skip = 0;
  const push = s => { if (para !== null) para += s; };
  while ((m = re.exec(xml))) {
    if (m[5] !== undefined) { if (para !== null && !skip && (T.t ? inText : true)) push(unent(m[5])); continue; }
    const close = m[1] === '/', name = m[2], self = m[4] === '/';
    if (T.skip && T.skip.includes(name)) { if (!self) skip += close ? -1 : 1; continue; }
    if (name === T.tbl) { tblDepth += close ? -1 : (self ? 0 : 1); continue; }
    if (tblDepth === 1 && name === T.tr) {
      if (!close && !self) row = [];
      else if (close && row) { if (row.some(c => c.trim())) lines.push(row.map(c => c.replace(/\s+/g, ' ').trim()).join('\t')); row = null; }
      continue;
    }
    if (tblDepth === 1 && name === T.tc) {
      if (!close && !self) cell = [];
      else if (close && cell && row) { row.push(cell.join(' ')); cell = null; }
      continue;
    }
    if (T.p.includes(name)) {
      if (self) { if (!tblDepth) lines.push(''); continue; }
      if (!close) { if (para === null) para = ''; else para += ' '; }
      else if (para !== null) {
        const text = para.replace(/\t/g, ' ');
        if (tblDepth && cell) cell.push(text); else if (tblDepth && !cell) { /* 표 안 다른 곳 */ } else lines.push(text);
        para = null;
      }
      continue;
    }
    if (T.t && name === T.t) { if (!self) inText += close ? -1 : 1; continue; }
    if ((T.tab || []).includes(name) || (T.br || []).includes(name)) { if (!close) push(' '); continue; }
    if (T.space && name === T.space && !close) { const c = (m[3].match(/c="(\d+)"/) || [])[1]; push(' '.repeat(+c || 1)); }
  }
  return lines;
}

function zipFiles(buf) {
  const CFB = require('cfb');
  const z = CFB.read(buf, { type: 'buffer' });
  const files = {};
  z.FileIndex.forEach((f, i) => { if (f.type === 2 && f.content) files[z.FullPaths[i].replace(/^[^/]*\//, '')] = Buffer.from(f.content); });
  return files;
}
const byNum = (a, b) => (+(a.match(/(\d+)\D*$/) || [0, 0])[1]) - (+(b.match(/(\d+)\D*$/) || [0, 0])[1]);

const DOCX = { p: ['w:p'], t: 'w:t', tbl: 'w:tbl', tr: 'w:tr', tc: 'w:tc', tab: ['w:tab'], br: ['w:br', 'w:cr'], skip: ['w:instrText', 'w:delText'] };
const HWPX = { p: ['hp:p'], t: 'hp:t', tbl: 'hp:tbl', tr: 'hp:tr', tc: 'hp:tc', tab: ['hp:tab'], br: ['hp:lineBreak'] };
const ODT = { p: ['text:p', 'text:h'], t: null, tbl: 'table:table', tr: 'table:table-row', tc: 'table:table-cell', tab: ['text:tab'], br: ['text:line-break'], space: 'text:s' };
const PPTX = { p: ['a:p'], t: 'a:t', tbl: 'a:tbl', tr: 'a:tr', tc: 'a:tc', br: ['a:br'] };

function hwpLines(buf) {
  const { parse } = require('hwp.js');
  const doc = parse(new Uint8Array(buf), { type: 'array' });
  const lines = [];
  const paraText = p => p.content.map(c => (c.type === 0 && typeof c.value === 'string') ? c.value : (c.value === 9 ? ' ' : '')).join('');
  const walk = (paras, out) => {
    for (const p of paras) {
      const t = paraText(p);
      if (t.trim() || !p.controls.length) out.push(t);
      for (const c of p.controls || []) {
        if (c && Array.isArray(c.content) && Array.isArray(c.content[0])) { // 표
          for (const row of c.content) {
            if (!row) continue;
            const cells = row.filter(Boolean).map(l => { const o = []; walk(l.items || [], o); return o.join(' ').replace(/\s+/g, ' ').trim(); });
            if (cells.some(Boolean)) out.push(cells.join('\t'));
          }
        } else if (c && c.content && Array.isArray(c.content.items)) walk(c.content.items, out);
      }
    }
  };
  for (const s of doc.sections) walk(s.content, lines);
  return lines;
}

async function pdfLines(buf) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const base = path.dirname(require.resolve('pdfjs-dist/package.json'));
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), cMapUrl: path.join(base, 'cmaps') + '/', cMapPacked: true,
    standardFontDataUrl: path.join(base, 'standard_fonts') + '/', useSystemFonts: false, isEvalSupported: false, verbosity: 0 }).promise;
  const lines = [];
  for (let i = 1; i <= Math.min(doc.numPages, 60); i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    const items = tc.items.filter(it => it.str !== undefined && it.str !== '').map(it => ({ s: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: Math.abs(it.transform[3]) || 10 }));
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const rows = [];
    for (const it of items) {
      const r = rows.find(r => Math.abs(r.y - it.y) < Math.max(2, it.h * 0.4));
      if (r) r.items.push(it); else rows.push({ y: it.y, items: [it] });
    }
    rows.sort((a, b) => b.y - a.y);
    for (const r of rows) {
      r.items.sort((a, b) => a.x - b.x);
      let s = '', end = null;
      for (const it of r.items) {
        if (end !== null) { const gap = it.x - end; s += gap > it.h * 0.9 ? '\t' : gap > it.h * 0.15 ? ' ' : ''; }
        s += it.s; end = it.x + it.w;
      }
      lines.push(s);
    }
    lines.push('');
  }
  return lines;
}

function sheetRows(buf, isText, name) {
  const XLSX = require('xlsx');
  const wb = isText ? XLSX.read(decodeText(buf), { type: 'string', raw: true, FS: /\.tsv$/i.test(name) ? '\t' : undefined })
    : XLSX.read(buf, { type: 'buffer', cellHTML: false, cellFormula: false });
  const rows = [];
  for (const sn of wb.SheetNames) rows.push(...XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: false, defval: '' }));
  return rows;
}

async function extract(buf, name) {
  const ext = (name.toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || '';
  const head = buf.subarray(0, 8).toString('hex');
  const isZip = head.startsWith('504b0304'), isOle = head.startsWith('d0cf11e0'), isPdf = buf.subarray(0, 5).toString() === '%PDF-';
  if (isPdf) return { lines: await pdfLines(buf) };
  if (['xlsx', 'xlsm', 'xls', 'ods', 'numbers'].includes(ext)) return { rows: sheetRows(buf, false, name) };
  if (ext === 'csv' || ext === 'tsv') return { rows: sheetRows(buf, true, name) };
  if (ext === 'hwp' || (isOle && ext !== 'doc' && ext !== 'ppt')) return { lines: hwpLines(buf) };
  if (isZip) {
    const f = zipFiles(buf);
    if (f['word/document.xml']) return { lines: xmlToLines(f['word/document.xml'].toString('utf8'), DOCX) };
    const hw = Object.keys(f).filter(k => /^Contents\/section\d+\.xml$/i.test(k)).sort(byNum);
    if (hw.length) return { lines: hw.flatMap(k => xmlToLines(f[k].toString('utf8'), HWPX)) };
    if (f['content.xml']) return { lines: xmlToLines(f['content.xml'].toString('utf8'), ODT) };
    const sl = Object.keys(f).filter(k => /^ppt\/slides\/slide\d+\.xml$/.test(k)).sort(byNum);
    if (sl.length) return { lines: sl.flatMap(k => xmlToLines(f[k].toString('utf8'), PPTX).concat('')) };
    if (f['xl/workbook.xml']) return { rows: sheetRows(buf, false, name) };
    throw new Error('지원하지 않는 압축 파일입니다');
  }
  if (isOle) throw new Error('예전 워드(.doc)·파워포인트(.ppt) 파일은 읽을 수 없습니다. 새 형식(.docx, .pptx)이나 PDF로 저장해서 올려 주세요');
  if (['txt', 'md', 'text', ''].includes(ext) || !/[\x00-\x08]/.test(buf.subarray(0, 512).toString('latin1'))) {
    const t = decodeText(buf);
    if (ext === 'json' || /^\s*[\[{]/.test(t)) { try { return { json: JSON.parse(t) }; } catch (e) { /* 일반 글로 */ } }
    return { lines: t.split('\n') };
  }
  throw new Error('읽을 수 없는 파일 형식입니다');
}

module.exports = { extract, xmlToLines };

// 작업 스레드로 실행될 때
const { parentPort, workerData, isMainThread } = require('worker_threads');
if (!isMainThread && workerData && workerData.extract) {
  extract(Buffer.from(workerData.buf), workerData.name)
    .then(r => parentPort.postMessage({ ok: true, r }))
    .catch(e => parentPort.postMessage({ ok: false, error: String(e && e.message || e) }));
}
