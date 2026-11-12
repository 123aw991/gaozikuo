/**
 * 智能问答页逻辑：会话管理 + 流式问答 + 引用溯源
 */
(function () {
  const el = {
    convList: document.getElementById('convList'),
    newBtn: document.getElementById('newBtn'),
    kbToggle: document.getElementById('kbToggle'),
    ragDot: document.getElementById('ragDot'),
    chatTitle: document.getElementById('chatTitle'),
    messages: document.getElementById('messages'),
    input: document.getElementById('input'),
    sendBtn: document.getElementById('sendBtn'),
    stopBtn: document.getElementById('stopBtn'),
    statusHint: document.getElementById('statusHint'),
    usageMeta: document.getElementById('usageMeta'),
    quick: document.getElementById('quick'),
    toast: document.getElementById('toast')
  };

  let conversations = [];
  let activeId = null;
  let abortCtrl = null;

  function toast(msg, err) {
    el.toast.textContent = msg;
    el.toast.className = 'toast show' + (err ? ' err' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (el.toast.className = 'toast'), 2600);
  }

  function scrollBottom() { el.messages.scrollTop = el.messages.scrollHeight; }

  /* ---------- 会话列表 ---------- */
  async function loadConversations() {
    const res = await API.json('GET', '/api/conversations');
    conversations = (res.data && res.data.conversations) || [];
    renderConversations();
  }

  function renderConversations() {
    el.convList.innerHTML = '';
    if (!conversations.length) {
      el.convList.innerHTML = '<div class="empty">暂无会话<br/>点击「新建会话」开始</div>';
      return;
    }
    conversations.forEach((c) => {
      const item = document.createElement('div');
      item.className = 'conv' + (c.id === activeId ? ' active' : '');
      item.innerHTML =
        '<span class="title">' + escapeHtml(c.title || '新会话') + '</span>' +
        '<span class="ops">' +
          '<button data-act="rename">重命名</button>' +
          '<button class="del" data-act="del">删除</button>' +
        '</span>';
      item.addEventListener('click', (e) => {
        const act = e.target.getAttribute('data-act');
        if (act === 'del') { deleteConv(c.id); }
        else if (act === 'rename') { renameConv(c); }
        else { selectConv(c.id); }
      });
      el.convList.appendChild(item);
    });
  }

  async function selectConv(id) {
    activeId = id;
    renderConversations();
    const res = await API.json('GET', '/api/conversations/' + id + '/messages');
    renderMessages((res.data && res.data.messages) || []);
    const c = conversations.find((x) => x.id === id);
    el.chatTitle.textContent = c ? c.title : '知识库问答';
  }

  async function newConv() {
    const title = prompt('会话标题：', '新会话') || '新会话';
    const res = await API.json('POST', '/api/conversations', { title: title.trim() });
    if (res.code === 0) {
      await loadConversations();
      selectConv(res.data.id);
      el.input.focus();
    } else toast('创建失败：' + res.msg, true);
  }

  async function renameConv(c) {
    const title = prompt('重命名会话：', c.title) || '';
    if (!title.trim()) return;
    const res = await API.json('PATCH', '/api/conversations/' + c.id, { title: title.trim() });
    if (res.code === 0) { loadConversations(); if (activeId === c.id) el.chatTitle.textContent = title.trim(); }
    else toast('重命名失败：' + res.msg, true);
  }

  async function deleteConv(id) {
    if (!confirm('确定删除该会话及其全部消息？')) return;
    const res = await API.json('DELETE', '/api/conversations/' + id);
    if (res.code === 0) {
      if (activeId === id) { activeId = null; el.messages.innerHTML = ''; el.chatTitle.textContent = '知识库问答'; }
      loadConversations();
    } else toast('删除失败：' + res.msg, true);
  }

  /* ---------- 消息渲染 ---------- */
  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function renderMessages(list) {
    el.messages.innerHTML = '';
    list.forEach((m) => {
      if (m.role === 'system') return;
      createMessage(m.role, m.content, false);
    });
    scrollBottom();
  }

  function createMessage(role, text, isStreaming) {
    const wrap = document.createElement('div');
    wrap.className = 'msg ' + role;
    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = role === 'user' ? '我' : 'AI';
    const bw = document.createElement('div');
    bw.className = 'bubble-wrap';
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    if (role === 'user') bubble.textContent = text;
    else bubble.innerHTML = MD.render(text || '');
    bw.appendChild(bubble);
    wrap.appendChild(avatar);
    wrap.appendChild(bw);
    el.messages.appendChild(wrap);
    scrollBottom();
    return { wrap, bw, bubble };
  }

  function renderCites(node, hits) {
    if (!hits || !hits.length) return;
    const cites = document.createElement('div');
    cites.className = 'cites';
    cites.innerHTML = '<div class="cite-head">引用来源（点击展开原文分块）</div>';
    hits.forEach((h, i) => {
      const d = document.createElement('details');
      d.className = 'cite';
      d.innerHTML =
        '<summary><span class="no">[' + (i + 1) + ']</span>' +
        escapeHtml(h.filename) + ' · 第 ' + (h.seq + 1) + ' 段' +
        '<span class="score">相关度 ' + h.rel + '</span></summary>' +
        '<div class="body"></div>';
      d.querySelector('.body').textContent = h.text;
      cites.appendChild(d);
    });
    node.bw.appendChild(cites);
  }

  /* ---------- 发送 ---------- */
  function send() {
    const q = el.input.value.trim();
    if (!q || abortCtrl) return;

    const useKb = el.kbToggle.checked;
    el.input.value = '';
    el.input.style.height = 'auto';

    createMessage('user', q, false);
    const node = createMessage('assistant', '', true);
    const typing = document.createElement('div');
    typing.className = 'typing';
    typing.innerHTML = '<i></i><i></i><i></i>';
    node.bubble.appendChild(typing);

    let answer = '';
    let meta = null;
    const started = Date.now();

    el.sendBtn.disabled = true;
    el.stopBtn.hidden = false;
    el.statusHint.textContent = useKb ? '已检索知识库，正在请求模型…' : '正在请求模型…';

    function finish() {
      if (typing.parentNode) typing.remove();
      node.bubble.innerHTML = MD.render(answer || '（模型未返回内容）');
      node.bw.appendChild(buildFoot(node, answer));
      const tok = (meta && meta.usage) ? 'tokens ' + meta.usage.total_tokens : '';
      el.statusHint.textContent = '完成 · 用时 ' + ((Date.now() - started) / 1000).toFixed(1) + 's';
      if (meta && meta.usage && meta.usage.total_tokens) el.usageMeta.textContent = 'tokens: ' + meta.usage.total_tokens;
      abortCtrl = null;
      el.sendBtn.disabled = false;
      el.stopBtn.hidden = true;
      loadConversations();
      scrollBottom();
    }

    abortCtrl = new AbortController();
    API.sse('/api/ai/chat', {
      conversationId: activeId || undefined,
      message: q,
      useKb: useKb,
      stream: true
    }, {
      onMeta: (m) => {
        renderCites(node, m.citations);
        if (!activeId && m.conversationId) {
          activeId = m.conversationId;
          renderConversations();
        }
      },
      onDelta: (text) => {
        answer += text;
        if (typing.parentNode) typing.remove();
        node.bubble.innerHTML = MD.render(answer);
        scrollBottom();
      },
      onDone: (d) => { meta = d; finish(); },
      onError: (msg) => {
        if (typing.parentNode) typing.remove();
        node.bubble.classList.add('error-bubble');
        node.bubble.textContent = '请求失败：' + msg;
        abortCtrl = null;
        el.sendBtn.disabled = false;
        el.stopBtn.hidden = true;
        el.statusHint.textContent = '请求失败，详见 Console';
      },
      onClose: () => { if (abortCtrl) { meta = meta || {}; finish(); } }
    });
  }

  function buildFoot(node, answer) {
    const foot = document.createElement('div');
    foot.className = 'msg-foot';
    foot.innerHTML = '<span class="tok"></span><button type="button" class="copy-msg">复制全文</button>';
    foot.querySelector('.copy-msg').addEventListener('click', () => {
      navigator.clipboard.writeText(answer).then(() => {
        foot.querySelector('.copy-msg').textContent = '已复制';
        setTimeout(() => (foot.querySelector('.copy-msg').textContent = '复制全文'), 1200);
      });
    });
    return foot;
  }

  /* ---------- 事件 ---------- */
  el.newBtn.addEventListener('click', newConv);
  el.sendBtn.addEventListener('click', send);
  el.kbToggle.addEventListener('change', () => {
    const on = el.kbToggle.checked;
    el.ragDot.style.background = on ? '#34d399' : '#f59e0b';
    document.querySelector('.chat-head .switch span.dot') &&
      (document.querySelector('.chat-head .switch').childNodes[1].textContent = on ? ' RAG 已开启' : ' RAG 已关闭');
  });
  el.stopBtn.addEventListener('click', () => { if (abortCtrl) abortCtrl.abort(); });
  el.input.addEventListener('input', () => {
    el.input.style.height = 'auto';
    el.input.style.height = Math.min(el.input.scrollHeight, 150) + 'px';
  });
  el.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
  });
  el.quick.addEventListener('click', (e) => {
    if (e.target.tagName !== 'BUTTON') return;
    el.input.value = e.target.textContent;
    el.input.focus();
  });

  /* ---------- 初始化 ---------- */
  loadConversations().then(() => {
    if (!activeId && conversations.length) selectConv(conversations[0].id);
    else if (!conversations.length)
      createMessage('assistant',
        '你好，我是基于**本地知识库**的问答助手。\n\n' +
        '使用步骤：\n1. 先在「知识库管理」页上传文件（TXT / MD / PDF / DOC / DOCX / PPT / PPTX）；\n' +
        '2. 在这里提问，若开启 RAG 开关，会先做 BM25 检索再把命中分块拼进提示词；\n' +
        '3. 回答下方可展开**引用来源**，回溯到原文分块。\n\n' +
        '对话的请求与响应会打印到浏览器控制台（F12）。');
  });
})();
