/**
 * test-store-recovery.js
 *
 * 检查主数据坏了能不能按顺序从 4 个备份里救回来，
 * 以及全坏的时候保护模式有没有真的挡住写入（见 DS 3.2、2.4）。
 *
 * 跑法：node test/test-store-recovery.js
 */
'use strict';

var h = require('./harness');
var Store = require('../js/store');
var CONFIG = require('../js/config');

var t = h.test;

function task(text) {
  return { id: 'id_x', text: text, completed: false, createdAt: 1759300000000 };
}

function dayWith(text) {
  return { I: [task(text)], II: [], III: [], IV: [] };
}

/** 造一份带 n 条任务的数据 */
function dataWith(dateStr, texts) {
  var data = Store.createEmpty();
  var day = Store.ensureDay(data, dateStr);
  for (var i = 0; i < texts.length; i++) day.I.push(task(texts[i]));
  return data;
}

/** 直接往存储里塞一份备份（savedAt 可以指定） */
function putBackup(storage, index, data, savedAt) {
  storage.setItem(CONFIG.KEYS.backups[index], JSON.stringify({
    savedAt: savedAt,
    data: data
  }));
}

// ---------------------------------------------------------------------------
h.group('主数据坏了，从备份救回来');

t('备份 1 能用就用备份 1', function () {
  var storage = h.createMemoryStorage();
  Store.init({ storage: storage, clock: function () { return 1759300000000; } });

  storage.setItem(CONFIG.KEYS.userData, '{坏掉的 json');
  putBackup(storage, 0, dataWith('2026-10-01', ['从备份1救回']), 1759200000000);

  var loaded = Store.load();
  h.assertEqual(loaded.status, 'recovered');
  h.assertEqual(loaded.data.dates['2026-10-01'].I[0].text, '从备份1救回');
  h.assertFalse(Store.isProtectionMode());
});

t('恢复之后要把好的数据写回主数据，不能只是内存里有', function () {
  var storage = h.createMemoryStorage();
  Store.init({ storage: storage, clock: function () { return 1759300000000; } });

  storage.setItem(CONFIG.KEYS.userData, '{坏掉的 json');
  putBackup(storage, 0, dataWith('2026-10-01', ['救回来']), 1759200000000);

  Store.load();

  // 再读一次，这次不该再走恢复流程了
  var again = Store.load();
  h.assertEqual(again.status, 'ok');
  h.assertEqual(again.data.dates['2026-10-01'].I[0].text, '救回来');
});

t('恢复提示里要带上「恢复到什么时候」', function () {
  var storage = h.createMemoryStorage();
  Store.init({ storage: storage, clock: function () { return 1759300000000; } });

  storage.setItem(CONFIG.KEYS.userData, 'not json');
  putBackup(storage, 0, dataWith('2026-10-01', ['x']), 1759200000000);

  var loaded = Store.load();
  h.assertEqual(loaded.savedAt, 1759200000000,
    'savedAt 就是那句「已从备份恢复到 X 月 X 日 X 点」的依据');
  h.assertTrue(!!loaded.message, '得有提示文案');
});

// ---------------------------------------------------------------------------
h.group('按顺序往后试');

t('备份 1 坏了就试备份 2', function () {
  var storage = h.createMemoryStorage();
  Store.init({ storage: storage, clock: function () { return 1759300000000; } });

  storage.setItem(CONFIG.KEYS.userData, '坏');
  storage.setItem(CONFIG.KEYS.backups[0], '这也不是 json');
  putBackup(storage, 1, dataWith('2026-10-01', ['从备份2救回']), 1759100000000);

  var loaded = Store.load();
  h.assertEqual(loaded.status, 'recovered');
  h.assertEqual(loaded.data.dates['2026-10-01'].I[0].text, '从备份2救回');
});

t('前面三份都坏，从备份 4 救回来', function () {
  var storage = h.createMemoryStorage();
  Store.init({ storage: storage, clock: function () { return 1759300000000; } });

  storage.setItem(CONFIG.KEYS.userData, '坏');
  storage.setItem(CONFIG.KEYS.backups[0], '坏');
  storage.setItem(CONFIG.KEYS.backups[1], '坏');
  storage.setItem(CONFIG.KEYS.backups[2], '坏');
  putBackup(storage, 3, dataWith('2026-10-01', ['从备份4救回']), 1759000000000);

  var loaded = Store.load();
  h.assertEqual(loaded.status, 'recovered');
  h.assertEqual(loaded.data.dates['2026-10-01'].I[0].text, '从备份4救回');
});

t('备份本身结构不对（没有 data 字段）也会被跳过', function () {
  var storage = h.createMemoryStorage();
  Store.init({ storage: storage, clock: function () { return 1759300000000; } });

  storage.setItem(CONFIG.KEYS.userData, '坏');
  storage.setItem(CONFIG.KEYS.backups[0], JSON.stringify({ savedAt: 1 }));
  putBackup(storage, 1, dataWith('2026-10-01', ['好备份']), 1759100000000);

  h.assertEqual(Store.load().status, 'recovered');
});

t('空槽位直接跳过，不算坏', function () {
  var storage = h.createMemoryStorage();
  Store.init({ storage: storage, clock: function () { return 1759300000000; } });

  storage.setItem(CONFIG.KEYS.userData, '坏');
  // 只有最后一个槽有东西
  putBackup(storage, 3, dataWith('2026-10-01', ['最后一个槽']), 1759000000000);

  h.assertEqual(Store.load().status, 'recovered');
});

// ---------------------------------------------------------------------------
h.group('全坏 → 保护模式');

function brokenEverything() {
  var storage = h.createMemoryStorage();
  Store.init({ storage: storage, clock: function () { return 1759300000000; } });
  storage.setItem(CONFIG.KEYS.userData, '主数据坏了');
  for (var i = 0; i < CONFIG.KEYS.backups.length; i++) {
    storage.setItem(CONFIG.KEYS.backups[i], '备份' + i + '也坏了');
  }
  return storage;
}

t('进入保护模式，并给出提示', function () {
  var storage = brokenEverything();
  var loaded = Store.load();

  h.assertEqual(loaded.status, 'protected');
  h.assertTrue(Store.isProtectionMode());
  h.assertTrue(!!loaded.message);
  h.assertEqual(Object.keys(loaded.data.dates).length, 0, '内存里给一份空的先撑住页面');
});

t('保护模式下拒绝一切写入', function () {
  brokenEverything();
  Store.load();

  var result = Store.save(dataWith('2026-10-02', ['保护模式下偷加的']));
  h.assertFalse(result.ok);
  h.assertEqual(result.error, 'PROTECTED');
});

t('保护模式下磁盘上那份原始数据一个字节都没变', function () {
  // 这是保护模式存在的全部意义 —— DS 2.4 里那句「不覆盖原文件」
  var storage = brokenEverything();
  var before = storage.getItem(CONFIG.KEYS.userData);

  Store.load();
  Store.save(dataWith('2026-10-02', ['试图覆盖']));
  Store.save(dataWith('2026-10-03', ['再试一次']));

  h.assertEqual(storage.getItem(CONFIG.KEYS.userData), before,
    '原始数据必须原封不动，否则那份「读不出来但可能还能救」的数据就永远没了');
});

t('保护模式下备份也不该被动', function () {
  var storage = brokenEverything();
  var before = storage.getItem(CONFIG.KEYS.backups[0]);

  Store.load();
  Store.save(dataWith('2026-10-02', ['x']));

  h.assertEqual(storage.getItem(CONFIG.KEYS.backups[0]), before, '备份不该被覆盖');
});

t('用户做出选择之后可以退出保护模式', function () {
  brokenEverything();
  Store.load();
  h.assertTrue(Store.isProtectionMode());

  Store.exitProtectionMode();
  h.assertFalse(Store.isProtectionMode());

  h.assertTrue(Store.save(dataWith('2026-10-02', ['用户决定重新开始'])).ok);
});

// ---------------------------------------------------------------------------
h.group('安卓 durable 副本');

/** 造一份「有主存储 + 有一份安卓副本」的环境 */
function withDurable(opts) {
  opts = opts || {};
  var storage = h.createMemoryStorage();
  var durable = h.createMemoryStorage();

  if (opts.marker !== false) durable.setItem(CONFIG.PREFS_KEYS.marker, '1');
  if (opts.durableData) {
    durable.setItem(CONFIG.PREFS_KEYS.backup, JSON.stringify({
      savedAt: opts.durableSavedAt || 1759000000000,
      data: opts.durableData
    }));
  }

  Store.init({
    storage: storage,
    durable: durable,
    clock: function () { return 1759300000000; }
  });
  return { storage: storage, durable: durable };
}

t('本地全废时从 durable 副本救回来', function () {
  var ctx = withDurable({ durableData: dataWith('2026-10-01', ['从安卓副本救回']) });
  ctx.storage.setItem(CONFIG.KEYS.userData, '坏');

  var loaded = Store.load();
  h.assertEqual(loaded.status, 'recovered-local');
  h.assertEqual(loaded.data.dates['2026-10-01'].I[0].text, '从安卓副本救回');
  h.assertFalse(Store.isProtectionMode());
});

t('本地备份还在时优先用本地备份，不用 durable', function () {
  var ctx = withDurable({ durableData: dataWith('2026-10-01', ['durable 版']) });
  ctx.storage.setItem(CONFIG.KEYS.userData, '坏');
  putBackup(ctx.storage, 0, dataWith('2026-10-01', ['本地备份版']), 1759200000000);

  var loaded = Store.load();
  h.assertEqual(loaded.status, 'recovered');
  h.assertEqual(loaded.data.dates['2026-10-01'].I[0].text, '本地备份版');
});

t('新用户（没有 marker）绝不能从 durable 恢复', function () {
  // 这是 DS 3.3 的验收项：第一次装 App 正常显示空状态，不弹恢复提示
  var ctx = withDurable({ marker: false, durableData: dataWith('2026-10-01', ['不该被读到']) });

  var loaded = Store.load();
  h.assertEqual(loaded.status, 'new', '没有 marker 就是新用户');
  h.assertEqual(Object.keys(loaded.data.dates).length, 0);
  h.assertFalse(Store.isProtectionMode(), '新用户不该进保护模式');
});

t('marker 在、数据没了 —— 当作读不出来，不硬撑', function () {
  var ctx = withDurable({ durableData: null });
  ctx.storage.setItem(CONFIG.KEYS.userData, '坏');
  // 有 marker 但没有备份内容，且没有任何本地备份 → 应该进保护模式

  h.assertEqual(Store.load().status, 'protected');
});

t('flushDurable 会先写数据再写标记', function () {
  var ctx = withDurable({ marker: false });
  var data = dataWith('2026-10-01', ['待落盘']);

  Store.markDurableDirty(data);
  h.assertFalse(!!ctx.durable.getItem(CONFIG.PREFS_KEYS.marker), '还没落盘就不该有标记');

  h.assertTrue(Store.flushDurable());
  h.assertEqual(ctx.durable.getItem(CONFIG.PREFS_KEYS.marker), '1');
  h.assertTrue(!!ctx.durable.getItem(CONFIG.PREFS_KEYS.backup));
});

t('flushDurable 在同一份数据上重复调用不会重复写', function () {
  var ctx = withDurable({ marker: false });
  Store.markDurableDirty(dataWith('2026-10-01', ['x']));
  h.assertTrue(Store.flushDurable());
  h.assertFalse(Store.flushDurable(), '没有新的脏数据就不该再写一遍');
});

t('网页版没有 durable 时一切照常', function () {
  var storage = h.createMemoryStorage();
  Store.init({ storage: storage, clock: function () { return 1759300000000; } });

  var data = dataWith('2026-10-01', ['网页版']);
  h.assertTrue(Store.save(data).ok);
  Store.markDurableDirty(data);
  h.assertFalse(Store.flushDurable(), '没有 durable 后端就什么都不做');
  h.assertEqual(Store.load().data.dates['2026-10-01'].I[0].text, '网页版');
});

// ---------------------------------------------------------------------------

h.summary('store.js 恢复与保护模式');
