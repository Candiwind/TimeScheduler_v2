/**
 * test-stages.js
 *
 * 检查「阶段」这套东西的核心规矩（见 DS 2.9）：
 *
 *   1. 阶段只有一层，且**可选** —— 没有阶段的任务它自己就是一个条目
 *   2. **父任务的完成状态只由阶段决定**，父任务不能"自己"完成
 *   3. 统计按「最细的可勾选单位」算：有阶段数阶段，没阶段数任务自己
 *   4. 阶段只能在同一个任务内部换顺序
 *   5. 数据里的 completed 是个派生字段，有阶段时一律以阶段为准
 *
 * 跑法：node test/test-stages.js
 */
'use strict';

var h = require('./harness');
var Store = require('../js/store');
var TaskOps = require('../js/task-ops');

var t = h.test;
var DATE = '2026-10-01';

function fresh() {
  return Store.createEmpty();
}

/** 加一条任务，返回 id */
function add(data, quadrant, text) {
  var r = TaskOps.addTask(data, DATE, quadrant, text);
  if (!r.ok) throw new Error('任务没造出来：' + r.error);
  return r.task.id;
}

/** 给任务加一个阶段，返回阶段 id */
function addStage(data, quadrant, taskId, text) {
  var r = TaskOps.addStage(data, DATE, quadrant, taskId, text);
  if (!r.ok) throw new Error('阶段没造出来：' + r.error);
  return r.stage.id;
}

/** 取任务的阶段文本，拼成 '甲,乙' */
function stageTexts(data, quadrant, taskId) {
  var list = Store.getDayTasks(data, DATE)[quadrant];
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === taskId) {
      return TaskOps.stagesOf(list[i]).map(function (s) { return s.text; }).join(',');
    }
  }
  return '(找不到这条任务)';
}

/** 取任务对象 */
function taskOf(data, quadrant, taskId) {
  var list = Store.getDayTasks(data, DATE)[quadrant];
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === taskId) return list[i];
  }
  return null;
}

// ---------------------------------------------------------------------------
h.group('进度：没阶段的任务，它自己就是一个条目');

t('没阶段、没勾 → 0/1', function () {
  var data = fresh();
  var id = add(data, 'I', '回邮件');
  var p = TaskOps.getProgress(taskOf(data, 'I', id));

  h.assertEqual(p.total, 1);
  h.assertEqual(p.done, 0);
  h.assertEqual(p.hasStages, false);
  h.assertEqual(p.isComplete, false);
});

t('没阶段、勾了 → 1/1', function () {
  var data = fresh();
  var id = add(data, 'I', '回邮件');
  TaskOps.toggleTask(data, DATE, 'I', id, true);

  var p = TaskOps.getProgress(taskOf(data, 'I', id));
  h.assertEqual(p.total, 1);
  h.assertEqual(p.done, 1);
  h.assertEqual(p.hasStages, false);
  h.assertEqual(p.isComplete, true);
});

// ---------------------------------------------------------------------------
h.group('进度：有阶段的任务按阶段算');

t('5 个阶段勾了 3 个 → 3/5', function () {
  var data = fresh();
  var id = add(data, 'I', '写季度报告');
  var texts = ['收集数据', '写初稿', '补充数据', '审阅', '定稿'];
  var stageIds = [];
  for (var i = 0; i < texts.length; i++) stageIds.push(addStage(data, 'I', id, texts[i]));

  TaskOps.toggleStage(data, DATE, 'I', id, stageIds[0], true);
  TaskOps.toggleStage(data, DATE, 'I', id, stageIds[1], true);
  TaskOps.toggleStage(data, DATE, 'I', id, stageIds[2], true);

  var p = TaskOps.getProgress(taskOf(data, 'I', id));
  h.assertEqual(p.total, 5);
  h.assertEqual(p.done, 3);
  h.assertEqual(p.hasStages, true);
  h.assertEqual(p.isComplete, false);
});

t('阶段全勾完 → isComplete', function () {
  var data = fresh();
  var id = add(data, 'I', '任务');
  var s1 = addStage(data, 'I', id, '一');
  var s2 = addStage(data, 'I', id, '二');

  TaskOps.toggleStage(data, DATE, 'I', id, s1, true);
  h.assertEqual(TaskOps.getProgress(taskOf(data, 'I', id)).isComplete, false);

  TaskOps.toggleStage(data, DATE, 'I', id, s2, true);
  h.assertEqual(TaskOps.getProgress(taskOf(data, 'I', id)).isComplete, true);
});

// ---------------------------------------------------------------------------
h.group('父任务的完成状态只由阶段决定');

t('加了一个没勾的阶段，父任务立刻变回未完成', function () {
  // 一条任务原来是「没阶段、已完成」，加了个新阶段之后
  // 应该变成「有阶段、未完成」—— 这才符合直觉
  var data = fresh();
  var id = add(data, 'I', '任务');
  TaskOps.toggleTask(data, DATE, 'I', id, true);
  h.assertEqual(taskOf(data, 'I', id).completed, true);

  addStage(data, 'I', id, '还没做的步骤');
  h.assertEqual(taskOf(data, 'I', id).completed, false);
});

t('阶段全勾上时，父任务的 completed 自动变 true', function () {
  var data = fresh();
  var id = add(data, 'I', '任务');
  var s1 = addStage(data, 'I', id, '一');

  TaskOps.toggleStage(data, DATE, 'I', id, s1, true);
  h.assertEqual(taskOf(data, 'I', id).completed, true);
});

t('取消一个阶段，父任务跟着变回未完成', function () {
  var data = fresh();
  var id = add(data, 'I', '任务');
  var s1 = addStage(data, 'I', id, '一');
  TaskOps.toggleStage(data, DATE, 'I', id, s1, true);
  h.assertEqual(taskOf(data, 'I', id).completed, true);

  TaskOps.toggleStage(data, DATE, 'I', id, s1, false);
  h.assertEqual(taskOf(data, 'I', id).completed, false);
});

t('父任务那个勾选框 = 一键全选', function () {
  var data = fresh();
  var id = add(data, 'I', '任务');
  addStage(data, 'I', id, '一');
  addStage(data, 'I', id, '二');
  addStage(data, 'I', id, '三');

  TaskOps.toggleTask(data, DATE, 'I', id);   // 不传值 = 取反

  var stages = TaskOps.stagesOf(taskOf(data, 'I', id));
  h.assertEqual(stages.length, 3);
  for (var i = 0; i < stages.length; i++) {
    h.assertEqual(stages[i].completed, true, '第 ' + (i + 1) + ' 个阶段应该被一起勾上');
  }
  h.assertEqual(taskOf(data, 'I', id).completed, true);
});

t('再点一下 = 全不选', function () {
  var data = fresh();
  var id = add(data, 'I', '任务');
  addStage(data, 'I', id, '一');
  addStage(data, 'I', id, '二');

  TaskOps.toggleTask(data, DATE, 'I', id, true);
  TaskOps.toggleTask(data, DATE, 'I', id);   // 取反

  var stages = TaskOps.stagesOf(taskOf(data, 'I', id));
  for (var i = 0; i < stages.length; i++) {
    h.assertEqual(stages[i].completed, false);
  }
  h.assertEqual(taskOf(data, 'I', id).completed, false);
});

t('部分完成时，点一下是「全勾上」而不是「全清掉」', function () {
  // 取反看的是「是不是已经全完成了」，不是某一个阶段
  var data = fresh();
  var id = add(data, 'I', '任务');
  var s1 = addStage(data, 'I', id, '一');
  addStage(data, 'I', id, '二');

  TaskOps.toggleStage(data, DATE, 'I', id, s1, true);   // 1/2
  TaskOps.toggleTask(data, DATE, 'I', id);              // 应该变成 2/2

  h.assertEqual(taskOf(data, 'I', id).completed, true);
});

t('把阶段全删光之后，父任务的状态停在最后一次同步的值上', function () {
  // 这是有意为之：用户把它标完成了，删掉步骤不该把它变回未完成。
  // 记录在 DS 2.9 里，免得以后被当成 bug「修」掉
  var data = fresh();
  var id = add(data, 'I', '任务');
  var s1 = addStage(data, 'I', id, '一');
  TaskOps.toggleStage(data, DATE, 'I', id, s1, true);

  TaskOps.removeStage(data, DATE, 'I', id, s1);

  var task = taskOf(data, 'I', id);
  h.assertFalse(Array.isArray(task.stages), '阶段字段该被收掉了');
  h.assertEqual(task.completed, true, '状态留在「已完成」');
});

// ---------------------------------------------------------------------------
h.group('增删改阶段');

t('加阶段：排在末尾，初始未完成', function () {
  var data = fresh();
  var id = add(data, 'I', '任务');
  addStage(data, 'I', id, '第一步');
  addStage(data, 'I', id, '第二步');

  h.assertEqual(stageTexts(data, 'I', id), '第一步,第二步');
  var stages = TaskOps.stagesOf(taskOf(data, 'I', id));
  h.assertEqual(stages[0].completed, false);
  h.assertEqual(stages[1].completed, false);
});

t('加阶段时首尾空白会被去掉', function () {
  var data = fresh();
  var id = add(data, 'I', '任务');
  addStage(data, 'I', id, '  收集数据  ');
  h.assertEqual(stageTexts(data, 'I', id), '收集数据');
});

t('空文本的阶段被拒绝', function () {
  var data = fresh();
  var id = add(data, 'I', '任务');

  var r = TaskOps.addStage(data, DATE, 'I', id, '   ');
  h.assertFalse(r.ok);
  h.assertEqual(r.error, TaskOps.ERR.EMPTY_TEXT);
  h.assertEqual(TaskOps.stagesOf(taskOf(data, 'I', id)).length, 0);
});

t('给不存在的任务加阶段 → 报错', function () {
  var data = fresh();
  var r = TaskOps.addStage(data, DATE, 'I', 'id_不存在', '一');
  h.assertFalse(r.ok);
  h.assertEqual(r.error, TaskOps.ERR.NOT_FOUND);
});

t('改阶段文字', function () {
  var data = fresh();
  var id = add(data, 'I', '任务');
  var s1 = addStage(data, 'I', id, '原来的');

  h.assertTrue(TaskOps.editStage(data, DATE, 'I', id, s1, '改过的').ok);
  h.assertEqual(stageTexts(data, 'I', id), '改过的');
});

t('阶段改成空 —— 拒绝，原文恢复', function () {
  var data = fresh();
  var id = add(data, 'I', '任务');
  var s1 = addStage(data, 'I', id, '原来写的内容');

  var r = TaskOps.editStage(data, DATE, 'I', id, s1, '   ');
  h.assertFalse(r.ok);
  h.assertEqual(r.error, TaskOps.ERR.EMPTY_TEXT);
  h.assertEqual(stageTexts(data, 'I', id), '原来写的内容');
});

t('删阶段：返回里带着被删掉的那条', function () {
  var data = fresh();
  var id = add(data, 'I', '任务');
  var s1 = addStage(data, 'I', id, '要删的');
  addStage(data, 'I', id, '留着的');

  var r = TaskOps.removeStage(data, DATE, 'I', id, s1);
  h.assertTrue(r.ok);
  h.assertEqual(r.stage.text, '要删的');
  h.assertEqual(stageTexts(data, 'I', id), '留着的');
});

t('删不存在的阶段 → 报错', function () {
  var data = fresh();
  var id = add(data, 'I', '任务');
  var r = TaskOps.removeStage(data, DATE, 'I', id, 'id_不存在');
  h.assertFalse(r.ok);
  h.assertEqual(r.error, TaskOps.ERR.NOT_FOUND);
});

t('阶段的操作不会串到别的任务上', function () {
  var data = fresh();
  var a = add(data, 'I', '甲');
  var b = add(data, 'I', '乙');
  addStage(data, 'I', a, '甲的阶段');

  // 拿甲的任务 id 去操作乙那边的阶段 id，应该找不到
  var r = TaskOps.toggleStage(data, DATE, 'I', b, 'id_不存在', true);
  h.assertFalse(r.ok);
  h.assertEqual(stageTexts(data, 'I', a), '甲的阶段');
});

// ---------------------------------------------------------------------------
h.group('阶段排序（只能在同一个任务内部）');

t('往下挪一格', function () {
  var data = fresh();
  var id = add(data, 'I', '任务');
  var s1 = addStage(data, 'I', id, '一');
  addStage(data, 'I', id, '二');
  addStage(data, 'I', id, '三');

  TaskOps.moveStage(data, DATE, 'I', id, s1, 1);
  h.assertEqual(stageTexts(data, 'I', id), '二,一,三');
});

t('往上挪一格', function () {
  var data = fresh();
  var id = add(data, 'I', '任务');
  addStage(data, 'I', id, '一');
  addStage(data, 'I', id, '二');
  var s3 = addStage(data, 'I', id, '三');

  TaskOps.moveStage(data, DATE, 'I', id, s3, 1);
  h.assertEqual(stageTexts(data, 'I', id), '一,三,二');
});

t('挪到最前 / 最后', function () {
  var data = fresh();
  var id = add(data, 'I', '任务');
  var s1 = addStage(data, 'I', id, '一');
  addStage(data, 'I', id, '二');
  addStage(data, 'I', id, '三');

  TaskOps.moveStage(data, DATE, 'I', id, s1, 2);
  h.assertEqual(stageTexts(data, 'I', id), '二,三,一');
});

t('下标越界会被夹到合法范围', function () {
  var data = fresh();
  var id = add(data, 'I', '任务');
  var s1 = addStage(data, 'I', id, '一');
  addStage(data, 'I', id, '二');

  TaskOps.moveStage(data, DATE, 'I', id, s1, 99);
  h.assertEqual(stageTexts(data, 'I', id), '二,一');

  TaskOps.moveStage(data, DATE, 'I', id, s1, -5);
  h.assertEqual(stageTexts(data, 'I', id), '一,二');
});

t('挪来挪去不会弄丢阶段', function () {
  var data = fresh();
  var id = add(data, 'I', '任务');
  var ids = [];
  for (var i = 0; i < 6; i++) ids.push(addStage(data, 'I', id, '第' + i + '步'));

  TaskOps.moveStage(data, DATE, 'I', id, ids[0], 5);
  TaskOps.moveStage(data, DATE, 'I', id, ids[3], 0);
  TaskOps.moveStage(data, DATE, 'I', id, ids[5], 2);

  var stages = TaskOps.stagesOf(taskOf(data, 'I', id));
  h.assertEqual(stages.length, 6, '条数不能变');
  var seen = {};
  for (var k = 0; k < stages.length; k++) {
    h.assertFalse(seen[stages[k].id], '有条阶段重复了');
    seen[stages[k].id] = true;
  }
});

t('排序不影响勾选状态', function () {
  var data = fresh();
  var id = add(data, 'I', '任务');
  var s1 = addStage(data, 'I', id, '一');
  addStage(data, 'I', id, '二');
  TaskOps.toggleStage(data, DATE, 'I', id, s1, true);

  TaskOps.moveStage(data, DATE, 'I', id, s1, 1);

  var stages = TaskOps.stagesOf(taskOf(data, 'I', id));
  h.assertEqual(stages[0].text, '二');
  h.assertEqual(stages[1].text, '一');
  h.assertEqual(stages[1].completed, true, '勾选要跟着阶段一起走');
});

// ---------------------------------------------------------------------------
h.group('统计口径：按最细的可勾选单位算');

t('一条任务都没有 → 全 0，完成率 null', function () {
  var data = fresh();
  var s = TaskOps.getStats(data, DATE);
  h.assertEqual(s.total, 0);
  h.assertEqual(s.rate, null);
});

t('DS 里那个例子：总数 9，已完成 5', function () {
  // 写季度报告（5 个阶段，勾了 3 个）→ 5 条，完成 3
  // 回邮件（没有阶段）             → 1 条，完成 0
  // 准备分享（2 个阶段，都勾了）    → 2 条，完成 2
  // 买咖啡豆（没有阶段，没勾）      → 1 条，完成 0
  var data = fresh();

  var report = add(data, 'I', '写季度报告');
  var reportStages = [];
  for (var i = 0; i < 5; i++) reportStages.push(addStage(data, 'I', report, '步骤' + i));
  TaskOps.toggleStage(data, DATE, 'I', report, reportStages[0], true);
  TaskOps.toggleStage(data, DATE, 'I', report, reportStages[1], true);
  TaskOps.toggleStage(data, DATE, 'I', report, reportStages[2], true);

  add(data, 'I', '回邮件');

  var share = add(data, 'II', '准备分享');
  var s1 = addStage(data, 'II', share, '列大纲');
  var s2 = addStage(data, 'II', share, '写稿');
  TaskOps.toggleStage(data, DATE, 'II', share, s1, true);
  TaskOps.toggleStage(data, DATE, 'II', share, s2, true);

  add(data, 'IV', '买咖啡豆');

  var s = TaskOps.getStats(data, DATE);
  h.assertEqual(s.total, 9);
  h.assertEqual(s.done, 5);
  h.assertEqual(s.remaining, 4);
});

t('没阶段的任务也算 1 条 —— 不然刚装好写下第一条时总数是 0', function () {
  var data = fresh();
  add(data, 'I', '回邮件');

  var s = TaskOps.getStats(data, DATE);
  h.assertEqual(s.total, 1, '一条没阶段的任务就该算 1 条');
  h.assertEqual(s.done, 0);
});

t('全部完成时完成率是 1', function () {
  var data = fresh();
  var a = add(data, 'I', '甲');
  var s1 = addStage(data, 'I', a, '一');
  TaskOps.toggleStage(data, DATE, 'I', a, s1, true);

  var b = add(data, 'II', '乙');
  TaskOps.toggleTask(data, DATE, 'II', b, true);

  h.assertEqual(TaskOps.getStats(data, DATE).rate, 1);
  h.assertEqual(TaskOps.getStats(data, DATE).remaining, 0);
});

// ---------------------------------------------------------------------------
h.group('阶段的操作都要能存下来');

t('加阶段 → 存 → 读回来，阶段还在', function () {
  var storage = h.createMemoryStorage();
  Store.init({ storage: storage, clock: function () { return 1759300000000; } });

  var data = Store.load().data;
  var id = add(data, 'I', '写季度报告');
  var s1 = addStage(data, 'I', id, '收集数据');
  TaskOps.toggleStage(data, DATE, 'I', id, s1, true);
  h.assertTrue(Store.save(data).ok);

  var back = Store.load().data;
  var task = back.dates[DATE].I[0];
  h.assertEqual(task.stages.length, 1);
  h.assertEqual(task.stages[0].text, '收集数据');
  h.assertEqual(task.stages[0].completed, true);
});

t('排序之后存下来，顺序还在', function () {
  var storage = h.createMemoryStorage();
  Store.init({ storage: storage, clock: function () { return 1759300000000; } });

  var data = Store.load().data;
  var id = add(data, 'I', '任务');
  addStage(data, 'I', id, '一');
  var s2 = addStage(data, 'I', id, '二');
  addStage(data, 'I', id, '三');

  TaskOps.moveStage(data, DATE, 'I', id, s2, 0);
  Store.save(data);

  var back = Store.load().data;
  h.assertEqual(back.dates[DATE].I[0].stages.map(function (s) { return s.text; }).join(','), '二,一,三');
});

// ---------------------------------------------------------------------------

h.summary('阶段（task-ops）');
