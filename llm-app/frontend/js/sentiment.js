/**
 * 商业评论情感分类页：上传 Excel → LLM 分类 → 饼状图 + 精选评论 + 明细表
 */
(function () {
  const $ = (s) => document.querySelector(s);
  const el = {
    dropzone: $('#dropzone'),
    fileInput: $('#fileInput'),
    analyzeBtn: $('#analyzeBtn'),
    fileInfo: $('#fileInfo'),
    progress: $('#progress'),
    progressBar: $('#progress > i'),
    sampleList: $('#sampleList'),
    emptyState: $('#emptyState'),
    chartPanel: $('#chartPanel'),
    tablePanel: $('#tablePanel'),
    pie: $('#pie'),
    legend: $('#legend'),
    totalBadge: $('#totalBadge'),
    cGood: $('#cGood'),
    cMid: $('#cMid'),
    cBad: $('#cBad'),
    featured: $('#featured'),
    reviewBody: $('#reviewBody'),
    metaInfo: $('#metaInfo'),
    toast: $('#toast')
  };

  const COLORS = { 好评: '#34d399', 中评: '#fbbf24', 差评: '#f87171' };
  let chosenFile = null;

  function toast(msg, err) {
    el.toast.textContent = msg;
    el.toast.className = 'toast show' + (err ? ' err' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (el.toast.className = 'toast'), 2600);
  }

  /* ---------- 模拟数据列表 ---------- */
  async function loadSamples() {
    const res = await API.json('GET', '/api/sentiment/sample-files');
    const files = (res.data && res.data.files) || [];
    el.sampleList.innerHTML = '';
    if (!files.length) { el.sampleList.innerHTML = '<div class="empty">暂无模拟文件</div>'; return; }
    files.forEach((f) => {
      const a = document.createElement('a');
      a.className = 'sample-item';
      a.href = f.url;
      a.download = f.name;
      a.innerHTML = '<span>📄</span><span class="sname"></span><span class="dl">⬇</span>';
      a.querySelector('.sname').textContent = f.name;
      el.sampleList.appendChild(a);
    });
  }

  /* ---------- 文件选择 ---------- */
  function pick(file) {
    if (!/\.xlsx?$/i.test(file.name)) { toast('请选择 .xlsx / .xls 文件', true); return; }
    chosenFile = file;
    el.fileInfo.textContent = '已选择：' + file.name + '\n大小：' + (file.size / 1024).toFixed(1) + ' KB';
    el.fileInfo.style.whiteSpace = 'pre-line';
    el.analyzeBtn.disabled = false;
  }

  el.dropzone.addEventListener('click', () => el.fileInput.click());
  el.fileInput.addEventListener('change', (e) => { if (e.target.files[0]) pick(e.target.files[0]); });
  ['dragenter', 'dragover'].forEach((t) => el.dropzone.addEventListener(t, (e) => { e.preventDefault(); el.dropzone.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((t) => el.dropzone.addEventListener(t, (e) => { e.preventDefault(); el.dropzone.classList.remove('drag'); }));
  el.dropzone.addEventListener('drop', (e) => { if (e.dataTransfer.files[0]) pick(e.dataTransfer.files[0]); });

  /* ---------- 分类 ---------- */
  el.analyzeBtn.addEventListener('click', async () => {
    if (!chosenFile) return;
    el.analyzeBtn.disabled = true;
    el.analyzeBtn.textContent = '分析中…';
    el.metaInfo.textContent = '正在解析 Excel 并请求 LLM 分类…';
    el.progress.classList.add('show');
    el.progressBar.style.width = '20%';

    try {
      const res = await API.upload('/api/sentiment/analyze', chosenFile, (p) => {
        el.progressBar.style.width = Math.max(20, Math.round(p * 0.5)) + '%';
      });
      el.progressBar.style.width = '100%';
      setTimeout(() => el.progress.classList.remove('show'), 500);

      if (res.code !== 0) throw new Error(res.msg || '分析失败');
      render(res.data);
      toast('分析完成：' + res.data.total + ' 条评论（' + res.data.mode + '）');
    } catch (e) {
      el.progress.classList.remove('show');
      el.metaInfo.textContent = '分析失败';
      toast('分析失败：' + (e.msg || e.message), true);
    } finally {
      el.analyzeBtn.disabled = false;
      el.analyzeBtn.textContent = '开始情感分类';
    }
  });

  /* ---------- 渲染饼图（原生 SVG） ---------- */
  function drawPie(stats) {
    const items = [
      { label: '好评', value: stats['好评'] || 0, color: COLORS['好评'] },
      { label: '中评', value: stats['中评'] || 0, color: COLORS['中评'] },
      { label: '差评', value: stats['差评'] || 0, color: COLORS['差评'] }
    ];
    const total = items.reduce((s, i) => s + i.value, 0);
    const cx = 130, cy = 130, r = 100;
    let angle = -Math.PI / 2;
    let html = '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="rgba(8,15,28,0.85)" stroke="rgba(120,150,200,0.18)" stroke-width="2"/>';

    items.forEach((it) => {
      if (!it.value || !total) return;
      const sweep = (it.value / total) * Math.PI * 2;
      const end = angle + sweep;
      const x1 = cx + r * Math.cos(angle), y1 = cy + r * Math.sin(angle);
      const x2 = cx + r * Math.cos(end), y2 = cy + r * Math.sin(end);
      const large = sweep > Math.PI ? 1 : 0;
      html += '<path d="M ' + cx + ' ' + cy + ' L ' + x1.toFixed(2) + ' ' + y1.toFixed(2) +
        ' A ' + r + ' ' + r + ' 0 ' + large + ' 1 ' + x2.toFixed(2) + ' ' + y2.toFixed(2) + ' Z" ' +
        'fill="' + it.color + '" fill-opacity="0.85" stroke="#0b1526" stroke-width="2"><title>' +
        it.label + '：' + it.value + ' 条（' + ((it.value / total) * 100).toFixed(1) + '%）</title></path>';
      if (it.value / total > 0.08) {
        const mid = angle + sweep / 2;
        const lx = cx + r * 0.62 * Math.cos(mid), ly = cy + r * 0.62 * Math.sin(mid);
        html += '<text x="' + lx.toFixed(2) + '" y="' + ly.toFixed(2) + '" fill="#04121f" font-size="15" font-weight="700" text-anchor="middle" dominant-baseline="central">' +
          Math.round((it.value / total) * 100) + '%</text>';
      }
      angle = end;
    });

    html += '<text x="' + cx + '" y="' + (cy - 8) + '" fill="#e6edfa" font-size="22" font-weight="700" text-anchor="middle">' + total + '</text>';
    html += '<text x="' + cx + '" y="' + (cy + 14) + '" fill="#8ea3c4" font-size="11" text-anchor="middle">条评论</text>';
    el.pie.innerHTML = html;

    el.legend.innerHTML = items.map((it) =>
      '<div class="legend-item"><i style="background:' + it.color + '"></i><span>' + it.label + '</span>' +
      '<b>' + it.value + ' 条</b><em>' + (total ? ((it.value / total) * 100).toFixed(1) : '0.0') + '%</em></div>'
    ).join('');
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function labelHtml(label) {
    return '<span class="label-tag" style="--c:' + (COLORS[label] || '#8ea3c4') + '">' + escapeHtml(label) + '</span>';
  }

  function render(data) {
    el.emptyState.hidden = true;
    el.chartPanel.hidden = false;
    el.tablePanel.hidden = false;

    el.totalBadge.textContent = data.total + ' 条';
    el.cGood.textContent = data.stats['好评'] || 0;
    el.cMid.textContent = data.stats['中评'] || 0;
    el.cBad.textContent = data.stats['差评'] || 0;
    el.metaInfo.textContent = (data.mode || 'LLM') + ' · ' + (data.usage ? data.usage.total_tokens + ' tokens' : '—');

    drawPie(data.stats);

    /* 精选评论 */
    el.featured.innerHTML = '';
    if (!data.featured || !data.featured.length) {
      el.featured.innerHTML = '<div class="empty">暂无精选评论</div>';
    } else {
      data.featured.forEach((f) => {
        const card = document.createElement('div');
        card.className = 'featured-card';
        card.style.setProperty('--c', COLORS[f.label] || '#8ea3c4');
        card.innerHTML =
          '<div class="fhead"><span class="flabel">' + labelHtml(f.label) + '</span><span class="fmeta">#' + f.no + ' · ' + escapeHtml(f.user) + ' · ' + escapeHtml(f.time) + '</span></div>' +
          '<div class="ftext">“' + escapeHtml(f.text) + '”</div>' +
          '<div class="freason">判断依据：' + escapeHtml(f.reason) + '</div>';
        el.featured.appendChild(card);
      });
    }

    /* 明细表 */
    el.reviewBody.innerHTML = '';
    data.reviews.forEach((r) => {
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td class="no">' + r.no + '</td>' +
        '<td class="text">' + escapeHtml(r.text) + '</td>' +
        '<td>' + labelHtml(r.label) + '</td>' +
        '<td class="reason">' + escapeHtml(r.reason) + '</td>' +
        '<td class="muted">' + escapeHtml(r.user) + '</td>' +
        '<td class="muted">' + escapeHtml(r.time) + '</td>';
      el.reviewBody.appendChild(tr);
    });
  }

  loadSamples();
})();
