/**
 * test-import-validate.js
 *
 * 检查各种格式不对的文件是不是都被拒绝、**且原数据一点没动**（见 DS 3.2）。
 *
 * 导入面对的是来路不明的文件，走的是「一个地方不对就整份拒绝」；
 * 这和 store.js 读自己数据时的「尽量救」是两条完全不同的路线，
 * 故意如此（理由写在 importer.js 开头）。
 *
 * 跑法：node test/test-import-validate.js
 */
'use strict';

var h = require('./harness');
var Store = require('../js/store');
var TaskOps = require('../js/task-ops');
var Importer = require('../js/importer');

var t = h.test;
var ERR = Importer.ERR;

/** 一份格式完全正确的文件 */
function goodFile() {
  return JSON.stringify({
    user: 'default',
    schemaVersion: 1,
    dates: {
      '2026-10-01': {
        I: [{ id: 'a', text: '写报告', completed: false, createdAt: 1 }],
        II: [], III: [], IV: []
      }
    }
  });
}

/** 造一份本地数据，用来检查「失败时原数据有没有被动过」 */
function localData() {
  var data = Store.createEmpty();
  TaskOps.addTask(data, '2026-10-01', 'I', '本地原有的任务');
  return data;
}

/** 断言：这份文本被拒绝，且错误码是期待的，且本地数据没变 */
function expectReject(text, expectedError, label) {
  var data = localData();
  var before = JSON.stringify(data);

  var result = Importer.importText(data, text);

  h.assertFalse(result.ok, label + '：本该被拒绝，却通过了');
  h.assertEqual(result.error, expectedError, label + '：错误码不对');
  h.assertTrue(!!result.message, label + '：要给出能看懂的说明');
  h.assertEqual(JSON.stringify(data), before, label + '：被拒绝时本地数据一个字节都不能动');
}

// ---------------------------------------------------------------------------
h.group('格式正确的一定要能通过');

t('一份正常的文件', function () {
  var result = Importer.validate(goodFile());
  h.assertTrue(result.ok, '本该通过：' + (result.message || ''));
  h.assertEqual(result.data.dates['2026-10-01'].I.length, 1);
});

t('空数据的文件（dates 是空对象）也算合法', function () {
  var result = Importer.validate('{"user":"default","dates":{}}');
  h.assertTrue(result.ok);
  h.assertEqual(Object.keys(result.data.dates).length, 0);
});

t('四个象限都是空的也算合法', function () {
  var text = JSON.stringify({
    dates: { '2026-10-01': { I: [], II: [], III: [], IV: [] } }
  });
  h.assertTrue(Importer.validate(text).ok);
});

t('没有 user / schemaVersion 的老文件能通过', function () {
  var text = JSON.stringify({
    dates: { '2026-10-01': { I: [{ text: '老格式' }], II: [], III: [], IV: [] } }
  });
  var result = Importer.validate(text);
  h.assertTrue(result.ok, '老文件不该被拒之门外');
  h.assertEqual(result.data.user, 'default');
  h.assertEqual(result.data.schemaVersion, 1, '缺版本号就按当前版本处理');
});

t('任务缺 id / createdAt 也能通过（我们会自己补）', function () {
  var text = JSON.stringify({
    dates: { '2026-10-01': { I: [{ text: '只有文本' }], II: [], III: [], IV: [] } }
  });
  h.assertTrue(Importer.validate(text).ok);
});

// ---------------------------------------------------------------------------
h.group('不是合法 JSON');

t('乱码', function () {
  expectReject('这不是 json', ERR.NOT_JSON, '乱码');
});

t('半截的 JSON', function () {
  expectReject('{"dates": {', ERR.NOT_JSON, '半截');
});

t('空字符串', function () {
  expectReject('', ERR.NOT_JSON, '空字符串');
});

t('传 null / undefined', function () {
  expectReject(null, ERR.NOT_JSON, 'null');
  expectReject(undefined, ERR.NOT_JSON, 'undefined');
});

// ---------------------------------------------------------------------------
h.group('顶层结构不对');

t('数组 —— 是合法 JSON，但不是我们要的数据对象', function () {
  expectReject('[1,2,3]', ERR.NOT_OBJECT, '数组');
});

t('字符串', function () {
  expectReject('"我是字符串"', ERR.NOT_OBJECT, '字符串');
});

t('数字', function () {
  expectReject('42', ERR.NOT_OBJECT, '数字');
});

t('JSON 里写 null', function () {
  expectReject('null', ERR.NOT_OBJECT, 'null');
});

t('缺少 dates', function () {
  expectReject('{"user":"default"}', ERR.NO_DATES, '缺 dates');
});

t('dates 不是对象', function () {
  expectReject('{"dates":[]}', ERR.NO_DATES, 'dates 是数组');
  expectReject('{"dates":"x"}', ERR.NO_DATES, 'dates 是字符串');
});

// ---------------------------------------------------------------------------
h.group('日期不对');

t('13 月', function () {
  expectReject(
    JSON.stringify({ dates: { '2026-13-01': { I: [], II: [], III: [], IV: [] } } }),
    ERR.BAD_DATE, '13 月');
});

t('2 月 30 日', function () {
  expectReject(
    JSON.stringify({ dates: { '2026-02-30': { I: [], II: [], III: [], IV: [] } } }),
    ERR.BAD_DATE, '2 月 30 日');
});

t('没补零的日期', function () {
  expectReject(
    JSON.stringify({ dates: { '2026-1-1': { I: [], II: [], III: [], IV: [] } } }),
    ERR.BAD_DATE, '没补零');
});

t('报错里要指出是哪个日期出的问题', function () {
  var result = Importer.validate(JSON.stringify({
    dates: { '2026-13-01': { I: [], II: [], III: [], IV: [] } }
  }));
  h.assertTrue(result.message.indexOf('2026-13-01') !== -1,
    '得告诉用户是哪一天不对，否则他不知道从哪儿改起');
});

t('日期下面不是一个对象', function () {
  expectReject('{"dates":{"2026-10-01":"x"}}', ERR.BAD_DAY, '时间下面是个字符串');
  expectReject('{"dates":{"2026-10-01":[]}}', ERR.BAD_DAY, '时间下面是个数组');
});

// ---------------------------------------------------------------------------
h.group('象限不对');

t('缺象限键', function () {
  expectReject(JSON.stringify({
    dates: { '2026-10-01': { I: [], II: [] } }
  }), ERR.MISSING_QUADRANT, '只有两个象限');
});

t('象限不是一个数组', function () {
  expectReject(JSON.stringify({
    dates: { '2026-10-01': { I: '不是数组', II: [], III: [], IV: [] } }
  }), ERR.BAD_QUADRANT, '象限是字符串');
});

t('报错里要指出是哪一天、哪个象限', function () {
  var result = Importer.validate(JSON.stringify({
    dates: { '2026-10-01': { I: [], III: [], IV: [] } }
  }));
  h.assertTrue(result.message.indexOf('2026-10-01') !== -1);
  h.assertTrue(result.message.indexOf('II') !== -1);
});

// ---------------------------------------------------------------------------
h.group('任务条目不对');

t('任务不是对象', function () {
  expectReject(JSON.stringify({
    dates: { '2026-10-01': { I: ['字符串'], II: [], III: [], IV: [] } }
  }), ERR.BAD_TASK, '任务是字符串');
});

t('任务没有 text 字段', function () {
  expectReject(JSON.stringify({
    dates: { '2026-10-01': { I: [{ id: 'x', completed: false }], II: [], III: [], IV: [] } }
  }), ERR.BAD_TASK, '没有 text');
});

t('任务文本是空的', function () {
  expectReject(JSON.stringify({
    dates: { '2026-10-01': { I: [{ text: '   ' }], II: [], III: [], IV: [] } }
  }), ERR.BAD_TASK, '文本只有空格');
});

t('报错里要指出是第几条', function () {
  var result = Importer.validate(JSON.stringify({
    dates: { '2026-10-01': { I: [{ text: '好的' }, { text: '' }], II: [], III: [], IV: [] } }
  }));
  h.assertTrue(result.message.indexOf('第 2 条') !== -1, '要说清是第几条出的问题');
});

// ---------------------------------------------------------------------------
h.group('阶段：没有是合法的，有但不合法才拒绝');

t('任务里没有 stages 字段 —— 合法（加阶段之前导出的文件就是这样）', function () {
  h.assertTrue(Importer.validate(goodFile()).ok,
    '老备份必须能导进来，不然用户手里的备份全废了');
});

t('stages 是空数组 —— 合法，等同于没有阶段', function () {
  var text = JSON.stringify({
    dates: {
      '2026-10-01': {
        I: [{ text: '任务', stages: [] }], II: [], III: [], IV: []
      }
    }
  });
  h.assertTrue(Importer.validate(text).ok);
});

t('带阶段的文件能通过', function () {
  var text = JSON.stringify({
    dates: {
      '2026-10-01': {
        I: [{
          text: '写季度报告',
          stages: [
            { text: '收集数据', completed: true },
            { text: '写初稿', completed: false }
          ]
        }],
        II: [], III: [], IV: []
      }
    }
  });

  var result = Importer.validate(text);
  h.assertTrue(result.ok, '本该通过：' + (result.message || ''));
  h.assertEqual(result.data.dates['2026-10-01'].I[0].stages.length, 2);
});

t('stages 不是一个数组 → 拒绝', function () {
  expectReject(JSON.stringify({
    dates: { '2026-10-01': { I: [{ text: '任务', stages: '不是数组' }], II: [], III: [], IV: [] } }
  }), ERR.BAD_STAGE, 'stages 是字符串');
});

t('阶段没有 text 字段 → 拒绝', function () {
  expectReject(JSON.stringify({
    dates: {
      '2026-10-01': {
        I: [{ text: '任务', stages: [{ completed: true }] }], II: [], III: [], IV: []
      }
    }
  }), ERR.BAD_STAGE, '阶段没有 text');
});

t('阶段文本是空的 → 拒绝', function () {
  expectReject(JSON.stringify({
    dates: {
      '2026-10-01': {
        I: [{ text: '任务', stages: [{ text: '   ' }] }], II: [], III: [], IV: []
      }
    }
  }), ERR.BAD_STAGE, '阶段文本只有空格');
});

t('阶段不是对象 → 拒绝', function () {
  expectReject(JSON.stringify({
    dates: {
      '2026-10-01': {
        I: [{ text: '任务', stages: ['字符串'] }], II: [], III: [], IV: []
      }
    }
  }), ERR.BAD_STAGE, '阶段是字符串');
});

t('报错里要指出是哪条任务的第几个阶段', function () {
  var result = Importer.validate(JSON.stringify({
    dates: {
      '2026-10-01': {
        I: [{ text: '任务', stages: [{ text: '好的' }, { text: '' }] }],
        II: [], III: [], IV: []
      }
    }
  }));
  h.assertTrue(result.message.indexOf('第 1 条任务') !== -1, '要说清是哪条任务');
  h.assertTrue(result.message.indexOf('第 2 个阶段') !== -1, '还要说清是第几个阶段');
});

// ---------------------------------------------------------------------------
h.group('一处不对，整份都不能生效');

t('文件里前半天是好的、后半天是坏的 —— 好的那半天也不能被写进去', function () {
  // 这是「先全部检查完再写」这条规矩的意义所在。
  // 边查边写的话，用户会得到一份「半新半旧」的数据，而他看到的只是一句报错，
  // 根本不知道本地已经被塞进去一半了。
  var text = JSON.stringify({
    dates: {
      '2026-10-01': { I: [{ text: '这一条是好的' }], II: [], III: [], IV: [] },
      '2026-13-01': { I: [], II: [], III: [], IV: [] }
    }
  });
  expectReject(text, ERR.BAD_DATE, '前好后坏');
});

t('前面几条任务都是好的、最后一条坏了 —— 前面几条也不能进去', function () {
  var text = JSON.stringify({
    dates: {
      '2026-10-01': {
        I: [{ text: '第一条' }, { text: '第二条' }],
        II: [], III: [], IV: []
      },
      '2026-10-02': {
        I: [], II: [], III: [], IV: []
      },
      '2026-10-03': {
        I: [{ text: '' }], II: [], III: [], IV: []
      }
    }
  });
  expectReject(text, ERR.BAD_TASK, '最后一条坏了');
});

// ---------------------------------------------------------------------------
h.group('validate 本身不改任何东西');

t('validate 是纯检查，不碰传入的数据', function () {
  var data = localData();
  var before = JSON.stringify(data);

  Importer.validate(goodFile());

  h.assertEqual(JSON.stringify(data), before);
});

// ---------------------------------------------------------------------------
h.group('任务块（v1.1，见 DS 2.10）');

/** 造一份只有一个块的文件文本 */
function blockFile(blockItem) {
  return JSON.stringify({
    dates: { '2026-10-01': { I: [blockItem], II: [], III: [], IV: [] } }
  });
}

t('合法的块能通过，结构原样保留', function () {
  var result = Importer.validate(blockFile({
    id: 'b1', type: 'block', text: '晨间例程', completed: true, createdAt: 1,
    tasks: [
      { id: 'c1', text: '喝水', completed: true, createdAt: 1 },
      { id: 'c2', text: '锻炼', completed: false, createdAt: 1,
        stages: [{ id: 's1', text: '热身', completed: false, createdAt: 1 }] }
    ]
  }));

  h.assertTrue(result.ok, '本该通过：' + (result.message || ''));
  var block = result.data.dates['2026-10-01'].I[0];
  h.assertEqual(block.type, 'block');
  h.assertEqual(block.text, '晨间例程');
  h.assertEqual(block.tasks.length, 2);
  h.assertEqual(block.tasks[0].text, '喝水');
  h.assertEqual(block.tasks[1].stages.length, 1, '块内任务的阶段也跟着进来');
});

t('块里套块 → 整份拒绝（规矩 1：页面造不出的数据不收）', function () {
  expectReject(blockFile({
    id: 'b1', type: 'block', text: '外层', completed: false, createdAt: 1,
    tasks: [{ id: 'b2', type: 'block', text: '里层', completed: false, createdAt: 1, tasks: [] }]
  }), ERR.BAD_BLOCK, '嵌套块');
});

t('块的 tasks 缺失或不是列表 → 拒绝', function () {
  expectReject(blockFile({ id: 'b1', type: 'block', text: '块', completed: false, createdAt: 1 }),
    ERR.BAD_BLOCK, '缺 tasks 字段');
  expectReject(blockFile({ id: 'b1', type: 'block', text: '块', completed: false, createdAt: 1, tasks: '不是列表' }),
    ERR.BAD_BLOCK, 'tasks 不是列表');
});

t('块名是空的 → 拒绝', function () {
  expectReject(blockFile({ id: 'b1', type: 'block', text: '   ', completed: false, createdAt: 1, tasks: [] }),
    ERR.BAD_BLOCK, '空块名');
});

t('块内任务坏了 → 拒绝，且报错说清是哪个块里的', function () {
  var result = Importer.validate(blockFile({
    id: 'b1', type: 'block', text: '晨间例程', completed: false, createdAt: 1,
    tasks: [
      { id: 'c1', text: '好的', completed: false, createdAt: 1 },
      { id: 'c2', text: '', completed: false, createdAt: 1 }
    ]
  }));

  h.assertFalse(result.ok);
  h.assertEqual(result.error, ERR.BAD_TASK);
  h.assertTrue(result.message.indexOf('晨间例程') !== -1, '要指认到块');
});

t('块内任务的阶段坏了 → 拒绝，错误码是 BAD_STAGE', function () {
  var result = Importer.validate(blockFile({
    id: 'b1', type: 'block', text: '晨间例程', completed: false, createdAt: 1,
    tasks: [{ id: 'c1', text: '锻炼', completed: false, createdAt: 1, stages: [{ text: '' }] }]
  }));

  h.assertFalse(result.ok);
  h.assertEqual(result.error, ERR.BAD_STAGE);
});

// ---------------------------------------------------------------------------

h.summary('importer.js 格式检查');
