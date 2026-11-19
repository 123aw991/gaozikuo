# 接口设计文档（yuan_interface）

> 所有接口前缀为 `/api`，统一响应 `{ code: number, msg: string, data: any }`，`code === 0` 表示成功。
> 服务默认端口 `8325`，由 `backend/server.js` 提供静态前端与以下路由。

---

## 0000. 后台管理 `/api/admin`

> 管理员账号体系独立于前台用户。默认 `admin / admin123`（首次登录自动写入）。除 `/auth/login` 外，所有接口必须携带 `Authorization: Bearer <adminToken>`，否则统一返回 `code=401`。

### 0000.1 管理员登录
`POST /api/admin/auth/login`  body: `{ "username": "admin", "password": "admin123" }` → `{ token, admin: { id, username } }`

`GET /api/admin/auth/me` → `{ id, username, role: 'admin' }`（需鉴权）

### 0000.2 通用实体接口
实体名 `name` 取值：`users`（用户）、`conversations`（会话）、`documents`（知识库文档）。

| 操作 | 方法 / 路径 | 说明 |
|---|---|---|
| 列表 | `GET /api/admin/:name?keyword=&page=&pageSize=` | 搜索 + 分页，返回 `{ items, total, page, pageSize }` |
| 详情 | `GET /api/admin/:name/:id` | 会话附消息列表，文档附分块内容 |
| 新增 | `POST /api/admin/:name` | users: username/email/password；conversations: title；documents: filename/ext/chars/status |
| 修改 | `PUT /api/admin/:name/:id` | 传需要修改的字段；用户密码留空则不改 |
| 删除 | `DELETE /api/admin/:name/:id` | 会话/文档级联删除关联数据 |

### 0000.3 数据仪表盘
`GET /api/admin/dashboard`（需管理 Token）→ 全部字段由数据库/JSON 真实记录实时聚合：
```json
{
  "totals": { "users": 5, "conversations": 3, "messages": 7, "documents": 2, "chunks": 8 },
  "roleDist": { "user": 4, "assistant": 3, "system": 0 },
  "docStatus": { "ready": 2, "parsing": 0, "error": 0 },
  "extDist": [ { "name": "txt", "value": 1 }, { "name": "md", "value": 1 } ],
  "topConversations": [ { "id": 2, "title": "…", "count": 4 } ],
  "trend": [ { "date": "2026-11-19", "count": 7 } ],
  "generatedAt": "2026-11-19T…"
}
```
- `trend` 为近 7 天消息数（如实反映，无数据为 0）；`roleDist` 合计 = `totals.messages`；`docStatus` 合计 = `totals.documents`。
- 前端仪表盘用该接口数据绘制指标卡与 5 种 SVG 图表，无静态数据。

### 0000.4 鉴权拦截
所有管理接口（含列表、详情、增删改、`/entities`）均经 `adminRequired` 中间件；未登录/伪造 Token 返回：
```json
{ "code": 401, "msg": "未登录或登录已失效，请先登录管理后台", "data": null }
```
前台用户 Token 因签名密钥不同（`:admin` 后缀）无法通过后台鉴权。

---

## 000. 登录与注册 `/api/auth`

> 密码用 Node `crypto.scryptSync` 加盐哈希（不存明文）；Token 为 HMAC-SHA256 签名（`Authorization: Bearer <token>`），有效期由 `AUTH_TOKEN_HOURS` 配置（默认 72h）。

### 000.1 注册
`POST /api/auth/register`  body: `{ "username": "张三", "email": "a@b.com", "password": "abc123" }`
- 校验：用户名 2-20 位（字母/数字/下划线/中文）、邮箱格式、密码 6-64 位、用户名与邮箱唯一。
- 响应 `data`: `{ user: { id, username, email } }`

### 000.2 登录
`POST /api/auth/login`  body: `{ "account": "用户名或邮箱", "password": "abc123" }`
- 响应 `data`: `{ token, user: { id, username, email } }`

### 000.3 当前用户
`GET /api/auth/me`  header: `Authorization: Bearer <token>` → `{ id, username, email, last_login_at }`

### 000.4 登出
`POST /api/auth/logout`  header: `Authorization: Bearer <token>` → `{ ok: true }`（前端清除 localStorage 中的 token/user）

---

## 00. AI 生图与语音识别 `/api/recognition`

> 多模态能力统一走硅基流动 `https://api.siliconflow.cn/v1`。请求/响应报文在服务端终端打印（base64 自动截断）。

### 00.1 文生图
`POST /api/recognition/image/generate`  body: `{ "prompt": "...", "imageSize": "1024x1024", "steps": 20, "guidance": 7.5 }`

- 上游：`POST {SF_BASE_URL}/images/generations`，model `OpenMOSS-Team/MOSS-Image`，header `X-Enable-Watermark: 0`。
- 上游请求体：`{ model, prompt, image_size, num_inference_steps, guidance_scale }`。
- 上游响应：`{ images: [{ url }] }`（或 `b64_json`）。
- 响应 `data`：`{ imageUrl, localFile, upstreamUrl, prompt, imageSize, steps, guidance, model, mode, count, usage, raw }`。
  - `imageUrl`：稳定本地地址 `/generated/xxx.png`（图片已下载到 `frontend/generated/`；下载失败时回退上游临时链接）。
- 未配置 `SF_API_KEY` 或失败 → `imageUrl` 为本地 SVG data URI，`mode` 标注演示来源。

### 00.2 语音识别（ASR）
`POST /api/recognition/speech/transcribe`  `multipart/form-data`，字段 `file`（音频 ≤12MB）、`fallbackText`（浏览器实时转写兜底，可选）

- 上游：`POST {SF_BASE_URL}/audio/transcriptions`，`-F file=... -F model=FunAudioLLM/SenseVoiceSmall`（可用 `SF_SPEECH_MODEL` 改 Qwen 等模型）。
- 上游响应：`{ text: "...", duration?, usage? }`。
- 响应 `data`：`{ text, filename, duration, model, mode, usage, raw }`。
- 失败/未配置 Key → 返回 `fallbackText` 或示例文本，`mode` 标注演示来源。

### 00.3 转写文本整理
`POST /api/recognition/speech/analyze`  body: `{ "text": "..." }` → `{ summary, keywords[], intent, mode, usage }`

### 00.4 状态
`GET /api/recognition/status` → `{ imageModel, speechModel, baseURL, apiKeySet, note }`

---

## 0. 商业评论情感分类 `/api/sentiment`

> 上传 Excel → `xlsx` 解析「评论内容」列 → LLM 批量分类（好评/中评/差评）→ 返回统计、精选评论与明细。
> 大模型请求体（含完整提示词）与响应体（原始 JSON）统一由服务端终端打印；浏览器 Console 打印 HTTP 请求/响应。

### 0.1 情感分类
`POST /api/sentiment/analyze`  `multipart/form-data`，字段名 `file`（`.xlsx` / `.xls`，≤10MB，≤200 条）

响应 `data`：
```json
{
  "filename": "餐饮服务评论.xlsx",
  "total": 20,
  "stats": { "好评": 10, "中评": 6, "差评": 4 },
  "labels": ["好评", "中评", "好评", "..."],
  "reviews": [ { "no": 1, "text": "味道很棒，服务周到！", "user": "月影1", "time": "2026-10-01", "label": "好评", "reason": "明显称赞并表示再来" } ],
  "featured": [ { "label": "好评", "no": 4, "text": "…", "reason": "…" }, { "label": "中评", "…" : "…" }, { "label": "差评", "…" : "…" } ],
  "usage": { "prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0 },
  "mode": "qiniu/conatus-free"
}
```

- `featured`：每类挑一条关键词信号最强的评论作为「精选评论」。
- `mode`：实际分类来源（模型名 / `演示模式（关键词启发式）` / `启发式兜底（LLM：…）`）。
- LLM 失败（限流/欠费/格式异常）时自动降级为关键词启发式，接口仍返回 `code=0`。

### 0.2 模拟数据列表
`GET /api/sentiment/sample-files` → `data.files[]`：`{ "name": "餐饮服务评论.xlsx", "url": "/samples/…" }`（3 份各 20 条，可通过 `/samples/<文件名>` 下载）

---

## 1. 会话管理 `/api/conversations`

### 1.1 会话列表
`GET /api/conversations`

响应 `data`：
```json
{ "conversations": [ { "id": 1, "title": "新会话", "created_at": "...", "updated_at": "...", "message_count": 0 } ], "count": 1 }
```

### 1.2 创建会话
`POST /api/conversations`  body: `{ "title": "售后咨询" }`

响应 `data`：`{ "id": 2, "title": "售后咨询", "created_at": "...", "updated_at": "...", "message_count": 0 }`

### 1.3 重命名
`PATCH /api/conversations/:id`  body: `{ "title": "新标题" }`

### 1.4 删除
`DELETE /api/conversations/:id`

### 1.5 会话消息
`GET /api/conversations/:id/messages`

响应 `data`：`{ "conversationId": 1, "messages": [ { "id": 1, "conversation_id": 1, "role": "user", "content": "...", "tokens": 12, "created_at": "..." } ], "count": 2 }`

---

## 2. 智能问答 `/api/ai/chat`

`POST /api/ai/chat`

请求体：
```json
{
  "conversationId": 1,        // 可选；缺省时后端自动新建会话
  "message": "七天无理由退货有什么条件？",
  "useKb": true,              // 是否启用知识库检索
  "stream": true              // true 走 SSE 流式，false 返回完整 JSON
}
```

### 2.1 流式（stream=true）— `text/event-stream`

事件行以 `data: {json}\n\n` 下发，事件 `type` 取值：

| type | 字段 | 说明 |
|---|---|---|
| `meta` | `conversationId`, `citations[]`（命中来源：filename/seq/score/rel/text）, `retrievedAt`, `modelMs`, `promptTokens` | 首帧：元数据与引用来源 |
| `delta` | `content` | 增量文本（`assistant` 正在生成的内容） |
| `done` | `usage`（`{prompt_tokens, completion_tokens, total_tokens}`）, `elapsedMs` | 结束帧 |
| `error` | `msg` | 错误帧（`code` 由 header 业务码表示，见错误表） |

服务端控制台会打印：发送给大模型的数据（URL / Headers / Body / 实际拼装后的 user 内容）、SSE 每帧事件、从大模型接收的数据与 Token 用量；前端 Console 同样打印请求/响应。

### 2.2 非流式（stream=false）

响应 `data`：`{ "conversationId": 1, "reply": "根据资料显示…", "citations": [ ... ], "usage": { ... } }`

### 2.3 错误码

| code | 含义 |
|---|---|
| 4001 | 请求参数缺失（如 message 为空） |
| 5001 | 大模型调用失败（限流/密钥错误/超时等，msg 含详情） |
| 5000 | 服务器内部错误 |

---

## 3. 知识库 `/api/kb`

### 3.1 上传并解析
`POST /api/kb/documents`  `multipart/form-data`，字段名 `file`（≤30MB）

响应 `data`：`{ "id": 1, "filename": "政策.md", "ext": "md", "chunks": 4, "chars": 980 }`
> 上传成功后后端自动重建 RAG 索引，供问答检索。

### 3.2 文档列表
`GET /api/kb/documents`  → `data.documents[]`（`id/filename/ext/size/chars/chunk_count/status/created_at`）

### 3.3 分块预览
`GET /api/kb/documents/:id/chunks` → `data.chunks[]`（`seq/content/tokens`）

### 3.4 删除文档
`DELETE /api/kb/documents/:id`  → 删除文档及分块并重建索引

### 3.5 检索测试
`POST /api/kb/search`  body: `{ "query": "退货条件", "topK": 3 }`
响应 `data.hits[]`：`{ "docId", "filename", "seq", "score"(BM25), "rel"(归一化), "text" }`

### 3.6 索引统计
`GET /api/kb/stats` → `{ "chunks", "docs", "avgdl" }`

---

## 4. 健康检查

`GET /api/health` → `{ code:0, data:{ status:"up", version, storage:"mysql|json", llmModel, rag:{chunks,docs,avgdl} } }`
