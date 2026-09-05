// 简单写小说 · 本地写作台 —— 零依赖 Node 服务器
// 启动：node server.js 或双击 启动.bat；数据保存在 ../作品/ 下的真实文件里
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const PORT = Number(process.env.PORT || 3746);
const ROOT = __dirname;
const DATA = path.join(ROOT, '..', '作品');
const PUB = path.join(ROOT, 'public');

fs.mkdirSync(DATA, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// ---------- 工具 ----------
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', c => { b += c; if (b.length > 20e6) { reject(new Error('body too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(new Error('bad json')); } });
    req.on('error', reject);
  });
}
function safeName(name) {
  return String(name || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim().slice(0, 60);
}
function bookDir(name) { return path.join(DATA, safeName(name)); }
function projPath(name) { return path.join(bookDir(name), 'project.json'); }
function loadProj(name) { return JSON.parse(fs.readFileSync(projPath(name), 'utf-8')); }
function saveProj(name, p) { fs.writeFileSync(projPath(name), JSON.stringify(p, null, 2), 'utf-8'); }
const countWords = s => String(s || '').replace(/\s+/g, '').length;
function today() {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function newProject(name) {
  return {
    name, createdAt: today(),
    settings: { indent: true, blankLine: true, titleFormat: '第{n}章　{title}' },
    chapters: [],      // {file,title,role,status,words,updatedAt}
    characters: [],    // {id,name,camp,oneLine,bio,desire,fear,secret,consistency,x,y}
    relations: [],     // {id,from,to,type,note}
    conflicts: [],     // {id,text,type,chars,map,chapters,status,note}
    outline: [],       // {id,title,type,tension,map,note,conflictId}
    materials: [],     // {id,content,tags,source,createdAt}
    log: {},           // {"2026-09-03": 1234}
  };
}

// ---------- API ----------
async function apiRoute(req, res, seg) {
  // seg: ['api', ...]
  const m = req.method;
  const books = () => fs.readdirSync(DATA, { withFileTypes: true }).filter(d => d.isDirectory() && safeName(d.name) === d.name).map(d => d.name);

  if (seg[1] === 'books' && seg.length === 2) {
    if (m === 'GET') return json(res, 200, { books: books() });
    if (m === 'POST') {
      const body = await readBody(req);
      const name = safeName(body.name);
      if (!name) return json(res, 400, { error: '书名无效' });
      if (fs.existsSync(bookDir(name))) return json(res, 409, { error: '已存在同名书籍' });
      fs.mkdirSync(path.join(bookDir(name), '章节'), { recursive: true });
      saveProj(name, newProject(name));
      return json(res, 200, { ok: true, name });
    }
  }
  if (seg[1] === 'books' && seg.length === 3) {
    const name = seg[2];
    if (!fs.existsSync(projPath(name))) return json(res, 404, { error: '书籍不存在' });
    if (m === 'GET') {
      const p = loadProj(name);
      return json(res, 200, { project: p, total: p.chapters.reduce((a, c) => a + (c.words || 0), 0) });
    }
    if (m === 'DELETE') {
      fs.rmSync(bookDir(name), { recursive: true, force: true });
      return json(res, 200, { ok: true });
    }
  }
  const name = seg[2];
  if (seg[1] === 'books' && seg[3] === 'project' && m === 'PUT') {
    const body = await readBody(req);
    const p = loadProj(name);
    // 只覆盖已知结构化字段，防止前端旧数据破坏文件
    if (body.project) {
      for (const k of ['settings', 'chapters', 'characters', 'relations', 'conflicts', 'outline', 'materials', 'log']) {
        if (body.project[k] !== undefined) p[k] = body.project[k];
      }
    }
    saveProj(name, p);
    return json(res, 200, { ok: true });
  }
  if (seg[1] === 'books' && seg[3] === 'chapters') {
    const p = loadProj(name);
    const dir = path.join(bookDir(name), '章节');
    if (seg.length === 4 && m === 'POST') { // 新建章节
      const body = await readBody(req);
      let n = p.chapters.length + 1;
      while (p.chapters.some(c => c.file === String(n).padStart(4, '0') + '.md')) n++;
      const file = String(n).padStart(4, '0') + '.md';
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, file), '', 'utf-8');
      p.chapters.push({ file, title: String(body.title || '未命名'), role: (p.chapters.length % 4) + 1, status: '草稿', words: 0, updatedAt: today() });
      saveProj(name, p);
      return json(res, 200, { ok: true, file });
    }
    if (seg.length === 5) {
      const file = seg[4];
      if (!/^\d{4}\.md$/.test(file)) return json(res, 400, { error: 'bad file' });
      const fp = path.join(dir, file);
      const meta = p.chapters.find(c => c.file === file);
      if (m === 'GET') {
        if (!meta) return json(res, 404, { error: '章节不存在' });
        return json(res, 200, { content: fs.readFileSync(fp, 'utf-8'), meta });
      }
      if (m === 'PUT') {
        const body = await readBody(req);
        if (!meta) return json(res, 404, { error: '章节不存在' });
        fs.writeFileSync(fp, String(body.content || ''), 'utf-8');
        const w = countWords(body.content);
        const delta = w - (meta.words || 0);
        const t = today();
        p.log[t] = Math.max(0, (p.log[t] || 0) + delta);
        if (body.title !== undefined) meta.title = String(body.title).slice(0, 80);
        if (body.role !== undefined) meta.role = Number(body.role) || 1;
        if (body.status !== undefined) meta.status = body.status;
        meta.words = w; meta.updatedAt = t;
        saveProj(name, p);
        return json(res, 200, { ok: true, words: w, today: p.log[t] });
      }
      if (m === 'DELETE') {
        if (!meta) return json(res, 404, { error: '章节不存在' });
        fs.rmSync(fp, { force: true });
        p.chapters = p.chapters.filter(c => c.file !== file);
        saveProj(name, p);
        return json(res, 200, { ok: true });
      }
    }
  }
  if (seg[1] === 'books' && seg[3] === 'export' && m === 'POST') {
    const body = await readBody(req);
    const p = loadProj(name);
    const st = p.settings;
    const parts = p.chapters.map((c, i) => {
      const raw = fs.readFileSync(path.join(bookDir(name), '章节', c.file), 'utf-8');
      const paras = raw.split(/\n+/).map(s => s.trim()).filter(Boolean);
      let title = (st.titleFormat || '第{n}章　{title}').replace('{n}', i + 1).replace('{title}', c.title || '');
      if (body.format === 'md') return '## ' + title + '\n\n' + paras.join('\n\n');
      const body2 = paras.map(t => (st.indent ? '　　' + t : t)).join(st.blankLine ? '\n\n' : '\n');
      return title + '\n\n' + body2;
    });
    const content = parts.join('\n\n\n');
    const ext = body.format === 'md' ? 'md' : 'txt';
    const outDir = path.join(bookDir(name), '导出');
    fs.mkdirSync(outDir, { recursive: true });
    const out = path.join(outDir, safeName(name) + '-全集.' + ext);
    fs.writeFileSync(out, content, 'utf-8');
    return json(res, 200, { ok: true, path: out, chars: countWords(content), chapters: p.chapters.length });
  }
  json(res, 404, { error: 'not found' });
}

// ---------- 静态文件 ----------
function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  const fp = path.normalize(path.join(PUB, rel));
  if (!fp.startsWith(PUB)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('404'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://x');
    const seg = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (seg[0] === 'api') return await apiRoute(req, res, seg);
    return serveStatic(req, res, u.pathname);
  } catch (e) {
    json(res, 500, { error: e.message });
  }
});

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n  简单写小说 · 本地写作台已启动\n  地址: ${url}\n  数据目录: ${DATA}\n  按 Ctrl+C 退出\n`);
  if (process.platform === 'win32' && !process.env.NO_BROWSER) exec(`start "" "${url}"`);
});
