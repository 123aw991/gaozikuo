/**
 * 后台管理路由：/api/admin
 * - /auth/login  管理员登录（独立账号体系，默认 admin / admin123）
 * - /entity/:name 三个实体（users / conversations / documents）的增删改查 + 搜索 + 分页
 * 除 /auth/login 外，所有接口均经过 adminRequired 鉴权中间件拦截，未登录返回 401。
 */
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const config = require('../config');
const store = require('../services/store');

const ok = (res, data, msg) => res.json({ code: 0, msg: msg || 'ok', data });
const fail = (res, code, msg) => res.json({ code, msg, data: null });

const ENTITIES = {
  users: { label: '用户', fields: ['username', 'email'], create: ['username', 'email', 'password'], update: ['username', 'email', 'password'] },
  conversations: { label: '会话', fields: ['title'], create: ['title'], update: ['title'] },
  documents: { label: '知识库文档', fields: ['filename', 'ext', 'chars', 'status'], create: ['filename', 'ext', 'size', 'chars', 'chunk_count', 'status'], update: ['filename', 'ext', 'chars', 'status'] }
};

/* ---------- 密码与 Token（与前台用户隔离，admin 专属签名） ---------- */
function hashPassword(p) {
  const salt = crypto.randomBytes(16).toString('hex');
  return 'scrypt$' + salt + '$' + crypto.scryptSync(String(p), salt, 64).toString('hex');
}
function verifyPassword(p, stored) {
  try {
    const [algo, salt, hash] = String(stored).split('$');
    if (algo !== 'scrypt' || !salt || !hash) return false;
    const a = crypto.scryptSync(String(p), salt, 64), b = Buffer.from(hash, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (e) { return false; }
}
const b64 = (x) => Buffer.from(x).toString('base64url');
function signToken(admin) {
  const payload = { sub: admin.id, username: admin.username, role: 'admin', exp: Math.floor(Date.now() / 1000) + config.auth.tokenHours * 3600 };
  const body = b64(JSON.stringify(payload));
  return body + '.' + crypto.createHmac('sha256', config.auth.secret + ':admin').update(body).digest('base64url');
}
function verifyToken(token) {
  try {
    const [body, sig] = String(token || '').split('.');
    if (!body || !sig) return null;
    const expected = crypto.createHmac('sha256', config.auth.secret + ':admin').update(body).digest('base64url');
    const a = Buffer.from(sig), b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.role !== 'admin' || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (e) { return null; }
}

/* ========== 鉴权中间件：拦截所有管理接口 ========== */
function adminRequired(req, res, next) {
  const m = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  const payload = m && verifyToken(m[1]);
  if (!payload) {
    console.warn('[ADMIN] 未授权访问被拦截：' + req.method + ' ' + req.originalUrl + '（无有效管理员 Token）');
    return fail(res, 401, '未登录或登录已失效，请先登录管理后台');
  }
  req.admin = payload;
  next();
}

/* ---------- 管理员登录 ---------- */
router.post('/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  const u = String(username || '').trim(), p = String(password || '');
  console.log('\n[ADMIN] 登录尝试：' + u);
  if (!u || !p) return fail(res, 4001, '请输入管理员用户名和密码');

  try {
    await store.ensureDefaultAdmin(hashPassword('admin123'));
    const admin = await store.findAdmin(u);
    if (!admin || !verifyPassword(p, admin.password_hash)) {
      console.warn('[ADMIN] 登录失败：用户名或密码错误（' + u + '）');
      return fail(res, 4002, '管理员用户名或密码错误');
    }
    const token = signToken(admin);
    console.log('[ADMIN] 登录成功：' + u + '，Token 已签发');
    ok(res, { token, admin: { id: admin.id, username: admin.username } }, '登录成功');
  } catch (e) {
    console.error('[ADMIN] 登录异常：', e.message);
    fail(res, 5001, '登录失败：' + e.message);
  }
});

router.get('/auth/me', adminRequired, (req, res) => {
  ok(res, { id: req.admin.sub, username: req.admin.username, role: 'admin' });
});

/* ========== 以下全部需要管理员登录 ========== */
router.use(adminRequired);

/* 实体元信息（前端动态渲染表单） */
router.get('/entities', (req, res) => ok(res, ENTITIES));

/* 仪表盘聚合数据（全部来自 store 真实记录） */
router.get('/dashboard', async (req, res) => {
  try {
    const data = await store.dashboardStats();
    console.log('[ADMIN] 仪表盘统计：' + JSON.stringify(data.totals));
    ok(res, data);
  } catch (e) {
    console.error('[ADMIN] 仪表盘统计失败：', e.message);
    fail(res, 5007, '统计失败：' + e.message);
  }
});

/* 列表：搜索 + 分页 */
router.get('/:name', async (req, res) => {
  const name = req.params.name;
  if (!ENTITIES[name]) return fail(res, 4004, '未知的管理实体：' + name);
  const { keyword, page, pageSize } = req.query;
  console.log('[ADMIN] 列表 ' + name + '：keyword=' + (keyword || '') + ' page=' + (page || 1) + ' size=' + (pageSize || 10));
  try {
    ok(res, await store.adminList(name, keyword, page, pageSize));
  } catch (e) {
    console.error('[ADMIN] 列表失败：', e.message);
    fail(res, 5002, '查询失败：' + e.message);
  }
});

/* 详情：覆盖主要内容（会话带消息、文档带分块） */
router.get('/:name/:id', async (req, res) => {
  const name = req.params.name;
  if (!ENTITIES[name]) return fail(res, 4004, '未知的管理实体：' + name);
  try {
    const row = await store.adminDetail(name, req.params.id);
    if (!row) return fail(res, 4005, '记录不存在');
    ok(res, row);
  } catch (e) {
    fail(res, 5003, '查询详情失败：' + e.message);
  }
});

/* 新增 */
router.post('/:name', async (req, res) => {
  const name = req.params.name;
  const meta = ENTITIES[name];
  if (!meta) return fail(res, 4004, '未知的管理实体：' + name);
  const data = {};
  meta.create.forEach((f) => { if (req.body[f] !== undefined) data[f] = req.body[f]; });
  if (meta.create.includes('username') && (!data.username || !data.email)) return fail(res, 4001, '用户名和密码/邮箱不能为空');
  if (meta.create.includes('title') && !data.title) return fail(res, 4001, '会话标题不能为空');
  if (meta.create.includes('filename') && !data.filename) return fail(res, 4001, '文件名不能为空');
  try {
    const row = await store.adminCreate(name, data);
    console.log('[ADMIN] 新增 ' + name + '：' + JSON.stringify(row));
    ok(res, row, '新增成功');
  } catch (e) {
    fail(res, 5004, '新增失败：' + e.message);
  }
});

/* 修改 */
router.put('/:name/:id', async (req, res) => {
  const name = req.params.name;
  const meta = ENTITIES[name];
  if (!meta) return fail(res, 4004, '未知的管理实体：' + name);
  const data = {};
  meta.update.forEach((f) => { if (req.body[f] !== undefined) data[f] = req.body[f]; });
  try {
    const done = await store.adminUpdate(name, req.params.id, data);
    if (!done) return fail(res, 4005, '记录不存在或无有效字段');
    console.log('[ADMIN] 修改 ' + name + ' #' + req.params.id + '：' + JSON.stringify(data));
    ok(res, { id: Number(req.params.id) }, '修改成功');
  } catch (e) {
    fail(res, 5005, '修改失败：' + e.message);
  }
});

/* 删除 */
router.delete('/:name/:id', async (req, res) => {
  const name = req.params.name;
  if (!ENTITIES[name]) return fail(res, 4004, '未知的管理实体：' + name);
  try {
    await store.adminDelete(name, req.params.id);
    console.log('[ADMIN] 删除 ' + name + ' #' + req.params.id);
    ok(res, { id: Number(req.params.id) }, '删除成功');
  } catch (e) {
    fail(res, 5006, '删除失败：' + e.message);
  }
});

module.exports = { router, adminRequired, verifyToken };
