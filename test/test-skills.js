/**
 * test-skills.js
 *
 * v2.12 需求 4 / 需求 5（见 DS 2.52 / D-82）：
 *
 *   需求 4：「写一个技能池，可以自己添加自己认可的新 get 到的技能进去，
 *           同时可以编辑日期，日期默认为添加该技能的日期」。
 *   需求 5：「允许导出技能池和已阅读书籍的清单为 txt/markdown 文件」。
 *
 * 覆盖：`addSkill` 默认今天 / 传日期 / 空串当没传 / 空文本拒绝；`setSkillDate`
 * 设定 / 清成 null / 坏日期拒绝且原值不动；改名 / 删除；渲染（日期按钮、
 * 未设定态、编辑框、空态、转义）；两份清单的文本（空表 / 跨天 / 当天只写一个 /
 * 起始没设 / 只取已读完成）；导出文件名。
 *
 * 跑法：node test/test-skills.js
 */
'use strict';

var h = require('./harness');
var fs = require('fs');
var path = require('path');
var Util = require('../js/util');
var Store = require('../js/store');
var TaskOps = require('../js/task-ops');
var Render = require('../js/render');
var Exporter = require('../js/exporter');
var Importer = require('../js/importer');

var t = h.test;
var captureDownload = h.captureDownload;
var appSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
var renderSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'render.js'), 'utf8');

// ---------------------------------------------------------------------------
h.group('需求 4：技能池数据层');

t('加一条：日期默认是**今天**、字段是 id / text / date / createdAt', function () {
  var data = Store.createEmpty();
  var r = TaskOps.addSkill(data, '  用 Pointer Events 做拖拽  ', null);

  h.assertTrue(r.ok);
  h.assertEqual(r.item.text, '用 Pointer Events 做拖拽', '去空白');
  h.assertEqual(r.item.date, Util.todayStr(), '需求原话：日期默认为添加该技能的日期');
  h.assertEqual(Object.keys(r.item).sort().join(','), 'createdAt,date,id,text');
  h.assertEqual(data.skills.length, 1);
});

t('加一条：显式传日期就用传的', function () {
  var data = Store.createEmpty();
  h.assertEqual(TaskOps.addSkill(data, '游泳', '2026-01-02').item.date, '2026-01-02');
});

t('加一条：日期传空串按「没传」处理（回到今天）', function () {
  var data = Store.createEmpty();
  h.assertEqual(TaskOps.addSkill(data, '游泳', '').item.date, Util.todayStr());
});

t('加一条：日期不合法 → BAD_DATE，不猜也不悄悄改成今天', function () {
  var data = Store.createEmpty();
  h.assertEqual(TaskOps.addSkill(data, '游泳', '2026-13-01').error, TaskOps.ERR.BAD_DATE);
  h.assertEqual(TaskOps.addSkill(data, '游泳', '十月一号').error, TaskOps.ERR.BAD_DATE);
  h.assertEqual(data.skills.length, 0, '拒得干净，一条都不进');
});

t('加一条：文本为空 / 全是空白 → EMPTY_TEXT', function () {
  var data = Store.createEmpty();
  h.assertEqual(TaskOps.addSkill(data, '   ', null).error, TaskOps.ERR.EMPTY_TEXT);
  h.assertEqual(data.skills.length, 0);
});

t('改日期：设定 / 改 / 清成 null（不是空串）', function () {
  var data = Store.createEmpty();
  var s = TaskOps.addSkill(data, '游泳', '2026-01-01').item;

  h.assertTrue(TaskOps.setSkillDate(data, s.id, '2026-02-02').ok);
  h.assertEqual(s.date, '2026-02-02');

  h.assertTrue(TaskOps.setSkillDate(data, s.id, null).ok);
  h.assertEqual(s.date, null, '「未设定」收口成一个值（同阅读栏 / 池里）');

  h.assertTrue(TaskOps.setSkillDate(data, s.id, '').ok);
  h.assertEqual(s.date, null, '空串同样当「清掉」');
});

t('改日期：坏日期拒绝且**原值不动**', function () {
  var data = Store.createEmpty();
  var s = TaskOps.addSkill(data, '游泳', '2026-01-01').item;

  h.assertEqual(TaskOps.setSkillDate(data, s.id, '2026-02-30').error, TaskOps.ERR.BAD_DATE);
  h.assertEqual(s.date, '2026-01-01');
  h.assertEqual(TaskOps.setSkillDate(data, s.id, '2026-1-1').error, TaskOps.ERR.BAD_DATE);
  h.assertEqual(s.date, '2026-01-01');
});

t('改名 / 删除 / NOT_FOUND 三件套', function () {
  var data = Store.createEmpty();
  var s = TaskOps.addSkill(data, '游泳', null).item;

  h.assertTrue(TaskOps.editSkill(data, s.id, '自由泳').ok);
  h.assertEqual(s.text, '自由泳');
  h.assertEqual(TaskOps.editSkill(data, s.id, '  ').error, TaskOps.ERR.EMPTY_TEXT);
  h.assertEqual(s.text, '自由泳', '改空了保留原名');

  h.assertEqual(TaskOps.setSkillDate(data, 'no-such', '2026-01-01').error,
    TaskOps.ERR.NOT_FOUND);
  h.assertEqual(TaskOps.editSkill(data, 'no-such', 'x').error, TaskOps.ERR.NOT_FOUND);
  h.assertEqual(TaskOps.removeSkill(data, 'no-such').error, TaskOps.ERR.NOT_FOUND);

  h.assertTrue(TaskOps.removeSkill(data, s.id).ok);
  h.assertEqual(data.skills.length, 0);
});

t('getSkillStats：只有个数（需求没提上限，不做提示）', function () {
  var data = Store.createEmpty();
  TaskOps.addSkill(data, '甲', null);
  TaskOps.addSkill(data, '乙', null);

  var s = TaskOps.getSkillStats(data);
  h.assertEqual(s.count, 2);
  h.assertEqual(Object.keys(s).length, 1, '就一个 count，别自作主张加上限');
});

t('ensureSkills：缺表 / 不是数组都补齐', function () {
  var data = { dates: {} };
  h.assertEqual(TaskOps.ensureSkills(data).length, 0);
  data.skills = '不是数组';
  h.assertEqual(TaskOps.ensureSkills(data).length, 0);
});

// ---------------------------------------------------------------------------
h.group('需求 4：渲染');

function buildSkills(skills, view) {
  return Render.buildSkillsHtml(skills, view);
}

function skillsData() {
  var data = Store.createEmpty();
  var a = TaskOps.addSkill(data, '用 Pointer Events 做拖拽', '2026-10-11').item;
  var b = TaskOps.addSkill(data, '写递归下降解析器', null).item;
  TaskOps.setSkillDate(data, b.id, null);
  return { data: data, a: a, b: b };
}

t('头部：名称 + 计数 + 「＋」+ 收起三角', function () {
  var ctx = skillsData();
  var html = buildSkills(ctx.data.skills, {});

  h.assertTrue(html.indexOf('技能池') !== -1);
  h.assertTrue(html.indexOf('skills__add') !== -1);
  h.assertTrue(html.indexOf('data-panel="skills"') !== -1);
  h.assertTrue(html.indexOf('>2<') !== -1, '计数在');
});

t('行：文字 + 日期按钮 + 删除；没设日期的显示「未设定」', function () {
  var ctx = skillsData();
  var html = buildSkills(ctx.data.skills, {});

  h.assertTrue(html.indexOf('skills__text') !== -1);
  h.assertTrue(html.indexOf('skills__date') !== -1);
  h.assertTrue(html.indexOf('2026-10-11') !== -1);
  h.assertTrue(html.indexOf('skills__date--empty') !== -1, '没设日期那条给灰的「未设定」');
  h.assertTrue(html.indexOf('>未设定<') !== -1);
  h.assertTrue(html.indexOf('skills__del') !== -1);
  h.assertTrue(html.indexOf('data-id="' + ctx.a.id + '"') !== -1);
});

t('日期编辑态：原地换成 date 输入框 + 「清除」（和池里的完成时间同一套）', function () {
  var ctx = skillsData();
  var html = buildSkills(ctx.data.skills,
    { editing: { mode: 'edit-skill-date', skillId: ctx.a.id } });

  h.assertTrue(html.indexOf('type="date"') !== -1);
  h.assertTrue(html.indexOf('skills__date-input') !== -1);
  h.assertTrue(html.indexOf('value="2026-10-11"') !== -1);
  h.assertTrue(html.indexOf('skills__date-clear') !== -1);
  h.assertTrue(html.indexOf('>清除</button>') !== -1, '按钮文案和池里一致');
});

t('改名态：整行收成输入框，值转义', function () {
  var data = Store.createEmpty();
  var s = TaskOps.addSkill(data, 'a<b>', null).item;
  var html = buildSkills(data.skills, { editing: { mode: 'edit-skill', skillId: s.id } });

  h.assertTrue(html.indexOf('skills__item--editing') !== -1);
  h.assertTrue(html.indexOf('a&lt;b&gt;') !== -1);
});

t('空态 + 新增态：空表给引导；新增时插一个空输入框', function () {
  h.assertTrue(buildSkills([], {}).indexOf('skills__empty') !== -1);

  var adding = buildSkills([], { editing: { mode: 'add-skill' } });
  h.assertTrue(adding.indexOf('task__input') !== -1);
  h.assertFalse(adding.indexOf('skills__empty') !== -1, '正在新增就不显示空态');
});

t('数据缺字段 / 表被改坏也不崩', function () {
  h.assertTrue(buildSkills(null, {}).indexOf('技能池') !== -1);
  h.assertTrue(buildSkills('不是数组', {}).indexOf('技能池') !== -1);
});

// ---------------------------------------------------------------------------
h.group('需求 5：技能清单（buildSkillsList）');

t('空表：一句「技能池还是空的」', function () {
  var text = Exporter.buildSkillsList(Store.createEmpty());
  h.assertTrue(text.indexOf('# 技能清单') !== -1);
  h.assertTrue(text.indexOf('技能池还是空的') !== -1);
});

t('有日期 / 没日期 / 顺序 = 池内顺序', function () {
  var data = Store.createEmpty();
  TaskOps.addSkill(data, '游泳', '2026-01-02');
  var b = TaskOps.addSkill(data, '吉他', null).item;
  TaskOps.setSkillDate(data, b.id, null);
  TaskOps.addSkill(data, '油画', '2026-03-04');

  var lines = Exporter.buildSkillsList(data).split('\n');
  h.assertEqual(lines[0], '# 技能清单');
  h.assertEqual(lines[1], '');
  h.assertEqual(lines[2], '- 游泳（2026-01-02）');
  h.assertEqual(lines[3], '- 吉他', '没设日期的就不带括号');
  h.assertEqual(lines[4], '- 油画（2026-03-04）');
});

t('导出的文件名带日期', function () {
  var name = captureDownload(function () {
    Exporter.exportSkills(Store.createEmpty());
  });
  h.assertEqual(name, '技能清单-' + Util.todayStr() + '.md');
});

// ---------------------------------------------------------------------------
h.group('需求 5：已读书籍清单（buildReadingList）');

t('空表：一句「还没有读完的书」', function () {
  var text = Exporter.buildReadingList(Store.createEmpty());
  h.assertTrue(text.indexOf('# 已读书籍清单') !== -1);
  h.assertTrue(text.indexOf('还没有读完的书') !== -1);
});

t('**只取已读完成**：正在阅读的书不在清单里（需求原话「已阅读书籍」）', function () {
  var data = Store.createEmpty();
  var a = TaskOps.addReadingItem(data, '在读的书', null).item;
  var b = TaskOps.addReadingItem(data, '读完的书', null).item;
  TaskOps.completeReadingItem(data, b.id, '2026-10-05');

  var text = Exporter.buildReadingList(data);
  h.assertTrue(text.indexOf('读完的书') !== -1);
  h.assertFalse(text.indexOf('在读的书') !== -1, '在读数不算「已读」');
  h.assertEqual(a.doneAt, null, '那条确实还在读');
});

t('跨天读完：写「起始 → 完成」', function () {
  var data = Store.createEmpty();
  var b = TaskOps.addReadingItem(data, '跨天读', '2026-10-01').item;
  TaskOps.completeReadingItem(data, b.id, '2026-10-05');

  var text = Exporter.buildReadingList(data);
  h.assertTrue(text.indexOf('- 跨天读（2026-10-01 → 2026-10-05）') !== -1);
});

t('当天读完：只写一个日期（画「X → X」是废信息，D-68）', function () {
  var data = Store.createEmpty();
  var b = TaskOps.addReadingItem(data, '当天读完', '2026-10-01').item;
  TaskOps.completeReadingItem(data, b.id, '2026-10-01');

  var text = Exporter.buildReadingList(data);
  h.assertTrue(text.indexOf('- 当天读完（2026-10-01）') !== -1);
  h.assertFalse(text.indexOf('→') !== -1);
});

t('起始没设过：只写完成日期（不写「未设定 →」）', function () {
  var data = Store.createEmpty();
  var b = TaskOps.addReadingItem(data, '没记起始', null).item;
  TaskOps.setReadingStart(data, b.id, null);
  TaskOps.completeReadingItem(data, b.id, '2026-10-05');

  var text = Exporter.buildReadingList(data);
  h.assertTrue(text.indexOf('- 没记起始（2026-10-05）') !== -1);
  h.assertFalse(text.indexOf('未设定') !== -1);
});

t('文字里的 < > & 会转义（清单也是 Markdown，会被渲染）', function () {
  var data = Store.createEmpty();
  TaskOps.addSkill(data, '<b>加粗</b>', null);
  h.assertTrue(Exporter.buildSkillsList(data).indexOf('&lt;b&gt;') !== -1);
});

t('导出的文件名带日期', function () {
  var name = captureDownload(function () {
    Exporter.exportReadingList(Store.createEmpty());
  });
  h.assertEqual(name, '已读书籍清单-' + Util.todayStr() + '.md');
});

t('两份清单**不进日报**：buildMarkdown 里没有它们', function () {
  var data = Store.createEmpty();
  TaskOps.addSkill(data, '独门技能', null);
  var b = TaskOps.addReadingItem(data, '读过的书', null).item;
  TaskOps.completeReadingItem(data, b.id, '2026-10-05');
  TaskOps.addTask(data, '2026-10-05', 'I', '当天的任务');

  var md = Exporter.buildMarkdown(data, { dateStr: '2026-10-05' });
  h.assertTrue(md.indexOf('当天的任务') !== -1);
  h.assertFalse(md.indexOf('独门技能') !== -1);
  h.assertFalse(md.indexOf('读过的书') !== -1);
});

// ---------------------------------------------------------------------------
h.group('JSON 往返与接线');

t('序列化 → 解析：技能与日期一条不少；坏日期收敛成 null 不拒整份', function () {
  var data = Store.createEmpty();
  TaskOps.addSkill(data, '游泳', '2026-01-02');
  var b = TaskOps.addSkill(data, '吉他', null).item;
  TaskOps.setSkillDate(data, b.id, null);   // 没设日期那条

  var back = Store.parse(Store.serialize(data)).data;
  h.assertEqual(back.skills.length, 2);
  h.assertEqual(back.skills[0].date, '2026-01-02');
  h.assertEqual(back.skills[1].date, null);

  var raw = Store.normalize({ dates: {}, skills: [
    { text: '臭日期', date: '2026-13-01' }, { text: '' }, '不是对象'
  ] });
  h.assertEqual(raw.data.skills.length, 1, '坏日期的条目留着（丢字段不丢条目）');
  h.assertEqual(raw.data.skills[0].date, null);
  h.assertEqual(raw.dropped, 2);
});

t('老文件（没有 skills）导入通过且 skills 是 null', function () {
  var checked = Importer.validate('{"user":"default","schemaVersion":1,"dates":{}}');
  h.assertTrue(checked.ok);
  h.assertNull(checked.data.skills);
});

t('导入：合并按文本判重、跳过的保留本地日期、id 换新', function () {
  var local = Store.createEmpty();
  var mine = TaskOps.addSkill(local, '游泳', '2026-01-02').item;

  var incoming = Importer.validate(JSON.stringify({
    user: 'default', schemaVersion: 1, dates: {},
    skills: [{ text: '游泳', date: '2020-01-01' }, { text: '吉他', date: '2026-05-05' }]
  })).data;

  var r = Importer.merge(local, incoming);
  h.assertEqual(r.skipped, 1);
  h.assertEqual(r.added, 1);
  h.assertEqual(local.skills[0].date, '2026-01-02', '跳过的那条不被文件覆盖');
  h.assertEqual(local.skills[1].date, '2026-05-05');
  h.assertTrue(local.skills[1].id !== mine.id);
});

t('导入：坏形状整份拒绝（不是列表 / 条目没内容 / 日期不合法）', function () {
  h.assertFalse(Importer.validate('{"dates":{},"skills":"x"}').ok);
  h.assertFalse(Importer.validate('{"dates":{},"skills":[{"text":"  "}]}').ok);
  h.assertFalse(Importer.validate('{"dates":{},"skills":[{"text":"甲","date":"2026-13-01"}]}').ok);
});

t('app.js：commitEdit 认 add-skill / edit-skill / edit-skill-date', function () {
  var addCond = appSrc.slice(appSrc.indexOf('// ---- 新增（任务、阶段、任务块或池内任务）'),
                             appSrc.indexOf('// ---- 改文字'));
  h.assertTrue(addCond.indexOf("editing.mode === 'add-skill'") !== -1, 'R-38 那个坑');
  h.assertTrue(appSrc.indexOf("editing.mode === 'edit-skill'") !== -1);
  h.assertTrue(appSrc.indexOf("editing.mode === 'edit-skill-date'") !== -1);
  h.assertTrue(appSrc.indexOf('TaskOps.addSkill(') !== -1);
  h.assertTrue(appSrc.indexOf('TaskOps.setSkillDate(') !== -1);
});

t('app.js：日期框进了 commitEdit / focusEditor 的选择器清单（R-40 / R-54）', function () {
  h.assertTrue(appSrc.indexOf('.skills__date-input') !== -1);
  h.assertTrue(renderSrc.indexOf('.skills__date-input') !== -1);
  // 两处都得在：一处管提交读到哪个框，一处管重画后焦点落进哪个框
  h.assertEqual((appSrc.match(/\.skills__date-input/g) || []).length, 1);
});

t('app.js：技能池的写函数都拦了保护模式，bindSkills 开机绑上', function () {
  ['startAddSkill', 'startEditSkill', 'startEditSkillDate', 'doSetSkillDate', 'doRemoveSkill']
    .forEach(function (fn) {
      var start = appSrc.indexOf('function ' + fn + '(');
      h.assertTrue(start !== -1, '找不到 ' + fn);
      var body = appSrc.slice(start, appSrc.indexOf('\n  }', start));
      h.assertTrue(body.indexOf('Store.isProtectionMode()') !== -1, fn + ' 少了保护模式检查');
    });
  h.assertTrue(appSrc.indexOf('bindSkills();') !== -1);
});

t('app.js：导出菜单那两项接到了 Exporter（技能清单 / 已读书籍）', function () {
  h.assertTrue(appSrc.indexOf("format === 'skills'") !== -1);
  h.assertTrue(appSrc.indexOf("format === 'reading'") !== -1);
  h.assertTrue(appSrc.indexOf('Exporter.exportSkills(state.data)') !== -1);
  h.assertTrue(appSrc.indexOf('Exporter.exportReadingList(state.data)') !== -1);
});

t('技能日期按钮的 CSS 和池里的完成时间逐条一致（同一个东西不做成两样）', function () {
  // 先剥掉 CSS 注释：注释会被下面那条「取规则体」的正则当成选择器文本的一部分
  // （test-reading.js 的同类比对也是这么处理的）
  var css = fs.readFileSync(path.join(__dirname, '..', 'css', 'style.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  /** 取一条规则体（选择器**完全相同**才算），比对声明清单 */
  function bodyOf(sel) {
    var re = /([^{}]+)\{([^}]*)\}/g;
    var m;
    while ((m = re.exec(css)) !== null) {
      if (m[1].trim() === sel) return m[2].replace(/\s+/g, ' ').trim();
    }
    return null;
  }

  [['.skills__date', '.pool__date'],
   ['.skills__date--empty', '.pool__date--empty'],
   ['.skills__date-input', '.pool__date-input'],
   ['.skills__date-clear', '.pool__date-clear']].forEach(function (pair) {
    var mine = bodyOf(pair[0]);
    var pool = bodyOf(pair[1]);
    h.assertTrue(mine !== null, '找不到 ' + pair[0]);
    h.assertTrue(pool !== null, '找不到 ' + pair[1]);
    h.assertEqual(mine, pool, pair[0] + ' 该和 ' + pair[1] + ' 逐条一致');
  });
});

// ---------------------------------------------------------------------------

h.summary('技能池与两份清单导出（v2.12 需求 4 / 需求 5）');
