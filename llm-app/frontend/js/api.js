/**
 * 前端请求封装：统一在控制台打印「发送给后端的数据」与「从后端接收的数据」
 * （满足实验要求：控制台输出请求 / 响应）
 */
const API = (function () {
  const BASE = location.origin;

  const CSS_REQ = 'color:#2563eb;font-weight:700';
  const CSS_RES = 'color:#0d9488;font-weight:700';
  const CSS_EVT = 'color:#7c3aed;font-weight:700';

  function buildBody(obj) {
    if (!obj) return undefined;
    if (obj instanceof FormData) {
      const o = {};
      obj.forEach((v, k) => (o[k] = v && v.name ? '[文件] ' + v.name + ' (' + v.size + ' B)' : v));
      return o;
    }
    return obj;
  }

  function logReq(method, url, headers, body) {
    console.log('%c → 请求 ' + method + ' ' + url, CSS_REQ);
    if (headers) console.log('  Headers:', headers);
    if (body !== undefined) console.log('  Body:', buildBody(body));
  }

  function logRes(res, data) {
    console.log('%c ← 响应 ' + res.status + ' ' + res.statusText, CSS_RES);
    console.log('  Data:', data);
  }

  async function json(method, path, obj) {
    const url = BASE + path;
    const headers = { 'Content-Type': 'application/json' };
    logReq(method, url, headers, obj);
    const r = await fetch(url, { method, headers, body: obj ? JSON.stringify(obj) : undefined });
    const data = await r.json().catch(() => ({}));
    logRes(r, data);
    return data;
  }

  /* 文件上传（带进度回调）；extra 为附加表单字段对象 */
  function upload(path, file, onProgress, extra) {
    const url = BASE + path;
    const fd = new FormData();
    fd.append('file', file);
    if (extra) Object.keys(extra).forEach((k) => fd.append(k, extra[k]));
    logReq('POST', url, { 'Content-Type': 'multipart/form-data' }, fd);

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        let data = {};
        try { data = JSON.parse(xhr.responseText); } catch (e) { /* ignore */ }
        logRes({ status: xhr.status, statusText: xhr.statusText }, data);
        xhr.status >= 200 && xhr.status < 300 ? resolve(data) : reject(data);
      };
      xhr.onerror = () => reject({ code: -1, msg: '网络错误' });
      xhr.send(fd);
    });
  }

  /* SSE 流式调用，handlers: onMeta / onDelta / onDone / onError / onClose */
  async function sse(path, obj, handlers) {
    const url = BASE + path;
    const headers = { 'Content-Type': 'application/json' };
    logReq('POST', url, headers, obj);

    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(obj) });
    console.log('%c ← 响应 ' + r.status + ' ' + r.statusText + ' (Content-Type: ' + (r.headers.get('content-type') || '') + ')', CSS_RES);
    if (!r.ok || !r.body) {
      let data = null;
      try { data = await r.json(); } catch (e) { /* ignore */ }
      logRes(r, data);
      handlers.onError && handlers.onError('HTTP ' + r.status + '：' + (data && data.msg || ''));
      return;
    }

    const reader = r.body.getReader();
    const dec = new TextDecoder('utf-8');
    let buf = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';

      for (const raw of lines) {
        const line = raw.trim();
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        let evt;
        try { evt = JSON.parse(payload); } catch (e) { continue; }
        console.log('%c ← 收到 SSE 事件', CSS_EVT, evt);
        const t = evt.type;
        if (t === 'meta') handlers.onMeta && handlers.onMeta(evt);
        else if (t === 'delta') handlers.onDelta && handlers.onDelta(evt.content || '');
        else if (t === 'done') handlers.onDone && handlers.onDone(evt);
        else if (t === 'error') handlers.onError && handlers.onError(evt.msg);
      }
    }
    handlers.onClose && handlers.onClose();
  }

  return { BASE, json, upload, sse };
})();
