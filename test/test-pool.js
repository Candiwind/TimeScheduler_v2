/**
 * test-pool.js
 *
 * 计划池的一期闭环（见 DS 2.11）：**进得来、回得去、删得掉**。
 *
 * 最要紧的三件事：
 *   1. 推迟不是删除 —— 文字、完成状态、阶段必须一条不丢地进池；
 *   2. 池不计入统计 —— getStats 只扫 dates，数字一个都不能变；
 *   3. 老数据没有 pool 字段 —— 读入补空数组，老备份照常用。
 *
 * 跑法：node test/test-pool.js
 */
'use strict';

var h = require('./harness');
var Store = require('../js/store');
var TaskOps = require('../js/task-ops');
var Importer = require('../js/importer');
var Render = require('../js/render');

var t = h.test;
var DATE = '2026-10-01';

/** 造一份带 n 条顶层任务的空数据，返回 { data, ids } */
function seed(quadrantTexts) {
  var data = Store.createEmpty();
  var ids = [];
  var texts = quadrantTexts || ['甲', '乙', '丙'];
  // addTask 默认把新任务加在开头（需求 3），倒着加才能让最终顺序和 texts 一致
  for (var i = texts.length - 1; i >= 0; i--) {
    ids.unshift(TaskOps.addTask(data, DATE, 'I', texts[i]).task.id);
  }
  return { data: data, ids: ids };
}

function poolTexts(data) {
  var out = [];
  var pool = Array.isArray(data.pool) ? data.pool : [];
  for (var i = 0; i < pool.length; i++) out.push(pool[i].text);
  return out.join(',');
}

function quadrantTexts(data, qid) {
  var list = data.dates[DATE] ? data.dates[DATE][qid] : [];
  var out = [];
  for (var i = 0; i < list.length; i++) out.push(list[i].text);
  return out.join(',');
}

// ---------------------------------------------------------------------------
h.group('推迟进池：内容全带走，原象限里消失');

t('推迟后任务从象限消失、出现在池末尾', function () {
  var s = seed();
  var result = TaskOps.postponeTask(s.data, DATE, 'I', s.ids[1]);

  h.assertTrue(result.ok);
  h.assertEqual(quadrantTexts(s.data, 'I'), '甲,丙', '象限里没了');
  h.assertEqual(poolTexts(s.data), '乙', '池里有了');
  h.assertEqual(s.data.pool[0].id, s.ids[1], '就是同一条任务，不是复制品');
});

t('连续推迟的按顺序压进池末尾', function () {
  var s = seed();
  TaskOps.postponeTask(s.data, DATE, 'I', s.ids[0]);
  TaskOps.postponeTask(s.data, DATE, 'I', s.ids[2]);

  h.assertEqual(poolTexts(s.data), '甲,丙', '先进池的在前');
});

t('推迟已完成的任务，完成状态保留（不重置）', function () {
  var s = seed(['甲']);
  TaskOps.toggleTask(s.data, DATE, 'I', s.ids[0], true);

  TaskOps.postponeTask(s.data, DATE, 'I', s.ids[0]);

  h.assertEqual(s.data.pool[0].completed, true, '进池前的勾选不能丢');
});

t('推迟带阶段的任务，阶段跟着进池', function () {
  var s = seed(['写季度报告']);
  TaskOps.addStage(s.data, DATE, 'I', s.ids[0], '收集数据');
  TaskOps.addStage(s.data, DATE, 'I', s.ids[0], '写初稿');

  TaskOps.postponeTask(s.data, DATE, 'I', s.ids[0]);

  var pooled = s.data.pool[0];
  h.assertEqual(pooled.stages.length, 2, '两条阶段都进来');
  h.assertEqual(pooled.stages[0].text, '收集数据');
  h.assertEqual(pooled.stages[1].text, '写初稿');
});

t('把这一天最后一条任务推迟走，空掉的整天要收掉', function () {
  var s = seed(['唯一的一条']);
  TaskOps.postponeTask(s.data, DATE, 'I', s.ids[0]);

  h.assertEqual(s.data.dates[DATE], undefined,
    '一天四象限全空了就别留个空壳占地方（和删除同一条规矩）');
});

t('数据层的推迟不禁止块内任务（界面才限制顶层入口）', function () {
  var data = Store.createEmpty();
  var block = TaskOps.addBlock(data, DATE, 'I', '晨间例程').block;
  var c1 = { id: 'c1', text: '喝水', completed: true, createdAt: 1 };
  var c2 = { id: 'c2', text: '锻炼', completed: false, createdAt: 1 };
  block.tasks.push(c1, c2);

  var result = TaskOps.postponeTask(data, DATE, 'I', 'c2');

  h.assertTrue(result.ok);
  h.assertEqual(block.tasks.length, 1, '块里只剩没推迟的');
  h.assertEqual(block.completed, true, '剩下的全完成了，宿主块跟着翻成完成（规矩 2）');
  h.assertEqual(poolTexts(data), '锻炼');
});

t('推迟不存在的任务 → NOT_FOUND', function () {
  var s = seed();
  h.assertFalse(TaskOps.postponeTask(s.data, DATE, 'I', '不存在的').ok);
  h.assertEqual(poolTexts(s.data), '', '池不该被凭空塞进东西');
});

// ---------------------------------------------------------------------------
h.group('拖回象限：内容一条不丢');

t('不带位置时放回象限末尾', function () {
  var s = seed();
  TaskOps.postponeTask(s.data, DATE, 'I', s.ids[1]);

  var result = TaskOps.restoreFromPool(s.data, DATE, 'II', s.ids[1]);

  h.assertTrue(result.ok);
  h.assertEqual(quadrantTexts(s.data, 'II'), '乙', '落在目标象限末尾');
  h.assertEqual(poolTexts(s.data), '', '池里出去了就没了');
});

t('带位置时按占位符承诺的位置插', function () {
  var s = seed();
  TaskOps.postponeTask(s.data, DATE, 'I', s.ids[0]);

  // 拖到 II 象限已有的甲、乙之间 → toIndex 1（新任务默认加在开头，倒着加）
  TaskOps.addTask(s.data, DATE, 'II', '乙二');
  TaskOps.addTask(s.data, DATE, 'II', '甲二');
  TaskOps.restoreFromPool(s.data, DATE, 'II', s.ids[0], 1);

  h.assertEqual(quadrantTexts(s.data, 'II'), '甲二,甲,乙二');
});

t('toIndex 越界会夹紧到末尾', function () {
  var s = seed(['甲']);
  TaskOps.postponeTask(s.data, DATE, 'I', s.ids[0]);

  TaskOps.restoreFromPool(s.data, DATE, 'II', s.ids[0], 99);

  h.assertEqual(quadrantTexts(s.data, 'II'), '甲');
});

t('拖回时阶段和完成状态原样带回', function () {
  var s = seed(['写季度报告']);
  TaskOps.addStage(s.data, DATE, 'I', s.ids[0], '收集数据');
  TaskOps.postponeTask(s.data, DATE, 'I', s.ids[0]);

  TaskOps.restoreFromPool(s.data, DATE, 'III', s.ids[0]);

  var back = s.data.dates[DATE].III[0];
  h.assertEqual(back.id, s.ids[0], '还是同一条，编号不变');
  h.assertEqual(back.stages.length, 1, '阶段跟着回去');
  h.assertEqual(back.stages[0].text, '收集数据');
});

t('本地没有那一天的条目时，拖回会把这一天建出来', function () {
  var s = seed();
  TaskOps.postponeTask(s.data, DATE, 'I', s.ids[0]);   // 整天被收掉了

  TaskOps.restoreFromPool(s.data, '2026-10-02', 'IV', s.ids[0]);

  h.assertEqual(s.data.dates['2026-10-02'].IV[0].text, '甲');
});

t('同一条拖回两次，第二次失败', function () {
  var s = seed(['甲']);
  TaskOps.postponeTask(s.data, DATE, 'I', s.ids[0]);
  TaskOps.restoreFromPool(s.data, DATE, 'II', s.ids[0]);

  h.assertFalse(TaskOps.restoreFromPool(s.data, DATE, 'III', s.ids[0]).ok,
    '已经不在池里了，不能再拖一次');
  h.assertEqual(quadrantTexts(s.data, 'III'), '', 'II 里那条不能被复制走');
});

// ---------------------------------------------------------------------------
h.group('池内删除与改文字');

t('从池里删除一条', function () {
  var s = seed();
  TaskOps.postponeTask(s.data, DATE, 'I', s.ids[0]);
  TaskOps.postponeTask(s.data, DATE, 'I', s.ids[1]);

  var result = TaskOps.removePoolItem(s.data, s.ids[0]);

  h.assertTrue(result.ok);
  h.assertEqual(poolTexts(s.data), '乙', '删的是指定的那条');
});

t('删除池里不存在的 → NOT_FOUND', function () {
  h.assertFalse(TaskOps.removePoolItem(Store.createEmpty(), '没有的').ok);
});

t('改池内任务的文字', function () {
  var s = seed(['旧名字']);
  TaskOps.postponeTask(s.data, DATE, 'I', s.ids[0]);

  var result = TaskOps.editPoolItem(s.data, s.ids[0], '新名字');

  h.assertTrue(result.ok);
  h.assertEqual(s.data.pool[0].text, '新名字');
});

t('改空拒绝、原文保留（和 D-31 同一条规矩）', function () {
  var s = seed(['旧名字']);
  TaskOps.postponeTask(s.data, DATE, 'I', s.ids[0]);

  var result = TaskOps.editPoolItem(s.data, s.ids[0], '   ');

  h.assertFalse(result.ok);
  h.assertEqual(result.error, TaskOps.ERR.EMPTY_TEXT);
  h.assertEqual(s.data.pool[0].text, '旧名字');
});

// ---------------------------------------------------------------------------
h.group('池不计统计、归档不动池');

t('推迟走的任务不再计入当天统计（留在象限里才数）', function () {
  var s = seed(['甲', '乙']);
  TaskOps.toggleTask(s.data, DATE, 'I', s.ids[0], true);   // 甲完成
  var before = TaskOps.getStats(s.data, DATE);
  h.assertEqual(before.total, 2);
  h.assertEqual(before.done, 1);

  TaskOps.postponeTask(s.data, DATE, 'I', s.ids[1]);        // 推迟未完成的乙
  var after = TaskOps.getStats(s.data, DATE);

  h.assertEqual(after.total, 1, '推迟走的不再计入总数 —— 池不是任何一个象限');
  h.assertEqual(after.done, 1, '完成数没变');
  h.assertEqual(after.rate, 1, '剩下的一条全完成，完成率 100%');
});

t('30 天归档只收缩 dates，pool 原样带走', function () {
  var s = seed(['要留着的']);
  TaskOps.addTask(s.data, '2026-01-01', 'I', '老任务');  // 会被归档的老日期
  TaskOps.postponeTask(s.data, DATE, 'I', s.ids[0]);     // 推迟走一条进池

  var plan = Store.planArchive(s.data, new Date(2026, 9, 1));
  var next = Store.applyArchive(s.data, plan);

  h.assertTrue(plan.archivedCount >= 1, '老日期被划进归档');
  h.assertEqual(next.dates['2026-01-01'], undefined, '归档的日期从本地移除');
  h.assertEqual(next.pool.length, 1, '池不在归档范围里，一条不动');
  h.assertEqual(next.pool[0].text, '要留着的');
});

// ---------------------------------------------------------------------------
h.group('normalize 兼容：老数据没有 pool 字段');

t('没有 pool 的老数据读进来补一个空数组', function () {
  var result = Store.parse(JSON.stringify({
    user: 'default', schemaVersion: 1,
    dates: { '2026-10-01': { I: [{ id: 'a', text: '老任务', completed: false, createdAt: 1 }], II: [], III: [], IV: [] } }
  }));

  h.assertTrue(Array.isArray(result.data.pool), 'pool 字段要补出来');
  h.assertEqual(result.data.pool.length, 0);
});

t('pool 不是数组 → 丢掉重来（空数组）', function () {
  var result = Store.parse(JSON.stringify({
    dates: {}, pool: '不是数组'
  }));

  h.assertTrue(Array.isArray(result.data.pool));
  h.assertEqual(result.data.pool.length, 0);
});

t('池里的脏任务被清洗掉，好的（含任务块）留着', function () {
  var result = Store.parse(JSON.stringify({
    dates: {},
    pool: [
      { id: 'ok1', text: '好的', completed: false, createdAt: 1 },
      { id: 'blk', type: 'block', text: '池里的块合法', completed: false, createdAt: 1, tasks: [] },
      { text: '   ' },
      '连对象都不是'
    ]
  }));

  // 需求 4：池里允许放任务块，所以块不再被洗掉；脏任务（空文本、非对象）照旧丢
  h.assertEqual(result.data.pool.length, 2);
  h.assertEqual(result.data.pool[0].text, '好的');
  h.assertEqual(result.data.pool[1].type, 'block');
  h.assertEqual(result.dropped, 2, '丢掉的都要计数');
});

t('池内任务的 completed 以阶段为准', function () {
  var result = Store.parse(JSON.stringify({
    dates: {},
    pool: [{
      id: 'p1', text: '写季度报告', completed: true, createdAt: 1,
      stages: [
        { text: '收集数据', completed: true },
        { text: '写初稿', completed: false }
      ]
    }]
  }));

  h.assertEqual(result.data.pool[0].completed, false,
    '阶段没勾完就不算完成（和象限里的任务同一条规矩）');
});

t('保存再读出来，池一条不丢', function () {
  Store.init({ storage: h.createMemoryStorage() });
  var s = seed(['相册整理']);
  TaskOps.postponeTask(s.data, DATE, 'I', s.ids[0]);

  h.assertTrue(Store.save(s.data).ok);
  var loaded = Store.load();

  h.assertEqual(loaded.status, 'ok');
  h.assertEqual(loaded.data.pool.length, 1);
  h.assertEqual(loaded.data.pool[0].text, '相册整理');
});

// ---------------------------------------------------------------------------
h.group('导出导入：池跟着文件走');

/** 带一个池的导入文件 */
function poolFile(pool) {
  return JSON.stringify({
    user: 'default', schemaVersion: 1,
    dates: { '2026-10-01': { I: [], II: [], III: [], IV: [] } },
    pool: pool
  });
}

t('JSON 导出原样带池，重新导入内容不丢', function () {
  var s = seed(['相册整理']);
  TaskOps.addStage(s.data, DATE, 'I', s.ids[0], '挑照片');
  TaskOps.postponeTask(s.data, DATE, 'I', s.ids[0]);

  // 导出 = 整份序列化（exporter.exportJson 走 Store.serialize）
  var text = Store.serialize(s.data);

  var other = Store.createEmpty();
  var result = Importer.importText(other, text);

  h.assertTrue(result.ok);
  h.assertEqual(result.added, 1, '池里的任务按一条计');
  h.assertEqual(other.pool.length, 1);
  h.assertEqual(other.pool[0].text, '相册整理');
  h.assertEqual(other.pool[0].stages.length, 1, '阶段跟着走');
  h.assertFalse(other.pool[0].id === s.ids[0], '编号要换新，两台设备可能撞车');
});

t('合并判重只按文本：池里已有的同名任务跳过', function () {
  var data = Store.createEmpty();
  data.pool.push({ id: 'local_1', text: '相册整理', completed: false, createdAt: 1 });

  var result = Importer.importText(data, poolFile([
    { text: '相册整理', completed: true },
    { text: '新任务' }
  ]));

  h.assertEqual(result.added, 1);
  h.assertEqual(result.skipped, 1);
  h.assertEqual(data.pool.length, 2);
  h.assertEqual(data.pool[0].completed, false, '跳过的不覆盖本地（和 D-16 同理）');
});

t('老文件没有 pool 字段照样导入，本地池不动', function () {
  var data = Store.createEmpty();
  data.pool.push({ id: 'local_1', text: '池里原有的', completed: false, createdAt: 1 });

  var result = Importer.importText(data, JSON.stringify({
    dates: { '2026-10-01': { I: [{ text: '普通任务' }], II: [], III: [], IV: [] } }
  }));

  h.assertTrue(result.ok, '加计划池之前导出的备份不能废掉');
  h.assertEqual(result.added, 1);
  h.assertEqual(data.pool.length, 1, '本地的池不该被动');
  h.assertEqual(data.pool[0].text, '池里原有的');
});

t('validate：文件里没有 pool 时给 null，不是空数组', function () {
  var result = Importer.validate('{"dates":{}}');

  h.assertTrue(result.ok);
  h.assertNull(result.data.pool);
});

t('pool 不是列表 → 整份拒绝', function () {
  var before = Store.createEmpty();
  var text = JSON.stringify({ dates: {}, pool: '不是列表' });

  var result = Importer.importText(before, text);

  h.assertFalse(result.ok);
  h.assertEqual(result.error, Importer.ERR.BAD_POOL);
});

t('池里放块合法（需求 4），放坏任务 → 整份拒绝，报错说清是第几条', function () {
  var goodBlock = Importer.validate(poolFile([
    { type: 'block', text: '块', completed: false, tasks: [] }
  ]));
  h.assertTrue(goodBlock.ok, '池里的任务块合法，不再拒绝');

  var badTask = Importer.validate(poolFile([
    { text: '好的' },
    { text: '' }
  ]));
  h.assertFalse(badTask.ok);
  h.assertTrue(badTask.message.indexOf('第 2 条') !== -1, '要说清是池里第几条');
});

t('一处不对整份拒绝时，本地数据一个字节不动', function () {
  var data = Store.createEmpty();
  TaskOps.addTask(data, DATE, 'I', '本地原有的');
  var before = JSON.stringify(data);

  Importer.importText(data, JSON.stringify({ dates: {}, pool: [{ text: '' }] }));

  h.assertEqual(JSON.stringify(data), before);
});

// ---------------------------------------------------------------------------
h.group('界面：推迟按钮给顶层任务和没阶段的块内任务，池内条目自带勾选框');

t('顶层任务的行上有「推迟」按钮', function () {
  var html = Render.buildTaskHtml(
    { id: 't1', text: '甲', completed: false, createdAt: 1 }, {});

  h.assertTrue(html.indexOf('task__postpone') !== -1);
});

t('块内没阶段的任务也有「推迟」按钮（requirements 第 2 条）', function () {
  var block = {
    id: 'b1', type: 'block', text: '晨间例程', completed: false, createdAt: 1,
    tasks: [{ id: 'c1', text: '喝水', completed: false, createdAt: 1 }]
  };
  var html = Render.buildBlockHtml(block, {});

  h.assertTrue(html.indexOf('task__postpone') !== -1, '没阶段的块内任务要能推迟');
  h.assertTrue(html.indexOf('喝水') !== -1, '任务本身照常渲染');
});

t('块内拆了阶段的任务不整条推迟，靠逐个阶段推迟', function () {
  var block = {
    id: 'b2', type: 'block', text: '晨间例程', completed: false, createdAt: 1,
    tasks: [{
      id: 'c2', text: '写报告', completed: false, createdAt: 1,
      stages: [{ id: 's1', text: '收集数据', completed: false, createdAt: 1 }]
    }]
  };
  var html = Render.buildBlockHtml(block, {});

  // 块头有 block__postpone（整体推迟照常），但这条带阶段的任务行不给 task__postpone
  h.assertTrue(html.indexOf('block__postpone') !== -1, '块头整体推迟照常在');
  h.assertFalse(html.indexOf('task__postpone') !== -1, '有阶段的块内任务不出现整条推迟');
});

t('空池显示占位提示', function () {
  var html = Render.buildPoolHtml([], {});

  h.assertTrue(html.indexOf('pool__empty') !== -1);
  h.assertTrue(html.indexOf('推迟') !== -1, '提示里要说明东西从哪儿进来');
  h.assertTrue(html.indexOf('pool__list') === -1, '没有条目就别画空列表');
});

t('池内每一行：有文字、删除和勾选框（v2.7 之前这里断言的是「没有勾选框」）', function () {
  var html = Render.buildPoolHtml([
    { id: 'p1', text: '相册整理', completed: true, createdAt: 1 }
  ], {});

  h.assertTrue(html.indexOf('data-id="p1"') !== -1);
  h.assertTrue(html.indexOf('pool__del') !== -1);
  h.assertTrue(html.indexOf('pool__check') !== -1, 'v2.7 起池内也能勾完成');
  h.assertTrue(html.indexOf('task__check') === -1,
    '但用的是池自己的类名：池里勾选 ≠ 象限里「正在做」，池内条目照样整条可拖（D-62）');
  h.assertTrue(html.indexOf('pool__count') !== -1, '头上有个数');
});

t('池内文字要转义', function () {
  var html = Render.buildPoolHtml([
    { id: 'p1', text: '<img src=x onerror=alert(1)>', completed: false, createdAt: 1 }
  ], {});

  h.assertFalse(html.indexOf('<img') !== -1, '原始标签不能出现');
  h.assertTrue(html.indexOf('&lt;img') !== -1);
});

t('改池内文字时整条收成输入框，值也要转义', function () {
  var html = Render.buildPoolHtml(
    [{ id: 'p1', text: '他说"你好"', completed: false, createdAt: 1 }],
    { editing: { mode: 'edit-pool', poolItemId: 'p1' } }
  );

  h.assertTrue(html.indexOf('task__input') !== -1, '输入框复用任务的');
  h.assertTrue(html.indexOf('&quot;') !== -1, '引号不转义会提前闭合 value');
});

// ---------------------------------------------------------------------------
h.group('完成时间（二期）：推迟的默认是所属日期 + 1');

t('推迟任务的默认完成时间 = 所属日期的下一天', function () {
  var s = seed(['乙']);
  var result = TaskOps.postponeTask(s.data, DATE, 'I', s.ids[0]);

  h.assertTrue(result.ok);
  h.assertEqual(s.data.pool[0].plannedDate, '2026-10-02',
    '基准是被推迟任务所属的日期，不是真实今天');
});

t('跨月、跨年也算得对', function () {
  var data = Store.createEmpty();
  var a = TaskOps.addTask(data, '2026-10-31', 'I', '月底的').task.id;
  var b = TaskOps.addTask(data, '2026-12-31', 'I', '年底的').task.id;

  TaskOps.postponeTask(data, '2026-10-31', 'I', a);
  TaskOps.postponeTask(data, '2026-12-31', 'I', b);

  h.assertEqual(data.pool[0].plannedDate, '2026-11-01');
  h.assertEqual(data.pool[1].plannedDate, '2027-01-01');
});

t('查看过去日期时推迟，默认时间跟着那个日期走（不许回到过去）', function () {
  var data = Store.createEmpty();
  var id = TaskOps.addTask(data, '2026-01-15', 'I', '一月的事').task.id;

  // 真实今天是 2026-10-01；按「今天 + 1」会得到 10 月，那就错了
  TaskOps.postponeTask(data, '2026-01-15', 'I', id);

  h.assertEqual(data.pool[0].plannedDate, '2026-01-16');
});

t('手动设定完成时间', function () {
  var s = seed(['乙']);
  TaskOps.postponeTask(s.data, DATE, 'I', s.ids[0]);

  var result = TaskOps.setPoolDate(s.data, s.ids[0], '2026-10-20');

  h.assertTrue(result.ok);
  h.assertEqual(s.data.pool[0].plannedDate, '2026-10-20');
});

t('清除时间 = 字段整个删掉，任务留在池里', function () {
  var s = seed(['乙']);
  TaskOps.postponeTask(s.data, DATE, 'I', s.ids[0]);

  var result = TaskOps.setPoolDate(s.data, s.ids[0], null);

  h.assertTrue(result.ok);
  h.assertEqual(poolTexts(s.data), '乙', '任务还在');
  h.assertFalse('plannedDate' in s.data.pool[0],
    '「未设定」就是没有这个字段，不是空串或 null');
});

t('设定的日期格式不对 → BAD_DATE，原值保留', function () {
  var s = seed(['乙']);
  TaskOps.postponeTask(s.data, DATE, 'I', s.ids[0]);
  var before = s.data.pool[0].plannedDate;

  var result = TaskOps.setPoolDate(s.data, s.ids[0], '2026-13-99');

  h.assertFalse(result.ok);
  h.assertEqual(result.error, TaskOps.ERR.BAD_DATE);
  h.assertEqual(s.data.pool[0].plannedDate, before, '改不成就别动原来的值');
});

t('给池里不存在的条目设时间 → NOT_FOUND', function () {
  h.assertFalse(TaskOps.setPoolDate(Store.createEmpty(), '没有的', '2026-10-02').ok);
});

t('推迟之后时间仍在，序列化再读回来不丢', function () {
  Store.init({ storage: h.createMemoryStorage() });
  var s = seed(['乙']);
  TaskOps.postponeTask(s.data, DATE, 'I', s.ids[0]);
  TaskOps.setPoolDate(s.data, s.ids[0], '2026-11-11');

  h.assertTrue(Store.save(s.data).ok);
  var loaded = Store.load();

  h.assertEqual(loaded.data.pool[0].plannedDate, '2026-11-11');
});

// ---------------------------------------------------------------------------
h.group('阶段推迟：保存为池内任务，文本带 [所属任务] 前缀');

/** 一条带两条阶段的任务，返回 { s, taskId } */
function seedWithStages() {
  var s = seed(['写季度报告']);
  TaskOps.addStage(s.data, DATE, 'I', s.ids[0], '收集数据');
  TaskOps.addStage(s.data, DATE, 'I', s.ids[0], '写初稿');
  return s;
}

t('阶段从任务里摘掉，池里出现带前缀的新任务', function () {
  var s = seedWithStages();
  var stages = TaskOps.locateTask(s.data, DATE, 'I', s.ids[0]).task.stages;
  var stageId = stages[0].id;

  var result = TaskOps.postponeStage(s.data, DATE, 'I', s.ids[0], stageId);

  h.assertTrue(result.ok);
  var task = TaskOps.locateTask(s.data, DATE, 'I', s.ids[0]).task;
  h.assertEqual(task.stages.length, 1, '任务里少了一条阶段');
  h.assertEqual(task.stages[0].text, '写初稿', '摘掉的是被推迟的那条');
  h.assertEqual(poolTexts(s.data), '[写季度报告]收集数据',
    '前缀 = 所属任务文本，括号里不转义不加空格');
  h.assertFalse(result.task.id === stageId, '池里是新任务，编号换新');
});

t('阶段推迟不生成阶段字段：它现在就是一条普通池任务', function () {
  var s = seedWithStages();
  var stageId = TaskOps.locateTask(s.data, DATE, 'I', s.ids[0]).task.stages[0].id;
  TaskOps.postponeStage(s.data, DATE, 'I', s.ids[0], stageId);

  h.assertFalse('stages' in s.data.pool[0], '阶段推迟下来就是一条光秃秃的任务');
});

t('阶段的完成状态照抄进池，默认时间也是所属日期 + 1', function () {
  var s = seedWithStages();
  var task = TaskOps.locateTask(s.data, DATE, 'I', s.ids[0]).task;
  TaskOps.toggleStage(s.data, DATE, 'I', s.ids[0], task.stages[0].id, true);

  TaskOps.postponeStage(s.data, DATE, 'I', s.ids[0], task.stages[0].id);

  h.assertEqual(s.data.pool[0].completed, true, '勾过的阶段推迟了也是勾过的');
  h.assertEqual(s.data.pool[0].plannedDate, '2026-10-02');
});

t('把唯一未完成的阶段推迟走，父任务翻成完成（规矩 2：以阶段为准）', function () {
  var s = seedWithStages();
  var task = TaskOps.locateTask(s.data, DATE, 'I', s.ids[0]).task;
  TaskOps.toggleStage(s.data, DATE, 'I', s.ids[0], task.stages[0].id, true);
  // 此时「写初稿」是唯一没完成的阶段
  TaskOps.postponeStage(s.data, DATE, 'I', s.ids[0], task.stages[1].id);

  var after = TaskOps.locateTask(s.data, DATE, 'I', s.ids[0]).task;
  h.assertEqual(after.completed, true, '剩下的阶段全完成，父任务跟着翻');
});

t('把非最后一条阶段推迟走，父任务保持未完成', function () {
  var s = seedWithStages();
  var stageId = TaskOps.locateTask(s.data, DATE, 'I', s.ids[0]).task.stages[0].id;
  TaskOps.postponeStage(s.data, DATE, 'I', s.ids[0], stageId);

  h.assertEqual(TaskOps.locateTask(s.data, DATE, 'I', s.ids[0]).task.completed, false,
    '还剩「写初稿」没做，任务不能翻成完成');
});

t('最后一条阶段推迟走：stages 字段删掉，父状态停住不翻转', function () {
  // 父任务此刻还有未完成的阶段，把「剩下的」全推迟走之后……
  var s = seedWithStages();
  var task = TaskOps.locateTask(s.data, DATE, 'I', s.ids[0]).task;
  TaskOps.postponeStage(s.data, DATE, 'I', s.ids[0], task.stages[0].id);
  task = TaskOps.locateTask(s.data, DATE, 'I', s.ids[0]).task;
  TaskOps.postponeStage(s.data, DATE, 'I', s.ids[0], task.stages[0].id);

  var after = TaskOps.locateTask(s.data, DATE, 'I', s.ids[0]).task;
  h.assertFalse('stages' in after, '零个阶段和「没有阶段」是一回事');
  h.assertEqual(after.completed, false,
    '阶段全走了但一个都没勾完，任务不能凭空变完成（停住，见 FS 计划池边界）');
});

t('宿主在块里时：推迟最后未完成阶段，任务和宿主块一起翻成完成', function () {
  var data = Store.createEmpty();
  var block = TaskOps.addBlock(data, DATE, 'I', '晨间例程').block;
  var child = TaskOps.addTask(data, DATE, 'I', '锻炼').task;
  // 把 child 塞进块里（数据层允许，界面才限制入口）
  data.dates[DATE].I.splice(data.dates[DATE].I.indexOf(child), 1);
  block.tasks.push(child);
  TaskOps.addStage(data, DATE, 'I', child.id, '热身');
  TaskOps.addStage(data, DATE, 'I', child.id, '拉伸');
  var task = TaskOps.locateTask(data, DATE, 'I', child.id).task;
  TaskOps.toggleStage(data, DATE, 'I', child.id, task.stages[0].id, true);

  // 「拉伸」是块内唯一没完成的阶段；推迟走之后任务内的阶段全完成
  var result = TaskOps.postponeStage(data, DATE, 'I', child.id, task.stages[1].id);

  h.assertTrue(result.ok);
  h.assertEqual(TaskOps.locateTask(data, DATE, 'I', child.id).task.completed, true,
    '剩下的「热身」已完成，任务翻成完成');
  h.assertEqual(block.completed, true, '宿主块跟着重算（syncHostBlock）');
  h.assertEqual(poolTexts(data), '[锻炼]拉伸');
});

t('阶段不存在 → NOT_FOUND；日期不合法 → BAD_DATE', function () {
  var s = seedWithStages();
  var stageId = TaskOps.locateTask(s.data, DATE, 'I', s.ids[0]).task.stages[0].id;

  h.assertFalse(TaskOps.postponeStage(s.data, DATE, 'I', s.ids[0], '没有的').ok);
  h.assertFalse(TaskOps.postponeStage(s.data, '2026-02-30', 'I', s.ids[0], stageId).ok);
  h.assertEqual(poolTexts(s.data), '', '两次失败都没往池里塞东西');
});

// ---------------------------------------------------------------------------
h.group('plannedDate 的 normalize 与导入导出');

t('normalize：合法的 plannedDate 原样保留', function () {
  var result = Store.parse(JSON.stringify({
    dates: {},
    pool: [{ id: 'p1', text: '修自行车', completed: false, createdAt: 1,
             plannedDate: '2026-10-05' }]
  }));

  h.assertEqual(result.data.pool[0].plannedDate, '2026-10-05');
});

t('normalize：格式不对丢字段不拒整份（时间是附加信息）', function () {
  var result = Store.parse(JSON.stringify({
    dates: {},
    pool: [{ id: 'p1', text: '修自行车', completed: false, createdAt: 1,
             plannedDate: '下周二' }]
  }));

  h.assertEqual(result.data.pool.length, 1, '任务本身留下');
  h.assertFalse('plannedDate' in result.data.pool[0], '只有时间字段被丢掉');
  h.assertEqual(result.dropped, 0, '丢字段不算丢任务');
});

t('象限里的任务带了 plannedDate 也照常清洗保留（字段跟着任务走）', function () {
  var result = Store.parse(JSON.stringify({
    dates: { '2026-10-01': { I: [{ id: 'a', text: '普通任务', completed: false,
             createdAt: 1, plannedDate: '2026-10-09' }], II: [], III: [], IV: [] } }
  }));

  h.assertEqual(result.data.dates['2026-10-01'].I[0].plannedDate, '2026-10-09');
});

t('导出再导入：plannedDate 跟着文件走', function () {
  var s = seed(['修自行车']);
  TaskOps.postponeTask(s.data, DATE, 'I', s.ids[0]);
  TaskOps.setPoolDate(s.data, s.ids[0], '2026-10-08');

  var text = Store.serialize(s.data);
  var other = Store.createEmpty();
  var result = Importer.importText(other, text);

  h.assertTrue(result.ok);
  h.assertEqual(other.pool[0].plannedDate, '2026-10-08');
});

t('导入的 plannedDate 格式不对：丢字段，任务照常收', function () {
  var data = Store.createEmpty();
  var result = Importer.importText(data, poolFile([
    { text: '修自行车', completed: false, plannedDate: '10月8号' }
  ]));

  h.assertTrue(result.ok);
  h.assertEqual(data.pool.length, 1);
  h.assertFalse('plannedDate' in data.pool[0]);
});

t('池判重跳过时，本地的完成时间不被文件覆盖', function () {
  var data = Store.createEmpty();
  data.pool.push({ id: 'local_1', text: '相册整理', completed: false, createdAt: 1,
                   plannedDate: '2026-12-01' });

  var result = Importer.importText(data, poolFile([
    { text: '相册整理', completed: false, plannedDate: '2027-01-01' }
  ]));

  h.assertEqual(result.skipped, 1);
  h.assertEqual(data.pool[0].plannedDate, '2026-12-01', '跳过的保留本地值（和 D-16 同理）');
});

// ---------------------------------------------------------------------------
h.group('界面（二期）：池行的时间、日期编辑态、阶段推迟按钮');

t('设了时间的池行显示日期按钮', function () {
  var html = Render.buildPoolHtml([
    { id: 'p1', text: '修自行车', completed: false, createdAt: 1,
      plannedDate: '2026-10-05' }
  ], {});

  h.assertTrue(html.indexOf('pool__date') !== -1);
  h.assertTrue(html.indexOf('2026-10-05') !== -1, '照实显示日期');
  h.assertTrue(html.indexOf('pool__date--empty') === -1, '设了就不是「未设定」');
});

t('没时间的池行显示「未设定」', function () {
  var html = Render.buildPoolHtml([
    { id: 'p1', text: '修自行车', completed: false, createdAt: 1 }
  ], {});

  h.assertTrue(html.indexOf('pool__date--empty') !== -1);
  h.assertTrue(html.indexOf('未设定') !== -1);
});

t('日期编辑态：原地换成日期输入框和清除按钮', function () {
  var html = Render.buildPoolHtml([
    { id: 'p1', text: '修自行车', completed: false, createdAt: 1,
      plannedDate: '2026-10-05' }
  ], { editing: { mode: 'edit-pool-date', poolItemId: 'p1' } });

  h.assertTrue(html.indexOf('pool__date-input') !== -1);
  h.assertTrue(html.indexOf('value="2026-10-05"') !== -1, '现值要回填进输入框');
  h.assertTrue(html.indexOf('pool__date-clear') !== -1, '清除按钮在旁边');
  h.assertTrue(html.indexOf('pool__del') === -1, '编辑态只管时间，别排别的按钮进去');
});

t('没设时间进日期编辑态：输入框是空的', function () {
  var html = Render.buildPoolHtml([
    { id: 'p1', text: '修自行车', completed: false, createdAt: 1 }
  ], { editing: { mode: 'edit-pool-date', poolItemId: 'p1' } });

  h.assertTrue(html.indexOf('value=""') !== -1, '空值提交 = 清除时间');
});

t('编辑别的池条目时，这条照常显示时间按钮', function () {
  var html = Render.buildPoolHtml([
    { id: 'p1', text: '甲', completed: false, createdAt: 1, plannedDate: '2026-10-05' },
    { id: 'p2', text: '乙', completed: false, createdAt: 1 }
  ], { editing: { mode: 'edit-pool-date', poolItemId: 'p2' } });

  h.assertTrue(html.indexOf('pool__date-input') !== -1, 'p2 是输入框');
  h.assertTrue(html.indexOf('pool__date-clear') !== -1);
  h.assertTrue(html.indexOf('pool__date--empty') === -1,
    '页面上没有「未设定」——唯一的非编辑行 p1 设了时间');
  h.assertTrue(html.indexOf('2026-10-05') !== -1, 'p1 的时间照常显示');
});

t('阶段行上有「推迟」按钮', function () {
  var html = Render.buildStageHtml(
    { id: 's1', text: '收集数据', completed: false, createdAt: 1 }, false);

  h.assertTrue(html.indexOf('stage__postpone') !== -1);
  h.assertTrue(html.indexOf('stage__del') !== -1, '删除按钮还在');
});

// ---------------------------------------------------------------------------
h.group('池内手动添加（三期）：默认完成时间 = 查看日期 + 7 天');

t('直接添加进池末尾，默认完成时间是一周后', function () {
  var data = Store.createEmpty();
  var result = TaskOps.addPoolItem(data, DATE, '买生日礼物');

  h.assertTrue(result.ok);
  h.assertEqual(poolTexts(data), '买生日礼物');
  h.assertEqual(data.pool[0].plannedDate, '2026-10-08',
    '默认 = 当前查看日期 + 7 天（用户指令：默认 7 天后）');
});

t('跨月、跨年也算得对', function () {
  var data = Store.createEmpty();
  TaskOps.addPoolItem(data, '2026-10-31', '月底加的');
  TaskOps.addPoolItem(data, '2026-12-28', '年底加的');

  h.assertEqual(data.pool[0].plannedDate, '2026-11-07');
  h.assertEqual(data.pool[1].plannedDate, '2027-01-04');
});

t('查看过去日期时添加，默认时间跟着那个日期走（不许回到过去）', function () {
  var data = Store.createEmpty();
  // 真实今天是 2026-10-01；基准该是查看的日期，和推迟默认 +1 同一个道理
  TaskOps.addPoolItem(data, '2026-01-15', '一月记的');

  h.assertEqual(data.pool[0].plannedDate, '2026-01-22');
});

t('空文本拒绝（同 D-31），日期不合法 → BAD_DATE', function () {
  var data = Store.createEmpty();
  var empty = TaskOps.addPoolItem(data, DATE, '   ');
  h.assertFalse(empty.ok);
  h.assertEqual(empty.error, TaskOps.ERR.EMPTY_TEXT);

  h.assertFalse(TaskOps.addPoolItem(data, '2026-02-30', '买礼物').ok);
  h.assertEqual(poolTexts(data), '', '两次失败都没往池里塞东西');
});

t('手动添加的和推迟进来的完全同构：可改时间、可拖回、可删', function () {
  var data = Store.createEmpty();
  var id = TaskOps.addPoolItem(data, DATE, '买生日礼物').task.id;
  TaskOps.postponeTask(
    data, DATE, 'I',
    TaskOps.addTask(data, DATE, 'I', '推迟来的').task.id);

  // 改时间
  h.assertTrue(TaskOps.setPoolDate(data, id, '2026-11-01').ok);
  h.assertEqual(data.pool[0].plannedDate, '2026-11-01');

  // 拖回象限（内容、完成时间字段都跟着走）
  var restored = TaskOps.restoreFromPool(data, DATE, 'II', id);
  h.assertTrue(restored.ok);
  h.assertEqual(data.dates[DATE].II[0].text, '买生日礼物');
  h.assertEqual(data.dates[DATE].II[0].plannedDate, '2026-11-01');
  h.assertEqual(poolTexts(data), '推迟来的', '池里只剩另一条');

  // 删除
  h.assertTrue(TaskOps.removePoolItem(data, data.pool[0].id).ok);
  h.assertEqual(poolTexts(data), '');
});

t('手动添加的照样进统计外、进导出导入', function () {
  var data = Store.createEmpty();
  TaskOps.addPoolItem(data, DATE, '买生日礼物');

  h.assertEqual(TaskOps.getStats(data, DATE).total, 0, '池不计统计');

  var text = Store.serialize(data);
  var other = Store.createEmpty();
  var result = Importer.importText(other, text);

  h.assertTrue(result.ok);
  h.assertEqual(other.pool[0].text, '买生日礼物');
  h.assertEqual(other.pool[0].plannedDate, '2026-10-08', '时间跟着文件走');
});

t('池头部有「＋」按钮；add-pool 编辑态在列表末尾长出输入框', function () {
  var html = Render.buildPoolHtml([], {});
  h.assertTrue(html.indexOf('pool__add') !== -1, '空池也有添加入口');

  var editing = Render.buildPoolHtml([], {
    editing: { mode: 'add-pool' }
  });
  h.assertTrue(editing.indexOf('task__input') !== -1, '输入框复用任务的');
  h.assertTrue(editing.indexOf('pool__list') !== -1, '空池加东西时也包在列表里');

  var withItems = Render.buildPoolHtml(
    [{ id: 'p1', text: '已有', completed: false, createdAt: 1 }],
    { editing: { mode: 'add-pool' } });
  h.assertTrue(withItems.indexOf('已有') !== -1, '已有条目照常显示');
  h.assertTrue(withItems.indexOf('task__input') !== -1, '输入框挂在末尾');
});

// ---------------------------------------------------------------------------

h.summary('task-ops.js 计划池');
