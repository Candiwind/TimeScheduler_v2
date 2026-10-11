/**
 * test-store-archive.js
 *
 * 检查 30 天归档窗口的计算，以及归档「只算不改」的约定（见 DS 3.2、2.4）。
 *
 * 特别注意：本文件**不测**下载那一段（那要在浏览器里手工验）。
 * 这里只保证「算出该归档哪些」，以及「套用之后原数据没被就地改坏」。
 *
 * 跑法：node test/test-store-archive.js
 */
'use strict';

var h = require('./harness');
var Store = require('../js/store');
var Util = require('../js/util');
var CONFIG = require('../js/config');

var t = h.test;

function task(text) {
  return { id: 'id_x', text: text, completed: false, createdAt: 1759300000000 };
}

/** 从 startDate 开始连着造 days 天数据，每天一条 */
function buildRange(startDate, days) {
  var data = Store.createEmpty();
  var d = startDate;
  for (var i = 0; i < days; i++) {
    Store.ensureDay(data, d).I.push(task('第 ' + d + ' 天'));
    d = Util.addDays(d, 1);
  }
  return data;
}

// ---------------------------------------------------------------------------
h.group('窗口边界');

t('窗口是「今天往前数 30 天」，含今天', function () {
  var data = buildRange('2026-10-01', 40);
  var plan = Store.planArchive(data, new Date(2026, 9, 30)); // 今天 = 10-30

  h.assertEqual(plan.cutoff, '2026-10-01', '10-01 是窗口的第一天，不该被归档');
  h.assertEqual(plan.archivedCount, 0, '10-01 到 10-30 正好 30 天，一条都不该归档');
});

t('刚好超出窗口的那一天要被归档', function () {
  var data = buildRange('2026-09-30', 40); // 多出 09-30 这一天
  var plan = Store.planArchive(data, new Date(2026, 9, 30));

  h.assertEqual(plan.archivedCount, 1);
  h.assertTrue(!!plan.archive['2026-09-30'], '09-30 该被归档');
  h.assertFalse(!!plan.archive['2026-10-01'], '10-01 还在窗口里');
});

t('滚动 60 天，归档后正好剩 30 天', function () {
  var data = buildRange('2026-09-01', 60); // 09-01 ~ 10-30
  var plan = Store.planArchive(data, new Date(2026, 9, 30));

  h.assertEqual(Object.keys(plan.keep).length, 30);
  h.assertEqual(Object.keys(plan.archive).length, 30);
  h.assertEqual(plan.archivedCount, 30);
});

t('跨月：窗口能正常跨过去', function () {
  // 造 100 天，最后一天正好是「今天」—— 这样窗口里才是满的 30 天。
  // 注意范围必须够到今天，否则窗口填不满，断言会跟着错。
  var today = '2026-09-15';
  var data = buildRange(Util.addDays(today, -99), 100);
  var plan = Store.planArchive(data, new Date(2026, 8, 15));

  h.assertEqual(plan.cutoff, '2026-08-17');
  h.assertEqual(Object.keys(plan.keep).length, 30);
  h.assertEqual(Object.keys(plan.archive).length, 70);
});

t('跨年：12 月底的数据不会算错', function () {
  var data = buildRange('2026-12-01', 60); // 12-01 ~ 2027-01-29
  var plan = Store.planArchive(data, new Date(2027, 0, 5)); // 今天 = 2027-01-05

  h.assertEqual(plan.cutoff, '2026-12-07');
  h.assertTrue(!!plan.archive['2026-12-01'], '12-01 超出 30 天了');
  h.assertFalse(!!plan.archive['2026-12-07'], '12-07 是窗口第一天，保留');
  h.assertFalse(!!plan.archive['2027-01-01'], '跨年那天的还在窗口里');
  h.assertEqual(plan.archivedCount, 6, '12-01 ~ 12-06 共 6 天');
});

t('窗口首尾两头都要卡准', function () {
  var data = Store.createEmpty();
  Store.ensureDay(data, '2026-10-01').I.push(task('边界内'));
  Store.ensureDay(data, '2026-09-30').I.push(task('边界外'));

  var plan = Store.planArchive(data, new Date(2026, 9, 30));

  h.assertTrue(!!plan.keep['2026-10-01']);
  h.assertTrue(!!plan.archive['2026-09-30']);
});

// ---------------------------------------------------------------------------
h.group('未来的日期不归档');

t('提前记的待办不算历史', function () {
  var data = Store.createEmpty();
  Store.ensureDay(data, '2026-10-30').I.push(task('今天'));
  Store.ensureDay(data, '2027-06-01').I.push(task('很久以后'));

  var plan = Store.planArchive(data, new Date(2026, 9, 30));

  h.assertTrue(!!plan.keep['2027-06-01'], '未来的日期必须保留');
  h.assertEqual(plan.archivedCount, 0);
});

// ---------------------------------------------------------------------------
h.group('没有数据时不出错');

t('空数据', function () {
  var plan = Store.planArchive(Store.createEmpty(), new Date(2026, 9, 30));
  h.assertEqual(plan.archivedCount, 0);
  h.assertEqual(Object.keys(plan.keep).length, 0);
  h.assertEqual(Object.keys(plan.archive).length, 0);
  h.assertEqual(plan.cutoff, '2026-10-01');
});

t('传 null 也不炸', function () {
  var plan = Store.planArchive(null, new Date(2026, 9, 30));
  h.assertEqual(plan.archivedCount, 0);
});

// ---------------------------------------------------------------------------
h.group('套用归档：不改原来那份');

t('applyArchive 返回新对象，原数据不动', function () {
  var data = buildRange('2026-09-01', 60);
  var before = JSON.stringify(data);

  var plan = Store.planArchive(data, new Date(2026, 9, 30));
  var next = Store.applyArchive(data, plan);

  h.assertEqual(JSON.stringify(data), before, '原数据必须原封不动');
  h.assertTrue(next !== data, '必须是另一个对象');
  h.assertEqual(Object.keys(next.dates).length, 30);
});

t('归档之后的 keep 就是窗口里那 30 天', function () {
  var data = buildRange('2026-09-01', 60);
  var plan = Store.planArchive(data, new Date(2026, 9, 30));
  var next = Store.applyArchive(data, plan);

  h.assertTrue(!!next.dates['2026-10-30']);
  h.assertTrue(!!next.dates['2026-10-01']);
  h.assertFalse(!!next.dates['2026-09-30'], '窗口外的该没了');
});

t('归档不碰 user 和 schemaVersion', function () {
  var data = buildRange('2026-09-01', 60);
  var plan = Store.planArchive(data, new Date(2026, 9, 30));
  var next = Store.applyArchive(data, plan);

  h.assertEqual(next.user, 'default');
  h.assertEqual(next.schemaVersion, CONFIG.SCHEMA_VERSION);
});

// ---------------------------------------------------------------------------
h.group('归档产物的格式');

t('归档包和普通导出长得一样，能直接导回来', function () {
  var data = buildRange('2026-09-01', 60);
  var plan = Store.planArchive(data, new Date(2026, 9, 30));
  var payload = Store.buildArchivePayload(data, plan);

  h.assertEqual(payload.user, 'default');
  h.assertEqual(payload.schemaVersion, CONFIG.SCHEMA_VERSION);
  h.assertEqual(Object.keys(payload.dates).length, 30);

  // 关键：它必须能被普通导入流程解析，不需要任何特殊处理
  var reparsed = Store.parse(JSON.stringify(payload));
  h.assertEqual(Object.keys(reparsed.data.dates).length, 30);
  h.assertEqual(reparsed.dropped, 0);
});

t('归档包里的任务内容原样保留', function () {
  var data = buildRange('2026-09-01', 60);
  var plan = Store.planArchive(data, new Date(2026, 9, 30));
  var payload = Store.buildArchivePayload(data, plan);

  h.assertEqual(payload.dates['2026-09-01'].I[0].text, '第 2026-09-01 天');
});

// ---------------------------------------------------------------------------
h.group('归档不删数据，只做划分');

t('keep 加 archive 正好等于原来的全部日期，一条不丢', function () {
  // 这条是在守 DS 2.4 那条硬规矩的另一半：
  // 「下载成功才删本地」的前提是，归档的那部分确实被完整交出去了。
  var data = buildRange('2026-06-01', 120);
  var plan = Store.planArchive(data, new Date(2026, 9, 30));

  var total = Object.keys(plan.keep).length + Object.keys(plan.archive).length;
  h.assertEqual(total, Object.keys(data.dates).length, '划分前后日期总数必须一致');
  h.assertEqual(total, 120);

  var original = Object.keys(data.dates).sort().join(',');
  var split = Object.keys(plan.keep).concat(Object.keys(plan.archive)).sort().join(',');
  h.assertEqual(split, original, '两边合起来必须和原来完全一致');
});

// ---------------------------------------------------------------------------
h.group('归档只收缩 dates：所有全局板块整份带走');

t('阅读栏 / 原则池 / 技能池 / 小文件 / 池 / 模板：归档一次一个都不许丢', function () {
  // 这一条原本就漏过：applyArchive 建的是 createEmpty()，只把 pool / templates
  // 搬了过去，阅读栏被无声地换成了空表（v2.12 顺手修掉，见 DS 2.48）。
  // v2.12 新加的三个板块一起按这条规矩办 —— 不然后面每加一个板块就得回来补一笔。
  var data = buildRange('2020-01-01', 40);
  data.pool.push({ id: 'p1', text: '池里的', completed: false, createdAt: 1 });
  data.templates.push({ id: 't1', name: '模板', createdAt: 1,
                        items: { I: [], II: [], III: [], IV: [] } });
  data.reading.active.push({ id: 'r1', text: '在读的', start: null, doneAt: null, createdAt: 1 });
  data.reading.done.push({ id: 'r2', text: '读完的', start: null, doneAt: '2026-10-01', createdAt: 1 });
  data.principles.active.push({ id: 'pr1', text: '先做重要的', createdAt: 1 });
  data.principles.archived.push({ id: 'pr2', text: '旧的', createdAt: 1 });
  data.skills.push({ id: 's1', text: '游泳', date: '2026-01-01', createdAt: 1 });
  data.files.push({ id: 'f1', name: 'a.txt', text: '正文', createdAt: 1 });

  var plan = Store.planArchive(data, new Date(2026, 9, 1));
  h.assertTrue(plan.archivedCount > 0, '确实有该归档的日期');

  var next = Store.applyArchive(data, plan);
  h.assertEqual(next.dates && Object.keys(next.dates).length,
    Object.keys(plan.keep).length, 'dates 换成收缩后的那份');
  h.assertEqual(next.pool.length, 1);
  h.assertEqual(next.templates.length, 1);
  h.assertEqual(next.reading.active.length, 1, '阅读栏以前就是在这儿被丢掉的');
  h.assertEqual(next.reading.done.length, 1);
  h.assertEqual(next.principles.active.length, 1);
  h.assertEqual(next.principles.archived.length, 1);
  h.assertEqual(next.skills.length, 1);
  h.assertEqual(next.files.length, 1);
  h.assertEqual(next.files[0].text, '正文');
});

t('归档出来的那一份 JSON 仍然只有 user / schemaVersion / dates（存档格式不变）', function () {
  var data = buildRange('2020-01-01', 40);
  data.skills.push({ id: 's1', text: '游泳', date: null, createdAt: 1 });

  var plan = Store.planArchive(data, new Date(2026, 9, 1));
  var payload = Store.buildArchivePayload(data, plan);

  h.assertEqual(Object.keys(payload).sort().join(','), 'dates,schemaVersion,user');
  h.assertFalse(JSON.stringify(payload).indexOf('游泳') !== -1,
    '归档文件只装日期数据，全局板块留在本地');
});

// ---------------------------------------------------------------------------

h.summary('store.js 30 天归档');
