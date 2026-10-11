/**
 * test-auto-slot.js
 *
 * v2.12 需求 8 / 需求 9（见 DS 2.48 / D-78）：
 *
 *   需求 8：新添加的**任务或阶段**自动分配完成时段 —— 第一、三象限按添加那一刻
 *           的钟点（8:00 前早上、8:00~12:00 上午、12:00~14:00 中午、
 *           14:00~17:00 下午、17:00~19:00 傍晚、19:00 之后晚上），
 *           第二、四象限一律晚上。
 *   需求 9：每次加完任务或阶段，把这个象限的**任务**按完成时间（= 六值时段）
 *           重排一遍；带多个阶段的任务取其中**最晚**的阶段；**任务块不参与**；
 *           排序不能推翻「未完成在前、已完成在后」（需求 6 的沉底口径）。
 *
 * 这一条全靠「把此刻钉死」才好测：`addTask` / `addStage` 的最后一个参数就是
 * 「此刻」，不传才是 new Date()。所有用例都传固定钟点，否则跑测试的机器
 * 几点跑就出什么结果。
 *
 * 跑法：node test/test-auto-slot.js
 */
'use strict';

var h = require('./harness');
var CONFIG = require('../js/config');
var Util = require('../js/util');
var Store = require('../js/store');
var TaskOps = require('../js/task-ops');

var t = h.test;
var DATE = '2026-10-01';

/** 2026-10-01 的某个钟点（本地时区，和 Util.slotIndexByClock 用的是同一套读取） */
function at(hour, minute) {
  return new Date(2026, 9, 1, hour, minute || 0, 0, 0);
}

/** 数据里某象限从前往后的文本顺序 */
function textsIn(data, quadrant) {
  var list = data.dates[DATE][quadrant];
  return list.map(function (item) { return item.text; }).join(',');
}

/** 加一条任务并返回 { id, task }；now 固定，免得结果跟着跑测试的时间变 */
function add(data, quadrant, text, hour) {
  var r = TaskOps.addTask(data, DATE, quadrant, text, at(hour === undefined ? 20 : hour));
  return r.task;
}

// ---------------------------------------------------------------------------
h.group('需求 8：钟点 → 时段（Util.slotIndexByClock 六段边界）');

t('7:59 还是早上，8:00 起是上午（左端点归后一段）', function () {
  h.assertEqual(Util.slotIndexByClock(at(7, 59)), 0);
  h.assertEqual(Util.slotIndexByClock(at(8, 0)), 1);
});

t('11:59 上午，12:00 中午', function () {
  h.assertEqual(Util.slotIndexByClock(at(11, 59)), 1);
  h.assertEqual(Util.slotIndexByClock(at(12, 0)), 2);
});

t('13:59 中午，14:00 下午', function () {
  h.assertEqual(Util.slotIndexByClock(at(13, 59)), 2);
  h.assertEqual(Util.slotIndexByClock(at(14, 0)), 3);
});

t('16:59 下午，17:00 傍晚', function () {
  h.assertEqual(Util.slotIndexByClock(at(16, 59)), 3);
  h.assertEqual(Util.slotIndexByClock(at(17, 0)), 4);
});

t('18:59 傍晚，19:00 起是晚上', function () {
  h.assertEqual(Util.slotIndexByClock(at(18, 59)), 4);
  h.assertEqual(Util.slotIndexByClock(at(19, 0)), 5);
});

t('0:00 与 23:59 都在两端（早上 / 晚上）', function () {
  h.assertEqual(Util.slotIndexByClock(at(0, 0)), 0);
  h.assertEqual(Util.slotIndexByClock(at(23, 59)), 5);
});

t('不传 / 传坏值时退回「此刻」，不抛错', function () {
  var idx = Util.slotIndexByClock(undefined);
  h.assertTrue(idx >= 0 && idx <= 5, '总得落在六个时段里，实际 ' + idx);
  h.assertTrue(Util.slotIndexByClock(new Date('不是日期')) >= 0);
});

// ---------------------------------------------------------------------------
h.group('需求 8：defaultSlotFor（象限决定用钟点还是晚上）');

t('第一、三象限按钟点', function () {
  h.assertEqual(TaskOps.defaultSlotFor('I', at(7, 0)), '早上');
  h.assertEqual(TaskOps.defaultSlotFor('I', at(9, 30)), '上午');
  h.assertEqual(TaskOps.defaultSlotFor('III', at(12, 30)), '中午');
  h.assertEqual(TaskOps.defaultSlotFor('III', at(15, 0)), '下午');
  h.assertEqual(TaskOps.defaultSlotFor('I', at(18, 0)), '傍晚');
  h.assertEqual(TaskOps.defaultSlotFor('III', at(22, 0)), '晚上');
});

t('第二、四象限一律晚上（不管几点）', function () {
  [at(7, 0), at(10, 0), at(15, 0), at(20, 0)].forEach(function (when) {
    h.assertEqual(TaskOps.defaultSlotFor('II', when), '晚上');
    h.assertEqual(TaskOps.defaultSlotFor('IV', when), '晚上');
  });
});

t('认不出的象限兜底晚上（宁可保守，也别让新条目没有时段）', function () {
  h.assertEqual(TaskOps.defaultSlotFor('V', at(9, 0)), '晚上');
  h.assertEqual(TaskOps.defaultSlotFor(null, at(9, 0)), '晚上');
});

// ---------------------------------------------------------------------------
h.group('需求 8：新任务 / 新阶段都带上时段');

t('addTask 给新任务带上时段（I 象限跟钟点）', function () {
  var data = Store.createEmpty();
  var task = add(data, 'I', '写日报', 9);
  h.assertEqual(task.slot, '上午', '新任务必须有时段，不能再出现「无时段」');
  h.assertEqual(data.dates[DATE].I[0].slot, '上午');
});

t('addTask 在 II / IV 象限一律晚上', function () {
  var data = Store.createEmpty();
  h.assertEqual(add(data, 'II', '读书', 9).slot, '晚上');
  h.assertEqual(add(data, 'IV', '看剧', 9).slot, '晚上');
});

t('addStage 按**所在象限**算时段（同一条任务在不同象限结果不同）', function () {
  var data = Store.createEmpty();
  var inI = add(data, 'I', '任务一', 9).id;
  var inII = add(data, 'II', '任务二', 9).id;

  var s1 = TaskOps.addStage(data, DATE, 'I', inI, '第一步', at(9)).stage;
  var s2 = TaskOps.addStage(data, DATE, 'II', inII, '第一步', at(9)).stage;

  h.assertEqual(s1.slot, '上午', 'I 象限的阶段跟钟点');
  h.assertEqual(s2.slot, '晚上', 'II 象限的阶段永远是晚上');
});

t('时段仍然可以自己改（自动分配只是默认值）', function () {
  var data = Store.createEmpty();
  var task = add(data, 'I', '写日报', 9);
  TaskOps.setSlot(data, DATE, 'I', task.id, '晚上');
  h.assertEqual(data.dates[DATE].I[0].slot, '晚上');
});

// ---------------------------------------------------------------------------
h.group('需求 9：加完之后按完成时间排（未完成在前、同组按时段）');

t('同象限里，早时段的排在晚时段前面', function () {
  var data = Store.createEmpty();
  add(data, 'I', '晚上做的', 20);   // 晚上
  add(data, 'I', '早上做的', 7);    // 早上

  h.assertEqual(textsIn(data, 'I'), '早上做的,晚上做的');
});

t('同一时段里，刚加的那条仍在最前（「新增加在开头」不变）', function () {
  var data = Store.createEmpty();
  add(data, 'I', '先加的', 20);
  add(data, 'I', '后加的', 20);

  h.assertEqual(textsIn(data, 'I'), '后加的,先加的');
});

t('未完成在前、已完成在后 —— 排序不推翻完成沉底（R-49）', function () {
  var data = Store.createEmpty();
  var early = add(data, 'I', '早上做完的', 7);
  add(data, 'I', '晚上没做的', 20);

  TaskOps.toggleTask(data, DATE, 'I', early.id, true);

  h.assertEqual(textsIn(data, 'I'), '晚上没做的,早上做完的',
    '做完的不该因为时段早又跑回前面');
});

t('带多个阶段的任务：按**最晚**那个阶段定位（需求原话）', function () {
  var data = Store.createEmpty();
  var multi = add(data, 'I', '多阶段任务', 7);
  var single = add(data, 'I', '一段任务', 12);
  TaskOps.setSlot(data, DATE, 'I', multi.id, '早上');

  // 先给「多阶段任务」一个早阶段，它该排在 中午 的前面
  TaskOps.addStage(data, DATE, 'I', multi.id, '早上那步', at(7));
  h.assertEqual(textsIn(data, 'I'), '多阶段任务,一段任务');

  // 再加一个晚上的阶段 → 这条的整体完成时间变成晚上 → 该排到后面去
  TaskOps.addStage(data, DATE, 'I', multi.id, '晚上那步', at(20));
  h.assertEqual(textsIn(data, 'I'), '一段任务,多阶段任务',
    '父任务的整体完成时间 = 最晚的那个阶段');
});

t('没设时段的老任务排在同组最后（它们没有时间信息）', function () {
  var data = Store.createEmpty();
  var old = add(data, 'I', '没时段的老任务', 20);
  TaskOps.setSlot(data, DATE, 'I', old.id, null);   // 老数据 / 手动清过
  add(data, 'I', '晚上新任务', 20);

  h.assertEqual(textsIn(data, 'I'), '晚上新任务,没时段的老任务');
});

t('任务块不参与排序：块留在**原来的下标**上（留洞，不是抽出来再塞回去）', function () {
  // 直接摆一个「块 / 任务 / 块 / 任务」的列表来排，不看 addTask 的 unshift ——
  // 这条要验的就是「排序只在任务占的那几个下标之间换位」
  var data = Store.createEmpty();
  var day = Store.ensureDay(data, DATE);
  day.I = [
    { id: 'b1', type: 'block', text: '块一', completed: false, createdAt: 1, tasks: [] },
    { id: 't1', text: '晚上任务', completed: false, createdAt: 1, slot: '晚上' },
    { id: 'b2', type: 'block', text: '块二', completed: false, createdAt: 1, tasks: [] },
    { id: 't2', text: '早上任务', completed: false, createdAt: 1, slot: '早上' }
  ];

  h.assertTrue(TaskOps.sortTasksByTime(day.I), '有两条任务 → 真排了一次');

  h.assertEqual(day.I[0].id, 'b1', '块一还在下标 0');
  h.assertEqual(day.I[2].id, 'b2', '块二还在下标 2');
  h.assertEqual(day.I[1].text, '早上任务', '早上那条换到了下标 1');
  h.assertEqual(day.I[3].text, '晚上任务');
});

t('新加的任务照旧落在开头（需求 3 不变），块跟着让位', function () {
  var data = Store.createEmpty();
  TaskOps.addBlock(data, DATE, 'I', '块一');
  var task = add(data, 'I', '新任务', 20);

  var list = data.dates[DATE].I;
  h.assertEqual(list[0].id, task.id, '新任务加在开头');
  h.assertEqual(list[1].text, '块一', '块被让到后面一位（新增排最前这条本来如此）');
});

t('列表里只有块 / 只有一条任务时，排序是空操作', function () {
  var data = Store.createEmpty();
  var only = add(data, 'I', '唯一一条', 20);
  h.assertFalse(TaskOps.sortTasksByTime(data.dates[DATE].I), '只有一条 → 不动');

  var data2 = Store.createEmpty();
  TaskOps.addBlock(data2, DATE, 'I', '块一');
  TaskOps.addBlock(data2, DATE, 'I', '块二');
  h.assertFalse(TaskOps.sortTasksByTime(data2.dates[DATE].I), '只有块 → 不动');
  h.assertEqual(data2.dates[DATE].I[0].text, '块二', '块保持加入顺序');
  h.assertEqual(data2.dates[DATE].I[1].text, '块一');
});

t('排序只作用在刚加的那条所在的象限，别的象限不动', function () {
  var data = Store.createEmpty();
  add(data, 'II', '二象限先加', 20);
  add(data, 'II', '二象限后加', 20);
  h.assertEqual(textsIn(data, 'II'), '二象限后加,二象限先加', '同时段里新的在最前');

  add(data, 'I', '一象限的新任务', 7);
  h.assertEqual(textsIn(data, 'II'), '二象限后加,二象限先加', 'II 象限不受影响');
});

t('sortTasksByTime 对空列表 / 非数组不炸', function () {
  h.assertFalse(TaskOps.sortTasksByTime([]));
  h.assertFalse(TaskOps.sortTasksByTime(null));
});

// ---------------------------------------------------------------------------
h.group('和既有统计 / 时间视图的联动');

t('新任务自动带上时段 → 时间视图里立刻可见（以前「没设时段」不进）', function () {
  var data = Store.createEmpty();
  add(data, 'I', '早上写的', 7);
  var groups = TaskOps.getTimeView(data, DATE);
  h.assertEqual(groups.length, 1);
  h.assertEqual(groups[0].slot, '早上');
  h.assertEqual(groups[0].items[0].text, '早上写的');
});

t('排序不影响统计口径（加完前后数字一致）', function () {
  var data = Store.createEmpty();
  add(data, 'I', '甲', 20);
  add(data, 'I', '乙', 7);
  var before = TaskOps.getStats(data, DATE);
  TaskOps.sortTasksByTime(data.dates[DATE].I);
  var after = TaskOps.getStats(data, DATE);
  h.assertEqual(after.total, before.total);
  h.assertEqual(after.done, before.done);
});

t('六个时段的名字都来自 CONFIG.SLOTS（没有多造一个中文串）', function () {
  var data = Store.createEmpty();
  for (var q = 0; q < CONFIG.QUADRANT_IDS.length; q++) {
    var task = add(data, CONFIG.QUADRANT_IDS[q], '任务' + q, 9);
    h.assertTrue(CONFIG.SLOTS.indexOf(task.slot) !== -1, '时段必须是六个之一');
  }
});

// ---------------------------------------------------------------------------

h.summary('新条目的默认时段与按完成时间排序（v2.12 需求 8 / 需求 9）');
