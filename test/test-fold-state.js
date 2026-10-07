/**
 * test-fold-state.js
 *
 * 检查折叠 / 展开状态的本地持久化（需求 5，见 DS 2.9 / 2.10）。
 *
 * 需求 5：有阶段的任务、有任务的任务块都能折叠 / 展开，折叠状态记在本机、
 * 刷新后保持。所以这里只测 Store.getFoldState / setFoldState 这一条路：
 *   存 → 读回一致；没存过 / 存坏了 → 给空表，不崩；单独一个 key，不碰主数据。
 *
 * v2.8 需求 3 起这条路多带一样东西：**板块收起**（阅读栏 / 计划池 / 模板池，
 * 见 DS 2.38）。同一份 foldState、同一个 key —— 都是「这台设备看着顺手」的
 * 界面状态，没有理由开第二个存储口子。
 *
 * 跑法：node test/test-fold-state.js
 */
'use strict';

var h = require('./harness');
var Store = require('../js/store');
var CONFIG = require('../js/config');
var fs = require('fs');
var path = require('path');

var t = h.test;

function fresh() {
  var storage = h.createMemoryStorage();
  Store.init({ storage: storage, clock: function () { return 1759300000000; } });
  return storage;
}

// ---------------------------------------------------------------------------
h.group('读：没存过 / 存坏了都给空表，绝不崩');

t('从没存过 → 两张空表', function () {
  fresh();
  var f = Store.getFoldState();
  h.assertEqual(Object.keys(f.expanded).length, 0);
  h.assertEqual(Object.keys(f.collapsedBlocks).length, 0);
});

t('存的是坏 JSON → 空表，不崩', function () {
  var storage = fresh();
  storage.setItem(CONFIG.KEYS.foldState, '这不是 JSON {{{');
  var f = Store.getFoldState();
  h.assertEqual(Object.keys(f.expanded).length, 0);
  h.assertEqual(Object.keys(f.collapsedBlocks).length, 0);
});

t('字段不是对象 → 各自回空表', function () {
  var storage = fresh();
  storage.setItem(CONFIG.KEYS.foldState, JSON.stringify({ expanded: 3, collapsedBlocks: 'x' }));
  var f = Store.getFoldState();
  h.assertEqual(Object.keys(f.expanded).length, 0);
  h.assertEqual(Object.keys(f.collapsedBlocks).length, 0);
});

// ---------------------------------------------------------------------------
h.group('存：刷新后能读回原样');

t('展开和折叠名单各存各的，往返一致', function () {
  fresh();
  Store.setFoldState({
    expanded: { t1: true, t2: true },
    collapsedBlocks: { b1: true }
  });

  var f = Store.getFoldState();
  h.assertEqual(f.expanded.t1, true);
  h.assertEqual(f.expanded.t2, true);
  h.assertEqual(f.collapsedBlocks.b1, true);
});

t('先存再覆盖，以最后一次为准', function () {
  fresh();
  Store.setFoldState({ expanded: { t1: true }, collapsedBlocks: {} });
  Store.setFoldState({ expanded: { t2: true }, collapsedBlocks: { b2: true } });

  var f = Store.getFoldState();
  h.assertEqual(f.expanded.t1, undefined, '旧名单该被覆盖掉');
  h.assertEqual(f.expanded.t2, true);
  h.assertEqual(f.collapsedBlocks.b2, true);
});

t('传空 / 缺字段 → 存成空表，读回也是空表', function () {
  fresh();
  Store.setFoldState(null);
  var f = Store.getFoldState();
  h.assertEqual(Object.keys(f.expanded).length, 0);
  h.assertEqual(Object.keys(f.collapsedBlocks).length, 0);
});

// ---------------------------------------------------------------------------
h.group('板块收起：和展开名单同一条路（v2.8 需求 3）');

t('从没存过 → collapsedPanels 是空表', function () {
  fresh();
  var f = Store.getFoldState();
  h.assertTrue(typeof f.collapsedPanels === 'object' && f.collapsedPanels !== null);
  h.assertEqual(Object.keys(f.collapsedPanels).length, 0);
});

t('存了「计划池收起」→ 读回来还是收起的', function () {
  fresh();
  Store.setFoldState({ collapsedPanels: { pool: true } });

  var f = Store.getFoldState();
  h.assertEqual(f.collapsedPanels.pool, true);
  h.assertEqual(f.collapsedPanels.reading, undefined);
});

t('三个板块各收各的，互不影响', function () {
  fresh();
  Store.setFoldState({ collapsedPanels: { reading: true, templates: true } });

  var f = Store.getFoldState();
  h.assertEqual(f.collapsedPanels.reading, true);
  h.assertEqual(f.collapsedPanels.templates, true);
  h.assertEqual(f.collapsedPanels.pool, undefined, '没点的那个不该跟着一起收');
});

t('收起名单和展开名单是两回事，各存各的', function () {
  fresh();
  Store.setFoldState({
    expanded: { t1: true },
    collapsedBlocks: { b1: true },
    collapsedPanels: { pool: true }
  });

  var f = Store.getFoldState();
  h.assertEqual(f.expanded.t1, true);
  h.assertEqual(f.collapsedBlocks.b1, true);
  h.assertEqual(f.collapsedPanels.pool, true);
});

t('collapsedPanels 是垃圾值 → 回空表，不崩', function () {
  var storage = fresh();
  storage.setItem(CONFIG.KEYS.foldState,
    JSON.stringify({ expanded: {}, collapsedBlocks: {}, collapsedPanels: '不是对象' }));

  var f = Store.getFoldState();
  h.assertEqual(Object.keys(f.collapsedPanels).length, 0);
});

// ---------------------------------------------------------------------------
h.group('隔离：界面状态绝不混进主数据');

t('折叠状态存在自己单独的 key 里，不碰主数据', function () {
  var storage = fresh();
  Store.setFoldState({ expanded: { t1: true }, collapsedBlocks: {} });

  h.assertNull(storage.getItem(CONFIG.KEYS.userData), '存折叠状态不该把主数据也建出来');
  h.assertTrue(storage.getItem(CONFIG.KEYS.foldState) !== null);
});

t('折叠状态的 key 和主数据的 key 不是同一个', function () {
  h.assertFalse(CONFIG.KEYS.foldState === CONFIG.KEYS.userData);
  h.assertTrue(CONFIG.KEYS.userData.indexOf(CONFIG.KEYS.foldState) === -1);
});

t('主数据对象里没有折叠状态字段', function () {
  fresh();
  var data = Store.createEmpty();
  var keys = Object.keys(data).sort();
  h.assertEqual(keys.join(','), 'dates,pool,reading,schemaVersion,templates,user',
    '折叠状态不进主数据（pool / templates 是 v1.1 的计划池 / 模板字段，' +
    'reading 是 v2.8 的阅读栏）');
});

// ---------------------------------------------------------------------------
h.group('坏了也不能影响主流程');

t('存不进去（空间满了）不该抛错，也不该影响保存数据', function () {
  var tight = h.createMemoryStorage({ quotaBytes: 1 });
  Store.init({ storage: tight, clock: function () { return 1759300000000; } });

  // setFoldState 内部吞掉异常，不影响主流程
  Store.setFoldState({ expanded: { t1: true }, collapsedBlocks: {} });
  var f = Store.getFoldState();
  h.assertEqual(Object.keys(f.expanded).length, 0, '存不上就还是空表，但不报错');
});

// ---------------------------------------------------------------------------
h.group('app.js 源码守卫：改 state.expanded 的地方都要落本机');

t('顺手展开（加阶段 / 改阶段）之后也调 persistFoldState', function () {
  var src = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');

  ['startAddStage', 'startEditStage'].forEach(function (fn) {
    var start = src.indexOf('function ' + fn + '(');
    h.assertTrue(start !== -1, 'app.js 里找不到 ' + fn);

    var end = src.indexOf('\n  }', start);
    var body = src.slice(start, end === -1 ? src.length : end);

    h.assertTrue(body.indexOf('state.expanded[taskId] = true;') !== -1,
      fn + ' 里没有展开动作（这个守卫该跟着实现改）');
    h.assertTrue(body.indexOf('persistFoldState()') !== -1,
      fn + ' 把任务展开了却没落本机 —— 刷新后又变回折叠');
  });
});

// ---------------------------------------------------------------------------
h.group('app.js 源码守卫：收起 / 展开也要落本机（v2.8 需求 3）');

t('persistFoldState 把 collapsedPanels 一起存了', function () {
  var src = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');

  var start = src.indexOf('function persistFoldState(');
  h.assertTrue(start !== -1, 'app.js 里找不到 persistFoldState');

  var end = src.indexOf('\n  }', start);
  var body = src.slice(start, end === -1 ? src.length : end);

  h.assertTrue(body.indexOf('collapsedPanels: state.collapsedPanels') !== -1,
    '收起状态没跟着一起存 —— 刷新后收起的板块会自己弹开');
});

t('开机时把收起状态读回来', function () {
  var src = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  h.assertTrue(src.indexOf('state.collapsedPanels = fold.collapsedPanels;') !== -1,
    '读了不赋值，等于没记');
});

t('togglePanel 只认名单里的三个名字（DOM 传上来的值不可全信）', function () {
  var src = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');

  var start = src.indexOf('function togglePanel(');
  h.assertTrue(start !== -1, 'app.js 里找不到 togglePanel');

  var end = src.indexOf('\n  }', start);
  var body = src.slice(start, end === -1 ? src.length : end);

  h.assertTrue(body.indexOf('CONFIG.PANEL_IDS.indexOf(panelId) === -1') !== -1,
    '没有白名单的话，手工改过的 DOM 能往本机写进任意 key');
  h.assertTrue(body.indexOf('persistFoldState()') !== -1,
    '收起之后没落本机 —— 刷新又变回来');
});

// ---------------------------------------------------------------------------

h.summary('折叠状态持久化（需求 5）');
