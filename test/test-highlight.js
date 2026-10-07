/**
 * test-highlight.js
 *
 * 高亮（requirements 最新一条，见 DS 2.40）：
 * 「连续双击可以给当前任务/任务块/阶段的整体加上高亮效果。
 *   高亮效果用浅橙色，完全覆盖字体的高度」
 *
 * 这一条横跨四层，所以四层各测一遍：
 *   数据层 task-ops.setHighlight / setStageHighlight / setBlockHighlight /
 *          setPoolHighlight（置、删、非法目标、不进统计）；
 *   store.js 的 normalize（保 highlight:true、丢别的值、老数据不加字段）；
 *   importer.js 的校验与拷贝（往返不丢、老文件照常、脏值当没高亮）；
 *   render.js 的类名（任务 / 阶段 / 块 / 池内 / 时间视图）；
 *   数据流转（搜索过滤的块副本、时间视图条目、模板、推迟、导入回象限）；
 *   css/style.css 与 js/app.js 的源码守卫（Node 里没有 DOM，双击手势
 *   和颜色只能守源码，见 DS 3.2）。
 *
 * 跑法：node test/test-highlight.js
 */
'use strict';

var fs = require('fs');
var path = require('path');
var h = require('./harness');
var Store = require('../js/store');
var TaskOps = require('../js/task-ops');
var Importer = require('../js/importer');
var Render = require('../js/render');

var t = h.test;
var DATE = '2026-10-01';

// 真实运行时是 app.js 把 TaskOps.getProgress 传进来的，测试里也照着来
var VIEW = { progressOf: TaskOps.getProgress };

// ---------------------------------------------------------------------------
h.group('setHighlight：任务本体（置、删、非法目标、不进统计）');

t('setHighlight(true) 打上标记，setHighlight(false) 把字段删干净', function () {
  var data = Store.createEmpty();
  var id = TaskOps.addTask(data, DATE, 'I', '写周报').task.id;

  h.assertTrue(TaskOps.setHighlight(data, DATE, 'I', id, true).ok);
  h.assertEqual(data.dates[DATE].I[0].highlight, true);

  h.assertTrue(TaskOps.setHighlight(data, DATE, 'I', id, false).ok);
  h.assertEqual(data.dates[DATE].I[0].highlight, undefined, '取消后不该留字段');
});

t('setHighlight 穿透任务块：块内任务也能标', function () {
  var data = Store.createEmpty();
  var blockId = TaskOps.addBlock(data, DATE, 'I', '一个块').block.id;
  var taskId = TaskOps.addTask(data, DATE, 'I', '块内任务').task.id;
  TaskOps.moveTaskIntoBlock(data, DATE, taskId, blockId, 0);

  h.assertTrue(TaskOps.setHighlight(data, DATE, 'I', taskId, true).ok);
  h.assertEqual(data.dates[DATE].I[0].tasks[0].highlight, true);
  h.assertEqual(data.dates[DATE].I[0].highlight, undefined, '块自己不该被顺带标上');
});

t('setHighlight 找不到任务 → NOT_FOUND', function () {
  var data = Store.createEmpty();
  h.assertEqual(TaskOps.setHighlight(data, DATE, 'I', 'no-such', true).error,
    TaskOps.ERR.NOT_FOUND);
});

t('setHighlight 日期 / 象限不合法 → NOT_FOUND（和 setBonus 同一条）', function () {
  var data = Store.createEmpty();
  var id = TaskOps.addTask(data, DATE, 'I', '写周报').task.id;

  h.assertEqual(TaskOps.setHighlight(data, '2026-13-99', 'I', id, true).error,
    TaskOps.ERR.NOT_FOUND);
  h.assertEqual(TaskOps.setHighlight(data, DATE, 'IX', id, true).error,
    TaskOps.ERR.NOT_FOUND);
});

t('高亮不改完成率、不改「全完成」（它不是参与计算的字段）', function () {
  var data = Store.createEmpty();
  var a = TaskOps.addTask(data, DATE, 'I', '写周报').task.id;
  TaskOps.addTask(data, DATE, 'II', '回邮件');
  TaskOps.toggleTask(data, DATE, 'I', a, true);

  var before = TaskOps.getStats(data, DATE);
  TaskOps.setHighlight(data, DATE, 'I', a, true);
  var after = TaskOps.getStats(data, DATE);

  h.assertEqual(after.total, before.total);
  h.assertEqual(after.done, before.done);
  h.assertEqual(after.rate, before.rate);
  h.assertEqual(data.dates[DATE].I[0].completed, true, '完成状态一个字不动');
});

// ---------------------------------------------------------------------------
h.group('setStageHighlight：阶段（不动任务本体）');

t('setStageHighlight(true/false) 打在阶段上', function () {
  var data = Store.createEmpty();
  var taskId = TaskOps.addTask(data, DATE, 'I', '写报告').task.id;
  var s1 = TaskOps.addStage(data, DATE, 'I', taskId, '收集数据').stage.id;

  h.assertTrue(TaskOps.setStageHighlight(data, DATE, 'I', taskId, s1, true).ok);
  h.assertEqual(data.dates[DATE].I[0].stages[0].highlight, true);
  h.assertEqual(data.dates[DATE].I[0].highlight, undefined, '任务本体不该被一起标上');

  TaskOps.setStageHighlight(data, DATE, 'I', taskId, s1, false);
  h.assertEqual(data.dates[DATE].I[0].stages[0].highlight, undefined);
});

t('setStageHighlight 找不到任务 / 阶段 → NOT_FOUND', function () {
  var data = Store.createEmpty();
  var taskId = TaskOps.addTask(data, DATE, 'I', '写报告').task.id;

  h.assertEqual(TaskOps.setStageHighlight(data, DATE, 'I', 'no-such', 's', true).error,
    TaskOps.ERR.NOT_FOUND);
  h.assertEqual(TaskOps.setStageHighlight(data, DATE, 'I', taskId, 'no-such', true).error,
    TaskOps.ERR.NOT_FOUND);
});

t('带阶段的任务：本体高亮和阶段高亮互不干扰', function () {
  var data = Store.createEmpty();
  var taskId = TaskOps.addTask(data, DATE, 'I', '写报告').task.id;
  var s1 = TaskOps.addStage(data, DATE, 'I', taskId, '收集数据').stage.id;

  // 双击的是任务行那段文字，所以带阶段的任务**本体**照样能标黄
  TaskOps.setHighlight(data, DATE, 'I', taskId, true);
  h.assertEqual(data.dates[DATE].I[0].highlight, true);
  h.assertEqual(data.dates[DATE].I[0].stages[0].highlight, undefined);

  TaskOps.setStageHighlight(data, DATE, 'I', taskId, s1, true);
  h.assertEqual(data.dates[DATE].I[0].stages[0].highlight, true);
  h.assertEqual(data.dates[DATE].I[0].stages[0].completed, false, '高亮不改阶段勾选');
});

// ---------------------------------------------------------------------------
h.group('setBlockHighlight / setPoolHighlight');

t('setBlockHighlight(true/false) 打在块上，不传染块内任务', function () {
  var data = Store.createEmpty();
  var blockId = TaskOps.addBlock(data, DATE, 'I', '一个块').block.id;
  var taskId = TaskOps.addTask(data, DATE, 'I', '块内任务').task.id;
  TaskOps.moveTaskIntoBlock(data, DATE, taskId, blockId, 0);

  h.assertTrue(TaskOps.setBlockHighlight(data, DATE, 'I', blockId, true).ok);
  h.assertEqual(data.dates[DATE].I[0].highlight, true);
  h.assertEqual(data.dates[DATE].I[0].tasks[0].highlight, undefined);

  TaskOps.setBlockHighlight(data, DATE, 'I', blockId, false);
  h.assertEqual(data.dates[DATE].I[0].highlight, undefined);
});

t('setBlockHighlight 只认块 id：传任务 id → NOT_FOUND', function () {
  var data = Store.createEmpty();
  var taskId = TaskOps.addTask(data, DATE, 'I', '写周报').task.id;

  h.assertEqual(TaskOps.setBlockHighlight(data, DATE, 'I', taskId, true).error,
    TaskOps.ERR.NOT_FOUND);
  h.assertEqual(TaskOps.setBlockHighlight(data, DATE, 'IX', 'b', true).error,
    TaskOps.ERR.BAD_QUADRANT);
});

t('setPoolHighlight：池内顶层任务', function () {
  var data = Store.createEmpty();
  var id = TaskOps.addPoolItem(data, DATE, '池任务').task.id;

  h.assertTrue(TaskOps.setPoolHighlight(data, id, true).ok);
  h.assertEqual(data.pool[0].highlight, true);

  TaskOps.setPoolHighlight(data, id, false);
  h.assertEqual(data.pool[0].highlight, undefined);
});

t('setPoolHighlight：池内顶层块（标块头）', function () {
  var data = Store.createEmpty();
  var id = TaskOps.addPoolBlock(data, '池内块').block.id;

  h.assertTrue(TaskOps.setPoolHighlight(data, id, true).ok);
  h.assertEqual(data.pool[0].highlight, true);
});

t('setPoolHighlight：池内块里那条任务，只标它自己', function () {
  var data = Store.createEmpty();
  var blockId = TaskOps.addPoolBlock(data, '池内块').block.id;
  var childId = TaskOps.addPoolBlockTask(data, DATE, blockId, '块内任务').task.id;

  h.assertTrue(TaskOps.setPoolHighlight(data, childId, true).ok);
  h.assertEqual(data.pool[0].tasks[0].highlight, true);
  h.assertEqual(data.pool[0].highlight, undefined, '宿主块不该被顺带标上');
});

t('setPoolHighlight 找不到 / id 不合法 → NOT_FOUND', function () {
  var data = Store.createEmpty();
  TaskOps.addPoolItem(data, DATE, '池任务');

  h.assertEqual(TaskOps.setPoolHighlight(data, 'no-such', true).error,
    TaskOps.ERR.NOT_FOUND);
  h.assertEqual(TaskOps.setPoolHighlight(data, null, true).error,
    TaskOps.ERR.NOT_FOUND);
  h.assertEqual(TaskOps.setPoolHighlight(data, '', true).error,
    TaskOps.ERR.NOT_FOUND);
});

// ---------------------------------------------------------------------------
h.group('store.normalize：可选字段的兼容规矩');

t('normalize 保任务 / 阶段 / 块的 highlight:true', function () {
  var out = Store.normalize({
    dates: {
      '2026-10-01': {
        I: [
          { id: 'a', text: '带阶段', highlight: true,
            stages: [{ id: 's', text: '阶段', completed: false, highlight: true }] },
          { id: 'b', type: 'block', text: '块', highlight: true,
            tasks: [{ id: 'c', text: '块内任务', completed: false }] }
        ],
        II: [], III: [], IV: []
      }
    }
  }).data;

  var list = out.dates['2026-10-01'].I;
  h.assertEqual(list[0].highlight, true);
  h.assertEqual(list[0].stages[0].highlight, true);
  h.assertEqual(list[1].highlight, true);
  h.assertEqual(list[1].tasks[0].highlight, undefined, '块内任务不跟着块走');
});

t('normalize 丢掉非 true 的值：false / "yes" / 1 / null 都当没高亮', function () {
  var values = [false, 'yes', 1, 0, null, {}, []];
  for (var i = 0; i < values.length; i++) {
    var out = Store.normalize({
      dates: {
        '2026-10-01': {
          I: [{ id: 'a', text: '任务', highlight: values[i] }],
          II: [], III: [], IV: []
        }
      }
    });
    h.assertEqual(out.data.dates['2026-10-01'].I[0].highlight, undefined,
      '值 ' + JSON.stringify(values[i]) + ' 不该被收下');
  }
});

t('老数据（没有 highlight 字段）读进来不留空字段', function () {
  var out = Store.normalize({
    dates: {
      '2026-10-01': {
        I: [{ id: 'a', text: '老任务' }],
        II: [], III: [], IV: []
      }
    }
  });
  h.assertFalse('highlight' in out.data.dates['2026-10-01'].I[0]);
});

t('序列化再过一遍 normalize：高亮不丢', function () {
  var data = Store.createEmpty();
  var id = TaskOps.addTask(data, DATE, 'I', '写周报').task.id;
  TaskOps.setHighlight(data, DATE, 'I', id, true);

  var again = Store.normalize(JSON.parse(Store.serialize(data))).data;
  h.assertEqual(again.dates[DATE].I[0].highlight, true);
});

t('模板里的条目也保 highlight', function () {
  var data = Store.createEmpty();
  var id = TaskOps.addTask(data, DATE, 'I', '写周报').task.id;
  TaskOps.setHighlight(data, DATE, 'I', id, true);
  TaskOps.saveDayAsTemplate(data, DATE);

  var again = Store.normalize(JSON.parse(Store.serialize(data))).data;
  h.assertEqual(again.templates[0].items.I[0].highlight, true);
});

// ---------------------------------------------------------------------------
h.group('导入导出：highlight 跟着走、老板份照常');

t('导出再导入：任务 / 阶段 / 块的 highlight 都不丢', function () {
  var data = Store.createEmpty();
  var a = TaskOps.addTask(data, DATE, 'I', '写周报').task.id;
  TaskOps.setHighlight(data, DATE, 'I', a, true);

  var b = TaskOps.addTask(data, DATE, 'I', '写报告').task.id;
  var s1 = TaskOps.addStage(data, DATE, 'I', b, '收集数据').stage.id;
  TaskOps.setStageHighlight(data, DATE, 'I', b, s1, true);

  var blockId = TaskOps.addBlock(data, DATE, 'I', '一个块').block.id;
  TaskOps.setBlockHighlight(data, DATE, 'I', blockId, true);

  var r = Importer.importText(Store.createEmpty(), Store.serialize(data));

  h.assertTrue(r.ok);
  var list = r.data.dates[DATE].I;
  h.assertTrue(list.some(function (it) { return it.text === '写周报' && it.highlight === true; }),
    '任务高亮保留');
  h.assertTrue(list.some(function (it) {
    return it.text === '写报告' && it.stages && it.stages[0].highlight === true;
  }), '阶段高亮保留');
  h.assertTrue(list.some(function (it) {
    return it.type === 'block' && it.text === '一个块' && it.highlight === true;
  }), '块高亮保留');
});

t('旧文件没有这个字段：照常导入，不拒整份', function () {
  var data = Store.createEmpty();
  var r = Importer.importText(data, JSON.stringify({
    dates: { '2026-10-01': { I: [{ text: '老任务' }], II: [], III: [], IV: [] } }
  }));

  h.assertTrue(r.ok);
  h.assertEqual(r.data.dates['2026-10-01'].I[0].highlight, undefined);
});

t('文件里写了脏值（false / "yes"）当没高亮收下，不拒整份', function () {
  var data = Store.createEmpty();
  var r = Importer.importText(data, JSON.stringify({
    dates: {
      '2026-10-01': {
        I: [{ text: '甲', highlight: false }, { text: '乙', highlight: 'yes' }],
        II: [], III: [], IV: []
      }
    }
  }));

  h.assertTrue(r.ok);
  h.assertEqual(r.data.dates['2026-10-01'].I[0].highlight, undefined);
  h.assertEqual(r.data.dates['2026-10-01'].I[1].highlight, undefined);
});

t('覆盖导入也带着高亮', function () {
  var src = Store.createEmpty();
  var id = TaskOps.addTask(src, DATE, 'I', '写周报').task.id;
  TaskOps.setHighlight(src, DATE, 'I', id, true);

  var local = Store.createEmpty();
  TaskOps.addTask(local, DATE, 'II', '本地任务');

  // overwrite 的返回形状和 merge 一样（{ added, skipped, data }），没有 ok
  var r = Importer.overwrite(local, Importer.validate(Store.serialize(src)).data);

  h.assertEqual(r.data.dates[DATE].I[0].highlight, true);
});

t('池内条目导入带高亮', function () {
  var src = Store.createEmpty();
  var id = TaskOps.addPoolItem(src, DATE, '池任务').task.id;
  TaskOps.setPoolHighlight(src, id, true);

  var r = Importer.importText(Store.createEmpty(), Store.serialize(src));
  h.assertTrue(r.ok);
  h.assertEqual(r.data.pool[0].highlight, true);
});

// ---------------------------------------------------------------------------
h.group('渲染：类名挂在该挂的地方');

t('buildTaskHtml：高亮的任务带 task--highlight', function () {
  var data = Store.createEmpty();
  var id = TaskOps.addTask(data, DATE, 'I', '重点任务').task.id;
  TaskOps.setHighlight(data, DATE, 'I', id, true);

  var html = Render.buildTaskHtml(data.dates[DATE].I[0], VIEW);
  h.assertTrue(html.indexOf(' task--highlight"') !== -1);
});

t('buildTaskHtml：没高亮就不带这个类', function () {
  var data = Store.createEmpty();
  TaskOps.addTask(data, DATE, 'I', '普通任务');

  var html = Render.buildTaskHtml(data.dates[DATE].I[0], VIEW);
  h.assertFalse(html.indexOf('task--highlight') !== -1);
});

t('已完成 + 高亮：两个类都在（「完成后失效」交给 CSS 判断，见下）', function () {
  var data = Store.createEmpty();
  var id = TaskOps.addTask(data, DATE, 'I', '做完了').task.id;
  TaskOps.toggleTask(data, DATE, 'I', id, true);
  TaskOps.setHighlight(data, DATE, 'I', id, true);

  var html = Render.buildTaskHtml(data.dates[DATE].I[0], VIEW);
  h.assertTrue(html.indexOf('task--done') !== -1);
  h.assertTrue(html.indexOf('task--highlight') !== -1, '数据还在，只是画不画由 CSS 定');
});

t('buildStageHtml：高亮的阶段带 stage--highlight', function () {
  var stage = { id: 's1', text: '收集数据', completed: false, createdAt: 0, highlight: true };
  h.assertTrue(Render.buildStageHtml(stage, false).indexOf(' stage--highlight"') !== -1);

  stage.highlight = false;
  h.assertFalse(Render.buildStageHtml(stage, false).indexOf('stage--highlight') !== -1);
});

t('buildStageHtml：编辑态不挂高亮类（类名列表一个字不变）', function () {
  var stage = { id: 's1', text: '收集数据', completed: false, createdAt: 0, highlight: true };
  var html = Render.buildStageHtml(stage, true);
  h.assertTrue(html.indexOf('class="stage stage--editing"') !== -1);
});

t('buildBlockHtml：高亮的块带 block--highlight', function () {
  var block = { id: 'b1', type: 'block', text: '一个块', completed: false,
                createdAt: 0, tasks: [], highlight: true };
  h.assertTrue(Render.buildBlockHtml(block, VIEW).indexOf(' block--highlight"') !== -1);

  block.highlight = false;
  h.assertFalse(Render.buildBlockHtml(block, VIEW).indexOf('block--highlight') !== -1);
});

t('buildPoolItemHtml / buildPoolBlockHtml：池内也认', function () {
  var data = Store.createEmpty();
  var id = TaskOps.addPoolItem(data, DATE, '池任务').task.id;
  TaskOps.setPoolHighlight(data, id, true);
  h.assertTrue(Render.buildPoolItemHtml(data.pool[0], null)
    .indexOf(' pool__item--highlight"') !== -1);

  data = Store.createEmpty();
  var blockId = TaskOps.addPoolBlock(data, '池内块').block.id;
  TaskOps.setPoolHighlight(data, blockId, true);
  h.assertTrue(Render.buildPoolBlockHtml(data.pool[0], VIEW)
    .indexOf(' pool__block--highlight"') !== -1);
});

t('时间视图：任务条目和阶段条目都带高亮', function () {
  var data = Store.createEmpty();
  var a = TaskOps.addTask(data, DATE, 'I', '无阶段任务').task.id;
  TaskOps.setSlot(data, DATE, 'I', a, '早上');
  TaskOps.setHighlight(data, DATE, 'I', a, true);

  var b = TaskOps.addTask(data, DATE, 'II', '带阶段任务').task.id;
  var s1 = TaskOps.addStage(data, DATE, 'II', b, '收集数据').stage.id;
  TaskOps.setStageSlot(data, DATE, 'II', b, s1, '晚上');
  TaskOps.setStageHighlight(data, DATE, 'II', b, s1, true);

  var html = Render.buildTimeViewHtml(TaskOps.getTimeView(data, DATE), VIEW);
  h.assertEqual((html.match(/task--highlight/g) || []).length, 1);
  h.assertEqual((html.match(/stage--highlight/g) || []).length, 1);
});

t('高亮不改转义：文本里的尖括号照旧被转义', function () {
  var data = Store.createEmpty();
  var id = TaskOps.addTask(data, DATE, 'I', '<img src=x onerror=1>').task.id;
  TaskOps.setHighlight(data, DATE, 'I', id, true);

  var html = Render.buildTaskHtml(data.dates[DATE].I[0], VIEW);
  h.assertFalse(html.indexOf('<img') !== -1);
  h.assertTrue(html.indexOf('task--highlight') !== -1);
});

// ---------------------------------------------------------------------------
h.group('数据流转：别的地方也别把它弄丢');

t('filterDayByKeyword 的块副本带着 highlight', function () {
  var data = Store.createEmpty();
  var blockId = TaskOps.addBlock(data, DATE, 'I', '一个块').block.id;
  TaskOps.setBlockHighlight(data, DATE, 'I', blockId, true);
  var taskId = TaskOps.addTask(data, DATE, 'I', '块内任务').task.id;
  TaskOps.moveTaskIntoBlock(data, DATE, taskId, blockId, 0);

  // 块名不中、块内任务中 → 走「只留命中子任务的块副本」那条路
  var day = TaskOps.filterDayByKeyword(data.dates[DATE], '块内');
  h.assertEqual(day.I.length, 1);
  h.assertEqual(day.I[0].type, 'block');
  h.assertEqual(day.I[0].highlight, true, '副本是逐字段挑的，别漏了它');
});

t('getTimeView 的条目带着 highlight（任务和阶段各一条）', function () {
  var data = Store.createEmpty();
  var a = TaskOps.addTask(data, DATE, 'I', '无阶段任务').task.id;
  TaskOps.setSlot(data, DATE, 'I', a, '早上');
  TaskOps.setHighlight(data, DATE, 'I', a, true);

  var groups = TaskOps.getTimeView(data, DATE);
  h.assertEqual(groups[0].items[0].highlight, true);

  var b = TaskOps.addTask(data, DATE, 'II', '带阶段任务').task.id;
  var s1 = TaskOps.addStage(data, DATE, 'II', b, '收集数据').stage.id;
  TaskOps.setStageSlot(data, DATE, 'II', b, s1, '早上');
  TaskOps.setStageHighlight(data, DATE, 'II', b, s1, true);

  groups = TaskOps.getTimeView(data, DATE);
  h.assertEqual(groups[0].items.length, 2);
  h.assertEqual(groups[0].items[1].highlight, true);
});

t('applyTemplate：任务 / 阶段 / 块的高亮都照搬（模板是副本，高亮属于「长什么样」）', function () {
  var data = Store.createEmpty();
  var a = TaskOps.addTask(data, DATE, 'I', '写周报').task.id;
  TaskOps.setHighlight(data, DATE, 'I', a, true);
  var b = TaskOps.addTask(data, DATE, 'I', '写报告').task.id;
  var s1 = TaskOps.addStage(data, DATE, 'I', b, '收集数据').stage.id;
  TaskOps.setStageHighlight(data, DATE, 'I', b, s1, true);
  var blockId = TaskOps.addBlock(data, DATE, 'I', '一个块').block.id;
  TaskOps.setBlockHighlight(data, DATE, 'I', blockId, true);

  // 模板存在哪份数据里，就得对着哪份数据应用（applyTemplate 是在传入的
  // data.templates 里找模板的），所以拿同一份数据、换一个日期应用
  var tpl = TaskOps.saveDayAsTemplate(data, DATE).template;
  var TARGET = '2026-11-11';
  h.assertTrue(TaskOps.applyTemplate(data, TARGET, tpl.id).ok);

  var list = data.dates[TARGET].I;
  h.assertTrue(list.some(function (it) { return it.text === '写周报' && it.highlight === true; }));
  h.assertTrue(list.some(function (it) {
    return it.text === '写报告' && it.stages && it.stages[0].highlight === true;
  }));
  h.assertTrue(list.some(function (it) {
    return it.type === 'block' && it.highlight === true;
  }));
  h.assertEqual(list.filter(function (it) { return it.highlight === true; }).length, 2,
    '只有两条顶层带高亮（第二个块的副本没在里面）');
});

t('推迟任务：同一个对象搬进池，高亮跟着走', function () {
  var data = Store.createEmpty();
  var id = TaskOps.addTask(data, DATE, 'I', '写周报').task.id;
  TaskOps.setHighlight(data, DATE, 'I', id, true);

  h.assertTrue(TaskOps.postponeTask(data, DATE, 'I', id).ok);
  h.assertEqual(data.pool[0].highlight, true);
});

t('推迟任务块：块头的高亮跟着走', function () {
  var data = Store.createEmpty();
  var blockId = TaskOps.addBlock(data, DATE, 'I', '一个块').block.id;
  TaskOps.setBlockHighlight(data, DATE, 'I', blockId, true);

  h.assertTrue(TaskOps.postponeBlock(data, DATE, 'I', blockId).ok);
  h.assertEqual(data.pool[0].highlight, true);
});

t('推迟阶段：池内新任务接着标黄', function () {
  var data = Store.createEmpty();
  var taskId = TaskOps.addTask(data, DATE, 'I', '写报告').task.id;
  var s1 = TaskOps.addStage(data, DATE, 'I', taskId, '收集数据').stage.id;
  TaskOps.setStageHighlight(data, DATE, 'I', taskId, s1, true);

  h.assertTrue(TaskOps.postponeStage(data, DATE, 'I', taskId, s1).ok);
  h.assertEqual(data.pool[0].highlight, true);
});

t('从池里导入回象限：高亮接着走', function () {
  var data = Store.createEmpty();
  var id = TaskOps.addTask(data, DATE, 'I', '写周报').task.id;
  TaskOps.setHighlight(data, DATE, 'I', id, true);
  TaskOps.postponeTask(data, DATE, 'I', id);

  TaskOps.restoreFromPool(data, '2026-10-02', 'II', data.pool[0].id);
  h.assertEqual(data.dates['2026-10-02'].II[0].highlight, true);
});

// ---------------------------------------------------------------------------
h.group('CSS 守卫：浅橙色、盖满字高、完成后失效');

var css = fs.readFileSync(path.join(__dirname, '..', 'css', 'style.css'), 'utf8');

/** 取出 :root { ... } 里某个变量的值 */
function varValue(name) {
  var m = css.match(new RegExp('--' + name + '\\s*:\\s*([^;]+);'));
  return m ? m[1].trim() : null;
}

/** #rrggbb → [r, g, b] */
function hexToRgb(hex) {
  var m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return null;
  var n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** 相对亮度（WCAG 2.x） */
function luminance(rgb) {
  var c = rgb.map(function (v) {
    var s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

t('--hl-bg 是个浅橙（红 > 绿 > 蓝，且够浅）', function () {
  var hex = varValue('hl-bg');
  h.assertTrue(!!hex, '--hl-bg 没定义');
  var rgb = hexToRgb(hex);
  h.assertTrue(!!rgb, '--hl-bg 不是 #rrggbb：' + hex);
  h.assertTrue(rgb[0] > rgb[1] && rgb[1] > rgb[2],
    '浅橙要求红 > 绿 > 蓝，实际 ' + hex);
  h.assertTrue(luminance(rgb) > 0.5, '底色要够浅，实际亮度 ' + luminance(rgb).toFixed(3));
});

t('高亮文字用定死的深色，两种主题都看得清（对比度 > 4.5）', function () {
  var text = hexToRgb(varValue('hl-text'));
  h.assertTrue(!!text, '--hl-text 没定义或不是 #rrggbb');
  h.assertTrue(luminance(text) < 0.5, '高亮文字该是深色');

  var bg = luminance(hexToRgb(varValue('hl-bg')));
  var fg = luminance(text);
  var ratio = (Math.max(bg, fg) + 0.05) / (Math.min(bg, fg) + 0.05);
  h.assertTrue(ratio > 4.5, '对比度只有 ' + ratio.toFixed(2));

  // 暗色主题**不覆盖**这两个变量是有意的：底色是浅的，暗色主题下 --text 是浅灰，
  // 压在浅橙上根本看不清（FS 验收：「暗色模式下文字清晰可读」）
  var dark = css.match(/\[data-theme="dark"\]\s*\{([\s\S]*?)\}/);
  h.assertTrue(!!dark, '找不到暗色主题块');
  h.assertFalse(/--hl-/.test(dark[1]), '暗色主题不该改高亮配色');
});

t('五条高亮规则都在，且都画在**文字**那一层，不是整行', function () {
  var pairs = [
    ['.task--highlight:not(.task--done) .task__text'],
    ['.stage--highlight:not(.stage--done) .stage__text'],
    ['.block--highlight:not(.block--done) .block__name'],
    ['.pool__item--highlight:not(.pool__item--done) .pool__text'],
    ['.pool__block--highlight:not(.pool__block--done) .pool__block-name']
  ];
  for (var i = 0; i < pairs.length; i++) {
    h.assertTrue(css.indexOf(pairs[i][0]) !== -1, '少了选择器 ' + pairs[i][0]);
  }
  // 整行 li 上不该直接上色（否则底色会漫成一条色带，盖不出「字高」的样子）
  h.assertFalse(/\.task--highlight\s*\{/.test(css));
  h.assertFalse(/\.pool__block--highlight\s*\{/.test(css));
});

t('底色用 var(--hl-bg)，且用等量负 margin 抵消 padding（加高亮不挪位置）', function () {
  var block = css.match(/\.task--highlight[\s\S]*?\n\}/);
  h.assertTrue(!!block, '找不到高亮规则块');
  h.assertTrue(block[0].indexOf('background: var(--hl-bg)') !== -1);
  h.assertTrue(block[0].indexOf('padding: 0 3px') !== -1);
  h.assertTrue(block[0].indexOf('margin: 0 -3px') !== -1);
});

// ---------------------------------------------------------------------------
h.group('app.js 源码守卫：连续双击的手势（Node 里没有 DOM）');

var app = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');

/** 截出一段函数体（从 function 名到下一个顶格缩进的 } 为止） */
function bodyOf(name) {
  var start = app.indexOf('function ' + name + '(');
  if (start === -1) return '';
  var end = app.indexOf('\n  }', start);
  return end === -1 ? app.slice(start) : app.slice(start, end);
}

t('三处点击分流都在最前面认 e.detail >= 2（象限 / 时间视图 / 计划池）', function () {
  var hits = app.match(/if \(e\.detail >= 2\) \{\s*\n\s*handleSecondClick\(\);/g) || [];
  h.assertEqual(hits.length, 3, '应该正好三处');
});

t('三处各自把「点到了哪一条」记进 state.clickHit（都过 rememberHit 打时间戳）', function () {
  h.assertTrue(app.indexOf('state.clickHit = rememberHit(hitOfQuadrant(target));') !== -1);
  h.assertTrue(app.indexOf('state.clickHit = rememberHit(hitOfTimeView(target));') !== -1);
  h.assertTrue(app.indexOf('state.clickHit = rememberHit(hitOfPool(target));') !== -1);
  h.assertTrue(bodyOf('rememberHit').indexOf('hit.at = Date.now();') !== -1);
});

t('第二下取用完就丢弃：一次连击只翻一次（三下连点不会翻来翻去）', function () {
  var body = bodyOf('handleSecondClick');
  h.assertTrue(body.indexOf('state.clickHit = null;') !== -1);
  h.assertTrue(body.indexOf('doToggleHighlight(hit);') !== -1);
});

t('太旧的记录不敢用：拖拽吃掉一下之后不会标错一条', function () {
  var body = bodyOf('handleSecondClick');
  h.assertTrue(body.indexOf('Date.now() - hit.at > DOUBLE_CLICK_MAX_MS') !== -1);
  h.assertTrue(/DOUBLE_CLICK_MAX_MS = \d+/.test(app), '上限要是个明确的数字');
});

t('判断顺序从里往外：阶段 → 任务 → 块（块在后面，否则块内任务会被当成整块）', function () {
  var body = bodyOf('hitOfQuadrant');
  var iStage = body.indexOf('stageIdOf');
  var iTask = body.indexOf('taskIdOf');
  var iBlock = body.indexOf('blockIdOf');
  h.assertTrue(iStage !== -1 && iTask !== -1 && iBlock !== -1);
  h.assertTrue(iStage < iTask, '阶段要在任务前面');
  h.assertTrue(iTask < iBlock, '任务要在块前面');

  var pool = bodyOf('hitOfPool');
  h.assertTrue(pool.indexOf('poolItemIdOf') < pool.indexOf('poolBlockIdOf'),
    '池里条目也要排在块前面');
});

t('双击落在输入框 / 勾选框 / 按钮 / 下拉上不算高亮', function () {
  var body = bodyOf('isControlNode');
  h.assertTrue(body.indexOf("tag === 'INPUT'") !== -1);
  h.assertTrue(body.indexOf("tag === 'TEXTAREA'") !== -1);
  h.assertTrue(body.indexOf("tag === 'SELECT'") !== -1);
  h.assertTrue(body.indexOf("tag === 'BUTTON'") !== -1);
  // 三处入口都要先过这一道
  var used = app.match(/isControlNode\(target\)/g) || [];
  h.assertEqual(used.length, 3);
});

t('保护模式下双击不改数据', function () {
  var body = bodyOf('doToggleHighlight');
  h.assertTrue(body.indexOf('Store.isProtectionMode()') !== -1);
  h.assertTrue(app.indexOf('if (Store.isProtectionMode()) return;') !== -1);
});

t('双击先提交编辑框：第一下开出来的编辑态不能杵在那儿', function () {
  var body = bodyOf('doToggleHighlight');
  h.assertTrue(body.indexOf('commitEdit();') !== -1);
});

t('高亮走 task-ops 的四个 set 函数，翻的是数据不是界面状态', function () {
  var body = bodyOf('doToggleHighlight');
  h.assertTrue(body.indexOf('TaskOps.setPoolHighlight(state.data') !== -1);
  h.assertTrue(body.indexOf('TaskOps.setStageHighlight(state.data') !== -1);
  h.assertTrue(body.indexOf('TaskOps.setBlockHighlight(state.data') !== -1);
  h.assertTrue(body.indexOf('TaskOps.setHighlight(state.data') !== -1);
  h.assertTrue(body.indexOf('persist();') !== -1, '翻完要落盘');
  h.assertTrue(body.indexOf('renderCurrent();') !== -1, '翻完要重画');
});

t('state.clickHit 是界面状态，不进用户数据', function () {
  // 记在 app.js 的 state 里（初值 null），不进 store 的任何一条读写路径 ——
  // 它只是「刚才那一下点到了谁」，跟着导出备份跑没有意义（和 expanded 同档）
  h.assertTrue(app.indexOf('clickHit: null') !== -1);
  var store = fs.readFileSync(path.join(__dirname, '..', 'js', 'store.js'), 'utf8');
  h.assertFalse(store.indexOf('clickHit') !== -1, 'store 不该知道这个字段');
});

// ---------------------------------------------------------------------------

h.summary('高亮（连续双击 → 浅橙底色）');
