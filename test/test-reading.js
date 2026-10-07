/**
 * test-reading.js
 *
 * v2.8 需求 2：**阅读栏**（见 DS 2.37）。
 *
 * 需求原文：「加入一个阅读栏，允许自己添加正在阅读的事项（提示不超过3项），
 * 可以自己设置起始时间，下方还有已阅读完成的内容，在将上面正在阅读的事项
 * 点击完成之后，自动在下方已阅读完成的内容项上显示完成时间，当然在下方可以
 * 自己修改起息时间。已阅读完成的内容设置一个展示上限，已完成阅读的内容很多
 * 的话要支持滚动条拖动。」
 *
 * 本文件锁住四件事：
 *   1. 数据层 `TaskOps.addReadingItem` / edit / setStart / remove / complete /
 *      restore / getReadingStats —— 正常路径、边界（空文本、坏日期、找不到）
 *      和「3 项」是个**软提示不是硬闸**（D-64）；
 *   2. `Store.normalizeReading` —— 清洗、丢脏数据、doneAt 强制对齐所在表；
 *   3. 渲染守卫 —— 头部计数 / 超限标红 / 勾选框 / 取消完成 / 起始→完成日期 /
 *      空态 / 两种编辑态 / 转义；
 *   4. 导入兼容 —— reading 是**可选字段**（v2.8 之前的文件里没有），有但不
 *      合法整份拒绝，合并按文本判重；以及跨文件守卫（app.js 分支、CSS 的
 *      展示上限 `max-height` + `overflow-y: auto`、保护模式名单）。
 *
 * **时间是日期不是时分**（试用反馈「阅读板块的时间指的是日期」，见 DS 2.37 修订）：
 * 起始 / 完成都是 'YYYY-MM-DD'，写操作只收日期；老文件里的 'HH:MM' 只有清洗和
 * 导入这两个读路径收（兼容，见 Util.isValidReadingStamp）。
 *
 * 跑法：node test/test-reading.js
 */
'use strict';

var h = require('./harness');
var fs = require('fs');
var path = require('path');
var Store = require('../js/store');
var TaskOps = require('../js/task-ops');
var Render = require('../js/render');
var Importer = require('../js/importer');
var CONFIG = require('../js/config');
var Util = require('../js/util');

var t = h.test;

var appSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
var renderSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'render.js'), 'utf8');
var css = fs.readFileSync(path.join(__dirname, '..', 'css', 'style.css'), 'utf8');
var dragSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'drag.js'), 'utf8');

var DATE_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

// ---------------------------------------------------------------------------
// 造数据的小工具
// ---------------------------------------------------------------------------

function fresh() {
  return Store.createEmpty();
}

/** 加一条正在阅读，返回 item（造不出来直接炸，别让后面的断言莫名其妙地挂） */
function addItem(data, text, start) {
  var r = TaskOps.addReadingItem(data, text, start);
  if (!r.ok) throw new Error('阅读条目没造出来：' + r.error);
  return r.item;
}

function activeTexts(data) {
  return (data.reading.active || []).map(function (x) { return x.text; }).join(',');
}

function doneTexts(data) {
  return (data.reading.done || []).map(function (x) { return x.text; }).join(',');
}

/** 最小的可校验文件（validate 只硬要求 dates 存在） */
function fileWith(extra) {
  var obj = { schemaVersion: 1, user: 'u', dates: {} };
  for (var k in extra) {
    if (Object.prototype.hasOwnProperty.call(extra, k)) obj[k] = extra[k];
  }
  return JSON.stringify(obj);
}

// ---------------------------------------------------------------------------
h.group('数据层：加 / 改 / 删');

t('加一条：落在「正在阅读」，带 id 和 createdAt', function () {
  var data = fresh();
  var item = addItem(data, '《深入理解计算机系统》', '2026-10-01');

  h.assertEqual(data.reading.active.length, 1);
  h.assertEqual(data.reading.active[0].text, '《深入理解计算机系统》');
  h.assertEqual(item.start, '2026-10-01');
  h.assertEqual(item.doneAt, null, '刚加的条目还没完成');
  h.assertTrue(typeof item.id === 'string' && item.id.length > 0);
  h.assertTrue(typeof item.createdAt === 'number');
});

t('不传起始日期 → 取**今天**（不是留空）', function () {
  var data = fresh();
  var item = addItem(data, '随便翻翻');
  h.assertEqual(item.start, Util.todayStr(), '默认该是今天');
  h.assertTrue(DATE_RE.test(item.start), '形状该是 YYYY-MM-DD，实际 ' + item.start);
});

t('传空串起始日期 → 也算没传，取今天', function () {
  var data = fresh();
  var item = addItem(data, '随便翻翻', '');
  h.assertEqual(item.start, Util.todayStr());
});

t('文本去空白后为空 → 拒绝，不落库', function () {
  var data = fresh();
  h.assertEqual(TaskOps.addReadingItem(data, '   ').error, 'EMPTY_TEXT');
  h.assertEqual(TaskOps.addReadingItem(data, '　　').error, 'EMPTY_TEXT', '全角空格也算空');
  h.assertEqual(TaskOps.addReadingItem(data, null).error, 'EMPTY_TEXT');
  h.assertEqual(data.reading.active.length, 0, '被拒绝的条目不该留下来');
});

t('起始日期格式不对 → 拒绝（脏数据不猜）', function () {
  var data = fresh();
  h.assertEqual(TaskOps.addReadingItem(data, '书', '2026-13-01').error, 'BAD_DATE', '月份 13');
  h.assertEqual(TaskOps.addReadingItem(data, '书', '2026-02-30').error, 'BAD_DATE',
    '2 月 30 能让正则过，但要被 Date 回读挡住');
  h.assertEqual(TaskOps.addReadingItem(data, '书', '2026-1-1').error, 'BAD_DATE', '没补零');
  h.assertEqual(TaskOps.addReadingItem(data, '书', '26-10-01').error, 'BAD_DATE', '年份只有两位');
  h.assertEqual(TaskOps.addReadingItem(data, '书', '十月一号').error, 'BAD_DATE');
  h.assertEqual(data.reading.active.length, 0);
});

t('合法边界日期照收：月末、闰年 2 月 29', function () {
  var data = fresh();
  h.assertEqual(addItem(data, '书', '2026-02-28').start, '2026-02-28');
  h.assertEqual(addItem(data, '书', '2028-02-29').start, '2028-02-29', '2028 是闰年');
  h.assertEqual(TaskOps.addReadingItem(data, '书', '2026-02-29').error, 'BAD_DATE',
    '2026 不是闰年，2 月 29 要拒绝');
});

t('写操作**不收**老的 HH:MM（新写入的一律是日期）', function () {
  var data = fresh();
  // 读路径收 'HH:MM' 只为兼容老文件；不能顺手让新写入也产出时分 ——
  // 那样「时间指的是日期」这条就永远收不了口
  h.assertEqual(TaskOps.addReadingItem(data, '书', '09:30').error, 'BAD_DATE');
  h.assertEqual(data.reading.active.length, 0);
});

t('改名字：改成功；改成空的拒绝且保留原名', function () {
  var data = fresh();
  var item = addItem(data, '旧名', '2026-10-02');

  h.assertTrue(TaskOps.editReadingItem(data, item.id, '新名').ok);
  h.assertEqual(item.text, '新名');

  h.assertEqual(TaskOps.editReadingItem(data, item.id, '  ').error, 'EMPTY_TEXT');
  h.assertEqual(item.text, '新名', '改空了要保留原名');
});

t('改不存在的条目 → NOT_FOUND', function () {
  var data = fresh();
  h.assertEqual(TaskOps.editReadingItem(data, '不存在', 'x').error, 'NOT_FOUND');
  h.assertEqual(TaskOps.setReadingStart(data, '不存在', '2026-10-02').error, 'NOT_FOUND');
  h.assertEqual(TaskOps.removeReadingItem(data, '不存在').error, 'NOT_FOUND');
  h.assertEqual(TaskOps.completeReadingItem(data, '不存在').error, 'NOT_FOUND');
  h.assertEqual(TaskOps.restoreReadingItem(data, '不存在').error, 'NOT_FOUND');
  h.assertNull(TaskOps.findReadingItem(data, '不存在'));
});

t('删一条：从列表里去掉，只去那一条', function () {
  var data = fresh();
  var a = addItem(data, 'A');
  var b = addItem(data, 'B');

  h.assertTrue(TaskOps.removeReadingItem(data, a.id).ok);
  h.assertEqual(activeTexts(data), 'B', '只剩 B');
  h.assertTrue(TaskOps.findReadingItem(data, a.id) === null);
  h.assertTrue(TaskOps.findReadingItem(data, b.id) !== null);
});

// ---------------------------------------------------------------------------
h.group('起始日期：正在读和已读完两边都能改');

t('设定起始日期', function () {
  var data = fresh();
  var item = addItem(data, '书');

  h.assertTrue(TaskOps.setReadingStart(data, item.id, '2026-09-30').ok);
  h.assertEqual(item.start, '2026-09-30');
});

t('传空 / null 是「清成未设定」，存的是 null 不是空串', function () {
  var data = fresh();
  var item = addItem(data, '书', '2026-09-30');

  h.assertTrue(TaskOps.setReadingStart(data, item.id, '').ok);
  h.assertNull(item.start, '空串该收敛成 null，别留两种「没设」');

  TaskOps.setReadingStart(data, item.id, '2026-10-01');
  TaskOps.setReadingStart(data, item.id, null);
  h.assertNull(item.start);
});

t('格式不对 → BAD_DATE，且不动原值', function () {
  var data = fresh();
  var item = addItem(data, '书', '2026-09-30');

  h.assertEqual(TaskOps.setReadingStart(data, item.id, '2026-13-01').error, 'BAD_DATE');
  h.assertEqual(TaskOps.setReadingStart(data, item.id, '09:30').error, 'BAD_DATE',
    '老的时分写法在写路径一样不收');
  h.assertEqual(item.start, '2026-09-30');
});

t('已读完成的条目也能改起始日期（需求明说了下方可改）', function () {
  var data = fresh();
  var item = addItem(data, '书', '2026-09-30');
  TaskOps.completeReadingItem(data, item.id, '2026-10-05');

  h.assertTrue(TaskOps.setReadingStart(data, item.id, '2026-09-29').ok);
  h.assertEqual(item.start, '2026-09-29', '起始日期是记录的一部分，完成后照样能改');
  h.assertEqual(item.doneAt, '2026-10-05', '改起始不该动完成日期');
});

// ---------------------------------------------------------------------------
h.group('完成：搬下去、记下日期、保留起始日期');

t('勾完成：从「正在阅读」搬到「已读完成」，并自动记下**今天**', function () {
  var data = fresh();
  var item = addItem(data, '书', '2026-10-01');

  var r = TaskOps.completeReadingItem(data, item.id);
  h.assertTrue(r.ok);
  h.assertEqual(data.reading.active.length, 0);
  h.assertEqual(data.reading.done.length, 1);
  h.assertEqual(doneTexts(data), '书');
  h.assertEqual(item.doneAt, Util.todayStr(), '不传就记今天');
  h.assertTrue(DATE_RE.test(item.doneAt), '形状该是 YYYY-MM-DD，实际 ' + item.doneAt);
});

t('传了完成日期就用传进来的（测试 / 补录用）', function () {
  var data = fresh();
  var item = addItem(data, '书', '2026-10-01');
  TaskOps.completeReadingItem(data, item.id, '2026-10-05');
  h.assertEqual(item.doneAt, '2026-10-05');
});

t('完成后**起始日期留着** —— 行上要显示「2026-10-01 → 2026-10-05」', function () {
  var data = fresh();
  var item = addItem(data, '书', '2026-10-01');
  TaskOps.completeReadingItem(data, item.id, '2026-10-05');

  h.assertEqual(item.start, '2026-10-01');
  h.assertEqual(item.doneAt, '2026-10-05');
});

t('新读完的排在已完成表开头（一眼看得见）', function () {
  var data = fresh();
  var a = addItem(data, 'A');
  var b = addItem(data, 'B');

  TaskOps.completeReadingItem(data, a.id, '2026-10-02');
  TaskOps.completeReadingItem(data, b.id, '2026-10-03');
  h.assertEqual(doneTexts(data), 'B,A', '后读完的排前面');
});

t('完成日期格式不对 → BAD_DATE，条目原地不动', function () {
  var data = fresh();
  var item = addItem(data, '书');

  h.assertEqual(TaskOps.completeReadingItem(data, item.id, '2026-02-30').error, 'BAD_DATE');
  h.assertEqual(data.reading.active.length, 1, '拒绝时不该把它搬下去');
  h.assertNull(item.doneAt);
});

t('已完成表里的条目再勾一次：不重复搬，只更新日期', function () {
  var data = fresh();
  var item = addItem(data, '书');
  TaskOps.completeReadingItem(data, item.id, '2026-10-02');

  var r = TaskOps.completeReadingItem(data, item.id, '2026-10-04');
  h.assertTrue(r.ok);
  h.assertEqual(data.reading.done.length, 1, '不能搬出第二条来');
  h.assertEqual(item.doneAt, '2026-10-04');
});

t('取消完成：搬回「正在阅读」，doneAt 清掉', function () {
  var data = fresh();
  var item = addItem(data, '书', '2026-10-01');
  TaskOps.completeReadingItem(data, item.id, '2026-10-05');

  h.assertTrue(TaskOps.restoreReadingItem(data, item.id).ok);
  h.assertEqual(data.reading.done.length, 0);
  h.assertEqual(activeTexts(data), '书');
  h.assertNull(item.doneAt, '回到正在阅读就不该再带着完成时刻');
  h.assertEqual(item.start, '2026-10-01', '起始时间照样留着');
});

t('本来就在读的再取消完成：什么都不做，不报错', function () {
  var data = fresh();
  var item = addItem(data, '书');

  h.assertTrue(TaskOps.restoreReadingItem(data, item.id).ok);
  h.assertEqual(activeTexts(data), '书');
  h.assertEqual(data.reading.active.length, 1);
});

// ---------------------------------------------------------------------------
h.group('「不超过 3 项」是提示不是硬闸（D-64）');

t('计数：正在读 / 已读完 / 上限', function () {
  var data = fresh();
  h.assertEqual(TaskOps.getReadingStats(data).limit, 3, '需求写的就是 3');
  addItem(data, 'A');
  addItem(data, 'B');
  var stats = TaskOps.getReadingStats(data);
  h.assertEqual(stats.active, 2);
  h.assertEqual(stats.done, 0);
  h.assertFalse(stats.over, '2 项没超');
});

t('刚好 3 项不算超，第 4 项才开始提示', function () {
  var data = fresh();
  addItem(data, 'A');
  addItem(data, 'B');
  addItem(data, 'C');
  h.assertFalse(TaskOps.getReadingStats(data).over, '「不超过 3」含 3');

  addItem(data, 'D');
  h.assertTrue(TaskOps.getReadingStats(data).over);
});

t('超了也照样能加 —— 只是标一句，不拦', function () {
  var data = fresh();
  for (var i = 0; i < 6; i++) addItem(data, '第' + i + '本');
  h.assertEqual(data.reading.active.length, 6, '软提示不该变成硬闸');
  h.assertTrue(TaskOps.getReadingStats(data).over);
});

t('已完成的不占「正在阅读」的名额', function () {
  var data = fresh();
  var a = addItem(data, 'A');
  addItem(data, 'B');
  addItem(data, 'C');
  addItem(data, 'D');
  h.assertTrue(TaskOps.getReadingStats(data).over);

  TaskOps.completeReadingItem(data, a.id, '2026-10-02');
  var stats = TaskOps.getReadingStats(data);
  h.assertEqual(stats.active, 3);
  h.assertEqual(stats.done, 1);
  h.assertFalse(stats.over, '读完一条就不超了');
});

t('上限来自 CONFIG，不写死在两处', function () {
  h.assertEqual(CONFIG.READING_ACTIVE_HINT, 3);
});

// ---------------------------------------------------------------------------
h.group('时间是日期：读路径收老值、写路径只收日期（Util 契约）');

t('Util.isValidReadingStamp：日期收、老的 HH:MM 也收、别的都拒', function () {
  h.assertTrue(Util.isValidReadingStamp('2026-10-01'), '日期');
  h.assertTrue(Util.isValidReadingStamp('09:30'), 'v2.8 初版老值');
  h.assertFalse(Util.isValidReadingStamp('2026-13-01'), '月份 13');
  h.assertFalse(Util.isValidReadingStamp('25:00'), '老格式也不合法的那种');
  h.assertFalse(Util.isValidReadingStamp(''));
  h.assertFalse(Util.isValidReadingStamp(null));
  h.assertFalse(Util.isValidReadingStamp(20261001), '数字不算');
});

t('Util.todayStr 是写路径的默认值来源（改口径别再散落 new Date）', function () {
  h.assertTrue(DATE_RE.test(Util.todayStr()));
  h.assertEqual(Util.todayStr(), Util.todayStr());
});

t('干净数据导出再导入一整轮：日期原样往返（不因为改口径丢数据）', function () {
  var data = fresh();
  var item = addItem(data, '书', '2026-09-30');
  TaskOps.completeReadingItem(data, item.id, '2026-10-05');

  var roundTrip = Importer.validate(Store.serialize(data));
  h.assertTrue(roundTrip.ok, '自己导出的文件导不回来就是兼容性破了');
  h.assertEqual(roundTrip.data.reading.done[0].start, '2026-09-30');
  h.assertEqual(roundTrip.data.reading.done[0].doneAt, '2026-10-05');
});

// ---------------------------------------------------------------------------
h.group('ensureReading：老数据 / 手写对象也扛得住');

t('没有 reading 字段 → 补一张空表，不改别的', function () {
  var data = { dates: {}, pool: [], templates: [] };
  var reading = TaskOps.ensureReading(data);
  h.assertEqual(reading.active.length, 0);
  h.assertEqual(reading.done.length, 0);
  h.assertTrue(data.reading === reading);
});

t('reading 是垃圾值 / 两张表不是列表 → 各自收敛成空列表', function () {
  var data = { reading: '不是对象' };
  h.assertEqual(TaskOps.ensureReading(data).active.length, 0);

  data = { reading: { active: 'x', done: 5 } };
  var r = TaskOps.ensureReading(data);
  h.assertEqual(r.active.length, 0);
  h.assertEqual(r.done.length, 0);
});

t('createEmpty 就带着空的阅读栏（新用户的库形状一致）', function () {
  var data = Store.createEmpty();
  h.assertEqual(data.reading.active.length, 0);
  h.assertEqual(data.reading.done.length, 0);
});

// ---------------------------------------------------------------------------
h.group('Store 清洗：脏数据丢掉，doneAt 强制对齐所在表');

t('normalizeReadingItem：文本空了丢、日期不合法收敛成 null', function () {
  h.assertNull(Store.normalizeReadingItem({ text: '   ' }), '没名字的条目没有意义');
  h.assertNull(Store.normalizeReadingItem('不是对象'));

  var item = Store.normalizeReadingItem({ text: '书', start: '2026-13-01', doneAt: '十月一号' });
  h.assertEqual(item.text, '书');
  h.assertNull(item.start, '不合法当没设，不当崩');
  h.assertNull(item.doneAt);
});

t('normalizeReadingItem：**老文件里的 HH:MM 原样收下**（兼容尾巴）', function () {
  // v2.8 初版存的是时分。用户手里那样的 JSON 不能因为口径改了就把时间抹掉 ——
  // 「时间指的是日期」是往前改，不是回头删用户的数据（见 DS 2.37 修订）
  var item = Store.normalizeReadingItem({ text: '书', start: '09:30', doneAt: '10:00' });
  h.assertEqual(item.start, '09:30', '老值要留着');
  h.assertEqual(item.doneAt, '10:00');
});

t('normalizeReading：不是对象 → 两张空表，不崩', function () {
  var r = Store.normalizeReading(null);
  h.assertEqual(r.reading.active.length, 0);
  h.assertEqual(r.reading.done.length, 0);
  h.assertEqual(r.dropped, 0);
});

t('normalizeReading：脏条目丢掉并计数，好条目留着', function () {
  var r = Store.normalizeReading({
    active: [{ text: '好' }, { text: '  ' }, 42, { text: '也好' }],
    done: []
  });
  h.assertEqual(r.reading.active.length, 2);
  h.assertEqual(r.dropped, 2);
});

t('正在阅读表里的 doneAt 一律抹成 null（所在表才是唯一判据）', function () {
  var r = Store.normalizeReading({
    active: [{ text: '书', doneAt: '2026-10-02' }],
    done: []
  });
  h.assertNull(r.reading.active[0].doneAt, '还在读却带着完成时刻是自相矛盾的');
});

t('已完成表里没日期的补**今天**（脏数据也不让它空着）', function () {
  var r = Store.normalizeReading({
    active: [],
    done: [{ text: '书' }]
  });
  h.assertEqual(r.reading.done.length, 1);
  h.assertEqual(r.reading.done[0].doneAt, Util.todayStr(),
    '已完成表里的条目必须有日期，实际 ' + r.reading.done[0].doneAt);
  h.assertTrue(DATE_RE.test(r.reading.done[0].doneAt));
});

t('normalize 走一整轮：阅读栏还在，内容没丢', function () {
  var data = fresh();
  addItem(data, '书', '2026-10-01');
  var item = addItem(data, '杂志', '2026-10-02');
  TaskOps.completeReadingItem(data, item.id, '2026-10-03');

  var norm = Store.normalize(JSON.parse(JSON.stringify(data)));
  h.assertEqual(norm.data.reading.active.length, 1);
  h.assertEqual(norm.data.reading.active[0].text, '书');
  h.assertEqual(norm.data.reading.done.length, 1);
  h.assertEqual(norm.data.reading.done[0].text, '杂志');
  h.assertEqual(norm.data.reading.done[0].start, '2026-10-02');
  h.assertEqual(norm.data.reading.done[0].doneAt, '2026-10-03');
});

t('老数据（没有 reading 字段）过 normalize → 补空表，不报 dropped', function () {
  var norm = Store.normalize({ dates: {}, pool: [], templates: [] });
  h.assertEqual(norm.data.reading.active.length, 0);
  h.assertEqual(norm.data.reading.done.length, 0);
  h.assertEqual(norm.dropped, 0, '「没有这个字段」不算脏数据');
});

// ---------------------------------------------------------------------------
h.group('渲染：正在阅读那一段');

function reading(active, done) {
  return { active: active || [], done: done || [] };
}

t('头部：名字 + n/3 计数 + 加号 + 收起三角', function () {
  var html = Render.buildReadingHtml(reading([{ id: 'a', text: '书', start: null, doneAt: null }]), null);
  h.assertTrue(html.indexOf('reading__name') !== -1);
  h.assertTrue(html.indexOf('阅读栏') !== -1);
  h.assertTrue(html.indexOf('1/3') !== -1, '计数该是 1/3');
  h.assertTrue(html.indexOf('reading__add') !== -1);
  h.assertTrue(html.indexOf('data-panel="reading"') !== -1, '头部该有收起三角');
});

t('超过 3 项：计数加 --over 标红，但条目一条不少地画出来', function () {
  var html = Render.buildReadingHtml(reading([
    { id: 'a', text: 'A', start: null, doneAt: null },
    { id: 'b', text: 'B', start: null, doneAt: null },
    { id: 'c', text: 'C', start: null, doneAt: null },
    { id: 'd', text: 'D', start: null, doneAt: null }
  ]), null);
  h.assertTrue(html.indexOf('reading__count--over') !== -1);
  h.assertTrue(html.indexOf('4/3') !== -1);
  h.assertTrue(html.indexOf('>A<') !== -1 && html.indexOf('>D<') !== -1, '超限也得全画出来');
});

t('行上：勾选框 + 文字 + 起始日期按钮 + 删除', function () {
  var html = Render.buildReadingItemHtml({ id: 'a', text: '书', start: '2026-10-01', doneAt: null }, null, false);
  h.assertTrue(html.indexOf('reading__check') !== -1, '正在读的该有勾选框');
  h.assertTrue(html.indexOf('type="checkbox"') !== -1);
  h.assertTrue(html.indexOf('reading__text') !== -1);
  h.assertTrue(html.indexOf('2026-10-01') !== -1);
  h.assertTrue(html.indexOf('reading__start') !== -1);
  h.assertTrue(html.indexOf('reading__del') !== -1);
  h.assertFalse(html.indexOf('reading__restore') !== -1, '正在读的不该有「取消完成」');
});

t('没设起始日期：按钮加 --empty 并显示「未设定」', function () {
  var html = Render.buildReadingItemHtml({ id: 'a', text: '书', start: null, doneAt: null }, null, false);
  h.assertTrue(html.indexOf('reading__start--empty') !== -1);
  h.assertTrue(html.indexOf('未设定') !== -1);
});

t('文字要转义，别把书名里的尖括号当标签', function () {
  var html = Render.buildReadingItemHtml({
    id: 'a', text: '<script>x</script>', start: null, doneAt: null
  }, null, false);
  h.assertFalse(html.indexOf('<script>') !== -1, '原样的标签漏出去了');
  h.assertTrue(html.indexOf('&lt;script&gt;') !== -1);
});

// ---------------------------------------------------------------------------
h.group('渲染：已读完成那一段');

t('行上：取消完成 + 「起始 → 完成」日期 + 删除', function () {
  var html = Render.buildReadingItemHtml({ id: 'a', text: '书', start: '2026-10-01', doneAt: '2026-10-05' }, null, true);
  h.assertTrue(html.indexOf('reading__restore') !== -1, '已完成该有「取消完成」');
  h.assertTrue(html.indexOf('reading__time') !== -1);
  h.assertTrue(html.indexOf('2026-10-01') !== -1);
  h.assertTrue(html.indexOf('reading__arrow') !== -1, '隔了几天才读完，两个日期要连起来');
  h.assertTrue(html.indexOf('2026-10-05') !== -1);
  h.assertTrue(html.indexOf('reading__item--done') !== -1, '已完成该有完成态样式');
  h.assertFalse(html.indexOf('type="checkbox"') !== -1, '已完成的不该再是勾选框');
});

t('同一天开始同一天读完：只画一个日期，不画「X → X」', function () {
  var html = Render.buildReadingItemHtml({ id: 'a', text: '书', start: '2026-10-05', doneAt: '2026-10-05' }, null, true);
  h.assertTrue(html.indexOf('2026-10-05') !== -1);
  h.assertFalse(html.indexOf('reading__arrow') !== -1,
    '两个日期一样时画「→」是纯噪音');
  h.assertFalse(html.indexOf('→') !== -1);
});

t('已完成那行的日期是**点得动**的按钮（需求：下方可以自己修改起息时间）', function () {
  // 这一条是 v2.8 补充修订三改掉的：改之前已完成那行画的是死文本，点不动，
  // 「下方可以自己修改起息时间」在界面上根本做不到（见 DS 2.37 修订三）。
  var html = Render.buildReadingItemHtml({ id: 'a', text: '书', start: '2026-10-01', doneAt: '2026-10-05' }, null, true);
  h.assertTrue(html.indexOf('<button type="button" class="reading__start"') !== -1,
    '已完成那行得有起始日期按钮，不然改不了');
  h.assertTrue(html.indexOf('2026-10-01') !== -1);
  h.assertTrue(html.indexOf('2026-10-05') !== -1);
});

t('已完成但没设过起始日期：留一个「未设定」按钮（点得动才补得上）', function () {
  // 这条**推翻了**上一轮的取舍（当时是「不画废信息」）。留按钮是故意的：没有
  // 按钮就永远补不上起始日期。两个日期相同时仍然只画一个（D-68 不变）
  var html = Render.buildReadingItemHtml({ id: 'a', text: '书', start: null, doneAt: '2026-10-05' }, null, true);
  h.assertTrue(html.indexOf('reading__start--empty') !== -1, '未设定要有能点的东西');
  h.assertTrue(html.indexOf('未设定') !== -1);
  h.assertTrue(html.indexOf('2026-10-05') !== -1, '完成日期照样要有');
  h.assertTrue(html.indexOf('reading__arrow') !== -1, '完成日期和它不一样，该用箭头连起来');
});

t('整块渲染：上下两段都在，各有各的列表', function () {
  var html = Render.buildReadingHtml(
    reading(
      [{ id: 'a', text: '在读', start: '2026-10-01', doneAt: null }],
      [{ id: 'b', text: '读完', start: '2026-09-28', doneAt: '2026-10-02' }]
    ), null);
  h.assertTrue(html.indexOf('reading__list') !== -1);
  h.assertTrue(html.indexOf('reading__done') !== -1);
  h.assertTrue(html.indexOf('reading__done-list') !== -1);
  h.assertTrue(html.indexOf('reading__subtitle') !== -1);
  h.assertTrue(html.indexOf('在读') !== -1 && html.indexOf('读完') !== -1);
});

t('已完成那边单独一句提示 + 个数', function () {
  var html = Render.buildReadingHtml(reading(
    [{ id: 'a', text: '在读', start: null, doneAt: null }],
    [{ id: 'b', text: '读完', start: null, doneAt: '2026-10-02' }]
  ), null);
  h.assertTrue(html.indexOf('reading__done-count') !== -1);
  h.assertTrue(html.indexOf('>1<') !== -1, '已完成该报个数');
});

t('空空如也：给一句引导，不画空列表', function () {
  var html = Render.buildReadingHtml(reading([], []), null);
  h.assertTrue(html.indexOf('reading__empty') !== -1);
  h.assertFalse(html.indexOf('reading__list') !== -1, '一条都没有就别画列表了');
});

t('正在阅读空了但已完成有货：正在阅读那句给占位，已完成照样画', function () {
  var html = Render.buildReadingHtml(reading([], [{ id: 'b', text: '读完', start: null, doneAt: '2026-10-02' }]), null);
  h.assertTrue(html.indexOf('reading__none') !== -1);
  h.assertTrue(html.indexOf('读完') !== -1, '已完成的那段不能跟着一起消失');
  h.assertFalse(html.indexOf('reading__done-empty') !== -1, '有内容就不该说「还没有读完的」');
});

t('正在阅读有货但已完成空：下面给一句提示', function () {
  var html = Render.buildReadingHtml(reading([{ id: 'a', text: '在读', start: null, doneAt: null }]), null);
  h.assertTrue(html.indexOf('reading__done-empty') !== -1);
});

t('数据缺字段 / 传 null：不崩', function () {
  h.assertTrue(Render.buildReadingHtml(null, null).indexOf('reading__head') !== -1);
  h.assertTrue(Render.buildReadingHtml({}, null).indexOf('reading__head') !== -1);
  h.assertTrue(Render.buildReadingHtml({ active: 'x', done: 3 }, null).indexOf('reading__head') !== -1);
});

// ---------------------------------------------------------------------------
h.group('渲染：两种编辑态');

t('改名：把这一条换成文字输入框', function () {
  var html = Render.buildReadingHtml(
    reading([{ id: 'a', text: '书', start: null, doneAt: null }]),
    { editing: { mode: 'edit-reading', readingItemId: 'a' } });
  h.assertTrue(html.indexOf('reading__item--editing') !== -1);
  h.assertTrue(html.indexOf('task__input') !== -1);
  h.assertTrue(html.indexOf('value="书"') !== -1, '输入框里该带原值');
});

t('改名只影响那一条', function () {
  var html = Render.buildReadingHtml(
    reading([
      { id: 'a', text: '书', start: null, doneAt: null },
      { id: 'b', text: '杂志', start: null, doneAt: null }
    ]),
    { editing: { mode: 'edit-reading', readingItemId: 'a' } });
  h.assertTrue(html.indexOf('value="书"') !== -1);
  h.assertTrue(html.indexOf('>杂志<') !== -1, '另一条该照常画成文本');
});

t('改起始日期：换成 date 输入框 + 清空按钮', function () {
  var html = Render.buildReadingHtml(
    reading([{ id: 'a', text: '书', start: '2026-10-01', doneAt: null }]),
    { editing: { mode: 'edit-reading-start', readingItemId: 'a' } });
  h.assertTrue(html.indexOf('type="date"') !== -1, '是日期不是时分');
  h.assertFalse(html.indexOf('type="time"') !== -1, '不该再留时分输入框');
  h.assertTrue(html.indexOf('reading__start-input') !== -1);
  h.assertTrue(html.indexOf('value="2026-10-01"') !== -1);
  h.assertTrue(html.indexOf('reading__start-clear') !== -1);
});

t('日期编辑框和池里**同一副模样**：同一个框 + 同一个「清除」', function () {
  // 需求原文：「改成和计划池的日期设定类似的格式」。这里直接拿两边渲染出来的
  // 字符串比 —— 不是「长得像」，是同一种东西（见 DS 2.37 修订三 / D-70）
  var mine = Render.buildReadingHtml(
    reading([{ id: 'a', text: '书', start: '2026-10-01', doneAt: null }]),
    { editing: { mode: 'edit-reading-start', readingItemId: 'a' } });
  var pool = Render.buildPoolItemHtml(
    { id: 'p', text: '任务', plannedDate: '2026-10-01' },
    { mode: 'edit-pool-date', poolItemId: 'p' });

  h.assertTrue(mine.indexOf('<input type="date"') !== -1);
  h.assertTrue(pool.indexOf('<input type="date"') !== -1);
  h.assertTrue(mine.indexOf('>清除</button>') !== -1, '清除按钮的文案要和池里一样');
  h.assertTrue(pool.indexOf('>清除</button>') !== -1);
  h.assertFalse(mine.indexOf('>×</button>') !== -1, '别再是「×」了');
});

t('新增态：列表开头插一个空输入框', function () {
  var html = Render.buildReadingHtml(reading([], []), { editing: { mode: 'add-reading' } });
  h.assertTrue(html.indexOf('task__input') !== -1);
  h.assertTrue(html.indexOf('reading__item--editing') !== -1);
  h.assertFalse(html.indexOf('reading__empty') !== -1, '正在新增就不该显示空态引导');
});

t('已完成的条目也能进编辑态（需求：下方也可改起始日期）', function () {
  var html = Render.buildReadingHtml(
    reading([], [{ id: 'b', text: '书', start: '2026-10-01', doneAt: '2026-10-05' }]),
    { editing: { mode: 'edit-reading-start', readingItemId: 'b' } });
  h.assertTrue(html.indexOf('reading__item--done') !== -1, '编辑态也得保留完成态样式');
  h.assertTrue(html.indexOf('type="date"') !== -1);
});

// ---------------------------------------------------------------------------
h.group('渲染：收起三角（需求 3）');

t('展开时三角朝下、aria-expanded 为 true', function () {
  var html = Render.panelToggleHtml('pool', { collapsedPanels: {} });
  h.assertTrue(html.indexOf('data-panel="pool"') !== -1);
  h.assertTrue(html.indexOf('aria-expanded="true"') !== -1);
});

t('收起时 aria-expanded 为 false，提示语变「展开」', function () {
  var html = Render.panelToggleHtml('reading', { collapsedPanels: { reading: true } });
  h.assertTrue(html.indexOf('aria-expanded="false"') !== -1);
  h.assertTrue(html.indexOf('展开面板') !== -1);
});

t('计划池和模板池的头上也各有一个（三个板块都要能收）', function () {
  var pool = Render.buildPoolHtml([], {});
  h.assertTrue(pool.indexOf('data-panel="pool"') !== -1);

  var tpl = Render.buildTemplatesHtml([], {});
  h.assertTrue(tpl.indexOf('data-panel="templates"') !== -1);
});

t('无 view 也不崩，默认当展开', function () {
  h.assertTrue(Render.panelToggleHtml('pool', null).indexOf('aria-expanded="true"') !== -1);
});

// ---------------------------------------------------------------------------
h.group('导入：reading 是可选字段，老文件照样收');

t('没有 reading 字段的老文件 → 校验通过，reading 是 null（不是空表）', function () {
  var r = Importer.validate(fileWith({}));
  h.assertTrue(r.ok, 'v2.8 之前的文件必须还能导入');
  h.assertNull(r.data.reading, '「文件里没有」和「有零条」要分得开');
});

t('有 reading → 原样带过来', function () {
  var r = Importer.validate(fileWith({
    reading: {
      active: [{ text: '书', start: '2026-10-01' }],
      done: [{ text: '杂志', start: '2026-09-28', doneAt: '2026-10-02' }]
    }
  }));
  h.assertTrue(r.ok);
  h.assertEqual(r.data.reading.active.length, 1);
  h.assertEqual(r.data.reading.active[0].text, '书');
  h.assertEqual(r.data.reading.active[0].start, '2026-10-01');
  h.assertEqual(r.data.reading.done[0].doneAt, '2026-10-02');
});

t('正在阅读的条目带着 doneAt → 校验时抹掉（和清洗同一条规矩）', function () {
  var r = Importer.validate(fileWith({
    reading: { active: [{ text: '书', doneAt: '2026-10-02' }], done: [] }
  }));
  h.assertTrue(r.ok);
  h.assertNull(r.data.reading.active[0].doneAt);
});

t('缺一张表当空表，两个都缺也当空表', function () {
  var r = Importer.validate(fileWith({ reading: { active: [{ text: '书' }] } }));
  h.assertTrue(r.ok);
  h.assertEqual(r.data.reading.done.length, 0);

  r = Importer.validate(fileWith({ reading: {} }));
  h.assertTrue(r.ok);
  h.assertEqual(r.data.reading.active.length, 0);
});

t('reading 不是对象 / 表不是列表 / 条目没名字 → 整份拒绝', function () {
  h.assertEqual(Importer.validate(fileWith({ reading: '不是对象' })).error, 'BAD_READING');
  h.assertEqual(Importer.validate(fileWith({ reading: { active: 'x' } })).error, 'BAD_READING');
  h.assertEqual(Importer.validate(fileWith({ reading: { active: [{ text: '  ' }] } })).error, 'BAD_READING');
  h.assertEqual(Importer.validate(fileWith({ reading: { active: [42] } })).error, 'BAD_READING');
});

t('日期格式不对 → 整份拒绝（脏数据不猜）', function () {
  h.assertEqual(Importer.validate(fileWith({
    reading: { active: [{ text: '书', start: '2026-13-01' }] }
  })).error, 'BAD_READING');
  h.assertEqual(Importer.validate(fileWith({
    reading: { done: [{ text: '书', doneAt: '十月一号' }] }
  })).error, 'BAD_READING');
});

t('**v2.8 初版导出的文件照样能导入**（那时存的是 HH:MM）', function () {
  // 「每一个版本都要兼容前面版本导出的 JSON」——口径从时分改成日期，
  // 不等于把老文件判成坏文件
  var r = Importer.validate(fileWith({
    reading: {
      active: [{ text: '书', start: '09:30' }],
      done: [{ text: '杂志', start: '08:00', doneAt: '10:00' }]
    }
  }));
  h.assertTrue(r.ok, '老文件必须还能导入');
  h.assertEqual(r.data.reading.active[0].start, '09:30', '老值原样带过来，不抹掉');
  h.assertEqual(r.data.reading.done[0].doneAt, '10:00');
});

t('空串日期当「没设」，不算错', function () {
  var r = Importer.validate(fileWith({
    reading: { active: [{ text: '书', start: '' }] }
  }));
  h.assertTrue(r.ok);
  h.assertNull(r.data.reading.active[0].start);
});

t('合并：新条目搬进来，换新 id', function () {
  var local = fresh();
  var imported = Importer.validate(fileWith({
    reading: { active: [{ text: '书', start: '2026-10-01' }], done: [] }
  })).data;

  var r = Importer.merge(local, imported);
  h.assertEqual(r.added, 1);
  h.assertEqual(activeTexts(r.data), '书');
  h.assertEqual(r.data.reading.active[0].start, '2026-10-01', '起始日期要带过来');
  h.assertTrue(r.data.reading.active[0].id !== undefined);
});

t('合并：同名文本判重跳过，保留本地那条（连本地的日期一起）', function () {
  var local = fresh();
  addItem(local, '书', '2026-09-27');

  var imported = Importer.validate(fileWith({
    reading: { active: [{ text: '书', start: '2026-10-01' }], done: [] }
  })).data;

  var r = Importer.merge(local, imported);
  h.assertEqual(r.skipped, 1);
  h.assertEqual(r.added, 0);
  h.assertEqual(r.data.reading.active.length, 1);
  h.assertEqual(r.data.reading.active[0].start, '2026-09-27', '本地记的日期不该被文件覆盖');
});

t('合并：已完成的条目带着完成日期过来', function () {
  var local = fresh();
  var imported = Importer.validate(fileWith({
    reading: { active: [], done: [{ text: '杂志', doneAt: '2026-10-05' }] }
  })).data;

  var r = Importer.merge(local, imported);
  h.assertEqual(r.data.reading.done.length, 1);
  h.assertEqual(r.data.reading.done[0].doneAt, '2026-10-05');
});

t('合并：文件里没有阅读栏 → 本地阅读栏一条不动', function () {
  var local = fresh();
  addItem(local, '书', '2026-10-01');

  var imported = Importer.validate(fileWith({})).data;
  var r = Importer.merge(local, imported);
  h.assertEqual(activeTexts(r.data), '书');
});

t('覆盖导入：文件里有阅读栏就整体换掉', function () {
  var local = fresh();
  addItem(local, '旧书');

  var imported = Importer.validate(fileWith({
    reading: { active: [{ text: '新书' }], done: [] }
  })).data;

  var r = Importer.overwrite(local, imported);
  h.assertEqual(activeTexts(r.data), '新书');
  h.assertTrue(r.data.reading.active[0].text !== '旧书');
});

t('导入失败的说明是人话，不是错误码', function () {
  var r = Importer.validate(fileWith({ reading: { active: [{ text: '' }] } }));
  h.assertFalse(r.ok);
  h.assertTrue(typeof r.message === 'string' && r.message.length > 0);
  h.assertTrue(r.message.indexOf('BAD_READING') === -1, '别把错误码端给用户');
});

// ---------------------------------------------------------------------------
h.group('app.js 源码守卫：新面板接进了同一条主干');

t('boot 里绑了阅读栏', function () {
  h.assertTrue(appSrc.indexOf('bindReading();') !== -1, '不绑就没有交互');
});

t('renderCurrent 把 reading 和 collapsedPanels 传下去了', function () {
  h.assertTrue(appSrc.indexOf('reading: TaskOps.ensureReading(state.data)') !== -1);
  h.assertTrue(appSrc.indexOf('collapsedPanels: state.collapsedPanels') !== -1);
});

t('commitEdit 认得三种阅读编辑态', function () {
  ['add-reading', 'edit-reading', 'edit-reading-start'].forEach(function (mode) {
    h.assertTrue(appSrc.indexOf("'" + mode + "'") !== -1, 'commitEdit 少了 ' + mode);
  });
});

t('加条目走 TaskOps.addReadingItem', function () {
  h.assertTrue(appSrc.indexOf('TaskOps.addReadingItem(state.data, value, null)') !== -1);
});

t('commitEdit 的新增分支收下**所有** add-* 模式（回归：回车没反应）', function () {
  // 这条是实测出来的真 bug：'add-reading' 漏在新增分支的外层 if 名单外，
  // 于是回车掉进下面的「改文字」链，被当成 editBlock 提交 —— 新增被静默丢掉，
  // 用户看到的就是「回车之后没有反应」。守卫方式：把 app.js 里所有
  // `mode: 'add-xxx'` 扫出来，逐个要求出现在那条外层条件里。
  var modes = [];
  var re = /mode: '(add(?:-[a-z-]+)?)'/g;
  var m;
  while ((m = re.exec(appSrc)) !== null) {
    if (modes.indexOf(m[1]) === -1) modes.push(m[1]);
  }
  h.assertTrue(modes.length >= 6, '没扫到 add 模式，正则该跟着实现改（扫到 ' + modes.length + ' 个）');
  h.assertTrue(modes.indexOf('add-reading') !== -1, '扫不到 add-reading，正则过时了');

  var head = appSrc.slice(
    appSrc.indexOf('// ---- 新增（任务、阶段、任务块或池内任务）'),
    appSrc.indexOf('// ---- 改文字'));
  var condStart = head.indexOf('if (editing.mode ===');
  h.assertTrue(condStart !== -1, '找不到新增分支的外层 if');
  var cond = head.slice(condStart, head.indexOf(') {', condStart));

  modes.forEach(function (mode) {
    h.assertTrue(cond.indexOf("'" + mode + "'") !== -1,
      mode + ' 没被列进新增分支的外层条件 —— 回车会掉进「改文字」链，新增被静默丢掉');
  });
});

t('收起状态要落本机（刷新后才记得住）', function () {
  h.assertTrue(appSrc.indexOf('collapsedPanels: state.collapsedPanels') !== -1);
  h.assertTrue(appSrc.indexOf('state.collapsedPanels = fold.collapsedPanels;') !== -1,
    '开机要把收起状态读回来');
});

t('togglePanel 只认名单里的名字，脏 data-panel 直接忽略', function () {
  h.assertTrue(appSrc.indexOf('CONFIG.PANEL_IDS.indexOf(panelId) === -1') !== -1,
    '从 DOM 传上来的值不能全信');
});

t('阅读栏的写操作在保护模式下都要拦一道（和别处同款）', function () {
  ['doCompleteReading', 'doRestoreReading', 'doRemoveReading', 'doSetReadingStart']
    .forEach(function (fn) {
      var start = appSrc.indexOf('function ' + fn + '(');
      h.assertTrue(start !== -1, 'app.js 里找不到 ' + fn);
      var end = appSrc.indexOf('\n  }', start);
      var body = appSrc.slice(start, end === -1 ? appSrc.length : end);
      h.assertTrue(body.indexOf('Store.isProtectionMode()') !== -1,
        fn + ' 少了保护模式检查');
    });
});

t('阅读栏不参与拖拽 —— 它不是拖拽容器', function () {
  h.assertTrue(dragSrc.indexOf('reading') === -1,
    '阅读栏是纯列表，不该跟拖拽扯上关系');
});

t('CONFIG.PANEL_IDS 就是那三个板块', function () {
  h.assertEqual(CONFIG.PANEL_IDS.join(','), 'reading,pool,templates');
});

// ---------------------------------------------------------------------------
h.group('CSS 守卫：展示上限靠滚动条，保护模式挡得住');

/** 找一条选择器里含 cls、且声明含 decl 的规则 */
function ruleHas(selectorPart, decl) {
  var re = /([^{}]+)\{([^}]*)\}/g;
  var m;
  while ((m = re.exec(css)) !== null) {
    if (m[1].indexOf(selectorPart) !== -1 && m[2].indexOf(decl) !== -1) return true;
  }
  return false;
}

t('已完成的列表有展示上限 + 滚动条（需求「很多的话要支持滚动条拖动」）', function () {
  h.assertTrue(ruleHas('.reading__done-list', 'max-height'), '没有上限就会一直往下撑');
  h.assertTrue(ruleHas('.reading__done-list', 'overflow-y: auto'), '超了要能拖动');
});

t('正在阅读那段同样有上限 + 滚动条', function () {
  h.assertTrue(ruleHas('.reading__list', 'max-height'));
  h.assertTrue(ruleHas('.reading__list', 'overflow-y: auto'));
});

t('收起时把内容藏掉，只留头', function () {
  h.assertTrue(ruleHas('.reading.is-collapsed', 'display: none'));
  h.assertTrue(ruleHas('.pool.is-collapsed', 'display: none'));
  h.assertTrue(ruleHas('.templates.is-collapsed', 'display: none'));
});

t('收起时三角转向（朝向跟着状态走）', function () {
  h.assertTrue(ruleHas('.is-collapsed .panel__toggle', 'rotate(-90deg)'));
});

t('已完成的文字有完成态样式（划掉 / 变淡）', function () {
  h.assertTrue(ruleHas('.reading__item--done .reading__text', '--done-opacity'),
    '完成态要和正在读的看得出来不一样');
});

t('保护模式名单里有阅读栏的写操作按钮', function () {
  ['reading__add', 'reading__check', 'reading__start', 'reading__start-clear',
   'reading__restore', 'reading__del'].forEach(function (cls) {
    h.assertTrue(ruleHas('body.is-readonly .' + cls, 'pointer-events: none'),
      '保护模式下 ' + cls + ' 还能点？');
  });
});

t('保护模式下点文字进编辑也要挡住', function () {
  h.assertTrue(ruleHas('body.is-readonly .reading__text', 'pointer-events: none'));
});

t('收起三角**不在**保护模式名单里（纯界面动作，照常能点）', function () {
  var re = /body\.is-readonly([^{]*)\{([^}]*)\}/g;
  var m;
  while ((m = re.exec(css)) !== null) {
    if (m[1].indexOf('.panel__toggle') !== -1 && m[2].indexOf('pointer-events: none') !== -1) {
      throw new Error('收起三角被挡在保护模式外了 —— 它不发写操作，该照常能点');
    }
  }
});

t('清空起始日期的按钮有样式（不是浏览器默认模样）', function () {
  h.assertTrue(ruleHas('.reading__start-clear', 'cursor: pointer'));
});

t('日期编辑框有样式，且和池里的 pool__date-input 同一副模样', function () {
  // 同一个 <input type="date">，别做成两个样子（见 DS 2.37 修订）
  h.assertTrue(ruleHas('.reading__start-input', 'border: 1px solid var(--q2)'));
  h.assertTrue(ruleHas('.reading__start-input', 'min-height: 32px'), '可点区域不能做小');
  h.assertTrue(ruleHas('.pool__date-input', 'border: 1px solid var(--q2)'));
});

/**
 * 取某个单行选择器的**声明清单**：剥掉注释、压掉空白、排序。
 *
 * 需求要的是「和计划池的日期设定类似的格式」，那就别只测「某个类里有某条声明」——
 * 那样两边的按钮可以越走越远而测试全绿（正是这次反馈的形状）。这里把两边的
 * 规则体整份拿出来比，改了一处忘了另一处就红。
 */
function declsOf(selector) {
  var at = css.indexOf(selector + ' {');
  if (at === -1) return null;
  var open = css.indexOf('{', at);
  var close = css.indexOf('}', open);
  return css.slice(open + 1, close)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(';')
    .map(function (d) { return d.replace(/\s+/g, ' ').trim(); })
    .filter(function (d) { return d !== ''; })
    .sort()
    .join(';');
}

t('CSS：起始日期按钮和池里的完成时间按钮**逐条一致**', function () {
  h.assertTrue(declsOf('.reading__start') !== null, '找不到 .reading__start 的规则');
  h.assertEqual(declsOf('.reading__start'), declsOf('.pool__date'));
  h.assertEqual(declsOf('.reading__start:hover'), declsOf('.pool__date:hover'));
  h.assertEqual(declsOf('.reading__start--empty'), declsOf('.pool__date--empty'));
  h.assertEqual(declsOf('.reading__start--empty:hover'), declsOf('.pool__date--empty:hover'));
});

t('CSS：日期编辑框和清除按钮也和池里逐条一致', function () {
  h.assertEqual(declsOf('.reading__start-input'), declsOf('.pool__date-input'));
  h.assertEqual(declsOf('.reading__start-clear'), declsOf('.pool__date-clear'));
});

t('「起始 → 完成」那串日期不许从中间折行', function () {
  h.assertTrue(ruleHas('.reading__time', 'white-space: nowrap'));
});

t('render.js 里再没有 type="time"（阅读栏的时间已经不是时分了）', function () {
  h.assertFalse(renderSrc.indexOf('type="time"') !== -1,
    '留着时分输入框就等于口径没改干净');
  h.assertTrue(renderSrc.indexOf('type="date"') !== -1);
});

t('日期框仍然走同一条键盘 / 失焦提交（Enter 提交、Escape 取消）', function () {
  var bind = appSrc.slice(appSrc.indexOf('function bindReading()'));
  bind = bind.slice(0, bind.indexOf('\n  }', bind.indexOf('focusout')));
  h.assertTrue(bind.indexOf("closest(e.target, 'reading__start-input')") !== -1,
    '日期框没被键盘 / 失焦认下来，选完日期就提交不了');
});

// ---------------------------------------------------------------------------
h.group('源码守卫：编辑框的输入框都得被提交逻辑认下来（R-40）');

/**
 * `render.js` 里画出来的**编辑框输入框**的 class：`__input` / `-input` 结尾的那些。
 * 勾选框（`*__check`）自然被排除在外 —— 它们不是「编辑框里的值」。
 */
function editorInputClasses() {
  var out = [];
  var re = /<input[^>]*class="([^"]+)"/g;
  var m;
  while ((m = re.exec(renderSrc)) !== null) {
    m[1].split(/\s+/).forEach(function (cls) {
      if (/(__input|-input)$/.test(cls) && out.indexOf(cls) === -1) out.push(cls);
    });
  }
  return out;
}

t('扫描器认得全（正则没过时，守卫才有意义）', function () {
  var list = editorInputClasses();
  ['task__input', 'stage__input', 'pool__date-input', 'reading__start-input']
    .forEach(function (cls) {
      h.assertTrue(list.indexOf(cls) !== -1, '没扫到 ' + cls + '，扫描器该跟着实现改');
    });
});

t('commitEdit 读值的选择器覆盖**所有**编辑框（回归：选完日期反被清空）', function () {
  // 实测出来的真 bug：commitEdit 按 mode 逐个三元挑输入框，只特判了池的日期框，
  // 阅读栏的日期框没被认下来 → 去读 `.task__input` → 读不到 → value 成了空串 →
  // setReadingStart(…, '') 把用户**刚选好的日期清成 null**。改法是一次列出所有
  // 编辑框的选择器（屏幕上同时只有一个编辑框：state.editing 是单个对象）。
  var at = appSrc.indexOf('var input = document.querySelector(');
  h.assertTrue(at !== -1, '找不到 commitEdit 里的选择器，守卫该跟着实现改');
  var sel = appSrc.slice(at, appSrc.indexOf(');', at));

  editorInputClasses().forEach(function (cls) {
    h.assertTrue(sel.indexOf(cls) !== -1,
      cls + ' 没被列进 commitEdit 的选择器 —— 提交时会读到别的框（或读到空串），改动被静默丢弃');
  });
});

t('「同时只有一个编辑框」这个前提在代码里站得住', function () {
  // 上面那条选择器依赖它。state.editing 一旦变成「一堆编辑框」（列表 / 多个并存），
  // document.querySelector 拿到的是**文档顺序里第一个**，就会读错框
  h.assertFalse(/state\.editing\s*=\s*\[/.test(appSrc),
    'state.editing 变成了列表 —— 「一次列出所有编辑框」的选择器就不成立了');
});

t('focusEditor 的查找也用同一张清单', function () {
  var at = renderSrc.indexOf('function focusEditor');
  h.assertTrue(at !== -1);
  var body = renderSrc.slice(at, renderSrc.indexOf('\n  }', at));
  editorInputClasses().forEach(function (cls) {
    h.assertTrue(body.indexOf(cls) !== -1,
      'focusEditor 少了 ' + cls + ' —— 编辑框出现后光标进不去');
  });
});

t('点「清除」时先把手上的编辑收掉（回归：清完编辑框原地不动）', function () {
  // 池里的 doSetPoolDate 进门就是一句 commitEdit()；阅读栏这份漏了，
  // state.editing 还挂着，重画之后编辑框不会消失，用户看不出清没清掉
  var at = appSrc.indexOf('function doSetReadingStart(');
  h.assertTrue(at !== -1);
  var body = appSrc.slice(at, appSrc.indexOf('\n  }', at));
  h.assertTrue(body.indexOf('commitEdit();') !== -1,
    '少了 commitEdit()：清完不重画成「未设定」，编辑框会原地留着');
});

t('唤起日期框的方式和池里对齐（focusEditor(false)）', function () {
  var at = appSrc.indexOf('function startEditReadingStart(');
  h.assertTrue(at !== -1);
  var body = appSrc.slice(at, appSrc.indexOf('\n  }', at));
  h.assertTrue(body.indexOf('Render.focusEditor(false)') !== -1,
    '和 startEditPoolDate 一样：date 框 select() 没有意义');
});

// ---------------------------------------------------------------------------

h.summary('阅读栏（v2.8 需求 2）');
