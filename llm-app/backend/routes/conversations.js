/**
 * 会话管理路由：/api/conversations
 * 统一响应格式 { code, msg, data }
 */
const express = require('express');
const router = express.Router();
const store = require('../services/store');

const ok = (res, data, msg) => res.json({ code: 0, msg: msg || 'ok', data });

router.get('/', async (req, res) => {
  const list = await store.listConversations();
  ok(res, { conversations: list, count: list.length });
});

router.post('/', async (req, res) => {
  const { title } = req.body || {};
  const conv = await store.createConversation((title || '').trim());
  ok(res, conv, 'created');
});

router.patch('/:id', async (req, res) => {
  const { title } = req.body || {};
  if (!title || !String(title).trim()) return res.json({ code: 4001, msg: '标题不能为空', data: null });
  const updated = await store.renameConversation(req.params.id, String(title).trim());
  ok(res, updated, 'renamed');
});

router.delete('/:id', async (req, res) => {
  await store.deleteConversation(req.params.id);
  ok(res, { id: Number(req.params.id) }, 'deleted');
});

router.get('/:id/messages', async (req, res) => {
  const messages = await store.listMessages(req.params.id);
  ok(res, { conversationId: Number(req.params.id), messages, count: messages.length });
});

module.exports = router;
