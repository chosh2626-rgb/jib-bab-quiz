/* 문제 파일 해석과 주관식 채점 (브라우저와 서버가 함께 씀) */
(function (root) {
  "use strict";
  const norm = s => String(s ?? "").toLowerCase().replace(/[\s.,!?·'"‘’“”()\[\]{}（）\-–—~:：;/…<>「」『』]/g, "");

  /* ── 주관식 채점 ──
     정답 한 칸 = "율례, 규례"처럼 쉼표(또는 /)로 나눈 여러 부분이면 모든 부분이 들어 있어야 정답(순서 무관).
     "사울(바울)"처럼 괄호가 있으면 괄호 안·밖 어느 쪽을 써도 인정. 여러 칸(배열)은 그중 하나만 맞으면 정답. */
  function splitParts(alt) {
    return String(alt).split(/\s*[,，/]\s*(?![^()（）]*[)）])/).map(s => s.trim()).filter(Boolean);
  }
  function variants(part) {
    const v = [norm(part)];
    const m = String(part).match(/^(.*?)\s*[(（]([^)）]+)[)）]\s*(.*)$/);
    if (m) v.push(norm(m[1] + m[3]), norm(m[2]));
    return [...new Set(v.filter(Boolean))].sort((a, b) => b.length - a.length);
  }
  function gradeShort(alts, input) {
    const x = norm(input);
    if (!x) return false;
    for (const alt of alts) {
      const parts = splitParts(alt);
      if (parts.length <= 1) { if (variants(alt).includes(x)) return true; continue; }
      let rest = x, need = 0, ok = true;
      for (const p of parts) {
        const hit = variants(p).find(v => rest.includes(v));
        if (!hit) { ok = false; break; }
        rest = rest.replace(hit, ""); need += hit.length;
      }
      if (ok && rest.length <= Math.max(4, need * 0.3)) return true;
    }
    return false;
  }

  /* ── 문제 한 개 만들기 ── */
  const autoTime = () => 30; // 모든 문제 마감 30초
  function cleanText(t) {
    return String(t || "")
      .replace(/\(\s*\)/g, "\u0000").replace(/\s+/g, " ").replace(/\u0000/g, "(\u3000\u3000\u3000)")
      .replace(/^\s*\[(빈칸|주관식|단답형?|서술형?|객관식|선택형?|o\s*\/?\s*x|ox)\]\s*/i, "").trim();
  }
  function makeQ(text, slots, ansRaw, timeRaw, hint) {
    const tag = String(text || "").match(/^\s*\[([^\]]{1,6})\]/);
    hint = hint || (tag ? tag[1].toLowerCase().replace(/\s|\//g, "") : "");
    text = cleanText(text);
    if (!text) return null;
    const ans = String(ansRaw ?? "").trim();
    const keep = (slots || []).map((c, k) => ({ c: String(c ?? "").trim(), k })).filter(o => o.c);
    if (!ans) return { err: "정답이 없습니다", text };
    if (keep.length === 1) return { err: "보기가 1개뿐입니다", text };
    let q;
    if (keep.length >= 2) {
      if (keep.length > 4) return { err: "보기는 4개까지 가능합니다", text };
      const c = "①②③④".indexOf(ans[0]);
      const pos = c >= 0 ? c : (/^\(?[1-4]\)?\s*번?$/.test(ans) ? parseInt(ans.replace(/\D/g, ""), 10) - 1 : -1);
      let idx = pos >= 0 ? keep.findIndex(o => o.k === pos) : -1;
      if (idx < 0) idx = keep.findIndex(o => norm(o.c) === norm(ans));
      if (idx < 0) return { err: "정답 '" + ans + "'을(를) 보기에서 찾을 수 없습니다", text };
      q = { type: "choice", text, choices: keep.map(o => o.c), answer: idx };
    } else if (hint !== "빈칸" && hint !== "주관식" && /^(o|○|◯|맞다|참)$/i.test(ans)) q = { type: "ox", text, answer: "O" };
    else if (hint !== "빈칸" && hint !== "주관식" && /^(x|×|✕|틀리다|거짓)$/i.test(ans)) q = { type: "ox", text, answer: "X" };
    else q = { type: "short", text, answers: ans.split(/\s*(?:\||｜|\s또는\s)\s*/).map(x => x.trim()).filter(Boolean) };
    q.time = autoTime(q.type, ans); // 파일에 적힌 시간과 관계없이 30초
    return q;
  }

  /* ── 표(엑셀·CSV) ── */
  function rowsToQ(rows) {
    rows = rows.map(r => r.map(c => String(c ?? "").trim())).filter(r => r.some(c => c));
    if (!rows.length) return [];
    let col = { q: 0, c: [1, 2, 3, 4], a: 5, t: 6 };
    const h = rows[0], hq = h.findIndex(c => /^문제/.test(c)), ha = h.findIndex(c => /^(정답|답)/.test(c));
    if (hq >= 0 && ha >= 0) {
      col = { q: hq, c: h.map((c, i) => /^보기/.test(c) ? i : -1).filter(i => i >= 0), a: ha, t: h.findIndex(c => /시간/.test(c)) };
      rows = rows.slice(1);
    } else if (rows.every(r => /^\d+$/.test(r[0]))) col = { q: 1, c: [2, 3, 4, 5], a: 6, t: 7 };
    return rows.map(r => makeQ(r[col.q], col.c.map(i => r[i]), r[col.a], col.t >= 0 ? r[col.t] : "")).filter(Boolean);
  }

  /* ── 문서(시험지·답지·메모장) ──
     줄 단위로 읽는다. 표의 한 행은 칸 사이가 탭(\t)으로 이어진 한 줄. */
  const NUM = /^\s*(?:문제\s*)?(\d{1,3})\s*(?:[.)]|번(?:\s*[.):])?)\s*(.*)$/;
  const CIRC = "①②③④⑤";
  const CHOICE = /^\s*(?:([①-⑤])|\((\d)\)|([가-마ㄱ-ㅁA-Ea-e])[.)])\s*(.+)$/;
  const ANS_LINE = /^\s*(?:정답|답|해답|정답\s*및\s*해설)\s*[:：)]\s*(.+)$/;
  const KEY_HEAD = /(정답|답지|답안|해답)/;
  const REF = "[가-힣]{1,3}\\s?\\d{1,3}:\\d{1,3}(?:[~\\-–]\\d{1,3})?(?:;\\s*\\d{1,3}:\\d{1,3}(?:[~\\-–]\\d{1,3})?)*";
  const REFKEY = new RegExp("(?:^|\\s)(\\d{1,3})\\s+(.+?)\\s+" + REF + "(?=\\s|$)");
  const looksQuestion = s => /[?？]|\(\s{2,}\)|\(\s*\)|_{3,}|^\s*\[[^\]]{1,6}\]/.test(s) || s.length > 25;

  function splitInlineChoices(s) { // "질문 ① 가 ② 나" → ["질문", "가", "나"]
    const parts = String(s).split(/\s*[①-⑤]\s*/);
    return parts.length >= 3 ? parts : null;
  }
  function tableKeys(rows, into) { // 답지 표에서 번호→정답
    const head = rows.findIndex(r => r.some(c => /^번호$/.test(c)) && r.some(c => /^(정답|답)$/.test(c)));
    if (head >= 0) {
      const h = rows[head], nums = h.map((c, i) => /^번호$/.test(c) ? i : -1).filter(i => i >= 0);
      const off = h.findIndex(c => /^(정답|답)$/.test(c)) - nums[0];
      for (const r of rows.slice(head + 1)) for (const n of nums) {
        const k = (r[n] || "").trim(), a = (r[n + off] || "").trim();
        if (/^\d{1,3}$/.test(k) && a) into[+k] = a;
      }
      return true;
    }
    let found = false;
    for (const r of rows) for (let i = 0; i + 1 < r.length; i++) {
      if (/^\d{1,3}$/.test(r[i].trim()) && r[i + 1].trim() && !/^\d{1,3}$/.test(r[i + 1].trim())) { into[+r[i]] = r[i + 1].trim(); found = true; i++; }
    }
    return found;
  }

  function parseLines(lines) {
    lines = lines.map(l => String(l).replace(/\r/g, "").replace(/ /g, " "));
    const qs = [], keys = {}, tables = [];
    let cur = null, ansMode = false, tbl = null;
    const head = lines.filter(l => l.trim()).slice(0, 6).filter(l => !NUM.test(l) && !ANS_LINE.test(l) && !CHOICE.test(l) && !l.includes("\t")).join(" ");
    const keyFile = KEY_HEAD.test(head) && !lines.some(l => /\(\s{2,}\)/.test(l));
    if (keyFile) ansMode = true;
    const flush = () => { cur = null; };
    for (const raw of lines) {
      const cells0 = raw.split("\t");
      if (raw.includes("\t") && (tbl || /^\s*\d{1,3}\s*$/.test(cells0[0]) || cells0.some(c => /^\s*(번호?|정답|답|문제|보기\d?)\s*$/.test(c)))) { // 표의 한 행
        const cells = cells0;
        if (!tbl) { tbl = []; tables.push(tbl); }
        tbl.push(cells); flush(); continue;
      }
      tbl = null;
      const line = raw.replace(/\t/g, " ").trim();
      if (!line) { continue; }
      if (ansMode && !NUM.test(line)) { // "1 율례, 규례 스 7:10 26 메네 …" 처럼 칸 구분 없이 이어진 답지(PDF)
        let hit = false, mm; const re = new RegExp(REFKEY.source, "g");
        while ((mm = re.exec(line))) { keys[+mm[1]] = mm[2].trim(); hit = true; }
        if (!hit && (mm = line.match(/^(\d{1,3})\s+(\S.{0,40})$/)) && !/\s\d{1,3}\s/.test(" " + mm[2] + " ")) { keys[+mm[1]] = mm[2].trim(); hit = true; }
        if (hit) { flush(); continue; }
      }
      let m;
      if (cur && (m = line.match(ANS_LINE))) { cur.ans = m[1].trim(); continue; }
      if (cur && !cur.ans && (m = line.match(CHOICE)) && (m[1] || cur.choices.length < 5)) {
        const inl = splitInlineChoices(line);
        if (inl && m[1]) cur.choices.push(...inl.slice(1)); else cur.choices.push(m[4].trim());
        continue;
      }
      if ((m = line.match(NUM))) {
        const n = +m[1], rest = m[2].trim();
        if (cur && !cur.ans && /^\d\)/.test(line.trim()) && n === cur.choices.length + 1 && n <= 5 && !looksQuestion(rest)) { cur.choices.push(rest); continue; }
        if (!rest) { continue; }
        if (ansMode && !looksQuestion(rest)) { keys[n] = rest.replace(/^(정답|답)\s*[:：]\s*/, ""); flush(); continue; }
        let text = rest, ans = "";
        const ia = text.match(/\s(?:정답|답)\s*[:：]\s*(.+)$/);
        if (ia) { ans = ia[1].trim(); text = text.slice(0, ia.index); }
        const choices = [];
        const inl = splitInlineChoices(text);
        if (inl) { text = inl[0]; choices.push(...inl.slice(1)); }
        cur = { n, text, choices, ans };
        qs.push(cur);
        continue;
      }
      if (line.length <= 20 && KEY_HEAD.test(line) && !looksQuestion(line)) { ansMode = true; flush(); continue; }
      if (cur && !cur.ans && !cur.choices.length && (line.length > 15 || /^\(.{1,24}\)$/.test(line))) { cur.text += " " + line; continue; }
    }
    for (const t of tables) {
      const h = t[0] || [];
      if (h.some(c => /^문제/.test(c.trim())) && h.some(c => /^(정답|답)/.test(c.trim()))) qs.push(...rowsToQ(t).map(q => ({ done: q })));
      else tableKeys(t, keys);
    }
    return { qs, keys };
  }

  /* files: [{name, rows} | {name, lines} | {name, json}] → {qs, bad, note} */
  function parseFiles(files) {
    const out = [], bad = [], keys = {}, pend = [];
    let note = "";
    for (const f of files) {
      if (f.error) { bad.push({ text: f.name, err: f.error }); continue; }
      if (f.json) {
        const arr = Array.isArray(f.json) ? f.json : (f.json && f.json.questions);
        if (!Array.isArray(arr)) { bad.push({ text: f.name, err: "문제 목록을 찾을 수 없습니다" }); continue; }
        for (const q of arr) {
          const ok = q && typeof q.text === "string" && (q.type === "choice" ? Array.isArray(q.choices) && Number.isInteger(q.answer) : q.type === "ox" ? (q.answer === "O" || q.answer === "X") : q.type === "short" && Array.isArray(q.answers));
          if (ok) out.push({ type: q.type, text: q.text, choices: q.choices, answer: q.answer, answers: q.answers, time: 30 });
          else bad.push({ text: String(q && q.text || "?"), err: "형식이 맞지 않습니다" });
        }
        continue;
      }
      if (f.rows) { for (const q of rowsToQ(f.rows)) (q.err ? bad : out).push(q); continue; }
      const r = parseLines(f.lines || []);
      Object.assign(keys, r.keys);
      for (const q of r.qs) {
        if (q.done) (q.done.err ? bad : out).push(q.done);
        else pend.push(q);
      }
    }
    let missing = 0;
    for (const q of pend) {
      const ans = q.ans || keys[q.n] || "";
      if (!ans) missing++;
      const made = makeQ(q.text, q.choices, ans, "");
      if (made) (made.err ? bad : out).push(made);
    }
    if (missing && missing === pend.length && pend.length) note = "문제지에서 정답을 찾지 못했습니다. 답지 파일도 함께 골라 올려 주세요.";
    else if (!out.length && !bad.length) note = "파일에서 문제를 찾지 못했습니다. 문제 앞에 번호(1. 2. …)가 있는지 확인해 주세요.";
    return { qs: out, bad, note };
  }

  /* 주관식 → 객관식: 다른 문제들의 정답을 틀린 보기로 쓴다 (빈칸 수·글자 수가 비슷한 것 우선) */
  function toChoice(qs, extraPool) {
    const pool = [];
    const add = a => { a = String(a || "").trim(); if (a && !pool.some(p => norm(p) === norm(a))) pool.push(a); };
    qs.forEach(q => q.type === "short" ? add(q.answers[0]) : q.type === "choice" ? q.choices.forEach(add) : 0);
    (extraPool || []).forEach(add);
    let seed = 7;
    const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
    return qs.map((q, i) => {
      if (q.type !== "short") return q;
      const ans = q.answers[0], np = splitParts(ans).length, len = ans.length;
      const cand = pool.filter(p => !q.answers.some(a => norm(a) === norm(p)))
        .map(p => ({ p, d: Math.abs(splitParts(p).length - np) * 10 + Math.abs(p.length - len) / Math.max(4, len) + rnd() * 0.8 }))
        .sort((a, b) => a.d - b.d).slice(0, 3).map(o => o.p);
      if (cand.length < 3) return q;
      const pos = Math.floor(rnd() * 4), ch = cand.slice();
      ch.splice(pos, 0, ans);
      return { type: "choice", text: q.text.replace(/모두 쓰세요/g, "모두 바르게 쓴 것을 고르세요").replace(/쓰세요/g, "고르세요"), choices: ch, answer: pos, time: 30 };
    });
  }

  const api = { norm, gradeShort, makeQ, rowsToQ, parseLines, parseFiles, splitParts, toChoice };
  if (typeof module === "object" && module.exports) module.exports = api; else root.Importer = api;
})(typeof self !== "undefined" ? self : this);
