/**
 * 商业评论情感分类路由：/api/sentiment
 * Excel 上传（xlsx 解析）→ LLM 批量分类（好评/中评/差评）→ 统计 + 精选评论
 * 大模型的请求体与响应体统一由 services/llm.js 在控制台打印。
 */
const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const router = express.Router();

const config = require('../config');
const llm = require('../services/llm');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const ok = (res, data, msg) => res.json({ code: 0, msg: msg || 'ok', data });

const LABELS = ['好评', '中评', '差评'];

/* 用关键词做启发式分类（离线演示模式 / LLM 返回不完整时的兜底） */
function heuristic(text) {
  const strongPos = ['非常满意', '超出预期', '超预期', '五星', '强烈推荐', '值得回购', '物超所值', '非常棒', '很棒', '惊艳', '惊喜'];
  const strongNeg = ['非常差', '太差', '极差', '糟糕', '假货', '退款', '退货', '维权', '浪费', '不会再', '不推荐', '失望', '故障', '破损'];
  const pos = ['好', '棒', '赞', '满意', '推荐', '惊喜', '优秀', '不错', '划算', '舒服', '喜欢', '快', '新鲜', '精致', '专业', '五星', '回购', '流畅', '给力', '实在', '正宗', '热情'];
  const neg = ['差', '失望', '退货', '退款', '慢', '敷衍', '贵', '划痕', '破损', '假货', '脏', '油渍', '麻烦', '卡顿', '故障', '糟糕', '不推荐', '谨慎', '投诉', '维权', '浪费', '堪忧', '寡淡', '偏咸'];
  const mid = ['中规中矩', '还行', '尚可', '普通', '中评', '基本', '正常', '没有惊喜', '能用', '一般般', '一般'];
  const t = String(text);
  const count = (arr) => arr.filter((w) => t.includes(w)).length;
  const sp = count(strongPos), sn = count(strongNeg);
  const p = count(pos) + sp * 2, n = count(neg) + sn * 2, m = count(mid);
  if (sn > 0 && sn >= sp) return '差评';
  if (sp > 0 && sp > sn) return '好评';
  if (n > p + 1) return '差评';
  if (p > n + 1) return '好评';
  if (m > 0) return '中评';
  if (n > p) return '差评';
  if (p > n) return '好评';
  return '中评';
}

function buildPrompt(reviews) {
  const list = reviews.map((r) => '[' + r.no + '] ' + r.text).join('\n');
  return '你是商业评论情感分析专家。请逐条判断下列用户评论的情感倾向，只能输出三种标签之一：好评、中评、差评。\n' +
    '判断标准：好评=明显满意/推荐/称赞；中评=中性、好坏参半、中规中矩；差评=明显不满/投诉/退货。\n\n' +
    '要求：\n' +
    '1. 必须严格输出 JSON 数组，不要输出任何其它文字或 Markdown 代码块标记。\n' +
    '2. 数组长度与评论条数一致，顺序与输入一致，每一项为：' +
    '{"no":序号,"label":"好评|中评|差评","reason":"不超过25字的判断依据"}。\n\n' +
    '评论列表：\n' + list;
}

/* 从 LLM 文本中稳健提取 JSON 数组 */
function extractArray(text) {
  if (!text) return null;
  let s = String(text).trim();
  try { const v = JSON.parse(s); if (Array.isArray(v)) return v; } catch (e) { /* continue */ }
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const a = s.indexOf('['); const b = s.lastIndexOf(']');
  if (a >= 0 && b > a) { try { const v = JSON.parse(s.slice(a, b + 1)); if (Array.isArray(v)) return v; } catch (e) { /* continue */ } }
  const objs = [...s.matchAll(/\{[^{}]*"label"[^{}]*\}/g)].map((m) => { try { return JSON.parse(m[0]); } catch (e) { return null; } }).filter(Boolean);
  return objs.length ? objs : null;
}

/* 精选评论：每类挑一条最有代表性的（关键词信号最强） */
function pickFeatured(rows) {
  const out = [];
  LABELS.forEach((label) => {
    const pool = rows.filter((r) => r.label === label);
    if (!pool.length) return;
    pool.sort((a, b) => b.signal - a.signal || b.text.length - a.text.length);
    const top = pool[0];
    out.push({ label, no: top.no, text: top.text, user: top.user, time: top.time, reason: top.reason });
  });
  return out;
}

function signalOf(text, label) {
  const words = label === '好评'
    ? ['非常', '很', '棒', '赞', '满意', '推荐', '超出预期', '惊喜', '五星', '划算', '喜欢']
    : label === '差评'
      ? ['非常', '太', '差', '失望', '退货', '退款', '糟糕', '不推荐', '敷衍', '假货', '浪费']
      : ['一般', '中规中矩', '还行', '尚可', '普通', '基本'];
  const t = String(text);
  return words.filter((w) => t.includes(w)).length;
}

router.post('/analyze', upload.single('file'), async (req, res) => {
  if (!req.file) return res.json({ code: 4001, msg: '未收到 Excel 文件', data: null });

  const filename = Buffer.from(req.file.originalname, 'latin1').toString('utf8').trim() || req.file.originalname;

  try {
    const buf = Buffer.isBuffer(req.file.buffer) ? req.file.buffer : null;
    if (!buf) throw new Error('文件缓冲区为空');

    const wb = XLSX.read(buf, { type: 'buffer', cellDates: false });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    /* 定位评论列：优先「评论内容/评论/内容/comment/review/text」 */
    const keys = Object.keys(raw[0] || {});
    const textKey = keys.find((k) => /评论内容|评论|内容|comment|review|text/i.test(k)) || keys.find((k) => typeof raw[0][k] === 'string' && String(raw[0][k]).length > 8) || keys[0];
    if (!textKey) throw new Error('Excel 中没有可识别的评论列');

    const reviews = raw.map((row, i) => ({
      no: i + 1,
      text: String(row[textKey] || '').trim(),
      user: String(row['用户昵称'] || row['用户'] || row['昵称'] || ('用户' + (i + 1))).trim(),
      time: String(row['评论时间'] || row['时间'] || row['日期'] || '').trim()
    })).filter((r) => r.text.length > 0);

    if (!reviews.length) throw new Error('Excel 中没有解析到评论内容');
    if (reviews.length > 200) throw new Error('单次最多支持 200 条评论');

    console.log('\n[SENTIMENT] 文件：' + filename + '，解析到 ' + reviews.length + ' 条评论，评论列：' + textKey);

    const prompt = buildPrompt(reviews);
    let classifications;
    let llmRaw;
    let usage;
    let mode;

    if (config.llm.mock) {
      /* 离线演示：仍按真实链路打印请求/响应报文 */
      console.log('\n================ [→ 发送给大模型] ================');
      console.log('时间    ：' + new Date().toLocaleString('zh-CN'));
      console.log('地址    ：POST ' + config.llm.baseURL + '/chat/completions');
      console.log('模型    ：' + config.llm.model + ' | stream=false | temperature=0');
      console.log('场景    ：商业评论情感分类（离线演示模式）');
      console.log('请求体  ：\n' + JSON.stringify({ model: config.llm.model, messages: [{ role: 'user', content: prompt }], stream: false }, null, 2));
      console.log('==================================================');

      await new Promise((r) => setTimeout(r, 350));
      classifications = reviews.map((r) => ({ no: r.no, label: heuristic(r.text), reason: '关键词判定（演示模式）' }));
      llmRaw = { choices: [{ message: { role: 'assistant', content: JSON.stringify(classifications) } }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } };
      usage = llmRaw.usage;
      mode = '演示模式（关键词启发式）';
      console.log('\n================ [← 从大模型接收] ================');
      console.log('原始响应：\n' + JSON.stringify(llmRaw, null, 2));
      console.log('回复内容：\n' + JSON.stringify(classifications));
      console.log('==================================================\n');
    } else {
      try {
        const result = await llm.chat({
          messages: [{ role: 'system', content: '你是严谨的情感分析器，只输出 JSON，不输出多余文字。' }, { role: 'user', content: prompt }],
          stream: false,
          temperature: 0,
          scene: '商业评论情感分类（' + reviews.length + ' 条）'
        });
        usage = result.usage;
        llmRaw = result.raw;
        const arr = extractArray(result.content);
        if (!arr) throw new Error('大模型返回内容无法解析为分类结果：' + String(result.content).slice(0, 120));
        classifications = reviews.map((r, i) => {
          const hit = arr.find((x) => Number(x.no) === r.no) || arr[i] || {};
          let label = String(hit.label || '').trim();
          if (!LABELS.includes(label)) label = heuristic(r.text);
          return { no: r.no, label, reason: String(hit.reason || '模型判定').slice(0, 60) };
        });
        mode = config.llm.model;
      } catch (e) {
        /* 真实模型不可用（限流/欠费/网络/格式异常）时自动降级，保证功能可用 */
        console.warn('[SENTIMENT] 大模型不可用，自动降级为关键词启发式：' + e.message);
        classifications = reviews.map((r) => ({ no: r.no, label: heuristic(r.text), reason: 'LLM 不可用，关键词判定' }));
        mode = '启发式兜底（LLM：' + e.message.slice(0, 60) + '）';
      }
    }

    const rows = reviews.map((r, i) => Object.assign({}, r, classifications[i] || { label: heuristic(r.text), reason: '兜底判定' }));
    rows.forEach((r) => { r.signal = signalOf(r.text, r.label); });

    const stats = { 好评: 0, 中评: 0, 差评: 0 };
    rows.forEach((r) => { if (stats[r.label] !== undefined) stats[r.label]++; });

    const featured = pickFeatured(rows);
    console.log('[SENTIMENT] 分类完成：' + JSON.stringify(stats) + '，精选 ' + featured.length + ' 条');

    ok(res, {
      filename,
      total: rows.length,
      stats,
      labels: rows.map((r) => r.label),
      reviews: rows.map(({ signal, ...rest }) => rest),
      featured,
      usage: usage || null,
      mode
    }, 'analyzed');
  } catch (e) {
    console.error('[SENTIMENT] 处理失败：', e.message);
    res.json({ code: 5002, msg: '情感分类失败：' + e.message, data: null });
  }
});

router.get('/sample-files', (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const dir = path.join(__dirname, '..', '..', 'samples');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.xlsx')) : [];
  ok(res, { files: files.map((f) => ({ name: f, url: '/samples/' + encodeURIComponent(f) })) });
});

module.exports = router;
