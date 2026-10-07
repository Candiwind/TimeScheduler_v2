/**
 * test-pool-order.js
 *
 * 检查 v2.6 计划池的三条数据层能力（见 DS 2.30 / 2.31 / 2.32）：
 *
 *   1. 池内换顺序（movePoolItem）—— **只在各自列表内排**：顶层条目之间、
 *      同一条块内的任务之间。跨容器（顶层 ↔ 块内）由 drag.js 拦掉，
 *      数据层不做「搬进 / 搬出块」这件事；
 *   2. 「导入」到第二象限（复用 restoreFromPool，落点 = 列表开头）；
 *   3. 计划日期到了自动导入今天（autoImportDuePoolItems + poolItemDueDate）——
 *      只处理池顶层，块按块内**最早**的计划日期整块回来，不拆散。
 *
 * 日期一律写死，不依赖真实的「今天」（todayStr 是参数），跑起来可复现。
 *
 * 跑法：node test/test-pool-order.js
 */
'use strict';

var fs = require('fs');
var path = require('path');
var h = require('./harness');
var Store = require('../js/store');
var TaskOps = require('../js/task-ops');

var t = h.test;

var BASE = '2026-10-01';      // 造数据用的基准日
var TODAY = '2026-10-01';     // 自动导入里的「真实今天」
var YESTERDAY = '2026-09-30';
var TOMORROW = '2026-10-02';

function fresh() {
  return Store.createEmpty();
}

/** 往池里加一条任务，plannedDate 传 undefined = 清掉（当「未设定」） */
function poolTask(data, text, plannedDate) {
  var r = TaskOps.addPoolItem(data, BASE, text);
  if (!r.ok) throw new Error('池内任务没造出来：' + r.error);
  if (plannedDate === undefined) delete r.task.plannedDate;
  else if (plannedDate !== null) r.task.plannedDate = plannedDate;
  return r.task;
}

/** 往池里加一个块，块内塞若干任务，各自可带计划日期 */
function poolBlock(data, name, kidSpecs) {
  var r = TaskOps.addPoolBlock(data, name);
  if (!r.ok) throw new Error('池内块没造出来：' + r.error);
  (kidSpecs || []).forEach(function (spec, i) {
    var kid = {
      id: 'k_' + name + '_' + i,
      text: spec.text,
      completed: false,
      createdAt: 1
    };
    if (spec.plannedDate) kid.plannedDate = spec.plannedDate;
    r.block.tasks.push(kid);
  });
  r.block.completed = Store.blockDone(r.block.tasks);
  return r.block;
}

function poolTexts(data) {
  return (data.pool || []).map(function (x) { return x.text; }).join(',');
}

function quadrantTexts(data, dateStr, qid) {
  var day = data.dates[dateStr];
  var list = day && day[qid] ? day[qid] : [];
  return list.map(function (x) { return x.text; }).join(',');
}

function hasDay(data, dateStr) {
  return !!(data.dates && data.dates[dateStr]);
}

// ---------------------------------------------------------------------------
h.group('movePoolItem：池顶层换顺序');

t('往后挪：第二条挪到末尾', function () {
  var data = fresh();
  var a = poolTask(data, '甲');
  var b = poolTask(data, '乙');
  var c = poolTask(data, '丙');

  var r = TaskOps.movePoolItem(data, b.id, 2);   // 摘出来后按第 2 位插回

  h.assertTrue(r.ok);
  h.assertEqual(poolTexts(data), '甲,丙,乙');
  h.assertEqual(r.index, 2);
  h.assertEqual(data.pool[2].id, b.id, '还是同一条对象，不是复制品');
});

t('往前挪：末尾一条挪到开头', function () {
  var data = fresh();
  poolTask(data, '甲');
  poolTask(data, '乙');
  var c = poolTask(data, '丙');

  h.assertTrue(TaskOps.movePoolItem(data, c.id, 0).ok);
  h.assertEqual(poolTexts(data), '丙,甲,乙');
});

t('挪到原位不算失败，顺序不动', function () {
  var data = fresh();
  poolTask(data, '甲');
  var b = poolTask(data, '乙');
  poolTask(data, '丙');

  var r = TaskOps.movePoolItem(data, b.id, 1);
  h.assertTrue(r.ok);
  h.assertEqual(poolTexts(data), '甲,乙,丙');
});

t('越界自动夹紧（-5 → 开头，99 → 末尾）', function () {
  var data = fresh();
  poolTask(data, '甲');
  var b = poolTask(data, '乙');
  var c = poolTask(data, '丙');

  h.assertTrue(TaskOps.movePoolItem(data, c.id, -5).ok);
  h.assertEqual(poolTexts(data), '丙,甲,乙');
  h.assertTrue(TaskOps.movePoolItem(data, b.id, 99).ok);
  h.assertEqual(poolTexts(data), '丙,甲,乙', '乙 本来就在末尾');
  h.assertTrue(TaskOps.movePoolItem(data, c.id, 99).ok);
  h.assertEqual(poolTexts(data), '甲,乙,丙');
});

t('移动不是复制：池长度不变、id 集合不变', function () {
  var data = fresh();
  var a = poolTask(data, '甲');
  var b = poolTask(data, '乙');

  TaskOps.movePoolItem(data, a.id, 1);

  h.assertEqual(data.pool.length, 2, '池长度不变');
  var ids = data.pool.map(function (x) { return x.id; }).join(',');
  h.assertEqual(ids, b.id + ',' + a.id);
});

t('块本身也是合法的可排序条目', function () {
  var data = fresh();
  poolTask(data, '甲');
  var blk = poolBlock(data, '搬家', []);

  h.assertTrue(TaskOps.movePoolItem(data, blk.id, 0).ok);
  h.assertEqual(poolTexts(data), '搬家,甲');
  h.assertEqual(data.pool[0].id, blk.id);
});

t('找不到的 id → NOT_FOUND，池一个字节不动', function () {
  var data = fresh();
  poolTask(data, '甲');
  poolTask(data, '乙');

  var r = TaskOps.movePoolItem(data, '不存在的 id', 0);
  h.assertFalse(r.ok);
  h.assertEqual(r.error, TaskOps.ERR.NOT_FOUND);
  h.assertEqual(poolTexts(data), '甲,乙');
});

t('空池 / 空 id → NOT_FOUND，不崩', function () {
  var data = fresh();
  h.assertEqual(TaskOps.movePoolItem(data, 'x', 0).error, TaskOps.ERR.NOT_FOUND);
  h.assertEqual(TaskOps.movePoolItem(data, null, 0).error, TaskOps.ERR.NOT_FOUND);
});

// ---------------------------------------------------------------------------
h.group('movePoolItem：块内换顺序（各自列表内）');

t('块内三条任务可换顺序，池顶层不受影响', function () {
  var data = fresh();
  poolTask(data, '顶层的甲');
  var blk = poolBlock(data, '搬家', [
    { text: '打包' }, { text: '叫车' }, { text: '交接' }
  ]);

  h.assertTrue(TaskOps.movePoolItem(data, blk.tasks[2].id, 0).ok);

  h.assertEqual(blk.tasks.map(function (k) { return k.text; }).join(','),
    '交接,打包,叫车');
  h.assertEqual(poolTexts(data), '顶层的甲,搬家', '顶层顺序没被动');
  h.assertEqual(data.pool.length, 2);
});

t('块内任务换顺序不影响兄弟块', function () {
  var data = fresh();
  var b1 = poolBlock(data, '块一', [{ text: '一甲' }, { text: '一乙' }]);
  var b2 = poolBlock(data, '块二', [{ text: '二甲' }, { text: '二乙' }]);

  TaskOps.movePoolItem(data, b1.tasks[1].id, 0);

  h.assertEqual(b1.tasks.map(function (k) { return k.text; }).join(','), '一乙,一甲');
  h.assertEqual(b2.tasks.map(function (k) { return k.text; }).join(','), '二甲,二乙');
});

t('块内越界夹紧，长度不变', function () {
  var data = fresh();
  var blk = poolBlock(data, '块', [{ text: '甲' }, { text: '乙' }]);

  h.assertTrue(TaskOps.movePoolItem(data, blk.tasks[1].id, 99).ok);
  h.assertEqual(blk.tasks.length, 2);
  h.assertEqual(blk.tasks.map(function (k) { return k.text; }).join(','), '甲,乙');
});

// ---------------------------------------------------------------------------
h.group('poolItemDueDate：一条池条目的到期日');

t('普通任务用自己的 plannedDate', function () {
  var data = fresh();
  var task = poolTask(data, '甲', TODAY);
  h.assertEqual(TaskOps.poolItemDueDate(task), TODAY);
});

t('没有 plannedDate → null（未设定，永远不到期）', function () {
  var data = fresh();
  h.assertNull(TaskOps.poolItemDueDate(poolTask(data, '甲', undefined)));
});

t('plannedDate 是脏数据 → 当未设定，返回 null', function () {
  var data = fresh();
  var task = poolTask(data, '甲');
  task.plannedDate = '2026-13-99';
  h.assertNull(TaskOps.poolItemDueDate(task));

  task.plannedDate = 12345;
  h.assertNull(TaskOps.poolItemDueDate(task));
});

t('null / undefined 输入不崩', function () {
  h.assertNull(TaskOps.poolItemDueDate(null));
  h.assertNull(TaskOps.poolItemDueDate(undefined));
});

t('任务块取块内**最早**的计划日期', function () {
  var data = fresh();
  var blk = poolBlock(data, '搬家', [
    { text: '打包', plannedDate: '2026-10-05' },
    { text: '叫车', plannedDate: '2026-10-02' },
    { text: '交接', plannedDate: '2026-10-09' }
  ]);
  h.assertEqual(TaskOps.poolItemDueDate(blk), '2026-10-02');
});

t('块内只有部分任务有日期 → 取有日期的那些里最早的', function () {
  var data = fresh();
  var blk = poolBlock(data, '搬家', [
    { text: '打包' },
    { text: '叫车', plannedDate: '2026-10-04' }
  ]);
  h.assertEqual(TaskOps.poolItemDueDate(blk), '2026-10-04');
});

t('空块 / 块内都没日期 → null', function () {
  var data = fresh();
  h.assertNull(TaskOps.poolItemDueDate(poolBlock(data, '空块', [])));
  h.assertNull(TaskOps.poolItemDueDate(poolBlock(data, '没日期', [{ text: '甲' }])));
});

// ---------------------------------------------------------------------------
h.group('autoImportDuePoolItems：计划日期到了自动导入今天');

t('到期（= 今天）→ 移进今天 Q-II 的开头，池里消失', function () {
  var data = fresh();
  var task = poolTask(data, '甲', TODAY);
  // 今天 Q-II 里先有一条，用来验证「导入的排最前」
  TaskOps.addTask(data, TODAY, 'II', '原有的');

  var r = TaskOps.autoImportDuePoolItems(data, TODAY);

  h.assertTrue(r.ok);
  h.assertEqual(r.imported, 1);
  h.assertEqual(poolTexts(data), '', '池里不再保留');
  h.assertEqual(quadrantTexts(data, TODAY, 'II'), '甲,原有的', '落在 Q-II 开头');
  h.assertEqual(data.dates[TODAY].II[0].id, task.id, '还是同一条对象');
});

t('过期没做的也算到期', function () {
  var data = fresh();
  poolTask(data, '早就该做的', YESTERDAY);

  var r = TaskOps.autoImportDuePoolItems(data, TODAY);

  h.assertEqual(r.imported, 1);
  h.assertEqual(quadrantTexts(data, TODAY, 'II'), '早就该做的');
});

t('还没到期 → 一条都不动，也不建今天的记录', function () {
  var data = fresh();
  poolTask(data, '明天再说', TOMORROW);

  var r = TaskOps.autoImportDuePoolItems(data, TODAY);

  h.assertTrue(r.ok);
  h.assertEqual(r.imported, 0);
  h.assertEqual(poolTexts(data), '明天再说');
  h.assertFalse(hasDay(data, TODAY), '没有可导入的不留空壳日期');
});

t('未设定计划日期的永远不到期', function () {
  var data = fresh();
  poolTask(data, '没定日子', undefined);

  h.assertEqual(TaskOps.autoImportDuePoolItems(data, TODAY).imported, 0);
  h.assertEqual(poolTexts(data), '没定日子');
});

t('多条到期按**池内顺序**整批插到开头（不倒序）', function () {
  var data = fresh();
  poolTask(data, '甲', TODAY);
  poolTask(data, '乙', YESTERDAY);
  poolTask(data, '丙', TOMORROW);
  poolTask(data, '丁', YESTERDAY);
  TaskOps.addTask(data, TODAY, 'II', '原有的');

  var r = TaskOps.autoImportDuePoolItems(data, TODAY);

  h.assertEqual(r.imported, 3);
  h.assertEqual(quadrantTexts(data, TODAY, 'II'), '甲,乙,丁,原有的');
  h.assertEqual(poolTexts(data), '丙', '没到期的留在池里');
});

t('块按块内最早的计划日期**整块**回来，块内任务不单独导入', function () {
  var data = fresh();
  var blk = poolBlock(data, '搬家', [
    { text: '打包', plannedDate: YESTERDAY },
    { text: '叫车', plannedDate: TOMORROW }
  ]);

  var r = TaskOps.autoImportDuePoolItems(data, TODAY);

  h.assertEqual(r.imported, 1);
  h.assertEqual(poolTexts(data), '', '整块搬走，池里不留空块');
  h.assertEqual(quadrantTexts(data, TODAY, 'II'), '搬家');
  var landed = data.dates[TODAY].II[0];
  h.assertEqual(landed.id, blk.id, '还是同一个块');
  h.assertEqual(landed.tasks.length, 2, '块内任务一条不丢');
  h.assertEqual(landed.tasks[0].text, '打包');
});

t('块内任务不单独被自动导入（否则块第二天就被掏空）', function () {
  var data = fresh();
  var blk = poolBlock(data, '搬家', [{ text: '打包', plannedDate: YESTERDAY }]);

  TaskOps.autoImportDuePoolItems(data, TODAY);

  h.assertEqual(blk.tasks.length, 1, '块内任务跟着块走，不单独飞出去');
});

t('重复调用是幂等的：同一条只导入一次', function () {
  var data = fresh();
  poolTask(data, '甲', TODAY);

  var first = TaskOps.autoImportDuePoolItems(data, TODAY);
  var second = TaskOps.autoImportDuePoolItems(data, TODAY);

  h.assertEqual(first.imported, 1);
  h.assertEqual(second.imported, 0, '第二次扫不到它了（已经不在池里）');
  h.assertEqual(quadrantTexts(data, TODAY, 'II'), '甲', '不会出现两份');
});

t('空池 → imported 0，不建今天记录', function () {
  var data = fresh();
  var r = TaskOps.autoImportDuePoolItems(data, TODAY);

  h.assertTrue(r.ok);
  h.assertEqual(r.imported, 0);
  h.assertFalse(hasDay(data, TODAY));
});

t('今天非法 → BAD_DATE，池不动', function () {
  var data = fresh();
  poolTask(data, '甲', TODAY);

  var r = TaskOps.autoImportDuePoolItems(data, '2026-13-01');

  h.assertFalse(r.ok);
  h.assertEqual(r.error, TaskOps.ERR.BAD_DATE);
  h.assertEqual(poolTexts(data), '甲');
});

t('可以指定目标象限（不传就是第二象限）', function () {
  var data = fresh();
  poolTask(data, '甲', TODAY);

  TaskOps.autoImportDuePoolItems(data, TODAY, 'I');

  h.assertEqual(quadrantTexts(data, TODAY, 'I'), '甲');
  h.assertEqual(quadrantTexts(data, TODAY, 'II'), '');
});

// ---------------------------------------------------------------------------
h.group('导入到第二象限：落点与「含阶段」');

t('toIndex 0 → 落在 Q-II 开头（象限里已有的往后让）', function () {
  var data = fresh();
  TaskOps.addTask(data, TODAY, 'II', '原有的');
  var task = poolTask(data, '甲', TODAY);

  var r = TaskOps.restoreFromPool(data, TODAY, 'II', task.id, 0);

  h.assertTrue(r.ok);
  h.assertEqual(quadrantTexts(data, TODAY, 'II'), '甲,原有的');
  h.assertEqual(poolTexts(data), '');
});

t('带阶段的任务连阶段一起搬进 Q-II', function () {
  var data = fresh();
  // 造一条带阶段的象限任务，再推迟进池（阶段原样带进池），最后导入回来
  var made = TaskOps.addTask(data, BASE, 'I', '写周报');
  TaskOps.addStage(data, BASE, 'I', made.task.id, '收集数据');
  TaskOps.addStage(data, BASE, 'I', made.task.id, '写正文');
  h.assertTrue(TaskOps.postponeTask(data, BASE, 'I', made.task.id).ok);

  var pooled = data.pool[0];
  h.assertEqual(pooled.stages.length, 2, '阶段进了池');

  h.assertTrue(TaskOps.restoreFromPool(data, TODAY, 'II', pooled.id, 0).ok);

  var landed = data.dates[TODAY].II[0];
  h.assertEqual(landed.text, '写周报');
  h.assertEqual(landed.stages.length, 2, '阶段一条不丢');
  h.assertEqual(landed.stages[0].text, '收集数据');
});

t('整块导入：池里消失，Q-II 出现同一个块', function () {
  var data = fresh();
  var blk = poolBlock(data, '搬家', [{ text: '打包' }, { text: '叫车' }]);

  h.assertTrue(TaskOps.restoreFromPool(data, TODAY, 'II', blk.id, 0).ok);

  h.assertEqual(poolTexts(data), '');
  h.assertEqual(data.dates[TODAY].II[0].id, blk.id);
  h.assertEqual(data.dates[TODAY].II[0].tasks.length, 2);
});

t('块内任务单独导入：从块里摘出，宿主块完成度重算', function () {
  var data = fresh();
  var blk = poolBlock(data, '搬家', [{ text: '打包' }, { text: '叫车' }]);
  blk.tasks[0].completed = true;
  blk.completed = Store.blockDone(blk.tasks);

  h.assertTrue(TaskOps.restoreFromPool(data, TODAY, 'II', blk.tasks[0].id, 0).ok);

  h.assertEqual(blk.tasks.length, 1, '摘出去了');
  h.assertEqual(blk.tasks[0].text, '叫车');
  h.assertEqual(blk.completed, false, '宿主块完成度跟着重算');
  h.assertEqual(quadrantTexts(data, TODAY, 'II'), '打包');
  h.assertEqual(poolTexts(data), '搬家', '宿主块留在池里');
});

t('导入一条不存在的 → NOT_FOUND，不动任何数据', function () {
  var data = fresh();
  poolTask(data, '甲', TODAY);

  var r = TaskOps.restoreFromPool(data, TODAY, 'II', '不存在', 0);

  h.assertFalse(r.ok);
  h.assertEqual(r.error, TaskOps.ERR.NOT_FOUND);
  h.assertEqual(poolTexts(data), '甲');
  h.assertFalse(hasDay(data, TODAY));
});

// ---------------------------------------------------------------------------
h.group('源码守卫：入口接对了没有');

var ROOT = path.join(__dirname, '..');
function src(name) {
  return fs.readFileSync(path.join(ROOT, 'js', name), 'utf8');
}

t('render.js 画出了池内「导入」按钮（行上 + 块头）', function () {
  var s = src('render.js');
  h.assertTrue(s.indexOf('"pool__import"') !== -1, '缺 pool__import 按钮');
  h.assertTrue(s.indexOf('"pool__block-import"') !== -1, '缺 pool__block-import 按钮');
});

t('app.js：导入按钮接到 restoreFromPool 的第二象限', function () {
  var s = src('app.js');
  h.assertTrue(s.indexOf('CONFIG.IMPORT_QUADRANT') !== -1,
    '目标象限该用 CONFIG.IMPORT_QUADRANT，别写死');
  h.assertTrue(/restoreFromPool\(state\.data,\s*state\.date,\s*\n?\s*CONFIG\.IMPORT_QUADRANT/.test(s),
    '导入该走 restoreFromPool（移动语义）');
  h.assertTrue(s.indexOf("closest(target, 'pool__import')") !== -1);
  h.assertTrue(s.indexOf("closest(target, 'pool__block-import')") !== -1);
});

t('app.js：自动导入在启动和切日期时各查一次', function () {
  var s = src('app.js');
  var calls = s.match(/autoImportDuePool\(\)/g) || [];
  h.assertTrue(calls.length >= 3, '该有定义 + 启动 + 切日期至少三处，实际 ' + calls.length);
  h.assertTrue(/state\.date = Util\.todayStr\(\);\s*\n[\s\S]{0,400}?autoImportDuePool\(\)/.test(s),
    '启动（默认停在今天）之后要查一次');
  h.assertTrue(/state\.date = dateStr;\s*\n[\s\S]{0,400}?autoImportDuePool\(\)/.test(s),
    '切日期之后要查一次');
});

t('app.js：自动导入先判保护模式（保护模式一个字节都不动）', function () {
  var s = src('app.js');
  var m = /function autoImportDuePool\(\)\s*\{([\s\S]*?)\n  \}/.exec(s);
  h.assertTrue(m !== null, '没找到 autoImportDuePool 函数体');
  var body = m ? m[1] : '';
  h.assertTrue(body.indexOf('Store.isProtectionMode()') !== -1,
    '函数开头该有保护模式判断');
  h.assertTrue(body.indexOf('Util.todayStr()') !== -1,
    '判据该是真实今天（不是正在查看的日期）');
});

t('drag.js：池落点按「指针底下那个池列表」解析，占位符是池款', function () {
  var s = src('drag.js');
  // v2.6 时靠 poolContainerOf 记住「我属于哪个列表」，只认同一个容器内的排序；
  // v2.10 需求 3 要求池内也能跨容器搬运（顶层 ↔ 块内），改成按指针底下的
  // 池列表（顶层或块内）解析落点，落点带 region / blockId 两个字段
  h.assertTrue(s.indexOf('function poolDropTarget') !== -1,
    '缺 poolDropTarget：池落点解析');
  h.assertTrue(s.indexOf("region: 'pool'") !== -1,
    '池落点该带 region: pool');
  h.assertTrue(s.indexOf("pool__item pool__item--placeholder") !== -1);
});

t('app.js：Markdown 导出带上当前查看的日期（需求 4）', function () {
  var s = src('app.js');
  h.assertTrue(s.indexOf('Exporter.exportMarkdown(state.data, undefined, state.date)') !== -1,
    'Markdown 该只导当前查看的那一天');
  h.assertTrue(s.indexOf('Exporter.exportJson(state.data)') !== -1,
    'JSON 仍是整份导出');
});

t('exporter.js：exportMarkdown 把 dateStr 透传给 buildMarkdown，文件名跟着走', function () {
  var s = src('exporter.js');
  h.assertTrue(s.indexOf('buildMarkdown(data, { dateStr: dateStr })') !== -1);
  h.assertTrue(s.indexOf("(dateStr || stamp(when))") !== -1);
});

// ---------------------------------------------------------------------------

h.summary('计划池 v2.6（池内排序 / 导入 / 到期自动导入）');
