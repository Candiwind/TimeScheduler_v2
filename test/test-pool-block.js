/**
 * test-pool-block.js
 *
 * 检查计划池里的任务块（需求 4，见 DS 2.20）：
 *
 *   1. 计划池里允许直接添加任务块（addPoolBlock），空的、可再往里加任务；
 *   2. 往池内块里加任务（addPoolBlockTask），DDL 默认查看日期 + 7 天；
 *   3. 象限里的任务块能整体推迟进计划池（postponeBlock），DDL 逐条设到
 *      块内任务上（默认所属日期 + 1 天），块自己是容器不设 DDL；
 *   4. DDL 以任务为单位：块内任务也能定位、改 DDL、删、改文字
 *      （locatePoolItem / setPoolDate / editPoolItem / removePoolItem）。
 *
 * 跑法：node test/test-pool-block.js
 */
'use strict';

var h = require('./harness');
var Store = require('../js/store');
var TaskOps = require('../js/task-ops');
var Importer = require('../js/importer');

var t = h.test;
var DATE = '2026-10-01';

function fresh() {
  return Store.createEmpty();
}

/** 在象限里造一个块，块里塞若干任务，返回 { block, kids } */
function quadrantBlock(data, quadrantId, name, kidTexts) {
  var r = TaskOps.addBlock(data, DATE, quadrantId, name);
  if (!r.ok) throw new Error('块没造出来：' + r.error);
  var kids = [];
  (kidTexts || []).forEach(function (text) {
    var k = { id: 'k_' + text, text: text, completed: false, createdAt: 1 };
    r.block.tasks.push(k);
    kids.push(k);
  });
  r.block.completed = Store.blockDone(r.block.tasks);
  return { block: r.block, kids: kids };
}

function poolNames(data) {
  return (data.pool || []).map(function (x) { return x.text; }).join(',');
}

// ---------------------------------------------------------------------------
h.group('addPoolBlock：池里直接建任务块');

t('往池里加一个空块，结构合法', function () {
  var data = fresh();
  var r = TaskOps.addPoolBlock(data, '要打包的东西');

  h.assertTrue(r.ok);
  h.assertEqual(r.block.type, 'block');
  h.assertEqual(r.block.text, '要打包的东西');
  h.assertEqual(r.block.tasks.length, 0);
  h.assertEqual(data.pool.length, 1);
  h.assertEqual(data.pool[0].id, r.block.id);
});

t('空文本 / 只有空白 → 拒绝', function () {
  var data = fresh();
  h.assertEqual(TaskOps.addPoolBlock(data, '').error, TaskOps.ERR.EMPTY_TEXT);
  h.assertEqual(TaskOps.addPoolBlock(data, '   ').error, TaskOps.ERR.EMPTY_TEXT);
  h.assertEqual(data.pool.length, 0, '拒绝不留痕迹');
});

t('首尾空白去掉', function () {
  var data = fresh();
  var r = TaskOps.addPoolBlock(data, '  搬家  ');
  h.assertEqual(r.block.text, '搬家');
});

// ---------------------------------------------------------------------------
h.group('addPoolBlockTask：往池内块里加任务');

t('加进指定块，DDL 默认查看日期 + 7 天', function () {
  var data = fresh();
  var blk = TaskOps.addPoolBlock(data, '块').block;

  var r = TaskOps.addPoolBlockTask(data, DATE, blk.id, '打包装箱');

  h.assertTrue(r.ok);
  h.assertEqual(blk.tasks.length, 1);
  h.assertEqual(blk.tasks[0].text, '打包装箱');
  h.assertEqual(blk.tasks[0].plannedDate, '2026-10-08', '+7 天');
  h.assertEqual(blk.completed, false, '还没勾完');
});

t('块内任务加进去后，块完成状态按派生重算', function () {
  var data = fresh();
  var blk = TaskOps.addPoolBlock(data, '块').block;
  TaskOps.addPoolBlockTask(data, DATE, blk.id, '唯一的任务');

  h.assertEqual(blk.completed, false, '新任务没勾完，块不能算完成');
});

t('块 id 不存在 / 不是块 → NOT_FOUND', function () {
  var data = fresh();
  var task = TaskOps.addPoolItem(data, DATE, '普通任务').task;

  h.assertEqual(TaskOps.addPoolBlockTask(data, DATE, 'no-such', 'x').error,
    TaskOps.ERR.NOT_FOUND);
  h.assertEqual(TaskOps.addPoolBlockTask(data, DATE, task.id, 'x').error,
    TaskOps.ERR.NOT_FOUND, '普通任务不是块，不能往里塞任务');
});

t('空文本 / 日期不合法 → 各自报错', function () {
  var data = fresh();
  var blk = TaskOps.addPoolBlock(data, '块').block;

  h.assertEqual(TaskOps.addPoolBlockTask(data, DATE, blk.id, '  ').error,
    TaskOps.ERR.EMPTY_TEXT);
  h.assertEqual(TaskOps.addPoolBlockTask(data, '2026-13-01', blk.id, 'x').error,
    TaskOps.ERR.BAD_DATE);
  h.assertEqual(blk.tasks.length, 0, '失败不留痕迹');
});

// ---------------------------------------------------------------------------
h.group('postponeBlock：象限里的块整体进池');

t('整块搬进池，象限里消失，DDL 逐条设到块内任务', function () {
  var data = fresh();
  var q = quadrantBlock(data, 'I', '整块搬家', ['甲', '乙']);

  var r = TaskOps.postponeBlock(data, DATE, 'I', q.block.id);

  h.assertTrue(r.ok);
  h.assertEqual(Store.getDayTasks(data, DATE).I.length, 0, '象限里没了');
  h.assertEqual(data.pool.length, 1);
  h.assertEqual(data.pool[0].id, q.block.id, '就是同一块，不是复制品');
  h.assertEqual(data.pool[0].tasks.length, 2);
  h.assertEqual(data.pool[0].tasks[0].plannedDate, '2026-10-02', '+1 天');
  h.assertEqual(data.pool[0].tasks[1].plannedDate, '2026-10-02');
  h.assertEqual(data.pool[0].plannedDate, undefined, '块自己是容器，不设 DDL');
});

t('空块也能整体推迟，只是没有可设 DDL 的任务', function () {
  var data = fresh();
  var q = quadrantBlock(data, 'I', '空块', []);

  var r = TaskOps.postponeBlock(data, DATE, 'I', q.block.id);

  h.assertTrue(r.ok);
  h.assertEqual(data.pool[0].tasks.length, 0);
});

t('整天空了要收掉', function () {
  var data = fresh();
  var q = quadrantBlock(data, 'I', '唯一的东西', ['甲']);

  TaskOps.postponeBlock(data, DATE, 'I', q.block.id);

  h.assertEqual(data.dates[DATE], undefined, '掏空的一整天收掉');
});

t('块 id 不存在 / 日期不合法 → 各自报错', function () {
  var data = fresh();
  var q = quadrantBlock(data, 'I', '块', []);

  h.assertEqual(TaskOps.postponeBlock(data, DATE, 'I', 'no-such').error,
    TaskOps.ERR.NOT_FOUND);
  h.assertEqual(TaskOps.postponeBlock(data, '2026-13-01', 'I', q.block.id).error,
    TaskOps.ERR.BAD_DATE);
  h.assertEqual(data.dates[DATE].I.length, 1, '失败不动数据');
});

// ---------------------------------------------------------------------------
h.group('locatePoolItem：顶层任务 / 顶层块 / 块内任务都能定位');

t('三种位置都能找到，块内返回宿主块', function () {
  var data = fresh();
  var topTask = TaskOps.addPoolItem(data, DATE, '顶层任务').task;
  var blk = TaskOps.addPoolBlock(data, '顶层块').block;
  var kid = TaskOps.addPoolBlockTask(data, DATE, blk.id, '块内任务').task;

  h.assertEqual(TaskOps.locatePoolItem(data, topTask.id).container, 'pool');
  h.assertEqual(TaskOps.locatePoolItem(data, blk.id).container, 'pool');
  h.assertEqual(TaskOps.locatePoolItem(data, blk.id).item.type, 'block');

  var found = TaskOps.locatePoolItem(data, kid.id);
  h.assertEqual(found.container, 'block');
  h.assertEqual(found.block.id, blk.id);
  h.assertEqual(found.item.id, kid.id);

  h.assertNull(TaskOps.locatePoolItem(data, 'no-such'));
});

// ---------------------------------------------------------------------------
h.group('拖回象限：池内块里的任务也能拖回来（v2.5）');

t('块内任务拖回象限：从宿主块摘出，宿主块完成度重算', function () {
  var data = fresh();
  var blk = TaskOps.addPoolBlock(data, '搬家').block;
  var k1 = TaskOps.addPoolBlockTask(data, DATE, blk.id, '打包装箱').task;
  TaskOps.addPoolBlockTask(data, DATE, blk.id, '联系搬家公司');
  k1.completed = true;   // 直接改数据模拟「已完成」（池内任务没有勾选框）
  blk.completed = Store.blockDone(blk.tasks);

  var r = TaskOps.restoreFromPool(data, DATE, 'II', k1.id);

  h.assertTrue(r.ok, '块内任务不该再静默失败');
  h.assertEqual(data.dates[DATE].II[0].text, '打包装箱', '落到目标象限');
  h.assertEqual(blk.tasks.length, 1, '从宿主块里摘出去了');
  h.assertEqual(poolNames(data), '搬家', '块本体还在池里');
  h.assertFalse(blk.completed, '宿主块完成度重算：剩的那条没做完 → 未完成');
});

t('块内任务拖回时按占位符承诺的位置插', function () {
  var data = fresh();
  var blk = TaskOps.addPoolBlock(data, '块').block;
  var kid = TaskOps.addPoolBlockTask(data, DATE, blk.id, '池里的子').task;

  TaskOps.addTask(data, DATE, 'II', '乙二');
  TaskOps.addTask(data, DATE, 'II', '甲二');   // 新任务加在开头 → II = 甲二,乙二
  TaskOps.restoreFromPool(data, DATE, 'II', kid.id, 1);

  h.assertEqual(data.dates[DATE].II.map(function (x) { return x.text; }).join(','),
    '甲二,池里的子,乙二');
});

t('块被摘空：空块留在池里（空块合法），不报错', function () {
  var data = fresh();
  var blk = TaskOps.addPoolBlock(data, '块').block;
  var kid = TaskOps.addPoolBlockTask(data, DATE, blk.id, '唯一的子').task;

  h.assertTrue(TaskOps.restoreFromPool(data, DATE, 'III', kid.id).ok);
  h.assertEqual(blk.tasks.length, 0);
  h.assertEqual(poolNames(data), '块');
});

t('顶层池任务照旧能拖回（不回归）', function () {
  var data = fresh();
  var top = TaskOps.addPoolItem(data, DATE, '顶层池任务').task;

  h.assertTrue(TaskOps.restoreFromPool(data, DATE, 'IV', top.id).ok);
  h.assertEqual(data.dates[DATE].IV[0].text, '顶层池任务');
  h.assertEqual(poolNames(data), '', '池里出去了就没了');
});

t('id 不存在仍然 NOT_FOUND', function () {
  var data = fresh();
  TaskOps.addPoolBlock(data, '块');
  h.assertFalse(TaskOps.restoreFromPool(data, DATE, 'I', 'no-such').ok);
});

// ---------------------------------------------------------------------------
h.group('DDL 以任务为单位：块内任务也能改 DDL / 删 / 改文字');

t('setPoolDate 能设 / 清块内任务的完成时间', function () {
  var data = fresh();
  var blk = TaskOps.addPoolBlock(data, '块').block;
  var kid = TaskOps.addPoolBlockTask(data, DATE, blk.id, '任务').task;

  h.assertTrue(TaskOps.setPoolDate(data, kid.id, '2026-11-01').ok);
  h.assertEqual(kid.plannedDate, '2026-11-01');

  h.assertTrue(TaskOps.setPoolDate(data, kid.id, null).ok);
  h.assertEqual(kid.plannedDate, undefined, '清除 = 字段整个删掉');
});

t('editPoolItem 能改块内任务的文字', function () {
  var data = fresh();
  var blk = TaskOps.addPoolBlock(data, '块').block;
  var kid = TaskOps.addPoolBlockTask(data, DATE, blk.id, '原名').task;

  var r = TaskOps.editPoolItem(data, kid.id, '新名');
  h.assertTrue(r.ok);
  h.assertEqual(kid.text, '新名');
});

t('removePoolItem 删块内任务，宿主块完成状态重算', function () {
  var data = fresh();
  var blk = TaskOps.addPoolBlock(data, '块').block;
  var k1 = TaskOps.addPoolBlockTask(data, DATE, blk.id, '一').task;
  var k2 = TaskOps.addPoolBlockTask(data, DATE, blk.id, '二').task;
  k1.completed = true; // 直接改数据模拟「一」已完成（池内任务没有勾选框）

  var r = TaskOps.removePoolItem(data, k2.id); // 删掉没勾的「二」
  h.assertTrue(r.ok);
  h.assertEqual(blk.tasks.length, 1);
  h.assertEqual(blk.completed, true, '剩一条勾完的 → 块完成');
});

t('removePoolItem 删整个块，连块内任务一起', function () {
  var data = fresh();
  var blk = TaskOps.addPoolBlock(data, '块').block;
  TaskOps.addPoolBlockTask(data, DATE, blk.id, '一');
  TaskOps.addPoolBlockTask(data, DATE, blk.id, '二');

  var r = TaskOps.removePoolItem(data, blk.id);
  h.assertTrue(r.ok);
  h.assertEqual(r.task.type, 'block');
  h.assertEqual(data.pool.length, 0);
});

// ---------------------------------------------------------------------------
h.group('序列化 / 导入：池里的块跟着走');

t('序列化 → normalize 往返，池里的块和 DDL 不丢', function () {
  var data = fresh();
  var blk = TaskOps.addPoolBlock(data, '块').block;
  TaskOps.addPoolBlockTask(data, DATE, blk.id, '任务');

  var round = Store.normalize(JSON.parse(Store.serialize(data)));

  h.assertEqual(round.data.pool.length, 1);
  h.assertEqual(round.data.pool[0].type, 'block');
  h.assertEqual(round.data.pool[0].tasks[0].text, '任务');
  h.assertEqual(round.data.pool[0].tasks[0].plannedDate, '2026-10-08');
});

t('导入：文件里的池块合法，合并进来换新 id，块内任务 DDL 保留', function () {
  var file = JSON.stringify({
    user: 'default', schemaVersion: 1,
    dates: {},
    pool: [{
      id: 'f_blk', type: 'block', text: '文件里的块', completed: false, createdAt: 1000,
      tasks: [{ id: 'f_k', text: '子任务', completed: false, createdAt: 1000, plannedDate: '2026-12-01' }]
    }]
  });

  var data = fresh();
  var r = Importer.importText(data, file);

  h.assertTrue(r.ok);
  h.assertEqual(data.pool.length, 1);
  h.assertEqual(data.pool[0].type, 'block');
  h.assertFalse(data.pool[0].id === 'f_blk', '块换新 id');
  h.assertEqual(data.pool[0].tasks[0].plannedDate, '2026-12-01', 'DDL 跟着走');
});

// ---------------------------------------------------------------------------

h.summary('计划池任务块（需求 4）');
