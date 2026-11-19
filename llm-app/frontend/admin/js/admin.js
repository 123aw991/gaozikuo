/**
 * 后台管理主逻辑：3 个实体（用户/会话/文档）的增删改查 + 搜索 + 分页 + 详情
 * 所有提示均使用自定义 UI 组件（UI.alert / UI.confirm / UI.form / UI.detail / UI.prompt）
 */
(function () {
  // 未登录拦截：无管理员 Token 直接跳转登录页
  if (!API.getAdminToken()) { location.replace('login.html'); return; }

  const $ = (s) => document.querySelector(s);
  const ENTITIES = {
    users: {
      label: '用户', desc: '管理系统注册用户，支持新增、编辑、删除、搜索与分页',
      columns: [
        { key: 'id', label: 'ID' }, { key: 'username', label: '用户名' }, { key: 'email', label: '邮箱' },
        { key: 'created_at', label: '注册时间' }, { key: 'last_login_at', label: '最后登录' }
      ],
      form: [
        { name: 'username', label: '用户名', required: true },
        { name: 'email', label: '邮箱', type: 'email', required: true },
        { name: 'password', label: '密码（新增必填，编辑留空不改）', type: 'password' }
      ],
      createFields: ['username', 'email', 'password'],
      updateFields: ['username', 'email', 'password'],
      detail: (r) => [
        { label: 'ID', value: r.id }, { label: '用户名', value: r.username }, { label: '邮箱', value: r.email },
        { label: '注册时间', value: r.created_at }, { label: '最后登录', value: r.last_login_at || '从未登录' }
      ]
    },
    conversations: {
      label: '会话', desc: '管理聊天会话，支持新增、编辑、删除、搜索与分页，详情含消息列表',
      columns: [
        { key: 'id', label: 'ID' }, { key: 'title', label: '会话标题' }, { key: 'message_count', label: '消息数' },
        { key: 'created_at', label: '创建时间' }, { key: 'updated_at', label: '更新时间' }
      ],
      form: [{ name: 'title', label: '会话标题', required: true }],
      createFields: ['title'], updateFields: ['title'],
      detail: (r) => [
        { label: 'ID', value: r.id }, { label: '会话标题', value: r.title },
        { label: '消息总数', value: r.message_count }, { label: '创建时间', value: r.created_at },
        { label: '更新时间', value: r.updated_at },
        { label: '消息列表（前 50 条）', value: (r.messages || []).map((m) => '[' + m.role + '] ' + m.content).join('\n\n') || '暂无消息' }
      ]
    },
    documents: {
      label: '知识库文档', desc: '管理知识库文档，支持新增、编辑、删除、搜索与分页，详情含分块内容',
      columns: [
        { key: 'id', label: 'ID' }, { key: 'filename', label: '文件名' }, { key: 'ext', label: '格式' },
        { key: 'chars', label: '字符数' }, { key: 'chunk_count', label: '分块数' }, { key: 'status', label: '状态' },
        { key: 'created_at', label: '入库时间' }
      ],
      form: [
        { name: 'filename', label: '文件名', required: true },
        { name: 'ext', label: '格式（如 md / txt）' },
        { name: 'chars', label: '字符数', type: 'number' },
        { name: 'status', label: '状态', type: 'select', options: [{ value: 'ready', label: '就绪' }, { value: 'parsing', label: '解析中' }, { value: 'error', label: '异常' }] }
      ],
      createFields: ['filename', 'ext', 'chars', 'status'],
      updateFields: ['filename', 'ext', 'chars', 'status'],
      detail: (r) => [
        { label: 'ID', value: r.id }, { label: '文件名', value: r.filename }, { label: '格式', value: r.ext },
        { label: '字节数', value: r.size }, { label: '字符数', value: r.chars },
        { label: '分块数', value: r.chunk_count }, { label: '状态', value: r.status }, { label: '入库时间', value: r.created_at },
        { label: '分块内容（前 50 段）', value: (r.chunks || []).map((c) => '#' + (c.seq + 1) + ' ' + c.content).join('\n\n') || '暂无分块' }
      ]
    }
  };

  let entity = 'users';
  let page = 1;
  let pageSize = 10;
  let keyword = '';
  let total = 0;

  /* 鉴权失效处理 */
  async function api(method, path, body) {
    const res = await API.json(method, path, body);
    if (res.code === 401) {
      API.setAdminToken('');
      await UI.alert('登录已失效，请重新登录', '会话超时');
      location.replace('login.html');
      return null;
    }
    return res;
  }

  /* ---------- 渲染列表 ---------- */
  function renderHead() {
    const cols = ENTITIES[entity].columns;
    $('#tableHead').innerHTML = '<tr>' + cols.map((c) => '<th>' + c.label + '</th>').join('') + '<th style="width:170px">操作</th></tr>';
  }

  function cellValue(row, key) {
    const v = row[key];
    if (v === null || v === undefined || v === '') return '<span class="muted">-</span>';
    if (key === 'status') {
      const color = v === 'ready' ? '#9fe8dd' : v === 'error' ? '#ffc7e5' : '#fbbf24';
      return '<span style="color:' + color + '">' + v + '</span>';
    }
    const s = String(v);
    return s.length > 42 ? s.slice(0, 42) + '…' : s.replace(/</g, '&lt;');
  }

  function renderRows(items) {
    const tbody = $('#tableBody');
    const cols = ENTITIES[entity].columns;
    tbody.innerHTML = '';
    $('#emptyRow').hidden = items.length > 0;
    items.forEach((row) => {
      const tr = document.createElement('tr');
      tr.innerHTML = cols.map((c) => '<td>' + cellValue(row, c.key) + '</td>').join('') +
        '<td><div class="row-ops">' +
        '<button class="op-btn" data-act="detail">详情</button>' +
        '<button class="op-btn" data-act="edit">编辑</button>' +
        '<button class="op-btn del" data-act="del">删除</button>' +
        '</div></td>';
      tr.querySelectorAll('.op-btn').forEach((b) => {
        b.addEventListener('click', () => {
          const act = b.dataset.act;
          if (act === 'detail') showDetail(row.id);
          else if (act === 'edit') showEdit(row);
          else showDelete(row);
        });
      });
      tbody.appendChild(tr);
    });
  }

  async function load() {
    const res = await api('GET', '/api/admin/' + entity + '?keyword=' + encodeURIComponent(keyword) + '&page=' + page + '&pageSize=' + pageSize);
    if (!res) return;
    if (res.code !== 0) { await UI.alert(res.msg || '加载失败', '错误'); return; }
    const d = res.data;
    total = d.total;
    page = d.page;
    renderRows(d.items);
    $('#pageInfo').textContent = '共 ' + total + ' 条记录';
    $('#pageNum').textContent = page + ' / ' + Math.max(1, Math.ceil(total / pageSize));
    $('#prevBtn').disabled = page <= 1;
    $('#nextBtn').disabled = page >= Math.ceil(total / pageSize);
  }

  /* ---------- CRUD ---------- */
  async function showDetail(id) {
    const res = await api('GET', '/api/admin/' + entity + '/' + id);
    if (!res) return;
    if (res.code !== 0) { await UI.alert(res.msg, '错误'); return; }
    const rows = ENTITIES[entity].detail(res.data);
    await UI.detail(ENTITIES[entity].label + '详情 #' + id, rows);
  }

  async function showAdd() {
    const meta = ENTITIES[entity];
    const data = await UI.form('新增' + meta.label, meta.form);
    if (!data) return;
    const payload = {};
    meta.createFields.forEach((f) => { if (data[f] !== '' && data[f] !== undefined) payload[f] = data[f]; });
    const res = await api('POST', '/api/admin/' + entity, payload);
    if (!res) return;
    await UI.alert(res.msg || (res.code === 0 ? '新增成功' : '新增失败'), res.code === 0 ? '成功' : '失败');
    if (res.code === 0) load();
  }

  async function showEdit(row) {
    const meta = ENTITIES[entity];
    const values = {};
    meta.form.forEach((f) => { values[f.name] = row[f.name] !== undefined ? row[f.name] : ''; });
    if (entity === 'users') values.password = '';
    const data = await UI.form('编辑' + meta.label + ' #' + row.id, meta.form, values);
    if (!data) return;
    const payload = {};
    meta.updateFields.forEach((f) => { if (data[f] !== '') payload[f] = data[f]; });
    const res = await api('PUT', '/api/admin/' + entity + '/' + row.id, payload);
    if (!res) return;
    await UI.alert(res.msg || (res.code === 0 ? '修改成功' : '修改失败'), res.code === 0 ? '成功' : '失败');
    if (res.code === 0) load();
  }

  async function showDelete(row) {
    const name = row.username || row.title || row.filename || ('#' + row.id);
    const yes = await UI.confirm('确定要删除「' + name + '」吗？此操作不可恢复。', '删除确认');
    if (!yes) return;
    const res = await api('DELETE', '/api/admin/' + entity + '/' + row.id);
    if (!res) return;
    await UI.alert(res.msg || (res.code === 0 ? '删除成功' : '删除失败'), res.code === 0 ? '成功' : '失败');
    if (res.code === 0) { if (page > 1 && total - 1 <= (page - 1) * pageSize) page--; load(); }
  }

  /* ---------- 视图切换 ---------- */
  function showDashboard() {
    document.querySelectorAll('.admin-nav-item').forEach((x) => x.classList.remove('active'));
    document.querySelector('.admin-nav-item[data-view="dashboard"]').classList.add('active');
    $('#dashView').hidden = false;
    $('#entityView').hidden = true;
    $('#crumbName').textContent = '数据仪表盘';
    if (window.Dashboard) Dashboard.load();
  }
  function showEntity(btn) {
    document.querySelectorAll('.admin-nav-item').forEach((x) => x.classList.remove('active'));
    btn.classList.add('active');
    $('#dashView').hidden = true;
    $('#entityView').hidden = false;
    entity = btn.dataset.entity;
    page = 1; keyword = '';
    $('#searchInput').value = '';
    const meta = ENTITIES[entity];
    $('#entityTitle').textContent = meta.label + '管理';
    $('#entityDesc').textContent = meta.desc;
    $('#crumbName').textContent = meta.label + '管理';
    $('#addBtn').textContent = '+ 新增' + meta.label;
    renderHead();
    load();
  }

  /* ---------- 事件 ---------- */
  document.querySelectorAll('.admin-nav-item[data-entity]').forEach((btn) => {
    btn.addEventListener('click', () => showEntity(btn));
  });
  const dashBtn = document.querySelector('.admin-nav-item[data-view="dashboard"]');
  if (dashBtn) dashBtn.addEventListener('click', showDashboard);
  const refreshBtn = document.getElementById('dashRefresh');
  if (refreshBtn) refreshBtn.addEventListener('click', () => { Dashboard.load(); UI.alert('数据已刷新', '仪表盘'); });

  $('#addBtn').addEventListener('click', showAdd);
  $('#searchBtn').addEventListener('click', () => { keyword = $('#searchInput').value.trim(); page = 1; load(); });
  $('#searchInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { keyword = $('#searchInput').value.trim(); page = 1; load(); } });
  $('#resetBtn').addEventListener('click', () => { $('#searchInput').value = ''; keyword = ''; page = 1; load(); });
  $('#pageSize').addEventListener('change', (e) => { pageSize = Number(e.target.value); page = 1; load(); });
  $('#prevBtn').addEventListener('click', () => { if (page > 1) { page--; load(); } });
  $('#nextBtn').addEventListener('click', () => { if (page < Math.ceil(total / pageSize)) { page++; load(); } });

  $('#logoutBtn').addEventListener('click', async () => {
    const yes = await UI.confirm('确定退出管理后台吗？', '退出登录');
    if (!yes) return;
    API.setAdminToken('');
    sessionStorage.removeItem('llmapp_admin_name');
    location.href = 'login.html';
  });

  /* 时钟 */
  function tick() { $('#adminClock').textContent = new Date().toLocaleString('zh-CN', { hour12: false }); }
  tick(); setInterval(tick, 1000);

  /* 初始化：校验登录态 */
  (async () => {
    const me = await api('GET', '/api/admin/auth/me');
    if (!me) return;
    if (me.code === 0) {
      $('#adminName').textContent = me.data.username;
      renderHead();
      showDashboard(); // 默认进入仪表盘
    }
  })();
})();
