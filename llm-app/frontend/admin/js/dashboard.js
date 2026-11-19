/**
 * 后台仪表盘：所有图表由 /api/admin/dashboard 真实数据驱动，原生 SVG 绘制（无第三方库）
 */
window.Dashboard = (function () {
  const $ = (s) => document.querySelector(s);
  const PALETTE = ['#38bdf8', '#7ee0d0', '#b57bff', '#fbbf24', '#f472b6', '#34d399', '#60a5fa'];
  const ROLE_COLORS = { user: '#38bdf8', assistant: '#7ee0d0', system: '#b57bff' };
  const STATUS_COLORS = { ready: '#34d399', parsing: '#fbbf24', error: '#f87171', unknown: '#8ea3c4' };

  function svgEl(tag, attrs) {
    const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.keys(attrs || {}).forEach((k) => e.setAttribute(k, attrs[k]));
    return e;
  }
  function clear(svg) { while (svg.firstChild) svg.removeChild(svg.firstChild); }
  function txt(svg, x, y, s, opts) {
    const o = opts || {};
    const t = svgEl('text', {
      x, y, fill: o.fill || '#8ea3c4', 'font-size': o.size || 11,
      'text-anchor': o.anchor || 'start', 'font-weight': o.weight || 400,
      'font-family': o.mono ? 'Consolas, monospace' : 'inherit'
    });
    t.textContent = s;
    svg.appendChild(t);
    return t;
  }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  /* ---------- 指标卡 ---------- */
  function renderKPI(totals) {
    const items = [
      { label: '注册用户', value: totals.users, icon: '👥', color: '#38bdf8' },
      { label: '会话总数', value: totals.conversations, icon: '💬', color: '#7ee0d0' },
      { label: '消息总数', value: totals.messages, icon: '✉️', color: '#b57bff' },
      { label: '知识库文档', value: totals.documents, icon: '📚', color: '#fbbf24' },
      { label: '知识分块', value: totals.chunks, icon: '🧩', color: '#f472b6' }
    ];
    $('#kpiGrid').innerHTML = items.map((i) =>
      '<div class="kpi-card" style="--c:' + i.color + '"><div class="kpi-icon">' + i.icon + '</div>' +
      '<div class="kpi-value">' + i.value + '</div><div class="kpi-label">' + i.label + '</div></div>'
    ).join('');
  }

  /* ---------- 折线图：近 7 天消息趋势 ---------- */
  function renderTrend(trend) {
    const svg = $('#trendChart'); clear(svg);
    const W = 700, H = 240, pad = { l: 46, r: 18, t: 20, b: 34 };
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const max = Math.max(1, ...trend.map((d) => d.count));
    const step = trend.length > 1 ? iw / (trend.length - 1) : iw;
    const x = (i) => pad.l + i * step;
    const y = (v) => pad.t + ih - (v / max) * ih;

    // 网格 + Y 轴刻度
    for (let i = 0; i <= 4; i++) {
      const gy = pad.t + (ih / 4) * i;
      svg.appendChild(svgEl('line', { x1: pad.l, y1: gy, x2: W - pad.r, y2: gy, stroke: 'rgba(120,150,200,0.14)', 'stroke-width': 1 }));
      txt(svg, pad.l - 8, gy + 4, String(Math.round(max - (max / 4) * i)), { anchor: 'end', mono: true, size: 10 });
    }
    // 面积
    let area = 'M ' + x(0) + ' ' + (pad.t + ih);
    trend.forEach((d, i) => { area += ' L ' + x(i) + ' ' + y(d.count); });
    area += ' L ' + x(trend.length - 1) + ' ' + (pad.t + ih) + ' Z';
    svg.appendChild(svgEl('path', { d: area, fill: 'rgba(56,189,248,0.12)' }));
    // 折线
    let line = '';
    trend.forEach((d, i) => { line += (i ? ' L ' : 'M ') + x(i) + ' ' + y(d.count); });
    svg.appendChild(svgEl('path', { d: line, fill: 'none', stroke: '#38bdf8', 'stroke-width': 2.5, 'stroke-linejoin': 'round' }));
    // 数据点 + 数值 + X 轴
    trend.forEach((d, i) => {
      svg.appendChild(svgEl('circle', { cx: x(i), cy: y(d.count), r: 4, fill: '#0b1526', stroke: '#7ee0d0', 'stroke-width': 2 }));
      txt(svg, x(i), y(d.count) - 10, String(d.count), { anchor: 'middle', fill: '#cfe0f8', mono: true, size: 11, weight: 700 });
      txt(svg, x(i), H - 10, d.date.slice(5), { anchor: 'middle', size: 10, mono: true });
    });
  }

  /* ---------- 环形图：消息角色分布 ---------- */
  function donut(svg, items, cx, cy, r, thick, colors) {
    clear(svg);
    const total = items.reduce((s, i) => s + i.value, 0);
    let angle = -Math.PI / 2;
    if (!total) {
      svg.appendChild(svgEl('circle', { cx, cy, r, fill: 'none', stroke: 'rgba(120,150,200,0.18)', 'stroke-width': thick }));
      txt(svg, cx, cy + 4, '暂无数据', { anchor: 'middle' });
      return;
    }
    items.forEach((it, idx) => {
      if (!it.value) return;
      const sweep = (it.value / total) * Math.PI * 2;
      const end = angle + sweep;
      const rr = r - thick / 2;
      const x1 = cx + rr * Math.cos(angle), y1 = cy + rr * Math.sin(angle);
      const x2 = cx + rr * Math.cos(end), y2 = cy + rr * Math.sin(end);
      const large = sweep > Math.PI ? 1 : 0;
      const path = svgEl('path', {
        d: 'M ' + x1.toFixed(2) + ' ' + y1.toFixed(2) + ' A ' + rr + ' ' + rr + ' 0 ' + large + ' 1 ' + x2.toFixed(2) + ' ' + y2.toFixed(2),
        fill: 'none', stroke: (colors && colors[it.key]) || PALETTE[idx % PALETTE.length], 'stroke-width': thick, 'stroke-linecap': 'butt'
      });
      const title = svgEl('title');
      title.textContent = it.label + '：' + it.value + '（' + ((it.value / total) * 100).toFixed(1) + '%）';
      path.appendChild(title);
      svg.appendChild(path);
      angle = end;
    });
    txt(svg, cx, cy - 4, String(total), { anchor: 'middle', size: 24, weight: 700, fill: '#e6edfa', mono: true });
    txt(svg, cx, cy + 16, '总计', { anchor: 'middle', size: 11 });
  }

  function renderRole(roleDist) {
    const items = [
      { key: 'user', label: '用户消息', value: roleDist.user || 0 },
      { key: 'assistant', label: '助手回复', value: roleDist.assistant || 0 },
      { key: 'system', label: '系统消息', value: roleDist.system || 0 }
    ];
    donut($('#roleChart'), items, 130, 118, 88, 26, ROLE_COLORS);
    const total = items.reduce((s, i) => s + i.value, 0);
    $('#roleLegend').innerHTML = items.map((i) =>
      '<div class="legend-item"><i style="background:' + ROLE_COLORS[i.key] + '"></i><span>' + i.label + '</span>' +
      '<b>' + i.value + '</b><em>' + (total ? ((i.value / total) * 100).toFixed(1) : '0.0') + '%</em></div>'
    ).join('');
  }

  /* ---------- 柱状图：文档状态 ---------- */
  function renderStatus(docStatus) {
    const svg = $('#statusChart'); clear(svg);
    const items = [
      { key: 'ready', label: '就绪', value: docStatus.ready || 0 },
      { key: 'parsing', label: '解析中', value: docStatus.parsing || 0 },
      { key: 'error', label: '异常', value: docStatus.error || 0 }
    ];
    Object.keys(docStatus).forEach((k) => {
      if (!['ready', 'parsing', 'error'].includes(k)) items.push({ key: k, label: k, value: docStatus[k] });
    });
    const W = 360, H = 240, pad = { l: 30, r: 12, t: 20, b: 36 };
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const max = Math.max(1, ...items.map((i) => i.value));
    const slot = iw / items.length;
    const bw = Math.min(46, slot * 0.55);
    for (let i = 0; i <= 4; i++) {
      const gy = pad.t + (ih / 4) * i;
      svg.appendChild(svgEl('line', { x1: pad.l, y1: gy, x2: W - pad.r, y2: gy, stroke: 'rgba(120,150,200,0.14)' }));
      txt(svg, pad.l - 6, gy + 4, String(Math.round(max - (max / 4) * i)), { anchor: 'end', size: 10, mono: true });
    }
    items.forEach((it, i) => {
      const h = (it.value / max) * ih;
      const bx = pad.l + slot * i + (slot - bw) / 2;
      const by = pad.t + ih - h;
      const rect = svgEl('rect', { x: bx, y: by, width: bw, height: h, rx: 5, fill: STATUS_COLORS[it.key] || PALETTE[i % PALETTE.length], 'fill-opacity': 0.85 });
      const title = svgEl('title'); title.textContent = it.label + '：' + it.value; rect.appendChild(title);
      svg.appendChild(rect);
      txt(svg, bx + bw / 2, by - 6, String(it.value), { anchor: 'middle', fill: '#cfe0f8', mono: true, size: 12, weight: 700 });
      txt(svg, bx + bw / 2, H - 12, it.label, { anchor: 'middle', size: 10 });
    });
  }

  /* ---------- 横向条形图：Top5 会话 ---------- */
  function renderTop(top) {
    const svg = $('#topChart'); clear(svg);
    const W = 700, H = 260, pad = { l: 190, r: 40, t: 16, b: 20 };
    const iw = W - pad.l - pad.r;
    const max = Math.max(1, ...top.map((t) => t.count));
    if (!top.length) { txt(svg, W / 2, H / 2, '暂无会话数据', { anchor: 'middle' }); return; }
    const slot = (H - pad.t - pad.b) / top.length;
    const bh = Math.min(28, slot * 0.6);
    top.forEach((t, i) => {
      const yy = pad.t + slot * i + (slot - bh) / 2;
      const w = (t.count / max) * iw;
      const rect = svgEl('rect', { x: pad.l, y: yy, width: Math.max(2, w), height: bh, rx: 5, fill: PALETTE[i % PALETTE.length], 'fill-opacity': 0.85 });
      const title = svgEl('title'); title.textContent = t.title + '：' + t.count + ' 条消息'; rect.appendChild(title);
      svg.appendChild(rect);
      const label = String(t.title || ('会话#' + t.id));
      txt(svg, pad.l - 10, yy + bh / 2 + 4, label.length > 16 ? label.slice(0, 16) + '…' : label, { anchor: 'end', size: 11, fill: '#b9cdec' });
      txt(svg, pad.l + Math.max(2, w) + 6, yy + bh / 2 + 4, String(t.count), { mono: true, size: 11, fill: '#cfe0f8', weight: 700 });
    });
  }

  /* ---------- 饼图：文件格式分布 ---------- */
  function renderExt(extDist) {
    const svg = $('#extChart'); clear(svg);
    const items = extDist.map((e, i) => ({ key: e.name, label: e.name, value: e.value, color: PALETTE[i % PALETTE.length] }));
    const total = items.reduce((s, i) => s + i.value, 0);
    if (!total) {
      svg.appendChild(svgEl('circle', { cx: 130, cy: 118, r: 84, fill: 'rgba(8,15,28,0.7)', stroke: 'rgba(120,150,200,0.18)' }));
      txt(svg, 130, 122, '暂无文档', { anchor: 'middle' });
      $('#extLegend').innerHTML = '';
      return;
    }
    let angle = -Math.PI / 2, R = 84, cx = 130, cy = 118;
    items.forEach((it) => {
      const sweep = (it.value / total) * Math.PI * 2;
      const end = angle + sweep;
      const x1 = cx + R * Math.cos(angle), y1 = cy + R * Math.sin(angle);
      const x2 = cx + R * Math.cos(end), y2 = cy + R * Math.sin(end);
      const large = sweep > Math.PI ? 1 : 0;
      const path = svgEl('path', {
        d: 'M ' + cx + ' ' + cy + ' L ' + x1.toFixed(2) + ' ' + y1.toFixed(2) + ' A ' + R + ' ' + R + ' 0 ' + large + ' 1 ' + x2.toFixed(2) + ' ' + y2.toFixed(2) + ' Z',
        fill: it.color, 'fill-opacity': 0.85, stroke: '#0b1526', 'stroke-width': 2
      });
      const title = svgEl('title'); title.textContent = it.label + '：' + it.value + '（' + ((it.value / total) * 100).toFixed(1) + '%）'; path.appendChild(title);
      svg.appendChild(path);
      if (it.value / total > 0.1) {
        const mid = angle + sweep / 2;
        txt(svg, cx + R * 0.62 * Math.cos(mid), cy + R * 0.62 * Math.sin(mid) + 4, Math.round((it.value / total) * 100) + '%', { anchor: 'middle', fill: '#04121f', weight: 700, size: 12 });
      }
      angle = end;
    });
    $('#extLegend').innerHTML = items.map((i) =>
      '<div class="legend-item"><i style="background:' + i.color + '"></i><span>' + esc(i.label) + '</span><b>' + i.value + '</b><em>' + ((i.value / total) * 100).toFixed(1) + '%</em></div>'
    ).join('');
  }

  async function load() {
    const res = await API.json('GET', '/api/admin/dashboard');
    if (res.code !== 0) { if (window.UI) UI.alert(res.msg || '统计加载失败', '错误'); return; }
    const d = res.data;
    renderKPI(d.totals);
    renderTrend(d.trend);
    renderRole(d.roleDist);
    renderStatus(d.docStatus);
    renderTop(d.topConversations);
    renderExt(d.extDist);
    $('#dashTime').textContent = new Date(d.generatedAt).toLocaleString('zh-CN', { hour12: false });
  }

  return { load };
})();
