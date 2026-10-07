/**
 * test-cross-drag.js
 *
 * 象限 ↔ 计划池 的**双向**拖拽（v2.10 需求 3，见 DS 2.43 / D-74）。
 *
 * 需求原话是「象限中所有可能的拖动情况，在计划池中都需要相应支持，相互之间
 * 的拖动都需要支持」。象限里有四种落点：同象限换位、跨象限、**进块**、
 * **出块**；池里对应地也要有：池内换顺序、池内跨容器（顶层 ↔ 块内）、
 * 落进池内块、从池内块取出。再加上两个区域之间的四种搬运。
 *
 * 数据层这一半在 task-ops 里（可以真跑）；drag.js / app.js 那一半是 DOM 和
 * 指针事件，node 里跑不了，只能查「关键入口在不在、有没有被绕过」——
 * 沿用 test-pool-order.js 的 source guard 办法。
 *
 * 跑法：node test/test-cross-drag.js
 */
'use strict';

var h = require('./harness');
var fs = require('fs');
var path = require('path');

var Store = require('../js/store');
var TaskOps = require('../js/task-ops');

var t = h.test;
var ROOT = path.join(__dirname, '..');
var dragSrc = fs.readFileSync(path.join(ROOT, 'js', 'drag.js'), 'utf8');
var appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');

var DATE = '2026-10-01';
var NEXT = '2026-10-02';   // 进池默认完成时间 = 所属日期 + 1 天

/** 造一份 I 象限有 甲/乙/丙 的数据 */
function seed() {
  var data = Store.createEmpty();
  var ids = [];
  ['甲', '乙', '丙'].forEach(function (text) {
    ids.push(TaskOps.addTask(data, DATE, 'I', text).task.id);
  });
  // addTask 加在开头，倒过来加才是 甲,乙,丙
  data.dates[DATE].I.reverse();
  return { data: data, ids: ids };
}

function texts(list) {
  var out = [];
  for (var i = 0; i < list.length; i++) out.push(list[i].text);
  return out.join(',');
}

function poolTop(data) {
  return Array.isArray(data.pool) ? data.pool : [];
}

function quadrantIds(data, qid) {
  var day = data.dates[DATE];
  return texts(day && day[qid] ? day[qid] : []);
}

/** 池内的一个任务块，按文本找（findPoolItem / blockTasks 都是公开的） */
function poolBlockByName(data, name) {
  var pool = poolTop(data);
  for (var i = 0; i < pool.length; i++) {
    if (pool[i].type === 'block' && pool[i].text === name) return pool[i];
  }
  return null;
}

/** 往池里塞一个带两条任务的块，返回那个块 */
function seedPoolBlock(data, name, childTexts) {
  var block = TaskOps.addPoolBlock(data, name).block;
  for (var i = 0; i < childTexts.length; i++) {
    TaskOps.addPoolBlockTask(data, DATE, block.id, childTexts[i]);
  }
  return block;
}

// ---------------------------------------------------------------------------
h.group('象限 → 计划池（需求 3.1 / 3.2）');

t('象限任务 → 池顶层指定位置', function () {
  var s = seed();
  TaskOps.postponeTask(s.data, DATE, 'I', s.ids[0]);   // 甲 进池
  TaskOps.postponeTask(s.data, DATE, 'I', s.ids[2]);   // 丙 进池 → 池：甲,丙

  var r = TaskOps.moveTaskToPool(s.data, DATE, s.ids[1], null, 0);   // 乙 拖到最前

  h.assertTrue(r.ok, '拖进池顶层该成功');
  h.assertEqual(texts(poolTop(s.data)), '乙,甲,丙', '落点就位，不是压到末尾');
});

t('象限任务 → 池内的任务块（需求 3.1 的原话）', function () {
  var s = seed();
  var block = seedPoolBlock(s.data, '池块', ['池一', '池二']);

  var r = TaskOps.moveTaskToPool(s.data, DATE, s.ids[1], block.id, 0);

  h.assertTrue(r.ok);
  h.assertEqual(texts(block.tasks), '乙,池一,池二', '落在块内第 0 位');
});

t('象限任务落进池块：任务本体没被改造，只多一个完成时间', function () {
  var s = seed();
  var block = seedPoolBlock(s.data, '池块', []);
  TaskOps.moveTaskToPool(s.data, DATE, s.ids[0], block.id, 0);

  var task = block.tasks[0];
  h.assertEqual(task.id, s.ids[0], '搬的是同一个对象，不是复制品');
  h.assertEqual(task.completed, false, '完成状态一条不丢');
  h.assertEqual(task.plannedDate, NEXT, '进池默认完成时间 = 所属日期 + 1 天');
});

t('拖空最后一格的象限任务：那一天收掉，不留空壳日期', function () {
  var s = seed();
  TaskOps.moveTaskToPool(s.data, DATE, s.ids[0], null, 99);
  TaskOps.moveTaskToPool(s.data, DATE, s.ids[1], null, 99);
  TaskOps.moveTaskToPool(s.data, DATE, s.ids[2], null, 99);

  h.assertEqual(s.data.dates[DATE], undefined, '四个象限都空了，dates 里不该留这一天');
  h.assertEqual(texts(poolTop(s.data)), '甲,乙,丙');
});

t('象限任务块 → 池顶层指定位置（整块不拆散）', function () {
  var s = seed();
  var qblock = TaskOps.addBlock(s.data, DATE, 'I', '象限块').block;
  TaskOps.moveTaskIntoBlock(s.data, DATE, s.ids[0], qblock.id, 0);
  TaskOps.moveTaskIntoBlock(s.data, DATE, s.ids[1], qblock.id, 1);
  TaskOps.postponeTask(s.data, DATE, 'I', s.ids[2]);   // 池先有一条，验落点

  var r = TaskOps.moveBlockToPool(s.data, DATE, qblock.id, 0);

  h.assertTrue(r.ok);
  h.assertEqual(poolTop(s.data)[0].id, qblock.id, '整块落在第 0 位');
  h.assertEqual(poolTop(s.data)[0].type, 'block');
  h.assertEqual(texts(poolTop(s.data)[0].tasks), '甲,乙', '块内任务一条不少');
});

t('整块进池：完成时间逐条设在块内任务上，块本体不设（D-51）', function () {
  var s = seed();
  var qblock = TaskOps.addBlock(s.data, DATE, 'I', '象限块').block;
  TaskOps.moveTaskIntoBlock(s.data, DATE, s.ids[0], qblock.id, 0);

  TaskOps.moveBlockToPool(s.data, DATE, qblock.id, 0);
  var moved = poolTop(s.data)[0];

  h.assertEqual(moved.tasks[0].plannedDate, NEXT);
  h.assertEqual(moved.plannedDate, undefined, '块只是分组容器，自己不该有完成时间');
});

t('块不许拖进池内的块里（规矩 1：块里不套块）', function () {
  var s = seed();
  var qblock = TaskOps.addBlock(s.data, DATE, 'I', '象限块').block;
  var pblock = seedPoolBlock(s.data, '池块', []);

  // drag.js 会把这个落点判成「不受理」，这里验的是数据层兜底也不放行
  h.assertFalse(qblock === null || pblock === null);
  var r = TaskOps.movePoolItemTo(s.data, pblock.id, pblock.id, 0);
  h.assertFalse(r.ok, '把块拖进它自己也得拦住');
  h.assertEqual(pblock.tasks.length, 0, '被拒绝时数据一个字节都不动');
});

// ---------------------------------------------------------------------------
h.group('计划池 → 象限（需求 3：「相互之间」）');

t('池内任务 → 象限顶层指定位置', function () {
  var s = seed();
  TaskOps.postponeTask(s.data, DATE, 'I', s.ids[0]);   // 甲 进池
  var poolId = poolTop(s.data)[0].id;

  var r = TaskOps.restoreFromPool(s.data, DATE, 'II', poolId, 0, null);

  h.assertTrue(r.ok);
  h.assertEqual(quadrantIds(s.data, 'II'), '甲', '回到指定的象限');
  h.assertEqual(poolTop(s.data).length, 0, '是移动不是复制，池里不再保留');
});

t('池内任务 → 象限**任务块里**（需求 3 的对应形式）', function () {
  var s = seed();
  TaskOps.postponeTask(s.data, DATE, 'I', s.ids[0]);   // 甲 进池
  var poolId = poolTop(s.data)[0].id;

  var qblock = TaskOps.addBlock(s.data, DATE, 'II', '象限块').block;
  TaskOps.moveTaskIntoBlock(s.data, DATE, s.ids[1], qblock.id, 0);

  var r = TaskOps.restoreFromPool(s.data, DATE, 'II', poolId, 0, qblock.id);

  h.assertTrue(r.ok);
  h.assertEqual(texts(qblock.tasks), '甲,乙', '落进块内第 0 位');
  h.assertEqual(poolTop(s.data).length, 0, '池里不再保留');
});

t('池内的**块**不许拖进象限的块里（规矩 1 两边一致）', function () {
  var s = seed();
  var pblock = seedPoolBlock(s.data, '池块', []);
  var qblock = TaskOps.addBlock(s.data, DATE, 'II', '象限块').block;

  var r = TaskOps.restoreFromPool(s.data, DATE, 'II', pblock.id, 0, qblock.id);

  h.assertFalse(r.ok, '块进块该被拒绝');
  h.assertEqual(quadrantIds(s.data, 'II'), '象限块', '数据不动');
});

t('拖回象限后宿主块的完成度重算', function () {
  var s = seed();
  var qblock = TaskOps.addBlock(s.data, DATE, 'I', '象限块').block;
  TaskOps.moveTaskIntoBlock(s.data, DATE, s.ids[0], qblock.id, 0);
  TaskOps.moveTaskIntoBlock(s.data, DATE, s.ids[1], qblock.id, 1);

  // 把块内的 甲 拖出象限（顶层的 丙 还在，所以这一天不会消失）
  var moved = TaskOps.moveTaskToPool(s.data, DATE, s.ids[0], null, 0);
  h.assertTrue(moved.ok);
  var back = TaskOps.restoreFromPool(s.data, DATE, 'II', poolTop(s.data)[0].id, 0, null);
  h.assertTrue(back.ok);
  h.assertEqual(texts(qblock.tasks), '乙', '原宿主块里只剩乙');
});

// ---------------------------------------------------------------------------
h.group('池内自身的跨容器搬运（象限能进块出块，池里也要能）');

t('池顶层任务 → 池内块', function () {
  var s = seed();
  TaskOps.postponeTask(s.data, DATE, 'I', s.ids[0]);   // 甲 池顶层
  TaskOps.postponeTask(s.data, DATE, 'I', s.ids[1]);   // 乙 池顶层
  var block = seedPoolBlock(s.data, '池块', ['池一']);

  var r = TaskOps.movePoolItemTo(s.data, s.ids[0], block.id, 1);

  h.assertTrue(r.ok);
  h.assertEqual(texts(block.tasks), '池一,甲');
  // 池顶层原本是 甲,乙,池块（甲、乙各推迟一次，块再追加在末尾）
  h.assertEqual(texts(poolTop(s.data)), '乙,池块', '池顶层少了甲，块还在原位');
});

t('池内块里的任务 → 池顶层指定位置（出块）', function () {
  var s = seed();
  TaskOps.postponeTask(s.data, DATE, 'I', s.ids[2]);   // 丙 池顶层 → 池：块,丙
  var block = seedPoolBlock(s.data, '池块', ['池一', '池二']);
  var innerId = block.tasks[0].id;

  var r = TaskOps.movePoolItemTo(s.data, innerId, null, 0);

  h.assertTrue(r.ok);
  h.assertEqual(texts(block.tasks), '池二', '从块里摘出去了');
  // 池顶层原本是 丙,池块；池一从块里摘出来插到第 0 位
  h.assertEqual(texts(poolTop(s.data)), '池一,丙,池块', '落在池顶层第 0 位');
});

t('跨容器搬运时两端的宿主块完成度都重算', function () {
  var s = seed();
  TaskOps.postponeTask(s.data, DATE, 'I', s.ids[0]);
  TaskOps.postponeTask(s.data, DATE, 'I', s.ids[1]);
  TaskOps.togglePoolItem(s.data, s.ids[0]);   // 甲 已勾完

  var block = seedPoolBlock(s.data, '池块', []);
  TaskOps.movePoolItemTo(s.data, s.ids[0], block.id, 0);

  h.assertEqual(block.completed, true, '块内全完成 → 块头也该是完成（完成派生）');
});

t('movePoolItem（原地排序）仍然只在自己那个列表里排', function () {
  var s = seed();
  var block = seedPoolBlock(s.data, '池块', ['池一', '池二']);
  TaskOps.postponeTask(s.data, DATE, 'I', s.ids[0]);   // 池顶层多了 甲

  // 块内第一条：原地排序的落点必然是「块内」，不该跑到池顶层去
  var r = TaskOps.movePoolItem(s.data, block.tasks[0].id, 1);
  h.assertTrue(r.ok);
  h.assertEqual(texts(block.tasks), '池二,池一');
  h.assertEqual(texts(poolTop(s.data)), '池块,甲', '池顶层顺序一点没动');
});

// ---------------------------------------------------------------------------
h.group('兜底：找不到 / 越界 / 空输入都不崩');

t('找不到的 id → NOT_FOUND，数据一个字节不动', function () {
  var s = seed();
  var before = JSON.stringify(s.data);

  h.assertFalse(TaskOps.moveTaskToPool(s.data, DATE, 'id_missing', null, 0).ok);
  h.assertFalse(TaskOps.moveBlockToPool(s.data, DATE, 'id_missing', 0).ok);
  h.assertFalse(TaskOps.movePoolItemTo(s.data, 'id_missing', null, 0).ok);
  h.assertFalse(TaskOps.movePoolItemTo(s.data, s.ids[0], 'id_missing', 0).ok);
  h.assertFalse(TaskOps.restoreFromPool(s.data, DATE, 'II', 'id_missing', 0, null).ok);
  h.assertFalse(TaskOps.restoreFromPool(s.data, DATE, 'II', s.ids[0], 0, 'id_missing').ok);

  h.assertEqual(JSON.stringify(s.data), before, '失败路径不该改数据');
});

t('落点越界自动夹紧（-5 → 开头，99 → 末尾）', function () {
  var s = seed();
  TaskOps.postponeTask(s.data, DATE, 'I', s.ids[0]);   // 池：甲

  TaskOps.moveTaskToPool(s.data, DATE, s.ids[1], null, -5);   // 乙 拖到最前
  h.assertEqual(texts(poolTop(s.data)), '乙,甲', '负数夹到最前');

  TaskOps.moveTaskToPool(s.data, DATE, s.ids[2], null, 99);   // 丙 拖到最后
  h.assertEqual(texts(poolTop(s.data)), '乙,甲,丙', '越界夹到最后');
});

t('日期非法 → BAD_DATE', function () {
  var s = seed();
  h.assertEqual(TaskOps.moveTaskToPool(s.data, '2026-13-99', s.ids[0], null, 0).error,
    TaskOps.ERR.BAD_DATE);
  h.assertEqual(TaskOps.moveBlockToPool(s.data, '', s.ids[0], 0).error,
    TaskOps.ERR.BAD_DATE);
});

t('池内条目摘出只有一份实现（三处调用同一个 detachPoolItem）', function () {
  var ops = fs.readFileSync(path.join(ROOT, 'js', 'task-ops.js'), 'utf8');

  // 「先摘出来、再决定放哪」在 removePoolItem / movePoolItemTo / restoreFromPool
  // 三处都要做，摘出的规矩（块内删了要重算宿主块完成度）只该有一份
  h.assertTrue(ops.indexOf('function detachPoolItem') !== -1, '缺 detachPoolItem');
  var uses = ops.match(/detachPoolItem\(data, found\)/g) || [];
  h.assertTrue(uses.length >= 3,
    'detachPoolItem 该被 removePoolItem / movePoolItemTo / restoreFromPool 共用，实际 ' +
    uses.length + ' 处');
});

// ---------------------------------------------------------------------------
h.group('接线守卫：drag.js 解析落点，app.js 分派到数据层');

t('drag.js：落点统一带 region，池落点解析成 poolDropTarget', function () {
  h.assertTrue(dragSrc.indexOf('function poolDropTarget') !== -1, '缺池落点解析');
  h.assertTrue(dragSrc.indexOf("region: 'pool'") !== -1, '池落点该带 region: pool');
  h.assertTrue(dragSrc.indexOf("region: 'quadrant'") !== -1, '象限落点该带 region: quadrant');
  // v2.6 的池内专用标记取消了 —— 池内、池外现在共用一套落点形状
  h.assertFalse(dragSrc.indexOf('poolReorder') !== -1,
    'poolReorder 标记该已取消（合并进 region）');
});

t('drag.js：finish 把 region 和落点块一起报出去', function () {
  h.assertTrue(dragSrc.indexOf('region: s.target.region') !== -1,
    'finish 该报 region');
  h.assertTrue(dragSrc.indexOf('targetBlockId: s.target.blockId || null') !== -1,
    'finish 该报落点块');
});

t('drag.js：块不许落进任何块（池内块和象限块两种都要挡）', function () {
  var m = /var draggingBlock = [\s\S]*?\n/.exec(dragSrc);
  h.assertTrue(m !== null, '没找到「拖的是块」的判定');
  h.assertTrue(dragSrc.indexOf('state.isPoolBlock || state.kind === \'block\'') !== -1,
    '拖的是块时该同时认池内块和象限块');
  h.assertTrue(dragSrc.indexOf('if (draggingBlock && poolHit.blockId) return;') !== -1,
    '缺「块不许进块」的落点拦截');
});

t('app.js：按 region 分派到三个新入口 + restoreFromPool 带目标块', function () {
  h.assertTrue(appSrc.indexOf("if (info.region === 'pool')") !== -1,
    'onDrop 该先判落点区域');
  h.assertTrue(appSrc.indexOf('TaskOps.movePoolItemTo(state.data, info.poolItemId') !== -1,
    '池 → 池 该走 movePoolItemTo');
  h.assertTrue(appSrc.indexOf('TaskOps.moveBlockToPool(state.data, state.date') !== -1,
    '象限块 → 池 该走 moveBlockToPool');
  h.assertTrue(appSrc.indexOf('TaskOps.moveTaskToPool(state.data, state.date, info.taskId') !== -1,
    '象限任务 → 池 该走 moveTaskToPool');

  // 池 → 象限：第六个参数是目标块（落顶层时是 null）。
  // 锚在 onDrop 里那一处（doImportPoolItem 也调 restoreFromPool，参数不一样）
  h.assertTrue(appSrc.indexOf('var restored = TaskOps.restoreFromPool') !== -1,
    'onDrop 里没有 restoreFromPool 分派');
  var restore = appSrc.slice(appSrc.indexOf('var restored = TaskOps.restoreFromPool'));
  var call = restore.slice(0, restore.indexOf(');'));
  h.assertTrue(call.indexOf('info.targetBlockId') !== -1,
    'restoreFromPool 该把落点块传进去（否则池任务永远进不了象限的块）');
});

// ---------------------------------------------------------------------------

h.summary('象限 ↔ 计划池 双向拖拽（v2.10 需求 3）');
