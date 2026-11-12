/**
 * 多轮上下文管理：保留最近 N 轮原文，更早的对话压缩为一段摘要，并受 Token/字符预算约束
 */
const config = require('../config');

/**
 * @param {Array}  history  历史消息 [{role, content}]（按时间升序，含 user/assistant）
 * @param {Object} opts     { maxRounds, budgetChars }
 * @returns {{ messages: Array, summary: String, dropped: Number }}
 */
function compress(history, opts) {
  const maxRounds = (opts && opts.maxRounds) || config.context.maxRounds;
  const budget = (opts && opts.budgetChars) || config.context.budgetChars;

  const maxMessages = maxRounds * 2;
  const recent = maxMessages > 0 ? history.slice(-maxMessages) : [];
  const older = maxMessages > 0 ? history.slice(0, Math.max(0, history.length - maxMessages)) : history.slice();

  /* 更早的对话压成摘要：保留每轮的用户提问要点，限制总长度 */
  let summary = '';
  if (older.length) {
    const lines = older
      .filter((m) => m.role === 'user')
      .map((m) => '- ' + String(m.content).replace(/\s+/g, ' ').slice(0, 60));
    if (lines.length) {
      summary = '更早的对话摘要（已压缩，仅供参考）：\n' + lines.join('\n').slice(0, 600);
    }
  }

  /* 预算控制：从最近往前累加，超出预算的旧消息丢弃 */
  const kept = [];
  let used = 0;
  for (let i = recent.length - 1; i >= 0; i--) {
    const len = String(recent[i].content || '').length;
    if (used + len > budget && kept.length > 0) break;
    used += len;
    kept.unshift(recent[i]);
  }

  return {
    messages: kept,
    summary,
    dropped: history.length - kept.length
  };
}

/** 组装最终发送给模型的消息数组（system + 摘要 + 历史 + 本轮提问/参考资料） */
function build(opts) {
  const messages = [{ role: 'system', content: opts.system }];
  const c = compress(opts.history || [], opts);

  if (c.summary) {
    messages.push({ role: 'system', content: c.summary });
  }

  c.messages.forEach((m) => messages.push({ role: m.role, content: m.content }));
  messages.push({ role: 'user', content: opts.userContent });

  return { messages, summary: c.summary, dropped: c.dropped, kept: c.messages.length };
}

module.exports = { build, compress };
