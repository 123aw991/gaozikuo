/**
 * AI 路由：/api/ai/chat
 * - 统一响应格式 { code, msg, data }
 * - 支持 SSE 流式输出（Content-Type: text/event-stream）
 * - 自动落库用户消息与模型回复，保存引用来源
 */
const express = require('express');
const router = express.Router();

const store = require('../services/store');
const rag = require('../services/rag');
const llm = require('../services/llm');
const ctx = require('../services/context');
const config = require('../config');

const SYSTEM_CHAT =
  '你是一个专业、友好的中文 AI 助手，回答准确、简洁，必要时给出分点说明或代码示例。';

const SYSTEM_RAG =
  '你是企业知识库问答助手。请严格依据【参考资料】回答用户问题：\n' +
  '1. 只使用参考资料中的信息；资料没有的内容要明确说明“知识库中未提及”，不要编造；\n' +
  '2. 引用资料时在句末标注来源编号，例如 [1][2]；\n' +
  '3. 使用简体中文，条理清晰，必要时分点列出；\n' +
  '4. 若资料之间冲突，以编号靠前、表述更具体的为准。';

function sseWrite(res, obj) {
  res.write('data: ' + JSON.stringify(obj) + '\n\n');
  if (typeof res.flush === 'function') res.flush();
}

router.post('/chat', async (req, res) => {
  const { conversationId, message, useKb, topK, stream } = req.body || {};

  if (!message || !String(message).trim()) {
    return res.json({ code: 4001, msg: '消息不能为空', data: null });
  }
  if (String(message).length > 4000) {
    return res.json({ code: 4002, msg: '消息过长（上限 4000 字）', data: null });
  }

  const useStream = stream !== false;

  try {
    /* 1. 会话：不存在则自动创建 */
    let convId = conversationId;
    let conversation;
    if (!convId) {
      conversation = await store.createConversation(String(message).slice(0, 20));
      convId = conversation.id;
    }

    /* 2. 读取历史（在写入本轮消息之前） */
    const history = (await store.listMessages(convId)).map((m) => ({ role: m.role, content: m.content }));

    /* 3. 落库用户消息 */
    await store.addMessage(convId, 'user', String(message));

    /* 4. RAG 检索 */
    const wantKb = useKb !== false;
    const hits = wantKb ? rag.retrieve(String(message), Number(topK) || config.rag.topK) : [];

    if (wantKb) {
      console.log('\n[检索] 问题：' + message);
      console.log('[检索] 命中 ' + hits.length + ' 个分块：' +
        hits.map((h) => h.filename + '#' + (h.seq + 1) + '(' + h.rel + ')').join(', '));
    }

    /* 5. 组装提示词 */
    const contextText = rag.buildContext(hits);
    const userContent = hits.length
      ? '【参考资料】\n' + contextText + '\n\n【用户问题】\n' + message
      : (wantKb
          ? '【用户问题】\n' + message + '\n\n（本地知识库未检索到相关资料，请明确说明“知识库中未提及”，并给出通用建议。）'
          : String(message));

    const built = ctx.build({
      system: wantKb ? SYSTEM_RAG : SYSTEM_CHAT,
      history,
      userContent
    });

    console.log('[上下文] 历史消息 ' + history.length + ' 条，保留 ' + built.kept +
      ' 条，压缩丢弃 ' + built.dropped + ' 条' + (built.summary ? '（含摘要）' : ''));

    /* 6. 流式 / 非流式响应 */
    if (!useStream) {
      const result = await llm.chat({ messages: built.messages, stream: false, scene: wantKb ? 'RAG 问答' : '普通对话' });
      await store.addMessage(convId, 'assistant', result.content);
      return res.json({
        code: 0,
        msg: 'ok',
        data: {
          conversationId: convId,
          content: result.content,
          citations: hits.map((h, i) => ({ no: i + 1, filename: h.filename, seq: h.seq, rel: h.rel, text: h.text })),
          usage: result.usage,
          context: { kept: built.kept, dropped: built.dropped, hasSummary: !!built.summary }
        }
      });
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    sseWrite(res, {
      type: 'meta',
      conversationId: convId,
      citations: hits.map((h, i) => ({ no: i + 1, filename: h.filename, seq: h.seq, rel: h.rel, text: h.text })),
      context: { kept: built.kept, dropped: built.dropped, hasSummary: !!built.summary },
      retrieval: hits.map((h) => ({ filename: h.filename, seq: h.seq, score: h.score, rel: h.rel }))
    });

    let aborted = false;
    req.on('close', () => { aborted = true; });

    const result = await llm.chat({
      messages: built.messages,
      stream: true,
      scene: wantKb ? 'RAG 问答' : '普通对话',
      onDelta: (text) => {
        if (!aborted) sseWrite(res, { type: 'delta', content: text });
      }
    });

    if (result.content) {
      await store.addMessage(convId, 'assistant', result.content);
    }

    sseWrite(res, { type: 'done', usage: result.usage, reasoning: result.reasoning || '' });
    res.end();
  } catch (e) {
    console.error('[AI] 调用失败：', e.message);
    if (res.headersSent) {
      sseWrite(res, { type: 'error', msg: e.message });
      res.end();
    } else {
      res.json({ code: 5001, msg: '大模型调用失败：' + e.message, data: null });
    }
  }
});

module.exports = router;
