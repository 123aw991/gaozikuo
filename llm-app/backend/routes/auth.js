/**
 * 认证路由：/api/auth
 * 注册 / 登录 / 当前用户 / 登出
 * 密码用 Node 内置 crypto.scryptSync 加盐哈希（不存明文）；Token 为 HMAC 签名（无第三方依赖）。
 * 请求/响应报文在服务端终端打印（密码明文不打印）。
 */
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const config = require('../config');
const store = require('../services/store');

const ok = (res, data, msg) => res.json({ code: 0, msg: msg || 'ok', data });
const fail = (res, code, msg) => res.json({ code, msg, data: null });
const nowISO = () => new Date().toISOString();

/* ---------- 密码哈希 / 校验 ---------- */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return 'scrypt$' + salt + '$' + hash;
}
function verifyPassword(password, stored) {
  try {
    const [algo, salt, hash] = String(stored).split('$');
    if (algo !== 'scrypt' || !salt || !hash) return false;
    const actual = crypto.scryptSync(String(password), salt, 64);
    const expected = Buffer.from(hash, 'hex');
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch (e) { return false; }
}

/* ---------- Token 签发 / 校验 ---------- */
function b64url(buf) { return Buffer.from(buf).toString('base64url'); }
function signToken(user) {
  const payload = {
    sub: user.id,
    username: user.username,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + config.auth.tokenHours * 3600
  };
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', config.auth.secret).update(body).digest('base64url');
  return body + '.' + sig;
}
function verifyToken(token) {
  try {
    const [body, sig] = String(token || '').split('.');
    if (!body || !sig) return null;
    const expected = crypto.createHmac('sha256', config.auth.secret).update(body).digest('base64url');
    const a = Buffer.from(sig); const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (e) { return null; }
}
function authRequired(req, res, next) {
  const m = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  const payload = m && verifyToken(m[1]);
  if (!payload) return fail(res, 401, '登录已失效，请重新登录');
  req.user = payload;
  next();
}

function log(tag, body) {
  console.log('\n[AUTH] ' + tag + '：' + JSON.stringify(body, (k, v) => {
    if (/password/i.test(k)) return '***';
    return v;
  }));
}

/* ---------- 注册 ---------- */
router.post('/register', async (req, res) => {
  const { username, email, password } = req.body || {};
  log('注册请求', { username, email });
  const u = String(username || '').trim();
  const e = String(email || '').trim().toLowerCase();
  const p = String(password || '');
  if (!/^[\w\u4e00-\u9fa5]{2,20}$/.test(u)) return fail(res, 4001, '用户名需 2-20 位（字母/数字/下划线/中文）');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return fail(res, 4002, '邮箱格式不正确');
  if (p.length < 6 || p.length > 64) return fail(res, 4003, '密码长度需 6-64 位');

  try {
    const exists = await store.findUser(u, e);
    if (exists) return fail(res, 4004, exists.username === u ? '用户名已存在' : '邮箱已注册');
    const user = await store.createUser(u, e, hashPassword(p));
    log('注册成功', { id: user.id, username: user.username });
    ok(res, { user: { id: user.id, username: user.username, email: user.email } }, '注册成功');
  } catch (err) {
    console.error('[AUTH] 注册失败：', err.message);
    fail(res, 5001, '注册失败：' + err.message);
  }
});

/* ---------- 登录 ---------- */
router.post('/login', async (req, res) => {
  const { account, password } = req.body || {};
  log('登录请求', { account });
  const acc = String(account || '').trim();
  const p = String(password || '');
  if (!acc || !p) return fail(res, 4001, '请输入账号和密码');

  try {
    const user = await store.findUser(acc, acc.toLowerCase());
    if (!user || !verifyPassword(p, user.password_hash)) return fail(res, 4002, '账号或密码错误');
    await store.updateLastLogin(user.id);
    const token = signToken(user);
    log('登录成功', { id: user.id, username: user.username });
    ok(res, {
      token,
      user: { id: user.id, username: user.username, email: user.email }
    }, '登录成功');
  } catch (err) {
    console.error('[AUTH] 登录失败：', err.message);
    fail(res, 5002, '登录失败：' + err.message);
  }
});

/* ---------- 当前用户 ---------- */
router.get('/me', authRequired, async (req, res) => {
  const user = await store.findUserById(req.user.sub);
  if (!user) return fail(res, 401, '用户不存在，请重新登录');
  ok(res, { id: user.id, username: user.username, email: user.email, last_login_at: user.last_login_at || null });
});

/* ---------- 登出（客户端删除 Token 即可，服务端仅确认） ---------- */
router.post('/logout', authRequired, (req, res) => {
  log('登出', { username: req.user.username });
  ok(res, { ok: true }, '已登出');
});

module.exports = { router, authRequired, verifyToken };
