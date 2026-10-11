/**
 * test-principles.js
 *
 * v2.12 需求 3（见 DS 2.51 / D-81）：「加一个原则池。类似于阅读池，但是可以
 * 简化，去掉时间相关信息的记录。被归档的原则列表命名为「参考原则」」。
 *
 * 覆盖：数据层（加 / 改 / 归档搬到开头 / 放回 / 删 / 空文本拒绝 / NOT_FOUND /
 * 条目**只有 id,text,createdAt** 三个字段 —— 钉住「没有时间」这一条）；
 * 渲染（两段结构、「参考原则」标题、空态、转义）；`commitEdit` 认
 * `add-principle` / `edit-principle`；保护模式早退；JSON 往返 + 老文件兼容。
 *
 * 跑法：node test/test-principles.js
 */
'use strict';

var h = require('./harness');
var fs = require('fs');
var path = require('path');
var Store = require('../js/store');
var TaskOps = require('../js/task-ops');
var Render = require('../js/render');
var Importer = require('../js/importer');

var t = h.test;
var appSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');

/** 加两条原则进去（甲在前、乙在后） */
function withTwo() {
  var data = Store.createEmpty();
  var a = TaskOps.addPrinciple(data, '先做重要的事').item;
  var b = TaskOps.addPrinciple(data, '一次只做一件').item;
  return { data: data, a: a, b: b };
}

// ---------------------------------------------------------------------------
h.group('数据层：加 / 改 / 删');

t('加一条：进「正在遵循」的末尾，字段只有 id / text / createdAt', function () {
  var data = Store.createEmpty();
  var r = TaskOps.addPrinciple(data, '  先做重要的事  ');

  h.assertTrue(r.ok);
  h.assertEqual(r.item.text, '先做重要的事', '去空白');
  h.assertEqual(data.principles.active.length, 1);
  h.assertEqual(data.principles.archived.length, 0);

  // 需求原话「去掉时间相关信息的记录」：一个时间字段都不许有
  h.assertEqual(Object.keys(r.item).sort().join(','), 'createdAt,id,text',
    '只有这三个字段（没有 start / doneAt / archivedAt 之类）');
});

t('文本为空 / 全是空白 → EMPTY_TEXT，一条都不加', function () {
  var data = Store.createEmpty();
  h.assertEqual(TaskOps.addPrinciple(data, '   ').error, TaskOps.ERR.EMPTY_TEXT);
  h.assertEqual(TaskOps.addPrinciple(data, null).error, TaskOps.ERR.EMPTY_TEXT);
  h.assertEqual(data.principles.active.length, 0);
});

t('两条按加入顺序排（push 到末尾，不是插到开头）', function () {
  var ctx = withTwo();
  h.assertEqual(ctx.data.principles.active[0].id, ctx.a.id);
  h.assertEqual(ctx.data.principles.active[1].id, ctx.b.id);
});

t('改名：成功；改空拒绝且原名保留（和任务同一条规矩）', function () {
  var ctx = withTwo();
  h.assertTrue(TaskOps.editPrinciple(ctx.data, ctx.a.id, '重要的事先做').ok);
  h.assertEqual(ctx.a.text, '重要的事先做');

  h.assertEqual(TaskOps.editPrinciple(ctx.data, ctx.a.id, '  ').error, TaskOps.ERR.EMPTY_TEXT);
  h.assertEqual(ctx.a.text, '重要的事先做');
});

t('删除：从所在表移除', function () {
  var ctx = withTwo();
  h.assertTrue(TaskOps.removePrinciple(ctx.data, ctx.a.id).ok);
  h.assertEqual(ctx.data.principles.active.length, 1);
  h.assertEqual(ctx.data.principles.active[0].id, ctx.b.id);
});

t('找不到的 id：三个写函数都是 NOT_FOUND，且不动数据', function () {
  var ctx = withTwo();
  var snapshot = JSON.stringify(ctx.data);

  h.assertEqual(TaskOps.editPrinciple(ctx.data, 'no-such', 'x').error, TaskOps.ERR.NOT_FOUND);
  h.assertEqual(TaskOps.archivePrinciple(ctx.data, 'no-such').error, TaskOps.ERR.NOT_FOUND);
  h.assertEqual(TaskOps.restorePrinciple(ctx.data, 'no-such').error, TaskOps.ERR.NOT_FOUND);
  h.assertEqual(TaskOps.removePrinciple(ctx.data, 'no-such').error, TaskOps.ERR.NOT_FOUND);
  h.assertEqual(JSON.stringify(ctx.data), snapshot, '数据一个字节不动');
  h.assertNull(TaskOps.findPrincipleItem(ctx.data, 'no-such'));
});

// ---------------------------------------------------------------------------
h.group('归档 →「参考原则」→ 放回');

t('归档：搬到参考原则的**开头**', function () {
  var ctx = withTwo();
  h.assertTrue(TaskOps.archivePrinciple(ctx.data, ctx.a.id).ok);

  h.assertEqual(ctx.data.principles.active.length, 1, '不在正在遵循里了');
  h.assertEqual(ctx.data.principles.archived.length, 1);
  h.assertEqual(ctx.data.principles.archived[0].id, ctx.a.id);
  h.assertNull(TaskOps.findPrincipleItem(ctx.data, ctx.a.id).archived === false ? 1 : null,
    '归档后它属于 archived 那张表');
  h.assertTrue(TaskOps.findPrincipleItem(ctx.data, ctx.a.id).archived);
});

t('再归档后续的：最新的排在最前（和阅读栏「刚读完的排最前」同一条）', function () {
  var ctx = withTwo();
  TaskOps.archivePrinciple(ctx.data, ctx.a.id);
  TaskOps.archivePrinciple(ctx.data, ctx.b.id);

  h.assertEqual(ctx.data.principles.archived[0].id, ctx.b.id, '后归档的在开头');
  h.assertEqual(ctx.data.principles.archived[1].id, ctx.a.id);
});

t('重复归档 / 放回已经在那边的：幂等，不搬两次', function () {
  var ctx = withTwo();
  TaskOps.archivePrinciple(ctx.data, ctx.a.id);
  TaskOps.archivePrinciple(ctx.data, ctx.a.id);
  h.assertEqual(ctx.data.principles.archived.length, 1, '还是只有一条');

  TaskOps.restorePrinciple(ctx.data, ctx.a.id);
  TaskOps.restorePrinciple(ctx.data, ctx.a.id);
  h.assertEqual(ctx.data.principles.active.length, 2, '没有多出一条');
});

t('放回：回到正在遵循的**开头**（点错了的退路）', function () {
  var ctx = withTwo();
  TaskOps.archivePrinciple(ctx.data, ctx.b.id);
  h.assertTrue(TaskOps.restorePrinciple(ctx.data, ctx.b.id).ok);

  h.assertEqual(ctx.data.principles.archived.length, 0);
  h.assertEqual(ctx.data.principles.active[0].id, ctx.b.id, '回到开头');
  h.assertEqual(ctx.data.principles.active.length, 2);
});

t('归档不产生任何时间戳（条目形状归档前后一模一样）', function () {
  var ctx = withTwo();
  var before = Object.keys(ctx.a).sort().join(',');
  TaskOps.archivePrinciple(ctx.data, ctx.a.id);
  h.assertEqual(Object.keys(ctx.a).sort().join(','), before);
});

t('getPrincipleStats：两边的条数', function () {
  var ctx = withTwo();
  TaskOps.archivePrinciple(ctx.data, ctx.a.id);

  var s = TaskOps.getPrincipleStats(ctx.data);
  h.assertEqual(s.active, 1);
  h.assertEqual(s.archived, 1);
});

t('ensurePrinciples：缺表 / 表不是数组都就地补齐', function () {
  var data = { dates: {} };
  h.assertEqual(TaskOps.ensurePrinciples(data).active.length, 0);
  h.assertEqual(TaskOps.ensurePrinciples(data).archived.length, 0);

  data.principles = { active: '不是数组', archived: null };
  TaskOps.ensurePrinciples(data);
  h.assertTrue(Array.isArray(data.principles.active));
  h.assertTrue(Array.isArray(data.principles.archived));
});

// ---------------------------------------------------------------------------
h.group('渲染：两段结构 +「参考原则」标题 + 空态 + 转义');

function build(principles, view) {
  return Render.buildPrinciplesHtml(principles, view);
}

t('头部：名称 + 计数 + 「＋」+ 收起三角', function () {
  var ctx = withTwo();
  var html = build(ctx.data.principles, {});

  h.assertTrue(html.indexOf('原则池') !== -1);
  h.assertTrue(html.indexOf('principles__add') !== -1);
  h.assertTrue(html.indexOf('data-panel="principles"') !== -1, '头上有收起三角');
  h.assertTrue(html.indexOf('>2 / 0<') !== -1, '计数 = 正在遵循 / 参考原则');
});

t('两段结构：正在遵循列表 + 「参考原则」小标题 + 归档列表', function () {
  var ctx = withTwo();
  TaskOps.archivePrinciple(ctx.data, ctx.a.id);
  var html = build(ctx.data.principles, {});

  h.assertTrue(html.indexOf('principles__list') !== -1);
  h.assertTrue(html.indexOf('参考原则') !== -1, '需求点名的名字，不能改叫别的');
  h.assertTrue(html.indexOf('principles__archived-list') !== -1);
});

t('正在遵循那行：勾选框 + 文字 + 删除；归档那行：↩ + 文字 + 删除', function () {
  var ctx = withTwo();
  TaskOps.archivePrinciple(ctx.data, ctx.a.id);
  var html = build(ctx.data.principles, {});

  h.assertTrue(html.indexOf('principles__check') !== -1, '勾一下就归档');
  h.assertTrue(html.indexOf('principles__restore') !== -1, '归档那边能放回来');
  h.assertTrue(html.indexOf('principles__del') !== -1);
  h.assertTrue(html.indexOf('data-id="' + ctx.a.id + '"') !== -1);
  h.assertTrue(html.indexOf('data-id="' + ctx.b.id + '"') !== -1);
});

t('空态：一条都没有时给一句引导；正在遵循空了、归档有货时两段各画各的', function () {
  var empty = build(Store.createEmpty().principles, {});
  h.assertTrue(empty.indexOf('principles__empty') !== -1);
  h.assertFalse(empty.indexOf('principles__list') !== -1, '空态不画列表');

  var ctx = withTwo();
  TaskOps.archivePrinciple(ctx.data, ctx.a.id);
  TaskOps.archivePrinciple(ctx.data, ctx.b.id);
  var html = build(ctx.data.principles, {});
  h.assertTrue(html.indexOf('principles__none') !== -1, '正在遵循空了给占位');
  h.assertTrue(html.indexOf('principles__archived-list') !== -1, '归档那段照常画');
});

t('归档那段的空态：还没归档过时给一句说明', function () {
  var ctx = withTwo();
  var html = build(ctx.data.principles, {});
  h.assertTrue(html.indexOf('principles__archived-empty') !== -1);
});

t('新增态：列表开头插一个输入框；改名态：整行收成输入框', function () {
  var ctx = withTwo();
  var adding = build(ctx.data.principles, { editing: { mode: 'add-principle' } });
  h.assertTrue(adding.indexOf('task__input') !== -1);
  h.assertTrue(adding.indexOf('principles__item--editing') !== -1);

  var editing = build(ctx.data.principles,
    { editing: { mode: 'edit-principle', principleId: ctx.a.id } });
  h.assertTrue(editing.indexOf('value="先做重要的事"') !== -1);

  // 只看**那一条**（另一条照常画，所以不能拿整段 HTML 找 check）：
  // 编辑态的行里没有勾选框、没有文字格
  var row = editing.slice(editing.indexOf('data-id="' + ctx.a.id + '"'));
  row = row.slice(0, row.indexOf('</li>'));
  h.assertFalse(row.indexOf('principles__check') !== -1, '编辑态那条不画勾选框');
  h.assertFalse(row.indexOf('principles__text') !== -1, '整行换成输入框了');
});

t('文字转义：尖括号不会变成真标签', function () {
  var data = Store.createEmpty();
  TaskOps.addPrinciple(data, '<img src=x onerror=alert(1)>');
  var html = build(data.principles, {});

  h.assertFalse(html.indexOf('<img') !== -1);
  h.assertTrue(html.indexOf('&lt;img') !== -1);
});

t('数据缺字段 / 表被改坏也不崩', function () {
  h.assertTrue(build(null, {}).indexOf('原则池') !== -1);
  h.assertTrue(build({ active: 'x' }, {}).indexOf('原则池') !== -1);
});

// ---------------------------------------------------------------------------
h.group('Store 清洗与 JSON 往返（含老文件兼容）');

t('normalize：脏条目丢掉、文本去空白、补 principles 字段', function () {
  var raw = { dates: {}, principles: { active: [{ text: ' 甲 ' }, '不是对象', { text: '  ' }] } };
  var r = Store.normalize(raw);

  h.assertEqual(r.data.principles.active.length, 1);
  h.assertEqual(r.data.principles.active[0].text, '甲');
  h.assertEqual(r.dropped, 2);
  h.assertEqual(r.data.principles.archived.length, 0);
});

t('老数据（没有 principles 字段）→ 补空表，dropped 仍是 0', function () {
  var r = Store.normalize({ dates: {} });
  h.assertEqual(r.data.principles.active.length, 0);
  h.assertEqual(r.data.principles.archived.length, 0);
  h.assertEqual(r.dropped, 0);
});

t('序列化 → 解析：两边的条目一条不少', function () {
  var ctx = withTwo();
  TaskOps.archivePrinciple(ctx.data, ctx.a.id);

  var back = Store.parse(Store.serialize(ctx.data)).data;
  h.assertEqual(back.principles.active.length, 1);
  h.assertEqual(back.principles.archived.length, 1);
  h.assertEqual(back.principles.archived[0].text, '先做重要的事');
});

t('导入：老文件（没有原则池）校验通过且 principles 是 null，本地一条不动', function () {
  var old = JSON.stringify({ user: 'default', schemaVersion: 1, dates: {} });
  var checked = Importer.validate(old);
  h.assertTrue(checked.ok);
  h.assertNull(checked.data.principles, '「文件里没有」≠「有零条」');

  var local = Store.createEmpty();
  TaskOps.addPrinciple(local, '本地的原则');
  Importer.merge(local, checked.data);
  h.assertEqual(local.principles.active.length, 1);
});

t('导入：合并按文本判重、两张表各判各的、id 换新', function () {
  var local = Store.createEmpty();
  var mine = TaskOps.addPrinciple(local, '先做重要的事').item;

  var incoming = Importer.validate(JSON.stringify({
    user: 'default', schemaVersion: 1, dates: {},
    principles: { active: [{ text: '先做重要的事' }, { text: '一次只做一件' }],
                  archived: [{ text: '先做重要的事' }] }
  })).data;

  var r = Importer.merge(local, incoming);
  h.assertEqual(r.skipped, 1, '正在遵循里同名的那条跳过');
  h.assertEqual(r.added, 2, '新的一条 + 归档里那条（两张表各判各的）');
  h.assertEqual(local.principles.active.length, 2);
  h.assertEqual(local.principles.archived.length, 1);
  h.assertTrue(local.principles.active[1].id !== mine.id, '搬进来的换新 id');
});

t('导入：坏形状整份拒绝（不是对象 / 表不是列表 / 条目没内容）', function () {
  h.assertFalse(Importer.validate('{"dates":{},"principles":"x"}').ok);
  h.assertFalse(Importer.validate('{"dates":{},"principles":{"active":"x"}}').ok);
  h.assertFalse(Importer.validate('{"dates":{},"principles":{"active":[{"text":"  "}]}}').ok);
});

t('覆盖导入：原则池整体换掉', function () {
  var local = Store.createEmpty();
  TaskOps.addPrinciple(local, '旧的');

  var incoming = Importer.validate(JSON.stringify({
    user: 'default', schemaVersion: 1, dates: {},
    principles: { active: [{ text: '新的' }] }
  })).data;

  var r = Importer.overwrite(local, incoming);
  h.assertEqual(r.data.principles.active.length, 1);
  h.assertEqual(r.data.principles.active[0].text, '新的');
});

// ---------------------------------------------------------------------------
h.group('接线：app.js 源码守卫');

t('commitEdit 认 add-principle / edit-principle（R-38 那个坑）', function () {
  var addCond = appSrc.slice(appSrc.indexOf('// ---- 新增（任务、阶段、任务块或池内任务）'),
                             appSrc.indexOf('// ---- 改文字'));
  h.assertTrue(addCond.indexOf("editing.mode === 'add-principle'") !== -1,
    '漏列的话回车提交会被静默丢掉（R-38）');
  h.assertTrue(appSrc.indexOf("editing.mode === 'edit-principle'") !== -1);
  h.assertTrue(appSrc.indexOf('TaskOps.addPrinciple(') !== -1);
  h.assertTrue(appSrc.indexOf('TaskOps.editPrinciple(') !== -1);
});

t('bindPrinciples 独立子树，开机绑上', function () {
  h.assertTrue(appSrc.indexOf('function bindPrinciples()') !== -1);
  h.assertTrue(appSrc.indexOf('bindPrinciples();') !== -1);
  h.assertTrue(appSrc.indexOf('principleIdOf') !== -1);
});

t('五个写函数都拦了保护模式', function () {
  ['startAddPrinciple', 'startEditPrinciple', 'doArchivePrinciple',
   'doRestorePrinciple', 'doRemovePrinciple'].forEach(function (fn) {
    var start = appSrc.indexOf('function ' + fn + '(');
    h.assertTrue(start !== -1, '找不到 ' + fn);
    var body = appSrc.slice(start, appSrc.indexOf('\n  }', start));
    h.assertTrue(body.indexOf('Store.isProtectionMode()') !== -1, fn + ' 少了保护模式检查');
  });
});

t('归档是勾选类动作：保留滚动位置；放回 / 删除是内容变了，不保留', function () {
  var arch = appSrc.slice(appSrc.indexOf('function doArchivePrinciple('));
  arch = arch.slice(0, arch.indexOf('\n  }'));
  h.assertTrue(arch.indexOf('renderCurrent({ keepScroll: true })') !== -1);

  var restore = appSrc.slice(appSrc.indexOf('function doRestorePrinciple('));
  restore = restore.slice(0, restore.indexOf('\n  }'));
  h.assertFalse(restore.indexOf('keepScroll') !== -1);
});

t('renderCurrent 把 principles 传下去了（不传就白画）', function () {
  h.assertTrue(appSrc.indexOf('principles: TaskOps.ensurePrinciples(state.data)') !== -1);
});

t('保护模式的 CSS 名单里有原则池的写控件（连文字格）', function () {
  var css = fs.readFileSync(path.join(__dirname, '..', 'css', 'style.css'), 'utf8');
  ['body.is-readonly .principles__add', 'body.is-readonly .principles__check',
   'body.is-readonly .principles__restore', 'body.is-readonly .principles__del',
   'body.is-readonly .principles__text'].forEach(function (sel) {
    h.assertTrue(css.indexOf(sel) !== -1, '缺 ' + sel);
  });
});

// ---------------------------------------------------------------------------

h.summary('原则池与「参考原则」（v2.12 需求 3）');
