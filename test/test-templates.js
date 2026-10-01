/**
 * test-templates.js
 *
 * 模板（见 DS 2.14）：把某一天的四象限存成能反复用的底稿。
 *
 * 最要紧的几件事：
 *   1. 「覆盖同名」纯按名字判定（D-41）—— 没改名重缓存 = 覆盖，
 *      改过名重缓存 = 新建，不需要任何「是否重命名过」的标记位；
 *   2. 缓存是深拷贝（改原任务不动模板），应用也是深拷贝
 *      （编号全换、勾选清零、同文本跳过）；
 *   3. 模板跟着导出 / 导入 / 归档走，老备份（没有 templates 字段）照常读。
 *
 * 跑法：node test/test-templates.js
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

/** 造一天有内容的任务表：普通任务 + 带阶段的任务 + 块 */
function seedDay(data, dateStr) {
  var a = TaskOps.addTask(data, dateStr, 'I', '晨练').task;
  var b = TaskOps.addTask(data, dateStr, 'II', '写季度报告').task;
  TaskOps.addStage(data, dateStr, 'II', b.id, '收集数据');
  var block = TaskOps.addBlock(data, dateStr, 'I', '杂事包').block;
  var c = TaskOps.addTask(data, dateStr, 'I', '回邮件').task;
  data.dates[dateStr].I.splice(data.dates[dateStr].I.indexOf(c), 1);
  block.tasks.push(c);
  return { a: a, b: b, block: block, c: c };
}

/** 把模板里的全部 id（条目 + 阶段 + 块 + 块内任务）收成一个名单 */
function collectIds(items) {
  var ids = [];
  for (var q = 0; q < CONFIG.QUADRANT_IDS.length; q++) {
    var list = items[CONFIG.QUADRANT_IDS[q]];
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      ids.push(item.id);
      var tasks = item.type === 'block' ? item.tasks : [item];
      for (var k = 0; k < tasks.length; k++) {
        if (item.type === 'block') ids.push(tasks[k].id);
        var stages = tasks[k].stages || [];
        for (var s = 0; s < stages.length; s++) ids.push(stages[s].id);
      }
    }
  }
  return ids;
}

// ---------------------------------------------------------------------------
h.group('缓存：当天任务表 → 模板');

t('空的一天缓存 → 拒绝（EMPTY_DAY），不留模板', function () {
  var data = Store.createEmpty();
  var r = TaskOps.saveDayAsTemplate(data, DATE);

  h.assertFalse(r.ok);
  h.assertEqual(r.error, TaskOps.ERR.EMPTY_DAY);
  h.assertEqual(data.templates.length, 0, '拒绝不该顺手建一条空模板');
});

t('日期不合法 → BAD_DATE', function () {
  var data = Store.createEmpty();
  h.assertEqual(TaskOps.saveDayAsTemplate(data, '2026-13-01').error, TaskOps.ERR.BAD_DATE);
});

t('缓存有内容的一天：自动名 = 日期串，内容原样（含块 / 阶段 / slot / 勾选）', function () {
  var data = Store.createEmpty();
  var seeded = seedDay(data, DATE);
  TaskOps.setSlot(data, DATE, 'I', seeded.a.id, '早上');
  TaskOps.toggleTask(data, DATE, 'I', seeded.a.id, true);

  var r = TaskOps.saveDayAsTemplate(data, DATE);

  h.assertTrue(r.ok);
  h.assertFalse(r.overwritten, '第一次缓存不是覆盖');
  h.assertEqual(r.template.name, DATE, '自动名就是日期串');
  h.assertEqual(data.templates.length, 1);

  var items = r.template.items;
  h.assertEqual(items.I.length, 2, 'I 象限：一条任务 + 一个块');
  h.assertEqual(items.II.length, 1);
  h.assertEqual(items.I[0].completed, true, '勾选状态原样进模板');
  h.assertEqual(items.I[0].slot, '早上', 'slot 原样进模板');
  h.assertEqual(items.II[0].stages.length, 1, '阶段跟着进模板');
  h.assertEqual(items.I[1].type, 'block');
  h.assertEqual(items.I[1].tasks.length, 1, '块内任务跟着进模板');
});

t('缓存是深拷贝：之后改那天的任务，模板不动', function () {
  var data = Store.createEmpty();
  var seeded = seedDay(data, DATE);
  TaskOps.toggleTask(data, DATE, 'I', seeded.a.id, true); // 先勾上，让缓存里带着 true
  var r = TaskOps.saveDayAsTemplate(data, DATE);

  data.dates[DATE].I[0].text = '改成别的';
  data.dates[DATE].I[0].completed = false;
  TaskOps.removeTask(data, DATE, 'II', seeded.b.id);

  h.assertEqual(r.template.items.I[0].text, '晨练', '模板是副本不是引用');
  h.assertEqual(r.template.items.I[0].completed, true);
  h.assertEqual(r.template.items.II.length, 1, '删掉原任务不影响模板');
});

// ---------------------------------------------------------------------------
h.group('覆盖同名：纯按名字判定（D-41）');

t('未重命名时重新缓存同一天 → 覆盖：不新增条目，内容更新，id 不变', function () {
  var data = Store.createEmpty();
  seedDay(data, DATE);
  var first = TaskOps.saveDayAsTemplate(data, DATE).template;

  // 改一下当天再缓存
  TaskOps.addTask(data, DATE, 'III', '新加的事');
  var r = TaskOps.saveDayAsTemplate(data, DATE);

  h.assertTrue(r.ok);
  h.assertTrue(r.overwritten, '撞名 = 覆盖');
  h.assertEqual(data.templates.length, 1, '不新增条目');
  h.assertEqual(r.template.id, first.id, '覆盖不动 id');
  h.assertEqual(r.template.items.III.length, 1, '内容已更新');
  h.assertEqual(r.template.items.I.length, 2);
});

t('重命名后重新缓存同一天 → 新建一条，旧模板原样保留', function () {
  var data = Store.createEmpty();
  seedDay(data, DATE);
  var first = TaskOps.saveDayAsTemplate(data, DATE).template;
  TaskOps.renameTemplate(data, first.id, '周一例程');

  var r = TaskOps.saveDayAsTemplate(data, DATE);

  h.assertTrue(r.ok);
  h.assertFalse(r.overwritten, '改过名就不再撞名，走新建');
  h.assertEqual(data.templates.length, 2);
  h.assertEqual(data.templates[0].name, '周一例程', '旧模板原样保留');
  h.assertEqual(data.templates[1].name, DATE);
});

t('重命名：改空拒绝、原名保留；不存在的模板 NOT_FOUND', function () {
  var data = Store.createEmpty();
  seedDay(data, DATE);
  var tpl = TaskOps.saveDayAsTemplate(data, DATE).template;

  var bad = TaskOps.renameTemplate(data, tpl.id, '   ');
  h.assertFalse(bad.ok);
  h.assertEqual(bad.error, TaskOps.ERR.EMPTY_TEXT);
  h.assertEqual(tpl.name, DATE, '改空不动原名');

  var ok = TaskOps.renameTemplate(data, tpl.id, '  例程  ');
  h.assertTrue(ok.ok);
  h.assertEqual(tpl.name, '例程', '顺手 trim');

  h.assertEqual(TaskOps.renameTemplate(data, 'no-such', 'x').error, TaskOps.ERR.NOT_FOUND);
});

// ---------------------------------------------------------------------------
h.group('删除：不影响任何日期的任务');

t('删除模板：列表少一条，当天的任务一条不动', function () {
  var data = Store.createEmpty();
  seedDay(data, DATE);
  var tpl = TaskOps.saveDayAsTemplate(data, DATE).template;

  var r = TaskOps.removeTemplate(data, tpl.id);

  h.assertTrue(r.ok);
  h.assertEqual(data.templates.length, 0);
  h.assertEqual(data.dates[DATE].I.length, 2, '模板是副本，删它不动日期');
  h.assertEqual(data.dates[DATE].II.length, 1);
  h.assertEqual(TaskOps.removeTemplate(data, 'no-such').error, TaskOps.ERR.NOT_FOUND);
});

// ---------------------------------------------------------------------------
h.group('应用：副本填充（编号全换、勾选清零、同文本跳过）');

t('应用到空的一天：条目进对应象限，结构照搬', function () {
  var data = Store.createEmpty();
  seedDay(data, DATE);
  var tpl = TaskOps.saveDayAsTemplate(data, DATE).template;

  var TARGET = '2026-10-05';
  var r = TaskOps.applyTemplate(data, TARGET, tpl.id);

  h.assertTrue(r.ok);
  h.assertEqual(r.added, 3, '一条任务 + 一条带阶段的任务 + 一个块');
  h.assertEqual(r.skipped, 0);
  h.assertEqual(data.dates[TARGET].I.length, 2);
  h.assertEqual(data.dates[TARGET].II[0].stages.length, 1, '阶段照搬');
  h.assertEqual(data.dates[TARGET].I[1].tasks.length, 1, '块内任务照搬');
});

t('应用：编号全部换新，和模板里的一个都不重', function () {
  var data = Store.createEmpty();
  seedDay(data, DATE);
  var tpl = TaskOps.saveDayAsTemplate(data, DATE).template;
  var oldIds = collectIds(tpl.items);

  var TARGET = '2026-10-05';
  TaskOps.applyTemplate(data, TARGET, tpl.id);
  var newIds = collectIds(data.dates[TARGET]);

  h.assertTrue(newIds.length > 0);
  for (var i = 0; i < newIds.length; i++) {
    h.assertEqual(oldIds.indexOf(newIds[i]), -1,
      '新 id「' + newIds[i] + '」不该和模板里的撞车');
  }
});

t('应用：勾选清零 —— 模板里勾完了的，搬过去全是未完成（模板是计划不是记录）', function () {
  var data = Store.createEmpty();
  var seeded = seedDay(data, DATE);
  TaskOps.toggleTask(data, DATE, 'I', seeded.a.id, true);
  TaskOps.toggleItem(data, DATE, 'I', seeded.block.id, true); // 块内全勾
  var tpl = TaskOps.saveDayAsTemplate(data, DATE).template;
  h.assertTrue(tpl.items.I[0].completed, '模板里存的是勾上的状态');

  var TARGET = '2026-10-05';
  TaskOps.applyTemplate(data, TARGET, tpl.id);
  var day = data.dates[TARGET];

  h.assertFalse(day.I[0].completed, '任务清零');
  h.assertFalse(day.I[1].completed, '块清零');
  h.assertFalse(day.I[1].tasks[0].completed, '块内任务清零');
});

t('应用：slot 跟着模板走', function () {
  var data = Store.createEmpty();
  var a = TaskOps.addTask(data, DATE, 'I', '晨练').task;
  TaskOps.setSlot(data, DATE, 'I', a.id, '早上');
  var tpl = TaskOps.saveDayAsTemplate(data, DATE).template;

  var TARGET = '2026-10-05';
  TaskOps.applyTemplate(data, TARGET, tpl.id);

  h.assertEqual(data.dates[TARGET].I[0].slot, '早上');
});

t('应用：同象限同文本的跳过，原条目一条不动', function () {
  var data = Store.createEmpty();
  seedDay(data, DATE);
  var tpl = TaskOps.saveDayAsTemplate(data, DATE).template;

  var TARGET = '2026-10-05';
  var existing = TaskOps.addTask(data, TARGET, 'I', '晨练').task;
  TaskOps.toggleTask(data, TARGET, 'I', existing.id, true);

  var r = TaskOps.applyTemplate(data, TARGET, tpl.id);

  h.assertEqual(r.skipped, 1, '同文本的「晨练」跳过');
  h.assertEqual(r.added, 2);
  h.assertTrue(data.dates[TARGET].I[0].completed,
    '原有任务的勾选不被模板覆盖');
  h.assertEqual(data.dates[TARGET].I[0].id, existing.id, '原条目还是原条目');
});

t('应用两次不出双份：第二次全部跳过', function () {
  var data = Store.createEmpty();
  seedDay(data, DATE);
  var tpl = TaskOps.saveDayAsTemplate(data, DATE).template;

  var TARGET = '2026-10-05';
  TaskOps.applyTemplate(data, TARGET, tpl.id);
  var second = TaskOps.applyTemplate(data, TARGET, tpl.id);

  h.assertEqual(second.added, 0, '没有一条新加');
  h.assertEqual(second.skipped, 3);
  h.assertEqual(data.dates[TARGET].I.length, 2);
  h.assertEqual(data.dates[TARGET].II.length, 1);
});

t('应用：不存在的模板 NOT_FOUND；坏日期 BAD_DATE', function () {
  var data = Store.createEmpty();
  seedDay(data, DATE);
  var tpl = TaskOps.saveDayAsTemplate(data, DATE).template;

  h.assertEqual(TaskOps.applyTemplate(data, DATE, 'no-such').error,
    TaskOps.ERR.NOT_FOUND);
  h.assertEqual(TaskOps.applyTemplate(data, 'bad-date', tpl.id).error,
    TaskOps.ERR.BAD_DATE);
});

t('应用不改模板本身', function () {
  var data = Store.createEmpty();
  seedDay(data, DATE);
  var tpl = TaskOps.saveDayAsTemplate(data, DATE).template;
  var before = JSON.stringify(tpl);

  TaskOps.applyTemplate(data, '2026-10-05', tpl.id);

  h.assertEqual(JSON.stringify(tpl), before);
});

// ---------------------------------------------------------------------------
h.group('normalize 与序列化：老数据兼容、脏数据清洗');

t('createEmpty 自带空模板列表；老数据（无 templates 字段）读入补空', function () {
  h.assertTrue(Array.isArray(Store.createEmpty().templates));

  var r = Store.normalize({ dates: {} });
  h.assertTrue(Array.isArray(r.data.templates));
  h.assertEqual(r.data.templates.length, 0);
});

t('合法模板读入保留（含块 / 阶段 / slot）', function () {
  var raw = {
    dates: {},
    templates: [{
      id: 't1',
      name: '例程',
      createdAt: 1759300020000,
      items: {
        I: [{ id: 'a', text: '晨练', completed: true, slot: '早上' },
            { id: 'b', type: 'block', text: '包', tasks: [
              { id: 'c', text: '回邮件', stages: [
                { id: 's', text: '先看', completed: true, slot: '上午' }] }] }],
        II: [], III: [], IV: []
      }
    }]
  };
  var r = Store.normalize(raw);

  h.assertEqual(r.data.templates.length, 1);
  var tpl = r.data.templates[0];
  h.assertEqual(tpl.name, '例程');
  h.assertEqual(tpl.items.I[0].slot, '早上');
  h.assertEqual(tpl.items.I[1].tasks[0].stages[0].slot, '上午');
});

t('脏模板（没名字）整份丢掉，计数进 dropped', function () {
  var r = Store.normalize({
    dates: {},
    templates: [{ name: '   ', items: { I: [], II: [], III: [], IV: [] } }, 'junk']
  });

  h.assertEqual(r.data.templates.length, 0);
  h.assertEqual(r.dropped, 2);
});

t('序列化 → 解析 → normalize 往返不丢模板', function () {
  var data = Store.createEmpty();
  seedDay(data, DATE);
  TaskOps.saveDayAsTemplate(data, DATE);

  var r = Store.normalize(JSON.parse(Store.serialize(data)));

  h.assertEqual(r.data.templates.length, 1);
  h.assertEqual(r.data.templates[0].items.I.length, 2);
  h.assertEqual(r.data.templates[0].items.I[1].tasks.length, 1);
});

t('归档收缩 dates 时模板跟着留下', function () {
  var data = Store.createEmpty();
  seedDay(data, DATE);
  TaskOps.saveDayAsTemplate(data, DATE);

  var next = Store.applyArchive(data, { keep: {}, archive: {} });

  h.assertEqual(next.templates.length, 1, '模板不按日期分，归档不动它');
});

// ---------------------------------------------------------------------------
h.group('导入导出：跟着走、按名称判重');

t('导出再导入：模板一条不丢，id 全部换新', function () {
  var data = Store.createEmpty();
  seedDay(data, DATE);
  var tpl = TaskOps.saveDayAsTemplate(data, DATE).template;
  var oldIds = collectIds(tpl.items);

  var json = Store.serialize(data);
  var fresh = Store.createEmpty();
  var r = Importer.importText(fresh, json);

  h.assertTrue(r.ok);
  h.assertEqual(fresh.templates.length, 1);
  var imported = fresh.templates[0];
  h.assertEqual(imported.name, DATE);
  h.assertEqual(imported.items.I.length, 2);
  h.assertFalse(imported.id === tpl.id, '模板 id 换新');
  var newIds = collectIds(imported.items);
  for (var i = 0; i < newIds.length; i++) {
    h.assertEqual(oldIds.indexOf(newIds[i]), -1, '条目 id 也换新');
  }
});

t('同名模板导入时跳过，本地的不动', function () {
  var data = Store.createEmpty();
  seedDay(data, DATE);
  TaskOps.saveDayAsTemplate(data, DATE);

  // 另一台设备上同名（同一天缓存的）但内容不同的模板
  var other = Store.createEmpty();
  TaskOps.addTask(other, DATE, 'IV', '别的事');
  TaskOps.saveDayAsTemplate(other, DATE);
  var r = Importer.importText(data, Store.serialize(other));

  h.assertTrue(r.ok);
  h.assertEqual(data.templates.length, 1, '同名跳过，不新增');
  h.assertEqual(data.templates[0].items.I.length, 2, '本地模板内容不被覆盖');
});

t('templates 字段不合法 → 整份拒绝（BAD_TEMPLATE）', function () {
  var data = Store.createEmpty();

  var notList = Importer.importText(data,
    JSON.stringify({ dates: {}, templates: 'junk' }));
  h.assertFalse(notList.ok);
  h.assertEqual(notList.error, Importer.ERR.BAD_TEMPLATE);

  var missingQuadrant = Importer.importText(data, JSON.stringify({
    dates: {},
    templates: [{ name: '例程', items: { I: [] } }]
  }));
  h.assertFalse(missingQuadrant.ok);
  h.assertEqual(missingQuadrant.error, Importer.ERR.BAD_TEMPLATE);

  h.assertEqual(data.templates.length, 0, '拒绝不动本地数据');
});

t('老备份（没有 templates 字段）照常导入', function () {
  var data = Store.createEmpty();
  var r = Importer.importText(data, JSON.stringify({
    dates: { '2026-10-01': { I: [{ text: '老任务' }], II: [], III: [], IV: [] } }
  }));

  h.assertTrue(r.ok);
  h.assertEqual(r.added, 1);
});

// ---------------------------------------------------------------------------
h.group('渲染：面板头部、行、改名编辑态、空态');

t('空列表：头部在（含「存今天为模板」），给空态提示', function () {
  var html = Render.buildTemplatesHtml([], null);

  h.assertTrue(html.indexOf('tpl__save') !== -1, '缓存按钮在');
  h.assertTrue(html.indexOf('存今天为模板') !== -1);
  h.assertTrue(html.indexOf('tpl__empty') !== -1, '空态提示在');
  h.assertTrue(html.indexOf('tpl__list') === -1, '没有列表就不画 ul');
});

t('每行：名称 + 应用 / 改名 / 删除，头部带计数', function () {
  var html = Render.buildTemplatesHtml([
    { id: 't1', name: '2026-10-01', createdAt: 1,
      items: { I: [], II: [], III: [], IV: [] } }
  ], null);

  h.assertTrue(html.indexOf('tpl__count">1<') !== -1, '计数在');
  h.assertTrue(html.indexOf('2026-10-01') !== -1, '名称在');
  h.assertTrue(html.indexOf('tpl__apply') !== -1);
  h.assertTrue(html.indexOf('tpl__rename') !== -1);
  h.assertTrue(html.indexOf('tpl__del') !== -1);
  h.assertTrue(html.indexOf('data-id="t1"') !== -1, '行上挂着模板 id');
});

t('改名编辑态：该行收成输入框，值是现在的名字', function () {
  var html = Render.buildTemplatesHtml([
    { id: 't1', name: '例程', createdAt: 1,
      items: { I: [], II: [], III: [], IV: [] } }
  ], { editing: { mode: 'rename-template', templateId: 't1' } });

  h.assertTrue(html.indexOf('task__input') !== -1, '输入框在');
  h.assertTrue(html.indexOf('value="例程"') !== -1);
  h.assertTrue(html.indexOf('tpl__apply') === -1, '编辑态不画按钮');
});

t('名称要转义', function () {
  var html = Render.buildTemplatesHtml([
    { id: 't1', name: '<img src=x onerror=alert(1)>', createdAt: 1,
      items: { I: [], II: [], III: [], IV: [] } }
  ], null);

  h.assertFalse(html.indexOf('<img') !== -1);
  h.assertTrue(html.indexOf('&lt;img') !== -1);
});

// ---------------------------------------------------------------------------

h.summary('模板（DS 2.14）');
