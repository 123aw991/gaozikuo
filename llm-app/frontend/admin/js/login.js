/** 管理员登录：全部提示使用自定义 UI 组件 */
(function () {
  const form = document.getElementById('adminLoginForm');
  const err = document.getElementById('errMsg');
  const btn = document.getElementById('submitBtn');
  const pwd = document.getElementById('password');
  const eye = document.getElementById('togglePwd');

  // 已登录直接进入后台
  if (API.getAdminToken()) {
    API.json('GET', '/api/admin/auth/me').then((d) => { if (d.code === 0) location.href = 'index.html'; });
  }

  eye.addEventListener('click', () => {
    const show = pwd.type === 'password';
    pwd.type = show ? 'text' : 'password';
    eye.textContent = show ? '隐藏' : '显示';
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    const username = document.getElementById('username').value.trim();
    const password = pwd.value;
    if (!username || !password) { err.textContent = '请输入管理员用户名和密码'; return; }

    btn.disabled = true;
    btn.textContent = '登录中…';
    try {
      const res = await API.json('POST', '/api/admin/auth/login', { username, password });
      if (res.code !== 0) { err.textContent = res.msg || '登录失败'; return; }
      API.setAdminToken(res.data.token);
      sessionStorage.setItem('llmapp_admin_name', res.data.admin.username);
      await UI.alert('登录成功，欢迎回来，' + res.data.admin.username + '！', '管理后台');
      location.href = 'index.html';
    } catch (e2) {
      await UI.alert('网络错误，请确认后端服务已启动', '登录失败');
    } finally {
      btn.disabled = false;
      btn.textContent = '登录管理后台';
    }
  });
})();
