/**
 * 知识库路由：/api/kb
 * 文件上传（内存接收）→ 文本解析 → 语义切分 → 入库 → 重建检索索引
 */
const express = require('express');
const multer = require('multer');
const router = express.Router();

const store = require('../services/store');
const parser = require('../services/parser');
const rag = require('../services/rag');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 } // 30MB
});

const ok = (res, data, msg) => res.json({ code: 0, msg: msg || 'ok', data });

/* 上传并解析（同步返回解析进度） */
router.post('/documents', upload.single('file'), async (req, res) => {
  if (!req.file) return res.json({ code: 4001, msg: '未收到文件', data: null });
  const filename = Buffer.from(req.file.originalname, 'latin1').toString('utf8').trim();
  console.log('\n[KB] 收到文件：' + filename + '（' + req.file.size + ' 字节）');

  try {
    const text = await parser.parse(req.file.buffer, filename);
    const chunks = rag.chunkText(text);
    const ext = parser.extOf(filename).replace(/^\./, '');

    const doc = await store.addDocument(
      { filename, ext, size: req.file.size, chars: text.replace(/\s/g, '').length },
      chunks
    );

    await rag.rebuild();
    console.log('[KB] 解析完成，分块 ' + chunks.length + ' 个，入库文档 id=' + doc.id);
    ok(res, { id: doc.id, filename, ext, chunks: chunks.length, chars: doc.chars }, 'parsed');
  } catch (e) {
    console.error('[KB] 解析失败：', e.message);
    res.json({ code: 5001, msg: '解析失败：' + e.message, data: null });
  }
});

router.get('/documents', async (req, res) => {
  const list = await store.listDocuments();
  ok(res, { documents: list, count: list.length });
});

router.get('/documents/:id/chunks', async (req, res) => {
  const chunks = await store.getChunksByDoc(req.params.id);
  ok(res, { documentId: Number(req.params.id), chunks, count: chunks.length });
});

router.delete('/documents/:id', async (req, res) => {
  await store.deleteDocument(req.params.id);
  await rag.rebuild();
  ok(res, { id: Number(req.params.id) }, 'deleted');
});

/* 检索调试接口 */
router.post('/search', async (req, res) => {
  const { query, topK } = req.body || {};
  if (!query) return res.json({ code: 4001, msg: 'query 不能为空', data: null });
  const hits = rag.retrieve(String(query), Number(topK) || undefined);
  ok(res, { query, hits, count: hits.length });
});

router.get('/stats', async (req, res) => {
  const docs = await store.listDocuments();
  const chars = docs.reduce((sum, d) => sum + (d.chars || 0), 0);
  ok(res, Object.assign(rag.stats(), { chars }));
});

module.exports = router;
