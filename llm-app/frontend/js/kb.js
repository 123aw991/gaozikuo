/**
 * 知识库管理页逻辑：上传（含进度）/ 列表 / 分块预览 / 删除 / 检索测试
 */
(function () {
  const el = {
    dropzone: document.getElementById('dropzone'),
    fileInput: document.getElementById('fileInput'),
    progress: document.getElementById('progress'),
    progressBar: document.querySelector('#progress > i'),
    fileList: document.getElementById('fileList'),
    docCount: document.getElementById('docCount'),
    idxMeta: document.getElementById('idxMeta'),
    stDocs: document.getElementById('stDocs'),
    stChunks: document.getElementById('stChunks'),
    stChars: document.getElementById('stChars'),
    searchInput: document.getElementById('searchInput'),
    searchBtn: document.getElementById('searchBtn'),
    searchResult: document.getElementById('searchResult'),
    modal: document.getElementById('modal'),
    modalTitle: document.getElementById('modalTitle'),
    modalBody: document.getElementById('modalBody'),
    modalClose: document.getElementById('modalClose'),
    toast: document.getElementById('toast')
  };

  function toast(msg, err) {
    el.toast.textContent = msg;
    el.toast.className = 'toast show' + (err ? ' err' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (el.toast.className = 'toast'), 2600);
  }

  function fmtSize(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
  }

  /* ---------- 加载列表 ---------- */
  async function load() {
    const [docs, stats] = await Promise.all([
      API.json('GET', '/api/kb/documents'),
      API.json('GET', '/api/kb/stats')
    ]);

    const list = (docs.data && docs.data.documents) || [];
    const s = (stats.data) || { chunks: 0, docs: 0, avgdl: 0, chars: 0 };

    el.stDocs.textContent = s.docs;
    el.stChunks.textContent = s.chunks;
    el.stChars.textContent = s.chars || 0;
    el.idxMeta.textContent = '索引分块 ' + s.chunks;
    el.docCount.textContent = list.length + ' 个文档';

    el.fileList.innerHTML = '';
    if (!list.length) {
      el.fileList.innerHTML = '<div class="empty">暂无知识库文件<br/>拖入文件或点击上方上传</div>';
      return;
    }

    list.forEach((d) => {
      const item = document.createElement('div');
      item.className = 'file-item';
      item.innerHTML =
        '<div class="fext">' + (d.ext || 'doc').toUpperCase().slice(0, 4) + '</div>' +
        '<div class="fmain">' +
          '<div class="fname" title="' + escapeHtml(d.filename) + '">' + escapeHtml(d.filename) + '</div>' +
          '<div class="fmeta">' + (d.chunk_count || 0) + ' 段 · ' + fmtSize(d.size || 0) + ' · ' + (d.chars || 0) + ' 字' +
          ' · <span class="status ready">就绪</span></div>' +
        '</div>' +
        '<div class="fops">' +
          '<button class="mini" data-act="view">分块</button>' +
          '<button class="mini del" data-act="del">删除</button>' +
        '</div>';

      item.querySelector('[data-act="view"]').addEventListener('click', () => viewChunks(d.id, d.filename, d.chunk_count));
      item.querySelector('[data-act="del"]').addEventListener('click', () => delDoc(d.id));
      el.fileList.appendChild(item);
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ---------- 上传（带进度） ---------- */
  function uploadFile(file) {
    el.progress.classList.add('show');
    el.progressBar.style.width = '0%';
    API.upload('/api/kb/documents', file, (p) => {
      el.progressBar.style.width = p + '%';
    }).then((res) => {
      el.progressBar.style.width = '100%';
      setTimeout(() => el.progress.classList.remove('show'), 600);
      if (res && res.code === 0) {
        toast('已入库：' + res.data.filename + '（' + res.data.chunks + ' 段）');
        load();
      } else {
        toast('解析失败：' + (res && res.msg || '未知错误'), true);
      }
    }).catch((err) => {
      setTimeout(() => el.progress.classList.remove('show'), 600);
      toast('上传失败：' + (err && err.msg || '网络错误'), true);
    });
  }

  function handleFiles(files) {
    Array.prototype.slice.call(files).forEach(uploadFile);
  }

  el.dropzone.addEventListener('click', () => el.fileInput.click());
  el.fileInput.addEventListener('change', (e) => { handleFiles(e.target.files); el.fileInput.value = ''; });
  ['dragenter', 'dragover'].forEach((evt) =>
    el.dropzone.addEventListener(evt, (e) => { e.preventDefault(); el.dropzone.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((evt) =>
    el.dropzone.addEventListener(evt, (e) => { e.preventDefault(); el.dropzone.classList.remove('drag'); }));
  el.dropzone.addEventListener('drop', (e) => { if (e.dataTransfer && e.dataTransfer.files) handleFiles(e.dataTransfer.files); });

  /* ---------- 删除 / 分块预览 ---------- */
  async function delDoc(id) {
    if (!confirm('确定删除该文档及其所有分块？')) return;
    const res = await API.json('DELETE', '/api/kb/documents/' + id);
    if (res.code === 0) { toast('已删除'); load(); }
    else toast('删除失败：' + res.msg, true);
  }

  async function viewChunks(id, name, count) {
    el.modalTitle.textContent = name + ' · ' + count + ' 个分块';
    el.modalBody.innerHTML = '<div class="empty">加载中…</div>';
    el.modal.classList.add('show');
    const res = await API.json('GET', '/api/kb/documents/' + id + '/chunks');
    el.modalBody.innerHTML = '';
    const chunks = (res.data && res.data.chunks) || [];
    if (!chunks.length) { el.modalBody.innerHTML = '<div class="empty">无分块</div>'; return; }
    chunks.forEach((c, i) => {
      const d = document.createElement('div');
      d.className = 'chunk';
      d.innerHTML = '<b>#' + (i + 1) + '</b>' + escapeHtml(c.content || '');
      el.modalBody.appendChild(d);
    });
  }

  el.modalClose.addEventListener('click', () => el.modal.classList.remove('show'));
  el.modal.addEventListener('click', (e) => { if (e.target === el.modal) el.modal.classList.remove('show'); });

  /* ---------- 检索测试 ---------- */
  el.searchBtn.addEventListener('click', async () => {
    const q = el.searchInput.value.trim();
    if (!q) { toast('请输入查询内容', true); return; }
    const res = await API.json('POST', '/api/kb/search', { query: q, topK: 5 });
    const hits = (res.data && res.data.hits) || [];
    el.searchResult.innerHTML = '';
    if (!hits.length) { el.searchResult.innerHTML = '<div class="empty">未命中任何分块</div>'; return; }
    hits.forEach((h, i) => {
      const d = document.createElement('div');
      d.className = 'hit';
      d.innerHTML = '<b>[' + (i + 1) + ']</b> ' + escapeHtml(h.filename) + ' · 第 ' + (h.seq + 1) + ' 段' +
        '<span class="rel">相关度 ' + h.rel + ' · BM25 ' + h.score + '</span>' +
        '<div style="margin-top:6px;color:#a9c2e6">' + escapeHtml(h.text.length > 160 ? h.text.slice(0, 160) + '…' : h.text) + '</div>';
      el.searchResult.appendChild(d);
    });
  });
  el.searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.searchBtn.click(); });

  load();
})();
