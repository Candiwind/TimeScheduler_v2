/**
 * test-timeview-order.js
 *
 * 时间视图的拖拽顺序记忆（需求 3，见 DS 2.17）+ 完成沉底（需求 6，见 DS 2.18）。
 *
 * 覆盖（见 DS 三、测试策略）：
 *   moveTimeViewItem 同时段重排 / 跨时段（slot 改掉 + 顺序记住）；
 *   新增任务同段排最前（v2.5）；
 *   normalize 保 tv / 丢非法 tv；
 *   导入忽略 tv；
 *   完成沉底：toggleTask → 列表末尾 + 时间视图键沉底；阶段不沉底；
 *   块内子任务在 tasks 内沉底；toggleBlock 多子稳定沉底；取消勾选不移回；
 *   序列化往返保 tv。
 *
 * 跑法：node test/test-timeview-order.js
 */
'use strict';

var h = require('./harness');
var CONFIG = require('../js/config');
var Store = require('../js/store');
var TaskOps = require('../js/task-ops');
var Importer = require('../js/importer');

var t = h.test;
var DATE = '2026-10-01';

function textsOf(group) {
  var out = [];
  for (var i = 0; i < group.items.length; i++) out.push(group.items[i].text);
  return out.join(',');
}

function slotsOf(groups) {
  var out = [];
  for (var i = 0; i < groups.length; i++) out.push(groups[i].slot);
  return out.join(',');
}

/** 加一条无阶段任务并设时段，返回它的 id */
function addSlotted(data, text, slot, quadrant) {
  var id = TaskOps.addTask(data, DATE, quadrant || 'I', text).task.id;
  TaskOps.setSlot(data, DATE, quadrant || 'I', id, slot);
  return id;
}

// ---------------------------------------------------------------------------
h.group('moveTimeViewItem：同时段重排');

t('同时段内把第一条拖到末尾，顺序记住', function () {
  var data = Store.createEmpty();
  var a = addSlotted(data, '甲', '早上');
  var b = addSlotted(data, '乙', '早上');
  var c = addSlotted(data, '丙', '早上');
  // 新任务默认加在开头（需求 3）：展示顺序是 丙,乙,甲，最前的是「丙」

  TaskOps.moveTimeViewItem(data, DATE,
    { dataKind: 'task', taskId: c, stageId: null, quadrantId: 'I', toSlot: '早上', index: 2 });

  var group = TaskOps.getTimeView(data, DATE)[0];
  h.assertEqual(textsOf(group), '乙,甲,丙');
  h.assertEqual(data.dates[DATE].tv['早上'].join(','),
    't:' + b + ',t:' + a + ',t:' + c, '键列表写进 tv');
});

t('拖到最前', function () {
  var data = Store.createEmpty();
  var a = addSlotted(data, '甲', '早上');
  var b = addSlotted(data, '乙', '早上');

  TaskOps.moveTimeViewItem(data, DATE,
    { dataKind: 'task', taskId: b, stageId: null, quadrantId: 'I', toSlot: '早上', index: 0 });

  h.assertEqual(textsOf(TaskOps.getTimeView(data, DATE)[0]), '乙,甲');
});

t('阶段条目也能重排（键 = s:任务:阶段）', function () {
  var data = Store.createEmpty();
  var taskId = TaskOps.addTask(data, DATE, 'I', '写报告').task.id;
  var s1 = TaskOps.addStage(data, DATE, 'I', taskId, '收集数据').stage.id;
  var s2 = TaskOps.addStage(data, DATE, 'I', taskId, '写初稿').stage.id;
  TaskOps.setStageSlot(data, DATE, 'I', taskId, s1, '上午');
  TaskOps.setStageSlot(data, DATE, 'I', taskId, s2, '上午');

  TaskOps.moveTimeViewItem(data, DATE,
    { dataKind: 'stage', taskId: taskId, stageId: s1, quadrantId: 'I', toSlot: '上午', index: 1 });

  h.assertEqual(textsOf(TaskOps.getTimeView(data, DATE)[0]), '写初稿,收集数据');
});

// ---------------------------------------------------------------------------
h.group('moveTimeViewItem：跨时段');

t('跨时段拖拽 = 改 slot + 记住顺序，旧时段清空', function () {
  var data = Store.createEmpty();
  var a = addSlotted(data, '甲', '早上');
  var b = addSlotted(data, '乙', '上午');

  TaskOps.moveTimeViewItem(data, DATE,
    { dataKind: 'task', taskId: b, stageId: null, quadrantId: 'I', toSlot: '早上', index: 0 });

  // slot 字段被改掉
  h.assertEqual(TaskOps.findTask(data, DATE, 'I', b).task.slot, '早上', 'slot 改到目标时段');

  var groups = TaskOps.getTimeView(data, DATE);
  h.assertEqual(slotsOf(groups), '早上', '上午已经没有任务，不再出现');
  h.assertEqual(textsOf(groups[0]), '乙,甲');
});

// ---------------------------------------------------------------------------
h.group('新增任务排在该时段最前（需求 3，v2.5 与象限视图统一）');

t('有记忆后，同时段新增的任务不在记忆里 → 排最前，记忆里的相对顺序不动', function () {
  var data = Store.createEmpty();
  var a = addSlotted(data, '甲', '早上');
  var b = addSlotted(data, '乙', '早上');

  // 建立记忆：乙拖到甲前面
  TaskOps.moveTimeViewItem(data, DATE,
    { dataKind: 'task', taskId: b, stageId: null, quadrantId: 'I', toSlot: '早上', index: 0 });
  h.assertEqual(textsOf(TaskOps.getTimeView(data, DATE)[0]), '乙,甲', '记忆先生效');

  addSlotted(data, '丙', '早上'); // 象限视图新增
  h.assertEqual(textsOf(TaskOps.getTimeView(data, DATE)[0]), '丙,乙,甲');

  addSlotted(data, '丁', '早上'); // 再新增一条，仍然排最前
  h.assertEqual(textsOf(TaskOps.getTimeView(data, DATE)[0]), '丁,丙,乙,甲');
});

t('任务刚设上时段（原来没时段）也排最前', function () {
  var data = Store.createEmpty();
  var a = addSlotted(data, '甲', '早上');
  var b = addSlotted(data, '乙', '早上');
  TaskOps.moveTimeViewItem(data, DATE,
    { dataKind: 'task', taskId: b, stageId: null, quadrantId: 'I', toSlot: '早上', index: 0 });

  var c = TaskOps.addTask(data, DATE, 'I', '丙').task.id;   // 先建出来
  TaskOps.setSlot(data, DATE, 'I', c, '早上');              // 后设时段

  h.assertEqual(textsOf(TaskOps.getTimeView(data, DATE)[0]), '丙,乙,甲');
});

// ---------------------------------------------------------------------------
h.group('normalize 与序列化：tv 跟着走');

t('序列化 → normalize 往返保 tv', function () {
  var data = Store.createEmpty();
  var a = addSlotted(data, '甲', '早上');
  var b = addSlotted(data, '乙', '早上');
  TaskOps.moveTimeViewItem(data, DATE,
    { dataKind: 'task', taskId: b, stageId: null, quadrantId: 'I', toSlot: '早上', index: 0 });

  var round = Store.normalize(JSON.parse(Store.serialize(data)));
  h.assertEqual(round.data.dates[DATE].tv['早上'].join(','),
    't:' + b + ',t:' + a);
});

t('normalize 保合法 tv、丢非法 tv', function () {
  var good = Store.normalize({
    dates: { '2026-10-01': {
      I: [{ text: 'a' }], II: [], III: [], IV: [],
      tv: { '早上': ['t:x', 't:y'] }
    } }
  });
  h.assertEqual(good.data.dates['2026-10-01'].tv['早上'].join(','), 't:x,t:y');

  // 值不是数组 / 空数组 → 丢掉，不挂 tv
  var bad = Store.normalize({
    dates: { '2026-10-01': {
      I: [{ text: 'a' }], II: [], III: [], IV: [],
      tv: { '早上': 'not-array', '下午': [] }
    } }
  });
  h.assertEqual(bad.data.dates['2026-10-01'].tv, undefined);

  // 时段键不在六值之内 → 丢掉
  var badSlot = Store.normalize({
    dates: { '2026-10-01': {
      I: [{ text: 'a' }], II: [], III: [], IV: [],
      tv: { '午夜': ['t:x'] }
    } }
  });
  h.assertEqual(badSlot.data.dates['2026-10-01'].tv, undefined);
});

t('导入忽略 tv（id 全重生成，旧键对不上）', function () {
  var data = Store.createEmpty();
  var a = addSlotted(data, '甲', '早上');
  var b = addSlotted(data, '乙', '早上');
  TaskOps.moveTimeViewItem(data, DATE,
    { dataKind: 'task', taskId: b, stageId: null, quadrantId: 'I', toSlot: '早上', index: 0 });
  h.assertTrue(data.dates[DATE].tv, '导出前确实有 tv');

  var fresh = Store.createEmpty();
  var r = Importer.importText(fresh, Store.serialize(data));

  h.assertTrue(r.ok);
  h.assertEqual(r.data.dates[DATE].tv, undefined, '导入不认 tv，忽略');
  h.assertEqual(r.data.dates[DATE].I.length, 2, '任务本身照常导入');
});

// ---------------------------------------------------------------------------
h.group('完成沉底（需求 6）：任务、块内任务、阶段、时间视图键');

t('勾选完成 → 象限列表末尾 + 时间视图键沉底', function () {
  var data = Store.createEmpty();
  // 先加乙再加甲，让「甲」排在前面（新任务默认加在开头，需求 3）
  var b = addSlotted(data, '乙', '早上');
  var a = addSlotted(data, '甲', '早上');

  TaskOps.toggleTask(data, DATE, 'I', a, true);

  // 象限顺序：甲沉到末尾
  h.assertEqual(data.dates[DATE].I[0].text, '乙');
  h.assertEqual(data.dates[DATE].I[1].text, '甲');
  // 时间视图键也沉底
  h.assertEqual(data.dates[DATE].tv['早上'].join(','),
    't:' + b + ',t:' + a);
});

t('阶段不沉底：阶段顺序永远不动，父任务完成时整体沉底', function () {
  var data = Store.createEmpty();
  var taskId = TaskOps.addTask(data, DATE, 'I', '有阶段任务').task.id;
  var s1 = TaskOps.addStage(data, DATE, 'I', taskId, '收集数据').stage.id;
  var s2 = TaskOps.addStage(data, DATE, 'I', taskId, '写初稿').stage.id;
  var s3 = TaskOps.addStage(data, DATE, 'I', taskId, '定稿').stage.id;
  var other = TaskOps.addTask(data, DATE, 'I', '另一条').task.id;

  // 乱序勾阶段，阶段内部顺序不变
  TaskOps.toggleStage(data, DATE, 'I', taskId, s3, true);
  TaskOps.toggleStage(data, DATE, 'I', taskId, s1, true);

  var task = TaskOps.findTask(data, DATE, 'I', taskId).task;
  h.assertEqual(task.stages.map(function (s) { return s.text; }).join(','),
    '收集数据,写初稿,定稿', '阶段顺序不动');

  // 勾完最后一个阶段 → 父任务整体沉底
  TaskOps.toggleStage(data, DATE, 'I', taskId, s2, true);
  h.assertEqual(data.dates[DATE].I[0].text, '另一条', '父任务沉到末尾');
  h.assertEqual(data.dates[DATE].I[1].text, '有阶段任务');
  h.assertEqual(data.dates[DATE].I[1].stages.map(function (s) { return s.text; }).join(','),
    '收集数据,写初稿,定稿', '沉底后阶段顺序仍不动');
});

t('块内子任务在块内沉底，块本体不沉底', function () {
  var data = Store.createEmpty();
  var block = TaskOps.addBlock(data, DATE, 'I', '块').block;
  block.tasks.push({ id: 'c1', text: '子1', completed: false, createdAt: 1 });
  block.tasks.push({ id: 'c2', text: '子2', completed: false, createdAt: 1 });
  block.tasks.push({ id: 'c3', text: '子3', completed: false, createdAt: 1 });

  TaskOps.toggleTask(data, DATE, 'I', 'c1', true);

  h.assertEqual(block.tasks.map(function (x) { return x.text; }).join(','),
    '子2,子3,子1', '块内子任务沉到块内末尾');
  h.assertEqual(data.dates[DATE].I.length, 1, '块本体还在原位，没有被当成任务沉底');
  h.assertEqual(data.dates[DATE].I[0].id, block.id);
});

t('toggleBlock 一次勾完多条子任务：稳定沉底（已完成的留前、新完成的按原顺序沉后）', function () {
  var data = Store.createEmpty();
  var block = TaskOps.addBlock(data, DATE, 'I', '块').block;
  block.tasks.push({ id: 'c1', text: '子1', completed: false, createdAt: 1 });
  block.tasks.push({ id: 'c2', text: '子2', completed: true, createdAt: 1 });
  block.tasks.push({ id: 'c3', text: '子3', completed: false, createdAt: 1 });
  block.tasks.push({ id: 'c4', text: '子4', completed: true, createdAt: 1 });

  TaskOps.toggleBlock(data, DATE, 'I', block.id, true);

  // 已经完成的 c2/c4 保持在前（相对顺序），新勾的 c1/c3 按原顺序沉到末尾
  h.assertEqual(block.tasks.map(function (x) { return x.text; }).join(','),
    '子2,子4,子1,子3');
  h.assertTrue(block.completed, '块随之完成');
});

t('取消勾选不自动移回原位', function () {
  var data = Store.createEmpty();
  var a = addSlotted(data, '甲', '早上');
  var b = addSlotted(data, '乙', '早上');

  TaskOps.toggleTask(data, DATE, 'I', a, true);
  h.assertEqual(data.dates[DATE].I[0].text, '乙', '先沉底');

  TaskOps.toggleTask(data, DATE, 'I', a, false);
  h.assertEqual(data.dates[DATE].I[0].text, '乙', '取消勾选不移回');
  h.assertEqual(data.dates[DATE].I[1].text, '甲');
});

// ---------------------------------------------------------------------------

h.summary('时间视图顺序记忆（需求 3）+ 完成沉底（需求 6）');
