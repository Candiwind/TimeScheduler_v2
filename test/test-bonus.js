/**
 * test-bonus.js
 *
 * Bonus 任务 / 阶段（需求 2，见 DS 2.16）：任务或阶段可标记为 Bonus，
 * 完成率分母不计 Bonus、分子计 Bonus，所以完成率可以超过 100%。
 *
 * 覆盖（见 DS 三、测试策略）：
 *   setBonus / setStageBonus 置 / 删 / 非法 id；
 *   getProgress 带 Bonus 阶段（Bonus 阶段没完成就不算全完成、全 Bonus 退化、
 *   bonusDone / bonusCount 字段）；
 *   progressOfItem 块含 Bonus 子项；
 *   getStats 分母不含 Bonus / 分子含 Bonus / 完成率可 >100% / 全 Bonus 退化 / 空日 rate=null；
 *   store.js 镜像 blockDone、normalize 保 bonus:true / 丢 bonus:false；
 *   导入往返（含 v1 无 bonus 旧文件照常）；
 *   applyTemplate / postponeStage 带 Bonus；
 *   buildMarkdown 统计行 + 🎁、buildPrintHtml 统计行。
 *
 * 跑法：node test/test-bonus.js
 */
'use strict';

var h = require('./harness');
var Store = require('../js/store');
var TaskOps = require('../js/task-ops');
var Importer = require('../js/importer');
var Exporter = require('../js/exporter');
var Pdf = require('../js/pdf');

var t = h.test;
var DATE = '2026-10-01';

// ---------------------------------------------------------------------------
h.group('setBonus / setStageBonus：置、删、非法 id');

t('setBonus(true) 打上标记，setBonus(false) 回到普通', function () {
  var data = Store.createEmpty();
  var id = TaskOps.addTask(data, DATE, 'I', '写周报').task.id;

  TaskOps.setBonus(data, DATE, 'I', id, true);
  h.assertEqual(data.dates[DATE].I[0].bonus, true);

  TaskOps.setBonus(data, DATE, 'I', id, false);
  h.assertEqual(data.dates[DATE].I[0].bonus, undefined, '取消后不该留字段');
});

t('setBonus 找不到任务 → NOT_FOUND', function () {
  var data = Store.createEmpty();
  h.assertEqual(TaskOps.setBonus(data, DATE, 'I', 'no-such', true).error,
    TaskOps.ERR.NOT_FOUND);
});

t('setStageBonus(true/false) 打在阶段上', function () {
  var data = Store.createEmpty();
  var taskId = TaskOps.addTask(data, DATE, 'I', '写报告').task.id;
  var stageId = TaskOps.addStage(data, DATE, 'I', taskId, '收集数据').stage.id;

  TaskOps.setStageBonus(data, DATE, 'I', taskId, stageId, true);
  h.assertEqual(data.dates[DATE].I[0].stages[0].bonus, true);

  TaskOps.setStageBonus(data, DATE, 'I', taskId, stageId, false);
  h.assertEqual(data.dates[DATE].I[0].stages[0].bonus, undefined);
});

t('setStageBonus 找不到任务 / 阶段 → NOT_FOUND', function () {
  var data = Store.createEmpty();
  var taskId = TaskOps.addTask(data, DATE, 'I', '写报告').task.id;

  h.assertEqual(TaskOps.setStageBonus(data, DATE, 'I', 'no-such', 's', true).error,
    TaskOps.ERR.NOT_FOUND);
  h.assertEqual(TaskOps.setStageBonus(data, DATE, 'I', taskId, 'no-such', true).error,
    TaskOps.ERR.NOT_FOUND);
});

// ---------------------------------------------------------------------------
h.group('getProgress：Bonus 口径（分母不计 Bonus、分子计 Bonus）');

t('普通（无阶段）Bonus 任务：total=0、bonusCount=1、isComplete=自己的勾选', function () {
  var data = Store.createEmpty();
  var id = TaskOps.addTask(data, DATE, 'I', '写周报').task.id;
  TaskOps.setBonus(data, DATE, 'I', id, true);

  var p = TaskOps.getProgress(TaskOps.findTask(data, DATE, 'I', id).task);
  h.assertEqual(p.total, 0);
  h.assertEqual(p.bonusCount, 1);
  h.assertEqual(p.done, 0, '没勾时 done 是 0');
  h.assertFalse(p.isComplete);

  TaskOps.toggleTask(data, DATE, 'I', id, true);
  p = TaskOps.getProgress(TaskOps.findTask(data, DATE, 'I', id).task);
  h.assertEqual(p.done, 1);
  h.assertEqual(p.bonusDone, 1);
  h.assertTrue(p.isComplete, '勾完 Bonus 任务也算完成');
});

t('带阶段任务：完成率分母只计非 Bonus 阶段，但 Bonus 没做完就不算全完成（v2.5）', function () {
  var data = Store.createEmpty();
  var taskId = TaskOps.addTask(data, DATE, 'I', '写报告').task.id;
  var s1 = TaskOps.addStage(data, DATE, 'I', taskId, '收集数据').stage.id;
  var s2 = TaskOps.addStage(data, DATE, 'I', taskId, '写初稿').stage.id;
  var s3 = TaskOps.addStage(data, DATE, 'I', taskId, 'Bonus 项').stage.id;
  TaskOps.setStageBonus(data, DATE, 'I', taskId, s3, true);

  // 两个普通阶段都勾上，Bonus 阶段不勾 → 完成率已满，但**还不算全完成**
  TaskOps.toggleStage(data, DATE, 'I', taskId, s1, true);
  TaskOps.toggleStage(data, DATE, 'I', taskId, s2, true);

  var task = TaskOps.findTask(data, DATE, 'I', taskId).task;
  var p = TaskOps.getProgress(task);
  h.assertEqual(p.total, 2, '分母不计 Bonus 阶段');
  h.assertEqual(p.bonusCount, 1);
  h.assertEqual(p.done, 2, 'Bonus 阶段没勾，不进分子');
  h.assertFalse(p.isComplete, 'Bonus 阶段没做完 → 不算全完成');
  h.assertFalse(task.completed, '派生字段跟 isComplete 走');

  // 把 Bonus 阶段也勾上 → done 计入，且这才算全完成
  TaskOps.toggleStage(data, DATE, 'I', taskId, s3, true);
  task = TaskOps.findTask(data, DATE, 'I', taskId).task;
  p = TaskOps.getProgress(task);
  h.assertEqual(p.done, 3, '勾了的 Bonus 阶段进分子');
  h.assertEqual(p.bonusDone, 1);
  h.assertTrue(p.isComplete, '每个阶段都勾完才算全完成');
});

t('全 Bonus 阶段：total=0，退化为「全部完成才算完成」', function () {
  var data = Store.createEmpty();
  var taskId = TaskOps.addTask(data, DATE, 'I', '全 Bonus').task.id;
  var s1 = TaskOps.addStage(data, DATE, 'I', taskId, 'b1').stage.id;
  var s2 = TaskOps.addStage(data, DATE, 'I', taskId, 'b2').stage.id;
  TaskOps.setStageBonus(data, DATE, 'I', taskId, s1, true);
  TaskOps.setStageBonus(data, DATE, 'I', taskId, s2, true);

  var p = TaskOps.getProgress(TaskOps.findTask(data, DATE, 'I', taskId).task);
  h.assertEqual(p.total, 0);
  h.assertEqual(p.bonusCount, 2);
  h.assertFalse(p.isComplete, '一条没勾不算完成');

  TaskOps.toggleStage(data, DATE, 'I', taskId, s1, true);
  h.assertFalse(TaskOps.getProgress(
    TaskOps.findTask(data, DATE, 'I', taskId).task).isComplete, '勾了一条仍不算');

  TaskOps.toggleStage(data, DATE, 'I', taskId, s2, true);
  h.assertTrue(TaskOps.getProgress(
    TaskOps.findTask(data, DATE, 'I', taskId).task).isComplete, '全勾才算');
});

// ---------------------------------------------------------------------------
h.group('progressOfItem：块含 Bonus 子项');

t('块的完成度按块内最细单位算：Bonus 子项不计分母，但不做完就不算全完成（v2.5）', function () {
  var data = Store.createEmpty();
  var block = TaskOps.addBlock(data, DATE, 'I', '块').block;
  block.tasks.push({ id: 'c1', text: '普通', completed: true, createdAt: 1 });
  block.tasks.push({ id: 'c2', text: 'Bonus 子', completed: false, createdAt: 1, bonus: true });

  var p = TaskOps.progressOfItem(block);
  h.assertEqual(p.total, 1, '分母只计非 Bonus 子项');
  h.assertEqual(p.bonusCount, 1);
  h.assertEqual(p.done, 1, '已完成的普通子项');
  h.assertFalse(p.isComplete, 'Bonus 子项没做完 → 块不算全完成');

  block.tasks[1].completed = true;
  h.assertTrue(TaskOps.progressOfItem(block).isComplete, 'Bonus 子项也勾完 → 块全完成');
});

// ---------------------------------------------------------------------------
h.group('getStats：分母不含 Bonus、分子含 Bonus、完成率可 >100%');

t('一个普通 + 一个 Bonus 都勾完 → 完成率 200%', function () {
  var data = Store.createEmpty();
  var a = TaskOps.addTask(data, DATE, 'I', '普通').task.id;
  var b = TaskOps.addTask(data, DATE, 'I', 'Bonus 项').task.id;
  TaskOps.setBonus(data, DATE, 'I', b, true);
  TaskOps.toggleTask(data, DATE, 'I', a, true);
  TaskOps.toggleTask(data, DATE, 'I', b, true);

  var s = TaskOps.getStats(data, DATE);
  h.assertEqual(s.total, 1, '分母只计普通项');
  h.assertEqual(s.done, 2, '分子计普通 + Bonus');
  h.assertEqual(s.bonusCount, 1);
  h.assertEqual(s.bonusDone, 1);
  h.assertEqual(s.rate, 2, '2 / 1 = 200%');
});

t('全 Bonus 时退化为 已完成Bonus / 全部Bonus', function () {
  var data = Store.createEmpty();
  var a = TaskOps.addTask(data, DATE, 'I', 'b1').task.id;
  var b = TaskOps.addTask(data, DATE, 'I', 'b2').task.id;
  TaskOps.setBonus(data, DATE, 'I', a, true);
  TaskOps.setBonus(data, DATE, 'I', b, true);
  TaskOps.toggleTask(data, DATE, 'I', a, true);

  var s = TaskOps.getStats(data, DATE);
  h.assertEqual(s.total, 0);
  h.assertEqual(s.bonusCount, 2);
  h.assertEqual(s.done, 1);
  h.assertEqual(s.rate, 0.5, '1 / 2 = 50%');
});

t('一条都没有 → total=0、rate=null（交给渲染显示「—」）', function () {
  var s = TaskOps.getStats(Store.createEmpty(), DATE);
  h.assertEqual(s.total, 0);
  h.assertEqual(s.done, 0);
  h.assertNull(s.rate);
});

// ---------------------------------------------------------------------------
h.group('store.js 镜像与 normalize');

t('blockDone 镜像全完成口径（v2.5）：每个单位都完成才算，Bonus 也不例外', function () {
  h.assertFalse(Store.blockDone([
    { id: 'c1', text: '普通', completed: true },
    { id: 'c2', text: 'Bonus', completed: false, bonus: true }
  ]), 'Bonus 子项没完成 → 整块不算完成');

  h.assertFalse(Store.blockDone([
    { id: 'c1', text: '普通', completed: false },
    { id: 'c2', text: 'Bonus', completed: true, bonus: true }
  ]), '普通子项没完成，光 Bonus 完成不算');

  h.assertTrue(Store.blockDone([
    { id: 'c1', text: '普通', completed: true },
    { id: 'c2', text: 'Bonus', completed: true, bonus: true }
  ]), '每个单位都完成 → 完成');

  h.assertFalse(Store.blockDone([]), '空块不算完成');
});

t('allDone 镜像：空列表 false、每个都完成才 true', function () {
  h.assertFalse(Store.allDone([]));
  h.assertFalse(Store.allDone([{ completed: true }, { completed: false, bonus: true }]));
  h.assertTrue(Store.allDone([{ completed: true }, { completed: true, bonus: true }]));
});

t('normalize 保 bonus:true、丢 bonus:false（当作普通）', function () {
  var r = Store.normalize({
    dates: { '2026-10-01': {
      I: [{ text: 'a', bonus: true }, { text: 'b', bonus: false }], II: [], III: [], IV: []
    } }
  });

  var list = r.data.dates['2026-10-01'].I;
  h.assertEqual(list[0].bonus, true, 'bonus:true 保留');
  h.assertEqual(list[1].bonus, undefined, 'bonus:false 当普通，不挂字段');
});

t('normalize 保阶段 bonus:true', function () {
  var r = Store.normalize({
    dates: { '2026-10-01': {
      I: [{ text: '任务', stages: [{ text: '阶段', bonus: true }] }], II: [], III: [], IV: []
    } }
  });
  h.assertEqual(r.data.dates['2026-10-01'].I[0].stages[0].bonus, true);
});

// ---------------------------------------------------------------------------
h.group('导入导出：bonus 跟着走、v1 旧文件照常');

t('导出再导入：任务和阶段的 bonus 都不丢', function () {
  var data = Store.createEmpty();
  var a = TaskOps.addTask(data, DATE, 'I', '写周报').task.id;
  TaskOps.setBonus(data, DATE, 'I', a, true);
  var t2 = TaskOps.addTask(data, DATE, 'I', '写报告').task.id;
  var s1 = TaskOps.addStage(data, DATE, 'I', t2, '收集数据').stage.id;
  TaskOps.setStageBonus(data, DATE, 'I', t2, s1, true);

  var fresh = Store.createEmpty();
  var r = Importer.importText(fresh, Store.serialize(data));

  h.assertTrue(r.ok);
  var list = r.data.dates[DATE].I;
  h.assertTrue(list.some(function (it) { return it.text === '写周报' && it.bonus === true; }),
    '任务 bonus 保留');
  h.assertTrue(list.some(function (it) {
    return it.text === '写报告' &&
      it.stages && it.stages[0].text === '收集数据' && it.stages[0].bonus === true;
  }), '阶段 bonus 保留');
});

t('v1 旧文件（没有 bonus 字段）照常导入', function () {
  var data = Store.createEmpty();
  var r = Importer.importText(data, JSON.stringify({
    dates: { '2026-10-01': { I: [{ text: '老任务' }], II: [], III: [], IV: [] } }
  }));

  h.assertTrue(r.ok);
  h.assertEqual(r.data.dates['2026-10-01'].I[0].bonus, undefined);
});

// ---------------------------------------------------------------------------
h.group('数据流转：applyTemplate / postponeStage 带 Bonus');

t('applyTemplate：任务和阶段的 bonus 都照搬', function () {
  var data = Store.createEmpty();
  var a = TaskOps.addTask(data, DATE, 'I', '写周报').task.id;
  TaskOps.setBonus(data, DATE, 'I', a, true);
  var t2 = TaskOps.addTask(data, DATE, 'I', '写报告').task.id;
  var s1 = TaskOps.addStage(data, DATE, 'I', t2, '收集数据').stage.id;
  TaskOps.setStageBonus(data, DATE, 'I', t2, s1, true);
  var tpl = TaskOps.saveDayAsTemplate(data, DATE).template;

  var TARGET = '2026-10-05';
  TaskOps.applyTemplate(data, TARGET, tpl.id);
  var day = data.dates[TARGET].I;

  h.assertTrue(day.some(function (it) { return it.text === '写周报' && it.bonus === true; }));
  h.assertTrue(day.some(function (it) {
    return it.text === '写报告' && it.stages[0].text === '收集数据' && it.stages[0].bonus === true;
  }));
});

t('postponeStage：Bonus 阶段推迟成池内任务也带 bonus', function () {
  var data = Store.createEmpty();
  var taskId = TaskOps.addTask(data, DATE, 'I', '写报告').task.id;
  var stageId = TaskOps.addStage(data, DATE, 'I', taskId, '收集数据').stage.id;
  TaskOps.setStageBonus(data, DATE, 'I', taskId, stageId, true);

  TaskOps.postponeStage(data, DATE, 'I', taskId, stageId);

  h.assertEqual(data.pool.length, 1);
  h.assertEqual(data.pool[0].bonus, true, '池内任务带 bonus');
});

// ---------------------------------------------------------------------------
h.group('全完成口径三处一致（v2.5）：getProgress / store / 导入');

t('normalize 带阶段任务：派生 completed 与 getProgress 对得上', function () {
  var r = Store.normalize({
    dates: { '2026-10-01': {
      I: [{
        text: '任务',
        stages: [{ text: '必做', completed: true },
                 { text: '加分', completed: false, bonus: true }]
      }],
      II: [], III: [], IV: []
    } }
  });

  var task = r.data.dates['2026-10-01'].I[0];
  h.assertFalse(task.completed, 'Bonus 阶段没完成 → 派生字段 false');
  h.assertFalse(TaskOps.getProgress(task).isComplete, '和 getProgress 同一口径');
  h.assertEqual(TaskOps.getProgress(task).total, 1, '完成率分母仍只计非 Bonus 阶段');
});

t('导入带 Bonus 阶段的任务：copyTask 的 completed 不再自成一派', function () {
  function importOne(stages) {
    var file = JSON.stringify({
      dates: { '2026-10-01': { I: [{ text: '导入的任务', stages: stages }], II: [], III: [], IV: [] } }
    });
    var r = Importer.importText(Store.createEmpty(), file);
    h.assertTrue(r.ok);
    return r.data.dates['2026-10-01'].I[0];
  }

  // 必做做完、Bonus 没做 → 不算全完成（旧代码这里会写成 true，和界面对不上）
  var partial = importOne([{ text: '必做', completed: true },
                           { text: '加分', completed: false, bonus: true }]);
  h.assertFalse(partial.completed, '导入的 completed 不该说它全完成');
  h.assertFalse(TaskOps.getProgress(partial).isComplete, '与 getProgress 口径一致');

  // 全都做完 → 算全完成（Bonus 也做完了）
  var all = importOne([{ text: '必做', completed: true },
                       { text: '加分', completed: true, bonus: true }]);
  h.assertTrue(all.completed, '每个阶段都完成才算全完成');
  h.assertTrue(TaskOps.getProgress(all).isComplete);
});

// ---------------------------------------------------------------------------
h.group('日报统计行与 🎁（需求 1 + 2）');

t('buildMarkdown 每个日期标题下有统计行，Bonus 任务前有 🎁', function () {
  var data = Store.createEmpty();
  var a = TaskOps.addTask(data, DATE, 'I', '普通').task.id;
  var b = TaskOps.addTask(data, DATE, 'I', 'Bonus 项').task.id;
  TaskOps.setBonus(data, DATE, 'I', b, true);
  TaskOps.toggleTask(data, DATE, 'I', a, true);
  TaskOps.toggleTask(data, DATE, 'I', b, true);

  var md = Exporter.buildMarkdown(data);

  h.assertTrue(md.indexOf('✅ 已完成 2 / 总数 1') !== -1, '分子含 Bonus、分母不含');
  h.assertTrue(md.indexOf('完成率 200%') !== -1, '完成率可超过 100%');
  h.assertTrue(md.indexOf('含 Bonus 1/1') !== -1, '带 Bonus 时补一句');
  h.assertTrue(md.indexOf('- [x] 🎁 Bonus 项') !== -1, 'Bonus 任务前加 🎁');
});

t('buildMarkdown 没 Bonus 时不出现「含 Bonus」', function () {
  var data = Store.createEmpty();
  var a = TaskOps.addTask(data, DATE, 'I', '普通').task.id;
  TaskOps.toggleTask(data, DATE, 'I', a, true);

  var md = Exporter.buildMarkdown(data);
  h.assertTrue(md.indexOf('✅ 已完成 1 / 总数 1') !== -1);
  h.assertFalse(md.indexOf('含 Bonus') !== -1);
});

t('buildMarkdown 阶段 Bonus 也有 🎁', function () {
  var data = Store.createEmpty();
  var taskId = TaskOps.addTask(data, DATE, 'I', '写报告').task.id;
  var s1 = TaskOps.addStage(data, DATE, 'I', taskId, '收集数据').stage.id;
  TaskOps.setStageBonus(data, DATE, 'I', taskId, s1, true);

  var md = Exporter.buildMarkdown(data);
  h.assertTrue(md.indexOf('  - [ ] 🎁 收集数据') !== -1, '阶段前加 🎁');
});

t('buildPrintHtml 也有统计行', function () {
  var data = Store.createEmpty();
  var a = TaskOps.addTask(data, DATE, 'I', '普通').task.id;
  TaskOps.toggleTask(data, DATE, 'I', a, true);

  var html = Pdf.buildPrintHtml(data);
  h.assertTrue(html.indexOf('print__stats') !== -1);
  h.assertTrue(html.indexOf('✅ 已完成 1 / 总数 1') !== -1);
});

// ---------------------------------------------------------------------------

h.summary('Bonus 任务 / 阶段（需求 2 + 日报统计需求 1）');
