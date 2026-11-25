// 전도회별 집밥프로젝트 서버: 화면(index.html)을 내보내고, 진행자와 휴대폰 사이의 메시지를 중계하며, 올린 문제 파일을 읽어 준다.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');
const { WebSocketServer, createWebSocketStream } = require('ws');
const aedes = require('aedes')();

const page = fs.readFileSync(path.join(__dirname, 'index.html'));
const MAX = 20 * 1024 * 1024;

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('파일이 너무 큽니다 (20MB까지)')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
// 파일 읽기는 따로 떼어 낸 작업 스레드에서 (이상한 파일이 서버를 멈추지 못하게)
function extractInWorker(buf, name) {
  return new Promise(resolve => {
    const w = new Worker(path.join(__dirname, 'extract.js'), { workerData: { extract: true, buf, name }, resourceLimits: { maxOldGenerationSizeMb: 256 } });
    const done = v => { clearTimeout(t); w.terminate(); resolve(v); };
    const t = setTimeout(() => done({ ok: false, error: '파일을 읽는 데 시간이 너무 오래 걸립니다' }), 30000);
    w.on('message', done);
    w.on('error', () => done({ ok: false, error: '파일을 읽지 못했습니다. 파일이 손상되지 않았는지 확인해 주세요' }));
    w.on('exit', () => done({ ok: false, error: '파일을 읽지 못했습니다' }));
  });
}
const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };

function questionsToXlsx(qs) {
  const XLSX = require('xlsx');
  const rows = [['문제', '보기1', '보기2', '보기3', '보기4', '정답', '시간(초)']];
  for (const q of qs) {
    const c = q.type === 'choice' ? (q.choices || []) : [];
    const ans = q.type === 'choice' ? String((q.answer | 0) + 1) : q.type === 'ox' ? q.answer : (q.answers || []).join(' | ');
    rows.push([String(q.text || ''), c[0] || '', c[1] || '', c[2] || '', c[3] || '', ans, q.time || 20]);
  }
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 60 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 24 }, { wch: 9 }];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, '문제');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
const TEMPLATE = [
  { type: 'choice', text: '(객관식 예) 신약성경은 모두 몇 권일까요?', choices: ['27권', '29권', '39권', '66권'], answer: 0, time: 20 },
  { type: 'ox', text: '(O/X 예) 예수님의 열두 제자 중 마태는 세리였다.', answer: 'O', time: 15 },
  { type: 'short', text: '(주관식 예) 예수님께서 태어나신 마을은?', answers: ['베들레헴'], time: 30 },
  { type: 'short', text: '(빈칸 2개 예) “너희는 (     )을 찢지 말고 (     )을 찢고” (욜 2:13)', answers: ['옷, 마음'], time: 35 },
];
const sendXlsx = (res, buf, filename) => {
  res.writeHead(200, { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'content-disposition': "attachment; filename=\"questions.xlsx\"; filename*=UTF-8''" + encodeURIComponent(filename) });
  res.end(buf);
};

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  try {
    if (url === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
    if (url === '/' || url === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
      return res.end(page);
    }
    if (url === '/api/extract' && req.method === 'POST') {
      let name = 'file';
      try { name = decodeURIComponent(String(req.headers['x-filename'] || 'file')).slice(0, 200); } catch (e) { /* 그대로 */ }
      const buf = await readBody(req, MAX);
      if (!buf.length) return json(res, 400, { ok: false, error: '빈 파일입니다' });
      const r = await extractInWorker(buf, name);
      return json(res, 200, r);
    }
    if (url === '/template.xlsx') return sendXlsx(res, questionsToXlsx(TEMPLATE), 'jibbab_template.xlsx');
    if (url === '/api/export' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req, 5 * 1024 * 1024)).toString('utf8'));
      if (!Array.isArray(body)) return json(res, 400, { ok: false });
      return sendXlsx(res, questionsToXlsx(body.slice(0, 2000)), 'jibbab_questions.xlsx');
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
  } catch (e) {
    json(res, 400, { ok: false, error: String(e && e.message || e) });
  }
});

const wss = new WebSocketServer({ server, path: '/mqtt' });
wss.on('connection', (socket) => aedes.handle(createWebSocketStream(socket)));

const port = process.env.PORT || 3000;
server.listen(port, () => console.log('집밥프로젝트 서버 시작: 포트 ' + port));
