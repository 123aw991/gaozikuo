# 数据库设计文档（yuan_database）

> 存储层抽象见 `backend/services/store.js`：运行时若检测到 MySQL 可用（`.env` 中 `DB_ENABLED=true` 且连接成功），则使用数据库；否则自动回退到本地 JSON 文件（`backend/data/*.json`），业务代码无感知。

---

## 1. 概览

- 数据库名：`llm_rag`（MySQL 8.0，字符集 `utf8mb4`）
- 建表脚本：`backend/sql/schema.sql`（含 ≥8 条测试数据）
- 初始化：`node scripts/init-db.js`（需先配置 `.env` 中的 DB_*）
- 关系：会话 → 消息（一对多，级联删除）；文档 → 分块（一对多，级联删除）

---

## 2. 表结构

### 2.0 users（用户表）
| 字段 | 类型 | 说明 |
|---|---|---|
| id | BIGINT PK AUTO_INCREMENT | 用户 ID |
| username | VARCHAR(50) UNIQUE | 用户名 |
| email | VARCHAR(120) UNIQUE | 邮箱 |
| password_hash | VARCHAR(255) | scrypt 加盐哈希（格式 `scrypt$salt$hash`） |
| created_at | DATETIME | 注册时间 |
| last_login_at | DATETIME | 最后登录时间 |

### 2.1 conversations（会话表）
| 字段 | 类型 | 说明 |
|---|---|---|
| id | BIGINT PK AUTO_INCREMENT | 会话 ID |
| title | VARCHAR(120) | 会话标题 |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间（ON UPDATE） |

### 2.2 messages（消息表）
| 字段 | 类型 | 说明 |
|---|---|---|
| id | BIGINT PK | 消息 ID |
| conversation_id | BIGINT FK → conversations(id) ON DELETE CASCADE | 所属会话 |
| role | ENUM('system','user','assistant') | 角色 |
| content | MEDIUMTEXT | 消息内容 |
| tokens | INT | Token 数 |
| created_at | DATETIME | 创建时间 |
| idx_conv | INDEX | 按会话检索加速 |

### 2.3 kb_documents（知识库文档表）
| 字段 | 类型 | 说明 |
|---|---|---|
| id | BIGINT PK | 文档 ID |
| filename | VARCHAR(255) | 文件名 |
| ext | VARCHAR(10) | 扩展名 |
| size | INT | 文件字节数 |
| chars | INT | 解析后字符数 |
| chunk_count | INT | 分块数 |
| status | VARCHAR(20) | 状态（ready 等） |
| created_at | DATETIME | 入库时间 |

### 2.4 kb_chunks（知识库分块表）
| 字段 | 类型 | 说明 |
|---|---|---|
| id | BIGINT PK | 分块 ID |
| doc_id | BIGINT FK → kb_documents(id) ON DELETE CASCADE | 所属文档 |
| seq | INT | 段序号 |
| content | TEXT | 分块文本 |
| tokens | INT | Token 数（估算） |

### 2.5 prompt_logs（提示词日志表，可选）
| 字段 | 类型 | 说明 |
|---|---|---|
| id | BIGINT PK | 日志 ID |
| scene | VARCHAR(40) | 场景（如「RAG 问答」） |
| model | VARCHAR(80) | 模型名 |
| prompt | MEDIUMTEXT | 拼装后的提示词 |
| tokens | INT | Token 数 |
| created_at | DATETIME | 创建时间 |

---

## 3. 测试数据（≥8 条）

`sql/schema.sql` 中预置：

- 2 条会话：`智能客服售后咨询`、`RAG 知识库问答测试`
- 6 条消息：两会话的问答对（用户问 + 助手答）
- 1 篇文档：`售后服务政策.md`（2 个分块）
- 1 条提示词日志

总计 ≥8 行，可直接用于接口联调。

---

## 4. JSON 回退结构（无 MySQL 时）

`backend/data/` 下：

- `conversations.json`：`[{id,title,created_at,updated_at}]`
- `messages.json`：`[{id,conversation_id,role,content,tokens,created_at}]`
- `kb_documents.json` / `kb_chunks.json`：结构与上表一致，自增 ID 用 `max+1` 维护

> 切换数据库无需改动业务代码，`store.js` 通过 `config.storage` 自动选择实现。
