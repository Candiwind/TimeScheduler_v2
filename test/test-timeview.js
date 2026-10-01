/**
 * test-timeview.js
 *
 * 时间视图（见 DS 2.13）：把当天的任务从「按象限分」换成「按时段分」。
 *
 * 最要紧的三件事：
 *   1. 只出现**有任务**的时段，顺序固定从早到晚（requirements 原话）；
 *   2. 分组口径和 2.12 严格一致 —— 无阶段任务进本体，有阶段进阶段（带父标注），
 *      块拍平，没设时段的不进，池不进；
 *   3. 它是**纯读取** —— 算分组不改数据一个字。
 *
 * 跑法：node test/test-timeview.js
 */
'use strict';

var h = require('./harness');
var CONFIG = require('../js/config');
var Store = require('../js/store');
var TaskOps = require('../js/task-ops');
var Render = require('../js/render');

var t = h.test;
var DATE = '2026-10-01';

function slotsOf(groups) {
  var out = [];
  for (var i = 0; i < groups.length; i++) out.push(groups[i].slot);
  return out.join(',');
}

function textsOf(group) {
  var out = [];
  for (var i = 0; i < group.items.length; i++) out.push(group.items[i].text);
  return out.join(',');
}

// ---------------------------------------------------------------------------
h.group('分组：只出现有任务的时段，按从早到晚排');

t('空一天 → 空分组', function () {
  h.assertEqual(TaskOps.getTimeView(Store.createEmpty(), DATE).length, 0);
});

t('没设时段的任务不进任何组', function () {
  var data = Store.createEmpty();
  TaskOps.addTask(data, DATE, 'I', '没时段的');

  h.assertEqual(TaskOps.getTimeView(data, DATE).length, 0);
});

t('设了时段的无阶段任务进组，只出现有任务的时段', function () {
  var data = Store.createEmpty();
  var a = TaskOps.addTask(data, DATE, 'I', '晨练').task.id;
  var b = TaskOps.addTask(data, DATE, 'I', '写日报').task.id;
  TaskOps.setSlot(data, DATE, 'I', a, '早上');
  TaskOps.setSlot(data, DATE, 'I', b, '晚上');

  var groups = TaskOps.getTimeView(data, DATE);

  h.assertEqual(slotsOf(groups), '早上,晚上', '中间没任务的时段不出现');
  h.assertEqual(textsOf(groups[0]), '晨练');
  h.assertEqual(textsOf(groups[1]), '写日报');
});

t('时段顺序固定从早到晚，和添加先后无关', function () {
  var data = Store.createEmpty();
  var ids = [];
  var slots = ['晚上', '早上', '下午'];
  for (var i = 0; i < slots.length; i++) {
    var id = TaskOps.addTask(data, DATE, 'I', '任务' + i).task.id;
    TaskOps.setSlot(data, DATE, 'I', id, slots[i]);
  }

  h.assertEqual(slotsOf(TaskOps.getTimeView(data, DATE)), '早上,下午,晚上');
});

t('同一时段下的多条全列出，保持象限内的先后', function () {
  var data = Store.createEmpty();
  var a = TaskOps.addTask(data, DATE, 'I', '先看邮件').task.id;
  var b = TaskOps.addTask(data, DATE, 'II', '再回邮件').task.id;
  TaskOps.setSlot(data, DATE, 'I', a, '上午');
  TaskOps.setSlot(data, DATE, 'II', b, '上午');

  var groups = TaskOps.getTimeView(data, DATE);

  h.assertEqual(groups.length, 1, '合并成一组');
  h.assertEqual(textsOf(groups[0]), '先看邮件,再回邮件');
});

// ---------------------------------------------------------------------------
h.group('分组口径：阶段进组带父标注，块拍平，池不进');

t('有阶段的任务：进组的是设了 slot 的阶段，任务本体不进', function () {
  var data = Store.createEmpty();
  var taskId = TaskOps.addTask(data, DATE, 'I', '写季度报告').task.id;
  var s1 = TaskOps.addStage(data, DATE, 'I', taskId, '收集数据').stage.id;
  TaskOps.addStage(data, DATE, 'I', taskId, '写初稿');
  TaskOps.setStageSlot(data, DATE, 'I', taskId, s1, '上午');

  var groups = TaskOps.getTimeView(data, DATE);

  h.assertEqual(groups.length, 1);
  h.assertEqual(groups[0].items.length, 1, '没设时段的「写初稿」不进');
  var item = groups[0].items[0];
  h.assertEqual(item.kind, 'stage');
  h.assertEqual(item.text, '收集数据');
  h.assertEqual(item.parentText, '写季度报告', '要带父标注');
  h.assertEqual(textsOf(groups[0]).indexOf('写季度报告'), -1, '任务本体不单独进组');
});

t('块被拍平：块内任务进组，块本体不出现', function () {
  var data = Store.createEmpty();
  var block = TaskOps.addBlock(data, DATE, 'I', '晨间例程').block;
  var child = TaskOps.addTask(data, DATE, 'I', '锻炼').task;
  data.dates[DATE].I.splice(data.dates[DATE].I.indexOf(child), 1);
  block.tasks.push(child);
  TaskOps.setSlot(data, DATE, 'I', child.id, '早上');

  var groups = TaskOps.getTimeView(data, DATE);

  h.assertEqual(groups.length, 1);
  h.assertEqual(textsOf(groups[0]), '锻炼');
  h.assertEqual(groups[0].items[0].kind, 'task');
});

t('计划池里的任务带 slot 也不进时间视图', function () {
  var data = Store.createEmpty();
  var id = TaskOps.addPoolItem(data, DATE, '池里的事').task.id;
  data.pool[0].slot = '下午';   // 数据层字段合法，但池不按日期分

  h.assertEqual(TaskOps.getTimeView(data, DATE).length, 0,
    '池是全局的，不属于任何一天（D-37）');
  h.assertEqual(data.pool.length, 1, '顺带验证没动数据');
});

t('完成状态跟着进组', function () {
  var data = Store.createEmpty();
  var a = TaskOps.addTask(data, DATE, 'I', '晨练').task.id;
  TaskOps.setSlot(data, DATE, 'I', a, '早上');
  TaskOps.toggleTask(data, DATE, 'I', a, true);

  h.assertEqual(TaskOps.getTimeView(data, DATE)[0].items[0].completed, true);
});

t('算分组不改数据一个字', function () {
  var data = Store.createEmpty();
  var a = TaskOps.addTask(data, DATE, 'I', '晨练').task.id;
  TaskOps.setSlot(data, DATE, 'I', a, '早上');
  var before = JSON.stringify(data);

  TaskOps.getTimeView(data, DATE);

  h.assertEqual(JSON.stringify(data), before);
});

t('别的日期的任务不混进来', function () {
  var data = Store.createEmpty();
  var a = TaskOps.addTask(data, '2026-10-02', 'I', '明天的事').task.id;
  TaskOps.setSlot(data, '2026-10-02', 'I', a, '早上');

  h.assertEqual(TaskOps.getTimeView(data, DATE).length, 0);
  h.assertEqual(TaskOps.getTimeView(data, '2026-10-02').length, 1);
});

// ---------------------------------------------------------------------------
h.group('渲染：组卡片、条数、完成态、空态');

function oneGroup() {
  return [{
    slot: '上午',
    items: [
      { kind: 'task', taskId: 't1', stageId: null, quadrantId: 'I',
        text: '看邮件', parentText: null, completed: false },
      { kind: 'stage', taskId: 't2', stageId: 's1', quadrantId: 'II',
        text: '收集数据', parentText: '写季度报告', completed: true }
    ]
  }];
}

t('每组：图标 + 名称 + 条数', function () {
  var html = Render.buildTimeViewHtml(oneGroup());

  h.assertTrue(html.indexOf('timeview__grid') !== -1, '网格容器在');
  h.assertTrue(html.indexOf('timeview__group') !== -1, '组卡片在');
  h.assertTrue(html.indexOf(CONFIG.SLOT_ICONS['上午']) !== -1, '时段图标在');
  h.assertTrue(html.indexOf('上午') !== -1);
  h.assertTrue(html.indexOf('timeview__count">2<') !== -1, '条数在');
});

t('阶段条目带父标注，完成的有完成态', function () {
  var html = Render.buildTimeViewHtml(oneGroup());

  h.assertTrue(html.indexOf('写季度报告') !== -1, '所属任务标出来了');
  h.assertTrue(html.indexOf('timeview__item--done') !== -1, '完成的条目有完成态');
});

t('空分组显示空态提示', function () {
  var html = Render.buildTimeViewHtml([]);

  h.assertTrue(html.indexOf('timeview__empty') !== -1);
  h.assertTrue(html.indexOf('timeview__grid') === -1, '没有组就别画空网格');
});

t('文本要转义', function () {
  var html = Render.buildTimeViewHtml([{
    slot: '早上',
    items: [{ kind: 'task', taskId: 't1', stageId: null, quadrantId: 'I',
              text: '<img src=x onerror=alert(1)>', parentText: null, completed: false }]
  }]);

  h.assertFalse(html.indexOf('<img') !== -1);
  h.assertTrue(html.indexOf('&lt;img') !== -1);
});

// ---------------------------------------------------------------------------

h.summary('时间视图（DS 2.13）');
