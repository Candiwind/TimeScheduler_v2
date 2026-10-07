/**
 * test-search.js
 *
 * 检查搜索过滤（需求 3，见 DS 2.28）：
 *
 *   1. filterDayByKeyword：象限视图那份「画出来的内容」按关键词过滤——
 *      普通任务命中才留下；块名命中整块留下；块名不中但子任务命中留块副本；
 *      没命中的象限是空数组（渲染成空白）；返回新对象、不动原数据；
 *   2. filterTimeViewByKeyword：时段组全保留、组内只留命中条目
 *      （没命中的时段块显示空白）；阶段条目顺带看所属任务标注；
 *   3. 空关键词 = 不过滤。
 *
 * 跑法：node test/test-search.js
 */
'use strict';

var h = require('./harness');
var TaskOps = require('../js/task-ops');

var t = h.test;

function task(id, text, stages) {
  var it = { id: id, text: text, completed: false, createdAt: 1 };
  if (stages) {
    it.stages = stages.map(function (s, i) {
      return { id: id + '_s' + i, text: s, completed: false, createdAt: 1 };
    });
  }
  return it;
}

function block(id, text, kids) {
  return { id: id, type: 'block', text: text, completed: false, createdAt: 1, tasks: kids || [] };
}

function day() {
  return {
    I: [task('a', '写季度报告'), block('b', '晨间例程', [task('c', '喝水'), task('d', '写日报')])],
    II: [task('e', '回邮件')],
    III: [task('f', '写周报', ['收集数据', '汇总'])],
    IV: []
  };
}

// ---------------------------------------------------------------------------
h.group('filterDayByKeyword：普通任务');

t('命中的留下，没命中的象限是空数组', function () {
  var out = TaskOps.filterDayByKeyword(day(), '回邮件');

  h.assertEqual(out.I.length, 0, '一象限没命中 → 空白');
  h.assertEqual(out.II.length, 1);
  h.assertEqual(out.II[0].id, 'e');
  h.assertEqual(out.III.length, 0);
  h.assertEqual(out.IV.length, 0);
});

t('大小写不敏感', function () {
  var d = { I: [task('a', 'Fix BUG')], II: [], III: [], IV: [] };
  h.assertEqual(TaskOps.filterDayByKeyword(d, 'bug').I.length, 1);
  h.assertEqual(TaskOps.filterDayByKeyword(d, 'FIX').I.length, 1);
});

t('关键词前后有空白 → trim 后照常命中', function () {
  h.assertEqual(TaskOps.filterDayByKeyword(day(), '  回邮件  ').II.length, 1);
});

t('阶段文字命中 → 宿主任务留下', function () {
  var out = TaskOps.filterDayByKeyword(day(), '收集数据');
  h.assertEqual(out.III.length, 1, '阶段命中要保住它的宿主任务');
  h.assertEqual(out.III[0].id, 'f');
});

// ---------------------------------------------------------------------------
h.group('filterDayByKeyword：任务块');

t('块名命中 → 整块连所有子任务留下', function () {
  var out = TaskOps.filterDayByKeyword(day(), '晨间');
  h.assertEqual(out.I.length, 1, '普通任务不命中，只剩块');
  h.assertEqual(out.I[0].id, 'b');
  h.assertEqual(out.I[0].tasks.length, 2, '块名命中，子任务全留');
});

t('块名不中、子任务命中 → 块副本只含命中子任务', function () {
  var out = TaskOps.filterDayByKeyword(day(), '喝水');
  h.assertEqual(out.I.length, 1, '只剩块（普通任务不命中）');
  h.assertEqual(out.I[0].id, 'b');
  h.assertEqual(out.I[0].tasks.length, 1);
  h.assertEqual(out.I[0].tasks[0].id, 'c');
});

t('块副本是新对象，原块的子任务列表一个字不动', function () {
  var d = day();
  var out = TaskOps.filterDayByKeyword(d, '喝水');

  h.assertFalse(out.I[0] === d.I[1], '过滤出来的是副本，不是原块');
  h.assertEqual(d.I[1].tasks.length, 2, '原数据不动（搜索只是画的时候少画）');
});

t('块和子任务都不命中 → 块整个消失', function () {
  var out = TaskOps.filterDayByKeyword(day(), '不存在的东西');
  h.assertEqual(out.I.length, 0);
  h.assertEqual(out.II.length, 0);
  h.assertEqual(out.III.length, 0);
});

// ---------------------------------------------------------------------------
h.group('filterDayByKeyword：边界');

t('空关键词 / 全空白 → 不过滤，内容全留（浅拷贝新对象）', function () {
  var d = day();
  var out = TaskOps.filterDayByKeyword(d, '');

  h.assertEqual(out.I.length, 2);
  h.assertEqual(out.III.length, 1);
  h.assertFalse(out === d, '返回的始终是新对象');

  var out2 = TaskOps.filterDayByKeyword(d, '   ');
  h.assertEqual(out2.I.length, 2);
});

t('day 为 null / 缺象限数组 → 给四个空数组，不崩', function () {
  var out = TaskOps.filterDayByKeyword(null, 'x');
  h.assertEqual(out.I.length + out.II.length + out.III.length + out.IV.length, 0);

  var out2 = TaskOps.filterDayByKeyword({ I: null }, 'x');
  h.assertEqual(out2.I.length, 0);
});

// ---------------------------------------------------------------------------
h.group('filterTimeViewByKeyword：时段组保留、组内过滤');

function groups() {
  return [
    { slot: '上午', items: [
      { kind: 'task', taskId: 'a', text: '写季度报告', quadrantId: 'I' },
      { kind: 'stage', taskId: 'f', stageId: 's1', text: '收集数据', parentText: '写周报', quadrantId: 'III' }
    ] },
    { slot: '下午', items: [
      { kind: 'task', taskId: 'e', text: '回邮件', quadrantId: 'II' }
    ] }
  ];
}

t('命中的组留命中条目，没命中的组留下但空了（显示空白）', function () {
  var out = TaskOps.filterTimeViewByKeyword(groups(), '回邮件');

  h.assertEqual(out.length, 2, '时段组全保留');
  h.assertEqual(out[0].slot, '上午');
  h.assertEqual(out[0].items.length, 0, '上午没命中 → 空白');
  h.assertEqual(out[1].items.length, 1);
  h.assertEqual(out[1].items[0].taskId, 'e');
});

t('阶段条目按所属任务标注（parentText）也能命中', function () {
  var out = TaskOps.filterTimeViewByKeyword(groups(), '写周报');

  h.assertEqual(out[0].items.length, 1);
  h.assertEqual(out[0].items[0].kind, 'stage', '命中的是阶段条目');
});

t('空关键词 → 原样返回；groups 不是数组 → 空数组', function () {
  var g = groups();
  h.assertTrue(TaskOps.filterTimeViewByKeyword(g, '') === g, '不搜就不动');

  var out = TaskOps.filterTimeViewByKeyword(null, 'x');
  h.assertEqual(out.length, 0);
});

// ---------------------------------------------------------------------------

h.summary('搜索过滤（需求 3）');
