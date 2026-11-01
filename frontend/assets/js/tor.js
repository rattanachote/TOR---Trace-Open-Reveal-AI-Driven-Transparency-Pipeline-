/* TOR — Trace · Open · Reveal
 * Single-file explorer for the local procurement graph API (server.py).
 * Falls back to the 5 bundled sample projects (data.js) when opened without the server. */
(() => {
'use strict';

/* ───────────── helpers ───────────── */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num = v => { const n = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : null; };
const fmt = v => num(v) == null ? '—' : num(v).toLocaleString('th-TH');
const baht = v => {
 const n = num(v); if (n == null) return '—';
 if (Math.abs(n) >= 1e6) return (n / 1e6).toLocaleString('th-TH', {maximumFractionDigits: n >= 1e8 ? 0 : 2}) + ' ล้านบาท';
 return n.toLocaleString('th-TH', {maximumFractionDigits: 2}) + ' บาท';
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967295; };
const tidy = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const cut = (s, n) => { s = tidy(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const icon = (id, cls = '') => `<svg class="${cls}"><use href="#${id}"/></svg>`;
let toastTimer;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, 2600); }

/* ───────────── vocabulary ───────────── */
const TYPES = {
 Project:            {label: 'โครงการ',              hex: '#2f6bff', r: 9,  band: 1},
 Agency:             {label: 'หน่วยงาน',              hex: '#0d9474', r: 11, band: 0},
 Organization:       {label: 'นิติบุคคล',             hex: '#6d4fd6', r: 11, band: 2},
 UnresolvedBidder:   {label: 'ผู้เสนอราคา (ยังไม่ยืนยัน)', hex: '#b0475a', r: 8, band: 2},
 PersonMention:      {label: 'บุคคลในทะเบียน',        hex: '#e46a1b', r: 8,  band: 3},
 OrganizationMention:{label: 'นิติบุคคลในทะเบียน',     hex: '#c0418c', r: 8,  band: 3},
 TenderItem:         {label: 'รายการพิจารณา',         hex: '#8a96a8', r: 5,  band: 1},
};
const T = t => TYPES[t] || {label: t, hex: '#8a96a8', r: 7, band: 2};
const BAND_LABEL = ['หน่วยงาน', 'โครงการ', 'ผู้รับจ้าง / ผู้เสนอราคา', 'ผู้เกี่ยวข้องตามทะเบียน'];
const IDS = {
 registry_id_match: ['ตรงเลขทะเบียน DBD', 'good'],
 same_project_winner_name: ['ชื่อตรงผู้ชนะโครงการเดียวกัน', 'good'],
 identifier_matched_across_observations: ['ตัวระบุตรงกันในทะเบียน', 'good'],
 registry_not_found: ['ไม่พบในทะเบียน DBD', 'mid'],
 temporary_name_group: ['จัดกลุ่มด้วยชื่อ (ชั่วคราว)', 'mid'],
 temporary_name_key: ['จัดกลุ่มด้วยชื่อ (ชั่วคราว)', 'mid'],
 bid_only_project: ['มีเฉพาะข้อมูลผู้เสนอราคา', 'mid'],
 unique_registry_name_unverified: ['ชื่อตรงทะเบียน ยังไม่ยืนยัน', 'low'],
 contract_name_unique_unverified: ['ชื่อเคยเป็นผู้ชนะสัญญา (ตัวระบุเดียว) ยังไม่ยืนยัน', 'low'],
 contract_name_dominant_unverified: ['ชื่อในสัญญาส่วนใหญ่ใช้ตัวระบุเดียว ยังไม่ยืนยัน', 'low'],
 contract_name_v2_unverified: ['ชื่อตรงหลังตัดเลขไทย/ชื่อย่อ ยังไม่ยืนยัน', 'low'],
 registry_name_v2_unverified: ['ชื่อตรงทะเบียนหลังตัดเลขไทย/ชื่อย่อ ยังไม่ยืนยัน', 'low'],
 confirmed_same_person: ['ผู้ตรวจทานยืนยันว่าเป็นคนเดียวกัน', 'mid'],
 unresolved_name: ['ยังจับคู่ตัวตนไม่ได้', 'low'],
 unresolved_mention: ['ไม่มีตัวระบุ — ไม่รวมข้ามบริษัท', 'low'],
 ambiguous_project_winner: ['ชื่อกำกวม หลายตัวระบุ', 'low'],
};
const CONF = {high: ['เชื่อมั่นสูง', 'good'], medium: ['เชื่อมั่นปานกลาง', 'mid'], low: ['เชื่อมั่นต่ำ', 'low']};
const REL = {
 PROCURES: 'หน่วยงานเจ้าของโครงการ', AWARDED_TO: 'ได้รับสัญญา', BID_ON: 'เสนอราคา',
 HAS_ITEM: 'มีรายการพิจารณา', REPORTED_RELATED_PARTY: 'ผู้เกี่ยวข้องตามทะเบียน', IDENTIFIED_AS: 'ตัวระบุชี้ไปยังนิติบุคคล',
};
const OMIT = {
 awarded_projects: 'โครงการที่ได้รับสัญญา', bid_projects: 'โครงการที่เสนอราคา', registry_roles: 'ผู้เกี่ยวข้องในทะเบียน',
 agency_projects: 'โครงการของหน่วยงาน', bid_records: 'ระเบียนผู้เสนอราคา', contract_records: 'ระเบียนสัญญา', node_cap: 'จุดเกินเพดานกราฟ',
};
const KIND_LABEL = {project: 'โครงการ', company: 'นิติบุคคล', person: 'ผู้เกี่ยวข้อง', agency: 'หน่วยงาน', quality: 'แถวที่ถูกกักไว้'};
const KIND_TYPE = {project: 'Project', company: 'Organization', person: 'PersonMention', agency: 'Agency'};
const idPill = s => { const v = IDS[s]; return v ? `<span class="idpill ${v[1]}">${esc(v[0])}</span>` : (s ? `<span class="idpill">${esc(s)}</span>` : ''); };
const confPill = c => { const v = CONF[c]; return v ? `<span class="idpill ${v[1]}">${v[0]}</span>` : ''; };
const tpill = type => `<span class="tpill" style="--tc:${T(type).hex}"><i></i>${esc(T(type).label)}</span>`;

/* ───────────── state ───────────── */
const S = {
 api: false, stats: null,
 ref: null,               // {kind,key} of the graph centre
 graph: null,             // {nodes:Map, edges:[], center, scope, coverage, finding}
 pos: new Map(), links: [], adj: new Map(), nodeLinks: new Map(), vis: new Set(),
 hidden: new Set(), layout: 'force', bands: null,
 hover: null, selected: null, focus: null, flags: [],
 view: {x: 0, y: 0, k: 1},
 panel: 'home', order: [],
 list: null,              // single-kind browse state
 search: null,            // multi-kind search state
 reviews: {},             // server-side review decisions, keyed by edgeKey
 user: null,
 publicMode: false, publicCase: null,  // read-only portal showing one published case
 expandedRefs: [], caseId: null, caseTitle: '',
 filter: {verifiedOnly: false, yearFrom: '', yearTo: ''},
 pathFrom: null, asOf: null,
};

/* ───────────── API ───────────── */
async function api(path, params = {}, timeout = 25000, body) {
 const u = new URL(path, location.origin);
 if (!body) for (const [k, v] of Object.entries(params)) if (v !== '' && v != null) u.searchParams.set(k, v);
 const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeout);
 try {
  const r = await fetch(u, body ? {method: 'POST', signal: ctl.signal, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)} : {signal: ctl.signal});
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && S.user && !path.startsWith('/api/auth/') && !S.publicMode) { S.user = null; showAuth('login', 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง'); }
  if (!r.ok) throw Object.assign(new Error(j.error || 'HTTP ' + r.status), {status: r.status});
  return j;
 } catch (e) {
  if (e.name === 'AbortError') throw new Error('หมดเวลารอผลลัพธ์ ลองใช้คำค้นที่เจาะจงขึ้น');
  throw e;
 } finally { clearTimeout(t); }
}
const post = (path, body, timeout = 20000) => api(path, {}, timeout, body);
// Offline sample mode has no accounts: it can browse and export, never confirm.
const can = perm => (S.publicMode || !S.api) ? ['data.view', 'data.export'].includes(perm) : !!S.user?.permissions?.includes(perm);
const internal = () => S.api && !S.publicMode;  // full workspace (expand, re-center, save) vs. read-only views
async function probe() {
 const st = $('#api-state');
 if (location.protocol === 'file:') { S.api = false; }
 else {
  try { const j = await api('/api/stats', {}, 8000); S.api = true; S.stats = j.summary; S.asOf = j.as_of; } catch { S.api = false; }
 }
 st.className = 'api-state ' + (S.api ? 'on' : 'off');
 st.textContent = S.api ? 'เชื่อมต่อฐานข้อมูลแล้ว' : 'โหมดตัวอย่าง (ไม่มีเซิร์ฟเวอร์)';
}

/* ───────────── offline samples ───────────── */
const SAMPLES = typeof APP_DATA !== 'undefined' ? APP_DATA : [];
function sampleGraph(pid) {
 const p = SAMPLES.find(x => x.id === pid); if (!p) return null;
 return {
  scope: 'project', center_id: 'project:' + p.id, nodes: p.nodes,
  edges: p.edges.map(e => ({...e, relation_label: REL[e.type], amount: e.amount ?? e.contract_amount,
   evidence: e.evidence && {...e.evidence, sequence: e.evidence.sequence ?? e.evidence.source_sequence}})),
  finding: p.finding, coverage: {node_count: p.nodes.length, edge_count: p.edges.length, omitted: {}},
 };
}

/* ───────────── reviews (human-in-the-loop) ───────────── */
async function loadReviews() { if (S.api && S.user) { try { S.reviews = await api('/api/reviews'); } catch {} } updateBadge(); }
const edgeKey = e => [e.source, e.type, e.target, e.evidence?.sequence ?? '', e.item ?? ''].join('|');
const needsReview = e => e.confidence && e.confidence !== 'high';
function pendingReviews() { return S.graph ? S.graph.edges.filter(e => needsReview(e) && !S.reviews[edgeKey(e)]) : []; }
function updateBadge() { const n = pendingReviews().length; const b = $('#review-badge'); b.hidden = !n; b.textContent = n; }

/* ───────────── graph model ───────────── */
function graphRef(n) {
 if (!n) return null;
 if (n.type === 'Project' && /^\d{11}$/.test(n.project_id || '')) return {kind: 'project', key: n.project_id};
 if (n.type === 'Organization' && /^\d{13}$/.test(n.company_id || '')) return {kind: 'company', key: n.company_id};
 if ((n.type === 'PersonMention' || n.type === 'OrganizationMention') && n.entity_key) return {kind: 'person', key: n.entity_key};
 if (n.type === 'Agency' && n.agency_name) return {kind: 'agency', key: n.agency_parent ? n.agency_name + '||' + n.agency_parent : n.agency_name};
 return null;
}
const unverifiedNode = n => n.type === 'UnresolvedBidder' || /unresolved|unverified|ambiguous/.test(n.identity_status || '');
function yearOf(n) {
 const a = n.evidence?.archive || ''; const m = a.match(/(25\d\d)-egp/); if (m) return +m[1];
 if (/^\d{11}$/.test(n.project_id || '')) return 2500 + +n.project_id.slice(0, 2);
 return null;
}
const efp = e => [e.source, e.target, e.type, e.evidence?.sequence ?? '', e.amount ?? '', e.item ?? ''].join('|');

function setGraph(data, ref) {
 const nodes = new Map();
 for (const n of data.nodes) nodes.set(n.id, {...n});
 const seen = new Set(); const edges = [];
 for (const e of data.edges) {
  if (!nodes.has(e.source) || !nodes.has(e.target)) continue;
  const k = efp(e); if (seen.has(k)) continue; seen.add(k);
  edges.push({...e, relation_label: e.relation_label || REL[e.type] || e.type});
 }
 const center = data.center_id || (ref.kind === 'project' ? 'project:' + ref.key : data.nodes[0]?.id);
 S.graph = {nodes, edges, center, seen, scope: data.scope || ref.kind, coverage: data.coverage || {}, finding: data.finding || ''};
 S.ref = ref; S.pos = new Map(); S.hidden.clear();
 S.selected = null; S.hover = null; S.focus = null;
 rebuild();
 layout();
 draw(); fit(false);
 S.flags = detectFlags();
 updateBadge();
}
function mergeGraph(data, aroundId) {
 const g = S.graph; let added = 0;
 for (const n of data.nodes) {
  if (g.nodes.has(n.id)) { const o = g.nodes.get(n.id); for (const [k, v] of Object.entries(n)) if (o[k] == null && v != null && k !== 'layer') o[k] = v; continue; }
  g.nodes.set(n.id, {...n, layer: (g.nodes.get(aroundId)?.layer ?? 0) + 1}); added++;
 }
 for (const e of data.edges) {
  if (!g.nodes.has(e.source) || !g.nodes.has(e.target)) continue;
  const k = efp(e); if (g.seen.has(k)) continue; g.seen.add(k);
  g.edges.push({...e, relation_label: e.relation_label || REL[e.type] || e.type});
 }
 g.nodes.get(aroundId).expanded = true;
 return added;
}
function passesYear(n) {
 const {yearFrom, yearTo} = S.filter;
 if (!(yearFrom || yearTo) || !['Project', 'TenderItem'].includes(n.type)) return true;
 const y = n.type === 'Project' ? yearOf(n) : (/^\d{11}$/.test(n.project_id || '') ? 2500 + +n.project_id.slice(0, 2) : null);
 return y == null || ((!yearFrom || y >= +yearFrom) && (!yearTo || y <= +yearTo));
}
const reviewedOk = e => S.reviews[edgeKey(e)]?.status === 'ok';
const filtersOn = () => !!(S.filter.verifiedOnly || S.filter.yearFrom || S.filter.yearTo);
function rebuild() {
 const g = S.graph;
 S.vis = new Set([...g.nodes.values()].filter(n => n.id === g.center || (!S.hidden.has(n.type) && passesYear(n))).map(n => n.id));
 const pairs = new Map();
 for (const e of g.edges) {
  if (!S.vis.has(e.source) || !S.vis.has(e.target)) continue;
  if (S.filter.verifiedOnly && needsReview(e) && !reviewedOk(e)) continue;
  const k = e.source < e.target ? e.source + '\u0000' + e.target : e.target + '\u0000' + e.source;
  if (!pairs.has(k)) pairs.set(k, {from: e.source, to: e.target, edges: []});
  pairs.get(k).edges.push(e);
 }
 if (filtersOn()) {
  // Do not leave floating dots: keep only nodes that still have a visible link (and the centre).
  const linked = new Set([g.center]); for (const l of pairs.values()) { linked.add(l.from); linked.add(l.to); }
  S.vis = new Set([...S.vis].filter(id => linked.has(id)));
 }
 S.links = [...pairs.values()].map((l, i) => ({...l, i, solid: l.edges.some(e => !needsReview(e) || reviewedOk(e)) || l.edges.every(e => !e.confidence)}));
 S.adj = new Map(); S.nodeLinks = new Map();
 for (const id of S.vis) { S.adj.set(id, new Set()); S.nodeLinks.set(id, []); }
 for (const l of S.links) {
  S.adj.get(l.from).add(l.to); S.adj.get(l.to).add(l.from);
  S.nodeLinks.get(l.from).push(l.i); S.nodeLinks.get(l.to).push(l.i);
 }
}
const deg = id => S.adj.get(id)?.size || 0;
function radius(n) {
 if (n.id === S.graph.center) return 17;
 return T(n.type).r + Math.min(8, 1.6 * Math.sqrt(Math.max(0, deg(n.id) - 1)));
}

/* ───────────── layouts ───────────── */
function layout(warmFrom) { (S.layout === 'timeline' ? timelineLayout : forceLayout)(warmFrom); }

function radialSeed() {
 // Radial tree from the centre: each child gets a slice of its parent's wedge, giving the force pass an uncrossed start.
 const g = S.graph, c = g.center, parent = new Map([[c, null]]), kids = new Map(), order = [c];
 for (let i = 0; i < order.length; i++) {
  const id = order[i]; kids.set(id, []);
  const nb = [...(S.adj.get(id) || [])].sort((a, b) => (g.nodes.get(a).type + a).localeCompare(g.nodes.get(b).type + b));
  for (const o of nb) if (!parent.has(o)) { parent.set(o, id); kids.get(id).push(o); order.push(o); }
 }
 const size = new Map();
 for (let i = order.length - 1; i >= 0; i--) size.set(order[i], 1 + kids.get(order[i]).reduce((s, k) => s + size.get(k), 0));
 const seed = new Map([[c, {x: 0, y: 0, d: 0}]]);
 const place = (id, a0, a1, depth) => {
  let a = a0; const total = size.get(id) - 1 || 1;
  for (const k of kids.get(id)) {
   const span = (a1 - a0) * size.get(k) / total, mid = a + span / 2, r = 150 * (depth + 1) + (hash(k) - .5) * 40;
   seed.set(k, {x: Math.cos(mid) * r, y: Math.sin(mid) * r, d: depth + 1});
   place(k, a, a + span, depth + 1); a += span;
  }
 };
 place(c, -Math.PI, Math.PI, 0);
 let ring = 0;
 for (const id of S.vis) if (!seed.has(id)) { const a = hash(id) * Math.PI * 2, r = 520 + (ring++ % 5) * 40; seed.set(id, {x: Math.cos(a) * r, y: Math.sin(a) * r, d: 4}); }
 return seed;
}

function forceLayout(warmFrom) {
 const g = S.graph, ids = [...S.vis], N = ids.length, idx = new Map(ids.map((id, i) => [id, i]));
 const seed = radialSeed();
 const X = new Float64Array(N), Y = new Float64Array(N), VX = new Float64Array(N), VY = new Float64Array(N), R = new Float64Array(N), D = new Float64Array(N), fixed = new Uint8Array(N);
 ids.forEach((id, i) => {
  const p = S.pos.get(id), n = g.nodes.get(id);
  if (p && warmFrom !== undefined) { X[i] = p.x; Y[i] = p.y; }
  else if (warmFrom && S.pos.has(warmFrom)) { const w = S.pos.get(warmFrom), a = hash(id) * 6.283; X[i] = w.x + Math.cos(a) * 90; Y[i] = w.y + Math.sin(a) * 90; }
  else { X[i] = seed.get(id).x; Y[i] = seed.get(id).y; }
  R[i] = radius(n); D[i] = seed.get(id).d;
  if (id === g.center || p?.pinned) fixed[i] = 1;
 });
 const L = S.links.map(l => [idx.get(l.from), idx.get(l.to)]);
 const iters = warmFrom !== undefined ? 160 : 320;
 let alpha = warmFrom !== undefined ? .5 : 1;
 const cellR = 420;
 for (let it = 0; it < iters; it++) {
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
   let dx = X[j] - X[i], dy = Y[j] - Y[i], d2 = dx * dx + dy * dy;
   if (d2 > cellR * cellR) continue;
   if (d2 < .01) { dx = hash(ids[i] + j) - .5; dy = hash(ids[j] + i) - .5; d2 = dx * dx + dy * dy; }
   const d = Math.sqrt(d2), f = 1100 * alpha / d2, ux = dx / d, uy = dy / d;
   VX[i] -= ux * f * d; VY[i] -= uy * f * d; VX[j] += ux * f * d; VY[j] += uy * f * d;
   const min = R[i] + R[j] + 14;
   if (d < min) { const push = (min - d) * .5; X[i] -= ux * push; Y[i] -= uy * push; X[j] += ux * push; Y[j] += uy * push; }
  }
  for (const [a, b] of L) {
   const dx = X[b] - X[a], dy = Y[b] - Y[a], d = Math.sqrt(dx * dx + dy * dy) || 1;
   const want = 70 + (R[a] + R[b]) * 2.2, f = (d - want) / d * .09 * alpha;
   VX[a] += dx * f; VY[a] += dy * f; VX[b] -= dx * f; VY[b] -= dy * f;
  }
  for (let i = 0; i < N; i++) {
   const r = Math.hypot(X[i], Y[i]) || 1, target = 150 * D[i], f = (target - r) / r * .03 * alpha;
   VX[i] += X[i] * f; VY[i] += Y[i] * f;
   if (fixed[i]) { VX[i] = VY[i] = 0; if (ids[i] === g.center) { X[i] = 0; Y[i] = 0; } continue; }
   VX[i] *= .55; VY[i] *= .55; X[i] += VX[i]; Y[i] += VY[i];
  }
  alpha *= .988;
 }
 ids.forEach((id, i) => S.pos.set(id, {x: X[i], y: Y[i], pinned: S.pos.get(id)?.pinned}));
 S.bands = null;
}

function timelineLayout() {
 const g = S.graph, ids = [...S.vis];
 const year = new Map();
 for (const id of ids) { const y = yearOf(g.nodes.get(id)); if (y) year.set(id, y); }
 for (let pass = 0; pass < 3; pass++) for (const id of ids) {
  if (year.has(id)) continue;
  const ys = [...(S.adj.get(id) || [])].map(o => year.get(o)).filter(Boolean);
  if (ys.length) year.set(id, Math.round(ys.reduce((a, b) => a + b, 0) / ys.length));
 }
 const all = [...year.values()]; const maxY = all.length ? Math.max(...all) : 2569;
 for (const id of ids) if (!year.has(id)) year.set(id, maxY);
 const years = [...new Set(year.values())].sort((a, b) => a - b);
 const cells = new Map();
 for (const id of ids) { const k = T(g.nodes.get(id).type).band + ':' + year.get(id); if (!cells.has(k)) cells.set(k, []); cells.get(k).push(id); }
 const SX = 40, SY = 40; let maxCols = 1; const rowsBand = [1, 1, 1, 1];
 const shape = new Map();
 for (const [k, list] of cells) {
  const cols = Math.max(1, Math.min(7, Math.ceil(Math.sqrt(list.length * 1.4)))), rows = Math.ceil(list.length / cols);
  shape.set(k, {cols, rows}); maxCols = Math.max(maxCols, cols); const b = +k.split(':')[0]; rowsBand[b] = Math.max(rowsBand[b], rows);
 }
 const COL = Math.max(240, maxCols * SX + 70);
 const bandH = rowsBand.map(r => Math.max(130, r * SY + 70)); const bandY = []; let acc = 0;
 for (let b = 0; b < 4; b++) { bandY.push(acc); acc += bandH[b]; }
 for (const [k, list] of cells) {
  const [b, y] = k.split(':').map(Number), {cols} = shape.get(k);
  list.sort((p, q) => deg(q) - deg(p) || p.localeCompare(q));
  const cx = years.indexOf(y) * COL + COL / 2, cy = bandY[b] + bandH[b] / 2, rows = Math.ceil(list.length / cols);
  list.forEach((id, i) => {
   const r = Math.floor(i / cols), c = i % cols, inRow = Math.min(cols, list.length - r * cols);
   S.pos.set(id, {x: cx + (c - (inRow - 1) / 2) * SX, y: cy + (r - (rows - 1) / 2) * SY + (c % 2 ? 8 : -8) * (cols > 1 ? 1 : 0)});
  });
 }
 S.bands = {years, COL, bandY, bandH, width: years.length * COL};
}

/* ───────────── rendering ───────────── */
const svg = $('#graph'), VP = $('#viewport'), EL = $('#edge-layer'), NL = $('#node-layer'), LL = $('#label-layer'), AX = $('#axis-layer');
const BANDS = document.createElementNS('http://www.w3.org/2000/svg', 'g'); BANDS.setAttribute('class', 'axis');
VP.insertBefore(BANDS, EL); svg.appendChild(AX); svg.appendChild(LL); AX.setAttribute('class', 'axis');
let nodeEl = new Map(), labelEl = new Map(), linkPaths = [];

function curve(l) {
 const a = S.pos.get(l.from), b = S.pos.get(l.to);
 const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
 const rb = radius(S.graph.nodes.get(l.to)) + 2.5, ra = radius(S.graph.nodes.get(l.from));
 const bend = S.layout === 'timeline' ? .18 : .1, s = (hash(l.from + l.to) > .5 ? 1 : -1) * bend;
 const mx = (a.x + b.x) / 2 - dy * s, my = (a.y + b.y) / 2 + dx * s;
 const ex = b.x - (b.x - mx) / Math.hypot(b.x - mx, b.y - my) * rb, ey = b.y - (b.y - my) / Math.hypot(b.x - mx, b.y - my) * rb;
 const sx = a.x + (mx - a.x) / Math.hypot(mx - a.x, my - a.y) * ra, sy = a.y + (my - a.y) / Math.hypot(mx - a.x, my - a.y) * ra;
 return `M${sx.toFixed(1)},${sy.toFixed(1)}Q${mx.toFixed(1)},${my.toFixed(1)} ${ex.toFixed(1)},${ey.toFixed(1)}`;
}
function draw() {
 const g = S.graph;
 EL.innerHTML = S.links.map(l => `<path class="edge${l.solid ? '' : ' dashed'}" d="${curve(l)}"/>`).join('');
 linkPaths = [...EL.children];
 const ids = [...S.vis].sort((a, b) => (a === g.center) - (b === g.center));
 NL.innerHTML = ids.map(id => {
  const n = g.nodes.get(id), p = S.pos.get(id), r = radius(n);
  const cls = ['node', id === g.center && 'center', unverifiedNode(n) && 'unverified'].filter(Boolean).join(' ');
  return `<g class="${cls}" data-id="${esc(id)}" transform="translate(${p.x.toFixed(1)},${p.y.toFixed(1)})" style="--c:${T(n.type).hex}"><circle class="halo" r="${r + 5}"/><circle class="body" r="${r}"/></g>`;
 }).join('');
 LL.innerHTML = ids.map(id => `<text class="lbl${id === g.center ? ' center' : ''}" data-id="${esc(id)}">${esc(cut(g.nodes.get(id).label, id === g.center ? 40 : 26))}</text>`).join('');
 nodeEl = new Map($$('.node', NL).map(e => [e.dataset.id, e]));
 labelEl = new Map($$('.lbl', LL).map(e => [e.dataset.id, e]));
 drawBands();
 renderLegend(); renderCoverage();
 applyState();
}
function drawBands() {
 const b = S.bands;
 if (!b) { BANDS.innerHTML = ''; AX.innerHTML = ''; return; }
 BANDS.innerHTML = b.bandY.map((y, i) => i % 2 ? '' : `<rect class="band" x="-60" y="${y}" width="${b.width + 120}" height="${b.bandH[i]}"/>`).join('')
  + b.years.map((_, i) => i ? `<line x1="${i * b.COL}" x2="${i * b.COL}" y1="0" y2="${b.bandY[3] + b.bandH[3]}" stroke-dasharray="3 5"/>` : '').join('');
 drawAxis();
}
function drawAxis() {
 const b = S.bands; if (!b) return;
 const {x, y, k} = S.view, H = svg.clientHeight, W = svg.clientWidth;
 const ticks = b.years.map((yr, i) => `<text x="${(i * b.COL + b.COL / 2) * k + x}" y="${H - 34}" text-anchor="middle">ปีงบ ${yr}</text>`).join('');
 const bands = b.bandY.map((by, i) => `<text class="bandlbl" x="14" y="${(by + 18) * k + y}">${BAND_LABEL[i].toUpperCase()}</text>`).join('');
 AX.innerHTML = `<line x1="60" x2="${W - 90}" y1="${H - 50}" y2="${H - 50}"/><text x="${W / 2}" y="${H - 54}" text-anchor="middle" style="font-size:10px">ใหม่กว่า →</text>${ticks}${bands}`;
}
function setView(x, y, k) {
 S.view = {x, y, k}; VP.setAttribute('transform', `translate(${x.toFixed(1)},${y.toFixed(1)}) scale(${k.toFixed(4)})`);
 positionLabels(); drawAxis();
}
function positionLabels() {
 const {x, y, k} = S.view, g = S.graph; if (!g) return;
 for (const [id, el] of labelEl) {
  const p = S.pos.get(id), r = radius(g.nodes.get(id));
  el.setAttribute('x', (p.x * k + x).toFixed(1)); el.setAttribute('y', ((p.y + r) * k + y + 13).toFixed(1));
 }
 scheduleLabels();
}
let labelRaf = 0;
function scheduleLabels() { if (!labelRaf) labelRaf = requestAnimationFrame(() => { labelRaf = 0; placeLabels(); }); }
function placeLabels() {
 // Greedy declutter in screen space: important labels first, skip any that would overlap.
 const g = S.graph; if (!g) return;
 const hot = hotSet(), {k} = S.view, all = S.vis.size <= 28 || k >= 1.5;
 const pri = id => (id === g.center ? 1e6 : 0) + (id === S.selected ? 9e5 : 0) + (hot.has(id) ? 8e5 : 0) + (S.focus?.has(id) ? 7e5 : 0) + deg(id) * 10 + radius(g.nodes.get(id));
 const ids = [...labelEl.keys()].sort((a, b) => pri(b) - pri(a));
 const boxes = [];
 for (const id of ids) {
  const el = labelEl.get(id), forced = pri(id) >= 7e5;
  if (!forced && !all && deg(id) < 2 && S.vis.size > 60) { el.classList.add('hidden'); continue; }
  const w = el.textContent.length * 6.4 + 6, x = +el.getAttribute('x'), y = +el.getAttribute('y');
  const box = [x - w / 2, y - 11, x + w / 2, y + 3];
  const hit = boxes.some(o => box[0] < o[2] && box[2] > o[0] && box[1] < o[3] && box[3] > o[1]);
  if (hit && !forced) { el.classList.add('hidden'); continue; }
  el.classList.remove('hidden'); boxes.push(box);
 }
}
function hotSet() {
 const a = S.hover || S.selected; const s = new Set();
 if (a && S.vis.has(a)) { s.add(a); for (const o of S.adj.get(a) || []) s.add(o); }
 if (S.focus) for (const id of S.focus) s.add(id);
 return s;
}
function applyState() {
 if (!S.graph) return;
 const a = S.hover || S.selected, hot = hotSet();
 const hotLinks = new Set(a ? S.nodeLinks.get(a) || [] : []);
 if (S.focus) S.links.forEach(l => { if (S.focus.has(l.from) && S.focus.has(l.to)) hotLinks.add(l.i); });
 svg.classList.toggle('dim', !!(S.hover || S.focus));
 linkPaths.forEach((el, i) => {
  const on = hotLinks.has(i); el.classList.toggle('hot', on);
  if (on) { el.setAttribute('marker-end', 'url(#arrow)'); EL.appendChild(el); } else el.removeAttribute('marker-end');
 });
 for (const [id, el] of nodeEl) {
  el.classList.toggle('hot', hot.has(id)); el.classList.toggle('selected', id === S.selected);
  el.classList.toggle('flag', !!S.focus?.has(id));
 }
 for (const [id, el] of labelEl) { el.classList.toggle('hot', hot.has(id)); el.classList.toggle('selected', id === S.selected); }
 $$('.card[data-node]', $('#panel')).forEach(c => c.classList.toggle('hot', c.dataset.node === S.hover));
 placeLabels();
}
function fit(animate = true, only) {
 const ids = only ? [...only].filter(id => S.vis.has(id)) : [...S.vis]; if (!ids.length) return;
 let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
 for (const id of ids) { const p = S.pos.get(id); x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
 if (S.bands && !only) { x0 = Math.min(x0, 0); x1 = Math.max(x1, S.bands.width); }
 const W = svg.clientWidth || 800, H = svg.clientHeight || 600, padX = 90, padTop = 60, padBot = S.bands ? 90 : 70;
 const k = clamp(Math.min((W - padX * 2) / (x1 - x0 || 1), (H - padTop - padBot) / (y1 - y0 || 1)), .12, only ? 1.6 : 1.25);
 const tx = W / 2 - (x0 + x1) / 2 * k, ty = padTop + (H - padTop - padBot) / 2 - (y0 + y1) / 2 * k;
 if (!animate) return setView(tx, ty, k);
 const from = {...S.view}, t0 = performance.now();
 const step = t => { const p = Math.min(1, (t - t0) / 320), e = 1 - Math.pow(1 - p, 3);
  setView(from.x + (tx - from.x) * e, from.y + (ty - from.y) * e, from.k + (k - from.k) * e); if (p < 1) requestAnimationFrame(step); };
 requestAnimationFrame(step);
}
function zoomBy(f, cx, cy) {
 const {x, y, k} = S.view, nk = clamp(k * f, .08, 5);
 if (cx == null) { cx = svg.clientWidth / 2; cy = svg.clientHeight / 2; }
 setView(cx - (cx - x) * nk / k, cy - (cy - y) * nk / k, nk);
}
function renderLegend() {
 const g = S.graph, counts = {};
 for (const n of g.nodes.values()) counts[n.type] = (counts[n.type] || 0) + 1;
 $('#legend').innerHTML = Object.keys(TYPES).filter(t => counts[t]).map(t =>
  `<button type="button" class="chip${S.hidden.has(t) ? ' off' : ''}" data-type="${t}" style="--tc:${TYPES[t].hex}" title="แสดง/ซ่อน${TYPES[t].label}"><i></i>${TYPES[t].label}<b>${counts[t]}</b></button>`).join('');
}
function renderCoverage() {
 const c = S.graph.coverage || {}, om = Object.entries(c.omitted || {}).filter(([, v]) => v > 0);
 $('#coverage').innerHTML = `<b>${fmt(S.vis.size)}</b> จุด · <b>${fmt(S.links.length)}</b> เส้น` +
  (c.depth ? ` · ลึก ${c.depth} ชั้น` : '') + (om.length ? ` · <span title="${esc(om.map(([k, v]) => `${OMIT[k] || k}: ${fmt(v)}`).join('\n'))}">ยังไม่แสดงอีก ${fmt(om.reduce((s, [, v]) => s + v, 0))} รายการ ⓘ</span>` : '');
}

/* ───────────── interaction on canvas ───────────── */
const tip = $('#tooltip');
function nodeSummary(n) {
 const bits = [];
 if (n.type === 'Project') { if (n.project_id) bits.push(n.project_id); if (n.amount) bits.push(baht(n.amount)); if (n.agency) bits.push(cut(n.agency, 40)); }
 else if (n.company_id) bits.push('เลขนิติบุคคล ' + n.company_id);
 if (n.type === 'Agency' && n.source_rows) bits.push(fmt(n.source_rows) + ' ระเบียน');
 bits.push(deg(n.id) + ' ความสัมพันธ์ที่แสดง');
 return bits;
}
function showTip(n, ev) {
 tip.innerHTML = `${tpill(n.type)} ${idPill(n.identity_status)}<div class="tt-t">${esc(cut(n.label, 120))}</div><div class="tt-s">${nodeSummary(n).map(esc).join(' · ')}</div>`;
 tip.hidden = false; moveTip(ev);
}
function moveTip(ev) {
 const w = tip.offsetWidth, h = tip.offsetHeight;
 let x = ev.clientX + 14, y = ev.clientY + 14;
 if (x + w > innerWidth - 8) x = ev.clientX - w - 14; if (y + h > innerHeight - 8) y = ev.clientY - h - 14;
 tip.style.left = x + 'px'; tip.style.top = y + 'px';
}
function setHover(id) { if (S.hover === id) return; S.hover = id; applyState(); }

let drag = null, lastTap = {};
svg.addEventListener('pointerdown', ev => {
 if (!S.graph || ev.button !== 0) return;
 const g = ev.target.closest('.node');
 drag = {id: g?.dataset.id, sx: ev.clientX, sy: ev.clientY, vx: S.view.x, vy: S.view.y, moved: 0};
 if (!g) svg.classList.add('panning');
 svg.setPointerCapture(ev.pointerId);
});
svg.addEventListener('pointermove', ev => {
 if (!drag) {
  const g = ev.target.closest('.node');
  if (g && !tip.hidden) moveTip(ev); else if (!g && S.hover) { setHover(null); tip.hidden = true; }
  return;
 }
 const dx = ev.clientX - drag.sx, dy = ev.clientY - drag.sy; drag.moved = Math.max(drag.moved, Math.hypot(dx, dy));
 if (drag.id) {
  if (drag.moved < 3) return;
  tip.hidden = true;
  const r = svg.getBoundingClientRect(), {x, y, k} = S.view;
  const p = {x: (ev.clientX - r.left - x) / k, y: (ev.clientY - r.top - y) / k, pinned: true};
  S.pos.set(drag.id, p); nodeEl.get(drag.id).setAttribute('transform', `translate(${p.x.toFixed(1)},${p.y.toFixed(1)})`);
  refreshLinks(drag.id); positionLabels();
 } else setView(drag.vx + dx, drag.vy + dy, S.view.k);
});
// linkPaths keeps link index order even though applyState moves hot paths to the top of the layer.
function refreshLinks(id) { for (const i of S.nodeLinks.get(id) || []) linkPaths[i]?.setAttribute('d', curve(S.links[i])); }
svg.addEventListener('pointerup', ev => {
 if (!drag) return; svg.classList.remove('panning');
 const d = drag; drag = null;
 if (d.moved >= 4) return;
 if (d.id) {
  // Pointer capture retargets dblclick to the svg, so detect the double click here.
  const now = performance.now();
  if (lastTap.id === d.id && now - lastTap.t < 380) { lastTap = {}; expand(d.id); } else { lastTap = {id: d.id, t: now}; select(d.id); }
 } else if (S.selected || S.focus) { S.focus = null; select(null); }
});
svg.addEventListener('pointerover', ev => { const g = ev.target.closest('.node'); if (g && !drag) { setHover(g.dataset.id); showTip(S.graph.nodes.get(g.dataset.id), ev); } });
svg.addEventListener('pointerleave', () => { if (!drag) { setHover(null); tip.hidden = true; } });
svg.addEventListener('pointerout', ev => { const g = ev.target.closest('.node'); if (g && !ev.relatedTarget?.closest?.('.node')) { setHover(null); tip.hidden = true; } });
svg.addEventListener('wheel', ev => { if (!S.graph) return; ev.preventDefault(); const r = svg.getBoundingClientRect(); zoomBy(Math.exp(-ev.deltaY * .0016), ev.clientX - r.left, ev.clientY - r.top); }, {passive: false});
$('#z-in').onclick = () => zoomBy(1.3); $('#z-out').onclick = () => zoomBy(1 / 1.3); $('#z-fit').onclick = () => fit();
$('#z-center').onclick = () => S.graph && fit(true, new Set([S.graph.center, ...S.adj.get(S.graph.center)]));
$('#legend').addEventListener('click', ev => {
 const b = ev.target.closest('.chip'); if (!b) return;
 const t = b.dataset.type; S.hidden.has(t) ? S.hidden.delete(t) : S.hidden.add(t);
 if (S.selected && S.hidden.has(S.graph.nodes.get(S.selected)?.type)) S.selected = null;
 rebuild();
 if (S.layout === 'timeline') layout(); else if ([...S.vis].some(id => !S.pos.has(id))) layout(S.graph.center);
 paint(); renderPanel();
});
addEventListener('resize', () => { if (S.graph && !$('#workspace').hidden) { drawAxis(); positionLabels(); } drawHomeBg(); });

const paint = () => draw();

/* ───────────── loading graphs ───────────── */
const depthSel = $('#depth'), branchSel = $('#branch');
function loading(on, text) { $('#loading').hidden = !on; if (text) $('#loading-text').textContent = text; }
async function openGraph(kind, key, opts = {}) {
 showWorkspace(); S.panel = 'graph'; S.pathFrom = null;
 if (!opts.keepCase) { S.caseId = null; S.caseTitle = ''; }
 S.expandedRefs = [];
 $('#empty-stage').hidden = true;
 $('#stage-kicker').textContent = (S.caseTitle ? 'เรื่อง: ' + cut(S.caseTitle, 50) + ' · ' : 'แผนผังความสัมพันธ์ · ') + 'เริ่มจาก' + (KIND_LABEL[kind] || '');
 if (opts.label) $('#stage-heading').textContent = opts.label;
 loading(true, 'กำลังสร้างแผนผังจากฐานข้อมูล…'); renderPanel(true);
 try {
  let data;
  if (S.api) data = await api('/api/entity-graph', {kind, key, depth: depthSel.value, limit: branchSel.value}, 120000);
  else { data = sampleGraph(key); if (!data) throw new Error('โหมดตัวอย่างเปิดได้เฉพาะ 5 โครงการตัวอย่าง — เปิดผ่าน Start Web App.cmd เพื่อใช้ข้อมูลทั้งหมด'); }
  setGraph(data, {kind, key});
  $('#stage-heading').textContent = S.graph.nodes.get(S.graph.center)?.label || key;
  writeHash();
  if (opts.select) select(opts.select); else renderPanel();
  return true;
 } catch (e) {
  toast(e.message);
  if (!S.graph) { $('#empty-stage').hidden = false; }
  renderPanel();
  $('#panel .p-scroll')?.insertAdjacentHTML('afterbegin', `<div class="err">${esc(e.message)}</div>`);
  return false;
 } finally { loading(false); }
}
async function expand(id, quiet = false) {
 const n = S.graph?.nodes.get(id), ref = graphRef(n);
 if (!internal()) return;
 if (!ref) return toast('จุดนี้ไม่มีตัวระบุสำหรับขยายต่อ');
 if (!S.api) return toast('การขยายจุดต้องใช้เซิร์ฟเวอร์ข้อมูล');
 loading(true, 'กำลังขยาย ' + cut(n.label, 30) + '…');
 try {
  const data = await api('/api/entity-graph', {kind: ref.kind, key: ref.key, depth: 1, limit: branchSel.value}, 90000);
  const before = S.vis.size, added = mergeGraph(data, id);
  if (!S.expandedRefs.some(r => r.kind === ref.kind && r.key === ref.key)) S.expandedRefs.push(ref);
  rebuild(); layout(id); paint(); S.flags = detectFlags(); updateBadge();
  if (quiet) return;
  fit(true, new Set([id, ...S.adj.get(id)]));
  toast(added ? `เพิ่ม ${added} จุดจาก ${cut(n.label, 24)}` : 'ไม่มีจุดใหม่ — ความสัมพันธ์ทั้งหมดของจุดนี้แสดงอยู่แล้ว');
  if (S.vis.size > 450 && before <= 450) toast('แผนผังมีจุดจำนวนมาก ลองซ่อนบางประเภทจากคำอธิบายสัญลักษณ์');
  renderPanel();
 } catch (e) { toast(e.message); } finally { loading(false); }
}
depthSel.onchange = branchSel.onchange = () => S.ref && internal() && openGraph(S.ref.kind, S.ref.key);
$('#layout-seg').addEventListener('click', ev => {
 const b = ev.target.closest('button'); if (!b || !S.graph) return;
 S.layout = b.dataset.layout; $$('#layout-seg button').forEach(x => x.setAttribute('aria-pressed', x === b));
 if (S.layout === 'force') S.pos = new Map();
 layout(); paint(); fit();
});

/* ───────────── red-flag patterns (observations, not conclusions) ───────────── */
function detectFlags() {
 const g = S.graph, N = g.nodes, flags = [];
 const isFirm = id => ['Organization', 'UnresolvedBidder'].includes(N.get(id)?.type);
 const itemProject = new Map();
 for (const e of g.edges) if (e.type === 'HAS_ITEM') itemProject.set(e.target, e.source);
 const firmsOf = new Map(), add = (m, k, v) => { if (!m.has(k)) m.set(k, new Set()); m.get(k).add(v); };
 for (const e of g.edges) {
  if (e.type === 'BID_ON' && isFirm(e.source)) add(firmsOf, itemProject.get(e.target) || e.target, e.source);
  if (e.type === 'AWARDED_TO' && isFirm(e.target)) add(firmsOf, e.source, e.target);
 }
 const parties = new Map(), firmsOfParty = new Map();
 for (const e of g.edges) if (e.type === 'REPORTED_RELATED_PARTY') { add(parties, e.target, e.source); add(firmsOfParty, e.source, e.target); }
 const agencyOf = new Map();
 for (const e of g.edges) if (e.type === 'PROCURES') agencyOf.set(e.target, e.source);
 const wins = new Map();
 for (const e of g.edges) if (e.type === 'AWARDED_TO' && agencyOf.has(e.source)) { const k = e.target + '\u0000' + agencyOf.get(e.source); if (!wins.has(k)) wins.set(k, new Set()); wins.get(k).add(e.source); }
 const L = id => cut(N.get(id)?.label, 34);

 for (const [p, firms] of firmsOf) {
  const list = [...firms]; if (list.length < 2) continue;
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
   const shared = [...(parties.get(list[i]) || [])].filter(x => parties.get(list[j])?.has(x) && !x.startsWith('mention:'));
   if (shared.length) flags.push({id: 'sp:' + p + list[i] + list[j], level: 'high', title: 'ผู้เสนอราคาในโครงการเดียวกันมีผู้เกี่ยวข้องร่วมกัน',
    text: `${L(list[i])} และ ${L(list[j])} อยู่ในโครงการ “${L(p)}” และมี ${shared.map(L).join(', ')} ปรากฏในทะเบียนของทั้งสองบริษัท`,
    why: 'OECD ระบุว่าผู้เสนอราคาที่มีความเชื่อมโยงกันเป็นสัญญาณที่ควรตรวจสอบเรื่องการแข่งขัน', nodes: [p, list[i], list[j], ...shared]});
  }
 }
 for (const [person, firms] of firmsOfParty) {
  if (person.startsWith('mention:') || firms.size < 2) continue;
  const byAgency = new Map();
  for (const f of firms) for (const [k] of wins) { const [firm, ag] = k.split('\u0000'); if (firm === f) add(byAgency, ag, f); }
  for (const [ag, fs] of byAgency) if (fs.size >= 2) flags.push({id: 'ca:' + person + ag, level: 'high', title: 'บุคคลเดียวกันเกี่ยวข้องกับหลายบริษัทที่ได้งานจากหน่วยงานเดียวกัน',
   text: `${L(person)} ปรากฏในทะเบียนของ ${[...fs].map(L).join(', ')} ซึ่งได้รับสัญญาจาก ${L(ag)}`,
   why: 'อาจเป็นเครือข่ายบริษัทที่ควรตรวจว่ามีการแข่งขันจริงหรือไม่', nodes: [person, ag, ...fs, ...[...fs].flatMap(f => [...(wins.get(f + '\u0000' + ag) || [])])]});
 }
 for (const [k, projects] of wins) {
  if (projects.size < 3) continue; const [firm, ag] = k.split('\u0000');
  flags.push({id: 'rw:' + k, level: 'mid', title: 'ได้รับสัญญาจากหน่วยงานเดียวกันซ้ำหลายครั้ง',
   text: `${L(firm)} ได้รับ ${projects.size} สัญญาจาก ${L(ag)} ในส่วนที่โหลดของแผนผัง`, why: 'นับเฉพาะข้อมูลที่โหลด ควรดูจำนวนรวมและวิธีจัดซื้อประกอบ', nodes: [firm, ag, ...projects]});
 }
 // People who sit on exactly the same set of firms are reported together as one group.
 const groups = new Map();
 for (const [person, firms] of firmsOfParty) {
  if (person.startsWith('mention:') || firms.size < 3) continue;
  const k = [...firms].sort().join('|'); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(person);
 }
 for (const [k, people] of groups) {
  const firms = k.split('|');
  flags.push({id: 'mc:' + k, level: 'info', title: people.length > 1 ? `ผู้เกี่ยวข้อง ${people.length} รายปรากฏร่วมกันในหลายนิติบุคคล` : 'ผู้เกี่ยวข้องรายเดียวปรากฏในหลายนิติบุคคล',
   text: `${people.slice(0, 4).map(L).join(', ')}${people.length > 4 ? ` และอีก ${people.length - 4} ราย` : ''} ปรากฏในทะเบียนของ ${firms.length} นิติบุคคลเดียวกัน: ${firms.slice(0, 4).map(L).join(', ')}${firms.length > 4 ? ' …' : ''}`,
   why: 'เป็นข้อมูลประกอบ ไม่ได้บ่งชี้ความผิดปกติด้วยตัวเอง', nodes: [...people, ...firms]});
 }
 const rank = {high: 0, mid: 1, info: 2};
 return flags.sort((a, b) => rank[a.level] - rank[b.level]).slice(0, 40);
}
function focusFlag(f) {
 S.focus = new Set(f.nodes.filter(id => S.graph.nodes.has(id)));
 for (const id of S.focus) S.hidden.delete(S.graph.nodes.get(id).type);
 rebuild(); paint(); fit(true, S.focus);
}

/* ───────────── selection & panel ───────────── */
function select(id) {
 S.selected = id && S.graph?.nodes.has(id) ? id : null;
 S.panel = S.selected ? 'detail' : 'graph';
 applyState(); renderPanel();
}
const SECTIONS = ['home', 'admin', 'workspace', 'dashboard', 'public-home', 'about'];
function only(id) { for (const s of SECTIONS) $('#' + s).hidden = s !== id; $('#pub-bar').hidden = !S.publicMode; }
function showWorkspace() {
 only('workspace'); document.body.dataset.mode = S.publicMode ? 'public' : 'explore';
}
function showHome() {
 S.publicMode = false; only('home'); document.body.dataset.mode = 'home'; document.body.dataset.panel = '';
 S.panel = 'home'; setNav(); history.replaceState(null, '', location.pathname); drawHomeBg();
}
function setNav() {
 $$('.rail [data-go], .rail [data-browse]').forEach(b => b.classList.toggle('active', !!(
  (b.dataset.go === 'graph' && ['graph', 'detail'].includes(S.panel)) || (b.dataset.go === 'review' && S.panel === 'review') || (b.dataset.go === 'admin' && S.panel === 'admin') ||
  (b.dataset.go === 'cases' && S.panel === 'cases') || (b.dataset.go === 'dashboard' && S.panel === 'dashboard') ||
  (b.dataset.browse && S.panel === 'browse' && S.list?.kind === b.dataset.browse))));
 document.body.dataset.panel = S.panel;
}
function renderPanel(busy) {
 setNav();
 const P = $('#panel');
 if (S.panel === 'search') return renderSearch(P);
 if (S.panel === 'browse') return renderBrowse(P);
 if (S.panel === 'review') return renderReview(P);
 if (S.panel === 'cases') return renderCases(P);
 if (S.panel === 'detail' && S.selected) { renderDetail(P); return fillIndicators(P); }
 return renderGraphPanel(P, busy);
}

function nodeCard(n) {
 const bits = nodeSummary(n).slice(0, -1);
 const ref = graphRef(n);
 return `<article class="card${n.id === S.selected ? ' sel' : ''}" data-node="${esc(n.id)}">
  <div class="card-meta">${tpill(n.type)}${n.id === S.graph.center ? '<span>· จุดศูนย์กลาง</span>' : ''}</div>
  <h3 data-act="select" data-id="${esc(n.id)}">${esc(cut(n.label, 110))}</h3>
  ${bits.length ? `<p class="sub">${bits.map(esc).join(' · ')}</p>` : ''}
  <div class="nums"><span><b>${deg(n.id)}</b>เส้นเชื่อม</span>${n.layer != null ? `<span><b>${n.layer}</b>ชั้นจากศูนย์กลาง</span>` : ''}</div>
  <div class="card-actions"><span>${idPill(n.identity_status)}</span>${ref && internal() && n.id !== S.graph.center ? `<button class="btn sm" data-act="expand" data-id="${esc(n.id)}">${icon('i-expand')}ขยาย</button>` : ''}</div>
 </article>`;
}
let graphTab = 'all';
function renderGraphPanel(P, busy) {
 const g = S.graph;
 if (!g || busy) {
  P.innerHTML = `<div class="p-head"><h2>สำรวจความสัมพันธ์</h2><p>${busy ? 'กำลังโหลด…' : 'ค้นหาหรือเลือกรายการเพื่อเริ่มต้น'}</p></div><div class="p-scroll"></div>`;
  return;
 }
 const center = g.nodes.get(g.center), counts = {};
 const vis = [...S.vis].map(id => g.nodes.get(id));
 vis.forEach(n => counts[n.type] = (counts[n.type] || 0) + 1);
 const tabs = Object.keys(TYPES).filter(t => counts[t]);
 if (graphTab !== 'all' && graphTab !== 'flags' && !counts[graphTab]) graphTab = 'all';
 const list = vis.filter(n => graphTab === 'all' || n.type === graphTab)
  .sort((a, b) => (b.id === g.center) - (a.id === g.center) || (a.layer ?? 9) - (b.layer ?? 9) || deg(b.id) - deg(a.id));
 S.order = list.map(n => n.id);
 const caveats = (g.finding || '').split(' · ').filter(Boolean);
 P.innerHTML = `
  <div class="p-head">
   <span class="eyebrow">สำรวจจุดที่เกี่ยวข้อง</span>
   <h2>${esc(cut(center?.label, 80))}</h2>
   <div class="p-tools"><span class="filter-pill">${tpill(center?.type)}</span><span class="filter-pill">ความลึก <b>${depthSel.value}</b> · กิ่ง <b>${branchSel.value}</b></span>
   <button class="btn sm" data-act="select" data-id="${esc(g.center)}">ดูรายละเอียดศูนย์กลาง</button></div>
   <div class="tabs" role="tablist">
    <button role="tab" data-tab="all" aria-selected="${graphTab === 'all'}">ทั้งหมด<span>${vis.length}</span></button>
    <button role="tab" data-tab="flags" aria-selected="${graphTab === 'flags'}">ข้อสังเกต<span>${S.flags.length}</span></button>
    ${tabs.map(t => `<button role="tab" data-tab="${t}" aria-selected="${graphTab === t}">${TYPES[t].label}<span>${counts[t]}</span></button>`).join('')}
   </div>
  </div>
  <div class="p-scroll">
   ${S.publicMode ? publicCaseHTML() : ''}
   ${graphTab === 'flags' ? flagsHTML() : (graphTab === 'all' && S.flags.length ? `<div class="group-h">ข้อสังเกตที่ควรตรวจ <button class="linkish" data-tab="flags">ดูทั้งหมด ${S.flags.length}</button></div>${flagsHTML(2)}<div class="group-h">จุดในแผนผัง</div>` : '')}
   ${graphTab === 'flags' ? '' : list.slice(0, 160).map(nodeCard).join('') + (list.length > 160 ? `<p class="muted" style="text-align:center;font-size:12px">แสดง 160 จาก ${list.length} จุด — เลือกแท็บประเภทเพื่อกรอง</p>` : '')}
   ${caveats.length ? `<div class="group-h">ขอบเขตและข้อจำกัด</div>${caveats.map(c => `<p class="caveat">${esc(c)}</p>`).join('')}` : ''}
  </div>`;
}
function flagsHTML(limit) {
 if (!S.flags.length) return `<div class="empty"><strong>ไม่พบรูปแบบที่ตั้งไว้ในส่วนที่โหลด</strong>ลองเพิ่มความลึกหรือขยายจุดบริษัทเพื่อดูความสัมพันธ์เพิ่ม</div>`;
 const lv = {high: 'ควรตรวจก่อน', mid: 'ควรดูประกอบ', info: 'ข้อมูลประกอบ'};
 return S.flags.slice(0, limit || 40).map((f, i) => `<div class="flag" data-flag="${i}" role="button" tabindex="0">
  <strong>${icon('i-flag')}${esc(f.title)}</strong><p>${esc(f.text)}</p><small>${lv[f.level]} · ${esc(f.why)}</small></div>`).join('')
  + (limit ? '' : `<p class="caveat">ข้อสังเกตคำนวณจากจุดและเส้นที่โหลดในแผนผังนี้เท่านั้น ไม่ใช่ข้อสรุปว่ามีการฮั้วหรือทุจริต ต้องตรวจเอกสารต้นทางและช่วงเวลาของบทบาทก่อนสรุป</p>`);
}

function facts(n) {
 const f = [];
 const push = (k, v) => { if (v != null && v !== '' && v !== '—') f.push([k, v]); };
 if (n.type === 'Project') {
  push('รหัสโครงการ', n.project_id); push('หน่วยงาน', n.agency); push('วงเงินในสัญญา', n.amount && baht(n.amount));
  push('วิธีจัดซื้อ', n.method); push('เลขที่สัญญา', n.contract_number); push('วันที่ลงนาม', n.signed_date); push('สถานะสัญญา', n.status);
  push('ปีข้อมูล', yearOf(n));
 } else if (n.type === 'Organization' || n.type === 'UnresolvedBidder') {
  push('เลขนิติบุคคล', n.company_id); push('ทะเบียน ณ', n.observed && new Date(n.observed).toLocaleDateString('th-TH', {dateStyle: 'medium'}));
 } else if (n.type === 'PersonMention' || n.type === 'OrganizationMention') {
  push('ตัวระบุ', n.entity_key?.startsWith('person:') ? 'แฮชเลขประจำตัว (ไม่แสดงเลขจริง)' : n.entity_key?.startsWith('mention:') ? 'ไม่มีตัวระบุ — เฉพาะทะเบียนนี้' : n.entity_key && 'เลขนิติบุคคล');
  push('จำนวนตามทะเบียน', n.investAmount && fmt(n.investAmount)); push('นิติบุคคลที่อ้างถึง', n.related_cid);
  push('ทะเบียน ณ', n.observed && new Date(n.observed).toLocaleDateString('th-TH', {dateStyle: 'medium'}));
 } else if (n.type === 'Agency') {
  push('ชื่อกลุ่ม', n.agency_name || n.label); push('ระเบียนต้นทาง', n.source_rows && fmt(n.source_rows));
 } else if (n.type === 'TenderItem') { push('โครงการ', n.project_id); push('ลำดับรายการ', n.item_number); }
 push('ชั้นจากศูนย์กลาง', n.layer);
 return f;
}
const evUrl = (path, params) => (S.publicMode ? path.replace('/api/evidence/', '/api/public/evidence/') : path) + '?' + new URLSearchParams(S.publicMode ? {...params, slug: S.publicCase?.slug} : params);
function evidenceHTML(ev) {
 if (!ev) return '';
 if (typeof ev === 'string') {
  const f = (file, label, title) => `<a href="${esc(evUrl('/api/evidence/dbd', {source: ev, file}))}" target="_blank" rel="noopener" title="${esc(title)}">${icon('i-doc')}${label}</a>`;
  return `<div class="evid">${icon('i-doc')}<div class="evid-body"><span>ทะเบียน DBD: ${esc(ev)}</span>
   ${S.api ? `<div class="evid-links">${f('profile.pdf', 'เอกสารข้อมูลนิติบุคคล (PDF)', 'ไฟล์ PDF ที่เก็บจาก DBD ณ วันที่เก็บข้อมูล')}${f('raw.json', 'ข้อมูลดิบ DBD', 'raw.json — คำตอบจาก DBD ก่อนแปลง')}${f('company.json', 'company.json', 'ข้อมูลที่แปลงแล้วซึ่งใช้สร้างเส้นเชื่อม')}${f('manifest.json', 'manifest + แฮช', 'วันที่เก็บและ SHA-256 ของแต่ละไฟล์')}</div>` : ''}</div></div>`;
 }
 const seq = ev.sequence ?? ev.source_sequence, q = {archive: ev.archive, member: ev.member, seq};
 const canFetch = S.api && ev.archive && ev.member && seq != null;
 return `<div class="evid">${icon('i-doc')}<div class="evid-body"><span>${esc(ev.archive || '')}${ev.member ? ' › ' + esc(ev.member) : ''}${seq != null ? ' › ลำดับ ' + esc(seq) : ''}</span>
  ${canFetch ? `<div class="evid-links"><a href="${esc(evUrl('/api/evidence/row', {...q, format: 'csv'}))}" download title="คัดลอกบรรทัดจากไฟล์ CSV ต้นฉบับใน ZIP โดยไม่แก้ไขเนื้อหา (เพิ่ม BOM ให้ Excel แสดงภาษาไทย)">${icon('i-download')}ดาวน์โหลดแถวต้นทาง (CSV)</a><button type="button" data-act="peek" data-q="${esc(JSON.stringify(q))}">${icon('i-search')}ดูแถวในไฟล์ต้นฉบับ</button></div><div class="peek" hidden></div>` : ''}</div></div>`;
}
async function peekRow(btn) {
 const box = btn.closest('.evid-body').querySelector('.peek');
 if (!box.hidden) { box.hidden = true; return; }
 box.hidden = false; box.innerHTML = '<span class="spinner" style="display:inline-block;width:16px;height:16px;border-width:2px"></span> กำลังค้นแถวในไฟล์ ZIP ต้นฉบับ…';
 try {
  const r = await api('/api/evidence/row', {...JSON.parse(btn.dataset.q), format: 'json'}, 60000);
  box.innerHTML = `<p class="peek-h">พบที่บรรทัด <b>${fmt(r.line)}</b> ของ ${esc(r.member)} · CRC32 ${esc(r.member_crc32)}</p>
   <dl class="facts">${Object.entries(r.fields).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v) || '<span class="muted">—</span>'}</dd>`).join('')}</dl>`;
 } catch (e) { box.innerHTML = `<div class="err">${esc(e.message)}</div>`; }
}
function reviewHTML(e) {
 const k = edgeKey(e), rv = S.reviews[k], r = rv?.status;
 const when = rv ? `<span class="muted" style="font-size:11px">${rv.reviewer ? esc(rv.reviewer) + ' · ' : ''}${new Date(rv.at).toLocaleString('th-TH', {dateStyle: 'short', timeStyle: 'short'})}</span>` : '';
 const note = rv?.note ? `<div class="rv-note-text">“${esc(rv.note)}”</div>` : '';
 if (!can('review.confirm') || S.publicMode) return `<div class="review-row"><span class="muted" style="font-size:11.5px">ตรวจทาน:</span>
  ${r ? `<span class="rv ${r} on">${icon(r === 'ok' ? 'i-check' : 'i-x')}${r === 'ok' ? 'ยืนยันแล้ว' : 'ปฏิเสธแล้ว'}</span>${when}` : `<span class="rv locked">${icon('i-lock')}รอผู้มีสิทธิ์ยืนยัน</span>`}</div>${note}`;
 return `<div class="review-row" data-ek="${esc(k)}"><span class="muted" style="font-size:11.5px">ตรวจทาน:</span>
  <button class="rv ok${r === 'ok' ? ' on' : ''}" data-rv="ok">${icon('i-check')}ถูกต้อง</button>
  <button class="rv no${r === 'no' ? ' on' : ''}" data-rv="no">${icon('i-x')}ไม่ถูกต้อง</button>${when}
  <input class="rv-note" maxlength="1000" placeholder="หมายเหตุ (ไม่บังคับ)" value="${esc(rv?.note || '')}" aria-label="หมายเหตุการตรวจทาน"></div>`;
}
function relHTML(e, fromId) {
 const g = S.graph, out = e.source === fromId, other = g.nodes.get(out ? e.target : e.source);
 return `<div class="rel">
  <div class="rel-top">${tpill(other.type)}<span class="dir">${out ? '→' : '←'}</span><a data-act="select" data-id="${esc(other.id)}">${esc(cut(other.label, 70))}</a></div>
  <div class="rel-top"><b>${esc(e.relation_label)}</b>${e.amount ? `<span class="muted">· ${e.type === 'REPORTED_RELATED_PARTY' ? 'จำนวนตามทะเบียน ' + fmt(e.amount) : baht(e.amount)}</span>` : ''}${e.contract_number ? `<span class="muted">· สัญญา ${esc(e.contract_number)}</span>` : ''}${e.raw_role_code ? `<span class="muted">· รหัสบทบาท ${esc(e.raw_role_code)}</span>` : ''} ${confPill(e.confidence)}</div>
  ${e.item ? `<div class="muted">${esc(cut(e.item, 90))}</div>` : ''}
  ${e.identity_basis ? `<div class="muted">วิธีเชื่อม: ${esc(e.identity_basis)}</div>` : ''}
  ${e.temporal_note ? `<div class="muted">ช่วงเวลา: ${esc(e.temporal_note)}</div>` : ''}
  ${evidenceHTML(e.evidence)}
  ${needsReview(e) ? reviewHTML(e) : ''}
 </div>`;
}
let relLimit = 25;
function renderDetail(P) {
 const g = S.graph, n = g.nodes.get(S.selected), ref = graphRef(n);
 const rels = g.edges.filter(e => e.source === n.id || e.target === n.id)
  .sort((a, b) => (needsReview(b) - needsReview(a)) || a.type.localeCompare(b.type));
 const myFlags = S.flags.map((f, i) => [f, i]).filter(([f]) => f.nodes.includes(n.id));
 const i = S.order.indexOf(n.id);
 P.innerHTML = `
  <div class="d-nav"><button class="d-x" data-act="close" title="กลับไปยังรายการ">${icon('i-x')}</button>
   <button data-act="prev" ${i <= 0 ? 'disabled' : ''}>${icon('i-left')}ก่อนหน้า</button><button data-act="next" ${i < 0 || i >= S.order.length - 1 ? 'disabled' : ''}>ถัดไป${icon('i-right')}</button></div>
  <div class="p-scroll">
   <div class="detail">
    <div class="card-meta">${tpill(n.type)} ${idPill(n.identity_status)} ${n.id === g.center ? '<span>· จุดศูนย์กลาง</span>' : ''}</div>
    <h2>${esc(n.label)}</h2>
    <div class="d-actions">
     ${ref && internal() && n.id !== g.center ? `<button class="btn primary sm" data-act="recenter" data-id="${esc(n.id)}">${icon('i-target')}ตั้งเป็นศูนย์กลาง</button>` : ''}
     ${ref && internal() ? `<button class="btn sm" data-act="expand" data-id="${esc(n.id)}">${icon('i-expand')}${n.expanded ? 'ขยายแล้ว' : 'ขยายจุดนี้'}</button>` : ''}
     <button class="btn sm" data-act="zoomto" data-id="${esc(n.id)}">${icon('i-fit')}ซูมไปที่จุด</button>
     ${S.pathFrom && S.pathFrom !== n.id && g.nodes.has(S.pathFrom) ? `<button class="btn sm primary" data-act="path-to" data-id="${esc(n.id)}">${icon('i-route')}เส้นทางจาก “${esc(cut(g.nodes.get(S.pathFrom).label, 18))}”</button>` : ''}
     <button class="btn sm" data-act="path-from" data-id="${esc(n.id)}">${icon('i-route')}${S.pathFrom === n.id ? 'จุดเริ่มเส้นทาง ✓' : 'เริ่มหาเส้นทางจากจุดนี้'}</button>
     ${S.publicMode ? `<button class="btn sm" data-act="correct" data-id="${esc(n.id)}">${icon('i-flag')}แจ้งแก้ไขข้อมูล</button>` : ''}
    </div>
    <dl class="facts">${facts(n).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    ${indicatorSlot(n)}
    ${n.evidence || n.dbd_source ? `<div class="sec-h">แหล่งข้อมูล</div>${evidenceHTML(n.evidence)}${n.dbd_source ? evidenceHTML(n.dbd_source) : ''}` : ''}
    ${myFlags.length ? `<div class="sec-h">ข้อสังเกตที่เกี่ยวข้อง</div>${myFlags.map(([f, k]) => `<div class="flag" data-flag="${k}" role="button" tabindex="0"><strong>${icon('i-flag')}${esc(f.title)}</strong><p>${esc(f.text)}</p></div>`).join('')}` : ''}
    <div class="sec-h">ความสัมพันธ์และหลักฐาน <span>${rels.length}</span></div>
    ${rels.slice(0, relLimit).map(e => relHTML(e, n.id)).join('')}
    ${rels.length > relLimit ? `<button class="btn sm" data-act="more-rel">แสดงเพิ่มอีก ${rels.length - relLimit}</button>` : ''}
    <p class="caveat">ข้อมูลทะเบียนสะท้อนภาพ ณ วันที่เก็บข้อมูล ไม่ยืนยันบทบาทย้อนหลัง ณ วันประมูล</p>
   </div>
  </div>`;
}
/* people named in the DBD registry without an ID who appear in several companies: a reviewer decides if it is one person */
let reviewTab = 'graph';
const SN = {items: [], next: null, loaded: false, busy: false, q: '', builtAt: null, error: ''};
async function loadSameName(more) {
 if (SN.busy) return; SN.busy = true; SN.error = '';
 try {
  const r = await api('/api/review/same-name', {limit: 15, after: more ? SN.next : '', q: SN.q});
  SN.items = more ? SN.items.concat(r.items) : r.items; SN.next = r.next; SN.builtAt = r.built_at; SN.loaded = true;
 } catch (e) { SN.error = e.message; SN.loaded = true; }
 SN.busy = false; if (S.panel === 'review') renderPanel();
}
function sameNameHTML() {
 if (!SN.loaded) { loadSameName(false); return '<div class="empty"><strong>กำลังโหลด…</strong></div>'; }
 const decided = SN.items.filter(g => S.reviews['samename|' + g.gid]).length;
 const head = `<form class="sn-search" data-sn-form><input name="q" value="${esc(SN.q)}" placeholder="ค้นชื่อ-นามสกุล" aria-label="ค้นชื่อ"><button class="btn sm" type="submit">ค้นหา</button></form>
  <p class="caveat">${icon('i-info')} ชื่อและนามสกุลตรงกันในหลายบริษัท แต่ทะเบียนไม่มีเลขบัตร จึง<b>ยังไม่ใช่การยืนยันว่าเป็นคนเดียวกัน</b> ชื่อที่พบบ่อยอาจเป็นคนละคน ดูจังหวัดและกิจการประกอบ
  ${SN.builtAt ? `· คำนวณเมื่อ ${thaiDate(SN.builtAt.slice(0, 10))}` : ''} · ตัดสินแล้วในหน้านี้ ${decided}</p>`;
 if (SN.error) return head + `<div class="empty"><strong>โหลดไม่สำเร็จ</strong>${esc(SN.error)}</div>`;
 if (!SN.items.length) return head + '<div class="empty"><strong>ไม่พบกลุ่มชื่อซ้ำ</strong>ยังไม่ได้สร้างไฟล์ identity.sqlite3 หรือไม่มีชื่อที่ตรงกัน (รัน pipeline/relink_identity.py)</div>';
 return head + SN.items.map(g => {
  const k = 'samename|' + g.gid, rv = S.reviews[k], r = rv?.status;
  const buttons = can('review.confirm')
   ? `<div class="review-row" data-ek="${esc(k)}"><button class="rv ok${r === 'ok' ? ' on' : ''}" data-rv="ok">${icon('i-check')}คนเดียวกัน</button>
      <button class="rv no${r === 'no' ? ' on' : ''}" data-rv="no">${icon('i-x')}คนละคน</button>
      <input class="rv-note" maxlength="1000" placeholder="หมายเหตุ (ไม่บังคับ)" value="${esc(rv?.note || '')}" aria-label="หมายเหตุการตรวจทาน"></div>`
   : `<div class="review-row">${r ? `<span class="rv ${r} on">${r === 'ok' ? 'คนเดียวกัน' : 'คนละคน'}</span>` : `<span class="rv locked">${icon('i-lock')}รอผู้มีสิทธิ์ตัดสิน</span>`}</div>`;
  return `<div class="card sn-card"><div class="card-meta">${tpill('PersonMention')}<span>${esc(g.name)}</span><span>· พบใน ${g.companies} บริษัท</span></div>
   <ul class="sn-list">${g.members.map(m => `<li><a data-open="company|${esc(m.cid)}" data-label="${esc(m.company_name)}">${esc(cut(m.company_name, 60))}</a><small>${esc(m.province || 'ไม่ระบุจังหวัด')} · ชื่อในทะเบียน “${esc(m.person_name)}”</small></li>`).join('')}</ul>${buttons}</div>`;
 }).join('') + (SN.next ? '<button class="btn" data-sn-more>โหลดเพิ่ม</button>' : '');
}
function renderReview(P) {
 const pend = S.graph ? S.graph.edges.filter(needsReview) : [];
 const done = Object.values(S.reviews);
 const g = S.graph;
 const tabs = `<div class="tabs" role="tablist">${[['graph', 'ในแผนผัง'], ['same', 'คนชื่อซ้ำ']].map(([k, l]) => `<button role="tab" data-rtab="${k}" aria-selected="${reviewTab === k}">${l}</button>`).join('')}</div>`;
 P.innerHTML = `
  <div class="p-head"><span class="eyebrow">Human-in-the-loop</span><h2>คิวตรวจทาน</h2>${tabs}
   <p>เส้นที่เชื่อมด้วยชื่อหรือกลุ่มชื่อ ยังไม่มีตัวระบุยืนยัน ผลตรวจทานบันทึกที่เซิร์ฟเวอร์พร้อมชื่อผู้ตรวจและเวลา และส่งออกพร้อมข้อมูล JSON</p>
   ${can('review.confirm') ? '' : `<p class="caveat">${icon('i-lock')} บทบาท <b>${esc(S.user?.role_label || 'ผู้ใช้งาน')}</b> ดูผลตรวจทานได้ แต่ยืนยันข้อมูลก่อนเผยแพร่ไม่ได้</p>`}
   <div class="p-tools"><span class="filter-pill">รอตรวจ <b>${pendingReviews().length}</b></span><span class="filter-pill">ตรวจแล้วทั้งหมด <b>${done.length}</b></span>
   ${done.length && can('data.export') ? `<button class="btn sm" data-act="export-reviews">${icon('i-download')}ส่งออกผลตรวจ</button>` : ''}</div></div>
  <div class="p-scroll">
   ${reviewTab === 'same' ? sameNameHTML() : `${g && can('review.confirm') ? bulkHTML() : ''}
   ${!g ? '<div class="empty"><strong>ยังไม่มีแผนผัง</strong>เปิดแผนผังก่อนเพื่อดูเส้นที่ต้องตรวจทาน</div>' :
    pend.length ? pend.slice(0, 120).map(e => `<div class="card">${relHTML(e, e.source).replace('class="rel"', 'class="rel" style="border:0;padding:0"').replace('<div class="rel-top">', `<div class="rel-top">${tpill(g.nodes.get(e.source).type)}<a data-act="select" data-id="${esc(e.source)}">${esc(cut(g.nodes.get(e.source).label, 50))}</a></div><div class="rel-top">`)}</div>`).join('')
    : '<div class="empty"><strong>ไม่มีเส้นที่ต้องตรวจทานในแผนผังนี้</strong>ทุกเส้นเชื่อมด้วยตัวระบุจากต้นทาง</div>'}`}
  </div>`;
}

/* panel events */
$('#panel').addEventListener('submit', ev => {
 const f = ev.target.closest('[data-sn-form]'); if (!f) return; ev.preventDefault();
 SN.q = new FormData(f).get('q').trim(); SN.loaded = false; SN.items = []; renderPanel();
});
$('#panel').addEventListener('click', ev => {
 const t = ev.target.closest('[data-act],[data-tab],[data-flag],[data-rv],[data-kind],[data-year],[data-open],[data-more],[data-rtab],[data-sn-more]');
 if (!t) return;
 if (t.dataset.rtab) { reviewTab = t.dataset.rtab; renderPanel(); return; }
 if (t.hasAttribute('data-sn-more')) { loadSameName(true); return; }
 if (t.dataset.rv) {
  const row = t.closest('[data-ek]'); if (!row) return;
  const k = row.dataset.ek, status = S.reviews[k]?.status === t.dataset.rv ? null : t.dataset.rv;
  const note = row.querySelector('.rv-note')?.value.trim() || null;
  row.querySelectorAll('button').forEach(b => b.disabled = true);
  post('/api/reviews', {key: k, status, graph: S.ref, note})
   .then(r => { S.reviews = r; toast(status ? (status === 'ok' ? 'บันทึก: ยืนยันข้อมูลแล้ว' : 'บันทึก: ข้อมูลไม่ถูกต้อง') : 'ยกเลิกผลตรวจทานแล้ว'); })
   .catch(e => toast(e.message)).finally(() => { updateBadge(); renderPanel(); });
  return;
 }
 if (t.dataset.flag != null) { const f = S.flags[+t.dataset.flag]; if (f) { focusFlag(f); toast('เน้นจุดที่เกี่ยวข้อง — คลิกพื้นที่ว่างเพื่อยกเลิก'); } return; }
 if (t.dataset.tab) { graphTab = t.dataset.tab; renderPanel(); return; }
 if (t.dataset.open) { const [kind, ...rest] = t.dataset.open.split('|'); openGraph(kind, rest.join('|'), {label: t.dataset.label}); return; }
 if (t.dataset.kind) { if (S.panel === 'search') { S.search.kind = t.dataset.kind; renderPanel(); } return; }
 if (t.dataset.year != null) { if (S.panel === 'search') { S.search.year = t.dataset.year; runSearch(S.search.q); } return; }
 if (t.dataset.more) { loadMore(t.dataset.more); return; }
 const id = t.dataset.id;
 switch (t.dataset.act) {
  case 'select': if (S.graph?.nodes.has(id)) { relLimit = 25; select(id); fitSoft(id); } break;
  case 'expand': expand(id); break;
  case 'recenter': { const r = graphRef(S.graph.nodes.get(id)); openGraph(r.kind, r.key, {label: S.graph.nodes.get(id).label}); break; }
  case 'peek': peekRow(t); break;
  case 'zoomto': fit(true, new Set([id, ...S.adj.get(id)])); break;
  case 'path-from': S.pathFrom = S.pathFrom === id ? null : id; toast(S.pathFrom ? 'เลือกจุดปลายทาง แล้วกด “เส้นทางจาก …”' : 'ยกเลิกจุดเริ่มเส้นทาง'); renderPanel(); break;
  case 'path-to': showPath(S.pathFrom, id); break;
  case 'correct': openCorrection(S.graph.nodes.get(id)?.label || ''); break;
  case 'bulk': bulkConfirm(t.dataset.agency); break;
  case 'ind-open': openProfile(t.dataset.kind, t.dataset.key); break;
  case 'close': select(null); break;
  case 'prev': case 'next': { const i = S.order.indexOf(S.selected) + (t.dataset.act === 'next' ? 1 : -1); if (S.order[i]) { select(S.order[i]); fitSoft(S.order[i]); } break; }
  case 'more-rel': relLimit += 50; renderPanel(); break;
  case 'export-reviews': download('tor-reviews.json', JSON.stringify({exported_at: new Date().toISOString(), reviews: S.reviews}, null, 2), 'application/json'); break;
 }
});
$('#panel').addEventListener('mouseover', ev => { const c = ev.target.closest('.card[data-node]'); if (c && S.vis.has(c.dataset.node)) setHover(c.dataset.node); });
$('#panel').addEventListener('mouseout', ev => { const c = ev.target.closest('.card[data-node]'); if (c && !c.contains(ev.relatedTarget)) setHover(null); });
function fitSoft(id) {
 const p = S.pos.get(id); if (!p) return;
 const {x, y, k} = S.view, sx = p.x * k + x, sy = p.y * k + y, W = svg.clientWidth, H = svg.clientHeight;
 if (sx < 60 || sy < 60 || sx > W - 60 || sy > H - 60) fit(true, new Set([id, ...S.adj.get(id)]));
}

/* ───────────── search & browse ───────────── */
const SEARCH_KINDS = ['projects', 'companies', 'people', 'agencies'];
const LIST_TITLE = {projects: 'โครงการ', companies: 'นิติบุคคล', people: 'ผู้เกี่ยวข้อง', agencies: 'หน่วยงาน', quality: 'แถวข้อมูลที่ถูกกักไว้'};
const KIND_OF_LIST = {projects: 'project', companies: 'company', people: 'person', agencies: 'agency'};
function listParams(kind, q, f = {}, next) {
 const p = {q, limit: kind === 'quality' ? 30 : 20};
 if (kind === 'projects') Object.assign(p, {year: f.year, after: next});
 if (kind === 'companies') Object.assign(p, {cursor: next, with_contracts: f.with_contracts ? 1 : ''});
 if (kind === 'people') Object.assign(p, {after: next, kind: f.kind});
 if (kind === 'agencies') Object.assign(p, {cursor: next, min_rows: f.min_rows});
 if (kind === 'quality') Object.assign(p, {after: next});
 return p;
}
function offlineList(kind, q) {
 const s = tidy(q).toLowerCase();
 if (kind !== 'projects') return {items: []};
 return {items: SAMPLES.filter(p => !s || [p.id, p.short, p.contract?.['ชื่อโครงการจัดซื้อจัดจ้าง'], p.companyName, p.contract?.['ชื่อหน่วยงาน']].join(' ').toLowerCase().includes(s))
  .map(p => ({pid: p.id, title: p.contract?.['ชื่อโครงการจัดซื้อจัดจ้าง'] || p.short, agency: p.contract?.['ชื่อหน่วยงานย่อย'], year: 2500 + +p.id.slice(0, 2), cid: p.companyId}))};
}
async function fetchList(kind, q, f, next) {
 if (!S.api) return offlineList(kind, q);
 return api('/api/' + kind, listParams(kind, q, f, next), 30000);
}
function itemCard(kind, it) {
 let type, title, sub = [], nums = [], open = '', meta = [];
 if (kind === 'projects') {
  type = 'Project'; title = it.title; meta.push(it.year, it.pid); sub.push(it.agency); if (it.cid) sub.push('ผู้ชนะ ' + it.cid);
  open = 'project|' + it.pid;
 } else if (kind === 'companies') {
  type = 'Organization'; title = it.name; meta.push(it.cid); nums.push([fmt(it.contract_rows), 'ระเบียนสัญญา']); open = 'company|' + it.cid;
 } else if (kind === 'people') {
  type = it.kind || 'PersonMention'; title = tidy(it.name); meta.push('ในทะเบียนของ ' + it.cid);
  if (it.amount) nums.push([fmt(it.amount), 'จำนวนตามทะเบียน']); if (it.raw_role) nums.push([it.raw_role, 'รหัสบทบาท']);
  if (it.entity_key?.startsWith('mention:')) sub.push('ไม่มีตัวระบุ — แสดงเฉพาะทะเบียนนี้');
  open = 'person|' + it.entity_key;
 } else if (kind === 'agencies') {
  type = 'Agency'; title = it.name; nums.push([fmt(it.source_rows), 'ระเบียนต้นทาง']); open = 'agency|' + it.name;
  if (it.units?.length) sub.push('ชื่อนี้ใช้ร่วมกัน ' + it.units.length + ' หน่วยงานแม่ — เลือกหน่วยงานที่ต้องการ');
 } else {
  return `<article class="card"><div class="card-meta"><span class="tpill" style="--tc:#c2410c"><i></i>${esc(it.reason)}</span><span>แถว ${esc(it.record)}</span></div>
   <div class="evid" style="margin-top:8px">${icon('i-doc')}<span>${esc(it.path)} › ${esc(it.member)}</span></div></article>`;
 }
 return `<article class="card">
  <div class="card-meta">${tpill(type)}${meta.filter(Boolean).map(m => `<span>· ${esc(m)}</span>`).join('')}</div>
  <h3 data-open="${esc(open)}" data-label="${esc(title)}">${esc(cut(title, 140))}</h3>
  ${sub.filter(Boolean).length ? `<p class="sub">${sub.filter(Boolean).map(esc).join(' · ')}</p>` : ''}
  ${it.units?.length ? `<ul class="sn-list">${it.units.map(u => `<li><a data-open="agency|${esc(it.name + '||' + u.parent)}" data-label="${esc(it.name + ' (' + u.parent + ')')}">${esc(cut(u.parent, 70))}</a><small>${fmt(u.rows)} ระเบียน</small></li>`).join('')}</ul>` : ''}
  ${nums.length ? `<div class="nums">${nums.map(([v, l]) => `<span><b>${esc(v)}</b>${esc(l)}</span>`).join('')}</div>` : ''}
  <div class="card-actions"><span class="muted" style="font-weight:500">เริ่มแผนผังจากรายการนี้</span><button class="btn primary" data-open="${esc(open)}" data-label="${esc(title)}">${icon('i-graph')}เปิดแผนผัง</button></div>
 </article>`;
}

function goSearch(q = '') {
 showWorkspace(); S.panel = 'search';
 if (!S.search) S.search = {q: '', kind: 'all', year: '', res: {}};
 if (!S.graph) $('#empty-stage').hidden = false;
 renderPanel();
 if (q) runSearch(q); else setTimeout(() => $('#sq')?.focus(), 30);
}
let searchSeq = 0;
async function runSearch(q) {
 q = tidy(q); const s = S.search; s.q = q; s.res = {};
 const seq = ++searchSeq;
 if (!q) { renderPanel(); return; }
 if (/^\d{11}$/.test(q) || /^\d{13}$/.test(q)) s.kind = 'all';
 const kinds = /^\d{13}$/.test(q) ? ['companies', 'projects'] : /^\d{11}$/.test(q) ? ['projects'] : SEARCH_KINDS;
 for (const k of SEARCH_KINDS) s.res[k] = kinds.includes(k) ? {loading: true, items: []} : {items: [], skipped: true};
 renderPanel();
 await Promise.all(kinds.map(async k => {
  try { const r = await fetchList(k, q, k === 'projects' ? {year: s.year} : {}); if (seq === searchSeq) s.res[k] = {items: r.items || [], next: r.next}; }
  catch (e) { if (seq === searchSeq) s.res[k] = {items: [], error: e.message}; }
  if (seq === searchSeq && S.panel === 'search') renderPanel();
 }));
}
async function loadMore(k) {
 const st = S.panel === 'search' ? S.search.res[k] : S.list; if (!st || st.loading) return;
 st.loading = true; renderPanel();
 try {
  const r = await fetchList(k, S.panel === 'search' ? S.search.q : S.list.q, S.panel === 'search' ? {year: S.search.year} : S.list.f, st.next);
  st.items = st.items.concat(r.items || []); st.next = r.next;
 } catch (e) { st.error = e.message; }
 st.loading = false; renderPanel();
}
function resultBlock(k, st, limit) {
 if (!st || st.skipped) return '';
 const items = limit ? st.items.slice(0, limit) : st.items;
 return `${items.map(it => itemCard(k, it)).join('')}
  ${st.loading ? `<div class="empty"><span class="spinner" style="display:inline-block"></span></div>` : ''}
  ${st.error ? `<div class="err">${esc(LIST_TITLE[k])}: ${esc(st.error)}</div>` : ''}
  ${!st.loading && !st.error && !st.items.length ? `<p class="muted" style="font-size:12.5px;margin:2px">ไม่พบ${esc(LIST_TITLE[k])}ที่ตรงกับคำค้น</p>` : ''}
  ${limit && st.items.length > limit ? `<button class="btn sm" data-kind="${k}">ดู${esc(LIST_TITLE[k])}ทั้งหมด ${st.items.length}${st.next ? '+' : ''}</button>` : ''}
  ${!limit && st.next && !st.loading ? `<button class="btn" data-more="${k}">โหลดเพิ่ม</button>` : ''}`;
}
function renderSearch(P) {
 const s = S.search, years = ['', '2569', '2568', '2567', '2566', '2565'];
 const count = k => s.res[k]?.skipped ? '' : s.res[k]?.loading ? '…' : (s.res[k]?.items.length || 0) + (s.res[k]?.next ? '+' : '');
 P.innerHTML = `
  <div class="search-top">
   <form class="search-row" id="sform" role="search"><input id="sq" value="${esc(s.q)}" placeholder="ค้นหาชื่อโครงการ บริษัท บุคคล หน่วยงาน หรือรหัส…" autocomplete="off" aria-label="ค้นหา"><button type="submit" aria-label="ค้นหา">${icon('i-search')}</button></form>
   <div class="chips" role="group" aria-label="ปีงบประมาณของโครงการ">${years.map(y => `<button type="button" data-year="${y}" aria-pressed="${s.year === y}">${y ? 'ปี ' + y : 'ทุกปี'}</button>`).join('')}</div>
   ${s.q ? `<div class="tabs" role="tablist"><button data-kind="all" aria-selected="${s.kind === 'all'}">ทั้งหมด</button>${SEARCH_KINDS.filter(k => !s.res[k]?.skipped).map(k => `<button data-kind="${k}" aria-selected="${s.kind === k}">${LIST_TITLE[k]}<span>${count(k)}</span></button>`).join('')}</div>` : ''}
  </div>
  <div class="p-scroll">
   ${!s.q ? `<div class="empty"><strong>ค้นหาข้อมูลทั้งหมดในเครื่อง</strong>พิมพ์ชื่อหรือรหัส แล้วกด Enter<br><br>รหัสโครงการ 11 หลักและเลขนิติบุคคล 13 หลักค้นได้เร็วที่สุด</div>` :
    s.kind === 'all' ? SEARCH_KINDS.filter(k => !s.res[k]?.skipped).map(k => `<div class="group-h">${LIST_TITLE[k]}</div>${resultBlock(k, s.res[k], 3)}`).join('')
    : resultBlock(s.kind, s.res[s.kind])}
   ${s.q && !S.api ? '<p class="caveat">โหมดตัวอย่างค้นได้เฉพาะ 5 โครงการตัวอย่าง</p>' : ''}
   ${s.q && S.api ? '<p class="caveat">ผลโครงการแบ่งตามระเบียนต้นทาง โครงการที่มีหลายสัญญาอาจซ้ำ ผู้เสนอราคาที่เชื่อมด้วยชื่ออย่างเดียวยังต้องยืนยัน</p>' : ''}
  </div>`;
 $('#sform').onsubmit = ev => { ev.preventDefault(); runSearch($('#sq').value); };
}

function goBrowse(kind) {
 showWorkspace(); S.panel = 'browse';
 if (S.list?.kind !== kind) S.list = {kind, q: '', f: {}, items: [], next: null};
 if (!S.graph) $('#empty-stage').hidden = false;
 renderPanel(); refreshBrowse();
}
async function refreshBrowse() {
 const L = S.list; L.loading = true; L.error = null; L.items = []; renderPanel();
 try { const r = await fetchList(L.kind, L.q, L.f); if (S.list === L) { L.items = r.items || []; L.next = r.next; } }
 catch (e) { L.error = e.message; }
 L.loading = false; if (S.panel === 'browse') renderPanel();
}
function renderBrowse(P) {
 const L = S.list, k = L.kind;
 const filt = {
  projects: `<label class="sel">ปี<select data-f="year">${['', '2569', '2568', '2567', '2566', '2565'].map(y => `<option value="${y}" ${L.f.year === y ? 'selected' : ''}>${y || 'ทุกปี'}</option>`).join('')}</select></label>`,
  companies: `<label class="chk"><input type="checkbox" data-f="with_contracts" ${L.f.with_contracts ? 'checked' : ''}>เฉพาะที่มีสัญญา</label>`,
  people: `<label class="sel">ประเภท<select data-f="kind"><option value="">ทั้งหมด</option><option value="PersonMention" ${L.f.kind === 'PersonMention' ? 'selected' : ''}>บุคคล</option><option value="OrganizationMention" ${L.f.kind === 'OrganizationMention' ? 'selected' : ''}>นิติบุคคล</option></select></label>`,
  agencies: `<label class="sel">ระเบียนขั้นต่ำ<select data-f="min_rows">${['0', '10', '100', '1000'].map(v => `<option value="${v}" ${(L.f.min_rows || '0') === v ? 'selected' : ''}>${v === '0' ? 'ไม่กำหนด' : fmt(v)}</option>`).join('')}</select></label>`,
  quality: '',
 }[k];
 const note = {
  projects: 'เรียงตามลำดับระเบียนต้นทาง ค้นด้วยชื่อโครงการ หน่วยงาน ผู้ชนะ หรือรหัส',
  companies: 'นิติบุคคลจากทะเบียน DBD (ภาพข้อมูล ก.ย. 2569)', people: 'ผู้ถือหุ้น/ผู้เกี่ยวข้องที่ปรากฏในทะเบียน เลขบุคคลถูกแฮช ไม่แสดงเลขจริง',
  agencies: 'จัดกลุ่มด้วยชื่อหน่วยงานที่ตรงกันทุกตัวอักษร ยังไม่ใช่รหัสหน่วยงานทางการ', quality: 'แถวที่จำนวนช่องไม่ตรงหัวตารางหรือรหัสไม่สมบูรณ์ ถูกแยกไว้ ไม่ซ่อมแซมเอง',
 }[k];
 P.innerHTML = `
  <div class="p-head"><span class="eyebrow">เรียกดูข้อมูล</span><h2>${LIST_TITLE[k]}</h2><p>${esc(note)}</p>
   ${k !== 'quality' ? `<form class="search-row" id="bform" style="margin-top:10px"><input id="bq" value="${esc(L.q)}" placeholder="กรอง${LIST_TITLE[k]}…" autocomplete="off"><button type="submit" aria-label="กรอง">${icon('i-search')}</button></form>` : ''}
   ${filt ? `<div class="p-tools" id="bfilt">${filt}</div>` : ''}</div>
  <div class="p-scroll">${resultBlock(k, L)}</div>`;
 $('#bform') && ($('#bform').onsubmit = ev => { ev.preventDefault(); L.q = tidy($('#bq').value); refreshBrowse(); });
 $('#bfilt')?.addEventListener('change', ev => { const f = ev.target.dataset.f; if (!f) return; L.f[f] = ev.target.type === 'checkbox' ? ev.target.checked : ev.target.value; refreshBrowse(); });
}

/* ───────────── export ───────────── */
function download(name, data, type) {
 const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], {type}));
 const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
 setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const fileBase = () => 'tor-' + (S.ref ? S.ref.kind + '-' + String(S.ref.key).replace(/[^\w฀-๿-]+/g, '_').slice(0, 40) : 'graph');
$('#export-json').onclick = () => {
 if (!can('data.export') || S.publicMode) return toast('บทบาทของคุณไม่มีสิทธิ์ส่งออกข้อมูล');
 if (!S.graph) return toast('ยังไม่มีแผนผังให้ส่งออก');
 const g = S.graph;
 download(fileBase() + '.json', JSON.stringify({
  exported_at: new Date().toISOString(), start: S.ref, depth: +depthSel.value, branch: +branchSel.value, data_as_of: S.asOf,
  case: S.publicMode ? {slug: S.publicCase?.slug, title: S.publicCase?.title} : S.caseId ? {id: S.caseId, title: S.caseTitle} : null,
  coverage: g.coverage, caveats: (g.finding || '').split(' · '),
  nodes: [...g.nodes.values()], edges: g.edges.map(e => ({...e, review: S.reviews[edgeKey(e)] || null})),
  observations: S.flags.map(({title, text, why, level, nodes}) => ({title, text, why, level, nodes})),
  note: 'ความเชื่อมโยงเป็นจุดเริ่มต้นของการตรวจสอบหลักฐาน ไม่ใช่ข้อสรุป',
 }, null, 2), 'application/json');
};

function figureSVG(W, H, opt) {
 const g = S.graph, ids = [...S.vis];
 let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
 for (const id of ids) { const p = S.pos.get(id); x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
 const top = 84, bot = opt.legend ? 74 : 44, side = 70;
 const k = Math.min((W - side * 2) / (x1 - x0 || 1), (H - top - bot) / (y1 - y0 || 1), 1.6);
 const ox = W / 2 - (x0 + x1) / 2 * k, oy = top + (H - top - bot) / 2 - (y0 + y1) / 2 * k;
 const P = id => { const p = S.pos.get(id); return {x: p.x * k + ox, y: p.y * k + oy}; };
 const font = `font-family="IBM Plex Sans Thai, Noto Sans Thai, Tahoma, sans-serif"`;
 const rs = id => radius(g.nodes.get(id)) * clamp(k, .55, 1.3);
 const edges = S.links.map(l => {
  const a = P(l.from), b = P(l.to), dx = b.x - a.x, dy = b.y - a.y, s = (hash(l.from + l.to) > .5 ? 1 : -1) * .1;
  return `<path d="M${a.x.toFixed(1)},${a.y.toFixed(1)}Q${((a.x + b.x) / 2 - dy * s).toFixed(1)},${((a.y + b.y) / 2 + dx * s).toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}" fill="none" stroke="#c9d1dc" stroke-width="1.1"${l.solid ? '' : ' stroke-dasharray="4 4"'}/>`;
 }).join('');
 const nodes = ids.map(id => {
  const n = g.nodes.get(id), p = P(id), r = rs(id), c = id === g.center ? '#3c4657' : T(n.type).hex;
  return `<g data-id="${esc(id)}" style="cursor:pointer"><circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r.toFixed(1)}" fill="${id === g.center ? c : '#fff'}" stroke="${c}" stroke-width="1.8"${unverifiedNode(n) ? ' stroke-dasharray="3 2.5"' : ''}/></g>`;
 }).join('');
 const boxes = [];
 const lblIds = ids.sort((a, b) => (b === g.center) - (a === g.center) || deg(b) - deg(a)).filter(id => opt.labels || id === g.center || deg(id) >= 3);
 const labels = lblIds.map(id => {
  const p = P(id), t = cut(g.nodes.get(id).label, id === g.center ? 44 : 24), w = t.length * 5.9, y = p.y + rs(id) + 12;
  const box = [p.x - w / 2, y - 10, p.x + w / 2, y + 3];
  if (id !== g.center && boxes.some(o => box[0] < o[2] && box[2] > o[0] && box[1] < o[3] && box[3] > o[1])) return '';
  boxes.push(box);
  return `<text x="${p.x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" font-size="${id === g.center ? 12 : 10.5}" font-weight="${id === g.center ? 700 : 500}" fill="#3a4454" stroke="#fff" stroke-width="3" paint-order="stroke" ${font}>${esc(t)}</text>`;
 }).join('');
 const present = Object.keys(TYPES).filter(t => ids.some(id => g.nodes.get(id).type === t));
 let lx = side;
 const legend = opt.legend ? present.map(t => { const s = `<circle cx="${lx + 6}" cy="${H - 40}" r="5.5" fill="#fff" stroke="${TYPES[t].hex}" stroke-width="2"/><text x="${lx + 17}" y="${H - 36}" font-size="11" fill="#465165" ${font}>${esc(TYPES[t].label)}</text>`; lx += 30 + TYPES[t].label.length * 6.4; return s; }).join('')
  + `<line x1="${lx + 6}" x2="${lx + 30}" y1="${H - 40}" y2="${H - 40}" stroke="#9aa6b6" stroke-dasharray="4 4"/><text x="${lx + 36}" y="${H - 36}" font-size="11" fill="#465165" ${font}>ต้องตรวจทาน</text>` : '';
 const center = g.nodes.get(g.center);
 const date = new Date().toLocaleDateString('th-TH', {dateStyle: 'long'});
 return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="#fff"/>
  <text x="${side}" y="40" font-size="19" font-weight="700" fill="#1b2333" font-family="Noto Serif Thai, IBM Plex Sans Thai, Georgia, serif">${esc(cut(center?.label, 70))}</text>
  <text x="${side}" y="62" font-size="11.5" fill="#7a8597" ${font}>แผนผังความสัมพันธ์เริ่มจาก${esc(KIND_LABEL[S.ref?.kind] || '')} · ${S.vis.size} จุด ${S.links.length} เส้น · ความลึก ${depthSel.value} ชั้น · ${esc(date)}</text>
  <text x="${W - side}" y="40" text-anchor="end" font-size="16" font-weight="700" fill="#9aa4b2" font-family="Noto Serif Thai, Georgia, serif">TOR</text>
  <text x="${W - side}" y="56" text-anchor="end" font-size="9" fill="#a3acb9" letter-spacing="1.5" ${font}>TRACE · OPEN · REVEAL</text>
  <g>${edges}</g><g>${nodes}</g><g>${labels}</g>
  ${legend}
  <text x="${W - side}" y="${H - 16}" text-anchor="end" font-size="10" fill="#9aa4b2" ${font}>ที่มา: e-GP (Data.go.th)${S.asOf?.egp_files?.length ? ' ' + esc(thaiDate(S.asOf.egp_files.at(-1))) : ''} · ทะเบียน DBD${S.asOf?.dbd_to ? ' ' + esc(thaiDate(S.asOf.dbd_to)) : ''} · ความเชื่อมโยงเป็นจุดเริ่มต้นของการตรวจสอบ ไม่ใช่ข้อสรุป</text>
 </svg>`;
}
function figSize() { const [a, b] = $('#fig-ratio').value.split(':').map(Number); const W = a >= b ? 1600 : 1240; return {W, H: Math.round(W * b / a)}; }
function renderFigure() {
 const {W, H} = figSize(), fig = $('#figure'), body = $('.modal-body');
 fig.innerHTML = figureSVG(W, H, {labels: $('#fig-labels').checked, legend: $('#fig-legend').checked});
 const s = Math.min((body.clientWidth - 20) / W, (body.clientHeight - 20) / H);
 fig.style.width = W * s + 'px'; fig.style.height = H * s + 'px';
}
$('#open-export').onclick = () => { if (!can('data.export')) return toast('บทบาทของคุณไม่มีสิทธิ์ส่งออกข้อมูล'); if (!S.graph) return toast('ยังไม่มีแผนผังให้ส่งออก'); $('#export-modal').hidden = false; renderFigure(); };
$('#export-close').onclick = () => { $('#export-modal').hidden = true; tip.hidden = true; };
['#fig-ratio', '#fig-labels', '#fig-legend'].forEach(s => $(s).onchange = renderFigure);
$('#figure').addEventListener('pointerover', ev => { const g = ev.target.closest('[data-id]'); if (g) showTip(S.graph.nodes.get(g.dataset.id), ev); });
$('#figure').addEventListener('pointermove', ev => { if (!tip.hidden) moveTip(ev); });
$('#figure').addEventListener('pointerout', ev => { if (ev.target.closest('[data-id]')) tip.hidden = true; });
$('#dl-svg').onclick = () => { const {W, H} = figSize(); download(fileBase() + '.svg', figureSVG(W, H, {labels: $('#fig-labels').checked, legend: $('#fig-legend').checked}), 'image/svg+xml'); };
$('#dl-png').onclick = () => {
 const {W, H} = figSize(), src = figureSVG(W, H, {labels: $('#fig-labels').checked, legend: $('#fig-legend').checked});
 const img = new Image();
 img.onload = () => { const c = document.createElement('canvas'); c.width = W * 2; c.height = H * 2; const x = c.getContext('2d'); x.scale(2, 2); x.drawImage(img, 0, 0); c.toBlob(b => download(fileBase() + '.png', b), 'image/png'); };
 img.onerror = () => toast('สร้าง PNG ไม่สำเร็จ ลองดาวน์โหลด SVG');
 img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(src);
};

/* ───────────── home ───────────── */
const STARTERS = [
 {kind: 'project', key: '68099218030', label: 'เช่ารถโดยสารปรับอากาศพลังงานสะอาด (EV) ขสมก.', note: 'สัญญา 14,905 ล้านบาท · เริ่มจากโครงการ'},
 {kind: 'company', key: '0102504000650', label: 'เฉลิมศักดิ์ เทรดดิ้ง', note: 'ผู้ชนะ 200 ระเบียนสัญญา · เริ่มจากนิติบุคคล'},
 {kind: 'person', key: 'person:0a674d3adaa4988395d6a8299056e9c87d88b7a2c50ca724892331d927a66efd', label: 'นาย ยงยุทธ ปวิตรปก', note: 'ปรากฏในทะเบียน 5 นิติบุคคล · เริ่มจากบุคคล'},
 {kind: 'agency', key: '15031300003 - ที่ทำการปกครองอำเภอบ้านแพรก', label: 'ที่ทำการปกครองอำเภอบ้านแพรก', note: '212 ระเบียนต้นทาง · เริ่มจากหน่วยงาน'},
];
function renderHome() {
 const list = S.api ? STARTERS : SAMPLES.map(p => ({kind: 'project', key: p.id, label: p.contract?.['ชื่อโครงการจัดซื้อจัดจ้าง'] || p.short, note: baht(p.amount) + ' · ' + (p.companyName || '')}));
 $('#starters').innerHTML = list.map(s => `<button type="button" class="starter" data-open="${esc(s.kind + '|' + s.key)}" data-label="${esc(s.label)}" style="--tc:${T(KIND_TYPE[s.kind]).hex}">
  <span class="type"><i></i>${KIND_LABEL[s.kind]}</span><strong>${esc(cut(s.label, 80))}</strong><small>${esc(s.note)}</small></button>`).join('');
 const st = S.stats;
 const stats = st ? [[st.contracts, 'ระเบียนสัญญา e-GP'], [st.bids, 'ระเบียนผู้เสนอราคา'], [st.companies, 'นิติบุคคลในทะเบียน DBD'], [st.registry_roles, 'ผู้เกี่ยวข้องตามทะเบียน'], [st.companies_with_contracts, 'นิติบุคคลที่จับคู่กับสัญญา']]
  : [[SAMPLES.length, 'โครงการตัวอย่าง (โหมดออฟไลน์)']];
 $('#stats').innerHTML = stats.map(([v, l]) => `<div><b>${fmt(v)}</b><span>${l}</span></div>`).join('') + (S.asOf ? `<p class="stats-asof">${esc(asOfText())}</p>` : '');
 if (st) $('#rail-data').textContent = `สัญญา ${fmt(st.contracts)} ระเบียน · ทะเบียน DBD ก.ย. 2569`;
}
$('#starters').addEventListener('click', ev => { const b = ev.target.closest('[data-open]'); if (!b) return; const [k, ...r] = b.dataset.open.split('|'); openGraph(k, r.join('|'), {label: b.dataset.label}); });
$('#hero-form').onsubmit = ev => { ev.preventDefault(); routeQuery($('#hero-q').value); };
$$('[data-try]').forEach(b => b.onclick = () => { $('#hero-q').value = b.dataset.try; routeQuery(b.dataset.try); });
function routeQuery(q) {
 q = tidy(q); if (!q) return;
 if (/^\d{11}$/.test(q)) return openGraph('project', q);
 if (/^\d{13}$/.test(q) && S.api) return openGraph('company', q);
 goSearch(q);
}
function drawHomeBg() {
 const c = $('#home-bg'); if (!c || $('#home').hidden) return;
 const W = c.clientWidth, H = c.clientHeight, d = devicePixelRatio || 1; c.width = W * d; c.height = H * d;
 const x = c.getContext('2d'); x.scale(d, d); x.clearRect(0, 0, W, H);
 const pts = Array.from({length: 26}, (_, i) => { const side = i % 2 ? 1 : 0; return {x: side ? W - hash('x' + i) * W * .2 - 20 : hash('x' + i) * W * .2 + 20, y: 40 + hash('y' + i) * (H - 60), r: 2.5 + hash('r' + i) * 5}; });
 x.strokeStyle = 'rgba(70,90,130,.18)'; x.lineWidth = 1;
 pts.forEach((p, i) => { const q = pts[(i + 2) % pts.length]; if (Math.hypot(p.x - q.x, p.y - q.y) < W * .25) { x.beginPath(); x.moveTo(p.x, p.y); x.quadraticCurveTo((p.x + q.x) / 2 + 30, (p.y + q.y) / 2 - 20, q.x, q.y); x.stroke(); } });
 pts.forEach(p => { x.beginPath(); x.arc(p.x, p.y, p.r, 0, 7); x.fillStyle = 'rgba(80,95,125,.22)'; x.fill(); });
}

/* ───────────── rail, keys, hash ───────────── */
// The rail folds to icons (remembered per browser); on the home page it is hidden and opens as a drawer.
const RAIL_KEY = 'tor.rail';
function setRail(mini) {
 document.body.dataset.rail = mini ? 'mini' : '';
 try { localStorage.setItem(RAIL_KEY, mini ? 'mini' : ''); } catch {}
 $('#rail-toggle').title = mini ? 'ขยายแถบเมนู' : 'ย่อแถบเมนู';
 $('#rail-toggle').setAttribute('aria-expanded', String(!mini));
 $$('.rail .nav-item, .rail-search, .me-actions button').forEach(b => { if (mini) b.title = [...b.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim() || b.textContent.trim(); else b.removeAttribute('title'); });
}
function setDrawer(open) {
 if (open) document.body.dataset.drawer = 'open'; else delete document.body.dataset.drawer;
 $('#rail-scrim').hidden = !open; $('#rail-open').setAttribute('aria-expanded', String(open));
 if (open) $('#rail .nav-item')?.focus();
}
try { setRail(localStorage.getItem(RAIL_KEY) === 'mini'); } catch { setRail(false); }
$('#rail-toggle').onclick = () => document.body.dataset.mode === 'home' ? setDrawer(false) : setRail(document.body.dataset.rail !== 'mini');
$('#rail-open').onclick = () => setDrawer(true);
$('#rail-scrim').onclick = () => setDrawer(false);
$('.me-actions').addEventListener('click', () => setDrawer(false), true);
$('.rail').addEventListener('click', ev => {
 const b = ev.target.closest('[data-go],[data-browse]'); if (!b) return; ev.preventDefault();
 setDrawer(false);
 if (b.dataset.browse) return goBrowse(b.dataset.browse);
 const go = b.dataset.go;
 if (go === 'home') return showHome();
 if (go === 'search') return goSearch(S.search?.q || '');
 if (go === 'admin') return showAdmin();
 if (go === 'dashboard') return showDashboard();
 if (go === 'cases') { showWorkspace(); S.panel = 'cases'; $('#empty-stage').hidden = !!S.graph; return renderPanel(); }
 if (go === 'public') { location.hash = 'public'; return; }
 showWorkspace(); S.panel = go === 'review' ? 'review' : (S.selected ? 'detail' : 'graph');
 $('#empty-stage').hidden = !!S.graph; renderPanel();
});
addEventListener('keydown', ev => {
 const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName);
 if (ev.key === '/' && !typing) { ev.preventDefault(); if (document.body.dataset.mode === 'home') $('#hero-q').focus(); else goSearch(S.search?.q || ''); }
 if (ev.key === 'Escape') {
  if (document.body.dataset.drawer) { setDrawer(false); $('#rail-open').focus(); return; }
  if (!$('#export-modal').hidden) { $('#export-modal').hidden = true; return; }
  if (S.focus) { S.focus = null; applyState(); return; }
  if (S.selected) select(null);
 }
});
function writeHash() { if (S.ref) history.replaceState(null, '', `#g=${S.ref.kind}:${encodeURIComponent(S.ref.key)}&d=${depthSel.value}&b=${branchSel.value}`); }
addEventListener('hashchange', () => {
 if (publicRoute()) return;
 const g = new URLSearchParams(location.hash.slice(1)).get('g');
 if (g && g !== (S.ref && S.ref.kind + ':' + S.ref.key)) readHash();
});
function readHash() {
 const h = new URLSearchParams(location.hash.slice(1)), g = h.get('g'); if (!g) return false;
 const i = g.indexOf(':'); const kind = g.slice(0, i), key = g.slice(i + 1);
 if (h.get('d')) depthSel.value = h.get('d'); if (h.get('b')) branchSel.value = h.get('b');
 openGraph(kind, key); return true;
}

/* ───────────── shared formatting ───────────── */
const thaiDate = iso => { if (!iso) return ''; const d = new Date(iso.length <= 10 ? iso + 'T00:00:00' : iso); return isNaN(d) ? iso : d.toLocaleDateString('th-TH', {dateStyle: 'medium'}); };
const pct = v => v == null ? '—' : (v * 100).toLocaleString('th-TH', {maximumFractionDigits: 1}) + '%';
const asOfText = () => {
 const a = S.asOf; if (!a) return '';
 const bits = [];
 if (a.egp_files?.length) bits.push('ไฟล์ e-GP ดาวน์โหลด ' + thaiDate(a.egp_files.at(-1)));
 if (a.dbd_to) bits.push('ทะเบียน DBD ' + (a.dbd_from && a.dbd_from !== a.dbd_to ? thaiDate(a.dbd_from) + '–' : '') + thaiDate(a.dbd_to));
 if (a.analytics_built) bits.push('ตัวชี้วัดคำนวณเมื่อ ' + thaiDate(a.analytics_built.slice(0, 10)));
 return bits.join(' · ');
};

/* ───────────── graph filters ───────────── */
function applyFilters() {
 S.filter = {verifiedOnly: $('#f-verified').checked, yearFrom: $('#f-year-from').value, yearTo: $('#f-year-to').value};
 $('#filter-badge').hidden = !filtersOn();
 if (!S.graph) return;
 if (S.selected && !S.graph.nodes.has(S.selected)) S.selected = null;
 rebuild();
 if (S.layout === 'timeline') layout(); else if ([...S.vis].some(id => !S.pos.has(id))) layout(S.graph.center);
 paint(); S.flags = detectFlags(); renderPanel();
}
['#f-verified', '#f-year-from', '#f-year-to'].forEach(sel => $(sel).onchange = applyFilters);
$('#f-reset').onclick = () => { $('#f-verified').checked = false; $('#f-year-from').value = $('#f-year-to').value = ''; applyFilters(); };

/* ───────────── path finder (inside the loaded graph) ───────────── */
function showPath(from, to) {
 if (!S.vis.has(from) || !S.vis.has(to)) return toast('จุดใดจุดหนึ่งถูกซ่อนอยู่ ล้างตัวกรองก่อน');
 // Breadth-first search with parent pointers gives the path with the fewest hops.
 const prev = new Map([[from, null]]), q = [from];
 while (q.length) { const cur = q.shift(); if (cur === to) break; for (const o of S.adj.get(cur) || []) if (!prev.has(o)) { prev.set(o, cur); q.push(o); } }
 if (!prev.has(to)) return toast('ไม่พบเส้นทางระหว่างสองจุดในแผนผังที่โหลด ลองขยายจุดเพิ่ม');
 const path = []; for (let x = to; x != null; x = prev.get(x)) path.unshift(x);
 S.focus = new Set(path); applyState(); fit(true, S.focus);
 toast(`เส้นทาง ${path.length - 1} ขั้น: ` + path.map(id => cut(S.graph.nodes.get(id).label, 14)).join(' → '));
}

/* ───────────── dataset-wide indicators inside node details ───────────── */
function indicatorSlot(n) {
 if (!internal()) return '';
 if (n.type === 'Agency' && (n.agency_name || n.label)) return `<div class="ind-slot" data-kind="agency" data-key="${esc(n.agency_name || n.label)}"></div>`;
 if (n.type === 'Organization' && /^\d{13}$/.test(n.company_id || '')) return `<div class="ind-slot" data-kind="company" data-key="${esc(n.company_id)}"></div>`;
 return '';
}
const indCache = new Map();
async function fillIndicators(P) {
 const slot = P.querySelector('.ind-slot'); if (!slot) return;
 const {kind, key} = slot.dataset, ck = kind + '|' + key;
 slot.innerHTML = '<div class="sec-h">ตัวชี้วัดทั้งชุดข้อมูล</div><p class="muted" style="font-size:12px">กำลังโหลด…</p>';
 try {
  if (!indCache.has(ck)) indCache.set(ck, await api('/api/dashboard/' + kind, kind === 'agency' ? {name: key} : {cid: key}));
  if (!slot.isConnected) return;
  slot.innerHTML = '<div class="sec-h">ตัวชี้วัดทั้งชุดข้อมูล <button class="linkish" data-act="ind-open" data-kind="' + kind + '" data-key="' + esc(key) + '">ดูโปรไฟล์เต็ม</button></div>' + profileSummary(kind, indCache.get(ck));
 } catch (e) { slot.innerHTML = `<div class="sec-h">ตัวชี้วัดทั้งชุดข้อมูล</div><p class="muted" style="font-size:12px">${esc(e.message)}</p>`; }
}
function rankPill(p) {
 if (p == null) return '';
 const cls = p >= 95 ? 'low' : p >= 80 ? 'mid' : '';
 return `<span class="idpill ${cls}" title="สูงกว่าหน่วยงานอื่น ${p}% (เฉพาะหน่วยงานที่มีสัญญา ≥ 50 รายการ)">สูงกว่า ${p}%</span>`;
}
function profileSummary(kind, d) {
 const s = d.stats;
 if (kind === 'agency') return `<dl class="facts">
  <dt>สัญญาทั้งหมด</dt><dd>${fmt(s.n)} รายการ · ${baht(s.amount)}</dd>
  <dt>ผู้ได้รับสัญญา</dt><dd>${fmt(s.winners)} ราย</dd>
  <dt>ผู้รับจ้างรายใหญ่สุด</dt><dd>${pct(s.top_share)} ของมูลค่า ${rankPill(d.percentile.top_share)}</dd>
  <dt>ดัชนีกระจุกตัว (HHI)</dt><dd>${s.hhi == null ? '—' : fmt(Math.round(s.hhi * 10000))} ${rankPill(d.percentile.hhi)}</dd>
  <dt>วิธีเฉพาะเจาะจง</dt><dd>${pct(s.specific_share)} ${rankPill(d.percentile.specific_share)}</dd>
  <dt>สัญญาเท่ากับวงเงิน (≥99%)</dt><dd>${pct(s.near_budget_share)} ${rankPill(d.percentile.near_budget_share)}</dd>
  <dt>ผู้เสนอราคารายเดียว (โครงการปี 2568–2569)</dt><dd>${s.bid_projects ? pct(s.single_bid_rate) + ` จาก ${fmt(s.bid_projects)} โครงการ` : '—'} ${rankPill(d.percentile.single_bid_rate)}</dd></dl>
  ${s.n < d.min_contracts ? `<p class="caveat">มีสัญญาน้อยกว่า ${d.min_contracts} รายการ จึงไม่เทียบอันดับกับหน่วยงานอื่น</p>` : ''}`;
 return `<dl class="facts">
  <dt>สัญญาที่ได้รับ</dt><dd>${fmt(s.n)} รายการ · ${baht(s.amount)}</dd>
  <dt>หน่วยงานผู้ว่าจ้าง</dt><dd>${fmt(s.agencies)} แห่ง · ${fmt(s.years)} ปีงบ</dd>
  <dt>คู่ผู้เสนอราคาที่พบบ่อย</dt><dd>${d.cobid.length ? fmt(d.cobid.length) + ' คู่' + (d.cobid.some(c => c.shared_people) ? ' · <b>มีผู้เกี่ยวข้องร่วม</b>' : '') : '—'}</dd></dl>`;
}

/* ───────────── review queue: bulk confirm ───────────── */
function bulkGroups() {
 const groups = new Map();
 for (const e of S.graph.edges) if (e.type === 'PROCURES' && needsReview(e) && !S.reviews[edgeKey(e)]) {
  if (!groups.has(e.source)) groups.set(e.source, []); groups.get(e.source).push(e);
 }
 return [...groups].filter(([, list]) => list.length >= 2).sort((a, b) => b[1].length - a[1].length);
}
function bulkHTML() {
 const groups = bulkGroups(); if (!groups.length) return '';
 return `<div class="group-h">ยืนยันเป็นกลุ่ม</div><p class="caveat">เส้น “หน่วยงานเจ้าของโครงการ” จัดกลุ่มด้วยชื่อหน่วยงานที่ตรงกันทุกตัวอักษร ตรวจชื่อแล้วยืนยันทั้งกลุ่มได้</p>
  ${groups.slice(0, 20).map(([agency, list]) => `<div class="card bulk"><div class="card-meta">${tpill('Agency')}</div>
   <h3 data-act="select" data-id="${esc(agency)}">${esc(cut(S.graph.nodes.get(agency)?.label, 90))}</h3>
   <div class="card-actions"><span class="muted">${list.length} เส้นที่รอตรวจ</span><button class="btn sm primary" data-act="bulk" data-agency="${esc(agency)}">${icon('i-check')}ยืนยันทั้ง ${list.length} เส้น</button></div></div>`).join('')}`;
}
async function bulkConfirm(agency) {
 const keys = (bulkGroups().find(([a]) => a === agency)?.[1] || []).map(edgeKey); if (!keys.length) return;
 try { S.reviews = await post('/api/reviews/bulk', {keys, status: 'ok', graph: S.ref, note: 'ยืนยันเป็นกลุ่ม: ชื่อหน่วยงานตรงกัน'}); toast(`ยืนยัน ${keys.length} เส้นแล้ว`); }
 catch (e) { toast(e.message); }
 updateBadge(); rebuild(); paint(); renderPanel();
}

/* ───────────── forced password change ───────────── */
function forcePasswordChange() {
 $('#me').hidden = true; only(null); document.body.dataset.mode = 'auth';
 $('#pw-modal').hidden = false; $('#pw-err').hidden = true; $('#pw-form').reset(); $('#pw-cancel').hidden = true;
 $('#pw-title').textContent = 'ตั้งรหัสผ่านใหม่ก่อนเริ่มใช้งาน';
 setTimeout(() => $('#pw-form [name=current]').focus(), 30);
}

/* ───────────── saved investigations (cases) ───────────── */
const CS = {tab: 'mine', items: [], corrections: [], loading: false, error: null, note: {}};
const STATUS_CLS = {draft: '', submitted: 'mid', published: 'good', rejected: 'low', withdrawn: 'low'};
async function loadCaseBadge() {
 if (!can('review.confirm')) { $('#cases-badge').hidden = true; return; }
 try { const r = await api('/api/cases', {scope: 'queue'}); $('#cases-badge').hidden = !r.items.length; $('#cases-badge').textContent = r.items.length; } catch {}
}
async function loadCases() {
 CS.loading = true; CS.error = null; renderPanel();
 try {
  if (CS.tab === 'corrections') CS.corrections = (await api('/api/corrections', {status: 'open'})).items;
  else CS.items = (await api('/api/cases', {scope: CS.tab})).items;
 } catch (e) { CS.error = e.message; }
 CS.loading = false; if (S.panel === 'cases') renderPanel(); loadCaseBadge();
}
function caseCard(c) {
 const mine = c.created_by === S.user?.id, reviewer = can('review.confirm');
 const st = c.stats || {};
 const acts = [];
 acts.push(`<button class="btn sm" data-case="open" data-id="${c.id}">${icon('i-graph')}เปิด</button>`);
 if (mine && ['draft', 'rejected'].includes(c.status)) acts.push(`<button class="btn sm primary" data-case="submit" data-id="${c.id}">ส่งให้ผู้ตรวจทาน</button>`, `<button class="btn sm" data-case="delete" data-id="${c.id}">${icon('i-x')}ลบ</button>`);
 if (reviewer && c.status === 'submitted') acts.push(`<button class="btn sm" data-case="preview" data-id="${c.id}">ตรวจสิ่งที่จะเผยแพร่</button>`,
  CS.note[c.id] === 'confirm' ? `<button class="btn sm primary" data-case="publish" data-id="${c.id}">${icon('i-check')}ยืนยันเผยแพร่</button>` : `<button class="btn sm primary" data-case="publish-ask" data-id="${c.id}">${icon('i-globe')}เผยแพร่</button>`,
  `<button class="btn sm" data-case="reject-ask" data-id="${c.id}">ส่งกลับแก้ไข</button>`);
 if (reviewer && c.status === 'published') acts.push(`<button class="btn sm" data-case="withdraw-ask" data-id="${c.id}">ถอนการเผยแพร่</button>`);
 if (reviewer && c.status === 'withdrawn') acts.push(`<button class="btn sm" data-case="publish-ask" data-id="${c.id}">เผยแพร่อีกครั้ง</button>`);
 if (c.status === 'published' && c.slug) acts.push(`<a class="btn sm" href="#case=${esc(c.slug)}">${icon('i-globe')}หน้าสาธารณะ</a>`);
 const ask = CS.note[c.id];
 return `<article class="card case-card">
  <div class="card-meta"><span class="idpill ${STATUS_CLS[c.status]}">${esc(c.status_label)}</span><span>${esc(KIND_LABEL[c.spec.kind] || '')}</span><span>· ${esc(c.author || '—')}</span><span>· ${thaiDate(c.updated_at)}</span></div>
  <h3 data-case="open" data-id="${c.id}">${esc(c.title)}</h3>
  ${c.summary ? `<p class="sub">${esc(cut(c.summary, 220))}</p>` : ''}
  ${c.review_note ? `<p class="caveat">ผู้ตรวจทาน${c.reviewer ? ' ' + esc(c.reviewer) : ''}: ${esc(c.review_note)}</p>` : ''}
  ${st.edges != null ? `<div class="nums"><span><b>${fmt(st.nodes)}</b>จุด</span><span><b>${fmt(st.edges)}</b>เส้นที่เผยแพร่</span><span><b>${fmt(st.excluded_unreviewed)}</b>ตัดออก (ยังไม่ตรวจ)</span></div>` : ''}
  ${ask && ask !== 'confirm' ? `<form class="inline-note" data-note-for="${c.id}" data-action="${ask}"><input name="note" ${ask === 'reject' ? 'required' : ''} maxlength="2000" placeholder="${ask === 'reject' ? 'เหตุผลที่ส่งกลับ' : 'เหตุผล (ไม่บังคับ)'}"><button class="btn sm primary">${ask === 'reject' ? 'ส่งกลับ' : 'ถอนการเผยแพร่'}</button><button type="button" class="btn sm" data-case="cancel" data-id="${c.id}">ยกเลิก</button></form>` : ''}
  <div class="case-actions">${acts.join('')}</div>
 </article>`;
}
function correctionCard(k) {
 return `<article class="card"><div class="card-meta"><span class="idpill mid">คำขอแก้ไข #${k.id}</span><span>${thaiDate(k.created_at)}</span>${k.case_slug ? `<a class="linkish" href="#case=${esc(k.case_slug)}">เรื่อง ${esc(k.case_slug)}</a>` : ''}</div>
  ${k.item ? `<h3>${esc(k.item)}</h3>` : ''}<p class="sub">${esc(k.message)}</p>
  <p class="muted" style="font-size:12px">ผู้แจ้ง: ${esc(k.name)} · ${esc(k.contact)}</p>
  <form class="inline-note" data-correction="${k.id}"><input name="resolution" required maxlength="2000" placeholder="ผลการดำเนินการ เช่น แก้ไขแล้ว / ข้อมูลถูกต้องตามต้นทาง">
   <button class="btn sm primary" name="status" value="resolved">ดำเนินการแล้ว</button><button class="btn sm" name="status" value="rejected">ไม่แก้ไข</button></form></article>`;
}
function renderCases(P) {
 const tabs = [['mine', 'ของฉัน'], ...(can('review.confirm') ? [['queue', 'รอตรวจ'], ['corrections', 'คำขอแก้ไข']] : []), ['published', 'เผยแพร่แล้ว']];
 if (!tabs.some(([k]) => k === CS.tab)) CS.tab = 'mine';
 const list = CS.tab === 'corrections' ? CS.corrections.map(correctionCard) : CS.items.map(caseCard);
 P.innerHTML = `<div class="p-head"><span class="eyebrow">Investigations</span><h2>เรื่องที่บันทึก</h2>
   <p>บันทึกแผนผังพร้อมคำอธิบาย ส่งให้ผู้ตรวจทาน แล้วผู้มีสิทธิ์ยืนยันจึงเผยแพร่สู่หน้าสาธารณะ เส้นที่ยังไม่ตรวจจะถูกตัดออกอัตโนมัติ</p>
   <div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" data-ctab="${k}" aria-selected="${CS.tab === k}">${l}</button>`).join('')}</div></div>
  <div class="p-scroll">${CS.error ? `<div class="err">${esc(CS.error)}</div>` : ''}
   ${CS.loading ? '<div class="empty"><span class="spinner" style="display:inline-block"></span></div>' : list.join('') ||
    `<div class="empty"><strong>${CS.tab === 'mine' ? 'ยังไม่มีเรื่องที่บันทึก' : 'ไม่มีรายการ'}</strong>${CS.tab === 'mine' ? 'เปิดแผนผัง แล้วกด “บันทึกเรื่อง” ที่แถบด้านบนของแผนผัง' : ''}</div>`}</div>`;
 if (!CS.loaded) { CS.loaded = true; loadCases(); }
}
async function openCase(id) {
 try {
  const c = await api('/api/cases/get', {id}); const sp = c.spec;
  depthSel.value = String(sp.depth); branchSel.value = String(sp.branch);
  S.caseId = c.created_by === S.user?.id && ['draft', 'rejected'].includes(c.status) ? c.id : null; S.caseTitle = c.title;
  if (!await openGraph(sp.kind, sp.key, {keepCase: true})) return;
  for (const ref of sp.expanded) {
   const node = [...S.graph.nodes.values()].find(n => { const r = graphRef(n); return r && r.kind === ref.kind && r.key === ref.key; });
   if (node) { loading(true, 'กำลังขยายตามเรื่องที่บันทึก…'); await expand(node.id, true); }
  }
  loading(false); fit(); renderPanel();
  toast(`เปิดเรื่อง “${cut(c.title, 40)}”`);
 } catch (e) { loading(false); toast(e.message); }
}
async function caseAction(act, id, note) {
 const item = CS.items.find(c => c.id === id);
 try {
  if (act === 'open') return openCase(id);
  if (act === 'cancel') { delete CS.note[id]; return renderPanel(); }
  if (act === 'publish-ask') { CS.note[id] = 'confirm'; return renderPanel(); }
  if (act === 'reject-ask') { CS.note[id] = 'reject'; return renderPanel(); }
  if (act === 'withdraw-ask') { CS.note[id] = 'withdraw'; return renderPanel(); }
  if (act === 'preview') { const r = await post('/api/cases/preview', {id}, 120000); item.stats = r.stats; toast(`จะเผยแพร่ ${r.stats.edges} เส้น · ตัดออก ${r.stats.excluded_unreviewed} เส้นที่ยังไม่ตรวจ`); return renderPanel(); }
  if (act === 'submit') { await post('/api/cases/submit', {id}); toast('ส่งให้ผู้ตรวจทานแล้ว'); }
  if (act === 'delete') { await post('/api/cases/delete', {id}); toast('ลบเรื่องแล้ว'); }
  if (act === 'publish') { loading(true, 'กำลังสร้างแผนผังสำหรับเผยแพร่…'); const r = await post('/api/cases/publish', {id}, 120000); toast(`เผยแพร่แล้ว · ${r.stats.edges} เส้น`); }
  if (act === 'reject') { await post('/api/cases/reject', {id, note}); toast('ส่งกลับให้แก้ไขแล้ว'); }
  if (act === 'withdraw') { await post('/api/cases/withdraw', {id, note}); toast('ถอนการเผยแพร่แล้ว'); }
  delete CS.note[id]; loadCases();
 } catch (e) { toast(e.message); } finally { loading(false); }
}
$('#panel').addEventListener('click', ev => {
 const t = ev.target.closest('[data-ctab],[data-case]'); if (!t || t.tagName === 'FORM') return;
 if (t.dataset.ctab) { CS.tab = t.dataset.ctab; loadCases(); return; }
 if (t.dataset.case) caseAction(t.dataset.case, +t.dataset.id);
});
$('#panel').addEventListener('submit', async ev => {
 const f = ev.target;
 if (f.dataset.noteFor) { ev.preventDefault(); return caseAction(f.dataset.action, +f.dataset.noteFor, f.note.value); }
 if (f.dataset.correction) {
  ev.preventDefault();
  try { await post('/api/corrections/resolve', {id: +f.dataset.correction, status: ev.submitter?.value || 'resolved', resolution: f.resolution.value}); toast('บันทึกผลแล้ว'); loadCases(); }
  catch (e) { toast(e.message); }
 }
});
$('#save-case').onclick = () => {
 if (!S.graph || !internal()) return toast('เปิดแผนผังก่อนบันทึกเรื่อง');
 const f = $('#case-form'); f.reset(); $('#case-err').hidden = true;
 f.title.value = S.caseTitle || S.graph.nodes.get(S.graph.center)?.label || '';
 $('#case-title').textContent = S.caseId ? 'บันทึกการแก้ไขเรื่อง' : 'บันทึกเป็นเรื่อง';
 $('#case-modal').hidden = false; f.title.focus();
};
$('#case-cancel').onclick = () => $('#case-modal').hidden = true;
$('#case-form').onsubmit = async ev => {
 ev.preventDefault(); const f = ev.target;
 const spec = {kind: S.ref.kind, key: S.ref.key, depth: +depthSel.value, branch: +branchSel.value, expanded: S.expandedRefs, hidden: [...S.hidden]};
 try {
  const c = await post('/api/cases/save', {id: S.caseId, title: f.title.value, summary: f.summary.value, spec});
  S.caseId = c.id; S.caseTitle = c.title; $('#case-modal').hidden = true; CS.loaded = false;
  toast('บันทึกเรื่องแล้ว — ส่งให้ผู้ตรวจทานได้จากเมนู “เรื่องที่บันทึก”');
 } catch (e) { $('#case-err').textContent = e.message; $('#case-err').hidden = false; }
};

/* ───────────── public portal ───────────── */
function publicRoute() {
 const h = location.hash.slice(1);
 if (h === 'public') { showPublicHome(); return true; }
 if (h === 'about') { showAbout(); return true; }
 if (h.startsWith('case=')) { openPublicCase(decodeURIComponent(h.slice(5))); return true; }
 return false;
}
function enterPublic() {
 S.publicMode = true; $('#auth').hidden = true; $('#pw-modal').hidden = true;
 $('#pub-signin').textContent = S.user ? 'กลับสู่พื้นที่ทำงาน' : 'เข้าสู่ระบบ';
}
async function showPublicHome() {
 enterPublic(); only('public-home'); document.body.dataset.mode = 'public';
 const el = $('#public-home');
 el.innerHTML = '<div class="page-inner"><div class="empty"><span class="spinner" style="display:inline-block"></span></div></div>';
 try {
  const {items} = await api('/api/public/cases');
  el.innerHTML = `<div class="page-inner">
   <span class="eyebrow">Published investigations</span><h1 id="pub-title">เรื่องที่ตรวจทานและเผยแพร่แล้ว</h1>
   <p class="lead">แต่ละเรื่องผ่านการตรวจทานโดยผู้มีสิทธิ์ แสดงเฉพาะความสัมพันธ์ที่เชื่อมด้วยตัวระบุหรือผู้ตรวจทานยืนยันแล้ว และมีลิงก์ไปยังข้อมูลต้นทางทุกเส้น <a href="#about">อ่านวิธีการและข้อจำกัด</a></p>
   <p class="muted asof">${esc(asOfText())}</p>
   <div class="starters pub-cases">${items.map(c => `<a class="starter" href="#case=${esc(c.slug)}" style="--tc:${T(KIND_TYPE[c.scope] || 'Project').hex}">
     <span class="type"><i></i>${esc(KIND_LABEL[c.scope] || '')} · เผยแพร่ ${thaiDate(c.published_at)}</span><strong>${esc(c.title)}</strong>
     <small>${esc(cut(c.summary || c.center_label || '', 160))}</small><small>${fmt(c.stats?.nodes)} จุด · ${fmt(c.stats?.edges)} เส้น</small></a>`).join('')
    || '<div class="empty"><strong>ยังไม่มีเรื่องที่เผยแพร่</strong>เรื่องจะปรากฏที่นี่หลังผู้ตรวจทานยืนยัน</div>'}</div></div>`;
 } catch (e) { el.innerHTML = `<div class="page-inner"><div class="err">${esc(e.message)}</div></div>`; }
}
function showAbout() {
 enterPublic(); only('about'); document.body.dataset.mode = 'public';
 $('#about-asof').innerHTML = S.asOf ? '<b>วันที่ของข้อมูล</b> — ' + esc(asOfText()) : '';
}
async function openPublicCase(slug) {
 enterPublic(); showWorkspace(); S.panel = 'graph'; $('#empty-stage').hidden = true;
 loading(true, 'กำลังเปิดเรื่องที่เผยแพร่…');
 try {
  const snap = await api('/api/public/case', {slug});
  S.publicCase = {...snap, slug}; S.reviews = snap.reviews || {};
  S.filter = {verifiedOnly: false, yearFrom: '', yearTo: ''};
  setGraph(snap, {kind: snap.spec.kind, key: snap.spec.key}); paint();
  $('#stage-kicker').textContent = 'เรื่องที่เผยแพร่ · ตรวจทานโดย ' + (snap.reviewer || '—');
  $('#stage-heading').textContent = snap.title;
  graphTab = 'all'; renderPanel();
 } catch (e) { toast(e.message); $('#empty-stage').hidden = false; renderPanel(); }
 finally { loading(false); }
}
function publicCaseHTML() {
 const c = S.publicCase; if (!c) return '';
 return `<div class="pub-case"><span class="eyebrow">เผยแพร่ ${thaiDate(c.published_at)} · ผู้ตรวจทาน ${esc(c.reviewer || '—')}</span>
  <h3>${esc(c.title)}</h3>${c.summary ? `<p>${esc(c.summary).replace(/\n/g, '<br>')}</p>` : ''}
  <p class="caveat">แสดง ${fmt(c.stats.edges)} เส้นที่ยืนยันแล้ว · ตัดออก ${fmt(c.stats.excluded_unreviewed)} เส้นที่ยังไม่ได้ตรวจ และ ${fmt(c.stats.excluded_rejected)} เส้นที่ผู้ตรวจทานปฏิเสธ</p>
  <div class="row-end" style="justify-content:flex-start"><a class="btn sm" href="#public">${icon('i-left')}เรื่องอื่น</a><button class="btn sm" data-act="correct" data-id="">${icon('i-flag')}แจ้งแก้ไขข้อมูล</button></div></div>`;
}
$('#pub-signin').onclick = () => {
 S.publicMode = false; S.publicCase = null; S.graph = null; S.reviews = {}; history.replaceState(null, '', location.pathname);
 if (S.user) enterApp(S.user); else showAuth('login');
};
function openCorrection(item) {
 const f = $('#corr-form'); f.reset(); f.item.value = item || ''; $('#corr-err').hidden = true; $('#corr-modal').hidden = false; f.name.focus();
}
$('#corr-cancel').onclick = () => $('#corr-modal').hidden = true;
$('#corr-form').onsubmit = async ev => {
 ev.preventDefault(); const f = Object.fromEntries(new FormData(ev.target));
 try { await post('/api/public/corrections', {...f, slug: S.publicCase?.slug || null}); $('#corr-modal').hidden = true; toast('ส่งคำขอแล้ว ขอบคุณที่ช่วยตรวจสอบ'); }
 catch (e) { $('#corr-err').textContent = e.message; $('#corr-err').hidden = false; }
};

/* ───────────── dashboard ───────────── */
const D = {overview: null, tab: 'concentration', rows: {}, profile: null, error: null};
const IND = {
 concentration: {label: 'การกระจุกตัวของผู้ได้รับสัญญา', why: 'หน่วยงานที่มูลค่าสัญญากระจุกอยู่กับผู้รับจ้างน้อยราย (HHI สูง) ควรตรวจว่ามีการแข่งขันเพียงพอหรือไม่'},
 specific: {label: 'สัดส่วนวิธีเฉพาะเจาะจง', why: 'วิธีเฉพาะเจาะจงไม่มีการแข่งขัน สัดส่วนสูงอาจชอบด้วยกฎหมาย (งานมูลค่าต่ำ) แต่ควรดูประกอบ'},
 near_budget: {label: 'ราคาสัญญาเท่ากับวงเงิน', why: 'สัญญามูลค่า ≥ 99% ของวงเงินงบประมาณ (เฉพาะวงเงิน ≥ 100,000 บาท) อาจบ่งชี้ว่าราคาไม่ได้ลดจากการแข่งขัน'},
 single_bid: {label: 'ผู้เสนอราคารายเดียว', why: 'โครงการที่มีผู้เสนอราคาเพียงรายเดียว (ข้อมูลผู้เสนอราคามีเฉพาะโครงการปีงบประมาณ 2568–2569 ไม่ครอบคลุมปี 2565–2567)'},
 cobid: {label: 'คู่ผู้เสนอราคาที่พบกันบ่อย', why: 'บริษัทที่เสนอราคาในโครงการเดียวกันหลายครั้ง (เฉพาะโครงการปีงบประมาณ 2568–2569) โดยเฉพาะเมื่อมีกรรมการหรือผู้ถือหุ้นร่วม เป็นสัญญาณที่ OECD แนะนำให้ตรวจเรื่องการฮั้ว จับคู่ด้วยชื่อผู้เสนอราคา'},
};
async function showDashboard() {
 only('dashboard'); document.body.dataset.mode = 'explore'; S.panel = 'dashboard'; setNav();
 if (!D.overview) {
  $('#dashboard').innerHTML = '<div class="page-inner"><div class="empty"><span class="spinner" style="display:inline-block"></span></div></div>';
  try { D.overview = await api('/api/dashboard/overview'); D.error = null; } catch (e) { D.error = e.message; }
 }
 renderDashboard(); if (!D.error) loadIndicator(D.tab);
}
async function loadIndicator(tab) {
 D.tab = tab;
 if (!D.rows[tab]) { try { D.rows[tab] = (await api('/api/indicators', {type: tab, limit: 40})).items; } catch (e) { D.rows[tab] = {error: e.message}; } }
 const box = $('#ind-table'); if (box) box.innerHTML = indicatorTable(tab);
 $$('[data-itab]').forEach(b => b.setAttribute('aria-selected', b.dataset.itab === tab));
}
function columns(rows, value, label, fmtv) {
 const max = Math.max(...rows.map(value), 1);
 return `<div class="cols">${rows.map(r => `<div class="col" data-tip="${esc(label(r) + ': ' + fmtv(value(r)))}"><span class="col-v">${esc(fmtv(value(r)))}</span>
  <span class="col-bar" style="height:${Math.max(2, value(r) / max * 100)}%"></span><span class="col-x">${esc(label(r))}</span></div>`).join('')}</div>`;
}
function hbars(rows, value, label, fmtv, open) {
 const max = Math.max(...rows.map(value), 1);
 return `<div class="hbars">${rows.map(r => `<div class="hbar" data-tip="${esc(label(r) + ': ' + fmtv(value(r)))}">
  <span class="hbar-l">${open ? `<button class="linkish" ${open(r)}>${esc(cut(label(r), 46))}</button>` : esc(cut(label(r), 46))}</span>
  <span class="hbar-t"><span class="hbar-b" style="width:${Math.max(0.5, value(r) / max * 100)}%"></span></span><span class="hbar-v">${esc(fmtv(value(r)))}</span></div>`).join('')}</div>`;
}
const compactBaht = v => v >= 1e9 ? (v / 1e9).toLocaleString('th-TH', {maximumFractionDigits: 1}) + ' พันล้าน' : v >= 1e6 ? (v / 1e6).toLocaleString('th-TH', {maximumFractionDigits: 1}) + ' ล้าน' : fmt(Math.round(v));
const openAttr = (kind, key) => `data-dash="profile" data-kind="${kind}" data-key="${esc(key)}"`;
function renderDashboard() {
 const el = $('#dashboard');
 if (D.error) { el.innerHTML = `<div class="page-inner"><span class="eyebrow">Dashboard</span><h1 id="dash-title">ภาพรวมและตัวชี้วัด</h1><div class="err">${esc(D.error)}</div></div>`; return; }
 const o = D.overview, ys = o.years, tot = k => ys.reduce((s, y) => s + (y[k] || 0), 0);
 const unique = tot('unique_rows'), linked = tot('linked_rows');
 el.innerHTML = `<div class="page-inner dash">
  <div class="dash-head"><div><span class="eyebrow">Dashboard</span><h1 id="dash-title">ภาพรวมและตัวชี้วัด</h1>
   <p class="muted">${esc(asOfText())}</p></div></div>
  <div class="tiles">
   <div class="tile"><span>สัญญาทั้งหมด (ไม่นับแถวซ้ำ)</span><b>${fmt(unique)}</b><small>ปีงบ ${ys[0]?.year}–${ys.at(-1)?.year}</small></div>
   <div class="tile"><span>มูลค่าตามสัญญา</span><b>${compactBaht(tot('amount'))}</b><small>บาท · ผลรวมระเบียนสัญญา ไม่ใช่ยอดจ่ายจริง</small></div>
   <div class="tile"><span>เชื่อมกับทะเบียน DBD ได้</span><b>${pct(linked / unique)}</b><small>${fmt(linked)} ระเบียน — ส่วนที่เหลือยังไม่มีข้อมูลทะเบียน</small></div>
   <div class="tile"><span>วิธีเฉพาะเจาะจง</span><b>${pct(tot('specific_rows') / unique)}</b><small>ของจำนวนสัญญา</small></div>
  </div>
  <div class="dash-grid">
   <section class="panel-card"><h2>มูลค่าสัญญาตามปีงบประมาณ</h2><p class="muted">บาท</p>${columns(ys, y => y.amount, y => String(y.year), compactBaht)}</section>
   <section class="panel-card"><h2>จำนวนสัญญาตามปีงบประมาณ</h2><p class="muted">รายการ (ไม่นับแถวซ้ำ)</p>${columns(ys, y => y.unique_rows, y => String(y.year), v => fmt(v))}</section>
   <section class="panel-card"><h2>วิธีจัดซื้อจัดจ้าง</h2><p class="muted">จำนวนสัญญา · 8 อันดับแรก</p>${hbars(o.methods, m => m.n, m => m.method, v => fmt(v))}</section>
   <section class="panel-card"><h2>จังหวัดที่มูลค่าสัญญาสูงสุด</h2><p class="muted">บาท · 15 อันดับแรก</p>${hbars(o.provinces, p => p.amount, p => p.province, compactBaht)}</section>
   <section class="panel-card"><h2>หน่วยงานที่มูลค่าสัญญาสูงสุด</h2><p class="muted">กดชื่อเพื่อดูโปรไฟล์และตัวชี้วัด</p>${hbars(o.agencies, a => a.amount, a => a.agency, compactBaht, a => openAttr('agency', a.agency))}</section>
   <section class="panel-card"><h2>ผู้รับจ้างที่มูลค่าสัญญาสูงสุด</h2><p class="muted">กดชื่อเพื่อดูโปรไฟล์</p>${hbars(o.companies, c => c.amount, c => c.name || c.winner, compactBaht, c => openAttr('company', c.winner))}</section>
  </div>
  <section class="panel-card ind">
   <h2>ตัวชี้วัดความเสี่ยงทั้งชุดข้อมูล</h2>
   <p class="caveat">ตัวชี้วัดเป็นสัญญาณให้ตรวจสอบต่อ ไม่ใช่หลักฐานการทุจริต จัดอันดับเฉพาะหน่วยงานที่มีสัญญาอย่างน้อย 50 รายการ</p>
   <div class="tabs" role="tablist">${Object.entries(IND).map(([k, v]) => `<button role="tab" data-itab="${k}" aria-selected="${D.tab === k}">${v.label}</button>`).join('')}</div>
   <div id="ind-table">${indicatorTable(D.tab)}</div>
  </section>
  <div id="profile-box"></div>
 </div>`;
 if (D.profile) renderProfile();
}
function indicatorTable(tab) {
 const rows = D.rows[tab];
 if (!rows) return '<div class="empty"><span class="spinner" style="display:inline-block"></span></div>';
 if (rows.error) return `<div class="err">${esc(rows.error)}</div>`;
 const why = `<p class="muted ind-why">${esc(IND[tab].why)}</p>`;
 const agencyCell = r => `<button class="linkish" ${openAttr('agency', r.agency)}>${esc(cut(r.agency, 60))}</button><small>${esc(cut(r.dept || '', 50))}</small>`;
 const bar = v => `<span class="mini"><span style="width:${Math.min(100, (v || 0) * 100)}%"></span></span>${pct(v)}`;
 const head = {
  concentration: ['หน่วยงาน', 'สัญญา', 'HHI', 'ผู้รับจ้างรายใหญ่สุด', 'สัดส่วน'],
  specific: ['หน่วยงาน', 'สัญญา', 'มูลค่า', 'สัดส่วนเฉพาะเจาะจง'],
  near_budget: ['หน่วยงาน', 'สัญญา', 'มูลค่า', 'สัญญา ≥ 99% ของวงเงิน'],
  single_bid: ['หน่วยงาน', 'โครงการที่มีข้อมูลผู้เสนอราคา', 'ผู้เสนอราคารายเดียว', 'อัตรา'],
  cobid: ['ผู้เสนอราคา A', 'ผู้เสนอราคา B', 'พบกัน (โครงการ)', 'ชนะ A / B', 'ผู้เกี่ยวข้องร่วม'],
 }[tab];
 const cell = {
  concentration: r => [agencyCell(r), fmt(r.n), fmt(Math.round(r.hhi * 10000)), esc(cut(r.top_name || r.top_winner || '', 40)), bar(r.top_share)],
  specific: r => [agencyCell(r), fmt(r.n), compactBaht(r.amount), bar(r.specific_share)],
  near_budget: r => [agencyCell(r), fmt(r.n), compactBaht(r.amount), bar(r.near_budget_share)],
  single_bid: r => [agencyCell(r), fmt(r.bid_projects), fmt(r.single), bar(r.single_bid_rate)],
  cobid: r => [pairCell(r.a_name, r.a_cid), pairCell(r.b_name, r.b_cid), fmt(r.shared), `${fmt(r.a_wins)} / ${fmt(r.b_wins)}`, r.shared_people ? `<span class="idpill low">${fmt(r.shared_people)} คน</span>` : '—'],
 }[tab];
 return why + `<div class="table-wrap"><table class="utable"><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead>
  <tbody>${rows.map(r => `<tr>${cell(r).map(c => `<td>${c}</td>`).join('')}</tr>`).join('') || '<tr><td colspan="5" class="muted">ไม่มีข้อมูล</td></tr>'}</tbody></table></div>`;
}
const pairCell = (name, cid) => cid ? `<button class="linkish" data-dash="graph" data-kind="company" data-key="${esc(cid)}">${esc(cut(name, 40))}</button><small>${esc(cid)}</small>` : `${esc(cut(name, 40))}<small>ยังไม่เชื่อมทะเบียน</small>`;
async function openProfile(kind, key) {
 if (S.panel !== 'dashboard') await showDashboard();
 D.profile = {kind, key, data: null}; renderProfile();
 try { D.profile.data = await api('/api/dashboard/' + kind, kind === 'agency' ? {name: key} : {cid: key}); }
 catch (e) { D.profile.error = e.message; }
 renderProfile();
}
function renderProfile() {
 const box = $('#profile-box'); if (!box || !D.profile) return;
 const {kind, key, data, error} = D.profile;
 const graphKind = kind === 'agency' ? 'agency' : /^\d{13}$/.test(key) ? 'company' : null;
 box.innerHTML = `<section class="panel-card profile" id="profile">
  <div class="row-end" style="justify-content:space-between"><div><span class="eyebrow">${kind === 'agency' ? 'โปรไฟล์หน่วยงาน' : 'โปรไฟล์ผู้รับจ้าง'}</span>
   <h2>${esc(kind === 'agency' ? (data?.stats?.agency || key) : data?.stats?.name || key)}</h2></div>
   <div class="row-end">${graphKind ? `<button class="btn sm primary" data-dash="graph" data-kind="${graphKind}" data-key="${esc(kind === 'agency' ? (data?.stats?.agency || key) : key)}">${icon('i-graph')}เปิดแผนผัง</button>` : ''}<button class="icon-btn" data-dash="close" aria-label="ปิด">${icon('i-x')}</button></div></div>
  ${data?.same_name?.length > 1 ? `<p class="caveat">${icon('i-info')} ชื่อนี้ใช้ร่วมกันหลายหน่วยงาน กำลังแสดงหน่วยงานที่มีสัญญามากที่สุด เลือกหน่วยงานอื่น: ${data.same_name.slice(1, 8).map(u => `<button class="linkish" ${openAttr('agency', u.agency)}>${esc(cut(u.dept || u.agency, 40))}</button>`).join(' · ')}</p>` : ''}
  ${error ? `<div class="err">${esc(error)}</div>` : !data ? '<div class="empty"><span class="spinner" style="display:inline-block"></span></div>' : `
  <div class="dash-grid">
   <div>${profileSummary(kind, data)}</div>
   <div><h3>รายปี</h3>${columns(data.years, y => y.amount, y => String(y.year), compactBaht)}</div>
   <div><h3>${kind === 'agency' ? 'ผู้รับจ้างรายใหญ่' : 'หน่วยงานผู้ว่าจ้างหลัก'}</h3>
    ${kind === 'agency' ? hbars(data.winners, w => w.amount, w => w.name || w.winner, compactBaht, w => openAttr('company', w.winner)) : hbars(data.agencies, a => a.amount, a => a.agency, compactBaht, a => openAttr('agency', a.agency))}</div>
   ${kind === 'company' && data.cobid.length ? `<div><h3>คู่ผู้เสนอราคาที่พบบ่อย</h3><div class="table-wrap"><table class="utable"><thead><tr><th>คู่</th><th>พบกัน</th><th>ผู้เกี่ยวข้องร่วม</th></tr></thead><tbody>
    ${data.cobid.map(c => { const other = c.a_cid === key ? [c.b_name, c.b_cid] : [c.a_name, c.a_cid]; return `<tr><td>${pairCell(...other)}</td><td>${fmt(c.shared)}</td><td>${c.shared_people ? `<span class="idpill low">${c.shared_people} คน</span>` : '—'}</td></tr>`; }).join('')}</tbody></table></div></div>` : ''}
  </div>`}</section>`;
 box.scrollIntoView({behavior: 'smooth', block: 'start'});
}
$('#dashboard').addEventListener('click', ev => {
 const t = ev.target.closest('[data-itab],[data-dash]'); if (!t) return;
 if (t.dataset.itab) return loadIndicator(t.dataset.itab);
 if (t.dataset.dash === 'profile') return openProfile(t.dataset.kind, t.dataset.key);
 if (t.dataset.dash === 'close') { D.profile = null; $('#profile-box').innerHTML = ''; return; }
 if (t.dataset.dash === 'graph') openGraph(t.dataset.kind, t.dataset.key);
});
$('#dashboard').addEventListener('pointerover', ev => { const t = ev.target.closest('[data-tip]'); if (t) { tip.innerHTML = `<div class="tt-s" style="color:var(--ink)">${esc(t.dataset.tip)}</div>`; tip.hidden = false; moveTip(ev); } });
$('#dashboard').addEventListener('pointermove', ev => { if (!tip.hidden) moveTip(ev); });
$('#dashboard').addEventListener('pointerout', ev => { if (ev.target.closest('[data-tip]') && !ev.relatedTarget?.closest?.('[data-tip]')) tip.hidden = true; });

window.__tor = S;

/* ───────────── accounts: sign in, register, profile ───────────── */
let authMode = 'login';
function showAuth(mode = 'login', message) {
 document.body.dataset.mode = 'auth'; $('#auth').hidden = false; $('#export-modal').hidden = true; tip.hidden = true;
 setAuthMode(mode);
 const err = $('#auth-err'); err.hidden = !message; err.textContent = message || '';
 const st = S.stats;
 $('#auth-stats').innerHTML = st ? [[st.contracts, 'ระเบียนสัญญา'], [st.companies, 'นิติบุคคล DBD'], [st.registry_roles, 'ผู้เกี่ยวข้อง']].map(([v, l]) => `<div><b>${fmt(v)}</b><span>${l}</span></div>`).join('') : '';
 drawAuthBg(); setTimeout(() => $('#auth-form [name=username]').focus(), 30);
}
function setAuthMode(mode) {
 authMode = mode; const reg = mode === 'register';
 $$('[data-auth]').forEach(b => b.setAttribute('aria-selected', b.dataset.auth === mode));
 $('#f-name').hidden = !reg; $('#f-confirm').hidden = !reg;
 $('#auth-title').textContent = reg ? 'สร้างบัญชีใหม่' : 'ยินดีต้อนรับกลับ';
 $('#auth-sub').textContent = reg ? 'สมัครเพื่อดูข้อมูล รายละเอียด แผนผัง และหลักฐานต้นทาง' : 'เข้าสู่ระบบเพื่อสำรวจข้อมูลและแผนผังความสัมพันธ์';
 $('#auth-submit').textContent = reg ? 'สมัครสมาชิก' : 'เข้าสู่ระบบ';
 $('#auth-form [name=password]').autocomplete = reg ? 'new-password' : 'current-password';
 $('#auth-err').hidden = true;
}
$$('[data-auth]').forEach(b => b.onclick = () => setAuthMode(b.dataset.auth));
$('#auth-form').onsubmit = async ev => {
 ev.preventDefault();
 const f = Object.fromEntries(new FormData(ev.target)), err = $('#auth-err'), btn = $('#auth-submit');
 const fail = m => { err.textContent = m; err.hidden = false; };
 if (authMode === 'register') {
  if (!tidy(f.name)) return fail('กรอกชื่อที่แสดง');
  if ((f.password || '').length < 8) return fail('รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร');
  if (f.password !== f.confirm) return fail('รหัสผ่านยืนยันไม่ตรงกัน');
 }
 btn.disabled = true; err.hidden = true;
 try {
  const r = await post('/api/auth/' + authMode, {username: f.username, password: f.password, name: f.name});
  ev.target.reset(); await enterApp(r.user);
  toast(authMode === 'register' ? `สร้างบัญชี ${r.user.username} แล้ว` : `ยินดีต้อนรับ ${r.user.name}`);
 } catch (e) { fail(e.message); } finally { btn.disabled = false; }
};
function drawAuthBg() {
 const c = $('#auth-bg'); const W = c.clientWidth, H = c.clientHeight, d = devicePixelRatio || 1; if (!W) return;
 c.width = W * d; c.height = H * d; const x = c.getContext('2d'); x.scale(d, d);
 // Low-discrepancy spread (golden-ratio steps) so the decoration fills the panel evenly.
 const pts = Array.from({length: 34}, (_, i) => ({x: ((i * .618034 + .13) % 1) * W, y: ((i * .7548777 + .41) % 1) * H, r: 2 + ((i * .5698403) % 1) * 6}));
 x.strokeStyle = 'rgba(47,107,255,.16)';
 pts.forEach((p, i) => { const q = pts[(i * 7 + 3) % pts.length]; if (Math.hypot(p.x - q.x, p.y - q.y) < W * .35) { x.beginPath(); x.moveTo(p.x, p.y); x.quadraticCurveTo((p.x + q.x) / 2 + 40, (p.y + q.y) / 2 - 30, q.x, q.y); x.stroke(); } });
 pts.forEach((p, i) => { x.beginPath(); x.arc(p.x, p.y, p.r, 0, 7); x.strokeStyle = i % 5 ? 'rgba(47,107,255,.35)' : 'rgba(60,70,87,.5)'; x.lineWidth = 1.4; x.stroke(); });
}
async function enterApp(user) {
 S.user = user; $('#auth').hidden = true; S.publicMode = false;
 if (user.must_change) return forcePasswordChange();
 const initials = tidy(user.name).split(' ').map(w => w[0]).join('').slice(0, 2) || user.username[0];
 $('#me').hidden = false; $('#me-avatar').textContent = initials.toUpperCase();
 $('#me-name').textContent = user.name; $('#me-name').title = user.name; $('#me-role').textContent = user.role_label + ' · @' + user.username;
 const admin = can('users.manage') || can('roles.manage');
 $('#nav-admin').hidden = !admin; $('#admin-label').hidden = !admin;
 $('#open-export').hidden = $('#export-json').hidden = !can('data.export');
 loadCaseBadge();
 await loadReviews(); renderHome(); drawHomeBg();
 if (!readHash()) showHome();
}
$('#me-logout').onclick = async () => {
 try { await post('/api/auth/logout', {}); } catch {}
 S.user = null; S.reviews = {}; S.graph = null; $('#me').hidden = true; history.replaceState(null, '', location.pathname);
 showAuth('login'); toast('ออกจากระบบแล้ว');
};
$('#me-password').onclick = () => { $('#pw-modal').hidden = false; $('#pw-err').hidden = true; $('#pw-form').reset(); $('#pw-form [name=current]').focus(); };
$('#pw-cancel').onclick = () => { if (!S.user?.must_change) $('#pw-modal').hidden = true; };
$('#pw-form').onsubmit = async ev => {
 ev.preventDefault(); const f = Object.fromEntries(new FormData(ev.target)), err = $('#pw-err');
 if (f.new !== f.confirm) { err.textContent = 'รหัสผ่านใหม่ยืนยันไม่ตรงกัน'; err.hidden = false; return; }
 try {
  await post('/api/auth/password', {current: f.current, new: f.new}); $('#pw-modal').hidden = true; toast('เปลี่ยนรหัสผ่านแล้ว');
  if (S.user?.must_change) { const me = await api('/api/auth/me'); $('#pw-cancel').hidden = false; await enterApp(me.user); }
 }
 catch (e) { err.textContent = e.message; err.hidden = false; }
};

/* ───────────── admin: users, roles, audit ───────────── */
const A = {tab: 'users', users: [], roles: [], catalog: {}, audit: [], resetFor: null, busy: false};
const AUDIT_LABEL = {
 bootstrap_admin: 'สร้างผู้ดูแลคนแรก', register: 'สมัครสมาชิก', login: 'เข้าสู่ระบบ', change_password: 'เปลี่ยนรหัสผ่าน',
 create_user: 'สร้างผู้ใช้', update_user: 'แก้ไขผู้ใช้', save_role: 'บันทึกบทบาท', delete_role: 'ลบบทบาท', review: 'ตรวจทานข้อมูล',
};
async function showAdmin() {
 if (!(can('users.manage') || can('roles.manage'))) return toast('บทบาทของคุณไม่มีสิทธิ์จัดการผู้ใช้');
 only('admin');
 document.body.dataset.mode = 'admin'; S.panel = 'admin'; setNav();
 if (!can('users.manage') && A.tab === 'users') A.tab = 'roles';
 await loadAdmin(); renderAdmin();
}
async function loadAdmin() {
 try {
  const [u, r, a] = await Promise.all([
   can('users.manage') ? api('/api/admin/users') : null,
   api('/api/admin/roles'), api('/api/admin/audit')]);
  if (u) A.users = u.users; A.roles = r.roles; A.catalog = r.catalog; A.audit = a.items;
 } catch (e) { toast(e.message); }
}
const roleOptions = sel => A.roles.map(r => `<option value="${esc(r.name)}" ${r.name === sel ? 'selected' : ''}>${esc(r.label)} (${esc(r.name)})</option>`).join('');
const when = v => v ? new Date(v).toLocaleString('th-TH', {dateStyle: 'medium', timeStyle: 'short'}) : '—';
function renderAdmin() {
 const tabs = [can('users.manage') && ['users', 'ผู้ใช้', A.users.length], can('roles.manage') && ['roles', 'บทบาทและสิทธิ์', A.roles.length], ['audit', 'ประวัติการทำงาน', A.audit.length]].filter(Boolean);
 $('#admin').innerHTML = `<div class="admin-inner">
  <div class="admin-head"><div><span class="eyebrow">Administration</span><h1 id="admin-title">ผู้ใช้และบทบาท</h1>
   <p class="muted">กำหนดว่าใครดูข้อมูลได้ ใครส่งออกได้ และใครยืนยันข้อมูลก่อนเผยแพร่ได้ ทุกการเปลี่ยนแปลงถูกบันทึกในประวัติการทำงาน</p></div></div>
  <div class="tabs" role="tablist">${tabs.map(([k, l, n]) => `<button role="tab" data-atab="${k}" aria-selected="${A.tab === k}">${l}<span>${n}</span></button>`).join('')}</div>
  ${A.tab === 'users' ? usersHTML() : A.tab === 'roles' ? rolesHTML() : auditHTML()}
 </div>`;
}
function usersHTML() {
 return `<form class="admin-form" id="new-user">
   <h3>${icon('i-user')}เพิ่มผู้ใช้</h3>
   <label class="field">ชื่อผู้ใช้<input name="username" required maxlength="32" placeholder="a-z 0-9 _ . -" autocapitalize="off"></label>
   <label class="field">ชื่อที่แสดง<input name="name" required maxlength="80"></label>
   <label class="field">รหัสผ่านเริ่มต้น<input name="password" type="password" required minlength="8" autocomplete="new-password"></label>
   <label class="field">บทบาท<select name="role">${roleOptions('user')}</select></label>
   <button class="btn primary" type="submit">${icon('i-plus')}สร้างผู้ใช้</button>
  </form>
  <div class="table-wrap"><table class="utable">
   <thead><tr><th>ผู้ใช้</th><th>บทบาท</th><th>สถานะ</th><th>เข้าสู่ระบบล่าสุด</th><th>สร้างเมื่อ</th><th></th></tr></thead>
   <tbody>${A.users.map(u => `<tr data-uid="${u.id}">
    <td><div class="who"><span class="me-avatar sm">${esc((tidy(u.name)[0] || u.username[0]).toUpperCase())}</span><span><b>${esc(u.name)}</b>${u.id === S.user.id ? ' <span class="idpill">คุณ</span>' : ''}<small>@${esc(u.username)}</small></span></div></td>
    <td><select data-field="role" aria-label="บทบาทของ ${esc(u.username)}">${roleOptions(u.role)}</select></td>
    <td><label class="switch"><input type="checkbox" data-field="active" ${u.active ? 'checked' : ''}><span>${u.active ? 'ใช้งาน' : 'ระงับ'}</span></label></td>
    <td class="muted">${when(u.last_login)}</td><td class="muted">${when(u.created_at)}</td>
    <td>${A.resetFor === u.id ? `<form class="inline-reset" data-reset="${u.id}"><input type="password" name="password" minlength="8" required placeholder="รหัสผ่านใหม่" autocomplete="new-password"><button class="btn sm primary">บันทึก</button><button type="button" class="btn sm" data-cancel-reset>ยกเลิก</button></form>`
      : `<button class="btn sm" data-reset-open="${u.id}">${icon('i-key')}ตั้งรหัสผ่านใหม่</button>`}</td></tr>`).join('')}</tbody>
  </table></div>`;
}
function permChecks(perms, locked) {
 return Object.entries(A.catalog).map(([k, label]) => `<label class="perm"><input type="checkbox" name="perm" value="${k}" ${perms.includes(k) ? 'checked' : ''} ${locked ? 'disabled' : ''}><span><b>${esc(label)}</b><code>${k}</code></span></label>`).join('');
}
function rolesHTML() {
 return `<div class="roles">${A.roles.map(r => `<form class="role-card" data-role="${esc(r.name)}">
   <div class="role-top"><input name="label" value="${esc(r.label)}" maxlength="80" aria-label="ชื่อบทบาท"><code>${esc(r.name)}</code>${r.builtin ? '<span class="idpill">พื้นฐาน</span>' : ''}<span class="muted">${r.users} ผู้ใช้</span></div>
   <div class="perms">${permChecks(r.permissions, r.name === 'admin')}</div>
   ${r.name === 'admin' ? '<p class="caveat">บทบาทผู้ดูแลระบบมีทุกสิทธิ์เสมอ เพื่อไม่ให้ระบบถูกล็อก</p>' : ''}
   <div class="row-end">${!r.builtin ? `<button type="button" class="btn sm" data-del-role="${esc(r.name)}" ${r.users ? 'disabled title="ย้ายผู้ใช้ออกก่อนลบ"' : ''}>${icon('i-x')}ลบ</button>` : ''}<button class="btn sm primary">บันทึก</button></div>
  </form>`).join('')}
  <form class="role-card new" id="new-role">
   <h3>${icon('i-plus')}สร้างบทบาทใหม่</h3>
   <div class="role-top"><input name="label" required maxlength="80" placeholder="ชื่อบทบาท เช่น ผู้ตรวจทาน"><input name="name" required maxlength="32" placeholder="รหัส เช่น reviewer" autocapitalize="off"></div>
   <div class="perms">${permChecks(['data.view'], false)}</div>
   <div class="row-end"><button class="btn sm primary">สร้างบทบาท</button></div>
  </form></div>`;
}
function auditHTML() {
 if (!A.audit.length) return '<div class="empty"><strong>ยังไม่มีประวัติ</strong></div>';
 return `<div class="table-wrap"><table class="utable audit"><thead><tr><th>เวลา</th><th>ผู้ทำรายการ</th><th>รายการ</th><th>รายละเอียด</th></tr></thead><tbody>
  ${A.audit.map(a => `<tr><td class="muted">${when(a.at)}</td><td>${esc(a.name || '—')}${a.username ? `<small> @${esc(a.username)}</small>` : ''}</td><td>${esc(AUDIT_LABEL[a.action] || a.action)}</td>
   <td class="mono">${esc(Object.entries(a.detail || {}).map(([k, v]) => k + ': ' + (Array.isArray(v) ? v.join(', ') : v)).join(' · '))}</td></tr>`).join('')}
 </tbody></table></div>`;
}
async function adminCall(fn, ok) {
 if (A.busy) return; A.busy = true;
 try { await fn(); if (ok) toast(ok); } catch (e) { toast(e.message); }
 A.busy = false; await loadAdmin(); renderAdmin();
}
$('#admin').addEventListener('click', ev => {
 const t = ev.target.closest('[data-atab],[data-reset-open],[data-cancel-reset],[data-del-role]'); if (!t) return;
 if (t.dataset.atab) { A.tab = t.dataset.atab; renderAdmin(); return; }
 if (t.dataset.resetOpen) { A.resetFor = +t.dataset.resetOpen; renderAdmin(); $('.inline-reset input')?.focus(); return; }
 if (t.hasAttribute('data-cancel-reset')) { A.resetFor = null; renderAdmin(); return; }
 if (t.dataset.delRole) adminCall(() => post('/api/admin/roles/delete', {name: t.dataset.delRole}), 'ลบบทบาทแล้ว');
});
$('#admin').addEventListener('change', ev => {
 const tr = ev.target.closest('tr[data-uid]'), field = ev.target.dataset.field; if (!tr || !field) return;
 const id = +tr.dataset.uid, value = field === 'active' ? ev.target.checked : ev.target.value;
 adminCall(async () => {
  const u = await post('/api/admin/users/update', {id, [field]: value});
  if (u.id === S.user.id) await enterApp({...S.user, ...u}).then(() => showAdmin());
 }, field === 'active' ? (value ? 'เปิดใช้งานบัญชีแล้ว' : 'ระงับบัญชีแล้ว') : 'เปลี่ยนบทบาทแล้ว');
});
$('#admin').addEventListener('submit', ev => {
 ev.preventDefault(); const f = ev.target, data = Object.fromEntries(new FormData(f));
 const perms = $$('input[name=perm]:checked', f).map(i => i.value);
 if (f.id === 'new-user') return adminCall(() => post('/api/admin/users/create', data), `สร้างผู้ใช้ ${data.username} แล้ว`);
 if (f.dataset.reset) return adminCall(async () => { await post('/api/admin/users/update', {id: +f.dataset.reset, password: data.password}); A.resetFor = null; }, 'ตั้งรหัสผ่านใหม่แล้ว ผู้ใช้ต้องเข้าสู่ระบบใหม่');
 if (f.id === 'new-role') return adminCall(() => post('/api/admin/roles/save', {name: data.name, label: data.label, permissions: perms}), `สร้างบทบาท ${data.label} แล้ว`);
 if (f.dataset.role) return adminCall(() => post('/api/admin/roles/save', {name: f.dataset.role, label: data.label, permissions: perms}), 'บันทึกบทบาทแล้ว');
});

(async () => {
 await probe();
 if (!S.api) { $('#save-case').hidden = true; renderHome(); drawHomeBg(); if (!readHash()) showHome(); return; }
 try { const me = await api('/api/auth/me'); S.user = me.user; } catch {}
 if (publicRoute()) return;
 if (S.user) await enterApp(S.user); else showAuth('login');
})();
})();
