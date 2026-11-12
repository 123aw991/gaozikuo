/**
 * 数据访问层：优先 MySQL 8.0；连接不可用时自动退化为本地 JSON 文件。
 * 对外暴露同一套异步方法，路由层无需关心底层实现。
 */
const fs = require('fs');
const path = require('path');
const config = require('../config');

let useMySQL = false;
let pool = null;

/* ---------------- JSON 兜底存储 ---------------- */
const file = path.join(config.dataDir, 'store.json');
let mem = emptyState();

function emptyState() {
  return { seq: { conv: 0, msg: 0, doc: 0, chunk: 0 }, conversations: [], messages: [], documents: [], chunks: [] };
}

function loadJson() {
  try {
    fs.mkdirSync(config.dataDir, { recursive: true });
    if (fs.existsSync(file)) mem = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.warn('[STORE] 读取本地 JSON 失败，使用空数据：', e.message);
    mem = emptyState();
  }
}

let saveTimer = null;
function saveJson() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(config.dataDir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(mem, null, 2), 'utf8');
    } catch (e) {
      console.error('[STORE] 写入本地 JSON 失败：', e.message);
    }
  }, 60);
}

const nextId = (k) => (mem.seq[k] = (mem.seq[k] || 0) + 1);
const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

/* ---------------- 初始化 ---------------- */
async function init() {
  if (config.db.enabled) {
    try {
      const mysql = require('mysql2/promise');
      pool = mysql.createPool({
        host: config.db.host,
        port: config.db.port,
        user: config.db.user,
        password: config.db.password,
        database: config.db.database,
        waitForConnections: true,
        connectionLimit: 6,
        charset: 'utf8mb4'
      });
      await pool.query('SELECT 1');
      useMySQL = true;
      console.log('[DB] MySQL 连接成功：' + config.db.host + ':' + config.db.port + '/' + config.db.database);
      return;
    } catch (e) {
      console.warn('[DB] MySQL 连接失败（' + e.message + '），自动退化为本地 JSON 存储');
      pool = null;
    }
  } else {
    console.log('[DB] 未启用 MySQL（.env 中 DB_ENABLED=false），使用本地 JSON 存储');
  }
  loadJson();
}

/* ---------------- 会话 ---------------- */
async function listConversations() {
  if (useMySQL) {
    const [rows] = await pool.query(
      `SELECT c.id, c.title, c.created_at, c.updated_at,
              (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
         FROM conversations c ORDER BY c.updated_at DESC`
    );
    return rows;
  }
  return mem.conversations
    .map((c) => ({
      ...c,
      message_count: mem.messages.filter((m) => m.conversation_id === c.id).length
    }))
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
}

async function createConversation(title) {
  const t = (title || '新会话').slice(0, 100);
  if (useMySQL) {
    const [r] = await pool.query('INSERT INTO conversations (title) VALUES (?)', [t]);
    return { id: r.insertId, title: t, created_at: now(), updated_at: now(), message_count: 0 };
  }
  const rec = { id: nextId('conv'), title: t, created_at: now(), updated_at: now() };
  mem.conversations.push(rec);
  saveJson();
  return { ...rec, message_count: 0 };
}

async function renameConversation(id, title) {
  const t = String(title || '').slice(0, 100);
  if (!t) throw new Error('会话标题不能为空');
  if (useMySQL) {
    await pool.query('UPDATE conversations SET title = ? WHERE id = ?', [t, id]);
    return { id: Number(id), title: t };
  }
  const c = mem.conversations.find((x) => x.id === Number(id));
  if (!c) throw new Error('会话不存在');
  c.title = t;
  c.updated_at = now();
  saveJson();
  return { id: c.id, title: c.title };
}

async function deleteConversation(id) {
  if (useMySQL) {
    await pool.query('DELETE FROM conversations WHERE id = ?', [id]);
    return true;
  }
  mem.conversations = mem.conversations.filter((c) => c.id !== Number(id));
  mem.messages = mem.messages.filter((m) => m.conversation_id !== Number(id));
  saveJson();
  return true;
}

async function listMessages(convId) {
  if (useMySQL) {
    const [rows] = await pool.query(
      'SELECT id, conversation_id, role, content, created_at FROM messages WHERE conversation_id = ? ORDER BY id ASC',
      [convId]
    );
    return rows;
  }
  return mem.messages.filter((m) => m.conversation_id === Number(convId));
}

async function addMessage(convId, role, content) {
  if (useMySQL) {
    const [r] = await pool.query(
      'INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)',
      [convId, role, content]
    );
    await pool.query('UPDATE conversations SET updated_at = NOW() WHERE id = ?', [convId]);
    return { id: r.insertId, conversation_id: Number(convId), role, content, created_at: now() };
  }
  const rec = { id: nextId('msg'), conversation_id: Number(convId), role, content, created_at: now() };
  mem.messages.push(rec);
  const c = mem.conversations.find((x) => x.id === Number(convId));
  if (c) c.updated_at = now();
  saveJson();
  return rec;
}

/* ---------------- 知识库 ---------------- */
async function listDocuments() {
  if (useMySQL) {
    const [rows] = await pool.query(
      'SELECT id, filename, ext, size, chars, chunk_count, status, created_at FROM kb_documents ORDER BY id DESC'
    );
    return rows;
  }
  return mem.documents.slice().sort((a, b) => b.id - a.id);
}

async function addDocument(doc, chunks) {
  if (useMySQL) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [r] = await conn.query(
        'INSERT INTO kb_documents (filename, ext, size, chars, chunk_count, status) VALUES (?, ?, ?, ?, ?, ?)',
        [doc.filename, doc.ext, doc.size, doc.chars, chunks.length, 'ready']
      );
      const docId = r.insertId;
      for (let i = 0; i < chunks.length; i++) {
        await conn.query('INSERT INTO kb_chunks (doc_id, seq, content, tokens) VALUES (?, ?, ?, ?)', [
          docId,
          i,
          chunks[i],
          Math.ceil(chunks[i].length / 2)
        ]);
      }
      await conn.commit();
      return { ...doc, id: docId, chunk_count: chunks.length, status: 'ready', created_at: now() };
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }

  const rec = {
    id: nextId('doc'),
    filename: doc.filename,
    ext: doc.ext,
    size: doc.size,
    chars: doc.chars,
    chunk_count: chunks.length,
    status: 'ready',
    created_at: now()
  };
  mem.documents.push(rec);
  chunks.forEach((text, i) => {
    mem.chunks.push({ id: nextId('chunk'), doc_id: rec.id, seq: i, content: text, tokens: Math.ceil(text.length / 2) });
  });
  saveJson();
  return rec;
}

async function deleteDocument(id) {
  if (useMySQL) {
    await pool.query('DELETE FROM kb_documents WHERE id = ?', [id]);
    return true;
  }
  mem.documents = mem.documents.filter((d) => d.id !== Number(id));
  mem.chunks = mem.chunks.filter((c) => c.doc_id !== Number(id));
  saveJson();
  return true;
}

async function listAllChunks() {
  if (useMySQL) {
    const [rows] = await pool.query(
      `SELECT k.id, k.doc_id, k.seq, k.content, d.filename
         FROM kb_chunks k JOIN kb_documents d ON d.id = k.doc_id
        ORDER BY k.doc_id ASC, k.seq ASC`
    );
    return rows;
  }
  const docs = new Map(mem.documents.map((d) => [d.id, d.filename]));
  return mem.chunks.map((c) => ({ ...c, filename: docs.get(c.doc_id) || '未知文档' }));
}

async function getChunksByDoc(docId) {
  if (useMySQL) {
    const [rows] = await pool.query('SELECT id, doc_id, seq, content FROM kb_chunks WHERE doc_id = ? ORDER BY seq ASC', [docId]);
    return rows;
  }
  return mem.chunks.filter((c) => c.doc_id === Number(docId)).sort((a, b) => a.seq - b.seq);
}

module.exports = {
  init,
  isMySQL: () => useMySQL,
  listConversations,
  createConversation,
  renameConversation,
  deleteConversation,
  listMessages,
  addMessage,
  listDocuments,
  addDocument,
  deleteDocument,
  listAllChunks,
  getChunksByDoc
};
