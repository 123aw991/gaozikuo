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
  return {
    seq: { conv: 0, msg: 0, doc: 0, chunk: 0, user: 0, admin: 0 },
    conversations: [], messages: [], documents: [], chunks: [], users: [], admins: []
  };
}

function loadJson() {
  try {
    fs.mkdirSync(config.dataDir, { recursive: true });
    if (fs.existsSync(file)) {
      mem = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!mem.users) mem.users = [];
      if (!mem.admins) mem.admins = [];
      if (!mem.seq) mem.seq = {};
      if (!mem.seq.user) mem.seq.user = 0;
      if (!mem.seq.admin) mem.seq.admin = 0;
    }
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

/* ---------------- 用户 ---------------- */
async function findUser(username, email) {
  if (useMySQL) {
    const [rows] = await pool.query(
      'SELECT id, username, email, password_hash, created_at, last_login_at FROM users WHERE username = ? OR email = ? LIMIT 1',
      [username, email]
    );
    return rows[0] || null;
  }
  return mem.users.find((u) => u.username === username || (email && u.email === email)) || null;
}

async function findUserById(id) {
  if (useMySQL) {
    const [rows] = await pool.query('SELECT id, username, email, created_at, last_login_at FROM users WHERE id = ?', [id]);
    return rows[0] || null;
  }
  return mem.users.find((u) => u.id === Number(id)) || null;
}

async function createUser(username, email, passwordHash) {
  if (useMySQL) {
    const [r] = await pool.query('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)', [username, email, passwordHash]);
    const [rows] = await pool.query('SELECT id, username, email, created_at FROM users WHERE id = ?', [r.insertId]);
    return rows[0];
  }
  const rec = { id: nextId('user'), username, email, password_hash: passwordHash, created_at: now(), last_login_at: null };
  mem.users.push(rec);
  saveJson();
  return { id: rec.id, username, email, created_at: rec.created_at };
}

async function updateLastLogin(id) {
  if (useMySQL) { await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [id]); return; }
  const u = mem.users.find((x) => x.id === Number(id));
  if (u) { u.last_login_at = now(); saveJson(); }
}

/* ---------------- 管理员 ---------------- */
async function findAdmin(username) {
  if (useMySQL) {
    const [rows] = await pool.query('SELECT * FROM admins WHERE username = ? LIMIT 1', [username]);
    return rows[0] || null;
  }
  return mem.admins.find((a) => a.username === username) || null;
}
async function findAdminById(id) {
  if (useMySQL) {
    const [rows] = await pool.query('SELECT id, username, created_at FROM admins WHERE id = ?', [id]);
    return rows[0] || null;
  }
  return mem.admins.find((a) => a.id === Number(id)) || null;
}
async function ensureDefaultAdmin(passwordHash) {
  const exists = await findAdmin('admin');
  if (exists) return exists;
  if (useMySQL) {
    await pool.query('INSERT INTO admins (username, password_hash) VALUES (?, ?)', ['admin', passwordHash]);
    return findAdmin('admin');
  }
  const rec = { id: nextId('admin'), username: 'admin', password_hash: passwordHash, created_at: now() };
  mem.admins.push(rec);
  saveJson();
  return rec;
}

/* ---------------- 后台管理：通用分页查询 ---------------- */
/* entity: 'users' | 'conversations' | 'documents'；keyword 模糊匹配主要字段 */
async function adminList(entity, keyword, page, pageSize) {
  const kw = String(keyword || '').trim().toLowerCase();
  const p = Math.max(1, Number(page) || 1);
  const size = Math.min(100, Math.max(1, Number(pageSize) || 10));

  let rows;
  if (useMySQL) {
    const table = { users: 'users', conversations: 'conversations', documents: 'kb_documents' }[entity];
    const cols = {
      users: 'id, username, email, created_at, last_login_at',
      conversations: 'id, title, created_at, updated_at',
      documents: 'id, filename, ext, size, chars, chunk_count, status, created_at'
    }[entity];
    const searchCols = {
      users: ['username', 'email'],
      conversations: ['title'],
      documents: ['filename', 'ext']
    }[entity];
    let where = '', args = [];
    if (kw) {
      where = ' WHERE ' + searchCols.map((c) => 'LOWER(' + c + ') LIKE ?').join(' OR ');
      args = searchCols.map(() => '%' + kw + '%');
    }
    const [cnt] = await pool.query('SELECT COUNT(*) AS total FROM ' + table + where, args);
    const [items] = await pool.query('SELECT ' + cols + ' FROM ' + table + where + ' ORDER BY id DESC LIMIT ? OFFSET ?', args.concat([size, (p - 1) * size]));
    return { items, total: Number(cnt[0].total), page: p, pageSize: size };
  }

  let source;
  if (entity === 'users') source = mem.users.map((u) => ({ id: u.id, username: u.username, email: u.email, created_at: u.created_at, last_login_at: u.last_login_at || null }));
  else if (entity === 'conversations') source = mem.conversations.map((c) => ({ id: c.id, title: c.title, created_at: c.created_at, updated_at: c.updated_at }));
  else source = mem.documents.slice();

  const fields = entity === 'users' ? ['username', 'email'] : entity === 'conversations' ? ['title'] : ['filename', 'ext'];
  if (kw) source = source.filter((r) => fields.some((f) => String(r[f] || '').toLowerCase().includes(kw)));
  source.sort((a, b) => b.id - a.id);
  const total = source.length;
  return { items: source.slice((p - 1) * size, p * size), total, page: p, pageSize: size };
}

async function adminDetail(entity, id) {
  if (useMySQL) {
    const table = { users: 'users', conversations: 'conversations', documents: 'kb_documents' }[entity];
    const cols = {
      users: 'id, username, email, created_at, last_login_at',
      conversations: 'id, title, created_at, updated_at',
      documents: 'id, filename, ext, size, chars, chunk_count, status, created_at'
    }[entity];
    const [rows] = await pool.query('SELECT ' + cols + ' FROM ' + table + ' WHERE id = ?', [id]);
    if (!rows.length) return null;
    const row = rows[0];
    if (entity === 'conversations') {
      const [msgs] = await pool.query('SELECT id, role, content, created_at FROM messages WHERE conversation_id = ? ORDER BY id ASC LIMIT 50', [id]);
      const [cnt] = await pool.query('SELECT COUNT(*) AS total FROM messages WHERE conversation_id = ?', [id]);
      row.messages = msgs;
      row.message_count = Number(cnt[0].total);
    } else if (entity === 'documents') {
      const [chunks] = await pool.query('SELECT id, seq, content, tokens FROM kb_chunks WHERE doc_id = ? ORDER BY seq ASC LIMIT 50', [id]);
      row.chunks = chunks;
    }
    return row;
  }
  const idn = Number(id);
  if (entity === 'users') {
    const u = mem.users.find((x) => x.id === idn);
    return u ? { id: u.id, username: u.username, email: u.email, created_at: u.created_at, last_login_at: u.last_login_at || null } : null;
  }
  if (entity === 'conversations') {
    const c = mem.conversations.find((x) => x.id === idn);
    if (!c) return null;
    const messages = mem.messages.filter((m) => m.conversation_id === idn);
    return { ...c, messages: messages.slice(0, 50), message_count: messages.length };
  }
  const d = mem.documents.find((x) => x.id === idn);
  if (!d) return null;
  return { ...d, chunks: mem.chunks.filter((c) => c.doc_id === idn).slice(0, 50) };
}

async function adminCreate(entity, data) {
  if (useMySQL) {
    if (entity === 'users') {
      const crypto = require('crypto');
      const pwd = String(data.password || '123456');
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = 'scrypt$' + salt + '$' + crypto.scryptSync(pwd, salt, 64).toString('hex');
      const [r] = await pool.query('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)', [data.username, data.email, hash]);
      return { id: r.insertId, username: data.username, email: data.email };
    }
    if (entity === 'conversations') {
      const [r] = await pool.query('INSERT INTO conversations (title) VALUES (?)', [data.title]);
      return { id: r.insertId, title: data.title };
    }
    const [r] = await pool.query('INSERT INTO kb_documents (filename, ext, size, chars, chunk_count, status) VALUES (?, ?, ?, ?, ?, ?)',
      [data.filename, data.ext || '', Number(data.size) || 0, Number(data.chars) || 0, Number(data.chunk_count) || 0, data.status || 'ready']);
    return { id: r.insertId, filename: data.filename };
  }
  if (entity === 'users') {
    const crypto = require('crypto');
    const pwd = String(data.password || '123456');
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = 'scrypt$' + salt + '$' + crypto.scryptSync(pwd, salt, 64).toString('hex');
    const rec = { id: nextId('user'), username: data.username, email: data.email, password_hash: hash, created_at: now(), last_login_at: null };
    mem.users.push(rec);
    saveJson();
    return { id: rec.id, username: rec.username, email: rec.email };
  }
  if (entity === 'conversations') {
    const rec = { id: nextId('conv'), title: data.title, created_at: now(), updated_at: now() };
    mem.conversations.push(rec);
    saveJson();
    return { id: rec.id, title: rec.title };
  }
  const rec = {
    id: nextId('doc'), filename: data.filename, ext: data.ext || '', size: Number(data.size) || 0,
    chars: Number(data.chars) || 0, chunk_count: Number(data.chunk_count) || 0, status: data.status || 'ready', created_at: now()
  };
  mem.documents.push(rec);
  saveJson();
  return { id: rec.id, filename: rec.filename };
}

async function adminUpdate(entity, id, data) {
  if (useMySQL) {
    const table = { users: 'users', conversations: 'conversations', documents: 'kb_documents' }[entity];
    const sets = [];
    const args = [];
    const allowed = {
      users: ['username', 'email'],
      conversations: ['title'],
      documents: ['filename', 'ext', 'chars', 'status']
    }[entity];
    allowed.forEach((f) => {
      if (data[f] !== undefined) { sets.push(f + ' = ?'); args.push(data[f]); }
    });
    if (entity === 'users' && data.password) {
      const crypto = require('crypto');
      const salt = crypto.randomBytes(16).toString('hex');
      sets.push('password_hash = ?');
      args.push('scrypt$' + salt + '$' + crypto.scryptSync(String(data.password), salt, 64).toString('hex'));
    }
    if (!sets.length) return false;
    args.push(id);
    await pool.query('UPDATE ' + table + ' SET ' + sets.join(', ') + ' WHERE id = ?', args);
    return true;
  }
  const idn = Number(id);
  const rec = (entity === 'users' ? mem.users : entity === 'conversations' ? mem.conversations : mem.documents).find((x) => x.id === idn);
  if (!rec) return false;
  const allowed = {
    users: ['username', 'email'],
    conversations: ['title'],
    documents: ['filename', 'ext', 'chars', 'status']
  }[entity];
  allowed.forEach((f) => { if (data[f] !== undefined) rec[f] = data[f]; });
  if (entity === 'users' && data.password) {
    const crypto = require('crypto');
    const salt = crypto.randomBytes(16).toString('hex');
    rec.password_hash = 'scrypt$' + salt + '$' + crypto.scryptSync(String(data.password), salt, 64).toString('hex');
  }
  saveJson();
  return true;
}

async function adminDelete(entity, id) {
  if (useMySQL) {
    if (entity === 'users') await pool.query('DELETE FROM users WHERE id = ?', [id]);
    else if (entity === 'conversations') await pool.query('DELETE FROM conversations WHERE id = ?', [id]);
    else await pool.query('DELETE FROM kb_documents WHERE id = ?', [id]);
    return true;
  }
  const idn = Number(id);
  if (entity === 'users') mem.users = mem.users.filter((x) => x.id !== idn);
  else if (entity === 'conversations') {
    mem.conversations = mem.conversations.filter((x) => x.id !== idn);
    mem.messages = mem.messages.filter((m) => m.conversation_id !== idn);
  } else {
    mem.documents = mem.documents.filter((x) => x.id !== idn);
    mem.chunks = mem.chunks.filter((c) => c.doc_id !== idn);
  }
  saveJson();
  return true;
}

/* ---------------- 仪表盘聚合统计（真实数据） ---------------- */
async function dashboardStats() {
  const dayKey = (v) => {
    if (!v) return '';
    const s = String(v).replace('T', ' ');
    return s.slice(0, 10);
  };
  const lastDays = (n) => {
    const out = [];
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    for (let i = n - 1; i >= 0; i--) {
      const x = new Date(d);
      x.setDate(d.getDate() - i);
      out.push(x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'));
    }
    return out;
  };
  const days = lastDays(7);

  if (useMySQL) {
    const one = async (sql, args) => (await pool.query(sql, args || []))[0][0];
    const users = Number((await one('SELECT COUNT(*) AS n FROM users')).n);
    const conversations = Number((await one('SELECT COUNT(*) AS n FROM conversations')).n);
    const messages = Number((await one('SELECT COUNT(*) AS n FROM messages')).n);
    const documents = Number((await one('SELECT COUNT(*) AS n FROM kb_documents')).n);
    const chunks = Number((await one('SELECT COUNT(*) AS n FROM kb_chunks')).n);

    const roleRows = await pool.query('SELECT role, COUNT(*) AS n FROM messages GROUP BY role');
    const roleDist = { user: 0, assistant: 0, system: 0 };
    roleRows[0].forEach((r) => { roleDist[r.role] = Number(r.n); });

    const docStatusRows = await pool.query('SELECT status, COUNT(*) AS n FROM kb_documents GROUP BY status');
    const docStatus = {};
    docStatusRows[0].forEach((r) => { docStatus[r.status] = Number(r.n); });

    const extRows = await pool.query("SELECT LOWER(ext) AS ext, COUNT(*) AS n FROM kb_documents GROUP BY LOWER(ext) ORDER BY n DESC");
    const extDist = extRows[0].map((r) => ({ name: r.ext || 'unknown', value: Number(r.n) }));

    const topRows = await pool.query(
      'SELECT c.id, c.title, COUNT(m.id) AS n FROM conversations c LEFT JOIN messages m ON m.conversation_id = c.id GROUP BY c.id ORDER BY n DESC LIMIT 5'
    );
    const topConversations = topRows[0].map((r) => ({ id: r.id, title: r.title, count: Number(r.n) }));

    const trendRows = await pool.query(
      'SELECT DATE(created_at) AS d, COUNT(*) AS n FROM messages WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY) GROUP BY DATE(created_at)'
    );
    const tmap = {};
    trendRows[0].forEach((r) => { tmap[dayKey(r.d)] = Number(r.n); });
    const trend = days.map((d) => ({ date: d, count: tmap[d] || 0 }));

    return {
      totals: { users, conversations, messages, documents, chunks },
      roleDist, docStatus, extDist, topConversations, trend,
      generatedAt: new Date().toISOString()
    };
  }

  const users = mem.users.length;
  const conversations = mem.conversations.length;
  const messages = mem.messages.length;
  const documents = mem.documents.length;
  const chunks = mem.chunks.length;

  const roleDist = { user: 0, assistant: 0, system: 0 };
  mem.messages.forEach((m) => { if (roleDist[m.role] !== undefined) roleDist[m.role]++; });

  const docStatus = {};
  mem.documents.forEach((d) => { docStatus[d.status || 'unknown'] = (docStatus[d.status || 'unknown'] || 0) + 1; });

  const extMap = {};
  mem.documents.forEach((d) => { const k = String(d.ext || 'unknown').toLowerCase(); extMap[k] = (extMap[k] || 0) + 1; });
  const extDist = Object.entries(extMap).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);

  const topConversations = mem.conversations.map((c) => ({
    id: c.id,
    title: c.title,
    count: mem.messages.filter((m) => m.conversation_id === c.id).length
  })).sort((a, b) => b.count - a.count).slice(0, 5);

  const tmap = {};
  mem.messages.forEach((m) => { const k = dayKey(m.created_at); if (k) tmap[k] = (tmap[k] || 0) + 1; });
  const trend = days.map((d) => ({ date: d, count: tmap[d] || 0 }));

  return {
    totals: { users, conversations, messages, documents, chunks },
    roleDist, docStatus, extDist, topConversations, trend,
    generatedAt: new Date().toISOString()
  };
}

module.exports = {
  init,
  isMySQL: () => useMySQL,
  dashboardStats,
  findUser,
  findUserById,
  createUser,
  updateLastLogin,
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
  getChunksByDoc,
  findAdmin,
  findAdminById,
  ensureDefaultAdmin,
  adminList,
  adminDetail,
  adminCreate,
  adminUpdate,
  adminDelete
};
