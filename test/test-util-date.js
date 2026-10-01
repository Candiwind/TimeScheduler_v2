/**
 * test-util-date.js
 *
 * 检查 util.js 的日期处理（见 DS 3.2）。
 * 重点是跨月跨年别出现 `2026-13-01` 这种错误日期，
 * 以及别掉进「用了 toISOString 导致东八区差一天」的坑。
 *
 * 跑法：node test/test-util-date.js
 */
'use strict';

var h = require('./harness');
var Util = require('../js/util');

var t = h.test;

// ---------------------------------------------------------------------------
h.group('formatDate：本地时区，不能用 UTC');

t('普通日期', function () {
  h.assertEqual(Util.formatDate(new Date(2026, 9, 1)), '2026-10-01');
});

t('月和日补零', function () {
  h.assertEqual(Util.formatDate(new Date(2026, 0, 5)), '2026-01-05');
});

t('凌晨 00:30 仍然是当天（东八区最容易错的一条）', function () {
  // 用 toISOString() 的话，东八区会把这里算成 2026-09-30
  h.assertEqual(Util.formatDate(new Date(2026, 9, 1, 0, 30)), '2026-10-01');
});

t('深夜 23:30 仍然是当天', function () {
  h.assertEqual(Util.formatDate(new Date(2026, 9, 1, 23, 30)), '2026-10-01');
});

t('跨年的时间点', function () {
  h.assertEqual(Util.formatDate(new Date(2026, 11, 31, 23, 59)), '2026-12-31');
  h.assertEqual(Util.formatDate(new Date(2027, 0, 1, 0, 1)), '2027-01-01');
});

t('非法输入返回 null', function () {
  h.assertNull(Util.formatDate(null));
  h.assertNull(Util.formatDate('2026-10-01'));
  h.assertNull(Util.formatDate(new Date('nonsense')));
});

// ---------------------------------------------------------------------------
h.group('isValidDateStr：正则挡不住的那些');

t('正常日期', function () {
  h.assertTrue(Util.isValidDateStr('2026-10-01'));
  h.assertTrue(Util.isValidDateStr('2028-02-29'), '闰年 2 月 29 日应该合法');
});

t('13 月——就是 DS 里点名要防的那个', function () {
  h.assertFalse(Util.isValidDateStr('2026-13-01'));
});

t('0 月 / 0 日', function () {
  h.assertFalse(Util.isValidDateStr('2026-00-10'));
  h.assertFalse(Util.isValidDateStr('2026-10-00'));
});

t('2 月 30 日：正则能过，但日期不存在', function () {
  h.assertFalse(Util.isValidDateStr('2026-02-30'));
});

t('平年 2 月 29 日不存在，闰年才有', function () {
  h.assertFalse(Util.isValidDateStr('2026-02-29'), '2026 不是闰年');
  h.assertTrue(Util.isValidDateStr('2028-02-29'), '2028 是闰年');
});

t('大写日期：必须是补零的两位', function () {
  h.assertFalse(Util.isValidDateStr('2026-1-1'));
  h.assertFalse(Util.isValidDateStr('2026-1-01'));
});

t('乱七八糟的输入', function () {
  h.assertFalse(Util.isValidDateStr(''));
  h.assertFalse(Util.isValidDateStr('today'));
  h.assertFalse(Util.isValidDateStr('2026/10/01'));
  h.assertFalse(Util.isValidDateStr('2026-10-01T00:00:00'));
  h.assertFalse(Util.isValidDateStr(null));
  h.assertFalse(Util.isValidDateStr(20261001));
  h.assertFalse(Util.isValidDateStr(undefined));
});

// ---------------------------------------------------------------------------
h.group('addDays：跨月跨年');

t('加一天 / 减一天', function () {
  h.assertEqual(Util.addDays('2026-10-01', 1), '2026-10-02');
  h.assertEqual(Util.addDays('2026-10-02', -1), '2026-10-01');
  h.assertEqual(Util.addDays('2026-10-01', 0), '2026-10-01');
});

t('跨月：月底加一天', function () {
  h.assertEqual(Util.addDays('2026-01-31', 1), '2026-02-01');
  h.assertEqual(Util.addDays('2026-04-30', 1), '2026-05-01');
  h.assertEqual(Util.addDays('2026-09-30', 1), '2026-10-01');
});

t('跨月：月初减一天', function () {
  h.assertEqual(Util.addDays('2026-03-01', -1), '2026-02-28');
  h.assertEqual(Util.addDays('2026-05-01', -1), '2026-04-30');
});

t('跨年：12-31 加一天', function () {
  h.assertEqual(Util.addDays('2026-12-31', 1), '2027-01-01');
});

t('跨年：01-01 减一天', function () {
  h.assertEqual(Util.addDays('2027-01-01', -1), '2026-12-31');
});

t('闰年 2 月', function () {
  h.assertEqual(Util.addDays('2028-02-28', 1), '2028-02-29');
  h.assertEqual(Util.addDays('2028-02-29', 1), '2028-03-01');
});

t('平年 2 月', function () {
  h.assertEqual(Util.addDays('2026-02-28', 1), '2026-03-01');
});

t('一次跨好几个月', function () {
  h.assertEqual(Util.addDays('2026-01-15', 200), '2026-08-03');
});

t('非法日期输入返回 null', function () {
  h.assertNull(Util.addDays('2026-13-01', 1));
  h.assertNull(Util.addDays('nope', 1));
  h.assertNull(Util.addDays('2026-10-01', NaN));
});

t('连续推 800 天，每一步都得是合法日期且严格递增', function () {
  // 这是「别出现 2026-13-01」的主力用例：只要进位逻辑写错了（比如自己
  // 手动加月份而不处理溢出），连续推演几百天后一定会露出来。
  var cur = '2026-01-01';
  var prev = null;
  for (var i = 0; i < 800; i++) {
    h.assertTrue(Util.isValidDateStr(cur), '第 ' + i + ' 天不是合法日期：' + cur);
    if (prev !== null) {
      h.assertEqual(Util.diffDays(prev, cur), 1, '第 ' + i + ' 天和上一天没差整 1 天');
    }
    prev = cur;
    cur = Util.addDays(cur, 1);
  }
});

// ---------------------------------------------------------------------------
h.group('diffDays / compareDateStr');

t('同一天相差 0 天', function () {
  h.assertEqual(Util.diffDays('2026-10-01', '2026-10-01'), 0);
});

t('跨月跨年都算对', function () {
  h.assertEqual(Util.diffDays('2026-10-01', '2026-10-02'), 1);
  h.assertEqual(Util.diffDays('2026-01-31', '2026-02-01'), 1);
  h.assertEqual(Util.diffDays('2026-12-31', '2027-01-01'), 1);
  h.assertEqual(Util.diffDays('2026-01-01', '2027-01-01'), 365);
  h.assertEqual(Util.diffDays('2028-01-01', '2029-01-01'), 366, '2028 是闰年');
});

t('反过来是负数', function () {
  h.assertEqual(Util.diffDays('2026-10-02', '2026-10-01'), -1);
});

t('字典序就是时间序', function () {
  h.assertEqual(Util.compareDateStr('2026-10-01', '2026-10-02'), -1);
  h.assertEqual(Util.compareDateStr('2026-10-02', '2026-10-01'), 1);
  h.assertEqual(Util.compareDateStr('2026-10-01', '2026-10-01'), 0);
});

// ---------------------------------------------------------------------------
h.group('todayStr');

t('返回的一定是合法日期，而且就是本地今天', function () {
  var s = Util.todayStr();
  h.assertTrue(Util.isValidDateStr(s), 'todayStr 返回了非法日期：' + s);
  h.assertEqual(s, Util.formatDate(new Date()));
});

t('可以传入指定时间，方便测试', function () {
  h.assertEqual(Util.todayStr(new Date(2026, 9, 1, 12, 0)), '2026-10-01');
});

// ---------------------------------------------------------------------------
h.group('文本清洗');

t('去掉首尾空格', function () {
  h.assertEqual(Util.cleanText('  写报告  '), '写报告');
});

t('全角空格也要去掉（中文输入法下很常见）', function () {
  h.assertEqual(Util.cleanText('　写报告　'), '写报告');
});

t('中间的空格保留', function () {
  h.assertEqual(Util.cleanText(' 写 报告 '), '写 报告');
});

t('纯空白算空任务', function () {
  h.assertFalse(Util.isValidTaskText('   '));
  h.assertFalse(Util.isValidTaskText('　　'));
  h.assertFalse(Util.isValidTaskText(''));
  h.assertFalse(Util.isValidTaskText(null));
});

t('有内容就算合法', function () {
  h.assertTrue(Util.isValidTaskText(' 写报告 '));
  h.assertTrue(Util.isValidTaskText('a'));
});

// ---------------------------------------------------------------------------
h.group('escapeHtml');

t('尖括号和引号都要转义', function () {
  h.assertEqual(Util.escapeHtml('<script>'), '&lt;script&gt;');
  h.assertEqual(Util.escapeHtml('a"b'), 'a&quot;b');
  h.assertEqual(Util.escapeHtml("a'b"), 'a&#39;b');
  h.assertEqual(Util.escapeHtml('a&b'), 'a&amp;b');
});

t('& 要先转，不能转成 &amp;lt;', function () {
  h.assertEqual(Util.escapeHtml('&lt;'), '&amp;lt;');
});

t('普通中文不受影响', function () {
  h.assertEqual(Util.escapeHtml('写季度报告'), '写季度报告');
});

// ---------------------------------------------------------------------------
h.group('genId');

t('连续生成的编号不重复', function () {
  var seen = {};
  for (var i = 0; i < 5000; i++) {
    var id = Util.genId();
    h.assertFalse(seen[id], '编号撞了：' + id);
    seen[id] = true;
  }
});

t('形如 id_xxx_xxx', function () {
  h.assertTrue(/^id_[0-9a-z]+_[0-9a-z]+$/.test(Util.genId()), '编号格式不对');
});

// ---------------------------------------------------------------------------
h.group('fileStamp');

t('形如 20261001-1530', function () {
  h.assertEqual(Util.fileStamp(new Date(2026, 9, 1, 15, 30)), '20261001-1530');
});

// ---------------------------------------------------------------------------

h.summary('util.js 日期与文本');
