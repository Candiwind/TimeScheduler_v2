/**
 * test-store-serialize.js
 *
 * 检查 store.js 的存取、空日期、备份轮转和 30 秒限流（见 DS 3.2）。
 *
 * 跑法：node test/test-store-serialize.js
 */
'use strict';

var h = require('./harness');
var Store = require('../js/store');
var CONFIG = require('../js/config');

var t = h.test;

/** 每个用例都从干净的存储和可控时钟开始 */
function fresh(now) {
  var storage = h.createMemoryStorage();
  var current = typeof now === 'number' ? now : 1759300000000;
  Store.init({
    storage: storage,
    clock: function () { return current; },
    // 测试里手动拨表
    __setNow: undefined
  });
  return {
    storage: storage,
    advance: function (ms) { current += ms; },
    now: function () { return current; }
  };
}

/** 造一条任务 */
function task(text, completed) {
  return {
    id: 'id_test_' + Math.random().toString(36).slice(2, 8),
    text: text,
    completed: !!completed,
    createdAt: 1759300000000
  };
}

// ---------------------------------------------------------------------------
h.group('创建空数据');

t('createEmpty 的结构', function () {
  var data = Store.createEmpty();
  h.assertEqual(data.user, 'default');
  h.assertEqual(data.schemaVersion, CONFIG.SCHEMA_VERSION);
  h.assertEqual(typeof data.dates, 'object');
  h.assertEqual(Object.keys(data.dates).length, 0);
});

t('emptyDay 有四个象限，都是空列表', function () {
  var day = Store.emptyDay();
  h.assertEqual(Object.keys(day).length, 4);
  h.assertEqual(day.I.length, 0);
  h.assertEqual(day.II.length, 0);
  h.assertEqual(day.III.length, 0);
  h.assertEqual(day.IV.length, 0);
});

t('空数据对象里**不能**有同步凭据', function () {
  // D-23：凭据是独立 key，主数据对象里永远只有 user / schemaVersion / dates / pool / templates
  // （pool 是 v1.1 追加的计划池字段、templates 是 v1.1 追加的模板字段，
  //  见 DS 2.3 / 2.11 / 2.14，schemaVersion 仍为 1）
  var data = Store.createEmpty();
  var keys = Object.keys(data).sort();
  h.assertEqual(keys.join(','), 'dates,pool,schemaVersion,templates,user');
});

// ---------------------------------------------------------------------------
h.group('存进去再读出来');

t('保存后能原样读回来', function () {
  var ctx = fresh();
  var data = Store.createEmpty();
  var day = Store.ensureDay(data, '2026-10-01');
  day.I.push(task('写季度报告', false));
  day.III.push(task('回邮件', true));

  h.assertTrue(Store.save(data).ok);

  var loaded = Store.load();
  h.assertEqual(loaded.status, 'ok');
  h.assertEqual(loaded.data.dates['2026-10-01'].I.length, 1);
  h.assertEqual(loaded.data.dates['2026-10-01'].I[0].text, '写季度报告');
  h.assertEqual(loaded.data.dates['2026-10-01'].I[0].completed, false);
  h.assertEqual(loaded.data.dates['2026-10-01'].III[0].completed, true);
});

t('勾选状态和排列顺序都保住', function () {
  var ctx = fresh();
  var data = Store.createEmpty();
  var day = Store.ensureDay(data, '2026-10-01');
  day.I.push(task('第一', false));
  day.I.push(task('第二', true));
  day.I.push(task('第三', false));
  Store.save(data);

  var loaded = Store.load();
  var list = loaded.data.dates['2026-10-01'].I;
  h.assertEqual(list[0].text, '第一');
  h.assertEqual(list[1].text, '第二');
  h.assertEqual(list[2].text, '第三');
  h.assertEqual(list[1].completed, true);
});

t('没存过任何东西 = 新用户，不是数据丢了', function () {
  var ctx = fresh();
  var loaded = Store.load();
  h.assertEqual(loaded.status, 'new');
  h.assertFalse(Store.isProtectionMode(), '新用户绝不能进保护模式');
  h.assertEqual(loaded.message, null, '新用户不该弹任何恢复提示');
});

// ---------------------------------------------------------------------------
h.group('空日期返回空列表');

t('查一个从没有过数据的日期', function () {
  var data = Store.createEmpty();
  Store.ensureDay(data, '2026-10-01').I.push(task('写报告'));

  var day = Store.getDayTasks(data, '2026-10-02');
  h.assertEqual(day.I.length, 0);
  h.assertEqual(day.II.length, 0);
  h.assertEqual(day.III.length, 0);
  h.assertEqual(day.IV.length, 0);
});

t('查出来的四个象限永远存在，不会少键', function () {
  var day = Store.getDayTasks(Store.createEmpty(), '2026-10-02');
  h.assertEqual(Object.keys(day).sort().join(','), 'I,II,III,IV');
});

t('getDayTasks 返回的是副本，改它不影响原数据', function () {
  var data = Store.createEmpty();
  Store.ensureDay(data, '2026-10-01').I.push(task('写报告'));

  var day = Store.getDayTasks(data, '2026-10-01');
  day.I.push(task('偷加的'));

  h.assertEqual(data.dates['2026-10-01'].I.length, 1);
});

t('hasAnyTask 判断得对', function () {
  var data = Store.createEmpty();
  h.assertFalse(Store.hasAnyTask(data, '2026-10-01'));
  Store.ensureDay(data, '2026-10-01').IV.push(task('随便什么'));
  h.assertTrue(Store.hasAnyTask(data, '2026-10-01'));
});

t('ensureDay 对非法日期会抛错', function () {
  var data = Store.createEmpty();
  h.assertThrows(function () { Store.ensureDay(data, '2026-13-01'); }, '日期不合法');
});

// ---------------------------------------------------------------------------
h.group('备份轮转');

t('第一次保存时没有上一版可备份', function () {
  var ctx = fresh();
  var data = Store.createEmpty();
  Store.ensureDay(data, '2026-10-01').I.push(task('第一版'));
  Store.save(data);

  h.assertNull(ctx.storage.getItem(CONFIG.KEYS.backups[0]));
});

t('第二次保存把上一版挪进备份 1', function () {
  var ctx = fresh();
  var data = Store.createEmpty();
  Store.ensureDay(data, '2026-10-01').I.push(task('第一版'));
  Store.save(data);

  ctx.advance(CONFIG.BACKUP_THROTTLE_MS); // 过了限流窗口

  data.dates['2026-10-01'].I.push(task('第二版'));
  Store.save(data);

  var raw = ctx.storage.getItem(CONFIG.KEYS.backups[0]);
  h.assertTrue(!!raw, '备份 1 应该有东西了');
  var envelope = JSON.parse(raw);
  h.assertEqual(envelope.data.dates['2026-10-01'].I.length, 1, '备份里是上一版（只有 1 条）');
  h.assertEqual(envelope.data.dates['2026-10-01'].I[0].text, '第一版');

  // 主数据是新的
  h.assertEqual(Store.load().data.dates['2026-10-01'].I.length, 2);
});

t('每次轮转旧的往后挪一格', function () {
  var ctx = fresh();
  var data = Store.createEmpty();
  Store.ensureDay(data, '2026-10-01');

  for (var n = 1; n <= 5; n++) {
    data.dates['2026-10-01'].I.push(task('第' + n + '版'));
    Store.save(data);
    ctx.advance(CONFIG.BACKUP_THROTTLE_MS);
  }

  // 备份 1 应该是倒数第二版（4 条），依次往前
  var b0 = JSON.parse(ctx.storage.getItem(CONFIG.KEYS.backups[0]));
  var b1 = JSON.parse(ctx.storage.getItem(CONFIG.KEYS.backups[1]));
  h.assertEqual(b0.data.dates['2026-10-01'].I.length, 4);
  h.assertEqual(b1.data.dates['2026-10-01'].I.length, 3);
});

t('备份只留 4 份，最旧的被挤掉', function () {
  var ctx = fresh();
  var data = Store.createEmpty();
  Store.ensureDay(data, '2026-10-01');

  for (var n = 1; n <= 10; n++) {
    data.dates['2026-10-01'].I.push(task('第' + n + '版'));
    Store.save(data);
    ctx.advance(CONFIG.BACKUP_THROTTLE_MS);
  }

  h.assertEqual(CONFIG.KEYS.backups.length, 4);
  // 超过 4 份之后不该多出别的 key
  var backups = ctx.storage.keys().filter(function (k) {
    return k.indexOf('_backup') !== -1;
  });
  h.assertEqual(backups.length, 4, '备份槽数量必须正好是 4');
});

t('第一次保存没有上一版可备份，也不算作一次轮转', function () {
  // 这条是限流能生效的前提：空跑一次不启动计时，否则本次会话头一次保存
  // 就会把 30 秒的窗口用掉，接下来 30 秒的改动全捞不到快照。
  var ctx = fresh();
  var data = Store.createEmpty();
  Store.ensureDay(data, '2026-10-01').I.push(task('第一版'));
  Store.save(data);

  h.assertNull(ctx.storage.getItem(CONFIG.KEYS.backups[0]), '没东西可备份');

  // 紧接着再存一次：这次有东西可备份了，而且没经过任何等待，
  // 说明上一次空跑确实没有启动计时。
  ctx.advance(1000);
  data.dates['2026-10-01'].I.push(task('第二版'));
  Store.save(data);
  h.assertTrue(!!ctx.storage.getItem(CONFIG.KEYS.backups[0]),
    '空跑不该启动计时，这次应该正常轮转');
});

t('30 秒内的连续保存不轮转备份', function () {
  var ctx = fresh();
  var data = Store.createEmpty();
  Store.ensureDay(data, '2026-10-01').I.push(task('第一版'));
  Store.save(data); // 第一次：没东西可备份

  ctx.advance(CONFIG.BACKUP_THROTTLE_MS);
  data.dates['2026-10-01'].I.push(task('第二版'));
  Store.save(data); // 这次真正轮转了，备份里是第一版

  var first = ctx.storage.getItem(CONFIG.KEYS.backups[0]);
  h.assertTrue(!!first, '这次应该轮转');

  // 只过 10 秒 —— 用户快速勾选会连续保存，这时候不该再产生备份
  ctx.advance(10 * 1000);
  data.dates['2026-10-01'].I.push(task('第三版'));
  Store.save(data);

  h.assertEqual(ctx.storage.getItem(CONFIG.KEYS.backups[0]), first,
    '限流窗口内备份不该被改写');
});

t('刚好过 30 秒就可以轮转', function () {
  var ctx = fresh();
  var data = Store.createEmpty();
  Store.ensureDay(data, '2026-10-01').I.push(task('第一版'));
  Store.save(data);

  ctx.advance(CONFIG.BACKUP_THROTTLE_MS);
  data.dates['2026-10-01'].I.push(task('第二版'));
  Store.save(data);

  h.assertTrue(!!ctx.storage.getItem(CONFIG.KEYS.backups[0]));
});

// ---------------------------------------------------------------------------
h.group('备份要带上保存时间');

t('备份里记了 savedAt —— 恢复提示要靠它报出「X 月 X 日 X 点」', function () {
  var ctx = fresh(1759300000000);
  var data = Store.createEmpty();
  Store.ensureDay(data, '2026-10-01').I.push(task('第一版'));
  Store.save(data);

  var later = 1759300000000 + 60 * 1000;
  var storage = ctx.storage;
  Store.init({ storage: storage, clock: function () { return later; } });

  data.dates['2026-10-01'].I.push(task('第二版'));
  Store.save(data);

  var envelope = JSON.parse(storage.getItem(CONFIG.KEYS.backups[0]));
  h.assertEqual(envelope.savedAt, later, 'savedAt 应该是轮转发生的那一刻');
});

// ---------------------------------------------------------------------------
h.group('数据清洗：脏数据尽量救，别整份作废');

t('文本为空的条目被丢掉', function () {
  var result = Store.normalize({
    user: 'default',
    dates: {
      '2026-10-01': {
        I: [task('正常'), { id: 'x', text: '   ', completed: false }],
        II: [], III: [], IV: []
      }
    }
  });
  h.assertEqual(result.data.dates['2026-10-01'].I.length, 1);
  h.assertEqual(result.dropped, 1);
});

t('缺 id / 缺 createdAt 的条目会被补上，而不是丢掉', function () {
  var result = Store.normalize({
    user: 'default',
    dates: {
      '2026-10-01': { I: [{ text: '只有文本' }], II: [], III: [], IV: [] }
    }
  });
  var list = result.data.dates['2026-10-01'].I;
  h.assertEqual(list.length, 1, '不该丢');
  h.assertEqual(list[0].text, '只有文本');
  h.assertTrue(!!list[0].id, 'id 应该被补上');
  h.assertEqual(typeof list[0].createdAt, 'number');
  h.assertEqual(list[0].completed, false);
});

t('completed 不是布尔值时按 false 处理', function () {
  var result = Store.normalize({
    user: 'default',
    dates: { '2026-10-01': { I: [{ text: 'a', completed: 'yes' }], II: [], III: [], IV: [] } }
  });
  h.assertEqual(result.data.dates['2026-10-01'].I[0].completed, false);
});

t('日期不合法的整天数据被丢掉', function () {
  var result = Store.normalize({
    user: 'default',
    dates: {
      '2026-13-01': { I: [task('不该存在')], II: [], III: [], IV: [] },
      '2026-10-01': { I: [task('正常')], II: [], III: [], IV: [] }
    }
  });
  h.assertFalse(!!result.data.dates['2026-13-01']);
  h.assertEqual(result.data.dates['2026-10-01'].I.length, 1);
});

t('象限键缺失当空处理，不报错', function () {
  var result = Store.normalize({
    user: 'default',
    dates: { '2026-10-01': { I: [task('只有 I')] } }
  });
  var day = result.data.dates['2026-10-01'];
  h.assertEqual(day.I.length, 1);
  h.assertEqual(day.II.length, 0);
});

t('整天没内容就不占地方', function () {
  var result = Store.normalize({
    user: 'default',
    dates: { '2026-10-01': { I: [], II: [], III: [], IV: [] } }
  });
  h.assertEqual(Object.keys(result.data.dates).length, 0);
});

t('老数据没有 schemaVersion 时按 1 处理', function () {
  var result = Store.normalize({
    user: 'default',
    dates: { '2026-10-01': { I: [task('老格式')], II: [], III: [], IV: [] } }
  });
  h.assertEqual(result.data.schemaVersion, CONFIG.SCHEMA_VERSION);
});

// ---------------------------------------------------------------------------
h.group('顶层结构不对就抛错');

t('不是合法的 JSON', function () {
  h.assertThrows(function () { Store.parse('{不是 json'); }, '不是合法的 JSON');
});

t('不是对象', function () {
  h.assertThrows(function () { Store.parse('"字符串"'); }, '不是一个对象');
  h.assertThrows(function () { Store.parse('[1,2,3]'); }, '不是一个对象');
  h.assertThrows(function () { Store.parse('null'); }, '不是一个对象');
});

t('缺少 dates', function () {
  h.assertThrows(function () { Store.parse('{"user":"default"}'); }, '缺少 dates');
});

t('空文本抛错', function () {
  h.assertThrows(function () { Store.parse(''); }, '数据是空的');
});

// ---------------------------------------------------------------------------
h.group('存储空间满了');

t('写不进去时返回 QUOTA，而且主数据停在改动前那一版', function () {
  var storage = h.createMemoryStorage();
  var current = 1759300000000;
  Store.init({ storage: storage, clock: function () { return current; } });

  var data = Store.createEmpty();
  Store.ensureDay(data, '2026-10-01').I.push(task('第一版'));
  h.assertTrue(Store.save(data).ok);

  // 把配额卡在刚好装不下下一版的位置
  var used = storage.size();
  var tight = h.createMemoryStorage({ quotaBytes: used + 10 });

  // 换一个配额很紧的存储，把现有内容搬过去
  tight.setItem(CONFIG.KEYS.userData, storage.getItem(CONFIG.KEYS.userData));
  Store.init({ storage: tight, clock: function () { return current; } });

  var bigger = Store.createEmpty();
  for (var i = 0; i < 50; i++) {
    Store.ensureDay(bigger, '2026-10-01').I.push(task('很长的任务文本用来撑爆配额 ' + i));
  }
  var result = Store.save(bigger);

  h.assertFalse(result.ok);
  h.assertEqual(result.error, 'QUOTA');

  // 主数据还是原来那一版，没有半新半旧
  var still = Store.load();
  h.assertEqual(still.status, 'ok');
  h.assertEqual(still.data.dates['2026-10-01'].I.length, 1);
});

// ---------------------------------------------------------------------------
h.group('加了阶段之后，老数据还能不能读（DS 3.4 的硬要求）');

/** 一份「加阶段之前」存下来的数据 —— 任务里根本没有 stages 这个字段 */
function preStagesBackup() {
  return JSON.stringify({
    user: 'default',
    schemaVersion: 1,
    dates: {
      '2026-10-01': {
        I: [
          { id: 'id_a', text: '写季度报告', completed: false, createdAt: 1000 },
          { id: 'id_b', text: '已经做完的', completed: true, createdAt: 2000 }
        ],
        II: [{ id: 'id_c', text: '准备分享', completed: false, createdAt: 3000 }],
        III: [], IV: []
      },
      '2026-10-02': {
        I: [{ id: 'id_d', text: '第二天', completed: false, createdAt: 4000 }],
        II: [], III: [], IV: []
      }
    }
  });
}

t('老数据一条不丢地读进来', function () {
  var ctx = fresh();
  ctx.storage.setItem(CONFIG.KEYS.userData, preStagesBackup());

  var loaded = Store.load();
  h.assertEqual(loaded.status, 'ok');
  h.assertEqual(loaded.dropped, 0, '不该有东西被当成脏数据丢掉');

  h.assertEqual(loaded.data.dates['2026-10-01'].I.length, 2);
  h.assertEqual(loaded.data.dates['2026-10-01'].II.length, 1);
  h.assertEqual(loaded.data.dates['2026-10-02'].I.length, 1);
});

t('老数据里的文本和勾选状态原样保留', function () {
  var ctx = fresh();
  ctx.storage.setItem(CONFIG.KEYS.userData, preStagesBackup());

  var day = Store.getDayTasks(Store.load().data, '2026-10-01');
  h.assertEqual(day.I[0].text, '写季度报告');
  h.assertEqual(day.I[0].completed, false);
  h.assertEqual(day.I[1].text, '已经做完的');
  h.assertEqual(day.I[1].completed, true, '原来勾上的还得是勾上的');
});

t('老数据读进来之后不该凭空长出 stages 字段', function () {
  var ctx = fresh();
  ctx.storage.setItem(CONFIG.KEYS.userData, preStagesBackup());

  var task = Store.load().data.dates['2026-10-01'].I[0];
  h.assertFalse(Array.isArray(task.stages), '没有阶段就不该有这个字段，别留一个空数组占地方');
});

t('老数据读进来 → 导出 → 再导入，还是那一份', function () {
  // 这就是 DS 3.4 说的「改格式前存下的数据 → 新代码 → 导出 → 导入」完整往返
  var Importer = require('../js/importer');

  var ctx = fresh();
  ctx.storage.setItem(CONFIG.KEYS.userData, preStagesBackup());
  var loaded = Store.load();

  // 导出（就是序列化一遍），再原样导进一份空数据
  var exported = Store.serialize(loaded.data);
  var target = Store.createEmpty();
  var result = Importer.importText(target, exported);

  h.assertTrue(result.ok, '老备份导不回来的话，用户手里那些备份就全废了');
  h.assertEqual(result.added, 4, '四条任务全都要进来');
  h.assertEqual(result.skipped, 0);
  h.assertEqual(Store.getDayTasks(target, '2026-10-01').I[1].completed, true);
});

t('新格式（带阶段）读写正常', function () {
  var ctx = fresh();
  var data = Store.createEmpty();
  data.dates['2026-10-01'] = {
    I: [{
      id: 'id_x', text: '写报告', completed: false, createdAt: 1,
      stages: [
        { id: 's1', text: '收集数据', completed: true, createdAt: 2 },
        { id: 's2', text: '写初稿', completed: false, createdAt: 3 }
      ]
    }],
    II: [], III: [], IV: []
  };
  Store.save(data);

  var back = Store.load().data.dates['2026-10-01'].I[0];
  h.assertEqual(back.stages.length, 2);
  h.assertEqual(back.stages[0].text, '收集数据');
  h.assertEqual(back.stages[0].completed, true);
});

t('数据里的 completed 和阶段对不上时，以阶段为准', function () {
  // completed 是个派生字段。手工改过的文件、或者别的版本写的，
  // 都可能和阶段对不上 —— 这种情况下相信阶段
  var ctx = fresh();
  ctx.storage.setItem(CONFIG.KEYS.userData, JSON.stringify({
    user: 'default', schemaVersion: 1,
    dates: {
      '2026-10-01': {
        I: [{
          id: 'id_x', text: '任务', completed: true, createdAt: 1,
          stages: [
            { id: 's1', text: '一', completed: true, createdAt: 2 },
            { id: 's2', text: '二', completed: false, createdAt: 3 }
          ]
        }],
        II: [], III: [], IV: []
      }
    }
  }));

  var task = Store.load().data.dates['2026-10-01'].I[0];
  h.assertEqual(task.completed, false,
    '文件里写着 completed:true，但阶段还有没勾完的 —— 该信阶段');
});

t('阶段里的一条坏数据被丢掉，任务本身还在', function () {
  var ctx = fresh();
  ctx.storage.setItem(CONFIG.KEYS.userData, JSON.stringify({
    user: 'default', schemaVersion: 1,
    dates: {
      '2026-10-01': {
        I: [{
          id: 'id_x', text: '任务', completed: false, createdAt: 1,
          stages: [
            { id: 's1', text: '好的', completed: false, createdAt: 2 },
            { id: 's2', text: '   ', completed: false, createdAt: 3 }
          ]
        }],
        II: [], III: [], IV: []
      }
    }
  }));

  var loaded = Store.load();
  h.assertEqual(loaded.dropped, 1, '坏的那条阶段要计数');
  h.assertEqual(loaded.data.dates['2026-10-01'].I[0].stages.length, 1,
    '好的阶段留着，任务本身也留着');
  h.assertEqual(loaded.data.dates['2026-10-01'].I[0].stages[0].text, '好的');
});

// ---------------------------------------------------------------------------

h.summary('store.js 存取与备份');
