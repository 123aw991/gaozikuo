/**
 * 自定义 UI 组件：完全替代浏览器原生 alert / confirm / prompt / form
 * 所有提示、确认、输入、表单均为自封装 Modal（Promise 风格）。
 * 禁止在本项目中使用 window.alert / window.confirm / window.prompt。
 */
const UI = (function () {
  let layer = null;
  let escHandler = null;

  function ensureLayer() {
    if (layer && document.body.contains(layer)) return layer;
    layer = document.createElement('div');
    layer.className = 'ui-mask';
    layer.innerHTML =
      '<div class="ui-dialog" role="dialog" aria-modal="true">' +
      '<div class="ui-head"><span class="ui-title"></span><button class="ui-x" aria-label="关闭">×</button></div>' +
      '<div class="ui-body"></div>' +
      '<div class="ui-foot"></div>' +
      '</div>';
    document.body.appendChild(layer);
    return layer;
  }

  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function open(opts) {
    return new Promise((resolve) => {
      const L = ensureLayer();
      const dlg = L.querySelector('.ui-dialog');
      L.querySelector('.ui-title').textContent = opts.title || '提示';
      const body = L.querySelector('.ui-body');
      const foot = L.querySelector('.ui-foot');

      if (typeof opts.content === 'string') body.innerHTML = opts.content;
      else if (opts.content) { body.innerHTML = ''; body.appendChild(opts.content); }

      foot.innerHTML = '';
      (opts.buttons || [{ text: '确定', value: true, primary: true }]).forEach((b) => {
        const btn = document.createElement('button');
        btn.className = 'ui-btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : '');
        btn.textContent = b.text;
        btn.addEventListener('click', () => {
          if (b.validate && b.validate(body) === false) return; // 校验失败，弹窗不关闭
          let value = b.value;
          if (b.collect) value = b.collect(body);
          close();
          resolve(value);
        });
        foot.appendChild(btn);
      });

      L.querySelector('.ui-x').onclick = () => { close(); resolve(opts.dismissValue !== undefined ? opts.dismissValue : null); };
      L.onclick = (e) => { if (e.target === L && opts.maskClose !== false) { close(); resolve(null); } };
      escHandler = (e) => { if (e.key === 'Escape' && opts.maskClose !== false) { close(); resolve(null); } };
      document.addEventListener('keydown', escHandler);
      L.classList.add('show');
      setTimeout(() => {
        const f = L.querySelector('input,textarea,select,.ui-btn');
        if (f) f.focus();
      }, 30);
    });
  }

  function close() {
    if (!layer) return;
    layer.classList.remove('show');
    document.removeEventListener('keydown', escHandler);
  }

  return {
    /** 提示框（替代 alert） */
    alert(message, title) {
      return open({ title: title || '提示', content: '<div class="ui-text">' + esc(message) + '</div>' });
    },
    /** 确认框（替代 confirm）→ Promise<boolean> */
    confirm(message, title) {
      return open({
        title: title || '确认操作',
        content: '<div class="ui-text">' + esc(message) + '</div>',
        buttons: [
          { text: '取消', value: false },
          { text: '确定', value: true, primary: true }
        ]
      });
    },
    /** 输入框（替代 prompt）→ Promise<string|null> */
    prompt(message, defaultValue, title) {
      const wrap = document.createElement('div');
      wrap.innerHTML = '<div class="ui-text">' + esc(message) + '</div>' +
        '<input class="ui-input ui-prompt-input" value="' + esc(defaultValue || '') + '" />';
      return open({
        title: title || '请输入',
        content: wrap,
        buttons: [
          { text: '取消', value: null },
          {
            text: '确定', primary: true,
            collect: (b) => b.querySelector('.ui-prompt-input').value
          }
        ]
      });
    },
    /**
     * 表单弹窗（新增/编辑实体）
     * fields: [{ name, label, type:'text|email|password|number|select|textarea', required, options:[{value,label}], placeholder, value }]
     * → Promise<Object|null>
     */
    form(title, fields, values) {
      const wrap = document.createElement('div');
      wrap.className = 'ui-form';
      fields.forEach((f) => {
        const row = document.createElement('div');
        row.className = 'ui-field';
        const val = values && values[f.name] !== undefined ? values[f.name] : (f.value !== undefined ? f.value : '');
        let control;
        if (f.type === 'select') {
          control = document.createElement('select');
          (f.options || []).forEach((o) => {
            const opt = document.createElement('option');
            opt.value = o.value; opt.textContent = o.label;
            if (String(o.value) === String(val)) opt.selected = true;
            control.appendChild(opt);
          });
        } else if (f.type === 'textarea') {
          control = document.createElement('textarea');
          control.value = val;
        } else {
          control = document.createElement('input');
          control.type = f.type || 'text';
          control.value = val;
        }
        control.className = 'ui-input';
        control.name = f.name;
        if (f.placeholder) control.placeholder = f.placeholder;
        if (f.type === 'number') { control.min = f.min !== undefined ? f.min : 0; }

        const label = document.createElement('label');
        label.textContent = f.label + (f.required ? ' *' : '');
        row.appendChild(label);
        row.appendChild(control);
        if (f.hint) {
          const h = document.createElement('div');
          h.className = 'ui-hint'; h.textContent = f.hint;
          row.appendChild(h);
        }
        wrap.appendChild(row);
      });

      return open({
        title: title || '编辑',
        content: wrap,
        maskClose: false,
        buttons: [
          { text: '取消', value: null },
          {
            text: '保存', primary: true,
            validate: (b) => {
              let okFlag = true;
              fields.forEach((f) => {
                const el = b.querySelector('[name="' + f.name + '"]');
                const v = el ? String(el.value).trim() : '';
                if (f.required && !v) { okFlag = false; el.classList.add('invalid'); }
                else if (el) el.classList.remove('invalid');
              });
              if (!okFlag) {
                const tip = b.querySelector('.ui-form-error') || document.createElement('div');
                tip.className = 'ui-form-error';
                tip.textContent = '请填写所有必填项（带 * 号）';
                if (!tip.parentNode) b.appendChild(tip);
              }
              return okFlag;
            },
            collect: (b) => {
              const data = {};
              fields.forEach((f) => {
                const el = b.querySelector('[name="' + f.name + '"]');
                const v = el ? String(el.value).trim() : '';
                data[f.name] = f.type === 'number' ? (Number(v) || 0) : v;
              });
              return data;
            }
          }
        ]
      }).then((v) => v);
    },
    /** 详情展示（覆盖主要内容） */
    detail(title, rows) {
      const wrap = document.createElement('div');
      wrap.className = 'ui-detail';
      rows.forEach((r) => {
        const item = document.createElement('div');
        item.className = 'ui-detail-row';
        const k = document.createElement('span');
        k.className = 'ui-detail-k'; k.textContent = r.label;
        const v = document.createElement('span');
        v.className = 'ui-detail-v';
        v.textContent = typeof r.value === 'object' ? JSON.stringify(r.value, null, 2) : String(r.value == null ? '-' : r.value);
        item.appendChild(k); item.appendChild(v);
        wrap.appendChild(item);
      });
      return open({ title: title || '详情', content: wrap, buttons: [{ text: '关闭', primary: true, value: true }] });
    }
  };
})();
