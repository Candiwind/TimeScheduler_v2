/**
 * test-theme.js
 *
 * 检查主题的切换、记住，以及**主题绝不能混进导出的数据里**（见 DS 3.3、D-11）。
 *
 * 最后那条是重点：主题是「这台设备看着舒服」的设置，一旦混进用户数据，
 * 用户把备份文件发给别人，别人打开就莫名其妙变成了暗色；反过来，
 * 用户在手机上切了暗色，回家打开电脑也变成暗色 —— 都是很别扭的事。
 *
 * 跑法：node test/test-theme.js
 */
'use strict';

var h = require('./harness');
var Store = require('../js/store');
var Theme = require('../js/theme');
var CONFIG = require('../js/config');
var Exporter = require('../js/exporter');

var t = h.test;

function fresh() {
  var storage = h.createMemoryStorage();
  Store.init({ storage: storage, clock: function () { return 1759300000000; } });
  return storage;
}

// ---------------------------------------------------------------------------
h.group('切换逻辑');

t('亮色切过去是暗色', function () {
  h.assertEqual(Theme.next(CONFIG.THEMES.LIGHT), CONFIG.THEMES.DARK);
});

t('暗色切过去是亮色', function () {
  h.assertEqual(Theme.next(CONFIG.THEMES.DARK), CONFIG.THEMES.LIGHT);
});

t('来回切两次回到原点', function () {
  h.assertEqual(
    Theme.next(Theme.next(CONFIG.THEMES.LIGHT)),
    CONFIG.THEMES.LIGHT);
});

t('不认识的值当作亮色处理', function () {
  h.assertEqual(Theme.next('紫色'), CONFIG.THEMES.LIGHT);
  h.assertEqual(Theme.next(null), CONFIG.THEMES.LIGHT);
});

// ---------------------------------------------------------------------------
h.group('收敛：不认识的设置一律回亮色');

t('暗色是暗色', function () {
  h.assertEqual(Theme.normalize('dark'), 'dark');
});

t('亮色是亮色', function () {
  h.assertEqual(Theme.normalize('light'), 'light');
});

t('乱七八糟的值都回亮色', function () {
  h.assertEqual(Theme.normalize('pink'), 'light');
  h.assertEqual(Theme.normalize(''), 'light');
  h.assertEqual(Theme.normalize(null), 'light');
  h.assertEqual(Theme.normalize(undefined), 'light');
  h.assertEqual(Theme.normalize(0), 'light');
  h.assertEqual(Theme.normalize({}), 'light');
});

t('大小写敏感 —— DARK 不是 dark', function () {
  h.assertEqual(Theme.normalize('DARK'), 'light');
});

// ---------------------------------------------------------------------------
h.group('记住：刷新之后还在');

t('没存过时默认是亮色', function () {
  fresh();
  h.assertEqual(Store.getTheme(), 'light');
});

t('存了暗色就能读回暗色', function () {
  fresh();
  Store.setTheme('dark');
  h.assertEqual(Store.getTheme(), 'dark');
});

t('存了亮色就能读回亮色', function () {
  fresh();
  Store.setTheme('dark');
  Store.setTheme('light');
  h.assertEqual(Store.getTheme(), 'light');
});

t('存进去乱七八糟的值，读出来是亮色', function () {
  var storage = fresh();
  storage.setItem(CONFIG.KEYS.theme, '青色');
  h.assertEqual(Store.getTheme(), 'light', '读不出来就回到亮色，不能崩');
});

t('主题存在自己单独的 key 里', function () {
  var storage = fresh();
  Store.setTheme('dark');

  h.assertEqual(storage.getItem(CONFIG.KEYS.theme), 'dark');
  h.assertNull(storage.getItem(CONFIG.KEYS.userData), '存主题不该顺手把主数据也建出来');
});

t('主题删掉之后回到亮色', function () {
  var storage = fresh();
  Store.setTheme('dark');
  storage.removeItem(CONFIG.KEYS.theme);
  h.assertEqual(Store.getTheme(), 'light');
});

t('主题的 key 和主数据的 key 不是同一个', function () {
  h.assertFalse(CONFIG.KEYS.theme === CONFIG.KEYS.userData);
  h.assertTrue(CONFIG.KEYS.userData.indexOf(CONFIG.KEYS.theme) === -1);
});

// ---------------------------------------------------------------------------
h.group('主题绝不能混进导出的数据（D-11 的重点）');

t('主数据对象里没有主题', function () {
  fresh();
  Store.setTheme('dark');

  var data = Store.createEmpty();
  var keys = Object.keys(data).sort();
  h.assertEqual(keys.join(','), 'dates,pool,reading,schemaVersion,templates,user',
    '主题永远不进主数据（pool / templates 是 v1.1 的计划池 / 模板字段，' +
    'reading 是 v2.8 的阅读栏，见 DS 2.11 / 2.14 / 2.37）');
});

t('切换主题不会往主数据里写任何东西', function () {
  var storage = fresh();
  var data = Store.createEmpty();
  Store.save(data);
  var before = storage.getItem(CONFIG.KEYS.userData);

  Store.setTheme('dark');
  Store.setTheme('light');
  Store.setTheme('dark');

  h.assertEqual(storage.getItem(CONFIG.KEYS.userData), before,
    '主题是另一条路，不该碰主数据一个字节');
});

t('导出的 JSON 里搜不到主题', function () {
  fresh();
  Store.setTheme('dark');

  var data = Store.createEmpty();
  var json = Store.serialize(data);

  h.assertFalse(json.indexOf('theme') !== -1, 'JSON 里不该有 theme 这个词');
  h.assertFalse(json.indexOf('dark') !== -1, '更不该有具体的主题值');
});

t('导出的 Markdown 里也没有主题', function () {
  fresh();
  Store.setTheme('dark');

  var data = Store.createEmpty();
  require('../js/task-ops').addTask(data, '2026-10-01', 'I', '写报告');

  var md = Exporter.buildMarkdown(data);
  h.assertFalse(md.indexOf('dark') !== -1);
  h.assertFalse(md.indexOf('主题') !== -1);
});

t('主题不在任何一份备份里', function () {
  // 4 份滚动备份是主数据的逐字拷贝，主数据里没有主题，备份里自然也没有
  var storage = fresh();
  Store.setTheme('dark');

  var data = Store.createEmpty();
  require('../js/task-ops').addTask(data, '2026-10-01', 'I', '第一条');
  Store.save(data);
  Store.resetThrottle();
  require('../js/task-ops').addTask(data, '2026-10-01', 'I', '第二条');
  Store.save(data);

  for (var i = 0; i < CONFIG.KEYS.backups.length; i++) {
    var raw = storage.getItem(CONFIG.KEYS.backups[i]);
    if (raw) {
      h.assertFalse(raw.indexOf('"dark"') !== -1, '第 ' + (i + 1) + ' 份备份里混进了主题');
    }
  }
});

// ---------------------------------------------------------------------------
h.group('坏了也不能影响主流程');

t('主题存不进去（空间满了）不该让保存数据也失败', function () {
  var storage = h.createMemoryStorage();
  var tight = h.createMemoryStorage({ quotaBytes: 1 });
  Store.init({ storage: tight, clock: function () { return 1759300000000; } });

  // setTheme 内部吞掉了异常，就是不让它影响主流程
  Store.setTheme('dark');
  h.assertEqual(Store.getTheme(), 'light', '存不上就还是亮色，但不报错');
});

// ---------------------------------------------------------------------------

h.summary('theme.js 主题切换');
