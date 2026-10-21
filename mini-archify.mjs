#!/usr/bin/env node
/**
 * mini-archify — 独立数据流图渲染器（零依赖，不需要 Archify）
 * 用法: node mini-archify.mjs <candidate.json> [输出.html]
 *
 * 输入: dataflow candidate（schema_version 1, diagram_type "dataflow"）
 *       字段与 Archify dataflow schema 的常用子集对齐
 * 输出: 自包含 HTML（内联 SVG，明/暗主题切换）
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

// ---------- 布局常量（对齐 Archify dataflow 布局预算） ----------
const STAGE_X0 = 100;                        // 舞台中心 x = 100 + stage*215
const STAGE_GAP = 215, STAGE_W = 168;        // 舞台带宽 168
const ROW_TOPS = [128, 242, 356, 470, 584];  // 行顶 y（row 0-4）
const NODE_H = 58, NODE_MIN_W = 112, NODE_MAX_W = 160;
const AREA_TOP = 104;                        // 节点允许的最高 y
const LEGEND_RESERVE = 74, PAD_BOTTOM = 24;
const MIN_FLOW_LEN = 34;

const NODE_TYPES = new Set(['frontend', 'backend', 'database', 'cloud', 'security', 'messagebus', 'external']);
const FLOW_VARIANTS = new Set(['default', 'emphasis', 'security', 'dashed']);
const DOT_COLORS = { cyan: '#22d3ee', emerald: '#34d399', violet: '#a78bfa', amber: '#fbbf24', rose: '#fb7185', orange: '#fb923c', slate: '#94a3b8' };
const LEGEND_ZH = { default: '数据流', emphasis: '主路径', security: '安全 / 隐私', dashed: '异步 / 批处理', database: '数据库' };
const LEGEND_EN = { default: 'Data flow', emphasis: 'Primary path', security: 'Security / PII', dashed: 'Async / batch', database: 'Database' };

// ---------- CLI ----------
const [input, outputArg] = process.argv.slice(2);
if (!input) {
  console.error('用法: node mini-archify.mjs <candidate.json> [输出.html]');
  process.exit(1);
}
const inputPath = resolve(input);
let c;
try {
  c = JSON.parse(readFileSync(inputPath, 'utf8'));
} catch (e) {
  console.error(`❌ 无法解析 JSON: ${e.message}`);
  process.exit(1);
}

const errors = [], warnings = [];
const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);
const r1 = (n) => Math.round(n * 10) / 10;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---------- 基础校验 ----------
const meta = c.meta || {};
const stages = Array.isArray(c.stages) ? c.stages : [];
const nodes = Array.isArray(c.nodes) ? c.nodes : [];
const flows = Array.isArray(c.flows) ? c.flows : [];

if (c.schema_version !== 1) err('schema: schema_version 必须为 1');
if (c.diagram_type !== 'dataflow') err('schema: diagram_type 必须为 "dataflow"');
if (!meta.title) err('meta: 缺少 title');
if (stages.length < 2 || stages.length > 5) err('stages: 需要 2-5 个舞台');
stages.forEach((s, i) => { if (!s || !s.label) err(`stages[${i}]: 缺少 label`); });

const ID_RE = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
const byId = new Map();
nodes.forEach((n, i) => {
  const p = `nodes[${i}]`;
  if (!n) return err(`${p}: 节点为空`);
  if (!n.id || !ID_RE.test(n.id)) return err(`${p}: 缺少合法 id（字母开头，仅字母数字_-）`);
  if (byId.has(n.id)) return err(`${p}: id "${n.id}" 重复`);
  if (!NODE_TYPES.has(n.type)) err(`${p}(${n.id}): type 必须是 ${[...NODE_TYPES].join('/')}`);
  if (!n.label) err(`${p}(${n.id}): 缺少 label`);
  if (!Number.isInteger(n.stage) || n.stage < 0 || n.stage >= stages.length)
    err(`${p}(${n.id}): stage 必须是 0-${stages.length - 1} 的整数`);
  if (!Number.isInteger(n.row) || n.row < 0 || n.row > 4)
    err(`${p}(${n.id}): row 必须是 0-4 的整数`);
  byId.set(n.id, n);
});
if (nodes.length < 2) err('nodes: 至少需要 2 个节点');

flows.forEach((f, i) => {
  const p = `flows[${i}]`;
  if (!f) return err(`${p}: 流为空`);
  if (!byId.has(f.from)) err(`${p}: 起点 "${f.from}" 不存在`);
  if (!byId.has(f.to)) err(`${p}: 终点 "${f.to}" 不存在`);
  if (f.from === f.to) err(`${p}: from/to 不能相同`);
  if (!f.label) err(`${p}(${f.from}→${f.to}): 缺少 label`);
  if (f.variant && !FLOW_VARIANTS.has(f.variant)) err(`${p}: variant 必须是 ${[...FLOW_VARIANTS].join('/')}`);
});
if (errors.length) {
  console.error('❌ 校验失败:');
  for (const m of errors) console.error('  -', m);
  process.exit(1);
}

// ---------- 布局 ----------
// CJK 全角字符按 2 个单位计宽
const tw = (s, fs) => [...String(s)].reduce((w, ch) => w + (ch.codePointAt(0) >= 0x2e80 ? fs : fs * 0.55), 0);

for (const n of nodes) {
  n._w = n.width ? n.width : clamp(Math.ceil(Math.max(tw(n.label, 13), tw(n.sublabel || '', 10.5), n.tag ? tw(n.tag, 9) + 16 : 0)) + 30, NODE_MIN_W, NODE_MAX_W);
  n._h = n.height || NODE_H;
  n._x = STAGE_X0 + n.stage * STAGE_GAP - n._w / 2;
  n._y = ROW_TOPS[n.row] + (n.yOffset || 0);
}

// 节点重叠检查
for (let i = 0; i < nodes.length; i++) {
  for (let j = i + 1; j < nodes.length; j++) {
    const a = nodes[i], b = nodes[j];
    const overlap = Math.abs(a._x - b._x) * 2 < a._w + b._w && Math.abs(a._y - b._y) * 2 < a._h + b._h;
    if (overlap) err(`dataflow/node-overlap: "${a.id}" 与 "${b.id}" 重叠 —— 同列节点加 yOffset，或分到不同 row`);
  }
}

// 画布尺寸（未指定 viewBox 时自动适配）
let W = meta.viewBox?.[0] || Math.max(480, 208 + (stages.length - 1) * STAGE_GAP);
let H = meta.viewBox?.[1];
const contentBottom = Math.max(...nodes.map(n => n._y + n._h));
if (!H) H = Math.max(720, contentBottom + LEGEND_RESERVE + PAD_BOTTOM);

for (const n of nodes) {
  if (n._y < AREA_TOP) err(`dataflow/node-above-area: "${n.id}" 超出顶部可读区域（y=${r1(n._y)} < ${AREA_TOP}）`);
  if (n._y + n._h > H - LEGEND_RESERVE)
    err(`dataflow/node-below-area: "${n.id}" 超出底部区域 —— 需要 meta.viewBox[1] >= ${Math.ceil(n._y + n._h + LEGEND_RESERVE + PAD_BOTTOM)}`);
  if (n._x < 24 || n._x + n._w > W - 24)
    err(`dataflow/node-outside-x: "${n.id}" 超出左右边距 —— 需要 meta.viewBox[0] >= ${Math.ceil(n._x + n._w + 24)}`);
}

// ---------- 流的端口与路由 ----------
const vertical = (s) => s === 'top' || s === 'bottom';
function autoSides(f, A, B) {
  if (A.stage === B.stage) return A.row <= B.row ? ['bottom', 'top'] : ['top', 'bottom'];
  return B.stage > A.stage ? ['right', 'left'] : ['left', 'right'];
}
function port(n, side, off) {
  switch (side) {
    case 'left': return [n._x, n._y + n._h / 2 + off];
    case 'right': return [n._x + n._w, n._y + n._h / 2 + off];
    case 'top': return [n._x + n._w / 2 + off, n._y];
    default: return [n._x + n._w / 2 + off, n._y + n._h];
  }
}
// 同一节点同一边的多条流按 16px 间距展开端口
for (const f of flows) {
  const auto = autoSides(f, byId.get(f.from), byId.get(f.to));
  f._sa = f.fromSide || auto[0];
  f._sb = f.toSide || auto[1];
}
const groupKey = (id, side) => `${id}|${side}`;
const mapA = new Map(), mapB = new Map();
for (const f of flows) {
  const ka = groupKey(f.from, f._sa), kb = groupKey(f.to, f._sb);
  if (!mapA.has(ka)) mapA.set(ka, []);
  if (!mapB.has(kb)) mapB.set(kb, []);
  mapA.get(ka).push(f);
  mapB.get(kb).push(f);
}
function portOffset(map, which, f) {
  const id = which === 'a' ? f.from : f.to;
  const side = which === 'a' ? f._sa : f._sb;
  const list = map.get(groupKey(id, side));
  const node = byId.get(id);
  const span = vertical(side) ? node._w : node._h;
  const i = list.indexOf(f);
  const off = (i - (list.length - 1) / 2) * 16;
  return clamp(off, -span * 0.38, span * 0.38);
}
function buildPoints(f, A, B, pa, pb) {
  if (Array.isArray(f.via) && f.via.length) return [pa, ...f.via.map(p => [p[0], p[1]]), pb];
  if (f.route === 'straight') return [pa, pb];
  if (vertical(f._sa) && vertical(f._sb)) {
    if (Math.abs(pa[0] - pb[0]) < 0.5) return [pa, pb];
    const mx = (pa[0] + pb[0]) / 2;
    return [pa, [mx, pa[1]], [mx, pb[1]], pb];
  }
  if (!vertical(f._sa) && !vertical(f._sb)) {
    if (Math.abs(pa[1] - pb[1]) < 0.5) return [pa, pb];
    const mx = (pa[0] + pb[0]) / 2;
    return [pa, [mx, pa[1]], [mx, pb[1]], pb];
  }
  return vertical(f._sa) ? [pa, [pa[0], pb[1]], pb] : [pa, [pb[0], pa[1]], pb];
}
function simplify(pts) {
  const out = [];
  for (const p of pts) {
    const n = out.length;
    if (n && Math.abs(out[n - 1][0] - p[0]) < 0.5 && Math.abs(out[n - 1][1] - p[1]) < 0.5) continue;
    out.push(p);
  }
  const r = [];
  for (let i = 0; i < out.length; i++) {
    if (i > 0 && i < out.length - 1) {
      const a = r[r.length - 1], b = out[i], c2 = out[i + 1];
      const cross = (b[0] - a[0]) * (c2[1] - a[1]) - (b[1] - a[1]) * (c2[0] - a[0]);
      if (Math.abs(cross) < 0.5) continue;
    }
    r.push(out[i]);
  }
  return r;
}
for (const f of flows) {
  const A = byId.get(f.from), B = byId.get(f.to);
  const pa = port(A, f._sa, portOffset(mapA, 'a', f));
  const pb = port(B, f._sb, portOffset(mapB, 'b', f));
  if (Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) < MIN_FLOW_LEN)
    warn(`dataflow/short-flow: ${f.from}→${f.to} 端点距离 < ${MIN_FLOW_LEN}px，连线可能难以阅读`);
  f._pts = simplify(buildPoints(f, A, B, pa, pb));
}
function polyMid(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (acc + seg >= L / 2 && seg > 0) {
      const t = (L / 2 - acc) / seg;
      return {
        x: pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t,
        y: pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t,
        horiz: Math.abs(pts[i][1] - pts[i - 1][1]) < Math.abs(pts[i][0] - pts[i - 1][0]),
      };
    }
    acc += seg;
  }
  const last = pts[pts.length - 1];
  return { x: last[0], y: last[1], horiz: true };
}

// ---------- SVG 片段 ----------
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const zh = String(meta.locale || '').startsWith('zh');

let svg = '';
// 舞台框
stages.forEach((s, i) => {
  const cx = STAGE_X0 + i * STAGE_GAP;
  svg += `<rect class="stage" x="${cx - STAGE_W / 2}" y="36" width="${STAGE_W}" height="${r1(H - LEGEND_RESERVE - 36)}" rx="14"/>`;
  svg += `<text class="stage-label" x="${cx}" y="62">${esc(s.label)}</text>`;
});
// 节点
for (const n of nodes) {
  svg += `<g class="node t-${n.type}">`;
  svg += `<rect class="node-box" x="${r1(n._x)}" y="${r1(n._y)}" width="${n._w}" height="${n._h}" rx="10"/>`;
  if (n.tag) {
    const pw = Math.ceil(tw(n.tag, 9)) + 14;
    const px = n._x + n._w - pw - 6, py = n._y - 8;
    svg += `<rect class="tag-pill" x="${r1(px)}" y="${r1(py)}" width="${pw}" height="16" rx="8"/>`;
    svg += `<text class="tag-text" x="${r1(px + pw / 2)}" y="${r1(py + 11.5)}">${esc(n.tag)}</text>`;
  }
  const mid = n._y + n._h / 2;
  if (n.sublabel) {
    svg += `<text class="node-label" x="${r1(n._x + n._w / 2)}" y="${r1(mid - 3)}">${esc(n.label)}</text>`;
    svg += `<text class="node-sub" x="${r1(n._x + n._w / 2)}" y="${r1(mid + 14)}">${esc(n.sublabel)}</text>`;
  } else {
    svg += `<text class="node-label" x="${r1(n._x + n._w / 2)}" y="${r1(mid + 4.5)}">${esc(n.label)}</text>`;
  }
  svg += `</g>`;
}
// 流
for (const f of flows) {
  const cls = f.variant && f.variant !== 'default' ? ` flow-${f.variant}` : '';
  const sw = f.width ? ` stroke-width="${f.width}"` : '';
  svg += `<path class="flow${cls}" marker-end="url(#mk-${f.variant || 'default'})"${sw} d="${f._pts.map((p, i) => (i ? 'L' : 'M') + r1(p[0]) + ' ' + r1(p[1])).join(' ')}"/>`;
}
// 流标签
for (const f of flows) {
  const hasCls = typeof f.classification === 'string' && f.classification.length;
  const w = Math.ceil(Math.max(tw(f.label, 11.5), hasCls ? tw(f.classification, 9.5) : 0)) + 14;
  const h = hasCls ? 30 : 17;
  let cx, cy;
  if (Array.isArray(f.labelAt)) { cx = f.labelAt[0]; cy = f.labelAt[1]; }
  else {
    const m = polyMid(f._pts);
    if (m.horiz) { cx = m.x; cy = m.y - h / 2 - 5; }
    else { cx = m.x + w / 2 + 7; cy = m.y; }
  }
  const x = clamp(cx - w / 2, 6, Math.max(6, W - w - 6));
  const y = clamp(cy - h / 2, 6, H - h - 6);
  svg += `<g><rect class="plate" x="${r1(x)}" y="${r1(y)}" width="${w}" height="${h}" rx="4"/>`;
  if (hasCls) {
    svg += `<text class="flow-label" x="${r1(x + w / 2)}" y="${r1(y + 13)}">${esc(f.label)}</text>`;
    svg += `<text class="flow-class" x="${r1(x + w / 2)}" y="${r1(y + 25.5)}">${esc(f.classification)}</text>`;
  } else {
    svg += `<text class="flow-label" x="${r1(x + w / 2)}" y="${r1(y + h / 2 + 4)}">${esc(f.label)}</text>`;
  }
  svg += `</g>`;
}
// 图例
if ((meta.legend?.mode || 'auto') !== 'hidden') {
  const hasDB = nodes.some(n => n.type === 'database');
  const L = zh ? LEGEND_ZH : LEGEND_EN;
  const entries = [];
  for (const key of ['emphasis', 'security', 'dashed', 'database', 'default']) {
    if (key === 'database' && !hasDB && meta.legend?.mode !== 'all') continue;
    const conf = meta.legend?.entries?.[key];
    if (conf?.visible === false) continue;
    entries.push({ key, label: conf?.label || L[key] });
  }
  const total = entries.reduce((s, e) => s + 22 + 6 + tw(e.label, 11) + 26, -26);
  let lx = clamp((W - total) / 2, 24, W - 24);
  const ly = H - 30;
  svg += `<g>`;
  for (const e of entries) {
    if (e.key === 'database') {
      svg += `<rect class="legend-db" x="${r1(lx)}" y="${ly - 9}" width="22" height="14" rx="4"/>`;
    } else {
      svg += `<path class="flow legend-flow legend-${e.key}" marker-end="url(#mk-${e.key})" d="M${r1(lx)} ${ly} H${r1(lx + 18)}"/>`;
    }
    svg += `<text class="legend-text" x="${r1(lx + 28)}" y="${r1(ly + 4)}">${esc(e.label)}</text>`;
    lx += 22 + 6 + tw(e.label, 11) + 26;
  }
  svg += `</g>`;
}

const defs = ['default', 'emphasis', 'security', 'dashed'].map(v => `
  <marker id="mk-${v}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
    <path class="mk-${v}" d="M0 0 L10 5 L0 10 z"/>
  </marker>`).join('');

// ---------- HTML ----------
const lang = meta.locale || 'en';
const cards = (c.cards || []).map(card => `
    <section class="card">
      <h3><span class="dot" style="--dot:${DOT_COLORS[card.dot] || DOT_COLORS.slate}"></span>${esc(card.title)}</h3>
      <ul>${(card.items || []).map(i => `<li>${esc(i)}</li>`).join('')}</ul>
    </section>`).join('');

const html = `<!DOCTYPE html>
<html lang="${esc(lang)}" data-theme="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="dark light">
<meta name="generator" content="mini-archify (standalone dataflow)">
<title>${esc(meta.title)} — Data Flow</title>
<script>(function(){try{var t=null;try{t=new URLSearchParams(location.search).get('theme')}catch(_){}if(t!=='light'&&t!=='dark'){try{t=localStorage.getItem('mini-archify-theme')}catch(_){}}if(t!=='light'&&t!=='dark'){t=matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'}document.documentElement.setAttribute('data-theme',t)}catch(_){}})();</script>
<style>
:root{--bg:#020617;--grid:#1e293b;--canvas-dot:rgba(148,163,184,0.16);--text:#ffffff;--text-muted:#94a3b8;--text-dim:#475569;--panel:rgba(15,23,42,0.5);--panel-border:#1e293b;--lane-fill:rgba(15,23,42,0.22);--lane-stroke:#334155;--arrow:#94a3b8;--arrow-emphasis:#34d399;--mask:#0f172a;--toolbar-bg:rgba(15,23,42,0.8);--toolbar-border:#334155;--toolbar-text:#e2e8f0;
--frontend-fill:rgba(8,51,68,0.4);--frontend-stroke:#22d3ee;--backend-fill:rgba(6,78,59,0.4);--backend-stroke:#34d399;--database-fill:rgba(76,29,149,0.4);--database-stroke:#a78bfa;--cloud-fill:rgba(120,53,15,0.3);--cloud-stroke:#fbbf24;--security-fill:rgba(136,19,55,0.4);--security-stroke:#fb7185;--messagebus-fill:rgba(251,146,60,0.3);--messagebus-stroke:#fb923c;--external-fill:rgba(30,41,59,0.5);--external-stroke:#94a3b8;}
[data-theme="light"]{--bg:#f4f5f7;--grid:#e9edf2;--canvas-dot:#e2e7ec;--text:#111827;--text-muted:#5b6474;--text-dim:#9aa3b2;--panel:#ffffff;--panel-border:#e5e7eb;--lane-fill:rgba(248,250,252,0.65);--lane-stroke:#cbd5e1;--arrow:#64748b;--arrow-emphasis:#059669;--mask:#ffffff;--toolbar-bg:rgba(255,255,255,0.92);--toolbar-border:#cbd5e1;--toolbar-text:#334155;
--frontend-fill:rgba(34,211,238,0.15);--frontend-stroke:#0891b2;--backend-fill:rgba(52,211,153,0.18);--backend-stroke:#059669;--database-fill:rgba(167,139,250,0.2);--database-stroke:#7c3aed;--cloud-fill:rgba(251,191,36,0.18);--cloud-stroke:#d97706;--security-fill:rgba(251,113,133,0.15);--security-stroke:#e11d48;--messagebus-fill:rgba(251,146,60,0.15);--messagebus-stroke:#ea580c;--external-fill:rgba(148,163,184,0.18);--external-stroke:#64748b;}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 -apple-system,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif}
.page{max-width:1240px;margin:0 auto;padding:2rem 1.25rem 3rem}
header{display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;margin-bottom:1.25rem}
h1{margin:0;font:600 17px/1.3 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.sub{margin:.35rem 0 0;color:var(--text-muted);font-size:13px}
#theme-toggle{border:1px solid var(--toolbar-border);background:var(--toolbar-bg);color:var(--toolbar-text);border-radius:8px;padding:6px 12px;font-size:13px;cursor:pointer}
.canvas{background:var(--panel);border:1px solid var(--panel-border);border-radius:16px;padding:8px;background-image:radial-gradient(var(--canvas-dot) 1px,transparent 1px);background-size:22px 22px}
svg{width:100%;height:auto;display:block}
.stage{fill:var(--lane-fill);stroke:var(--lane-stroke)}
.stage-label{fill:var(--text-muted);font:600 11px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.12em;text-transform:uppercase;text-anchor:middle}
.node.t-frontend{--ns:var(--frontend-stroke);--nf:var(--frontend-fill)}.node.t-backend{--ns:var(--backend-stroke);--nf:var(--backend-fill)}.node.t-database{--ns:var(--database-stroke);--nf:var(--database-fill)}.node.t-cloud{--ns:var(--cloud-stroke);--nf:var(--cloud-fill)}.node.t-security{--ns:var(--security-stroke);--nf:var(--security-fill)}.node.t-messagebus{--ns:var(--messagebus-stroke);--nf:var(--messagebus-fill)}.node.t-external{--ns:var(--external-stroke);--nf:var(--external-fill)}
.node-box{fill:var(--nf);stroke:var(--ns);stroke-width:1.2}
.node-label{fill:var(--text);font:600 13px -apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;text-anchor:middle}
.node-sub{fill:var(--text-muted);font:10.5px -apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;text-anchor:middle}
.tag-pill{fill:var(--panel);stroke:var(--ns)}
.tag-text{fill:var(--ns);font:600 9px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;text-anchor:middle}
.flow{fill:none;stroke:var(--arrow);stroke-width:1.5}
.flow-emphasis{stroke:var(--arrow-emphasis);stroke-width:2.6}
.flow-security{stroke:var(--security-stroke);stroke-width:1.8}
.flow-dashed{stroke-dasharray:6 4}
[data-anim="trace"] .flow-emphasis{stroke-dasharray:7 5;animation:march 1.1s linear infinite}
@keyframes march{to{stroke-dashoffset:-24}}
.mk-default{fill:var(--arrow)}.mk-emphasis{fill:var(--arrow-emphasis)}.mk-security{fill:var(--security-stroke)}.mk-dashed{fill:var(--arrow)}
.plate{fill:var(--mask);opacity:.92}
.flow-label{fill:var(--text);font:600 11.5px -apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;text-anchor:middle}
.flow-class{fill:var(--text-muted);font:9.5px -apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;text-anchor:middle}
.legend-flow{stroke-width:1.5}.legend-emphasis{stroke:var(--arrow-emphasis);stroke-width:2.4}.legend-security{stroke:var(--security-stroke)}.legend-dashed{stroke-dasharray:6 4}.legend-default{stroke:var(--arrow)}
.legend-db{fill:var(--database-fill);stroke:var(--database-stroke)}
.legend-text{fill:var(--text-muted);font:11px -apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;margin-top:16px}
.card{background:var(--panel);border:1px solid var(--panel-border);border-radius:12px;padding:12px 14px}
.card h3{margin:0 0 8px;font-size:12.5px;display:flex;align-items:center;gap:7px}
.dot{width:8px;height:8px;border-radius:50%;background:var(--dot);flex:none}
.card ul{margin:0;padding:0;list-style:none;color:var(--text-muted);font-size:12px;display:grid;gap:5px}
</style>
</head>
<body>
<main class="page">
  <header>
    <div>
      <h1>${esc(meta.title)}</h1>
      ${meta.subtitle ? `<p class="sub">${esc(meta.subtitle)}</p>` : ''}
    </div>
    <button id="theme-toggle" type="button" aria-label="切换主题">🌓</button>
  </header>
  <section class="canvas">
  <svg viewBox="0 0 ${r1(W)} ${r1(H)}" role="img" aria-label="${esc(meta.title)}"${meta.animation === 'trace' ? ' data-anim="trace"' : ''}>
    <defs>${defs}</defs>
    ${svg}
  </svg>
  </section>${cards ? `
  <aside class="cards">${cards}
  </aside>` : ''}
</main>
<script>
(function(){
  var btn=document.getElementById('theme-toggle');
  btn.addEventListener('click',function(){
    var t=document.documentElement.getAttribute('data-theme')==='dark'?'light':'dark';
    document.documentElement.setAttribute('data-theme',t);
    try{localStorage.setItem('mini-archify-theme',t)}catch(_){}
  });
})();
</script>
</body>
</html>
`;

const outputPath = outputArg
  ? resolve(outputArg)
  : resolve(dirname(inputPath), meta.output || inputPath.replace(/\.json$/i, '.html'));
writeFileSync(outputPath, html);

for (const w of warnings) console.warn('⚠️ ', w);
if (errors.length) {
  console.error(`⚠️ 输出已生成但存在布局问题: ${outputPath}`);
  for (const m of errors) console.error('  -', m);
  process.exit(1);
}
console.log(`✅ 图已生成: ${outputPath}`);
