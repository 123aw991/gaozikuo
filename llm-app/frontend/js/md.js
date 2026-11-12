/**
 * 轻量 Markdown 渲染器（无第三方依赖）：标题 / 加粗 / 斜体 / 行内代码 /
 * 代码块 / 有序无序列表 / 引用 / 段落，输出安全 HTML（转义后渲染）
 */
const MD = (function () {
  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function inline(s) {
    s = s.replace(/`([^`\n]+)`/g, '<code class="inline">$1</code>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    return s;
  }

  function renderBlocks(text) {
    const lines = text.split('\n');
    const out = [];
    let listType = null;
    let para = [];

    function closeList() { if (listType) { out.push('</' + listType + '>'); listType = null; } }
    function flushPara() { if (para.length) { out.push('<p>' + para.join('<br/>') + '</p>'); para = []; } }

    lines.forEach((line) => {
      const t = escapeHtml(line).trim();

      if (/^###\s+/.test(t)) { flushPara(); closeList(); out.push('<h4>' + inline(t.replace(/^###\s+/, '')) + '</h4>'); }
      else if (/^##\s+/.test(t)) { flushPara(); closeList(); out.push('<h3>' + inline(t.replace(/^##\s+/, '')) + '</h3>'); }
      else if (/^#\s+/.test(t)) { flushPara(); closeList(); out.push('<h3>' + inline(t.replace(/^#\s+/, '')) + '</h3>'); }
      else if (/^>\s?/.test(t)) { flushPara(); closeList(); out.push('<blockquote>' + inline(t.replace(/^>\s?/, '')) + '</blockquote>'); }
      else if (/^[-*]\s+/.test(t)) { flushPara(); if (listType !== 'ul') { closeList(); out.push('<ul>'); listType = 'ul'; } out.push('<li>' + inline(t.replace(/^[-*]\s+/, '')) + '</li>'); }
      else if (/^\d+\.\s+/.test(t)) { flushPara(); if (listType !== 'ol') { closeList(); out.push('<ol>'); listType = 'ol'; } out.push('<li>' + inline(t.replace(/^\d+\.\s+/, '')) + '</li>'); }
      else if (t === '') { flushPara(); closeList(); }
      else { closeList(); para.push(inline(t)); }
    });

    flushPara();
    closeList();
    return out.join('');
  }

  const codeBlocks = {};
  let seq = 0;

  function render(src) {
    seq = 0;
    const segs = String(src).split('```');
    let html = '';
    segs.forEach((seg, i) => {
      if (i % 2 === 1) {
        const nl = seg.indexOf('\n');
        const lang = nl > 0 ? seg.slice(0, nl).trim() : '';
        const code = (nl > 0 ? seg.slice(nl + 1) : seg).replace(/\n$/, '');
        const id = 'cb' + ++seq;
        codeBlocks[id] = code;
        html += '<div class="code-block"><div class="code-head"><span>' + escapeHtml(lang || 'text') +
          '</span><button type="button" data-code="' + id + '">复制</button></div>' +
          '<pre><code>' + escapeHtml(code) + '</code></pre></div>';
      } else {
        html += renderBlocks(seg);
      }
    });
    return html;
  }

  return { render, getCode: (id) => codeBlocks[id] };
})();
