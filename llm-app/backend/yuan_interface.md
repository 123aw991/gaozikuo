# 接口设计文档（yuan_interface）

> 所有接口前缀为 `/api`，统一响应 `{ code: number, msg: string, data: any }`，`code === 0` 表示成功。
> 服务默认端口 `8325`，由 `backend/server.js` 提供静态前端与以下路由。

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
