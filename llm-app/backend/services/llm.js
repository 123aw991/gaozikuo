/**
 * LLM 调用层：统一封装 chat/completions（支持流式），并在终端打印请求体与响应体
 */
const config = require('../config');

function maskKey(key) {
  if (!key) return '(未配置)';
  return key.slice(0, 6) + '****' + key.slice(-4);
}

function logRequest(url, body, extra) {
  console.log('\n================ [→ 发送给大模型] ================');
  console.log('时间    ：' + new Date().toLocaleString('zh-CN'));
  console.log('地址    ：POST ' + url);
  console.log('模型    ：' + body.model + ' | stream=' + body.stream + ' | temperature=' + body.temperature);
  console.log('鉴权    ：Bearer ' + maskKey(config.llm.apiKey));
  if (extra) console.log('场景    ：' + extra);
  console.log('请求体  ：\n' + JSON.stringify(body, null, 2));
  console.log('==================================================');
}

function logResponse(data, elapsed, streamed) {
  console.log('\n================ [← 从大模型接收] ================');
  console.log('耗时    ：' + elapsed + ' ms' + (streamed ? '（流式汇总）' : ''));
  if (streamed) {
    console.log('分块数  ：' + data.chunks);
    console.log('回复内容：\n' + data.content);
  } else {
    console.log('原始响应：\n' + JSON.stringify(data.raw, null, 2));
    console.log('回复内容：\n' + data.content);
  }
  if (data.usage) console.log('Token   ：' + JSON.stringify(data.usage));
  console.log('==================================================\n');
}

/**
 * @param {Object} opts
 * @param {Array}  opts.messages  消息数组
 * @param {Boolean} opts.stream   是否流式
 * @param {Function} opts.onDelta 流式增量回调
 * @param {String} opts.scene     场景说明（写日志用）
 */
async function chat(opts) {
  const url = config.llm.baseURL + '/chat/completions';
  const body = {
    model: config.llm.model,
    messages: opts.messages,
    stream: !!opts.stream,
    temperature: config.llm.temperature,
    max_tokens: config.llm.maxTokens
  };

  if (!config.llm.apiKey) throw new Error('未配置 LLM_API_KEY，请检查 backend/.env');

  /* 离线演示模式：不调用真实接口，模拟流式回复 */
  if (config.llm.mock) {
    const fake = (opts.mockText ||
      '【演示模式·离线模拟】根据知识库资料显示：本系统支持 7x24 小时自动应答，' +
      '退货需商品完好且不影响二次销售，自签收次日起 7 日内可申请；人工客服服务时间为每日 9:00–21:00。') +
      (opts.citations ? '' : '');
    console.log('\n================ [演示模式] 离线模拟回复 ================');
    console.log('场景：' + (opts.scene || '未知') + ' | stream=' + body.stream);
    if (!body.stream) {
      const result = { content: fake, usage: { total_tokens: Math.ceil(fake.length / 2) }, reasoning: '', raw: { mock: true } };
      logResponse(result, 0, false);
      return result;
    }
    const parts = fake.match(/[\s\S]{1,3}/g) || [fake];
    let content = '';
    for (const p of parts) {
      await new Promise((r) => setTimeout(r, 18));
      content += p;
      if (typeof opts.onDelta === 'function') opts.onDelta(p);
    }
    const result = { content, usage: { total_tokens: Math.ceil(content.length / 2) }, reasoning: '', chunks: parts.length };
    logResponse(result, 0, true);
    return result;
  }

  logRequest(url, body, opts.scene);

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeout || config.llm.timeout);

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + config.llm.apiKey
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error('调用大模型超时（' + (opts.timeout || config.llm.timeout) + ' ms）');
    throw new Error('网络请求失败：' + e.message);
  }

  console.log('[HTTP] 状态码：' + res.status + ' ' + res.statusText);

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    clearTimeout(timer);
    console.error('[← 大模型错误响应] ' + text.slice(0, 800));
    throw new Error('大模型返回 HTTP ' + res.status + '：' + (text || res.statusText).slice(0, 300));
  }

  /* ---------------- 非流式 ---------------- */
  if (!body.stream) {
    const data = await res.json();
    clearTimeout(timer);
    const message = (data.choices && data.choices[0] && data.choices[0].message) || {};
    const result = { content: message.content || '', usage: data.usage || null, reasoning: message.reasoning_content || '', raw: data };
    logResponse(result, Date.now() - started, false);
    return result;
  }

  /* ---------------- 流式 ---------------- */
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let content = '';
  let reasoning = '';
  let usage = null;
  let chunks = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const raw of lines) {
        const line = raw.trim();
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;

        let obj;
        try {
          obj = JSON.parse(payload);
        } catch (e) {
          continue;
        }
        chunks++;
        const delta = obj.choices && obj.choices[0] && obj.choices[0].delta;
        if (delta) {
          if (delta.reasoning_content) reasoning += delta.reasoning_content;
          if (delta.content) {
            content += delta.content;
            if (typeof opts.onDelta === 'function') opts.onDelta(delta.content);
          }
        }
        if (obj.usage) usage = obj.usage;
      }
    }
  } finally {
    clearTimeout(timer);
  }

  const result = { content, usage, reasoning, chunks };
  logResponse(result, Date.now() - started, true);
  return result;
}

module.exports = { chat, maskKey };
