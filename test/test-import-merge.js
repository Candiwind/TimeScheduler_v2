/**
 * test-import-merge.js
 *
 * 检查导入的合并与去重规则（见 DS 3.2、D-09、D-16）。
 *
 * **本文件最重要的一组是「判重的范围」**：判重必须只在同一天内进行。
 * 一旦写成拿整个 dates 去比，「写日报」这种每天都要做的任务会被吃掉 29 天，
 * 而用户只看到一句「跳过 N 条」，事后根本查不出少了什么。
 *
 * 跑法：node test/test-import-merge.js
 */
'use strict';

var h = require('./harness');
var Store = require('../js/store');
var TaskOps = require('../js/task-ops');
var Importer = require('../js/importer');

var t = h.test;

/** 造一份本地数据 */
function local(spec) {
  var data = Store.createEmpty();
  var quadrants = Object.keys(spec || {});
  for (var i = 0; i < quadrants.length; i++) {
    var parts = quadrants[i].split('|');   // 写成 '2026-10-01|I'
    var texts = spec[quadrants[i]];
    // addTask 默认把新任务加在开头（需求 3），倒着加才能让最终顺序和 spec 一致
    for (var k = texts.length - 1; k >= 0; k--) {
      TaskOps.addTask(data, parts[0], parts[1], texts[k]);
    }
  }
  return data;
}

/** 造一份要导入的文件文本 */
function file(spec) {
  var dates = {};
  var keys = Object.keys(spec);
  for (var i = 0; i < keys.length; i++) {
    var parts = keys[i].split('|');       // '2026-10-01|I'
    var dateStr = parts[0];
    var quadrantId = parts[1];

    if (!dates[dateStr]) {
      dates[dateStr] = { I: [], II: [], III: [], IV: [] };
    }
    var texts = spec[keys[i]];
    for (var k = 0; k < texts.length; k++) {
      var item = texts[k];
      var isObj = item !== null && typeof item === 'object';
      dates[dateStr][quadrantId].push({
        id: 'from_file_' + i + '_' + k,
        text: isObj ? item.text : item,
        completed: isObj ? !!item.completed : false,
        createdAt: 1000
      });
    }
  }
  return JSON.stringify({ user: 'default', schemaVersion: 1, dates: dates });
}

/** 取某天某象限的文本，拼成 '甲,乙' */
function texts(data, dateStr, quadrantId) {
  var list = Store.getDayTasks(data, dateStr)[quadrantId];
  var out = [];
  for (var i = 0; i < list.length; i++) out.push(list[i].text);
  return out.join(',');
}

// ---------------------------------------------------------------------------
h.group('正常合并');

t('把新任务加进来', function () {
  var data = local();
  var result = Importer.importText(data, file({ '2026-10-01|I': ['写报告'] }));

  h.assertTrue(result.ok);
  h.assertEqual(result.added, 1);
  h.assertEqual(result.skipped, 0);
  h.assertEqual(texts(data, '2026-10-01', 'I'), '写报告');
});

t('本地没有的日期会被建出来', function () {
  var data = local({ '2026-10-01|I': ['本地任务'] });
  Importer.importText(data, file({ '2026-11-11|II': ['新日期的任务'] }));

  h.assertEqual(texts(data, '2026-11-11', 'II'), '新日期的任务');
  h.assertEqual(texts(data, '2026-10-01', 'I'), '本地任务', '本地原有的一点没变');
});

t('导入是合并 —— 本地独有的任务一条都不能少', function () {
  var data = local({ '2026-10-01|I': ['只有本地有'] });
  Importer.importText(data, file({ '2026-10-01|I': ['只有文件有'] }));

  h.assertEqual(texts(data, '2026-10-01', 'I'), '只有本地有,只有文件有');
});

t('新加的任务排在已有任务后面', function () {
  var data = local({ '2026-10-01|I': ['甲', '乙'] });
  Importer.importText(data, file({ '2026-10-01|I': ['丙'] }));

  h.assertEqual(texts(data, '2026-10-01', 'I'), '甲,乙,丙');
});

t('空文件导进来什么也不发生', function () {
  var data = local({ '2026-10-01|I': ['甲'] });
  var result = Importer.importText(data, '{"dates":{}}');

  h.assertTrue(result.ok);
  h.assertEqual(result.added, 0);
  h.assertEqual(result.skipped, 0);
  h.assertEqual(texts(data, '2026-10-01', 'I'), '甲');
});

// ---------------------------------------------------------------------------
h.group('判重的范围：只看同一天（本文件最重要的一组）');

t('同一天、同象限、同文本 → 跳过', function () {
  var data = local({ '2026-10-01|I': ['写报告'] });
  var result = Importer.importText(data, file({ '2026-10-01|I': ['写报告'] }));

  h.assertEqual(result.added, 0);
  h.assertEqual(result.skipped, 1);
  h.assertEqual(texts(data, '2026-10-01', 'I'), '写报告', '不该重复插入');
});

t('**不同日期的同名任务，两条都要留下**', function () {
  // 「写日报」这种每天都要做的任务，是最典型的用法。
  // 判重如果跨日期生效，10-02 那条会被静默吃掉 —— 而用户只看到「跳过 1 条」。
  var data = local();
  var result = Importer.importText(data, file({
    '2026-10-01|I': ['写日报'],
    '2026-10-02|I': ['写日报'],
    '2026-10-03|I': ['写日报']
  }));

  h.assertEqual(result.added, 3, '三天三条，一条都不能少');
  h.assertEqual(result.skipped, 0, '跨日期不算重复，不该有跳过的');
  h.assertEqual(texts(data, '2026-10-01', 'I'), '写日报');
  h.assertEqual(texts(data, '2026-10-02', 'I'), '写日报');
  h.assertEqual(texts(data, '2026-10-03', 'I'), '写日报');
});

t('本地已有很多天的同名任务时，导入新的一天照样能进来', function () {
  // 这条把「跨日期要比」这个错误实现钉死：本地已经有 3 天「写日报」，
  // 再导入第 4 天，如果判重是全局的，第 4 天就会被跳过
  var data = local({
    '2026-10-01|I': ['写日报'],
    '2026-10-02|I': ['写日报'],
    '2026-10-03|I': ['写日报']
  });
  var result = Importer.importText(data, file({ '2026-10-04|I': ['写日报'] }));

  h.assertEqual(result.added, 1);
  h.assertEqual(result.skipped, 0);
  h.assertEqual(texts(data, '2026-10-04', 'I'), '写日报');
});

t('同一天、不同象限、同文本 → 两条都保留', function () {
  var data = local({ '2026-10-01|I': ['开会'] });
  var result = Importer.importText(data, file({ '2026-10-01|III': ['开会'] }));

  h.assertEqual(result.added, 1);
  h.assertEqual(result.skipped, 0);
  h.assertEqual(texts(data, '2026-10-01', 'I'), '开会');
  h.assertEqual(texts(data, '2026-10-01', 'III'), '开会');
});

t('比较文本时忽略首尾空白', function () {
  var data = local({ '2026-10-01|I': ['写报告'] });
  var result = Importer.importText(data, file({ '2026-10-01|I': ['  写报告  '] }));

  h.assertEqual(result.skipped, 1, '前后多了空格还是同一条');
  h.assertEqual(result.added, 0);
});

t('同一份文件里自带的重复条目也会被去掉', function () {
  var data = local();
  var result = Importer.importText(data, file({
    '2026-10-01|I': ['重复的', '重复的', '不重复的']
  }));

  h.assertEqual(result.added, 2);
  h.assertEqual(result.skipped, 1);
  h.assertEqual(texts(data, '2026-10-01', 'I'), '重复的,不重复的');
});

// ---------------------------------------------------------------------------
h.group('勾选状态：跳过的不覆盖，新增的照抄');

t('跳过时保留本地已有的勾选状态，不被文件覆盖', function () {
  var data = local({ '2026-10-01|I': ['写报告'] });
  var id = Store.getDayTasks(data, '2026-10-01').I[0].id;
  TaskOps.toggleTask(data, '2026-10-01', 'I', id, true);   // 本地：已完成

  // 文件里这条是「未完成」
  Importer.importText(data, file({ '2026-10-01|I': [{ text: '写报告', completed: false }] }));

  h.assertEqual(Store.getDayTasks(data, '2026-10-01').I[0].completed, true,
    '本地勾上的，不能被文件的未完成状态抹掉（见 D-16）');
});

t('新增的条目用文件里的勾选状态', function () {
  var data = local();
  Importer.importText(data, file({
    '2026-10-01|I': [{ text: '文件里已完成的', completed: true }]
  }));

  h.assertEqual(Store.getDayTasks(data, '2026-10-01').I[0].completed, true);
});

t('新增的条目拿到新的本地编号，不用文件里的', function () {
  var data = local();
  Importer.importText(data, file({ '2026-10-01|I': ['新任务'] }));

  var task = Store.getDayTasks(data, '2026-10-01').I[0];
  h.assertFalse(task.id === 'from_file_0_0', '不该照抄文件里的编号，两台设备可能撞号');
  h.assertTrue(!!task.id);
});

// ---------------------------------------------------------------------------
h.group('重复导入同一份文件');

t('同一份文件导入两次，第二次全部跳过', function () {
  var text = file({ '2026-10-01|I': ['甲', '乙'], '2026-10-02|II': ['丙'] });
  var data = local();

  var first = Importer.importText(data, text);
  h.assertEqual(first.added, 3);
  h.assertEqual(first.skipped, 0);

  var second = Importer.importText(data, text);
  h.assertEqual(second.added, 0, '第二次不该再加一遍');
  h.assertEqual(second.skipped, 3);

  h.assertEqual(texts(data, '2026-10-01', 'I'), '甲,乙');
  h.assertEqual(texts(data, '2026-10-02', 'II'), '丙');
});

t('导两次和导一次结果完全一样', function () {
  var text = file({ '2026-10-01|I': ['甲', '乙'] });
  var one = local();
  var two = local();

  Importer.importText(one, text);
  Importer.importText(two, text);
  Importer.importText(two, text);

  h.assertEqual(Store.serialize(two).replace(/"id":"[^"]+"/g, '"id":"X"'),
                Store.serialize(one).replace(/"id":"[^"]+"/g, '"id":"X"'),
                '除了随机编号，两份数据必须一模一样');
});

// ---------------------------------------------------------------------------
h.group('阶段：跟着任务一起进来，但不参与判重');

/** 造一份带阶段的导入文件 */
function stagedFile() {
  return JSON.stringify({
    user: 'default', schemaVersion: 1,
    dates: {
      '2026-10-01': {
        I: [{
          id: 'from_file_1',
          text: '写季度报告',
          completed: false,
          createdAt: 1000,
          stages: [
            { id: 'fs1', text: '收集数据', completed: true, createdAt: 1 },
            { id: 'fs2', text: '写初稿', completed: false, createdAt: 2 }
          ]
        }],
        II: [], III: [], IV: []
      }
    }
  });
}

t('导入带阶段的任务，阶段一起进来', function () {
  var data = local();
  var result = Importer.importText(data, stagedFile());

  h.assertEqual(result.added, 1);
  var task = Store.getDayTasks(data, '2026-10-01').I[0];
  h.assertEqual(task.stages.length, 2);
  h.assertEqual(task.stages[0].text, '收集数据');
  h.assertEqual(task.stages[0].completed, true);
  h.assertEqual(task.stages[1].text, '写初稿');
  h.assertEqual(task.stages[1].completed, false);
});

t('导进来的阶段换新编号，不用文件里的', function () {
  var data = local();
  Importer.importText(data, stagedFile());

  var task = Store.getDayTasks(data, '2026-10-01').I[0];
  h.assertFalse(task.stages[0].id === 'fs1', '照抄文件里的编号，跨设备可能撞车');
  h.assertTrue(!!task.stages[0].id);
});

t('判重**不看阶段** —— 文本相同就是同一条，阶段也不会覆盖本地的', function () {
  // 本地已经有一条同名的、带自己阶段的「写季度报告」
  var data = local();
  var taskId = TaskOps.addTask(data, '2026-10-01', 'I', '写季度报告').task.id;
  TaskOps.addStage(data, '2026-10-01', 'I', taskId, '本地自己的第一步');

  var result = Importer.importText(data, stagedFile());

  h.assertEqual(result.skipped, 1, '同一天同象限同文本 —— 算重复');
  h.assertEqual(result.added, 0);

  var task = Store.getDayTasks(data, '2026-10-01').I[0];
  h.assertEqual(task.stages.length, 1, '本地的阶段不该被文件里的盖掉');
  h.assertEqual(task.stages[0].text, '本地自己的第一步');
});

t('老文件（任务里没有 stages 字段）照样能导进来', function () {
  var data = local({ '2026-10-01|I': ['本地原有的'] });
  var result = Importer.importText(data, file({ '2026-10-01|I': ['加阶段之前导出的'] }));

  h.assertTrue(result.ok, '用户手里的老备份不能因为这次改格式就废掉');
  h.assertEqual(result.added, 1);
  h.assertEqual(texts(data, '2026-10-01', 'I'), '本地原有的,加阶段之前导出的');
});

t('导入之后 completed 以阶段为准', function () {
  // 文件里写着 completed:true，但阶段还有没勾完的
  var data = local();
  Importer.importText(data, JSON.stringify({
    dates: {
      '2026-10-01': {
        I: [{
          text: '任务', completed: true, createdAt: 1,
          stages: [
            { text: '一', completed: true },
            { text: '二', completed: false }
          ]
        }],
        II: [], III: [], IV: []
      }
    }
  }));

  var task = Store.getDayTasks(data, '2026-10-01').I[0];
  h.assertEqual(task.completed, false, '阶段没全勾完，任务就不该是完成');
});

// ---------------------------------------------------------------------------
h.group('新加的日期不会被凭空留下');

t('文件里有一整天是空的，本地不该凭空多出这一天', function () {
  var data = local();
  Importer.importText(data, file({ '2026-10-01|I': ['甲'] }));

  // file() 只会造出有内容的日期，这里手工造一个空的
  var withEmptyDay = JSON.stringify({
    dates: {
      '2026-10-01': { I: [{ text: '甲' }], II: [], III: [], IV: [] },
      '2026-11-11': { I: [], II: [], III: [], IV: [] }
    }
  });
  Importer.importText(data, withEmptyDay);

  h.assertFalse(!!data.dates['2026-11-11'], '一整天都是空的，不该在本地留个条目占地方');
});

// ---------------------------------------------------------------------------
h.group('任务块的合并（v1.1，见 DS 2.10）');

/** 一份含一个块的文件：块 id 是文件里的旧 id，块内有一条没完成 */
var BLOCK_FILE = JSON.stringify({
  dates: {
    '2026-10-01': {
      I: [{
        id: 'file_block_1', type: 'block', text: '晨间例程', completed: true, createdAt: 1,
        tasks: [
          { id: 'file_c1', text: '喝水', completed: true, createdAt: 1 },
          { id: 'file_c2', text: '锻炼', completed: false, createdAt: 1 }
        ]
      }],
      II: [], III: [], IV: []
    }
  }
});

t('块整体合并进来：块和块内任务都换新 id，完成状态以块内为准', function () {
  var data = local({ '2026-10-01|I': ['本地任务'] });
  var result = Importer.importText(data, BLOCK_FILE);

  h.assertTrue(result.ok);
  h.assertEqual(result.added, 1, '块按一条计');

  var list = data.dates['2026-10-01'].I;
  h.assertEqual(list.length, 2);
  var block = list[1];
  h.assertEqual(block.type, 'block');
  h.assertFalse(block.id === 'file_block_1', '块要换新 id');
  h.assertEqual(block.completed, false, '文件里写完成，但块内有一条没完成 —— 以块内为准');
  h.assertFalse(block.tasks[0].id === 'file_c1', '块内任务也要换新 id');
  h.assertEqual(block.tasks[0].text, '喝水');
  h.assertEqual(block.tasks[0].completed, true);
});

t('同名块跳过：块按名字判重，块内不拆开比', function () {
  var data = Store.createEmpty();
  var mine = TaskOps.addBlock(data, '2026-10-01', 'I', '晨间例程').block;

  var result = Importer.importText(data, BLOCK_FILE);

  h.assertEqual(result.added, 0);
  h.assertEqual(result.skipped, 1);
  h.assertEqual(data.dates['2026-10-01'].I.length, 1, '还是本地那个块');
  h.assertEqual(data.dates['2026-10-01'].I[0].id, mine.id);
});

t('判重限同象限：本地同名任务在别的象限时，块照常进来', function () {
  var data = local({ '2026-10-01|II': ['晨间例程'] });
  var result = Importer.importText(data, BLOCK_FILE);

  h.assertEqual(result.added, 1, '块落在 I，本地那条在 II，不算重复');
  h.assertEqual(data.dates['2026-10-01'].I.length, 1);
});

// ---------------------------------------------------------------------------
h.group('覆盖导入（需求 2）：整体替换，返回新数据对象');

t('覆盖后本地只剩文件里的内容，本地独有的全清掉', function () {
  var data = local({ '2026-10-01|I': ['本地甲'], '2026-10-01|II': ['本地乙'] });
  var imported = Importer.validate(file({ '2026-10-01|I': ['文件丙'] })).data;

  var result = Importer.overwrite(data, imported);

  h.assertEqual(result.added, 1);
  h.assertEqual(result.skipped, 0, '空本地没有可跳过的');
  h.assertEqual(texts(result.data, '2026-10-01', 'I'), '文件丙');
  h.assertEqual(texts(result.data, '2026-10-01', 'II'), '', '本地独有的乙被清掉了');
});

t('覆盖返回的是新数据对象，不是原来的那一个', function () {
  var data = local({ '2026-10-01|I': ['本地甲'] });
  var imported = Importer.validate(file({ '2026-10-01|I': ['文件丙'] })).data;

  var result = Importer.overwrite(data, imported);

  h.assertFalse(result.data === data, '覆盖不该在原地改，调用方要接回新引用');
  h.assertEqual(texts(data, '2026-10-01', 'I'), '本地甲', '原对象本身不该被改动');
});

t('覆盖后 id 全换新，不沿用文件里的编号', function () {
  var data = local();
  var imported = Importer.validate(file({ '2026-10-01|I': ['文件丙'] })).data;
  var srcId = imported.dates['2026-10-01'].I[0].id;

  var result = Importer.overwrite(data, imported);

  h.assertFalse(result.data.dates['2026-10-01'].I[0].id === srcId);
});

t('覆盖保留 user 和 schemaVersion', function () {
  var data = local();
  var imported = Importer.validate(file({ '2026-10-01|I': ['文件丙'] })).data;

  var result = Importer.overwrite(data, imported);

  h.assertEqual(result.data.user, 'default');
  h.assertEqual(result.data.schemaVersion, 1);
});

t('覆盖和合并一样忽略 tv（时间视图顺序记忆是设备本地的）', function () {
  var data = local();
  var raw = JSON.parse(file({ '2026-10-01|I': ['文件丙'] }));
  raw.dates['2026-10-01'].tv = { '早上': ['t:x'] };
  var imported = Importer.validate(JSON.stringify(raw)).data;

  var result = Importer.overwrite(data, imported);

  h.assertEqual(result.data.dates['2026-10-01'].tv, undefined);
});

t('同一份文件覆盖两次，结果一致，不叠加', function () {
  var data = local({ '2026-10-01|I': ['甲'] });
  var imported = Importer.validate(file({ '2026-10-01|I': ['丙', '丁'] })).data;

  var r1 = Importer.overwrite(data, imported);
  var r2 = Importer.overwrite(r1.data, imported);

  h.assertEqual(texts(r2.data, '2026-10-01', 'I'), '丙,丁', '两次覆盖结果一致，不叠加');
});

// ---------------------------------------------------------------------------

h.summary('importer.js 合并与去重');
