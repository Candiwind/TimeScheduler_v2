/**
 * test-pool-align.js
 *
 * v2.7 需求 1：**池内的任务块要和象限里的任务块同格式同功能**（见 DS 2.34 / 2.35）。
 *
 * 改之前池内块只有「折叠 + 块名 + 导入 + ＋ + 删除」，块名是死文本、没有完成度，
 * 池内任务连勾选框都没有。本文件锁住补上的那几样：
 *
 *   1. 数据层：`togglePoolItem` / `togglePoolBlock`
 *      —— 勾选走 `setUnitDone`（有阶段就设全部阶段）、完成态由宿主块派生、
 *         勾完沉到**所在列表**末尾、取消勾选不移回；
 *   2. 渲染层：块头有勾选框 + 完成度 n/m + 可点块名；行上有勾选框和完成态样式；
 *         「」空块 0/0、块名与编辑框都要转义；
 *   3. 跨文件守卫：render 画的池内控件，drag 的 isInteractive 得认；
 *         池内勾选框**不是**拖拽把手（D-62）；保护模式名单里有它们。
 *
 * 跑法：node test/test-pool-align.js
 */
'use strict';

var h = require('./harness');
var fs = require('fs');
var path = require('path');
var Store = require('../js/store');
var TaskOps = require('../js/task-ops');
var Render = require('../js/render');

var t = h.test;
var DATE = '2026-10-01';

var renderSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'render.js'), 'utf8');
var dragSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'drag.js'), 'utf8');
var appSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
var css = fs.readFileSync(path.join(__dirname, '..', 'css', 'style.css'), 'utf8');

// ---------------------------------------------------------------------------
// 造数据的小工具
// ---------------------------------------------------------------------------

function fresh() {
  return Store.createEmpty();
}

/** 往池顶层加一条任务（addPoolItem 默认 DDL = 查看日期 + 7 天） */
function poolTask(data, text) {
  var r = TaskOps.addPoolItem(data, DATE, text);
  if (!r.ok) throw new Error('池任务没造出来：' + r.error);
  return r.task;
}

/** 池里造一个块，块内塞若干任务。返回 { block, kids } */
function poolBlock(data, name, kidTexts) {
  var r = TaskOps.addPoolBlock(data, name);
  if (!r.ok) throw new Error('池内块没造出来：' + r.error);
  var kids = [];
  (kidTexts || []).forEach(function (text, i) {
    var k = {
      id: 'k' + i, text: text, completed: false, createdAt: 1,
      plannedDate: '2026-10-08'
    };
    r.block.tasks.push(k);
    kids.push(k);
  });
  r.block.completed = Store.blockDone(r.block.tasks);
  return { block: r.block, kids: kids };
}

function poolTexts(data) {
  return (data.pool || []).map(function (x) { return x.text; }).join(',');
}

function kidTexts(block) {
  return (block.tasks || []).map(function (x) { return x.text; }).join(',');
}

/** 渲染池（progressOf 一定要传 —— 块头的 n/m 走的和象限同一个算法） */
function renderPool(items, view) {
  var v = { progressOf: TaskOps.progressOfItem };
  for (var k in (view || {})) v[k] = view[k];
  return Render.buildPoolHtml(items, v);
}

/** 取出某个「单行选择器」的规则体（选择器后面紧跟 `{`，到第一个 `}` 为止） */
function ruleBody(selector) {
  var start = css.indexOf(selector + ' {');
  if (start === -1) return '';
  var open = css.indexOf('{', start);
  var close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

/**
 * 保护模式里某个类名是不是被挡住了。
 *
 * 这些名单是**一长串逗号分隔的选择器**（几十行），所以不能用「选择器 + `{`」
 * 去定位 —— 类名后面跟的是逗号。这里扫遍所有 `body.is-readonly ... { }`
 * 规则，看有没有哪一条的选择器列表里带它、并且声明了 pointer-events: none。
 */
function readonlyBlocks(cls) {
  var re = /body\.is-readonly([^{]*)\{([^}]*)\}/g;
  var m;
  while ((m = re.exec(css)) !== null) {
    if (m[1].indexOf('.' + cls) !== -1 && m[2].indexOf('pointer-events: none') !== -1) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
h.group('togglePoolItem：池内任务勾选');

t('勾选一条顶层池内任务，completed 变 true', function () {
  var data = fresh();
  var task = poolTask(data, '相册整理');

  var r = TaskOps.togglePoolItem(data, task.id, true);

  h.assertTrue(r.ok);
  h.assertEqual(task.completed, true);
});

t('取消勾选变回 false', function () {
  var data = fresh();
  var task = poolTask(data, '相册整理');
  TaskOps.togglePoolItem(data, task.id, true);

  TaskOps.togglePoolItem(data, task.id, false);

  h.assertEqual(task.completed, false);
});

t('不传 completed 时取反', function () {
  var data = fresh();
  var task = poolTask(data, '相册整理');

  TaskOps.togglePoolItem(data, task.id);
  h.assertEqual(task.completed, true, '第一次该变成已完成');

  TaskOps.togglePoolItem(data, task.id);
  h.assertEqual(task.completed, false, '第二次该变回未完成');
});

t('勾选后**不移出池**，池里还留着那一条', function () {
  var data = fresh();
  var task = poolTask(data, '相册整理');

  TaskOps.togglePoolItem(data, task.id, true);

  h.assertEqual(data.pool.length, 1, '勾选不是导入，池里得留着');
  h.assertEqual(poolTexts(data), '相册整理');
});

t('勾完沉到池末尾', function () {
  var data = fresh();
  poolTask(data, '甲');
  var mid = poolTask(data, '乙');
  poolTask(data, '丙');
  h.assertEqual(poolTexts(data), '甲,乙,丙');

  TaskOps.togglePoolItem(data, mid.id, true);

  h.assertEqual(poolTexts(data), '甲,丙,乙', '完成的那条该到末尾');
});

t('已经在末尾的条目勾一下，顺序一个字节不动', function () {
  var data = fresh();
  poolTask(data, '甲');
  var last = poolTask(data, '乙');

  TaskOps.togglePoolItem(data, last.id, true);

  h.assertEqual(poolTexts(data), '甲,乙');
});

t('取消勾选不自动移回原位', function () {
  var data = fresh();
  var first = poolTask(data, '甲');
  poolTask(data, '乙');
  TaskOps.togglePoolItem(data, first.id, true);
  h.assertEqual(poolTexts(data), '乙,甲', '先沉到底');

  TaskOps.togglePoolItem(data, first.id, false);

  h.assertEqual(poolTexts(data), '乙,甲', '取消勾选不移回（D-47 同一条规矩）');
});

t('块内任务勾选 → 宿主块完成度跟着重算', function () {
  var data = fresh();
  var b = poolBlock(data, '打包', ['护照', '充电器']);
  var blockId = b.block.id;

  TaskOps.togglePoolItem(data, b.kids[0].id, true);
  h.assertEqual(TaskOps.findPoolItem(data, blockId).task.completed, false,
    '还有一条没勾，块不算完成');

  TaskOps.togglePoolItem(data, b.kids[1].id, true);
  h.assertEqual(TaskOps.findPoolItem(data, blockId).task.completed, true,
    '全勾完块头该自己打勾');
});

t('块内任务沉底是**在块内**沉，不跑到池顶层', function () {
  var data = fresh();
  var b = poolBlock(data, '打包', ['护照', '充电器', '药']);
  var poolLen = data.pool.length;

  TaskOps.togglePoolItem(data, b.kids[0].id, true);

  h.assertEqual(data.pool.length, poolLen, '池顶层条数不能变');
  h.assertEqual(kidTexts(b.block), '充电器,药,护照', '在块内沉到末尾');
});

t('块内任务勾完不会把宿主块搬到池末尾', function () {
  var data = fresh();
  var b = poolBlock(data, '打包', ['护照']);
  poolTask(data, '相册整理');   // 池顶层：块在前、任务在后

  h.assertEqual(poolTexts(data), '打包,相册整理');
  TaskOps.togglePoolItem(data, b.kids[0].id, true);

  h.assertEqual(poolTexts(data), '打包,相册整理', '沉的是块内任务，块本体不沉底（D-47）');
});

t('带阶段的任务：勾选 = 全部阶段一起勾', function () {
  var data = fresh();
  var task = poolTask(data, '写报告');
  task.stages = [
    { id: 's1', text: '收集数据', completed: false, createdAt: 1 },
    { id: 's2', text: '写初稿', completed: false, createdAt: 1 }
  ];
  task.completed = false;

  TaskOps.togglePoolItem(data, task.id, true);

  h.assertEqual(task.stages[0].completed, true);
  h.assertEqual(task.stages[1].completed, true);
  h.assertEqual(task.completed, true, '有阶段时 completed 是派生的（syncCompleted）');
});

t('带阶段的任务：取消勾选 = 全部阶段一起取消', function () {
  var data = fresh();
  var task = poolTask(data, '写报告');
  task.stages = [
    { id: 's1', text: '收集数据', completed: true, createdAt: 1 },
    { id: 's2', text: '写初稿', completed: true, createdAt: 1 }
  ];
  task.completed = true;

  TaskOps.togglePoolItem(data, task.id, false);

  h.assertEqual(task.stages[0].completed, false);
  h.assertEqual(task.stages[1].completed, false);
  h.assertEqual(task.completed, false);
});

t('带阶段的任务只勾了一半：取反 = 把剩下的补上（看的是「全完成」）', function () {
  var data = fresh();
  var task = poolTask(data, '写报告');
  task.stages = [
    { id: 's1', text: '收集数据', completed: true, createdAt: 1 },
    { id: 's2', text: '写初稿', completed: false, createdAt: 1 }
  ];
  task.completed = false;

  TaskOps.togglePoolItem(data, task.id);

  h.assertEqual(task.completed, true, '没全完成 → 取反就是全勾完');
  h.assertEqual(task.stages[1].completed, true);
});

t('块内带阶段的任务：勾完宿主块也重算', function () {
  var data = fresh();
  var b = poolBlock(data, '打包', ['护照']);
  b.kids[0].stages = [
    { id: 's1', text: '找护照', completed: false, createdAt: 1 }
  ];
  b.kids[0].completed = false;

  TaskOps.togglePoolItem(data, b.kids[0].id, true);

  h.assertEqual(b.kids[0].stages[0].completed, true);
  h.assertEqual(b.block.completed, true, '阶段勾完 → 任务完成 → 块完成，逐级往上报');
});

t('池内块的 id 也能传给 togglePoolItem（转给块头的全勾）', function () {
  var data = fresh();
  var b = poolBlock(data, '打包', ['护照', '充电器']);

  var r = TaskOps.togglePoolItem(data, b.block.id, true);

  h.assertTrue(r.ok);
  h.assertEqual(b.kids[0].completed, true);
  h.assertEqual(b.kids[1].completed, true);
});

t('不存在的 id → NOT_FOUND', function () {
  var data = fresh();
  poolTask(data, '甲');
  h.assertEqual(TaskOps.togglePoolItem(data, 'no-such-id', true).error,
    TaskOps.ERR.NOT_FOUND);
});

t('空池里勾一下 → NOT_FOUND，不崩', function () {
  var data = fresh();
  h.assertEqual(TaskOps.togglePoolItem(data, 'x', true).error, TaskOps.ERR.NOT_FOUND);
});

// ---------------------------------------------------------------------------
h.group('togglePoolBlock：池内块头勾选（一键全勾 / 全取消）');

t('勾块头 → 块内全部设成已完成', function () {
  var data = fresh();
  var b = poolBlock(data, '打包', ['护照', '充电器', '药']);

  var r = TaskOps.togglePoolBlock(data, b.block.id, true);

  h.assertTrue(r.ok);
  h.assertEqual(b.kids[0].completed, true);
  h.assertEqual(b.kids[1].completed, true);
  h.assertEqual(b.kids[2].completed, true);
  h.assertEqual(b.block.completed, true);
});

t('取消块头 → 块内全部变回未完成', function () {
  var data = fresh();
  var b = poolBlock(data, '打包', ['护照', '充电器']);
  TaskOps.togglePoolBlock(data, b.block.id, true);

  TaskOps.togglePoolBlock(data, b.block.id, false);

  h.assertEqual(b.kids[0].completed, false);
  h.assertEqual(b.kids[1].completed, false);
  h.assertEqual(b.block.completed, false);
});

t('部分完成时勾块头：把剩下的补上', function () {
  var data = fresh();
  var b = poolBlock(data, '打包', ['护照', '充电器']);
  TaskOps.togglePoolItem(data, b.kids[0].id, true);

  TaskOps.togglePoolBlock(data, b.block.id, true);

  h.assertEqual(b.kids[1].completed, true);
  h.assertEqual(b.block.completed, true);
});

t('不传 completed 时取反（看块是不是全完成）', function () {
  var data = fresh();
  var b = poolBlock(data, '打包', ['护照']);

  TaskOps.togglePoolBlock(data, b.block.id);
  h.assertEqual(b.block.completed, true);

  TaskOps.togglePoolBlock(data, b.block.id);
  h.assertEqual(b.block.completed, false);
});

t('块内任务勾完时在块内稳定沉底（相对顺序不变）', function () {
  var data = fresh();
  var b = poolBlock(data, '打包', ['甲', '乙', '丙']);

  TaskOps.togglePoolBlock(data, b.block.id, true);

  h.assertEqual(kidTexts(b.block), '甲,乙,丙', '一起沉底，谁也没超过谁');
});

t('块内带阶段的任务，块头勾选把阶段一起设', function () {
  var data = fresh();
  var b = poolBlock(data, '打包', ['护照']);
  b.kids[0].stages = [
    { id: 's1', text: '找护照', completed: false, createdAt: 1 },
    { id: 's2', text: '装包', completed: false, createdAt: 1 }
  ];
  b.kids[0].completed = false;

  TaskOps.togglePoolBlock(data, b.block.id, true);

  h.assertEqual(b.kids[0].stages[0].completed, true);
  h.assertEqual(b.kids[0].stages[1].completed, true);
});

t('空块勾选：不报错，但块永远不算完成', function () {
  var data = fresh();
  var b = poolBlock(data, '打包', []);

  var r = TaskOps.togglePoolBlock(data, b.block.id, true);

  h.assertTrue(r.ok, '空块勾选不该失败（界面上勾选框还在）');
  h.assertEqual(b.block.completed, false, '空块没有可完成的东西（store.blockDone）');
});

t('池内块本体不沉底：勾完块头，块在池顶层的位置不变', function () {
  var data = fresh();
  var b = poolBlock(data, '打包', ['护照']);
  poolTask(data, '相册整理');
  h.assertEqual(poolTexts(data), '打包,相册整理');

  TaskOps.togglePoolBlock(data, b.block.id, true);

  h.assertEqual(poolTexts(data), '打包,相册整理');
});

t('不存在的块 id → NOT_FOUND', function () {
  var data = fresh();
  h.assertEqual(TaskOps.togglePoolBlock(data, 'no-such-block', true).error,
    TaskOps.ERR.NOT_FOUND);
});

t('把**任务**的 id 传给 togglePoolBlock → NOT_FOUND（只认块）', function () {
  var data = fresh();
  var task = poolTask(data, '相册整理');
  h.assertEqual(TaskOps.togglePoolBlock(data, task.id, true).error,
    TaskOps.ERR.NOT_FOUND);
});

// ---------------------------------------------------------------------------
h.group('渲染：池内块头和象限块头一套格式');

t('块头有勾选框、块名、完成度 n/m', function () {
  var html = renderPool([{ id: 'b1', type: 'block', text: '打包', tasks: [] }]);

  h.assertTrue(html.indexOf('pool__block-check') !== -1, '缺块头勾选框');
  h.assertTrue(html.indexOf('pool__block-name') !== -1, '缺块名');
  h.assertTrue(html.indexOf('0/0') !== -1, '空块也该显示完成度 0/0（和象限块头一致）');
});

t('完成度按最细可勾选单位算（块内任务的阶段也算）', function () {
  var items = [{
    id: 'b1', type: 'block', text: '打包', completed: false,
    tasks: [
      { id: 'k1', text: '护照', completed: true, createdAt: 1 },
      {
        id: 'k2', text: '写报告', completed: false, createdAt: 1,
        stages: [
          { id: 's1', text: '收集', completed: true, createdAt: 1 },
          { id: 's2', text: '初稿', completed: false, createdAt: 1 }
        ]
      }
    ]
  }];

  var html = renderPool(items);

  h.assertTrue(html.indexOf('2/3') !== -1, '1 条任务 + 阶段里 1 条 = 2/3：' + html);
});

t('块全完成时勾选框 checked、块名划掉', function () {
  var items = [{
    id: 'b1', type: 'block', text: '打包',
    tasks: [{ id: 'k1', text: '护照', completed: true, createdAt: 1 }]
  }];

  var html = renderPool(items);

  h.assertTrue(/pool__block-check" checked/.test(html), '块头勾选框该打勾：' + html);
  h.assertTrue(html.indexOf('pool__block--done') !== -1, '完成态要落下类名给 CSS 划掉');
});

t('块头的排列顺序：勾选框 → 块名 → 完成度 → 折叠三角', function () {
  var html = renderPool([{ id: 'b1', type: 'block', text: '打包', tasks: [] }]);
  var pCheck = html.indexOf('pool__block-check');
  var pName = html.indexOf('pool__block-name');
  var pProg = html.indexOf('task__progress');
  var pToggle = html.indexOf('pool__block-toggle');

  h.assertTrue(pCheck < pName && pName < pProg && pProg < pToggle,
    '顺序该和象限块头一致（勾选框 / 块名 / 完成度 / 三角）');
});

t('块名要转义', function () {
  var html = renderPool([
    { id: 'b1', type: 'block', text: '<img src=x onerror=alert(1)>', tasks: [] }
  ]);

  h.assertFalse(html.indexOf('<img') !== -1, '原始标签不能出现');
  h.assertTrue(html.indexOf('&lt;img') !== -1);
});

t('改块名时整条收成输入框，值也要转义', function () {
  var html = renderPool(
    [{ id: 'b1', type: 'block', text: '他说"你好"', tasks: [] }],
    { editing: { mode: 'edit-pool-block', blockId: 'b1' } }
  );

  h.assertTrue(html.indexOf('task__input') !== -1, '输入框复用任务的');
  h.assertTrue(html.indexOf('&quot;') !== -1, '引号不转义会提前闭合 value');
  h.assertTrue(html.indexOf('pool__block--editing') !== -1, '编辑态要落下类名给 CSS');
});

t('别的块在编辑时，这一块照常渲染', function () {
  var html = renderPool(
    [{ id: 'b1', type: 'block', text: '打包', tasks: [] }],
    { editing: { mode: 'edit-pool-block', blockId: 'b2' } }
  );

  h.assertTrue(html.indexOf('pool__block-check') !== -1);
  h.assertTrue(html.indexOf('task__input') === -1);
});

// ---------------------------------------------------------------------------
h.group('渲染：池内任务行有了勾选框');

t('每一行有勾选框和文字', function () {
  var html = renderPool([{ id: 'p1', text: '相册整理', completed: false, createdAt: 1 }]);

  h.assertTrue(html.indexOf('class="pool__check"') !== -1, '缺池内勾选框');
  h.assertTrue(html.indexOf('相册整理') !== -1);
});

t('已完成的行：勾选框打勾、落下完成态类名', function () {
  var html = renderPool([{ id: 'p1', text: '相册整理', completed: true, createdAt: 1 }]);

  h.assertTrue(/pool__check" checked/.test(html), '该打勾：' + html);
  h.assertTrue(html.indexOf('pool__item--done') !== -1, '完成态要落下类名给 CSS 划掉');
});

t('未完成的行不带完成态类名', function () {
  var html = renderPool([{ id: 'p1', text: '相册整理', completed: false, createdAt: 1 }]);

  h.assertFalse(html.indexOf('pool__item--done') !== -1);
});

t('带阶段的任务：勾选框状态读派生 completed，不是数阶段', function () {
  // 阶段勾了 1/2 → store.normalize 会把 completed 派生成 false
  var data = fresh();
  var task = poolTask(data, '写报告');
  task.stages = [
    { id: 's1', text: '收集', completed: true, createdAt: 1 },
    { id: 's2', text: '初稿', completed: false, createdAt: 1 }
  ];
  task.completed = false;

  var html = renderPool([task]);

  h.assertFalse(/pool__check" checked/.test(html), '没全完成就不该打勾');
});

t('池内块里的任务行也带勾选框', function () {
  var html = renderPool([{
    id: 'b1', type: 'block', text: '打包', completed: false,
    tasks: [{ id: 'k1', text: '护照', completed: false, createdAt: 1 }]
  }]);

  h.assertTrue(html.indexOf('class="pool__check"') !== -1, '块内任务也要能勾');
  h.assertTrue(html.indexOf('pool__block-tasks') !== -1, '还是块内列表里');
});

t('编辑池内任务文字时，那一行还是收成输入框（老行为不动）', function () {
  var html = renderPool(
    [{ id: 'p1', text: '相册整理', completed: false, createdAt: 1 }],
    { editing: { mode: 'edit-pool', poolItemId: 'p1' } }
  );

  h.assertTrue(html.indexOf('task__input') !== -1);
  h.assertFalse(html.indexOf('pool__check') !== -1, '编辑态整行只有输入框');
});

// ---------------------------------------------------------------------------
h.group('跨文件守卫：render 画的池内控件，drag / app / css 都得跟上');

t('池内两个勾选框都在 drag.js 的 isInteractive 名单里', function () {
  ['pool__check', 'pool__block-check'].forEach(function (cls) {
    h.assertTrue(dragSrc.indexOf("closestEl(node, '" + cls + "')") !== -1,
      cls + ' 不在 isInteractive 里 —— 鼠标按住它挪一点就会变成拖拽');
  });
});

t('池内勾选框**是**拖拽把手了（v2.10 需求 2，把 D-62 反过来）', function () {
  var start = dragSrc.indexOf('function isCheckHandle');
  var end = dragSrc.indexOf('}', dragSrc.indexOf('block__check', start));
  var body = dragSrc.slice(start, end);

  // v2.7 时池内勾选框刻意**不**当把手（D-62），代价是池条目整条可拖、
  // 触摸端拖不了滚动条（R-33）。v2.10 需求 2 要求「象限模式和计划池中所有
  // 任务/阶段的拖拽都要以勾选位置为 handle」，这条反过来。
  h.assertTrue(body.indexOf('pool__check') !== -1,
    'isCheckHandle 里要有 pool__check：池内拖拽的把手就是勾选框');
  h.assertTrue(body.indexOf('pool__block-check') !== -1,
    'isCheckHandle 里要有 pool__block-check：拖整块的把手是块头的勾选框');
  h.assertTrue(ruleBody('.pool__item').indexOf('touch-action') === -1,
    '池内条目本体不该再有 touch-action（行其余区域要留给触摸滚动，解 R-33）');
});

t('app.js 认得出这三个新入口', function () {
  ['pool__check', 'pool__block-check', 'pool__block-name'].forEach(function (cls) {
    h.assertTrue(appSrc.indexOf("closest(target, '" + cls + "')") !== -1,
      'bindPool 里没有 ' + cls + ' 的点击分支');
  });
  h.assertTrue(appSrc.indexOf('function startEditPoolBlock') !== -1, '缺改块名的入口');
  h.assertTrue(appSrc.indexOf("editing.mode === 'edit-pool-block'") !== -1,
    'commitEdit 里没有 edit-pool-block 分支');
  h.assertTrue(appSrc.indexOf('TaskOps.togglePoolItem') !== -1, '没有接数据层的勾选');
  h.assertTrue(appSrc.indexOf('TaskOps.togglePoolBlock') !== -1, '没有接数据层的块头勾选');
});

t('改池内块名复用 editPoolItem（不新增数据层函数，D-63）', function () {
  var opsSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'task-ops.js'), 'utf8');
  var commit = appSrc.slice(appSrc.indexOf("editing.mode === 'edit-pool-block'"));
  var body = commit.slice(0, commit.indexOf('}'));

  h.assertTrue(body.indexOf('editPoolItem') !== -1, '改块名该走 editPoolItem');
  h.assertFalse(opsSrc.indexOf('function editPoolBlock') !== -1,
    '不该多出一份 editPoolBlock（改空拒绝的规矩只该有一处）');
});

t('CSS：完成态划掉、块名可点、两个勾选框不设 touch-action', function () {
  h.assertTrue(ruleBody('.pool__item--done .pool__text').indexOf('line-through') !== -1,
    '池内完成态要划掉');
  h.assertTrue(ruleBody('.pool__block--done .pool__block-name').indexOf('line-through') !== -1,
    '块完成态要划掉块名');
  h.assertTrue(ruleBody('.pool__block-name').indexOf('cursor: text') !== -1,
    '块名要看得出去能点（和 .block__name 同款）');
  h.assertTrue(ruleBody('.pool__check').indexOf('touch-action') === -1,
    '.pool__check 不该设 touch-action（它不是把手，D-62）');
});

t('保护模式名单里有池内勾选框和块名', function () {
  h.assertTrue(readonlyBlocks('pool__check'),
    '保护模式下池内勾选框该点不动');
  h.assertTrue(readonlyBlocks('pool__block-check'),
    '保护模式下块头勾选框该点不动');
  h.assertTrue(readonlyBlocks('pool__block-name'),
    '保护模式下点块名改名要挡住');
});

// ---------------------------------------------------------------------------
h.group('外框对齐象限块（v2.8 需求 2：带一个蓝色边框）');

/** 两个选择器的规则体里，同一条声明是不是都有 */
function bothHave(decl) {
  return quadrantBlockBody().indexOf(decl) !== -1 &&
         ruleBody('.pool__block').indexOf(decl) !== -1;
}

/**
 * 取 `.block` 自己的规则体。
 *
 * 不能用 ruleBody('.block')：`css.indexOf('.block {')` 会先撞上
 * `... .block { cursor: grabbing; }` 这类后代选择器的尾巴（`.block` 前面
 * 还有别的选择器），拿到的是别人的规则体。这里按规则逐条比对**完整**
 * 选择器，只有选择器正好是 `.block` 的那一条才算数。
 *
 * 比对前必须先去掉注释：`[^{}]+` 会把上一条规则结尾到本规则 `{` 之间的
 * 注释也吞进来，不去掉的话选择器串会以「注释结束符 + .block」结尾，
 * 永远匹配不上。
 */
function quadrantBlockBody() {
  var clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  var re = /([^{}]+)\{([^}]*)\}/g;
  var m;
  while ((m = re.exec(clean)) !== null) {
    var sels = m[1].split(',').map(function (s) { return s.trim(); });
    if (sels.indexOf('.block') !== -1) return m[2];
  }
  return '';
}

t('池内块有蓝色左边框（--q2，就是象限 II 那个蓝）', function () {
  h.assertTrue(ruleBody('.pool__block').indexOf('border-left: 3px solid var(--q2)') !== -1,
    '池内块该有一条蓝色左边框 —— 这是需求点名要的那条');
});

t('池内块的整圈边框、底色、圆角和象限块**逐条一致**', function () {
  h.assertTrue(quadrantBlockBody().indexOf('border-left: 3px solid var(--q2)') !== -1,
    '先确认取到的是 .block 自己的规则体（取错了这条会先红）');

  ['border: 1px solid var(--border)',
   'border-left: 3px solid var(--q2)',
   'border-radius: 6px',
   'background: color-mix(in srgb, var(--q2) 4%, var(--surface))'
  ].forEach(function (decl) {
    h.assertTrue(bothHave(decl),
      '「' + decl + '」在 .block 和 .pool__block 之间对不上 —— 两边看着就不是一种东西了');
  });
});

t('不再是以前那条灰竖线', function () {
  h.assertFalse(ruleBody('.pool__block').indexOf('border-left: 3px solid var(--border)') !== -1,
    '灰竖线该被蓝色边框取代');
});

t('边框贴着内容会挤，块里留了内边距', function () {
  h.assertTrue(ruleBody('.pool__block').indexOf('padding:') !== -1,
    '加了边框却没留内边距，块名会贴到框上');
});

// ---------------------------------------------------------------------------

h.summary('池内任务块对齐象限（v2.7 需求 1 / v2.8 需求 2）');
