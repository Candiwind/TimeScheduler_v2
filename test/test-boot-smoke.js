/**
 * test-boot-smoke.js
 *
 * **启动冒烟测试**：用一套极简 DOM 桩，把 `index.html` 里那 14 个脚本按顺序加载一遍，
 * 让 `app.js` 末尾的 `boot()` 真的跑起来（读数据 → 首屏 `renderCurrent` → 弹归档提示条），
 * 断言：**不抛异常、八个板块都画出了内容、象限头上有折叠三角**。
 *
 * 为什么值得单独写一条：其它测试全部只测「纯函数」，谁都没跑过**启动这条链**。
 * 可 App 一旦在启动时抛异常（比如某次改渲染时碰了个不存在的元素、或新板块的
 * `getElementById` 拿不到节点），页面上就是**白屏**——而那正是「装到手机上打不开」
 * 最常见的成因之一。node 里没有浏览器，但启动链用到的 DOM 面很小，
 * 一套桩就够把它跑通；跑通了就能把「网页层的锅」从这里排除掉
 * （真机闪退若是原生层，这条测试照样绿，所以它与真机排查是两回事）。
 *
 * 桩的边界**故意做窄**：只实现启动链真正用到的那几个方法与属性。哪天启动路径用上
 * 了新 API，这里会直接红 —— 那正说明启动依赖面变了，得回来看一眼。
 *
 * 跑法：node test/test-boot-smoke.js
 */
'use strict';

var h = require('./harness');
var path = require('path');

var t = h.test;
var ROOT = path.join(__dirname, '..', 'js');

// ---------------------------------------------------------------------------
// 极简 DOM 桩
// ---------------------------------------------------------------------------

function makeEl(tag, id) {
  return {
    tagName: (tag || 'div').toUpperCase(),
    id: id || '',
    className: '',
    innerHTML: '',
    textContent: '',
    value: '',
    hidden: false,
    checked: false,
    disabled: false,
    files: null,
    style: {},
    dataset: {},
    scrollTop: 0,
    children: [],
    parentNode: null,
    _attrs: {},
    classList: {
      _s: {},
      add: function (c) { this._s[c] = 1; },
      remove: function (c) { delete this._s[c]; },
      toggle: function (c, on) { if (on) this._s[c] = 1; else delete this._s[c]; },
      contains: function (c) { return !!this._s[c]; }
    },
    setAttribute: function (k, v) { this._attrs[k] = String(v); },
    getAttribute: function (k) { return (k in this._attrs) ? this._attrs[k] : null; },
    removeAttribute: function (k) { delete this._attrs[k]; },
    addEventListener: function () {},
    removeEventListener: function () {},
    appendChild: function (n) { this.children.push(n); if (n) n.parentNode = this; return n; },
    removeChild: function (n) { var i = this.children.indexOf(n); if (i !== -1) this.children.splice(i, 1); return n; },
    insertBefore: function (n) { return this.appendChild(n); },
    contains: function (n) { return n === this || this.children.indexOf(n) !== -1; },
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; },
    closest: function () { return null; },
    focus: function () {},
    select: function () {},
    click: function () {},
    scrollIntoView: function () {}
  };
}

var els = {};
function byId(id) { if (!els[id]) els[id] = makeEl('div', id); return els[id]; }

var lsMap = {};
var win = {
  localStorage: {
    getItem: function (k) { return (k in lsMap) ? lsMap[k] : null; },
    setItem: function (k, v) { lsMap[k] = String(v); },
    removeItem: function (k) { delete lsMap[k]; }
  },
  addEventListener: function () {},
  removeEventListener: function () {},
  print: function () {},
  matchMedia: function () { return { matches: false, addListener: function () {} }; },
  navigator: { clipboard: null, userAgent: 'node' }
};

global.window = win;
global.document = {
  readyState: 'complete',   // 不是 loading → app.js 会立刻调 boot()
  body: makeEl('body'),
  documentElement: makeEl('html'),
  getElementById: byId,
  createElement: function (tag) { return makeEl(tag); },
  querySelector: function () { return null; },
  querySelectorAll: function () { return []; },
  addEventListener: function () {},
  removeEventListener: function () {}
};
// Node 自带只读的 navigator，只能 defineProperty
try { Object.defineProperty(global, 'navigator', { value: win.navigator, configurable: true }); } catch (e) {}

// ---------------------------------------------------------------------------
// 断言要**等一拍**再做：boot() 里有一句 `Prefs.preload().then(startApp)`
// （安卓的原生存储是异步的，所以首屏落在微任务里），同步跑的话看到的是白屏。
// ---------------------------------------------------------------------------

var MODULES = ['config', 'util', 'store', 'prefs', 'toast', 'render', 'theme', 'task-ops',
  'drag', 'date-nav', 'exporter', 'pdf', 'importer', 'app'];

var loadError = null;
var unhandled = null;
process.on('unhandledRejection', function (e) { unhandled = e; });

setTimeout(function () {
  h.group('启动链：14 个脚本按 index.html 的顺序加载，boot() 不抛异常');

  t('按 index.html 的顺序加载全部脚本，一个都不抛', function () {
    try {
      MODULES.forEach(function (m) { require(path.join(ROOT, m + '.js')); });
    } catch (e) {
      loadError = e;
    }
    h.assertEqual(loadError, null, '启动时有脚本抛异常：' + (loadError && loadError.stack));
  });

  // 再等一个宏任务：require 那一瞬间只把 boot() 调起来，真正的首屏在
  // `Prefs.preload().then(startApp)` 的**微任务**里 —— 同一个宏任务里断言
  // 会看到还没画的白屏（很容易误报成「启动没渲染」）。
  setTimeout(function () {
    h.group('首屏：boot() 之后每个板块都画上了');

    t('boot() 在首屏渲染后没有异常（含 Promise 链）', function () {
      h.assertEqual(unhandled, null, '启动时出现未处理的 Promise 异常：' + (unhandled && unhandled.stack));
    });

    t('八个板块都画出了内容（白屏就是从这里开始的）', function () {
      ['quadrants', 'pool', 'reading', 'templates', 'principles', 'skills', 'files'].forEach(function (id) {
        h.assertTrue(els[id] && els[id].innerHTML.length > 0,
          '#' + id + ' 没有画出任何内容');
      });
    });

    t('象限里有折叠三角（v2.13 需求：每块板都能折）', function () {
      h.assertTrue(els.quadrants.innerHTML.indexOf('board__toggle') !== -1);
      h.assertTrue(els.quadrants.innerHTML.indexOf('data-board="q:I"') !== -1);
    });

    t('全新安装（本机什么都没有）→ 折叠状态是「六板块收起、四象限展开」', function () {
      var Store = require(path.join(ROOT, 'store.js'));
      var f = Store.getFoldState();
      h.assertEqual(f.collapsedPanels, null, 'v2.12 需求 10：从没记录过时是 null（app 层补全收起）');
      h.assertEqual(Object.keys(f.collapsedBoards).length, 0, 'v2.13：板默认展开');
      h.assertEqual(Object.keys(lsMap).join(','), '',
        '首屏不该往本机写任何东西（新用户第一次打开就是「没记录过」）');
    });

    h.summary('启动冒烟：14 个脚本 + boot() 全链路');
  }, 50);
}, 0);

