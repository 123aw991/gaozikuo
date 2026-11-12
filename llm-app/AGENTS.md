# AGENTS.md

面向 AI 协作代理的本项目说明。

## 项目性质
`llm-app/` 是「基于知识库的智能客服系统」课程实验（第 18 章）的**全栈实现**：
- 后端 `backend/`：Node.js + Express 中间层（文件解析、BM25 RAG、大模型调度、会话持久化）。
- 前端 `frontend/`：原生 HTML/CSS/JS，**无任何第三方框架或 CDN 依赖**，所有库（markdown 渲染等）均为自写。
- 数据库：MySQL 8.0（`sql/schema.sql` + `scripts/init-db.js`），未配置时自动回退本地 JSON。

## 运行
```bash
cd backend && npm install && npm start   # 默认 http://localhost:8325
```
- 大模型密钥在 `backend/.env`（已 gitignore），模板见 `.env.example`。
- `LLM_MOCK=true` 可启用离线演示（不调真实接口）。

## 关键约束（实验要求）
1. 前端不得引入外部框架/CDN；仅允许原生 API。
2. 所有接口前缀 `/api`，统一响应 `{ code, msg, data }`。
3. 问答接口必须支持 SSE 流式（`text/event-stream`，事件 meta/delta/done/error）。
4. 请求/响应报文需在浏览器控制台打印（`frontend/js/api.js` 已封装）。
5. 新页面需加入根目录 `index.html` 的卡片导航（若本目录入口需并入总门户）。
6. 提交格式：`学号-姓名.zip`。

## 文件导览
- `backend/routes/{ai,conversations,kb}.js`：路由层
- `backend/services/{store,parser,rag,llm,context}.js`：业务逻辑
- `backend/config.js`：配置（端口/大模型/存储/演示开关）
- `frontend/js/{api,md,chat,kb}.js`：前端逻辑
- `README.md` / `backend/yuan_interface.md` / `backend/yuan_database.md` / `yuanlei_prompt.md`：文档

## 修改注意
- 新增存储字段须同时更新 `store.js`（MySQL + JSON 两套实现）与 `sql/schema.sql`。
- 新增接口须在 `server.js` 挂载并补充 `yuan_interface.md`。
- 保持前端零外部依赖；如需新能力，优先自写小工具（如 `md.js`）。
