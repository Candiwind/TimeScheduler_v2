/**
 * test-drag-model.js
 *
 * 检查「拖完之后顺序对不对」（见 DS 3.2）：同象限换位置、跨象限移动、拖到末尾。
 *
 * 拖拽分成两半：
 *   - **算落点**：指针坐标 → 第几位。纯几何，在 drag.js 里。
 *   - **真的移动**：把任务挪过去。是数据操作，在 task-ops.js 的 moveTask 里。
 * 两半都在这测。中间那一大坨「接住鼠标和手指」的部分测不了，
 * 只能手工拖（见 DS 3.3）。
 *
 * 跑法：node test/test-drag-model.js
 */
'use strict';

var h = require('./harness');
var Store = require('../js/store');
var TaskOps = require('../js/task-ops');
var Drag = require('../js/drag');

var t = h.test;

var DATE = '2026-10-01';

/** 造一天的数据：{ I: ['甲','乙'], II: ['丙'] } 这种写法 */
function day(spec) {
  var data = Store.createEmpty();
  var quadrants = Object.keys(spec);
  for (var i = 0; i < quadrants.length; i++) {
    var texts = spec[quadrants[i]];
    for (var k = 0; k < texts.length; k++) {
      var r = TaskOps.addTask(data, DATE, quadrants[i], texts[k]);
      if (!r.ok) throw new Error('测试数据没造出来：' + r.error);
    }
  }
  return data;
}

/** 把某个象限的文本列表取出来，方便断言 */
function texts(data, quadrantId) {
  var list = Store.getDayTasks(data, DATE)[quadrantId];
  var out = [];
  for (var i = 0; i < list.length; i++) out.push(list[i].text);
  return out.join(',');
}

/** 找到某条任务的 id */
function idOf(data, quadrantId, text) {
  var list = Store.getDayTasks(data, DATE)[quadrantId];
  for (var i = 0; i < list.length; i++) {
    if (list[i].text === text) return list[i].id;
  }
  throw new Error('找不到任务：' + text);
}

// ---------------------------------------------------------------------------
h.group('同象限换位置');

t('第一条拖到最后', function () {
  var data = day({ I: ['甲', '乙', '丙'] });
  // index = 2 表示「摘出来之后插到第 2 位」，也就是末尾
  TaskOps.moveTask(data, DATE, idOf(data, 'I', '甲'), 'I', 2);
  h.assertEqual(texts(data, 'I'), '乙,丙,甲');
});

t('最后一条拖到最前', function () {
  var data = day({ I: ['甲', '乙', '丙'] });
  TaskOps.moveTask(data, DATE, idOf(data, 'I', '丙'), 'I', 0);
  h.assertEqual(texts(data, 'I'), '丙,甲,乙');
});

t('第一条往后挪一位', function () {
  var data = day({ I: ['甲', '乙', '丙'] });
  TaskOps.moveTask(data, DATE, idOf(data, 'I', '甲'), 'I', 1);
  h.assertEqual(texts(data, 'I'), '乙,甲,丙');
});

t('中间那条往后挪一位', function () {
  var data = day({ I: ['甲', '乙', '丙', '丁'] });
  TaskOps.moveTask(data, DATE, idOf(data, 'I', '乙'), 'I', 2);
  h.assertEqual(texts(data, 'I'), '甲,丙,乙,丁');
});

t('拖回原位等于没动', function () {
  var data = day({ I: ['甲', '乙', '丙'] });
  TaskOps.moveTask(data, DATE, idOf(data, 'I', '乙'), 'I', 1);
  h.assertEqual(texts(data, 'I'), '甲,乙,丙');
});

t('只有一条时怎么拖都不变', function () {
  var data = day({ I: ['甲'] });
  TaskOps.moveTask(data, DATE, idOf(data, 'I', '甲'), 'I', 0);
  h.assertEqual(texts(data, 'I'), '甲');
});

// ---------------------------------------------------------------------------
h.group('跨象限移动');

t('拖到另一个象限的最前面', function () {
  var data = day({ I: ['甲', '乙'], II: ['丙'] });
  TaskOps.moveTask(data, DATE, idOf(data, 'I', '甲'), 'II', 0);

  h.assertEqual(texts(data, 'I'), '乙');
  h.assertEqual(texts(data, 'II'), '甲,丙');
});

t('拖到另一个象限的最后面', function () {
  var data = day({ I: ['甲', '乙'], II: ['丙'] });
  TaskOps.moveTask(data, DATE, idOf(data, 'I', '甲'), 'II', 1);

  h.assertEqual(texts(data, 'II'), '丙,甲');
});

t('拖到另一个象限的中间', function () {
  var data = day({ I: ['甲'], II: ['乙', '丙', '丁'] });
  TaskOps.moveTask(data, DATE, idOf(data, 'I', '甲'), 'II', 1);

  h.assertEqual(texts(data, 'II'), '乙,甲,丙,丁');
});

t('拖到一个空象限', function () {
  var data = day({ I: ['甲'], III: [] });
  TaskOps.moveTask(data, DATE, idOf(data, 'I', '甲'), 'III', 0);

  h.assertEqual(texts(data, 'I'), '');
  h.assertEqual(texts(data, 'III'), '甲');
});

t('源象限被搬空之后，这一天不能整个消失', function () {
  // 任务只是换了个地方，还在的。别把它当成「删干净了」
  var data = day({ I: ['甲'] });
  TaskOps.moveTask(data, DATE, idOf(data, 'I', '甲'), 'IV', 0);

  h.assertTrue(!!data.dates[DATE], '这一天还在');
  h.assertEqual(texts(data, 'IV'), '甲');
});

t('搬走一条不影响同象限的其他任务', function () {
  var data = day({ I: ['甲', '乙', '丙'] });
  TaskOps.moveTask(data, DATE, idOf(data, 'I', '乙'), 'II', 0);

  h.assertEqual(texts(data, 'I'), '甲,丙');
});

// ---------------------------------------------------------------------------
h.group('越界和脏输入都不能把数据弄丢');

t('下标太大 → 夹到最后', function () {
  var data = day({ I: ['甲', '乙', '丙'] });
  TaskOps.moveTask(data, DATE, idOf(data, 'I', '甲'), 'I', 999);
  h.assertEqual(texts(data, 'I'), '乙,丙,甲');
});

t('下标是负数 → 夹到最前', function () {
  var data = day({ I: ['甲', '乙', '丙'] });
  TaskOps.moveTask(data, DATE, idOf(data, 'I', '丙'), 'I', -5);
  h.assertEqual(texts(data, 'I'), '丙,甲,乙');
});

t('下标不是数字 → 放到末尾', function () {
  var data = day({ I: ['甲', '乙'] });
  TaskOps.moveTask(data, DATE, idOf(data, 'I', '甲'), 'I', 'x');
  h.assertEqual(texts(data, 'I'), '乙,甲');
});

t('下标是小数 → 向下取整', function () {
  var data = day({ I: ['甲', '乙', '丙'] });
  TaskOps.moveTask(data, DATE, idOf(data, 'I', '甲'), 'I', 1.9);
  h.assertEqual(texts(data, 'I'), '乙,甲,丙');
});

t('任务不存在 → 报错，一个字节都不动', function () {
  var data = day({ I: ['甲', '乙'] });
  var before = JSON.stringify(data);

  var r = TaskOps.moveTask(data, DATE, 'id_不存在', 'II', 0);

  h.assertFalse(r.ok);
  h.assertEqual(r.error, TaskOps.ERR.NOT_FOUND);
  h.assertEqual(JSON.stringify(data), before, '失败时数据必须原封不动');
});

t('目标象限不认识 → 报错', function () {
  var data = day({ I: ['甲'] });
  var r = TaskOps.moveTask(data, DATE, idOf(data, 'I', '甲'), 'V', 0);
  h.assertFalse(r.ok);
  h.assertEqual(r.error, TaskOps.ERR.BAD_QUADRANT);
});

t('日期不合法 → 报错', function () {
  var data = day({ I: ['甲'] });
  var r = TaskOps.moveTask(data, '2026-13-01', idOf(data, 'I', '甲'), 'II', 0);
  h.assertFalse(r.ok);
  h.assertEqual(r.error, TaskOps.ERR.BAD_DATE);
});

t('不管怎么拖，任务总数永远不变', function () {
  // 这条是本文件最重要的一条：拖拽最怕的就是「拖一下少一条」
  var data = day({ I: ['甲', '乙', '丙'], II: ['丁'], III: [], IV: ['戊', '己'] });
  var before = TaskOps.getStats(data, DATE).total;
  h.assertEqual(before, 6);

  var moves = [
    ['甲', 'IV', 2],
    ['丁', 'I', 0],
    ['己', 'III', 0],
    ['乙', 'II', 1],
    ['戊', 'I', 1]
  ];
  for (var i = 0; i < moves.length; i++) {
    var from = null;
    var quadrants = ['I', 'II', 'III', 'IV'];
    for (var k = 0; k < quadrants.length; k++) {
      try { from = idOf(data, quadrants[k], moves[i][0]); break; } catch (e) { /* 不在这个象限 */ }
    }
    var r = TaskOps.moveTask(data, DATE, from, moves[i][1], moves[i][2]);
    h.assertTrue(r.ok, '第 ' + (i + 1) + ' 次移动失败了：' + r.error);
  }

  h.assertEqual(TaskOps.getStats(data, DATE).total, before, '总数必须一直是 6');
});

t('移动不改变任务内容和勾选状态', function () {
  var data = day({ I: ['甲', '乙'] });
  var id = idOf(data, 'I', '甲');
  TaskOps.toggleTask(data, DATE, 'I', id);

  TaskOps.moveTask(data, DATE, id, 'III', 0);

  var moved = Store.getDayTasks(data, DATE).III[0];
  h.assertEqual(moved.text, '甲');
  h.assertEqual(moved.completed, true, '拖一下不能把勾选弄丢');
  h.assertEqual(moved.id, id, '编号也不该变');
});

// ---------------------------------------------------------------------------
h.group('算落点：指针位置 → 第几位');

function rects(heights) {
  // 造一串从 top=0 开始、依次排下去的矩形
  var out = [];
  var top = 0;
  for (var i = 0; i < heights.length; i++) {
    out.push({ top: top, height: heights[i] });
    top += heights[i];
  }
  return out;
}

t('列表是空的时候 → 第 0 位', function () {
  h.assertEqual(Drag.computeDropIndex([], 100), 0);
});

t('指针在最上面 → 第 0 位', function () {
  // 三条各高 30，范围是 0~90
  h.assertEqual(Drag.computeDropIndex(rects([30, 30, 30]), 0), 0);
});

t('指针在最下面 → 最后一位', function () {
  h.assertEqual(Drag.computeDropIndex(rects([30, 30, 30]), 90), 3);
  h.assertEqual(Drag.computeDropIndex(rects([30, 30, 30]), 500), 3);
});

t('过中点才翻位，没过还是上一位', function () {
  var r = rects([30, 30, 30]); // 中点分别是 15、45、75

  h.assertEqual(Drag.computeDropIndex(r, 14), 0, '第一条的中点之前');
  h.assertEqual(Drag.computeDropIndex(r, 16), 1, '过了第一条中点就该往后一位');

  h.assertEqual(Drag.computeDropIndex(r, 44), 1);
  h.assertEqual(Drag.computeDropIndex(r, 46), 2);

  h.assertEqual(Drag.computeDropIndex(r, 74), 2);
  h.assertEqual(Drag.computeDropIndex(r, 76), 3);
});

t('刚好落在中点上 → 算下一位', function () {
  // 用 < 而不是 <=，保证同一个位置只有一个答案，不会在边界上抖
  h.assertEqual(Drag.computeDropIndex(rects([30, 30]), 15), 1);
});

t('高度不一样也能算对', function () {
  // 一条 20、一条 60
  var r = rects([20, 60]); // 中点 10 和 50
  h.assertEqual(Drag.computeDropIndex(r, 9), 0);
  h.assertEqual(Drag.computeDropIndex(r, 11), 1);
  h.assertEqual(Drag.computeDropIndex(r, 49), 1);
  h.assertEqual(Drag.computeDropIndex(r, 51), 2);
});

// ---------------------------------------------------------------------------

h.summary('拖拽的数据与落点模型');
