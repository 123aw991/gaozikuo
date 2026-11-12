/**
 * 服务入口：Express 中间层 + 静态前端 + /api 路由 + RAG 索引
 */
const express = require('express');
const path = require('path');
const cors = require('cors');
const config = require('./config');
const store = require('./services/store');
const rag = require('./services/rag');

const aiRoutes = require('./routes/ai');
const convRoutes = require('./routes/conversations');
const kbRoutes = require('./routes/kb');

async function main() {
  await store.init();
  const n = await rag.rebuild();
  console.log('[启动] RAG 索引分块数：' + n + '，存储引擎：' + (store.isMySQL() ? 'MySQL' : '本地 JSON'));

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));
  app.use(express.static(config.frontendDir));

  app.use((req, res, next) => {
    if (req.originalUrl.startsWith('/api')) {
      console.log('[HTTP] ' + req.method + ' ' + req.originalUrl);
    }
    next();
  });

  app.get('/api/health', async (req, res) => {
    res.json({
      code: 0,
      msg: 'ok',
      data: {
        status: 'up',
        version: config.version,
        storage: store.isMySQL() ? 'mysql' : 'json',
        llmModel: config.llm.model,
        rag: rag.stats()
      }
    });
  });

  app.use('/api/ai', aiRoutes);
  app.use('/api/conversations', convRoutes);
  app.use('/api/kb', kbRoutes);

  app.use((req, res) => res.status(404).json({ code: 4040, msg: 'Not Found', data: null }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('[ERROR]', err);
    res.status(500).json({ code: 5000, msg: '服务器内部错误', data: null });
  });

  app.listen(config.port, () => {
    console.log('\n✅ LLM 应用服务已启动：http://localhost:' + config.port);
    console.log('   前端入口：http://localhost:' + config.port + '/index.html\n');
  });
}

main().catch((e) => {
  console.error('启动失败：', e);
  process.exit(1);
});
