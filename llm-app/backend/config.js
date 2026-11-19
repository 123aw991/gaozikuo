/**
 * 统一配置：所有敏感信息只从 .env 读取，代码中不出现明文密钥
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

module.exports = {
  port: num(process.env.PORT, 8325),
  llm: {
    baseURL: (process.env.LLM_BASE_URL || 'https://api.qnaigc.com/v1').replace(/\/+$/, ''),
    apiKey: process.env.LLM_API_KEY || '',
    model: process.env.LLM_MODEL || 'qiniu/conatus-free',
    timeout: num(process.env.LLM_TIMEOUT, 90000),
    temperature: Number(process.env.LLM_TEMPERATURE || 0.3),
    maxTokens: num(process.env.LLM_MAX_TOKENS, 1600),
    // 离线演示模式：置 true 时不调用真实大模型，返回模拟流式回复（便于无网络/无额度时演示）
    mock: String(process.env.LLM_MOCK || 'false').toLowerCase() === 'true'
  },
  // 多模态：硅基流动（生图 OpenMOSS-Team/MOSS-Image，语音 Qwen/Qwen2.5-Omni）
  multimodal: {
    baseURL: (process.env.SF_BASE_URL || 'https://api.siliconflow.cn/v1').replace(/\/+$/, ''),
    apiKey: process.env.SF_API_KEY || '',
    imageModel: process.env.SF_IMAGE_MODEL || 'OpenMOSS-Team/MOSS-Image',
    speechModel: process.env.SF_SPEECH_MODEL || 'Qwen/Qwen2.5-Omni-7B',
    timeout: num(process.env.SF_TIMEOUT, 120000)
  },
  auth: {
    secret: process.env.AUTH_SECRET || 'llm-app-dev-secret-change-me',
    tokenHours: num(process.env.AUTH_TOKEN_HOURS, 72)
  },
  db: {
    enabled: String(process.env.DB_ENABLED || 'false').toLowerCase() === 'true',
    host: process.env.DB_HOST || '127.0.0.1',
    port: num(process.env.DB_PORT, 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'llm_rag'
  },
  rag: {
    chunkSize: num(process.env.RAG_CHUNK_SIZE, 420),
    overlap: num(process.env.RAG_OVERLAP, 80),
    topK: num(process.env.RAG_TOP_K, 4)
  },
  context: {
    maxRounds: num(process.env.CTX_MAX_ROUNDS, 6),   // 保留最近 N 轮原文
    budgetChars: num(process.env.CTX_BUDGET_CHARS, 6000) // 上下文预算（字符）
  },
  dataDir: path.join(__dirname, 'data'),
  frontendDir: path.join(__dirname, '..', 'frontend'),
  version: '1.0.0'
};
