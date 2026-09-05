/* 简单写小说 · 本地写作台 —— 前端逻辑（零依赖） */
'use strict';

// ---------- 工具 ----------
const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const today = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 1800);
}
async function api(method, path, body) {
  const res = await fetch(path, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.status);
  return data;
}
function openModal(html) {
  $('#modalBox').innerHTML = html;
  $('#modalMask').classList.remove('hidden');
}
function closeModal() { $('#modalMask').classList.add('hidden'); $('#modalBox').innerHTML = ''; }
$('#modalMask')?.addEventListener('click', e => { if (e.target.id === 'modalMask') closeModal(); });

// ---------- 常量 ----------
const CAMPS = ['主角方', '对手方', '第三方'];
const CAMP_COLOR = { '主角方': '#3f7d5a', '对手方': '#b3342a', '第三方': '#b8860b' };
const CAMP_FILL = { '主角方': '#e2efe7', '对手方': '#f6e1df', '第三方': '#f4ecd6' };
const CONFLICT_TYPES = ['收人', '杀人', '副本', '陷害'];
const TYPE_CLS = { '收人': 'b-green', '杀人': 'b-red', '副本': 'b-yellow', '陷害': 'b-purple' };
const UNIT_CLS = { '收人': 'u-green', '杀人': 'u-red', '副本': 'u-yellow', '陷害': 'u-purple' };
const REL_TYPES = ['敌对', '师徒', '亲戚', '私情', '秘密', '恩情', '依附', '旧识', '其他'];
const MAT_TAGS = ['人物', '情节', '设定', '金手指', '桥段', '台词', '其他'];
const ROLES = {
  1: { name: '① 代入+信息差', hint: '上半（约一半篇幅）：用<b>熟悉的日常</b>让读者代入——起床、吃饭、赶路、和朋友聊接下来要见谁（N+1 原则）。下半：立一个<b>主角金手指可解的困境</b>，信息差做出来，期待就有了。比例约 5:5。' },
  2: { name: '② 拉期待', hint: '约 9:1。九分篇幅：靠配角台词、神态、心理活动把期待<b>继续加码拉扯</b>；一分篇幅：<b>结尾让主角开始动手</b>（是开始，不是装完）。没动手读者会烦，装完了爽感就被剧透光。' },
  3: { name: '③ 兑现', hint: '唯一目的：把读者期待了两章的内容<b>写透</b>，写出他幻想中的画面。这是四章里最好写的一章，<b>不留任何新钩子</b>——读者自然会翻下一章。' },
  4: { name: '④ 承上启下', hint: '两部分：<b>善后</b>（明确体现推进——大人物答应帮忙 / 获得收获）＋<b>下一个目标</b>（读者要离场了，立刻告诉他下一步去哪）。其余内容都会伤追读，删。' },
};

// ---------- 状态 ----------
const S = {
  books: [], book: null, project: null,
  cur: null, curContent: '', dirty: false, preview: false,
  linkMode: false, linkFrom: null, selChar: null,
  matFilterTag: '', matSearch: '',
};

// ---------- 保存 ----------
async function saveProject(silent) {
  if (!S.book || !S.project) return;
  await api('PUT', `/api/books/${encodeURIComponent(S.book)}/project`, { project: S.project });
  if (!silent) toast('已保存');
}
const saveProjectDebounced = debounce(() => saveProject(true), 700);

// ---------- 路由 ----------
function nav(hash) { location.hash = hash; }
window.addEventListener('hashchange', route);
window.addEventListener('beforeunload', e => { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } });

function parseHash() {
  const h = location.hash.replace(/^#/, '');
  const seg = h.split('/').filter(Boolean).map(decodeURIComponent);
  if (seg[0] === 'b' && seg[1]) return { book: seg[1], tab: seg[2] || '素材' };
  return { book: null, tab: '' };
}

async function route() {
  const { book, tab } = parseHash();
  closeModal();
  if (!book) { S.book = null; S.project = null; S.cur = null; return renderHome(); }
  if (S.book !== book || !S.project) {
    const d = await api('GET', `/api/books/${encodeURIComponent(book)}`);
    S.book = book; S.project = d.project;
    for (const k of ['characters', 'relations', 'conflicts', 'outline', 'materials', 'chapters']) {
      if (!Array.isArray(S.project[k])) S.project[k] = [];
    }
    if (!S.project.settings) S.project.settings = { indent: true, blankLine: true, titleFormat: '第{n}章　{title}' };
    if (!S.project.log) S.project.log = {};
    S.cur = null; S.preview = false;
  }
  renderTabs(tab);
  const views = { '素材': renderMaterials, '人物': renderCharacters, '关系': renderGraph, '矛盾': renderConflicts, '大纲': renderOutline, '写作': renderWriting, '导出': renderExport };
  (views[tab] || renderMaterials)();
}

function renderTabs(active) {
  const tabs = ['素材', '人物', '关系', '矛盾', '大纲', '写作', '导出'];
  $('#tabs').innerHTML =
    `<button onclick="nav('/')">📚 书架</button>` +
    tabs.map(t => `<button class="${t === active ? 'on' : ''}" onclick="nav('/b/${encodeURIComponent(S.book)}/${t}')">${t}</button>`).join('');
  const total = S.project.chapters.reduce((a, c) => a + (c.words || 0), 0);
  $('#topRight').textContent = `《${S.book}》 · ${S.project.chapters.length} 章 · ${total.toLocaleString()} 字`;
}

// ---------- 首页：书架 ----------
async function renderHome() {
  $('#tabs').innerHTML = '';
  $('#topRight').textContent = '';
  const d = await api('GET', '/api/books');
  S.books = d.books;
  const cards = await Promise.all(d.books.map(async name => {
    try {
      const p = await api('GET', `/api/books/${encodeURIComponent(name)}`);
      const total = p.project.chapters.reduce((a, c) => a + (c.words || 0), 0);
      return `<div class="book-card" onclick="nav('/b/${encodeURIComponent(name)}/写作')">
        <h4>${esc(name)}</h4>
        <div class="meta">${p.project.chapters.length} 章 · ${total.toLocaleString()} 字 · 建于 ${esc(p.project.createdAt)}</div>
        <button class="btn ghost mini del" onclick="event.stopPropagation();delBook('${esc(name)}')">删除</button>
      </div>`;
    } catch { return ''; }
  }));
  $('#view').innerHTML = `
    <h2 class="page-title">书架</h2>
    <p class="page-sub">所有数据保存在本地「作品」文件夹中（章节为 .md 文件，结构数据为 project.json），可用 git/网盘备份。</p>
    <div class="card">
      <div class="row">
        <input type="text" id="newBook" placeholder="新书名……" style="width:260px" onkeydown="if(event.key==='Enter')createBook()">
        <button class="btn seal" onclick="createBook()">开新书</button>
      </div>
    </div>
    ${d.books.length ? `<div class="book-grid">${cards.join('')}</div>` : `<div class="empty-tip">书架空空如也——开一本新书开始吧</div>`}`;
}
async function createBook() {
  const name = $('#newBook').value.trim();
  if (!name) return;
  try { await api('POST', '/api/books', { name }); toast(`《${name}》已创建`); nav(`/b/${encodeURIComponent(name)}/素材`); }
  catch (e) { toast(e.message); }
}
async function delBook(name) {
  openModal(`<h3>删除《${esc(name)}》？</h3><p class="muted">章节、构思、素材将一并删除，不可恢复。</p>
    <div class="row" style="margin-top:16px;justify-content:flex-end">
      <button class="btn ghost" onclick="closeModal()">取消</button>
      <button class="btn seal" onclick="doDelBook('${esc(name)}')">确认删除</button></div>`);
}
async function doDelBook(name) {
  await api('DELETE', `/api/books/${encodeURIComponent(name)}`);
  closeModal(); toast('已删除'); route();
}

// ---------- 素材 ----------
function renderMaterials() {
  const mats = S.project.materials;
  const tagCounts = {};
  mats.forEach(m => (m.tags || []).forEach(t => tagCounts[t] = (tagCounts[t] || 0) + 1));
  const kw = S.matSearch.toLowerCase();
  const shown = mats.filter(m =>
    (!S.matFilterTag || (m.tags || []).includes(S.matFilterTag)) &&
    (!kw || (m.content + '|' + (m.source || '')).toLowerCase().includes(kw))
  ).slice().reverse();
  $('#view').innerHTML = `
    <h2 class="page-title">素材库</h2>
    <p class="page-sub">看到任何有感觉的东西——桥段、人设、台词、设定——随手扔进来，打上标签。灵感不等人。</p>
    <div class="card">
      <textarea id="matText" rows="3" placeholder="粘贴或输入素材……（Ctrl+Enter 保存）" onkeydown="if(event.ctrlKey&&event.key==='Enter')addMat()"></textarea>
      <div class="row" style="margin-top:10px">
        ${MAT_TAGS.map(t => `<span class="tag-chip" id="tagpick-${t}" onclick="pickTag('${t}')">${t}</span>`).join('')}
        <input type="text" id="matSrc" placeholder="来源（书名/剧名/链接，可空）" style="flex:1;min-width:160px">
        <button class="btn seal" onclick="addMat()">收进素材库</button>
      </div>
    </div>
    <div class="row" style="margin-bottom:12px">
      <span class="muted">筛选：</span>
      <span class="tag-chip ${!S.matFilterTag ? 'on' : ''}" onclick="S.matFilterTag='';renderMaterials()">全部(${mats.length})</span>
      ${MAT_TAGS.filter(t => tagCounts[t]).map(t => `<span class="tag-chip ${S.matFilterTag === t ? 'on' : ''}" onclick="S.matFilterTag='${t}';renderMaterials()">${t}(${tagCounts[t]})</span>`).join('')}
      <input type="text" placeholder="搜索…" value="${esc(S.matSearch)}" style="width:180px;margin-left:auto"
        oninput="S.matSearch=this.value;refreshMatList()">
    </div>
    <div id="matList"></div>`;
  refreshMatList();
}
let matPicked = [];
function pickTag(t) {
  const i = matPicked.indexOf(t);
  if (i >= 0) matPicked.splice(i, 1); else matPicked.push(t);
  $(`#tagpick-${t}`)?.classList.toggle('on');
}
function refreshMatList() {
  const kw = S.matSearch.toLowerCase();
  const mats = S.project.materials.filter(m =>
    (!S.matFilterTag || (m.tags || []).includes(S.matFilterTag)) &&
    (!kw || (m.content + '|' + (m.source || '')).toLowerCase().includes(kw))
  ).slice().reverse();
  $('#matList').innerHTML = mats.length ? mats.map(m => `
    <div class="card mat-card" style="border-left-color:${CAMP_COLOR['第三方']}">
      <div class="mc-body">${esc(m.content)}</div>
      <div class="mc-foot">
        ${(m.tags || []).map(t => `<span class="badge b-gray">${esc(t)}</span>`).join('')}
        ${m.source ? `<span>来源：${esc(m.source)}</span>` : ''}
        <span>${esc(m.createdAt)}</span>
        <span style="margin-left:auto;display:flex;gap:6px">
          <button class="btn ghost mini" onclick="matToConflict('${m.id}')">→ 剧情矛盾</button>
          <button class="btn ghost mini" onclick="delItem('materials','${m.id}')">删除</button>
        </span>
      </div>
    </div>`).join('') : `<div class="empty-tip">没有匹配的素材</div>`;
}
async function addMat() {
  const content = $('#matText').value.trim();
  if (!content) return toast('内容为空');
  S.project.materials.push({ id: uid(), content, tags: matPicked.slice(), source: $('#matSrc').value.trim(), createdAt: today() });
  $('#matText').value = ''; $('#matSrc').value = '';
  matPicked = [];
  await saveProject(true); refreshMatList(); toast('已收录');
}
async function matToConflict(id) {
  const m = S.project.materials.find(x => x.id === id);
  if (!m) return;
  S.project.conflicts.push({ id: uid(), text: m.content.slice(0, 60), type: '收人', chars: '', map: '', chapters: '20', status: '待排', note: '来自素材：' + m.content.slice(0, 30) });
  await saveProject(true); toast('已转为剧情矛盾（见「矛盾」页）');
}

// ---------- 通用删除 ----------
async function delItem(listName, id) {
  S.project[listName] = S.project[listName].filter(x => x.id !== id);
  // 同步清理：关系引用的人物
  if (listName === 'characters') S.project.relations = S.project.relations.filter(r => r.from !== id && r.to !== id);
  await saveProject(true);
  route();
}

// ---------- 人物 ----------
function renderCharacters() {
  const chars = S.project.characters;
  const sel = S.selChar && chars.find(c => c.id === S.selChar) ? S.selChar : null;
  const groups = CAMPS.map(camp => ({ camp, list: chars.filter(c => c.camp === camp) }));
  $('#view').innerHTML = `
    <h2 class="page-title">人物卡</h2>
    <p class="page-sub">人设即世界观。先立欲望与恐惧（剧情引擎），再填秘密（情节炸药）；「不会做的事」是防写崩的红线。</p>
    <div class="char-cols">
      <div>
        ${groups.map(g => `
          <h3 style="font-size:13px;margin:10px 0 8px"><span class="camp-dot" style="background:${CAMP_COLOR[g.camp]}"></span>${g.camp}（${g.list.length}）</h3>
          ${g.list.map(c => `
            <div class="char-item ${c.id === sel ? 'on' : ''}" onclick="S.selChar='${c.id}';renderCharacters()">
              <h5>${esc(c.name || '未命名')}</h5><p>${esc(c.oneLine || '一句话人设…')}</p>
            </div>`).join('') || `<p class="muted" style="margin:4px 0 10px">暂无</p>`}
        `).join('')}
        <button class="btn seal" style="width:100%;margin-top:6px" onclick="newChar()">＋ 新建人物</button>
      </div>
      <div id="charForm" class="card">${sel ? charFormHTML(chars.find(c => c.id === sel)) : `<div class="empty-tip">← 选择或新建一个人物</div>`}</div>
    </div>`;
}
function charFormHTML(c) {
  const f = (k, label, ph) => `<div class="field ${k === 'bio' || k === 'consistency' ? 'full' : ''}">
    <span>${label}</span>
    ${k === 'bio' || k === 'consistency'
      ? `<textarea rows="4" id="cf-${k}" placeholder="${ph}">${esc(c[k] || '')}</textarea>`
      : `<input type="text" id="cf-${k}" placeholder="${ph}" value="${esc(c[k] || '')}">`}
  </div>`;
  return `<h3>${esc(c.name || '新人物')}</h3>
    <div class="form-grid">
      ${f('name', '姓名 *', '如：李昭')}
      <div class="field"><span>阵营</span><select id="cf-camp">${CAMPS.map(x => `<option ${c.camp === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
      ${f('oneLine', '一句话人设', '强大、话少、高冷')}
      <div class="field"><span>欲望（最想要）</span><input type="text" id="cf-desire" value="${esc(c.desire || '')}"></div>
      <div class="field"><span>恐惧（最怕）</span><input type="text" id="cf-fear" value="${esc(c.fear || '')}"></div>
      ${f('secret', '秘密（藏着什么/谁知道）', '身世、把柄、私情…')}
      ${f('bio', '生平经历', '他如何变成今天这个人（3~5 段）')}
      ${f('consistency', '一致性红线（这个角色不会做的事）', '例：不会撒娇卖萌、不会背叛主角')}
    </div>
    <div class="row" style="margin-top:8px;justify-content:flex-end">
      <button class="btn ghost" onclick="delItem('characters','${c.id}')">删除</button>
      <button class="btn seal" onclick="saveChar('${c.id}')">保存</button>
    </div>
    <p class="muted" style="margin-top:8px">人物位置在「关系」页拖动调整</p>`;
}
function newChar() {
  const c = { id: uid(), name: '', camp: '主角方', oneLine: '', bio: '', desire: '', fear: '', secret: '', consistency: '', x: null, y: null };
  S.project.characters.push(c);
  S.selChar = c.id;
  saveProject(true); renderCharacters();
}
async function saveChar(id) {
  const c = S.project.characters.find(x => x.id === id);
  if (!c) return;
  for (const k of ['name', 'oneLine', 'desire', 'fear', 'secret', 'bio', 'consistency', 'camp']) {
    const e = $(`#cf-${k}`); if (e) c[k] = e.value.trim();
  }
  if (!c.name) return toast('姓名必填');
  await saveProject(true); renderCharacters(); toast('人物已保存');
}

// ---------- 关系图 ----------
function renderGraph() {
  const chars = S.project.characters;
  if (!chars.length) {
    $('#view').innerHTML = `<h2 class="page-title">人物关系图</h2>
      <div class="empty-tip">还没有人物——先去「人物」页建几张人物卡</div>
      <button class="btn" onclick="nav('/b/${encodeURIComponent(S.book)}/人物')">前往人物页</button>`;
    return;
  }
  // 默认位置：按阵营分列
  const colX = { '主角方': 260, '对手方': 620, '第三方': 960 };
  const counters = {};
  chars.forEach(c => {
    if (c.x == null || c.y == null) {
      counters[c.camp] = (counters[c.camp] || 0);
      c.x = colX[c.camp] || 600; c.y = 110 + (counters[c.camp]++ % 6) * 115;
    }
  });
  $('#view').innerHTML = `
    <h2 class="page-title">人物关系图</h2>
    <p class="page-sub">拖动卡片排版；点「连线」后依次点击两张卡片创建关系。<b style="color:var(--seal)">关系 = 剧情</b>：任意两人说不出一条关系，就删一人或加一线。</p>
    <div id="graphWrap">
      <div class="graph-bar">
        <button class="btn ${S.linkMode ? 'seal' : ''}" onclick="toggleLink()">${S.linkMode ? '连线中…点击第二张卡' : '＋ 连线'}</button>
        <span class="muted">${S.linkMode ? (S.linkFrom ? '已选第一张，再点一张' : '先点一张卡') : '当前 ' + S.project.relations.length + ' 条关系'}</span>
        <span style="margin-left:auto">${CAMPS.map(c => `<span class="camp-dot" style="background:${CAMP_COLOR[c]}"></span>${c}`).join('　')}</span>
      </div>
      <svg id="graphSvg" viewBox="0 0 1200 800"></svg>
    </div>
    <div class="card" style="margin-top:14px"><h3>关系清单</h3><div id="relTable"></div></div>`;
  drawGraph();
  drawRelTable();
}
function toggleLink() { S.linkMode = !S.linkMode; S.linkFrom = null; renderGraph(); }
function drawGraph() {
  const svg = $('#graphSvg');
  const chars = S.project.characters;
  // 只画两端人物都存在的关系，并让拖拽更新按同一子集对位
  const validRels = S.project.relations.filter(r => chars.some(c => c.id === r.from) && chars.some(c => c.id === r.to));
  S._validRels = validRels;
  let edges = '', nodes = '';
  for (const r of validRels) {
    const a = chars.find(c => c.id === r.from), b = chars.find(c => c.id === r.to);
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const hostile = r.type === '敌对';
    edges += `<g class="gedge"><line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"
      stroke="${hostile ? '#b3342a' : r.type === '秘密' || r.type === '私情' ? '#6b5b95' : '#8a8578'}"
      stroke-dasharray="${r.type === '秘密' || r.type === '私情' ? '6 4' : ''}" stroke-width="1.7"></line>
      <text x="${mx}" y="${my - 5}" text-anchor="middle">${esc(r.type)}${r.note ? '·' + esc(r.note.slice(0, 8)) : ''}</text></g>`;
  }
  for (const c of chars) {
    const selCls = (S.linkFrom === c.id) ? ' sel' : '';
    nodes += `<g class="gnode${selCls}" data-id="${c.id}" transform="translate(${c.x},${c.y})">
      <rect x="-72" y="-26" width="144" height="52" rx="8" fill="${CAMP_FILL[c.camp] || '#eee'}" stroke="${CAMP_COLOR[c.camp] || '#999'}"></rect>
      <text text-anchor="middle" y="-2" font-weight="600">${esc(c.name || '未命名')}</text>
      <text text-anchor="middle" y="15" font-size="10" fill="#777">${esc((c.oneLine || '').slice(0, 10))}</text>
    </g>`;
  }
  svg.innerHTML = edges + nodes;
  // 拖拽 & 点击连线
  let dragChar = null, moved = false;
  svg.addEventListener('pointerdown', e => {
    const g = e.target.closest('.gnode');
    if (!g) return;
    dragChar = S.project.characters.find(c => c.id === g.dataset.id);
    moved = false; dragChar._sx = dragChar.x; dragChar._sy = dragChar.y;
  });
  svg.addEventListener('pointermove', e => {
    if (!dragChar) return;
    const p = svgPoint(svg, e);
    const nx = Math.max(80, Math.min(1120, p.x)), ny = Math.max(35, Math.min(770, p.y));
    if (Math.abs(nx - dragChar._sx) + Math.abs(ny - dragChar._sy) > 3) moved = true;
    dragChar.x = nx; dragChar.y = ny;
    const g = svg.querySelector(`.gnode[data-id="${dragChar.id}"]`);
    if (g) g.setAttribute('transform', `translate(${nx},${ny})`);
    redrawEdgesFor(dragChar.id);
  });
  svg.addEventListener('pointerup', () => {
    if (!dragChar) return;
    if (!moved && S.linkMode) {
      if (!S.linkFrom) { S.linkFrom = dragChar.id; }
      else if (S.linkFrom !== dragChar.id) { openRelModal(S.linkFrom, dragChar.id); S.linkFrom = null; return; }
      drawGraph();
    }
    if (moved) saveProjectDebounced();
    dragChar = null;
  });
}
function redrawEdgesFor(charId) {
  const svg = $('#graphSvg');
  const get = id => S.project.characters.find(c => c.id === id);
  svg.querySelectorAll('.gedge').forEach((g, i) => {
    const r = (S._validRels || [])[i];
    const a = get(r?.from), b = get(r?.to);
    if (!a || !b || (a.id !== charId && b.id !== charId)) return;
    const l = g.querySelector('line'), t = g.querySelector('text');
    l.setAttribute('x1', a.x); l.setAttribute('y1', a.y); l.setAttribute('x2', b.x); l.setAttribute('y2', b.y);
    t.setAttribute('x', (a.x + b.x) / 2); t.setAttribute('y', (a.y + b.y) / 2 - 5);
  });
}
function svgPoint(svg, e) {
  const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}
function openRelModal(fromId, toId) {
  const chars = S.project.characters;
  const a = chars.find(c => c.id === fromId)?.name, b = chars.find(c => c.id === toId)?.name;
  openModal(`<h3>建立关系</h3>
    <p style="margin-bottom:12px"><b>${esc(a)}</b> ↔ <b>${esc(b)}</b></p>
    <div class="field"><span>关系类型</span>
      <select id="relType">${REL_TYPES.map(t => `<option>${t}</option>`).join('')}</select></div>
    <div class="field"><span>备注（能生产什么剧情？）</span><input type="text" id="relNote" placeholder="如：她知道主角身份｜伏笔：忠诚的建立"></div>
    <div class="row" style="justify-content:flex-end;margin-top:8px">
      <button class="btn ghost" onclick="closeModal();toggleLink()">取消</button>
      <button class="btn seal" onclick="addRel('${fromId}','${toId}')">保存</button></div>`);
}
async function addRel(from, to) {
  S.project.relations.push({ id: uid(), from, to, type: $('#relType').value, note: $('#relNote').value.trim() });
  S.linkMode = false; S.linkFrom = null;
  closeModal(); await saveProject(true); renderGraph();
}
function drawRelTable() {
  const chars = S.project.characters;
  const nameOf = id => chars.find(c => c.id === id)?.name || '？';
  $('#relTable').innerHTML = S.project.relations.length ? `
    <table class="tbl"><tr><th style="width:110px">甲方</th><th style="width:110px">乙方</th><th style="width:100px">类型</th><th>备注</th><th style="width:50px"></th></tr>
    ${S.project.relations.map(r => `<tr>
      <td>${esc(nameOf(r.from))}</td><td>${esc(nameOf(r.to))}</td>
      <td><select onchange="updRel('${r.id}','type',this.value)">${REL_TYPES.map(t => `<option ${r.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select></td>
      <td><input type="text" value="${esc(r.note || '')}" onchange="updRel('${r.id}','note',this.value)"></td>
      <td><button class="btn ghost mini" onclick="delItem('relations','${r.id}')">✕</button></td>
    </tr>`).join('')}</table>` : `<div class="empty-tip">还没有关系——点上方「连线」创建</div>`;
}
async function updRel(id, k, v) {
  const r = S.project.relations.find(x => x.id === id);
  if (r) { r[k] = v; await saveProject(true); if (k === 'type') renderGraph(); }
}

// ---------- 剧情矛盾 ----------
function renderConflicts() {
  const cs = S.project.conflicts;
  $('#view').innerHTML = `
    <h2 class="page-title">剧情矛盾清单</h2>
    <p class="page-sub">每条矛盾 ≈ 20 章的剧情。目标：<b style="color:var(--seal)">攒够几十条</b>才算撑起一本书（收人与杀人两类都要有，供大纲做 2:1 配比）。</p>
    <div class="row" style="margin-bottom:12px">
      <button class="btn seal" onclick="addConflict()">＋ 新增矛盾</button>
      <span class="muted">共 ${cs.length} 条 · 收人 ${cs.filter(c => c.type === '收人').length} / 杀人 ${cs.filter(c => c.type === '杀人').length} / 副本 ${cs.filter(c => c.type === '副本').length} / 陷害 ${cs.filter(c => c.type === '陷害').length}</span>
    </div>
    ${cs.length ? `<div style="overflow:auto"><table class="tbl">
      <tr><th style="width:36px">#</th><th>矛盾（谁与谁、因为什么、不可调和在哪）</th><th style="width:80px">类型</th><th style="width:110px">涉及人物</th><th style="width:80px">地图</th><th style="width:70px">预计章数</th><th style="width:76px">状态</th><th style="width:150px">操作</th></tr>
      ${cs.map((c, i) => `<tr>
        <td>${i + 1}</td>
        <td><textarea rows="2" style="width:100%" onchange="updConflict('${c.id}','text',this.value)">${esc(c.text)}</textarea></td>
        <td><select onchange="updConflict('${c.id}','type',this.value)">${CONFLICT_TYPES.map(t => `<option ${c.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select></td>
        <td><input type="text" value="${esc(c.chars || '')}" onchange="updConflict('${c.id}','chars',this.value)"></td>
        <td><input type="text" value="${esc(c.map || '')}" onchange="updConflict('${c.id}','map',this.value)" placeholder="京城/地方…"></td>
        <td><input type="text" value="${esc(c.chapters || '')}" onchange="updConflict('${c.id}','chapters',this.value)"></td>
        <td><select onchange="updConflict('${c.id}','status',this.value)">${['待排', '已排', '已写', '砍掉'].map(t => `<option ${c.status === t ? 'selected' : ''}>${t}</option>`).join('')}</select></td>
        <td><div class="row" style="gap:6px">
          <button class="btn mini" onclick="conflictToOutline('${c.id}')">排入大纲</button>
          <button class="btn ghost mini" onclick="delItem('conflicts','${c.id}')">✕</button></div></td>
      </tr>`).join('')}
    </table></div>` : `<div class="empty-tip">还没有登记矛盾——取材时冒出的每个灵感都值得记一条</div>`}`;
}
async function addConflict() {
  S.project.conflicts.push({ id: uid(), text: '', type: '收人', chars: '', map: '', chapters: '20', status: '待排', note: '' });
  await saveProject(true); renderConflicts();
}
async function updConflict(id, k, v) {
  const c = S.project.conflicts.find(x => x.id === id);
  if (c) { c[k] = v; await saveProject(true); if (k === 'type') renderConflicts(); }
}
async function conflictToOutline(id) {
  const c = S.project.conflicts.find(x => x.id === id);
  if (!c) return;
  if (!c.text.trim()) return toast('先填写矛盾内容');
  S.project.outline.push({
    id: uid(), title: c.text.slice(0, 20), type: c.type,
    tension: c.type === '杀人' || c.type === '陷害' ? '张' : '弛',
    map: c.map || '', note: '矛盾：' + c.text.slice(0, 40), conflictId: id,
  });
  c.status = '已排';
  await saveProject(true); renderConflicts(); toast('已排入大纲末尾');
}

// ---------- 大纲 ----------
function renderOutline() {
  const us = S.project.outline;
  const cnt = t => us.filter(u => u.type === t).length;
  const grow = cnt('收人') + cnt('副本'), fight = cnt('杀人') + cnt('陷害');
  const ratioTxt = fight ? `约 ${(grow / fight).toFixed(1)} : 1` : '—';
  // 张弛检查：连续 3 个相同
  let runs = [];
  if (us.length >= 3) {
    let s = 0;
    for (let i = 1; i <= us.length; i++) {
      if (i === us.length || us[i].tension !== us[s].tension) {
        if (i - s >= 3) runs.push(`第 ${s + 1}–${i} 单元连续「${us[s].tension}」`);
        s = i;
      }
    }
  }
  $('#view').innerHTML = `
    <h2 class="page-title">大纲排布</h2>
    <p class="page-sub">把矛盾串成一条线，拖动调整顺序。颜色 = 类型；写完一卷回来核对下面的检查项。</p>
    <div class="card"><div class="check-panel">
      <span>单元：<b>${us.length}</b></span>
      <span>升级类(收人+副本) <b>${grow}</b> ： 战斗类(杀人+陷害) <b>${fight}</b>　${ratioTxt}
        <span class="${grow && !fight ? 'warn' : (grow && fight && (grow / fight > 3.5 || grow / fight < 1.2) ? 'warn' : 'ok')}">目标 ≈ 2:1</span></span>
      <span>张弛：${runs.length ? `<span class="warn">${runs.join('；')}</span>` : '<span class="ok">无连续 3 单元同氛围 ✓</span>'}</span>
      <span class="muted">（前 100 万字严格执行，之后允许调整）</span>
    </div></div>
    <div class="row" style="margin-bottom:10px"><button class="btn seal" onclick="addUnit()">＋ 新增单元</button>
    <span class="muted">拖动 ⠿ 调整顺序</span></div>
    ${us.length ? us.map((u, i) => `
      <div class="unit-row" draggable="true" data-i="${i}" id="unit-${i}">
        <div class="unit-tools">
          <span style="cursor:grab;color:#999;text-align:center" title="拖动排序">⠿</span>
          <span class="badge ${TYPE_CLS[u.type] || 'b-gray'}">${i + 1}</span>
        </div>
        <div class="unit-main ${UNIT_CLS[u.type] || ''}">
          <div class="row" style="align-items:flex-start">
            <input type="text" value="${esc(u.title)}" placeholder="单元标题" style="flex:1;min-width:140px;font-weight:600" onchange="updUnit(${i},'title',this.value)">
            <select onchange="updUnit(${i},'type',this.value)" style="width:80px">${CONFLICT_TYPES.map(t => `<option ${u.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select>
            <select onchange="updUnit(${i},'tension',this.value)" style="width:64px">
              <option ${u.tension === '张' ? 'selected' : ''}>张</option><option ${u.tension === '弛' ? 'selected' : ''}>弛</option></select>
            <input type="text" value="${esc(u.map || '')}" placeholder="地图" style="width:90px" onchange="updUnit(${i},'map',this.value)">
            <button class="btn ghost mini" onclick="delUnit(${i})">✕</button>
          </div>
          <input type="text" value="${esc(u.note || '')}" placeholder="主线推进 / 养书关联设计（本单元结束后主线状态变化一句话）"
            style="width:100%;margin-top:6px;border:none;border-bottom:1px dashed var(--line);border-radius:0;background:transparent" onchange="updUnit(${i},'note',this.value)">
        </div>
      </div>`).join('') : `<div class="empty-tip">大纲还是空的——去「矛盾」页把矛盾排入大纲，或直接新增单元</div>`}`;
  enableUnitDrag();
}
async function addUnit() {
  S.project.outline.push({ id: uid(), title: '', type: '收人', tension: '弛', map: '', note: '', conflictId: '' });
  await saveProject(true); renderOutline();
}
async function updUnit(i, k, v) {
  if (!S.project.outline[i]) return;
  S.project.outline[i][k] = v;
  await saveProject(true);
  if (k === 'type') renderOutline();
}
async function delUnit(i) {
  S.project.outline.splice(i, 1);
  await saveProject(true); renderOutline();
}
function enableUnitDrag() {
  let from = null;
  document.querySelectorAll('.unit-row').forEach(row => {
    row.addEventListener('dragstart', () => { from = +row.dataset.i; row.style.opacity = .4; });
    row.addEventListener('dragend', () => row.style.opacity = 1);
    row.addEventListener('dragover', e => e.preventDefault());
    row.addEventListener('drop', async e => {
      e.preventDefault();
      const to = +row.dataset.i;
      if (from === null || from === to) return;
      const [m] = S.project.outline.splice(from, 1);
      S.project.outline.splice(to, 0, m);
      await saveProject(true); renderOutline();
    });
  });
}

// ---------- 写作 ----------
async function renderWriting() {
  const chs = S.project.chapters;
  if (!S.cur && chs.length) S.cur = chs[0].file;
  const meta = chs.find(c => c.file === S.cur);
  const total = chs.reduce((a, c) => a + (c.words || 0), 0);
  $('#view').innerHTML = `
    <div class="write-wrap">
      <div class="ch-list">
        <div class="ch-tools">
          <button class="btn seal mini" style="flex:1" onclick="addChapter()">＋ 新章</button>
          <button class="btn ghost mini" onclick="moveChapter(-1)" title="上移">↑</button>
          <button class="btn ghost mini" onclick="moveChapter(1)" title="下移">↓</button>
          <button class="btn ghost mini" onclick="delChapter()" title="删除本章">✕</button>
        </div>
        ${chs.map((c, i) => `
          <div class="ch-item ${c.file === S.cur ? 'on' : ''}" onclick="openChapter('${c.file}')">
            <span class="num">${String(i + 1).padStart(3, '0')}</span>
            <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.title)}</span>
            <span class="cw">${c.status === '完成' ? '✓' : ''}${(c.words || 0) >= 1000 ? Math.round((c.words || 0) / 1000) + 'k' : (c.words || 0)}</span>
          </div>`).join('') || `<div class="empty-tip">还没有章节</div>`}
      </div>
      <div class="editor-col">
        ${meta ? `
        <div class="ed-bar">
          <input type="text" id="chTitle" value="${esc(meta.title)}" onchange="updMeta('title',this.value)" placeholder="章节标题">
          <select id="chRole" onchange="updMeta('role',this.value);showRoleHint()" style="width:150px">
            ${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${meta.role == k ? 'selected' : ''}>${v.name}</option>`).join('')}
          </select>
          <select onchange="updMeta('status',this.value)" style="width:76px">
            ${['草稿', '完成'].map(t => `<option ${meta.status === t ? 'selected' : ''}>${t}</option>`).join('')}
          </select>
          <button class="btn ghost mini" id="previewBtn" onclick="togglePreview()">预览</button>
          <span class="muted" id="saveState"></span>
        </div>
        <div class="role-hint" id="roleHint"></div>
        <textarea id="editor" placeholder="从这里开始写第 ${chs.findIndex(c => c.file === S.cur) + 1} 章……（Ctrl+S 保存）" spellcheck="false"></textarea>
        <div id="preview" class="hidden"></div>
        <div class="ed-foot">
          <span>本章 <b id="wc">0</b> 字</span>
          <span id="totalWords">全书 ${total.toLocaleString()} 字 · 今日 ${((S.project.log || {})[today()] || 0).toLocaleString()} 字</span>
        </div>` : `<div class="empty-tip" style="align-self:center">← 新建一章开始写作</div>`}
      </div>
    </div>`;
  if (meta) {
    showRoleHint();
    const d = await api('GET', `/api/books/${encodeURIComponent(S.book)}/chapters/${meta.file}`);
    S.curContent = d.content; S.dirty = false;
    const ed = $('#editor');
    ed.value = d.content;
    $('#wc').textContent = (d.meta.words || 0).toLocaleString();
    ed.addEventListener('input', () => {
      S.dirty = true;
      $('#saveState').textContent = '编辑中…';
      $('#wc').textContent = ed.value.replace(/\s+/g, '').length.toLocaleString();
      autoSave();
    });
    ed.addEventListener('keydown', e => {
      if (e.ctrlKey && e.key === 's') { e.preventDefault(); saveChapter(); }
    });
  }
}
const autoSave = debounce(() => saveChapter(), 1000);
async function saveChapter() {
  const ed = $('#editor');
  if (!ed || !S.cur) return;
  const content = ed.value;
  const d = await api('PUT', `/api/books/${encodeURIComponent(S.book)}/chapters/${S.cur}`, { content });
  S.curContent = content; S.dirty = false;
  const meta = S.project.chapters.find(c => c.file === S.cur);
  if (meta) meta.words = d.words;
  S.project.log[today()] = d.today;
  $('#saveState').textContent = '已保存 ' + new Date().toTimeString().slice(0, 5);
  const tw = $('#totalWords');
  if (tw) tw.textContent = `全书 ${S.project.chapters.reduce((a, c) => a + (c.words || 0), 0).toLocaleString()} 字 · 今日 ${(d.today || 0).toLocaleString()} 字`;
  renderTabs('写作');
  // 更新侧栏字数显示
  const idx = S.project.chapters.findIndex(c => c.file === S.cur);
  const item = document.querySelectorAll('.ch-item')[idx];
  if (item) item.querySelector('.cw').textContent = (d.words >= 1000 ? Math.round(d.words / 1000) + 'k' : d.words);
}
function showRoleHint() {
  const r = ROLES[Number($('#chRole')?.value) || 1];
  if (r && $('#roleHint')) $('#roleHint').innerHTML = `<b>${r.name}</b>　${r.hint}`;
}
async function updMeta(k, v) {
  const meta = S.project.chapters.find(c => c.file === S.cur);
  if (!meta) return;
  if (k === 'role') meta.role = Number(v); else meta[k] = v;
  await saveProject(true);
  if (k === 'title') { renderTabs('写作'); const idx = S.project.chapters.findIndex(c => c.file === S.cur); const item = document.querySelectorAll('.ch-item')[idx]; if (item) item.children[1].textContent = v; }
}
async function addChapter() {
  const d = await api('POST', `/api/books/${encodeURIComponent(S.book)}/chapters`, { title: '第' + (S.project.chapters.length + 1) + '章' });
  S.cur = d.file;
  await route(); renderTabs('写作');
}
async function openChapter(file) {
  if (S.dirty) await saveChapter();
  S.cur = file; S.preview = false;
  renderWriting(); renderTabs('写作');
}
async function delChapter() {
  const meta = S.project.chapters.find(c => c.file === S.cur);
  if (!meta) return;
  openModal(`<h3>删除「${esc(meta.title)}」？</h3>
    <div class="row" style="margin-top:16px;justify-content:flex-end">
      <button class="btn ghost" onclick="closeModal()">取消</button>
      <button class="btn seal" onclick="doDelChapter()">删除</button></div>`);
}
async function doDelChapter() {
  await api('DELETE', `/api/books/${encodeURIComponent(S.book)}/chapters/${S.cur}`);
  S.cur = null; closeModal(); renderWriting(); renderTabs('写作');
}
async function moveChapter(dir) {
  const i = S.project.chapters.findIndex(c => c.file === S.cur);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= S.project.chapters.length) return;
  [S.project.chapters[i], S.project.chapters[j]] = [S.project.chapters[j], S.project.chapters[i]];
  await saveProject(true); renderWriting();
}
function togglePreview() {
  S.preview = !S.preview;
  const pv = $('#preview'), ed = $('#editor');
  if (S.preview) {
    pv.innerHTML = $('#editor').value.split(/\n+/).map(s => s.trim()).filter(Boolean).map(p => `<p>${esc(p)}</p>`).join('') || '<p class="muted">（空）</p>';
    pv.classList.remove('hidden'); ed.classList.add('hidden');
    $('#previewBtn').textContent = '编辑';
  } else { pv.classList.add('hidden'); ed.classList.remove('hidden'); $('#previewBtn').textContent = '预览'; ed.focus(); }
}

// ---------- 导出 ----------
function renderExport() {
  const st = S.project.settings;
  const chs = S.project.chapters;
  const total = chs.reduce((a, c) => a + (c.words || 0), 0);
  const done = chs.filter(c => c.status === '完成').length;
  const mats = S.project.materials.length, chars = S.project.characters.length, conflicts = S.project.conflicts.length;
  $('#view').innerHTML = `
    <h2 class="page-title">排版 · 导出</h2>
    <p class="page-sub">按平台要求排版后导出/复制。导出文件落在「作品/${esc(S.book)}/导出/」文件夹。</p>
    <div class="stats-grid" style="margin-bottom:16px">
      <div class="stat-box"><div class="num">${total.toLocaleString()}</div><div class="lbl">全书字数</div></div>
      <div class="stat-box"><div class="num">${chs.length}</div><div class="lbl">章节（完成 ${done}）</div></div>
      <div class="stat-box"><div class="num">${((S.project.log || {})[today()] || 0).toLocaleString()}</div><div class="lbl">今日码字</div></div>
      <div class="stat-box"><div class="num">${chars}/${conflicts}/${mats}</div><div class="lbl">人物/矛盾/素材</div></div>
    </div>
    <div class="card">
      <h3>排版设置</h3>
      <div class="row" style="margin-bottom:10px">
        <label class="chk"><input type="checkbox" id="stIndent" ${st.indent ? 'checked' : ''}>每段首行缩进两格</label>
        <label class="chk"><input type="checkbox" id="stBlank" ${st.blankLine ? 'checked' : ''}>段间空行</label>
      </div>
      <div class="field"><span>章节标题格式（{n} = 序号，{title} = 标题）</span>
        <input type="text" id="stTitle" value="${esc(st.titleFormat)}" style="max-width:340px"></div>
      <button class="btn" onclick="saveSettings()">保存设置</button>
    </div>
    <div class="card">
      <h3>导出</h3>
      <div class="export-row">
        <button class="btn seal" onclick="exportBook('txt')">导出全集 TXT（发布用排版）</button>
        <button class="btn" onclick="exportBook('md')">导出全集 Markdown</button>
        <button class="btn" onclick="copyChapter()">复制当前章节（排版后）</button>
      </div>
      <p class="muted">起点等后台可直接粘贴：复制当前章节 → 去发布页 Ctrl+V。</p>
    </div>`;
}
async function saveSettings() {
  S.project.settings = {
    indent: $('#stIndent').checked, blankLine: $('#stBlank').checked, titleFormat: $('#stTitle').value.trim() || '第{n}章　{title}',
  };
  await saveProject(); renderExport();
}
async function exportBook(format) {
  const d = await api('POST', `/api/books/${encodeURIComponent(S.book)}/export`, { format });
  toast(`已导出 ${d.chapters} 章 / ${d.chars.toLocaleString()} 字 → ${d.path}`);
}
async function copyChapter() {
  const meta = S.project.chapters.find(c => c.file === S.cur);
  if (!meta) return toast('先在「写作」页选择一章');
  const d = await api('GET', `/api/books/${encodeURIComponent(S.book)}/chapters/${meta.file}`);
  const st = S.project.settings;
  const i = S.project.chapters.indexOf(meta);
  const title = st.titleFormat.replace('{n}', i + 1).replace('{title}', meta.title);
  const body = d.content.split(/\n+/).map(s => s.trim()).filter(Boolean)
    .map(p => (st.indent ? '　　' + p : p)).join(st.blankLine ? '\n\n' : '\n');
  try { await navigator.clipboard.writeText(title + '\n\n' + body); toast(`「${title}」已复制，去粘贴吧`); }
  catch { openModal(`<h3>${esc(title)}</h3><textarea rows="14" readonly>${esc(title + '\n\n' + body)}</textarea>
    <div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn" onclick="closeModal()">关闭</button></div>`); }
}

// ---------- 启动 ----------
route();
