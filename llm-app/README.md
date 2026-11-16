# LLM 应用设计实验 · 知识库问答系统（RAG）

高梓括 · 第 18 章「基于知识库的智能客服系统」课程实验项目。

一个**前后端分离**的本地知识库问答系统：后端用 Node.js + Express 做中间层（文件解析、RAG 检索、大模型调度、会话持久化），前端用**原生 HTML/CSS/JS（无第三方框架、无 CDN）**实现智能问答与知识库管理，所有请求/响应报文打印到浏览器控制台。

---

## 1. 功能概览

| 模块 | 说明 |
|---|---|
| 智能问答 | 基于本地知识库的流式问答；会话管理（新建/重命名/删除/历史加载）；RAG 检索开关；引用来源溯源 |
| **AI 生图与语音识别** | 文生图用 `OpenMOSS-Team/MOSS-Image`（硅基流动 `/images/generations`，支持中文/长文本排版）；语音识别用 `FunAudioLLM/SenseVoiceSmall`（`/audio/transcriptions`，Qwen 多模态可切换）+ 浏览器实时录音；转写文本可整理摘要/关键词/意图 |
| **商业评论情感分类** | 上传 Excel（.xlsx/.xls），LLM 逐条判断好评/中评/差评；前端饼状图展示分布、精选评论、完整明细；大模型收发报文在服务端终端与浏览器控制台打印；附 3 份各 20 条的模拟数据 |
| 知识库管理 | 上传 TXT / MD / PDF / DOC / DOCX / PPT / PPTX，服务端自动解析、语义切分、入库建索引；支持上传进度、解析状态、分块预览、删除、检索测试 |
| RAG 检索 | BM25（中文 bigram + 英文词），拼接 Top-K 命中分块进提示词，回答标注来源编号 |
| 大模型 | 兼容 OpenAI 接口的任意厂商（默认七牛 `qiniu/conatus-free`），`.env` 配置，密钥不写入前端 |
| 存储 | 默认本地 JSON 文件；配置 MySQL 8.0 后自动切换为数据库（含建表脚本与测试数据） |

---

## 2. 目录结构

```
llm-app/
├─ backend/                  # Node.js + Express 中间层
│  ├─ server.js              # 服务入口：加载存储、重建 RAG 索引、挂载路由、静态前端
│  ├─ config.js              # 配置（端口 / 大模型 / 存储 / 离线演示开关），读取 .env
│  ├─ .env / .env.example    # 环境变量（API Key 不入库）
│  ├─ routes/
│  │  ├─ ai.js               # /api/ai/chat  流式问答（SSE）
│  │  ├─ conversations.js    # /api/conversations 会话增删改查 + 消息
│  │  ├─ kb.js               # /api/kb 文档上传/列表/删除/分块/检索/统计
│  │  ├─ sentiment.js        # /api/sentiment Excel 解析 + LLM 情感分类 + 兜底降级
│  │  └─ recognition.js      # /api/recognition 生图（OpenMOSS）/ 语音识别（SenseVoice）/ 文本整理
│  ├─ services/
│  │  ├─ store.js            # 存储抽象：MySQL 或本地 JSON（运行时切换）
│  │  ├─ parser.js           # 文件解析：txt/md/pdf/doc/docx/ppt/pptx/csv/json
│  │  ├─ rag.js              # 文本切分 + BM25 检索 + 索引构建
│  │  ├─ llm.js              # 大模型调用（流式/非流式）+ 离线演示模式
│  │  └─ context.js          # 提示词拼装：系统提示 + 检索资料 + 历史 + 用户问题
│  ├─ sql/schema.sql         # MySQL 8.0 建表 + 测试数据（≥8 条）
│  └─ scripts/
│     ├─ init-db.js          # 数据库初始化脚本
│     └─ gen-samples.js      # 生成 3 份各 20 条评论的 Excel 模拟数据
├─ samples/                  # 3 份模拟数据（餐饮/数码/电商，各 20 条评论）
└─ frontend/                 # 原生前端（无第三方依赖）
   ├─ index.html             # 门户：项目说明、架构、服务状态
   ├─ chat.html + js/chat.js  # 智能问答页
   ├─ kb.html + js/kb.js      # 知识库管理页
   ├─ sentiment.html + js/sentiment.js  # 商业评论情感分类页（饼图 + 精选评论）
   ├─ css/style.css          # 统一深色主题
   └─ js/{api,md}.js         # 请求封装（控制台日志）/ 轻量 Markdown 渲染
```

### 情感分类使用

浏览器打开 `http://localhost:8325/sentiment.html`：
1. 侧栏「模拟数据」可直接下载 3 份 Excel（各 20 条评论），或上传自己的 `.xlsx`（含「评论内容」列）。
2. 点击「开始情感分类」→ LLM 批量分类为好评/中评/差评 → 饼状图 + 精选评论 + 明细表。
3. 请求体（含完整提示词与评论列表）与响应体（LLM 原始 JSON）在服务端终端打印；HTTP 请求/响应在浏览器 Console 打印。
4. 若 API 欠费/限流/网络异常，自动降级为关键词启发式分类，页面 `mode` 会标注来源。
5. `npm run gen:samples` 可重新生成模拟数据。

### 生图与语音识别使用

浏览器打开 `http://localhost:8325/recognition.html`：
1. **AI 生图**：填提示词/尺寸/步数/引导系数 → 调用硅基流动 `OpenMOSS-Team/MOSS-Image` → 展示并下载图片。
2. **语音识别**：上传 MP3/WAV/M4A/WEBM 或浏览器实时录音 → 调用 `FunAudioLLM/SenseVoiceSmall` ASR → 显示逐字稿 → 可再整理摘要/关键词/意图。
3. 在 `.env` 配 `SF_API_KEY`（硅基流动）后走真实接口；未配置或调用失败时自动用本地演示结果（生图为 SVG 示意图、语音为示例文本），页面 `mode` 会标注。
4. 想用 Qwen 多模态做语音识别：把 `SF_SPEECH_MODEL=Qwen/Qwen2.5-Omni-7B`，并将路由中的 `/audio/transcriptions` 切换为 chat/completions 的 `input_audio` 内容块即可（文档见 `yuan_interface.md`）。

---

## 3. 快速开始

### 3.1 后端

```bash
cd backend
npm install
cp .env.example .env      # 填入 LLM_API_KEY / LLM_BASE_URL / LLM_MODEL
npm start                 # 启动后监听 http://localhost:8325
```

可选环境变量（在 `.env` 中）：

| 变量 | 说明 | 默认 |
|---|---|---|
| `PORT` | 服务端口 | `8325` |
| `LLM_API_KEY` | 大模型 API Key | 必填 |
| `LLM_BASE_URL` | OpenAI 兼容基础地址 | `https://api.qnaigc.com/v1` |
| `LLM_MODEL` | 模型名 | `qiniu/conatus-free` |
| `LLM_TEMPERATURE` / `LLM_MAX_TOKENS` | 采样参数 | `0.3` / `1600` |
| `DB_ENABLED` | 是否启用 MySQL | `false` |
| `LLM_MOCK` | 离线演示模式（不调真实接口） | `false` |

### 3.2 知识库（MySQL，可选）

未配置 MySQL 时，系统自动使用本地 JSON 存储（数据写入 `backend/data/*.json`），无需任何外部依赖即可运行。若使用 MySQL 8.0：

```bash
# 先建库并写入表结构与测试数据
node scripts/init-db.js
# 在 .env 中设置 DB_ENABLED=true 及 DB_HOST/DB_USER/DB_PASSWORD/DB_NAME=llm_rag
npm start
```

### 3.3 前端

前端为静态资源，由后端 `express.static` 直接托管（已配置）。启动后端后浏览器访问：

- 门户：`http://localhost:8325/index.html`
- 问答：`http://localhost:8325/chat.html`
- 知识库：`http://localhost:8325/kb.html`

> 仅做前端本地预览也可：在 `frontend/` 下用任意静态服务器打开（如 `npx serve`）。
> 所有接口请求/响应数据会在浏览器 **Console（F12）** 打印。

---

## 4. 接口约定

- 统一前缀 `/api`，统一响应格式 `{ code, msg, data }`（`code=0` 表示成功）。
- 问答接口 `/api/ai/chat` 支持流式：请求体 `{"stream":true}` 时以 `text/event-stream` 返回 SSE 事件：
  - `meta`：会话 ID、命中来源 `citations`、检索/模型耗时
  - `delta`：流式文本增量
  - `done`：结束事件，含 `usage`
  - `error`：错误事件
- 详细接口定义见 [`backend/yuan_interface.md`](backend/yuan_interface.md)；数据库表结构见 [`backend/yuan_database.md`](backend/yuan_database.md)。

---

## 5. 提交说明

按实验要求，提交时将该目录打包为 `学号-姓名.zip`（如 `2023xxxx-高梓括.zip`）。详见 [`yuanlei_prompt.md`](yuanlei_prompt.md)。

---

## 6. 常见问题

- **429 / 模型限流**：免费模型有请求频率限制，可在 `.env` 设置 `LLM_MOCK=true` 启用离线演示模式验证完整链路。
- **PDF 解析**：服务端用 `pdfjs-dist` 解析；若文档为扫描件（无文本层）将无法抽取文字，建议转为 TXT/MD 上传。
- **服务连不上**：确认 `backend` 已 `npm start` 且端口未被占用；门户页顶部状态条会显示后端连通情况。
