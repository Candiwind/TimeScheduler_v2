/**
 * test-slots.js
 *
 * 完成时段（见 DS 2.12）：六个时段的六选一标记。
 *
 * 最要紧的三件事：
 *   1. 时段是**纯标记** —— 改时段，勾选状态、统计数字一个都不能变；
 *   2. 时段挂在**最细单位**上 —— 无阶段任务挂任务，有阶段任务挂各阶段，
 *      任务本体（有阶段时）与块本体都不给入口；
 *   3. 值是六值白名单 —— 非法值拒绝（操作层）/ 丢字段保任务（normalize 与导入）。
 *
 * 跑法：node test/test-slots.js
 */
'use strict';

var h = require('./harness');
var CONFIG = require('../js/config');
var Store = require('../js/store');
var TaskOps = require('../js/task-ops');
var Importer = require('../js/importer');
var Render = require('../js/render');

var t = h.test;
var DATE = '2026-10-01';

/** 一条普通任务，返回 { data, taskId } */
function seed(text) {
  var data = Store.createEmpty();
  var id = TaskOps.addTask(data, DATE, 'I', text || '取快递').task.id;
  return { data: data, taskId: id };
}

/** 一条带两条阶段的任务，返回 { data, taskId, stageIds } */
function seedWithStages() {
  var s = seed('写季度报告');
  var a = TaskOps.addStage(s.data, DATE, 'I', s.taskId, '收集数据').stage.id;
  var b = TaskOps.addStage(s.data, DATE, 'I', s.taskId, '写初稿').stage.id;
  return { data: s.data, taskId: s.taskId, stageIds: [a, b] };
}

// ---------------------------------------------------------------------------
h.group('config：六个时段的定义');

t('六个时段，顺序从早到晚', function () {
  h.assertEqual(CONFIG.SLOTS.join(','), '早上,上午,中午,下午,傍晚,晚上');
});

t('每个时段都有图标（渲染层用，不进数据）', function () {
  for (var i = 0; i < CONFIG.SLOTS.length; i++) {
    h.assertTrue(!!CONFIG.SLOT_ICONS[CONFIG.SLOTS[i]],
      CONFIG.SLOTS[i] + ' 缺图标');
  }
});

// ---------------------------------------------------------------------------
h.group('setSlot：任务级设定、清除、非法值');

t('给任务设定时段', function () {
  var s = seed();
  var result = TaskOps.setSlot(s.data, DATE, 'I', s.taskId, '下午');

  h.assertTrue(result.ok);
  h.assertEqual(TaskOps.locateTask(s.data, DATE, 'I', s.taskId).task.slot, '下午');
});

t('六个值都合法', function () {
  for (var i = 0; i < CONFIG.SLOTS.length; i++) {
    var s = seed();
    var result = TaskOps.setSlot(s.data, DATE, 'I', s.taskId, CONFIG.SLOTS[i]);
    h.assertTrue(result.ok, CONFIG.SLOTS[i] + ' 应该合法');
  }
});

t('清除 = 字段整个删掉', function () {
  var s = seed();
  TaskOps.setSlot(s.data, DATE, 'I', s.taskId, '早上');
  var result = TaskOps.setSlot(s.data, DATE, 'I', s.taskId, null);

  h.assertTrue(result.ok);
  h.assertFalse('slot' in TaskOps.locateTask(s.data, DATE, 'I', s.taskId).task,
    '「未设定」就是没有这个字段，不是空串或 null');
});

t('非法时段 → BAD_SLOT，原值保留', function () {
  var s = seed();
  TaskOps.setSlot(s.data, DATE, 'I', s.taskId, '上午');

  var result = TaskOps.setSlot(s.data, DATE, 'I', s.taskId, '凌晨');

  h.assertFalse(result.ok);
  h.assertEqual(result.error, TaskOps.ERR.BAD_SLOT);
  h.assertEqual(TaskOps.locateTask(s.data, DATE, 'I', s.taskId).task.slot, '上午');
});

t('空串时段也是非法值（清除必须显式传 null）', function () {
  var s = seed();
  h.assertFalse(TaskOps.setSlot(s.data, DATE, 'I', s.taskId, '').ok);
});

t('任务不存在 → NOT_FOUND', function () {
  var s = seed();
  h.assertFalse(TaskOps.setSlot(s.data, DATE, 'I', '没有的', '早上').ok);
});

// ---------------------------------------------------------------------------
h.group('setStageSlot：阶段级设定，互不影响');

t('给阶段设定时段', function () {
  var s = seedWithStages();
  var result = TaskOps.setStageSlot(s.data, DATE, 'I', s.taskId, s.stageIds[0], '早上');

  h.assertTrue(result.ok);
  var task = TaskOps.locateTask(s.data, DATE, 'I', s.taskId).task;
  h.assertEqual(task.stages[0].slot, '早上');
});

t('同一任务的各阶段各设各的，互不影响', function () {
  var s = seedWithStages();
  TaskOps.setStageSlot(s.data, DATE, 'I', s.taskId, s.stageIds[0], '上午');
  TaskOps.setStageSlot(s.data, DATE, 'I', s.taskId, s.stageIds[1], '晚上');

  var task = TaskOps.locateTask(s.data, DATE, 'I', s.taskId).task;
  h.assertEqual(task.stages[0].slot, '上午');
  h.assertEqual(task.stages[1].slot, '晚上');
});

t('阶段清除时段，另一条不动', function () {
  var s = seedWithStages();
  TaskOps.setStageSlot(s.data, DATE, 'I', s.taskId, s.stageIds[0], '上午');
  TaskOps.setStageSlot(s.data, DATE, 'I', s.taskId, s.stageIds[1], '晚上');
  TaskOps.setStageSlot(s.data, DATE, 'I', s.taskId, s.stageIds[0], null);

  var task = TaskOps.locateTask(s.data, DATE, 'I', s.taskId).task;
  h.assertFalse('slot' in task.stages[0]);
  h.assertEqual(task.stages[1].slot, '晚上');
});

t('阶段不存在 / 时段非法 → 失败', function () {
  var s = seedWithStages();
  h.assertFalse(TaskOps.setStageSlot(s.data, DATE, 'I', s.taskId, '没有的', '早上').ok);
  var bad = TaskOps.setStageSlot(s.data, DATE, 'I', s.taskId, s.stageIds[0], '半夜');
  h.assertFalse(bad.ok);
  h.assertEqual(bad.error, TaskOps.ERR.BAD_SLOT);
});

t('数据层不拦「有阶段的任务本体也设时段」——界面上不给入口', function () {
  var s = seedWithStages();
  var result = TaskOps.setSlot(s.data, DATE, 'I', s.taskId, '中午');

  h.assertTrue(result.ok, '数据层只负责写字段，入口限制是渲染层的事');
});

// ---------------------------------------------------------------------------
h.group('时段是纯标记：不动勾选、不动统计');

t('改时段不改完成状态', function () {
  var s = seedWithStages();
  TaskOps.toggleStage(s.data, DATE, 'I', s.taskId, s.stageIds[0], true);
  var before = TaskOps.locateTask(s.data, DATE, 'I', s.taskId).task.completed;

  TaskOps.setStageSlot(s.data, DATE, 'I', s.taskId, s.stageIds[1], '下午');

  h.assertEqual(TaskOps.locateTask(s.data, DATE, 'I', s.taskId).task.completed, before);
  h.assertEqual(TaskOps.locateTask(s.data, DATE, 'I', s.taskId).task.stages[0].completed, true,
    '阶段的勾选也没动');
});

t('改时段前后统计数字一个不变', function () {
  var s = seedWithStages();
  TaskOps.toggleStage(s.data, DATE, 'I', s.taskId, s.stageIds[0], true);
  var before = TaskOps.getStats(s.data, DATE);

  TaskOps.setSlot(s.data, DATE, 'I', s.taskId, '早上');
  TaskOps.setStageSlot(s.data, DATE, 'I', s.taskId, s.stageIds[0], '早上');
  TaskOps.setStageSlot(s.data, DATE, 'I', s.taskId, s.stageIds[1], '晚上');
  var after = TaskOps.getStats(s.data, DATE);

  h.assertEqual(after.total, before.total);
  h.assertEqual(after.done, before.done);
});

t('保存再读出来，时段不丢', function () {
  Store.init({ storage: h.createMemoryStorage() });
  var s = seedWithStages();
  TaskOps.setSlot(s.data, DATE, 'I', s.taskId, '下午');
  TaskOps.setStageSlot(s.data, DATE, 'I', s.taskId, s.stageIds[0], '早上');

  h.assertTrue(Store.save(s.data).ok);
  var loaded = Store.load();

  var task = loaded.data.dates[DATE].I[0];
  h.assertEqual(task.slot, '下午');
  h.assertEqual(task.stages[0].slot, '早上');
});

// ---------------------------------------------------------------------------
h.group('界面：入口只给最细单位');

t('无阶段任务行上有时段下拉', function () {
  var html = Render.buildTaskHtml(
    { id: 't1', text: '取快递', completed: false, createdAt: 1 }, {});

  h.assertTrue(html.indexOf('slot__select') !== -1);
  h.assertTrue(html.indexOf('未设定') !== -1, '第一项是未设定');
});

t('有阶段的任务本体没有时段下拉（阶段行才有）', function () {
  var task = {
    id: 't1', text: '写季度报告', completed: false, createdAt: 1,
    stages: [{ id: 's1', text: '收集数据', completed: false, createdAt: 1 }]
  };
  var html = Render.buildTaskHtml(task, { expanded: { t1: true } });

  // 行上不该有任务的 select；但展开的阶段行有一个。
  // 计数用带 class 属性的完整前缀 —— slot__select--empty 里也含 slot__select
  // 子串，直接数 class 名会把一条下拉数成两条
  var count = html.split('class="slot__select').length - 1;
  h.assertEqual(count, 1, '只有阶段行那一个下拉，任务本体没有');
});

t('阶段行上的下拉带着现值', function () {
  var html = Render.buildStageHtml(
    { id: 's1', text: '收集数据', completed: false, createdAt: 1, slot: '傍晚' }, false);

  h.assertTrue(html.indexOf('slot__select') !== -1);
  h.assertTrue(html.indexOf('value="傍晚" selected') !== -1, '现值要选中');
});

t('未设定的下拉是空态样式', function () {
  var html = Render.buildSlotSelectHtml(null);

  h.assertTrue(html.indexOf('slot__select--empty') !== -1);
  h.assertTrue(html.indexOf('<option value="">未设定</option>') !== -1);
});

t('六个选项全在，图标和文字一起', function () {
  var html = Render.buildSlotSelectHtml(null);

  for (var i = 0; i < CONFIG.SLOTS.length; i++) {
    h.assertTrue(html.indexOf('value="' + CONFIG.SLOTS[i] + '"') !== -1,
      '缺 ' + CONFIG.SLOTS[i]);
    h.assertTrue(html.indexOf(CONFIG.SLOT_ICONS[CONFIG.SLOTS[i]]) !== -1,
      '缺 ' + CONFIG.SLOTS[i] + ' 的图标');
  }
});

t('任务块本体没有时段下拉，块内任务有', function () {
  var block = {
    id: 'b1', type: 'block', text: '晨间例程', completed: false, createdAt: 1,
    tasks: [{ id: 'c1', text: '喝水', completed: false, createdAt: 1 }]
  };
  var html = Render.buildBlockHtml(block, {});

  var count = html.split('class="slot__select').length - 1;
  h.assertEqual(count, 1, '块头没有，块内任务那一个');
});

// ---------------------------------------------------------------------------
h.group('normalize 与导入导出');

t('normalize：任务和阶段的合法 slot 保留', function () {
  var result = Store.parse(JSON.stringify({
    dates: { '2026-10-01': { I: [{
      id: 'a', text: '取快递', completed: false, createdAt: 1, slot: '下午',
      stages: [{ id: 's1', text: '出门', completed: false, createdAt: 1, slot: '中午' }]
    }], II: [], III: [], IV: [] } }
  }));

  var task = result.data.dates['2026-10-01'].I[0];
  h.assertEqual(task.slot, '下午');
  h.assertEqual(task.stages[0].slot, '中午');
});

t('normalize：slot 值不在六个之内 → 丢字段保任务', function () {
  var result = Store.parse(JSON.stringify({
    dates: { '2026-10-01': { I: [{
      id: 'a', text: '取快递', completed: false, createdAt: 1, slot: '凌晨',
      stages: [{ id: 's1', text: '出门', completed: false, createdAt: 1, slot: '半夜' }]
    }], II: [], III: [], IV: [] } }
  }));

  var task = result.data.dates['2026-10-01'].I[0];
  h.assertEqual(result.data.dates['2026-10-01'].I.length, 1, '任务本身留下');
  h.assertFalse('slot' in task, '任务上的非法值被丢');
  h.assertFalse('slot' in task.stages[0], '阶段上的非法值也被丢');
  h.assertEqual(result.dropped, 0, '丢字段不算丢条目');
});

t('导出再导入：任务和阶段的时段跟着文件走', function () {
  var s = seedWithStages();
  TaskOps.setSlot(s.data, DATE, 'I', s.taskId, '上午');
  TaskOps.setStageSlot(s.data, DATE, 'I', s.taskId, s.stageIds[0], '晚上');

  var text = Store.serialize(s.data);
  var other = Store.createEmpty();
  var result = Importer.importText(other, text);

  h.assertTrue(result.ok);
  var task = other.dates[DATE].I[0];
  h.assertEqual(task.slot, '上午');
  h.assertEqual(task.stages[0].slot, '晚上');
});

t('导入的 slot 非法：丢字段，任务照常收', function () {
  var data = Store.createEmpty();
  var result = Importer.importText(data, JSON.stringify({
    dates: { '2026-10-01': { I: [
      { text: '取快递', slot: '凌晨' },
      { text: '写报告', stages: [{ text: '收集', slot: '半夜' }] }
    ], II: [], III: [], IV: [] } }
  }));

  h.assertTrue(result.ok);
  h.assertEqual(result.added, 2);
  var task = data.dates[DATE].I[0];
  h.assertFalse('slot' in task);
  h.assertFalse('slot' in data.dates[DATE].I[1].stages[0]);
});

t('老备份没有 slot 字段照常导入', function () {
  var data = Store.createEmpty();
  var result = Importer.importText(data, JSON.stringify({
    dates: { '2026-10-01': { I: [{ text: '老任务' }], II: [], III: [], IV: [] } }
  }));

  h.assertTrue(result.ok, '加时段之前导出的备份不能废掉');
  h.assertFalse('slot' in data.dates[DATE].I[0]);
});

// ---------------------------------------------------------------------------

h.summary('完成时段（DS 2.12）');
