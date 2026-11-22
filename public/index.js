import { $, h, api, translator, langButton } from './common.js';

const t = translator({
  en: { title: 'Scan the QR code on your table to order', sub: 'Each table has its own code. Your order goes straight to the kitchen.',
    demo: 'Prototype demo', demoSub: 'Pretend you scanned a table (this list is hidden in production):', kitchen: 'Kitchen display', admin: 'Admin console' },
  zh: { title: '请扫描餐桌上的二维码点餐', sub: '每张餐桌都有专属二维码，订单会直接送到厨房。',
    demo: '原型演示', demoSub: '模拟扫描某张餐桌（正式上线后此列表会隐藏）：', kitchen: '厨房显示屏', admin: '管理后台' },
});

let demoTables = null;

function render() {
  document.title = t('title');
  $('#app').replaceChildren(
    h('div', { class: 'landing-lang' }, langButton(render)),
    h('p', { class: 'eyebrow' }, 'QR · ORDER'),
    h('h1', {}, t('title')),
    h('p', { class: 'muted' }, t('sub')),
    demoTables ? h('section', { id: 'demo' },
      h('h2', {}, t('demo')),
      h('p', { class: 'muted small' }, t('demoSub')),
      h('div', { class: 'demo-grid' }, demoTables.map((tb) => h('a', { class: 'btn', href: tb.path }, tb.name))),
      h('div', { class: 'demo-staff' },
        h('a', { class: 'btn', href: '/kitchen' }, t('kitchen')),
        h('a', { class: 'btn', href: '/admin' }, t('admin')))) : null,
  );
}

render();
api('/api/demo/tables').then(({ tables }) => { demoTables = tables; render(); }).catch(() => {});
