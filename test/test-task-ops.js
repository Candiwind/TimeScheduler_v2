/**
 * test-task-ops.js
 *
 * 检查 task-ops.js 的增删改、勾选和统计（见 DS 3.2）。
 * 重点：一条任务都没有时，完成率**不能除以零**。
 *
 * 跑法：node test/test-task-ops.js
 */
'use strict';

var h = require('./harness');
var Store = require('../js/store');
var TaskOps = require('../js/task-ops');
var CONFIG = require('../js/config');

var t = h.test;

var DATE = '2026-10-01';

/** 每个用例一份干净的空数据 */
function fresh() {
  return Store.createEmpty();
}

/** 加一条任务，返回它的 id；失败就直接让测试挂掉 */
function add(data, quadrant, text) {
  var r = TaskOps.addTask(data, DATE, quadrant, text);
  h.assertTrue(r.ok, '加任务失败了：' + r.error + '（文本：' + text + '）');
  return r.task.id;
}

// ---------------------------------------------------------------------------
h.group('新增任务');

t('加一条任务，出现在对应的象限里', function () {
  var data = fresh();
  var r = TaskOps.addTask(data, DATE, 'I', '写季度报告');

  h.assertTrue(r.ok);
  h.assertEqual(data.dates[DATE].I.length, 1);
  h.assertEqual(data.dates[DATE].I[0].text, '写季度报告');
});

t('新任务的初始状态：没勾选、有编号、有时间', function () {
  var data = fresh();
  var id = add(data, 'I', '写报告');
  var task = data.dates[DATE].I[0];

  h.assertEqual(task.completed, false);
  h.assertEqual(task.id, id);
  h.assertEqual(typeof task.createdAt, 'number');
  h.assertTrue(task.createdAt > 0);
});

t('连续加的任务编号不重复', function () {
  var data = fresh();
  var seen = {};
  for (var i = 0; i < 200; i++) {
    var id = add(data, 'I', '任务 ' + i);
    h.assertFalse(seen[id], '编号撞了：' + id);
    seen[id] = true;
  }
});

t('新任务默认加在开头（需求 3）', function () {
  // 需求（重命名后 3）：新加的东西排最前，用户刚敲进去的任务一眼就能看到
  var data = fresh();
  add(data, 'I', '第一');
  add(data, 'I', '第二');
  add(data, 'I', '第三');

  var texts = data.dates[DATE].I.map(function (x) { return x.text; });
  h.assertEqual(texts.join(','), '第三,第二,第一');
});

t('首尾空白会被去掉', function () {
  var data = fresh();
  add(data, 'II', '  写报告  ');
  h.assertEqual(data.dates[DATE].II[0].text, '写报告');
});

t('中间的空格保留', function () {
  var data = fresh();
  add(data, 'II', '写 季度 报告');
  h.assertEqual(data.dates[DATE].II[0].text, '写 季度 报告');
});

t('新任务加到别的日期，互不影响', function () {
  var data = fresh();
  add(data, 'I', '十月一');
  TaskOps.addTask(data, '2026-10-02', 'I', '十月二');

  h.assertEqual(data.dates['2026-10-01'].I.length, 1);
  h.assertEqual(data.dates['2026-10-02'].I.length, 1);
  h.assertEqual(data.dates['2026-10-01'].I[0].text, '十月一');
});

// ---------------------------------------------------------------------------
h.group('新增任务：非法输入');

t('空文本被拒绝', function () {
  var data = fresh();
  var r = TaskOps.addTask(data, DATE, 'I', '');
  h.assertFalse(r.ok);
  h.assertEqual(r.error, TaskOps.ERR.EMPTY_TEXT);
});

t('只有空格被拒绝', function () {
  var data = fresh();
  var r = TaskOps.addTask(data, DATE, 'I', '    ');
  h.assertFalse(r.ok);
  h.assertEqual(r.error, TaskOps.ERR.EMPTY_TEXT);
});

t('只有全角空格也被拒绝（中文输入法下很常见）', function () {
  var data = fresh();
  var r = TaskOps.addTask(data, DATE, 'I', '　　');
  h.assertFalse(r.ok);
  h.assertEqual(r.error, TaskOps.ERR.EMPTY_TEXT);
});

t('null / undefined 被拒绝', function () {
  var data = fresh();
  h.assertFalse(TaskOps.addTask(data, DATE, 'I', null).ok);
  h.assertFalse(TaskOps.addTask(data, DATE, 'I', undefined).ok);
});

t('被拒绝时不能留下任何痕迹', function () {
  var data = fresh();
  TaskOps.addTask(data, DATE, 'I', '   ');
  h.assertEqual(Object.keys(data.dates).length, 0, '不该凭空建出这个日期');
});

t('非法日期被拒绝', function () {
  var data = fresh();
  var r = TaskOps.addTask(data, '2026-13-01', 'I', '写报告');
  h.assertFalse(r.ok);
  h.assertEqual(r.error, TaskOps.ERR.BAD_DATE);
});

t('不认识的象限被拒绝', function () {
  var data = fresh();
  var r = TaskOps.addTask(data, DATE, 'V', '写报告');
  h.assertFalse(r.ok);
  h.assertEqual(r.error, TaskOps.ERR.BAD_QUADRANT);
  h.assertEqual(TaskOps.addTask(data, DATE, 'i', '写报告').error, TaskOps.ERR.BAD_QUADRANT,
    '象限 id 是大小写敏感的，小写 i 不算');
});

// ---------------------------------------------------------------------------
h.group('修改文本');

t('改文本成功', function () {
  var data = fresh();
  var id = add(data, 'I', '写报告');
  var r = TaskOps.editTask(data, DATE, 'I', id, '写季度报告');

  h.assertTrue(r.ok);
  h.assertEqual(data.dates[DATE].I[0].text, '写季度报告');
});

t('改的时候去首尾空白', function () {
  var data = fresh();
  var id = add(data, 'I', '写报告');
  TaskOps.editTask(data, DATE, 'I', id, '  改过的  ');
  h.assertEqual(data.dates[DATE].I[0].text, '改过的');
});

t('改成空 —— 拒绝，而且原文一点没变', function () {
  // 用户可能只是想清空重打，手一滑就丢一条任务，是最容易挨骂的交互
  var data = fresh();
  var id = add(data, 'I', '原来写的内容');
  var r = TaskOps.editTask(data, DATE, 'I', id, '   ');

  h.assertFalse(r.ok);
  h.assertEqual(r.error, TaskOps.ERR.EMPTY_TEXT);
  h.assertEqual(data.dates[DATE].I[0].text, '原来写的内容', '原文必须留着');
  h.assertEqual(data.dates[DATE].I.length, 1, '也不能把这条删掉');
});

t('改不存在的任务', function () {
  var data = fresh();
  var r = TaskOps.editTask(data, DATE, 'I', 'id_不存在', '新文本');
  h.assertFalse(r.ok);
  h.assertEqual(r.error, TaskOps.ERR.NOT_FOUND);
});

t('改的时候不会碰到别的任务', function () {
  var data = fresh();
  add(data, 'I', '第一条');
  var id2 = add(data, 'I', '第二条');
  TaskOps.editTask(data, DATE, 'I', id2, '第二条改过');

  // 新任务默认加在开头（需求 3），所以「第二条」在最前
  h.assertEqual(data.dates[DATE].I[0].text, '第二条改过');
  h.assertEqual(data.dates[DATE].I[1].text, '第一条');
});

t('同一个 id 在别的象限里不算数', function () {
  var data = fresh();
  var id = add(data, 'I', '写报告');
  var r = TaskOps.editTask(data, DATE, 'II', id, '改');
  h.assertFalse(r.ok);
  h.assertEqual(r.error, TaskOps.ERR.NOT_FOUND);
});

// ---------------------------------------------------------------------------
h.group('勾选');

t('勾一下变完成，再勾一下变回未完成', function () {
  var data = fresh();
  var id = add(data, 'I', '写报告');

  h.assertTrue(TaskOps.toggleTask(data, DATE, 'I', id).ok);
  h.assertEqual(data.dates[DATE].I[0].completed, true);

  h.assertTrue(TaskOps.toggleTask(data, DATE, 'I', id).ok);
  h.assertEqual(data.dates[DATE].I[0].completed, false);
});

t('也可以直接指定要哪个状态', function () {
  var data = fresh();
  var id = add(data, 'I', '写报告');

  TaskOps.toggleTask(data, DATE, 'I', id, true);
  h.assertEqual(data.dates[DATE].I[0].completed, true);

  // 已经是 true 了，再传一次 true 应该还是 true（而不是取反变 false）
  TaskOps.toggleTask(data, DATE, 'I', id, true);
  h.assertEqual(data.dates[DATE].I[0].completed, true);
});

t('勾不存在的任务', function () {
  var data = fresh();
  var r = TaskOps.toggleTask(data, DATE, 'I', 'id_不存在');
  h.assertFalse(r.ok);
  h.assertEqual(r.error, TaskOps.ERR.NOT_FOUND);
});

t('勾选完成沉到末尾，文本不变，取消勾选不回移（需求 6）', function () {
  var data = fresh();
  add(data, 'I', '第一');
  var id2 = add(data, 'I', '第二');
  add(data, 'I', '第三');
  // 新任务默认加在开头（需求 3）：此时顺序是 第三,第二,第一

  TaskOps.toggleTask(data, DATE, 'I', id2);

  var texts = data.dates[DATE].I.map(function (x) { return x.text; });
  h.assertEqual(texts.join(','), '第三,第一,第二', '勾完沉到末尾');

  // 沉底是单向的：取消勾选不把它移回原位（需求 6 只豁免阶段，方向不可逆）
  TaskOps.toggleTask(data, DATE, 'I', id2, false);
  var texts2 = data.dates[DATE].I.map(function (x) { return x.text; });
  h.assertEqual(texts2.join(','), '第三,第一,第二', '取消勾选不回移');
});

// ---------------------------------------------------------------------------
h.group('删除');

t('删除成功，这一天就空了', function () {
  var data = fresh();
  var id = add(data, 'I', '写报告');
  var r = TaskOps.removeTask(data, DATE, 'I', id);

  h.assertTrue(r.ok);
  // 注意别直接读 data.dates[DATE].I —— 删到一条不剩时整天都被收掉了，
  // 那个键已经不存在。用 getDayTasks 查，它保证返回四个空象限。
  h.assertEqual(Store.getDayTasks(data, DATE).I.length, 0);
});

t('返回里带着被删掉的那条，好让提示说清删了什么', function () {
  var data = fresh();
  var id = add(data, 'I', '写季度报告');
  var r = TaskOps.removeTask(data, DATE, 'I', id);

  h.assertEqual(r.task.text, '写季度报告');
  h.assertEqual(r.task.id, id);
});

t('删中间那条，剩下的顺序保持', function () {
  var data = fresh();
  add(data, 'I', '第一');
  var id2 = add(data, 'I', '第二');
  add(data, 'I', '第三');
  // 新任务默认加在开头（需求 3）：此时顺序是 第三,第二,第一

  TaskOps.removeTask(data, DATE, 'I', id2);

  var texts = data.dates[DATE].I.map(function (x) { return x.text; });
  h.assertEqual(texts.join(','), '第三,第一');
});

t('删不存在的任务', function () {
  var data = fresh();
  var r = TaskOps.removeTask(data, DATE, 'I', 'id_不存在');
  h.assertFalse(r.ok);
  h.assertEqual(r.error, TaskOps.ERR.NOT_FOUND);
});

t('删到一条不剩时，整个日期条目被收掉', function () {
  var data = fresh();
  var id = add(data, 'I', '唯一一条');
  TaskOps.removeTask(data, DATE, 'I', id);

  h.assertFalse(!!data.dates[DATE], '不该留一个四条空数组占地方');
});

t('只删掉一个象限的最后一条，日期还在', function () {
  var data = fresh();
  var idI = add(data, 'I', '象限一的');
  add(data, 'III', '象限三的');

  TaskOps.removeTask(data, DATE, 'I', idI);

  h.assertTrue(!!data.dates[DATE], '象限三里还有任务，日期条目要留着');
  h.assertEqual(data.dates[DATE].III.length, 1);
});

t('删掉某个象限的任务不影响别的象限', function () {
  var data = fresh();
  add(data, 'I', '一的');
  var idII = add(data, 'II', '二的');
  add(data, 'IV', '四的');

  TaskOps.removeTask(data, DATE, 'II', idII);

  h.assertEqual(data.dates[DATE].I.length, 1);
  h.assertEqual(data.dates[DATE].II.length, 0);
  h.assertEqual(data.dates[DATE].IV.length, 1);
});

// ---------------------------------------------------------------------------
h.group('统计');

t('一条任务都没有：全是 0，完成率是 null', function () {
  // 关键：不能拿 0 当除数，否则页面上会出现「完成率 NaN%」
  var data = fresh();
  var s = TaskOps.getStats(data, DATE);

  h.assertEqual(s.total, 0);
  h.assertEqual(s.done, 0);
  h.assertEqual(s.remaining, 0);
  h.assertEqual(s.rate, null);
});

t('有任务但一条没完成', function () {
  var data = fresh();
  add(data, 'I', '一');
  add(data, 'II', '二');

  var s = TaskOps.getStats(data, DATE);
  h.assertEqual(s.total, 2);
  h.assertEqual(s.done, 0);
  h.assertEqual(s.rate, 0);
});

t('完成率算得对', function () {
  var data = fresh();
  var a = add(data, 'I', '一');
  var b = add(data, 'II', '二');
  add(data, 'III', '三');
  add(data, 'IV', '四');

  TaskOps.toggleTask(data, DATE, 'I', a);
  TaskOps.toggleTask(data, DATE, 'II', b);

  var s = TaskOps.getStats(data, DATE);
  h.assertEqual(s.total, 4);
  h.assertEqual(s.done, 2);
  h.assertEqual(s.remaining, 2);
  h.assertEqual(s.rate, 0.5);
});

t('四个象限一起统计', function () {
  var data = fresh();
  var quadrants = ['I', 'II', 'III', 'IV'];
  var ids = [];
  for (var i = 0; i < quadrants.length; i++) {
    ids.push(add(data, quadrants[i], '第 ' + quadrants[i] + ' 象限的任务'));
  }

  // 勾上 I 和 III，另两个留空
  TaskOps.toggleTask(data, DATE, 'I', ids[0]);
  TaskOps.toggleTask(data, DATE, 'III', ids[2]);

  var s = TaskOps.getStats(data, DATE);
  h.assertEqual(s.total, 4);
  h.assertEqual(s.done, 2);
  h.assertEqual(s.remaining, 2);
  h.assertEqual(s.rate, 0.5);
});

t('全部完成时完成率是 1', function () {
  var data = fresh();
  var a = add(data, 'I', '一');
  var b = add(data, 'IV', '二');

  TaskOps.toggleTask(data, DATE, 'I', a);
  TaskOps.toggleTask(data, DATE, 'IV', b);

  var s = TaskOps.getStats(data, DATE);
  h.assertEqual(s.rate, 1);
  h.assertEqual(s.remaining, 0);
});

t('统计只看当天，不看别的日期', function () {
  var data = fresh();
  add(data, 'I', '十月一');
  TaskOps.addTask(data, '2026-10-02', 'I', '十月二');
  TaskOps.addTask(data, '2026-10-02', 'I', '十月二之二');

  h.assertEqual(TaskOps.getStats(data, DATE).total, 1);
  h.assertEqual(TaskOps.getStats(data, '2026-10-02').total, 2);
});

t('查没数据的日期：全 0，不报错', function () {
  var data = fresh();
  var s = TaskOps.getStats(data, '2026-12-31');
  h.assertEqual(s.total, 0);
  h.assertEqual(s.rate, null);
});

// ---------------------------------------------------------------------------
h.group('登录后的整体流程（改完不保存就白改了）');

t('改完之后能原样存下来、读回来', function () {
  // 这一条把 task-ops 和 store 串起来跑一遍：真实使用时就是这么接的
  var storage = h.createMemoryStorage();
  Store.init({ storage: storage, clock: function () { return 1759300000000; } });

  var data = Store.load().data;
  var id = add(data, 'II', '写季度报告');
  TaskOps.toggleTask(data, DATE, 'II', id);
  h.assertTrue(Store.save(data).ok);

  var back = Store.load().data;
  h.assertEqual(back.dates[DATE].II.length, 1);
  h.assertEqual(back.dates[DATE].II[0].text, '写季度报告');
  h.assertEqual(back.dates[DATE].II[0].completed, true);
});

t('空文本被拒绝之后，存下来的还是干净的', function () {
  var storage = h.createMemoryStorage();
  Store.init({ storage: storage, clock: function () { return 1759300000000; } });

  var data = Store.load().data;
  var r = TaskOps.addTask(data, DATE, 'I', '   ');
  h.assertFalse(r.ok);
  Store.save(data);

  var back = Store.load().data;
  h.assertEqual(Object.keys(back.dates).length, 0, '被拒绝的任务不该被存下来');
});

// ---------------------------------------------------------------------------

h.summary('task-ops.js 增删改与统计');
