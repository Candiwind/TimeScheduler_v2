/**
 * test-blocks.js
 *
 * 检查「任务块」这套东西的核心规矩（见 DS 2.10 / FS v1.1）：
 *
 *   规矩 1. 块只有一层 —— 块里能放任务，不能放块
 *   规矩 2. 块的完成状态是**派生**的：全看块内任务，块自己不存「真相」
 *   规矩 3. 混排 —— 块和普通任务在同一个列表里，拖拽就是列表重排
 *   规矩 4. 空块合法 —— 新建出来还没放任务，不算完成、也不算坏数据
 *
 *   以及：统计口径（块数块内，壳自己不算）、findTask 穿透块、
 *   旧数据兼容（没有 type 字段的老任务照常加载）。
 *
 * 跑法：node test/test-blocks.js
 */
'use strict';

var h = require('./harness');
var Store = require('../js/store');
var TaskOps = require('../js/task-ops');
var CONFIG = require('../js/config');

var t = h.test;
var DATE = '2026-10-01';

function fresh() {
  return Store.createEmpty();
}

/** 加一条任务，返回 id */
function add(data, quadrant, text) {
  var r = TaskOps.addTask(data, DATE, quadrant, text);
  if (!r.ok) throw new Error('任务没造出来：' + r.error);
  return r.task.id;
}

/** 加一个块，返回块对象 */
function addBlk(data, quadrant, text) {
  var r = TaskOps.addBlock(data, DATE, quadrant, text);
  if (!r.ok) throw new Error('块没造出来：' + r.error);
  return r.block;
}

/** 往块里放一条任务（直接构造，走 normalize 也认的形状） */
function putInBlock(block, text, completed) {
  var task = {
    id: 't_' + text + '_' + Math.random().toString(36).slice(2, 8),
    text: text,
    completed: !!completed,
    createdAt: Date.now()
  };
  block.tasks.push(task);
  return task;
}

/** 顶层第 index 个条目 */
function itemAt(data, quadrant, index) {
  return Store.getDayTasks(data, DATE)[quadrant][index];
}

/** 顶层条目文本序列（块显示块名），用来断言顺序 */
function orderOf(data, quadrant) {
  return Store.getDayTasks(data, DATE)[quadrant].map(function (item) {
    return item.type === 'block' ? '【' + item.text + '】' : item.text;
  }).join(',');
}

/** 在块里找任务文本对应的任务对象 */
function taskInBlock(block, text) {
  for (var i = 0; i < block.tasks.length; i++) {
    if (block.tasks[i].text === text) return block.tasks[i];
  }
  return null;
}

/** 按 id 在真实数据里找条目（顶层或块内；getDayTasks 返回的是副本，不能用） */
function realItem(data, quadrant, id) {
  var list = data.dates[DATE][quadrant];
  for (var i = 0; i < list.length; i++) {
    var item = list[i];
    if (item.id === id) return item;
    var tasks = item.tasks;
    if (Array.isArray(tasks)) {
      for (var k = 0; k < tasks.length; k++) {
        if (tasks[k].id === id) return tasks[k];
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
h.group('Store.blockDone：块的完成是派生的（规矩 2）');

t('空块不算完成（和 allStagesDone 相反 —— 空块不是「都做完了」）', function () {
  h.assertEqual(Store.blockDone([]), false);
});

t('块内全勾（含任务自己的阶段）→ true', function () {
  var data = fresh();
  var block = addBlk(data, 'I', '晨间例程');

  var a = putInBlock(block, '喝水', true);
  a.stages = [
    { id: 's1', text: '烧水', completed: true, createdAt: 1 },
    { id: 's2', text: '倒水', completed: true, createdAt: 2 }
  ];

  putInBlock(block, '锻炼', true);

  h.assertEqual(Store.blockDone(block.tasks), true);
});

t('有一条没勾 → false', function () {
  var data = fresh();
  var block = addBlk(data, 'I', '晨间例程');
  putInBlock(block, '喝水', true);
  putInBlock(block, '锻炼', false);

  h.assertEqual(Store.blockDone(block.tasks), false);
});

// ---------------------------------------------------------------------------
h.group('normalize：块数据进进出出（规矩 1 / 4、旧数据兼容）');

/** 把一份原始数据塞进存储，再 load 出来（load 会走 normalize） */
function loadRaw(raw) {
  var storage = h.createMemoryStorage();
  Store.init({ storage: storage, clock: function () { return 1759300000000; } });
  storage.setItem(CONFIG.KEYS.userData, JSON.stringify(raw));
  return Store.load();
}

t('块存 → 读回来，结构原样', function () {
  var storage = h.createMemoryStorage();
  Store.init({ storage: storage, clock: function () { return 1759300000000; } });

  var data = Store.load().data;
  var block = addBlk(data, 'I', '晨间例程');
  var a = putInBlock(block, '喝水', true);
  putInBlock(block, '锻炼', false);
  h.assertTrue(Store.save(data).ok);

  var back = Store.load().data;
  var got = back.dates[DATE].I[0];
  h.assertEqual(got.type, 'block');
  h.assertEqual(got.text, '晨间例程');
  h.assertEqual(got.tasks.length, 2);
  h.assertEqual(got.tasks[0].id, a.id, '任务 id 不该被换掉');
  h.assertEqual(got.tasks[0].text, '喝水');
  h.assertEqual(got.tasks[0].completed, true);
  h.assertEqual(got.completed, false, '有一条没勾，块就该是未完成');
});

t('空块也能存、也能读回来（规矩 4）', function () {
  var storage = h.createMemoryStorage();
  Store.init({ storage: storage, clock: function () { return 1759300000000; } });

  var data = Store.load().data;
  addBlk(data, 'I', '还没想好放什么');
  h.assertTrue(Store.save(data).ok);

  var back = Store.load().data;
  var got = back.dates[DATE].I[0];
  h.assertEqual(got.type, 'block');
  h.assertEqual(got.tasks.length, 0);
  h.assertEqual(got.completed, false);
});

t('块里套块：脏数据，内层块被丢掉（规矩 1）', function () {
  var result = loadRaw({
    schemaVersion: 1,
    dates: {
      '2026-10-01': {
        I: [{
          id: 'b1', type: 'block', text: '外层', completed: false, createdAt: 1,
          tasks: [
            { id: 't1', text: '正常任务', completed: false, createdAt: 1 },
            { id: 'b2', type: 'block', text: '里头还套了一层', completed: false, createdAt: 1, tasks: [] }
          ]
        }],
        II: [], III: [], IV: []
      }
    }
  });

  var block = result.data.dates[DATE].I[0];
  h.assertEqual(block.type, 'block');
  h.assertEqual(block.tasks.length, 1, '内层块该被丢掉');
  h.assertEqual(block.tasks[0].text, '正常任务');
});

t('块的 completed 和块内对不上时，以块内为准重算', function () {
  var result = loadRaw({
    schemaVersion: 1,
    dates: {
      '2026-10-01': {
        I: [{
          id: 'b1', type: 'block', text: '块', completed: true, createdAt: 1,
          tasks: [{ id: 't1', text: '没做完', completed: false, createdAt: 1 }]
        }],
        II: [], III: [], IV: []
      }
    }
  });

  h.assertEqual(result.data.dates[DATE].I[0].completed, false);
});

t('旧数据（没有 type 字段）照常加载，不受影响', function () {
  var result = loadRaw({
    schemaVersion: 1,
    dates: {
      '2026-10-01': {
        I: [
          { id: 't1', text: '老任务', completed: true, createdAt: 1,
            stages: [{ id: 's1', text: '老阶段', completed: true, createdAt: 1 }] },
          { id: 't2', text: '老任务二', completed: false, createdAt: 1 }
        ],
        II: [], III: [], IV: []
      }
    }
  });

  h.assertTrue(!!result.data, '能正常加载出来');
  var list = result.data.dates[DATE].I;
  h.assertEqual(list.length, 2);
  h.assertEqual(list[0].type, undefined, '不该被强行贴上 type 标记');
  h.assertEqual(list[0].completed, true);
  h.assertEqual(list[1].text, '老任务二');
});

t('块里文本为空的任务被丢掉，剩下的保留', function () {
  var result = loadRaw({
    schemaVersion: 1,
    dates: {
      '2026-10-01': {
        I: [{
          id: 'b1', type: 'block', text: '块', completed: false, createdAt: 1,
          tasks: [
            { id: 't1', text: '好的', completed: false, createdAt: 1 },
            { id: 't2', text: '   ', completed: false, createdAt: 1 }
          ]
        }],
        II: [], III: [], IV: []
      }
    }
  });

  var block = result.data.dates[DATE].I[0];
  h.assertEqual(block.tasks.length, 1);
  h.assertEqual(block.tasks[0].text, '好的');
});

// ---------------------------------------------------------------------------
h.group('块的增删改（task-ops）');

t('新建块：加在象限顶层开头，是个空块（需求 3）', function () {
  var data = fresh();
  add(data, 'I', '已有任务');
  var block = addBlk(data, 'I', '新块');

  var list = Store.getDayTasks(data, DATE).I;
  h.assertEqual(list.length, 2);
  h.assertEqual(list[0].id, block.id, '块排最前');
  h.assertEqual(block.tasks.length, 0);
  h.assertEqual(block.completed, false);
});

t('块名改空 —— 拒绝，原名保留', function () {
  var data = fresh();
  var block = addBlk(data, 'I', '原来的名字');

  var r = TaskOps.editBlock(data, DATE, 'I', block.id, '   ');
  h.assertFalse(r.ok);
  h.assertEqual(r.error, TaskOps.ERR.EMPTY_TEXT);
  h.assertEqual(itemAt(data, 'I', 0).text, '原来的名字');
});

t('改块名成功', function () {
  var data = fresh();
  var block = addBlk(data, 'I', '旧名');
  h.assertTrue(TaskOps.editBlock(data, DATE, 'I', block.id, '  新名 ').ok);
  h.assertEqual(itemAt(data, 'I', 0).text, '新名');
});

t('toggleBlock：一键全勾块内所有任务（连阶段一起）', function () {
  var data = fresh();
  var block = addBlk(data, 'I', '晨间例程');
  var a = putInBlock(block, '喝水');
  a.stages = [
    { id: 's1', text: '烧水', completed: false, createdAt: 1 },
    { id: 's2', text: '倒水', completed: false, createdAt: 1 }
  ];
  putInBlock(block, '锻炼');

  h.assertTrue(TaskOps.toggleBlock(data, DATE, 'I', block.id, true).ok);

  h.assertEqual(block.tasks[0].completed, true);
  h.assertEqual(block.tasks[0].stages[0].completed, true);
  h.assertEqual(block.tasks[0].stages[1].completed, true);
  h.assertEqual(block.tasks[1].completed, true);
  h.assertEqual(block.completed, true);
});

t('toggleBlock 再点一下 = 全不选', function () {
  var data = fresh();
  var block = addBlk(data, 'I', '块');
  putInBlock(block, '甲', true);
  putInBlock(block, '乙', true);

  TaskOps.toggleBlock(data, DATE, 'I', block.id, true);
  TaskOps.toggleBlock(data, DATE, 'I', block.id, false);

  h.assertEqual(block.tasks[0].completed, false);
  h.assertEqual(block.tasks[1].completed, false);
  h.assertEqual(block.completed, false);
});

t('toggleBlock 不传值 = 取反（部分完成时是「全勾上」）', function () {
  var data = fresh();
  var block = addBlk(data, 'I', '块');
  putInBlock(block, '甲', true);
  putInBlock(block, '乙', false);

  TaskOps.toggleBlock(data, DATE, 'I', block.id);   // 1/2 → 2/2

  h.assertEqual(block.tasks[1].completed, true);
  h.assertEqual(block.completed, true);
});

t('空块上勾选框：设了也没有可设的，completed 保持 false（规矩 2 × 规矩 4）', function () {
  var data = fresh();
  var block = addBlk(data, 'I', '空块');

  TaskOps.toggleBlock(data, DATE, 'I', block.id, true);
  h.assertEqual(block.completed, false);
  h.assertEqual(TaskOps.progressOfItem(block).isComplete, false);
});

t('toggleItem：块 id 走块逻辑，任务 id 走任务逻辑', function () {
  var data = fresh();
  var block = addBlk(data, 'I', '块');
  var inner = putInBlock(block, '块里的');
  var top = add(data, 'I', '顶层的');

  // 块 id → 一键全勾块内
  h.assertTrue(TaskOps.toggleItem(data, DATE, 'I', block.id, true).ok);
  h.assertEqual(block.completed, true);
  h.assertEqual(taskInBlock(block, '块里的').completed, true);

  // 顶层任务的 id → 只动它自己，块不受影响
  h.assertTrue(TaskOps.toggleItem(data, DATE, 'I', top, false).ok);
  h.assertEqual(realItem(data, 'I', top).completed, false);
  h.assertEqual(block.completed, true, '勾顶层任务不该动到块');

  // 块内任务的 id → 动它自己，块跟着重算
  h.assertTrue(TaskOps.toggleItem(data, DATE, 'I', inner.id, false).ok);
  h.assertEqual(inner.completed, false);
  h.assertEqual(block.completed, false, '块内唯一任务取消 → 块回未完成');
});

t('editItem：块 id 改块名，任务 id 改文本', function () {
  var data = fresh();
  var block = addBlk(data, 'I', '块');
  var inner = putInBlock(block, '块里的');

  h.assertTrue(TaskOps.editItem(data, DATE, 'I', block.id, '新块名').ok);
  h.assertEqual(block.text, '新块名');
  h.assertTrue(TaskOps.editItem(data, DATE, 'I', inner.id, '新文本').ok);
  h.assertEqual(inner.text, '新文本');
});

t('removeItem 删块：连块内任务一起删，返回里说清楚', function () {
  var data = fresh();
  var block = addBlk(data, 'I', '要删的块');
  putInBlock(block, '甲');
  putInBlock(block, '乙');
  add(data, 'I', '留下的');

  var r = TaskOps.removeItem(data, DATE, 'I', block.id);
  h.assertTrue(r.ok);
  h.assertEqual(r.kind, 'block');
  h.assertEqual(r.block.text, '要删的块');
  h.assertEqual(r.taskCount, 2);

  var list = Store.getDayTasks(data, DATE).I;
  h.assertEqual(list.length, 1);
  h.assertEqual(list[0].text, '留下的');
});

t('removeItem 删块内任务：从块里摘掉，块还在', function () {
  var data = fresh();
  var block = addBlk(data, 'I', '块');
  var a = putInBlock(block, '甲');
  putInBlock(block, '乙');

  var r = TaskOps.removeItem(data, DATE, 'I', a.id);
  h.assertTrue(r.ok);
  h.assertEqual(r.kind, 'task');
  h.assertEqual(block.tasks.length, 1);
  h.assertEqual(block.tasks[0].text, '乙');
  h.assertEqual(block.completed, false);
});

t('删光块内任务再删块，整天空了要收掉', function () {
  var data = fresh();
  var block = addBlk(data, 'I', '唯一的块');
  var a = putInBlock(block, '甲');

  TaskOps.removeItem(data, DATE, 'I', a.id);
  TaskOps.removeItem(data, DATE, 'I', block.id);

  h.assertEqual(data.dates[DATE], undefined, '整天都空了，日期该被收掉');
});

// ---------------------------------------------------------------------------
h.group('块内任务：findTask 穿透块，老操作原样可用');

t('块内任务能勾选，块的完成状态跟着同步（规矩 2）', function () {
  var data = fresh();
  var block = addBlk(data, 'I', '块');
  var a = putInBlock(block, '甲');
  putInBlock(block, '乙');

  h.assertTrue(TaskOps.toggleTask(data, DATE, 'I', a.id, true).ok);
  h.assertEqual(a.completed, true);
  h.assertEqual(block.completed, false, '还剩一条');

  var b = taskInBlock(block, '乙');
  TaskOps.toggleTask(data, DATE, 'I', b.id, true);
  h.assertEqual(block.completed, true, '全勾完块自动完成');
});

t('给块内任务加阶段、勾阶段，照常工作', function () {
  var data = fresh();
  var block = addBlk(data, 'I', '块');
  var a = putInBlock(block, '带步骤的');

  var s = TaskOps.addStage(data, DATE, 'I', a.id, '第一步');
  h.assertTrue(s.ok, 'findTask 穿透块后 addStage 应该找得到');
  TaskOps.toggleStage(data, DATE, 'I', a.id, s.stage.id, true);

  h.assertEqual(a.stages.length, 1);
  h.assertEqual(a.stages[0].completed, true);
  h.assertEqual(block.completed, true, '唯一任务全完成 → 块完成');
});

t('块内任务的阶段也能在任务内部换顺序', function () {
  var data = fresh();
  var block = addBlk(data, 'I', '块');
  var a = putInBlock(block, '任务');
  var s1 = TaskOps.addStage(data, DATE, 'I', a.id, '一').stage;
  TaskOps.addStage(data, DATE, 'I', a.id, '二');
  TaskOps.addStage(data, DATE, 'I', a.id, '三');

  TaskOps.moveStage(data, DATE, 'I', a.id, s1.id, 2);
  h.assertEqual(a.stages.map(function (s) { return s.text; }).join(','), '二,三,一');
});

t('改块内任务的文字', function () {
  var data = fresh();
  var block = addBlk(data, 'I', '块');
  var a = putInBlock(block, '旧的');

  h.assertTrue(TaskOps.editTask(data, DATE, 'I', a.id, '新的').ok);
  h.assertEqual(a.text, '新的');
});

// ---------------------------------------------------------------------------
h.group('progressOfItem 与统计口径');

t('块：done/total 数块内最细单位，壳自己不算一条', function () {
  var data = fresh();
  var block = addBlk(data, 'I', '块');

  var a = putInBlock(block, '甲');
  a.stages = [
    { id: 's1', text: '一', completed: true, createdAt: 1 },
    { id: 's2', text: '二', completed: false, createdAt: 1 }
  ];
  putInBlock(block, '乙', true);

  var p = TaskOps.progressOfItem(block);
  h.assertEqual(p.total, 3, '阶段 2 + 任务乙 1，壳不算');
  h.assertEqual(p.done, 2);
  h.assertEqual(p.isComplete, false);
});

t('空块：0/0，不算完成也不炸（规矩 4）', function () {
  var data = fresh();
  var block = addBlk(data, 'I', '空块');

  var p = TaskOps.progressOfItem(block);
  h.assertEqual(p.total, 0);
  h.assertEqual(p.done, 0);
  h.assertEqual(p.isComplete, false);
});

t('getStats：块内按最细单位计入，和顶层任务一个口径', function () {
  var data = fresh();
  add(data, 'I', '普通任务');                       // 1 条
  var block = addBlk(data, 'I', '块');
  putInBlock(block, '甲', true);                    // 1 条，完成
  var c = putInBlock(block, '丙');
  c.stages = [
    { id: 's1', text: '一', completed: true, createdAt: 1 },
    { id: 's2', text: '二', completed: false, createdAt: 1 }
  ];                                                // 2 条，完成 1

  var s = TaskOps.getStats(data, DATE);
  h.assertEqual(s.total, 4, '1 + 1 + 2，块壳不算');
  h.assertEqual(s.done, 2);
  h.assertEqual(s.remaining, 2);
});

t('象限标题栏的计数和顶部统计同口径（块不虚增总数）', function () {
  // 这个口径一致性由 render 的 progressOf 保证 —— 数据侧先确认 progressOfItem
  var data = fresh();
  var block = addBlk(data, 'I', '块');
  putInBlock(block, '甲', true);

  var p = TaskOps.progressOfItem(block);
  h.assertEqual(p.total, 1);
  h.assertEqual(p.done, 1);
  h.assertEqual(p.isComplete, true);
});

// ---------------------------------------------------------------------------
h.group('混排与移动（规矩 3：同一个列表，拖拽就是重排）');

t('moveItem：顶层任务换位，块和任务互不干扰', function () {
  var data = fresh();
  add(data, 'I', '甲');
  var block = addBlk(data, 'I', '块');
  putInBlock(block, '块内的');
  var yi = add(data, 'I', '乙');
  // 新任务默认加在开头（需求 3）：此时顶层顺序是 乙,【块】,甲

  // 把「乙」从最前挪到最后
  h.assertTrue(TaskOps.moveItem(data, DATE, {
    kind: 'task', id: yi,
    toQuadrantId: 'I', toBlockId: null, toIndex: 2
  }).ok);

  h.assertEqual(orderOf(data, 'I'), '【块】,甲,乙');
  h.assertEqual(block.tasks.length, 1, '块里的不受影响');
});

t('moveItem：顶层任务进块（落到块内第几位就待在第几位）', function () {
  var data = fresh();
  var block = addBlk(data, 'I', '块');
  putInBlock(block, '已在块里的甲');
  putInBlock(block, '已在块里的乙');
  var mover = add(data, 'II', '要进块的');

  h.assertTrue(TaskOps.moveItem(data, DATE, {
    kind: 'task', id: mover,
    toQuadrantId: 'I', toBlockId: block.id, toIndex: 1
  }).ok);

  h.assertEqual(block.tasks.map(function (x) { return x.text; }).join(','), '已在块里的甲,要进块的,已在块里的乙');
  h.assertEqual(Store.getDayTasks(data, DATE).II.length, 0, '原象限该被摘干净');
});

t('moveItem：块内任务拖出来，源块完成状态重算', function () {
  var data = fresh();
  var block = addBlk(data, 'I', '块');
  putInBlock(block, '甲', true);
  var undone = putInBlock(block, '乙', false);
  add(data, 'IV', '原住民');

  // 拿走的正是那条没完成的 —— 剩下的甲是完成的，块要翻成完成态
  h.assertTrue(TaskOps.moveItem(data, DATE, {
    kind: 'task', id: undone.id,
    toQuadrantId: 'IV', toBlockId: null, toIndex: 0
  }).ok);

  h.assertEqual(block.tasks.length, 1);
  h.assertEqual(block.completed, true, '没完成的那条被拿走，块该翻成完成');
  h.assertEqual(Store.getDayTasks(data, DATE).IV[0].text, '乙');
});

t('moveItem：从块 A 拖进块 B，两边完成状态都重算', function () {
  var data = fresh();
  var blockA = addBlk(data, 'I', 'A');
  putInBlock(blockA, '甲', true);
  var mover = putInBlock(blockA, '乙', false);   // A 里没完成的那条

  var blockB = addBlk(data, 'II', 'B');
  putInBlock(blockB, '丙', false);

  h.assertTrue(TaskOps.moveItem(data, DATE, {
    kind: 'task', id: mover.id,
    toQuadrantId: 'II', toBlockId: blockB.id, toIndex: 0
  }).ok);

  h.assertEqual(blockA.tasks.length, 1);
  h.assertEqual(blockA.completed, true, 'A 里剩一条已完成的 → 块完成');
  h.assertEqual(blockB.tasks.length, 2);
  h.assertEqual(blockB.completed, false, 'B 里两条都没完成 → 块未完成');
});

t('moveItem：整块跨象限，块内任务和顺序一起走', function () {
  var data = fresh();
  var block = addBlk(data, 'I', '整块搬家');
  putInBlock(block, '甲');
  putInBlock(block, '乙');
  add(data, 'I', '留下来的');
  add(data, 'III', 'III 原住民');

  h.assertTrue(TaskOps.moveItem(data, DATE, {
    kind: 'block', id: block.id,
    toQuadrantId: 'III', toBlockId: null, toIndex: 0
  }).ok);

  h.assertEqual(orderOf(data, 'I'), '留下来的');
  var iii = Store.getDayTasks(data, DATE).III;
  h.assertEqual(iii.length, 2);
  h.assertEqual(iii[0].type, 'block');
  h.assertEqual(iii[0].tasks.map(function (x) { return x.text; }).join(','), '甲,乙');
  h.assertEqual(iii[1].text, 'III 原住民');
});

t('moveItem：块落点带了 toBlockId 也要按顶层处理（规矩 1 数据侧兜底）', function () {
  var data = fresh();
  var blockA = addBlk(data, 'I', 'A');
  var blockB = addBlk(data, 'I', 'B');
  putInBlock(blockA, '甲');

  // 就算上游传了个糊涂的落点（想塞进 B），数据侧也只把它放到顶层
  h.assertTrue(TaskOps.moveItem(data, DATE, {
    kind: 'block', id: blockA.id,
    toQuadrantId: 'I', toBlockId: blockB.id, toIndex: 0
  }).ok);

  var list = Store.getDayTasks(data, DATE).I;
  h.assertEqual(list.length, 2, '顶层还是两个块，谁也没进谁');
  h.assertEqual(list[0].id, blockA.id);
  h.assertEqual(blockB.tasks.length, 0);
});

t('moveItem：同象限内块换位置', function () {
  var data = fresh();
  add(data, 'I', '任务一');
  var block = addBlk(data, 'I', '块');
  add(data, 'I', '任务二');
  // 新任务默认加在开头（需求 3）：此时顶层顺序是 任务二,【块】,任务一

  h.assertTrue(TaskOps.moveItem(data, DATE, {
    kind: 'block', id: block.id,
    toQuadrantId: 'I', toBlockId: null, toIndex: 2
  }).ok);

  h.assertEqual(orderOf(data, 'I'), '任务二,任务一,【块】');
});

t('块内任务 moveTask 到本象限顶层：插到指定位置', function () {
  var data = fresh();
  var block = addBlk(data, 'I', '块');
  var a = putInBlock(block, '从块里出来的');
  add(data, 'I', '顶一');
  add(data, 'I', '顶二');
  // 新任务默认加在开头（需求 3）：此时顶层顺序是 顶二,顶一,【块】

  h.assertTrue(TaskOps.moveTask(data, DATE, a.id, 'I', 1).ok);

  h.assertEqual(orderOf(data, 'I'), '顶二,从块里出来的,顶一,【块】');
  h.assertEqual(block.tasks.length, 0);
});

t('moveItem 的条目不存在 → 报错', function () {
  var data = fresh();
  var r = TaskOps.moveItem(data, DATE, {
    kind: 'task', id: 'id_不存在',
    toQuadrantId: 'I', toBlockId: null, toIndex: 0
  });
  h.assertFalse(r.ok);
  h.assertEqual(r.error, TaskOps.ERR.NOT_FOUND);
});

t('moveItem 不认识 kind → 报错', function () {
  var data = fresh();
  var r = TaskOps.moveItem(data, DATE, {
    kind: 'stage', id: 'x',
    toQuadrantId: 'I', toBlockId: null, toIndex: 0
  });
  h.assertFalse(r.ok);
});

// ---------------------------------------------------------------------------
h.group('块的往返：改完存、存完读');

t('块内任务勾完 → 存 → 读回来，块是完成态', function () {
  var storage = h.createMemoryStorage();
  Store.init({ storage: storage, clock: function () { return 1759300000000; } });

  var data = Store.load().data;
  var block = addBlk(data, 'I', '块');
  putInBlock(block, '甲');
  TaskOps.toggleItem(data, DATE, 'I', block.id, true);
  h.assertTrue(Store.save(data).ok);

  var back = Store.load().data;
  var got = back.dates[DATE].I[0];
  h.assertEqual(got.completed, true);
  h.assertEqual(got.tasks[0].completed, true);
});

// ---------------------------------------------------------------------------

h.summary('任务块（task-ops / store）');
