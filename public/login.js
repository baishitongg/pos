import { $, h, api, translator, langButton } from './common.js';

const t = translator({
  en: { title: 'Staff sign in', sub: 'Kitchen and admin access', user: 'Username', pass: 'Password', submit: 'Sign in',
    tooMany: 'Too many attempts. Try again in a minute.', wrong: 'Wrong username or password.' },
  zh: { title: '员工登录', sub: '厨房与管理后台', user: '用户名', pass: '密码', submit: '登录',
    tooMany: '尝试次数过多，请一分钟后再试。', wrong: '用户名或密码错误。' },
});

const params = new URLSearchParams(location.search);
const raw = params.get('next') || '/kitchen';
// Only allow same-site relative redirects (no open redirect).
const next = /^\/[A-Za-z0-9/_-]*$/.test(raw) && !raw.startsWith('//') ? raw : '/kitchen';

function render() {
  document.title = t('title');
  const err = h('p', { class: 'form-err', role: 'alert' });
  const user = h('input', { id: 'u', name: 'username', autocomplete: 'username', required: true, autofocus: true });
  const pass = h('input', { id: 'p', name: 'password', type: 'password', autocomplete: 'current-password', required: true });
  const btn = h('button', { class: 'btn primary', type: 'submit' }, t('submit'));

  $('#app').replaceChildren(h('main', { class: 'login-card' },
    h('div', { class: 'login-head' }, h('h1', {}, t('title')), langButton(render)),
    h('p', { class: 'muted' }, t('sub')),
    h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        err.textContent = '';
        btn.disabled = true;
        try {
          await api('/api/auth/login', { method: 'POST', body: { username: user.value.trim(), password: pass.value } });
          location.replace(next);
        } catch (x) {
          err.textContent = x.status === 429 ? t('tooMany') : t('wrong');
          pass.value = '';
          pass.focus();
        } finally { btn.disabled = false; }
      },
    },
    h('label', { for: 'u' }, t('user')), user,
    h('label', { for: 'p' }, t('pass')), pass,
    err, btn)));
}

render();
