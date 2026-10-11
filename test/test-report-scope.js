/**
 * test-report-scope.js
 *
 * v2.12 需求 1（见 DS 2.53 / D-84）：「routine部分不需要包含计划池等等，
 * 只需要包含象限池的内容」。
 *
 * 先记「routine」在这个项目里指什么：本应用**没有独立的日报页**，唯一成文的
 * 日报产出就是**导出** —— Markdown（`.md`）和 PDF（打印页，内容与 Markdown
 * 同一份，见 DS 2.15）。所以这条需求的口径落在 `Exporter.buildMarkdown` 与
 * `Pdf.buildPrintHtml` 两个函数上：**只含四象限**（任务 / 任务块 / 阶段 +
 * 当日统计行），计划池 / 模板池 / 阅读栏 / 原则池 / 技能池 / 小文件一律不进。
 *
 * 这条解读**没有用户正面确认**（记在 DS 5.3）。为什么仍然要立守卫：代码本来
 * 就只画象限，真正会漂的是「文档与后来者照着旧文档写代码」—— FS 六里原来
 * 那句「日报要包含待办池 / 周计划 / 月计划」从未落地，本版把它改口。
 *
 * 两边一起守：
 *   1. **行为侧**：一份「六个板块都有货 + 四象限也有货」的数据，导出结果里
 *      只出现象限的内容；
 *   2. **源码侧**：两个构建函数的函数体里不出现其它板块的名字。
 *
 * 跑法：node test/test-report-scope.js
 */
'use strict';

var h = require('./harness');
var fs = require('fs');
var path = require('path');
var Store = require('../js/store');
var TaskOps = require('../js/task-ops');
var Exporter = require('../js/exporter');
var Pdf = require('../js/pdf');

var t = h.test;
var DATE = '2026-10-05';
var exporterSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'exporter.js'), 'utf8');
var pdfSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'pdf.js'), 'utf8');

/** 除日报外每个板块都塞一件**独一份的文本**，好在下游的产物里搜它 */
var POOL_TEXT = '池子里的任务';
var TPL_TEXT = '模板名字';
var READING_TEXT = '正在读的书';
var READING_DONE_TEXT = '读完了的书';
var PRINCIPLE_TEXT = '参考原则里的那句话';
var SKILL_TEXT = '独门技能';
var FILE_NAME = '小文件的名字.txt';
var FILE_TEXT = '小文件的正文';
/** 象限里的内容（**唯一该进日报的东西**） */
var QUAD_TEXT = '当天的象限任务';
var QUAD_STAGE = '当天的阶段';

/**
 * 一份「什么都有」的数据：六个板块 + 那一天的四象限。
 * 所有文本都刻意不同，漏了哪一处都能一眼看出来。
 */
function everythingData() {
  var data = Store.createEmpty();

  // 四象限（该进日报）
  var task = TaskOps.addTask(data, DATE, 'I', QUAD_TEXT).task;
  TaskOps.addStage(data, DATE, 'I', task.id, QUAD_STAGE);
  TaskOps.addBlock(data, DATE, 'II', '当天的任务块');

  // 计划池
  TaskOps.addPoolItem(data, DATE, POOL_TEXT);
  // 模板
  data.templates.push({ id: 't1', name: TPL_TEXT, createdAt: 1,
    items: { I: [], II: [], III: [], IV: [] } });
  // 阅读栏：在读 + 已读
  TaskOps.addReadingItem(data, READING_TEXT, null);
  var done = TaskOps.addReadingItem(data, READING_DONE_TEXT, null).item;
  TaskOps.completeReadingItem(data, done.id, DATE);
  // 原则池：正在遵循 + 参考原则
  var p = TaskOps.addPrinciple(data, '正在遵循的那句话').item;
  TaskOps.addPrinciple(data, PRINCIPLE_TEXT);
  TaskOps.archivePrinciple(data, p.id);
  // 技能池
  TaskOps.addSkill(data, SKILL_TEXT, DATE);
  // 小文件
  TaskOps.addFile(data, FILE_NAME, FILE_TEXT);

  return data;
}

/** 日报里**不该出现**的所有文本 */
function foreignTexts() {
  return [POOL_TEXT, TPL_TEXT, READING_TEXT, READING_DONE_TEXT, PRINCIPLE_TEXT,
          SKILL_TEXT, FILE_NAME, FILE_TEXT, '正在遵循的那句话'];
}

// ---------------------------------------------------------------------------
h.group('行为侧：日报只画四象限');

t('Markdown 日报：只含当天象限，六个板块一个字都不进', function () {
  var md = Exporter.buildMarkdown(everythingData(), { dateStr: DATE });

  h.assertTrue(md.indexOf(QUAD_TEXT) !== -1, '象限任务是日报的主角');
  h.assertTrue(md.indexOf(QUAD_STAGE) !== -1, '阶段跟着任务进去');
  h.assertTrue(md.indexOf('当天的任务块') !== -1, '任务块也在');

  foreignTexts().forEach(function (text) {
    h.assertTrue(md.indexOf(text) === -1, '日报里不该出现「' + text + '」');
  });
});

t('Markdown 日报：日期标题只有那一天的，别的日期不掺进来', function () {
  var data = everythingData();
  TaskOps.addTask(data, '2020-01-01', 'I', '很久以前的任务');

  var md = Exporter.buildMarkdown(data, { dateStr: DATE });
  h.assertTrue(md.indexOf('## ' + DATE) !== -1);
  h.assertFalse(md.indexOf('## 2020-01-01') !== -1);
  h.assertFalse(md.indexOf('很久以前的任务') !== -1);
});

t('PDF 打印页：和 Markdown 同一份口径，也不含任何板块', function () {
  var html = Pdf.buildPrintHtml(everythingData(), { dateStr: DATE });

  h.assertTrue(html.indexOf(QUAD_TEXT) !== -1);
  foreignTexts().forEach(function (text) {
    h.assertTrue(html.indexOf(text) === -1, '打印页里不该出现「' + text + '」');
  });
});

t('统计行照常在（日报自动统计这条没有被本需求动到）', function () {
  var data = everythingData();
  var md = Exporter.buildMarkdown(data, { dateStr: DATE });
  h.assertTrue(md.indexOf('✅ 已完成') !== -1);

  var html = Pdf.buildPrintHtml(data, { dateStr: DATE });
  h.assertTrue(html.indexOf('print__stats') !== -1);
});

t('某天四象限全空时照常写「（暂无任务）」，不因为多了几个板块就报错', function () {
  var data = everythingData();
  var md = Exporter.buildMarkdown(data, { dateStr: '2026-10-09' });
  h.assertTrue(md.indexOf('（暂无任务）') !== -1);
  foreignTexts().forEach(function (text) {
    h.assertTrue(md.indexOf(text) === -1);
  });
});

t('存档（不传 dateStr 的整份导出）仍然照旧：那是存档，不是日报', function () {
  // v2.6 需求 4：Markdown **日报**只记当天；不传 dateStr 是给 ZIP 里的存档用的。
  // 这条不因为需求 1 改口而变 —— 存档本来也只装象限，其余板块走 JSON。
  var md = Exporter.buildMarkdown(everythingData());
  h.assertTrue(md.indexOf(QUAD_TEXT) !== -1);
  foreignTexts().forEach(function (text) {
    h.assertTrue(md.indexOf(text) === -1);
  });
});

// ---------------------------------------------------------------------------
h.group('源码侧：两个构建函数体里不出现别的板块');

/** 截出源码里某个函数的函数体（从 function 名到下一个顶格缩进的 }） */
function bodyOf(src, name) {
  var start = src.indexOf('function ' + name + '(');
  if (start === -1) return '';
  var end = src.indexOf('\n  }', start);
  return src.slice(start, end === -1 ? src.length : end);
}

t('buildMarkdown 的函数体里没有 pool / templates / reading / principles / skills / files', function () {
  var body = bodyOf(exporterSrc, 'buildMarkdown');
  h.assertTrue(body.length > 0, '找不到 buildMarkdown');
  h.assertTrue(body.indexOf('Store.getDayTasks') !== -1, '它读的是「那一天」');

  ['pool', 'templates', 'reading', 'principles', 'skills', 'files'].forEach(function (name) {
    h.assertTrue(body.indexOf(name) === -1,
      'buildMarkdown 里出现了 ' + name + ' —— 日报只该画象限（需求 1）');
  });
});

t('buildPrintHtml 同理', function () {
  var body = bodyOf(pdfSrc, 'buildPrintHtml');
  h.assertTrue(body.length > 0, '找不到 buildPrintHtml');

  ['pool', 'templates', 'reading', 'principles', 'skills', 'files'].forEach(function (name) {
    h.assertTrue(body.indexOf(name) === -1,
      'buildPrintHtml 里出现了 ' + name + ' —— 日报只该画象限（需求 1）');
  });
});

t('两个函数都只遍历 CONFIG.QUADRANTS（象限是唯一的循环来源）', function () {
  h.assertTrue(bodyOf(exporterSrc, 'buildMarkdown').indexOf('CONFIG.QUADRANTS') !== -1);
  h.assertTrue(bodyOf(pdfSrc, 'buildPrintHtml').indexOf('CONFIG.QUADRANTS') !== -1);
});

t('两份清单（技能 / 已读）是**导出物**，没有被塞进日报', function () {
  var md = bodyOf(exporterSrc, 'buildMarkdown');
  h.assertTrue(md.indexOf('buildSkillsList') === -1);
  h.assertTrue(md.indexOf('buildReadingList') === -1);

  var print = bodyOf(pdfSrc, 'buildPrintHtml');
  h.assertTrue(print.indexOf('buildSkillsList') === -1);
  h.assertTrue(print.indexOf('buildReadingList') === -1);
});

t('PDF 的打印样式里没有为别的板块准备的东西（只认 print__quad 那一套）', function () {
  var printRule = pdfSrc.slice(pdfSrc.indexOf('for (var q = 0'));
  h.assertTrue(printRule.indexOf('print__quad') !== -1);
  h.assertTrue(pdfSrc.indexOf('Store.listDates') !== -1);
});

// ---------------------------------------------------------------------------

h.summary('日报只含象限内容（v2.12 需求 1）');
