/**
 * 多模态路由：/api/recognition
 * - POST /image/generate     文生图：硅基流动 OpenMOSS-Team/MOSS-Image
 * - POST /speech/transcribe  语音识别：硅基流动 SenseVoiceSmall（Qwen-Omni 备选）
 * - POST /speech/analyze     转写文本整理：摘要 / 关键词 / 意图
 * 请求体与响应体统一在服务端终端打印（base64 自动截断）。API Key 缺失或调用失败时自动降级。
 */
const express = require('express');
const multer = require('multer');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const config = require('../config');
const llm = require('../services/llm');

const GEN_DIR = path.join(__dirname, '..', '..', 'frontend', 'generated');
fs.mkdirSync(GEN_DIR, { recursive: true });

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });
const ok = (res, data, msg) => res.json({ code: 0, msg: msg || 'ok', data });
const brief = (s, n) => { const t = String(s == null ? '' : s); const m = n || 300; return t.length > m ? t.slice(0, m) + '…（共 ' + t.length + ' 字符）' : t; };
const saveUrlBrief = (u) => String(u || '').startsWith('data:') ? 'data:' + String(u).slice(5, 30) + '…' : String(u || '').slice(0, 160);

/* 终端打印：发给多模态模型的数据（base64 截断） */
function logSend(url, model, body, extra) {
  console.log('\n================ [→ 发送给多模态模型] ================');
  console.log('时间    ：' + new Date().toLocaleString('zh-CN'));
  console.log('地址    ：POST ' + url);
  console.log('模型    ：' + model);
  if (extra) console.log('说明    ：' + extra);
  const safe = JSON.stringify(body, (k, v) => (typeof v === 'string' && v.length > 800 ? brief(v, 160) : v), 2);
  console.log('请求体  ：\n' + safe);
  console.log('======================================================');
}
function logReceive(raw, ms) {
  console.log('\n================ [← 从多模态模型接收] ================');
  console.log('耗时    ：' + ms + ' ms');
  console.log('原始响应：\n' + JSON.stringify(raw, (k, v) => (typeof v === 'string' && v.length > 800 ? brief(v, 160) : v), 2));
  console.log('======================================================\n');
}

function extractObject(text) {
  if (!text) return null;
  let s = String(text).trim();
  try { const o = JSON.parse(s); if (o && typeof o === 'object') return o; } catch (e) { /* continue */ }
  const f = s.match(/```(?:json)?\s*([\s\S]*?)```/i); if (f) s = f[1].trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch (e) { /* continue */ } }
  return null;
}

/* 本地演示生图：SVG data URI，可直接 <img src> 展示 */
function demoImage(prompt, imageSize) {
  const esc = String(prompt).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
  const [w, h] = String(imageSize || '1024x1024').split('x').map(Number);
  const W = w || 1024, H = h || 1024;
  const words = esc.split(/\s+/); const lines = []; let cur = '';
  words.forEach((word) => { if ((cur + ' ' + word).trim().length > 24) { lines.push(cur); cur = word; } else cur = (cur + ' ' + word).trim(); });
  if (cur) lines.push(cur);
  const text = lines.slice(0, 8).map((l, i) => '<text x="50%" y="' + (H / 2 + i * 46) + '" text-anchor="middle" font-size="30" fill="#e6edfa">' + l + '</text>').join('');
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '">' +
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b1a33"/><stop offset="0.55" stop-color="#123a5c"/><stop offset="1" stop-color="#1c6f8e"/></linearGradient></defs>' +
    '<rect width="100%" height="100%" fill="url(#g)"/><circle cx="18%" cy="20%" r="110" fill="#7ee0d0" opacity="0.12"/><circle cx="84%" cy="80%" r="160" fill="#38bdf8" opacity="0.10"/>' +
    '<text x="50%" y="' + (H / 2 - 130) + '" text-anchor="middle" font-size="44" font-weight="bold" fill="#7ee0d0">AI 生图演示 · OpenMOSS</text>' + text +
    '<text x="50%" y="' + (H - 56) + '" text-anchor="middle" font-size="20" fill="#8ea3c4">配置 SF_API_KEY 后由 OpenMOSS-Team/MOSS-Image 真实生成</text></svg>';
  return 'data:image/svg+xml;base64,' + Buffer.from(svg, 'utf8').toString('base64');
}

/* ==================== 文生图 ==================== */
router.post('/image/generate', async (req, res) => {
  const prompt = String((req.body && req.body.prompt) || '').trim();
  if (!prompt) return res.json({ code: 4001, msg: '提示词不能为空', data: null });
  const imageSize = /^\d+x\d+$/.test(String(req.body.imageSize || '')) ? req.body.imageSize : '1024x1024';
  const steps = Math.min(50, Math.max(1, Number(req.body.steps) || 20));
  const guidance = Math.min(20, Math.max(0, Number(req.body.guidance) || 7.5));
  const sf = config.multimodal;
  const body = { model: sf.imageModel, prompt, image_size: imageSize, num_inference_steps: steps, guidance_scale: guidance };
  const url = sf.baseURL + '/images/generations';

  try {
    if (!sf.apiKey) throw new Error('未配置 SF_API_KEY（硅基流动 API Key）');
    logSend(url, sf.imageModel, body, '文生图：' + sf.imageModel + '（可在 .env 中切换 OpenMOSS-Team/MOSS-Image）');
    const t0 = Date.now();
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), sf.timeout);
    let r;
    try {
      r = await fetch(url, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + sf.apiKey, 'Content-Type': 'application/json', 'X-Enable-Watermark': '0' },
        body: JSON.stringify(body), signal: ctl.signal
      });
    } finally { clearTimeout(timer); }
    const raw = await r.json().catch(() => ({}));
    console.log('[HTTP] 状态码：' + r.status + ' ' + r.statusText);
    logReceive(raw, Date.now() - t0);
    if (!r.ok) throw new Error('硅基流动返回 HTTP ' + r.status + '：' + brief(JSON.stringify(raw), 180));

    const images = raw.images || [];
    if (!images.length) throw new Error('响应中没有 images 字段');
    const it = images[0] || {};
    const upstreamUrl = it.url || (it.b64_json ? 'data:image/png;base64,' + it.b64_json : '');
    if (!upstreamUrl) throw new Error('images[0] 中没有 url 或 b64_json');

    /* 远端图片下载到本地，返回稳定的 /generated/xxx.png，避免临时链接失效/加载慢 */
    let imageUrl = upstreamUrl;
    let localFile = null;
    try {
      let buf;
      if (upstreamUrl.startsWith('data:')) {
        buf = Buffer.from(upstreamUrl.split(',')[1] || '', 'base64');
      } else {
        const ir = await fetch(upstreamUrl, { signal: AbortSignal.timeout(30000) });
        buf = Buffer.from(await ir.arrayBuffer());
      }
      if (buf && buf.length > 1000) {
        const fname = 'gen-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.png';
        fs.writeFileSync(path.join(GEN_DIR, fname), buf);
        localFile = '/generated/' + fname;
        imageUrl = localFile;
        console.log('[IMAGE] 图片已保存到本地：' + localFile + '（' + buf.length + ' 字节）');
      }
    } catch (saveErr) {
      console.warn('[IMAGE] 本地保存失败，使用上游链接：' + saveErr.message);
    }

    ok(res, {
      imageUrl, localFile, upstreamUrl: saveUrlBrief(upstreamUrl), prompt, imageSize, steps, guidance, count: images.length,
      model: sf.imageModel, mode: sf.imageModel, usage: raw.usage || null,
      raw: { created: raw.created, imageCount: images.length, fields: Object.keys(it) }
    });
  } catch (e) {
    console.warn('[IMAGE] 生图模型不可用，自动降级：' + e.message);
    ok(res, {
      imageUrl: demoImage(prompt, imageSize), localFile: null, upstreamUrl: null,
      prompt, imageSize, steps, guidance, count: 1,
      model: sf.imageModel, mode: '本地演示生图（' + e.message.slice(0, 70) + '）',
      usage: null, raw: { demo: true }
    });
  }
});

/* ==================== 语音识别（SenseVoiceSmall，Qwen 备选） ==================== */
router.post('/speech/transcribe', upload.single('file'), async (req, res) => {
  const fallbackText = String((req.body && req.body.fallbackText) || '').trim();
  if (!req.file && !fallbackText) return res.json({ code: 4001, msg: '未收到音频文件', data: null });
  const name = req.file ? (Buffer.from(req.file.originalname, 'latin1').toString('utf8').trim() || req.file.originalname) : '浏览器实时转写';
  const size = req.file ? req.file.size : 0;
  const sf = config.multimodal;
  console.log('\n[SPEECH] 收到音频：' + name + '（' + size + ' 字节）');
  const demo = fallbackText || '你好，这是一段用于演示的语音转写文本。今天我们讨论一下智能客服系统的设计方案，并安排下周的测试计划。';

  try {
    if (!req.file) throw new Error('未上传音频文件，采用浏览器实时转写结果');
    if (!sf.apiKey) throw new Error('未配置 SF_API_KEY（硅基流动 API Key）');

    /* 优先按用户给出的 curl：/v1/audio/transcriptions + SenseVoiceSmall */
    const t0 = Date.now();
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), sf.timeout);
    let r;
    try {
      r = await fetch(sf.baseURL + '/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + sf.apiKey },
        body: (() => {
          const f = new FormData();
          f.append('file', new Blob([req.file.buffer], { type: req.file.mimetype || 'audio/mpeg' }), name);
          f.append('model', sf.speechModel);
          return f;
        })(),
        signal: ctl.signal
      });
    } finally { clearTimeout(timer); }

    const raw = await r.json().catch(() => ({}));
    console.log('[HTTP] 状态码：' + r.status + ' ' + r.statusText);
    logReceive(raw, Date.now() - t0);
    if (!r.ok) throw new Error('硅基流动返回 HTTP ' + r.status + '：' + brief(JSON.stringify(raw), 180));

    const text = String(raw.text || '').trim();
    if (!text) throw new Error('ASR 响应中没有 text 字段');

    ok(res, {
      text, filename: name, duration: raw.duration || null,
      model: sf.speechModel, mode: sf.speechModel,
      usage: raw.usage || null, raw: { fields: Object.keys(raw) }
    });
  } catch (e) {
    console.warn('[SPEECH] 语音模型不可用，自动降级：' + e.message);
    ok(res, {
      text: demo, filename: name, duration: null,
      model: sf.speechModel, mode: '本地演示转写（' + e.message.slice(0, 70) + '）',
      usage: null, raw: { demo: true }
    });
  }
});

/* ==================== 转写文本整理（摘要 / 关键词 / 意图） ==================== */
function fallbackSpeech(text) {
  const stop = new Set(['的', '了', '和', '是', '我', '你', '他', '这', '那', '在', '有', '就', '都', '而', '及', '与', '也', '一个', '我们', '你们', '他们', '请', '谢谢']);
  const words = String(text).match(/[\u4e00-\u9fa5]{2,4}|[a-zA-Z]{2,}/g) || [];
  const freq = {};
  words.filter((w) => !stop.has(w)).forEach((w) => { freq[w] = (freq[w] || 0) + 1; });
  const keywords = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 6).map((x) => x[0]);
  let intent = '闲聊/陈述';
  if (/投诉|退款|退货|不满意|太差|有问题|故障/.test(text)) intent = '投诉/售后';
  else if (/请|帮我|打开|查询|设置|播放|提醒|拨打/.test(text)) intent = '指令/请求';
  else if (/[?？]/.test(text) || /吗|呢|怎么|什么|为什么/.test(text)) intent = '问答';
  return { summary: text.length > 60 ? text.slice(0, 60) + '…' : text, keywords: keywords.length ? keywords : ['语音', '转写'], intent, mode: '启发式降级（本地规则）' };
}

router.post('/speech/analyze', async (req, res) => {
  const text = String((req.body && req.body.text) || '').trim();
  if (!text) return res.json({ code: 4001, msg: '转写文本为空', data: null });
  if (config.llm.mock) return ok(res, Object.assign(fallbackSpeech(text), { usage: null }));
  try {
    const prompt = '你是语音转写整理助手。请分析下面这段语音转写文本，严格只输出 JSON 对象（不要 Markdown 标记），字段为：' +
      '{"summary":"50字以内摘要","keywords":["关键词1","关键词2"],"intent":"意图分类（问答/指令/投诉/闲聊/其他）"}。\n\n文本：' + text;
    const result = await llm.chat({
      messages: [{ role: 'system', content: '只输出 JSON，不输出多余文字。' }, { role: 'user', content: prompt }],
      stream: false, temperature: 0.2, scene: '语音转写整理（' + text.length + ' 字）'
    });
    const parsed = extractObject(result.content);
    if (!parsed) throw new Error('模型返回内容无法解析为 JSON');
    ok(res, Object.assign(parsed, { keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [], mode: config.llm.model, usage: result.usage || null }));
  } catch (e) {
    console.warn('[SPEECH] 文本模型不可用，自动降级：' + e.message);
    ok(res, Object.assign(fallbackSpeech(text), { usage: null }));
  }
});

router.get('/status', (req, res) => {
  ok(res, {
    imageModel: config.multimodal.imageModel,
    speechModel: config.multimodal.speechModel,
    baseURL: config.multimodal.baseURL,
    apiKeySet: !!config.multimodal.apiKey,
    note: '生图走 /images/generations，语音走 /audio/transcriptions；未配置 Key 时自动演示'
  });
});

module.exports = router;
