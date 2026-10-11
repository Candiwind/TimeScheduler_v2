/**
 * test-pool-v12.js
 *
 * v2.12 需求 7 / 需求 11（见 DS 2.49 / D-79）：
 *
 *   需求 7：计划池里勾选**完成**之后，把它行上的「完成时间」更新成**今天**。
 *           连带一条推断出来的规矩：**已完成的池条目不参与自动导入** ——
 *           不跳过的话，勾完当天它的日期就是今天，「到期」立刻成立，
 *           下一次启动它就被搬进象限（把「池里勾完不移出池」当场推翻）。
 *   需求 11：池里的任务（含块内任务）保留 🎁 Bonus 标识（只读，池里不给开关）。
 *
 * 跑法：node test/test-pool-v12.js
 */
'use strict';

var h = require('./harness');
var fs = require('fs');
var path = require('path');
var Util = require('../js/util');
var Store = require('../js/store');
var TaskOps = require('../js/task-ops');
var Render = require('../js/render');

var t = h.test;
var DATE = '2026-10-01';
var renderSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'render.js'), 'utf8');

/** 一个新的空数据 + 一条池内任务（plannedDate 由调用方决定） */
function poolWith(text) {
  var data = Store.createEmpty();
  var added = TaskOps.addPoolItem(data, DATE, text);
  return { data: data, item: added.task };
}

// ---------------------------------------------------------------------------
h.group('需求 7：勾完把「完成时间」更新成今天');

t('勾选完成 → plannedDate 变成今天', function () {
  var ctx = poolWith('交电话费');
  var before = ctx.item.plannedDate;
  h.assertTrue(!!before, '加进池时本来就有默认完成时间');

  TaskOps.togglePoolItem(ctx.data, ctx.item.id, true);

  h.assertEqual(ctx.item.plannedDate, Util.todayStr(), '完成后显示「哪天做完的」');
  h.assertFalse(ctx.item.plannedDate === before, '不再是当初计划的日期');
});

t('取消勾选**不改回来**（和「完成沉底后取消不移回」同一条规矩）', function () {
  var ctx = poolWith('交电话费');
  TaskOps.togglePoolItem(ctx.data, ctx.item.id, true);
  TaskOps.togglePoolItem(ctx.data, ctx.item.id, false);

  h.assertEqual(ctx.item.plannedDate, Util.todayStr(), '取消勾选不动那个日期');
  h.assertFalse(ctx.item.completed);
});

t('块内任务勾完：自己的完成时间变今天，宿主块完成度重算', function () {
  var data = Store.createEmpty();
  var block = TaskOps.addPoolBlock(data, '搬家').block;
  var child = TaskOps.addPoolBlockTask(data, DATE, block.id, '打包装箱').task;

  TaskOps.togglePoolItem(data, child.id, true);

  h.assertEqual(child.plannedDate, Util.todayStr());
  h.assertTrue(block.completed, '块里唯一一条做完了，块跟着完成');
});

t('块头一键全勾：块内每条都盖成今天；**块本体不设**（DDL 以任务为单位）', function () {
  var data = Store.createEmpty();
  var block = TaskOps.addPoolBlock(data, '搬家').block;
  var a = TaskOps.addPoolBlockTask(data, DATE, block.id, '装箱').task;
  var b = TaskOps.addPoolBlockTask(data, DATE, block.id, '叫车').task;
  a.plannedDate = '2026-09-01';   // 故意设成过去的日期，看它还改不改
  b.plannedDate = null;

  TaskOps.togglePoolBlock(data, block.id, true);

  h.assertEqual(a.plannedDate, Util.todayStr());
  h.assertEqual(b.plannedDate, Util.todayStr());
  h.assertEqual(block.plannedDate, undefined, '块本体没有 plannedDate（D-51 不变）');
  h.assertTrue(block.completed);
});

t('块头取消全勾：只改完成状态，日期一个都不动', function () {
  var data = Store.createEmpty();
  var block = TaskOps.addPoolBlock(data, '搬家').block;
  var a = TaskOps.addPoolBlockTask(data, DATE, block.id, '装箱').task;
  TaskOps.togglePoolBlock(data, block.id, true);
  TaskOps.setPoolDate(data, a.id, '2026-09-09');

  TaskOps.togglePoolBlock(data, block.id, false);

  h.assertEqual(a.plannedDate, '2026-09-09', '取消勾选不碰日期');
});

t('带阶段的任务：勾完（= 全部阶段一起勾）后完成时间变今天', function () {
  var data = Store.createEmpty();
  var task = TaskOps.addTask(data, DATE, 'I', '写报告').task;
  TaskOps.addStage(data, DATE, 'I', task.id, '收集数据');
  TaskOps.addStage(data, DATE, 'I', task.id, '写初稿');
  TaskOps.postponeTask(data, DATE, 'I', task.id);

  var pooled = data.pool[0];
  h.assertTrue(!!pooled.stages, '阶段跟着进池');
  TaskOps.togglePoolItem(data, pooled.id, true);

  h.assertEqual(pooled.plannedDate, Util.todayStr());
  h.assertTrue(pooled.completed);
});

// ---------------------------------------------------------------------------
h.group('需求 7 连带：已完成的池条目不参与自动导入（D-79 / R-51）');

t('未完成的到期条目照常自动导入今天 Q-II', function () {
  var ctx = poolWith('该做的事');
  TaskOps.setPoolDate(ctx.data, ctx.item.id, Util.todayStr());

  var r = TaskOps.autoImportDuePoolItems(ctx.data, Util.todayStr());
  h.assertTrue(r.ok);
  h.assertEqual(r.imported, 1);
  h.assertEqual(ctx.data.pool.length, 0);
});

t('已完成的到期条目**不**导入（它留在池里）', function () {
  var ctx = poolWith('已经做完的');
  TaskOps.togglePoolItem(ctx.data, ctx.item.id, true);   // 完成时间被改成今天

  var r = TaskOps.autoImportDuePoolItems(ctx.data, Util.todayStr());
  h.assertTrue(r.ok);
  h.assertEqual(r.imported, 0, '做完的东西第二天不该自己冒出来');
  h.assertEqual(ctx.data.pool.length, 1, '仍留在池里');
});

t('连跑两次也不会把它搬走（幂等）', function () {
  var ctx = poolWith('已经做完的');
  TaskOps.togglePoolItem(ctx.data, ctx.item.id, true);
  TaskOps.autoImportDuePoolItems(ctx.data, Util.todayStr());
  TaskOps.autoImportDuePoolItems(ctx.data, Util.todayStr());
  h.assertEqual(ctx.data.pool.length, 1);
});

t('块：全部子任务都完成 → 整块不自动导入；有一条没完成 → 照常整块回来', function () {
  var data = Store.createEmpty();
  var block = TaskOps.addPoolBlock(data, '搬家').block;
  var a = TaskOps.addPoolBlockTask(data, DATE, block.id, '装箱').task;
  var b = TaskOps.addPoolBlockTask(data, DATE, block.id, '叫车').task;
  TaskOps.setPoolDate(data, a.id, '2026-09-01');
  TaskOps.togglePoolItem(data, a.id, true);

  var r1 = TaskOps.autoImportDuePoolItems(data, Util.todayStr());
  h.assertEqual(r1.imported, 1, '还有一条没做完 → 整块回来');
  h.assertEqual(data.pool.length, 0);

  // 反过来：三条都做完的块留在池里
  var data2 = Store.createEmpty();
  var block2 = TaskOps.addPoolBlock(data2, '搬家').block;
  var c = TaskOps.addPoolBlockTask(data2, DATE, block2.id, '装箱').task;
  TaskOps.addPoolBlockTask(data2, DATE, block2.id, '叫车');
  TaskOps.togglePoolBlock(data2, block2.id, true);
  TaskOps.setPoolDate(data2, c.id, Util.todayStr());

  var r2 = TaskOps.autoImportDuePoolItems(data2, Util.todayStr());
  h.assertEqual(r2.imported, 0, '整块都做完了 → 不自动导入');
  h.assertEqual(data2.pool.length, 1);
});

t('手动「导入」不受这条限制：已完成的照样能搬进象限', function () {
  var ctx = poolWith('已经做完的');
  TaskOps.togglePoolItem(ctx.data, ctx.item.id, true);
  TaskOps.setPoolDate(ctx.data, ctx.item.id, Util.todayStr());

  var r = TaskOps.restoreFromPool(ctx.data, DATE, 'II', ctx.item.id, 0);
  h.assertTrue(r.ok, '明确意图照做');
  h.assertEqual(ctx.data.pool.length, 0);
  h.assertEqual(ctx.data.dates[DATE].II[0].id, ctx.item.id);
});

// ---------------------------------------------------------------------------
h.group('需求 11：池里保留 🎁 标识（只读）');

t('推迟进来的 Bonus 任务：字段跟着走，池里也画出来', function () {
  var data = Store.createEmpty();
  var task = TaskOps.addTask(data, DATE, 'I', '额外做的事').task;
  TaskOps.setBonus(data, DATE, 'I', task.id, true);
  TaskOps.postponeTask(data, DATE, 'I', task.id);

  var pooled = data.pool[0];
  h.assertEqual(pooled.bonus, true, 'Bonus 是「同一个对象搬位置」，字段不会丢');

  var html = Render.buildPoolItemHtml(pooled, null);
  h.assertTrue(html.indexOf('bonus__mark') !== -1, '池行上要看得到 🎁');
  h.assertTrue(html.indexOf('🎁') !== -1);
});

t('没标 Bonus 的池条目：不画 🎁', function () {
  var ctx = poolWith('普通任务');
  var html = Render.buildPoolItemHtml(ctx.item, null);
  h.assertFalse(html.indexOf('🎁') !== -1);
  h.assertFalse(html.indexOf('bonus__mark') !== -1);
});

t('池内块里的任务也画（块本体的 bonus 不画 —— 块是容器，没有 Bonus）', function () {
  var data = Store.createEmpty();
  var block = TaskOps.addPoolBlock(data, '搬家').block;
  var child = TaskOps.addPoolBlockTask(data, DATE, block.id, '装箱').task;
  child.bonus = true;

  var blockHtml = Render.buildPoolBlockHtml(block, { progressOf: TaskOps.progressOfItem });
  h.assertTrue(blockHtml.indexOf('🎁') !== -1, '块内那条带着 🎁');
  h.assertEqual(block.bonus, undefined, '块本体没有 bonus 这回事');

  var head = blockHtml.slice(0, blockHtml.indexOf('<ul'));
  h.assertFalse(head.indexOf('🎁') !== -1, '块头上不该画 🎁');
});

t('池里是**只读**标识：没有切换 Bonus 的按钮', function () {
  var ctx = poolWith('任务');
  ctx.item.bonus = true;
  var html = Render.buildPoolItemHtml(ctx.item, null);

  h.assertFalse(html.indexOf('pool__bonus') !== -1, '池里不提供改 Bonus 的入口（D-61）');
  h.assertFalse(html.indexOf('task__bonus') !== -1);
  h.assertTrue(html.indexOf('<span class="bonus__mark"') !== -1, '就是一个展示用的标记');
});

t('Bonus 标记画在右侧控件组里（手机端跟着整组折行）', function () {
  var ctx = poolWith('任务');
  ctx.item.bonus = true;
  var html = Render.buildPoolItemHtml(ctx.item, null);

  var open = html.indexOf('<span class="task__actions">');
  var mark = html.indexOf('bonus__mark');
  h.assertTrue(open !== -1 && mark > open, '标记在 .task__actions 组内');
});

t('池里标不了 Bonus —— 数据层没有 pool 版的 setBonus（进池前在象限里标）', function () {
  h.assertEqual(typeof TaskOps.setPoolBonus, 'undefined');
  h.assertTrue(renderSrc.indexOf('pool__bonus') === -1);
});

// ---------------------------------------------------------------------------

h.summary('池内完成时间与 Bonus 标识（v2.12 需求 7 / 需求 11）');
