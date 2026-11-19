/**
 * 登录 / 注册页逻辑：根据页面表单自动识别模式，提交后保存 Token 与用户信息。
 */
(function () {
  const isLogin = !!document.getElementById('loginForm');
  const form = document.getElementById(isLogin ? 'loginForm' : 'registerForm');
  const err = document.getElementById('errMsg');
  const btn = document.getElementById('submitBtn');
  const eye = document.getElementById('togglePwd');
  const pwd = document.getElementById('password');

  function showError(msg) { err.textContent = msg || ''; }
  function validate(data) {
    if (isLogin) {
      if (!data.account) return '请输入用户名或邮箱';
      if (!data.password) return '请输入密码';
    } else {
      if (!/^[\w\u4e00-\u9fa5]{2,20}$/.test(data.username)) return '用户名需 2-20 位（字母/数字/下划线/中文）';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) return '邮箱格式不正确';
      if (data.password.length < 6 || data.password.length > 64) return '密码长度需 6-64 位';
      if (data.password !== data.confirm) return '两次输入的密码不一致';
    }
    return '';
  }

  eye && eye.addEventListener('click', () => {
    const show = pwd.type === 'password';
    pwd.type = show ? 'text' : 'password';
    eye.textContent = show ? '隐藏' : '显示';
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError('');
    const data = isLogin
      ? { account: document.getElementById('account').value.trim(), password: pwd.value }
      : {
          username: document.getElementById('username').value.trim(),
          email: document.getElementById('email').value.trim().toLowerCase(),
          password: pwd.value,
          confirm: document.getElementById('confirm').value
        };
    const problem = validate(data);
    if (problem) { showError(problem); return; }

    btn.disabled = true;
    btn.textContent = isLogin ? '登录中…' : '注册中…';
    try {
      const payload = isLogin
        ? { account: data.account, password: data.password }
        : { username: data.username, email: data.email, password: data.password };
      const res = await API.json('POST', '/api/auth/' + (isLogin ? 'login' : 'register'), payload);
      if (res.code !== 0) { showError(res.msg || '操作失败'); return; }

      if (isLogin) {
        API.setToken(res.data.token);
        API.setUser(res.data.user);
        location.href = 'index.html';
      } else {
        // 注册成功后自动登录
        const login = await API.json('POST', '/api/auth/login', { account: data.username, password: data.password });
        if (login.code === 0) {
          API.setToken(login.data.token);
          API.setUser(login.data.user);
          location.href = 'index.html';
        } else {
          location.href = 'login.html';
        }
      }
    } catch (err2) {
      showError('网络错误，请确认后端服务已启动');
    } finally {
      btn.disabled = false;
      btn.textContent = isLogin ? '登录' : '注册并登录';
    }
  });
})();
