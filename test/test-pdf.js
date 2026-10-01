/**
 * test-pdf.js
 *
 * 检查打印用 HTML 的生成（见 DS 3.2、4.4）。
 *
 * 重点还是**转义**，而且这里比别处更要紧：这段 HTML 会被塞进页面、
 * 然后进入打印流程。任务文本里一条 `<img src=x onerror=...>`，不挡住的话
 * 会在打印那一刻变成真的标签跑起来。
 *
 * 调 window.print() 那部分测不了（得真有打印机对话框），只能手工点。
 *
 * 跑法：node test/test-pdf.js
 */
'use strict';

var h = require('./harness');
var Store = require('../js/store');
var TaskOps = require('../js/task-ops');
var Pdf = require('../js/pdf');

var t = h.test;

function build(spec) {
  var data = Store.createEmpty();
  var keys = Object.keys(spec || {});
  for (var i = 0; i < keys.length; i++) {
    var parts = keys[i].split('|');   // '2026-10-01|I'
    var texts = spec[keys[i]];
    for (var k = 0; k < texts.length; k++) {
      var item = texts[k];
      var looksLikeTask = item !== null && typeof item === 'object';
      var r = TaskOps.addTask(data, parts[0], parts[1], looksLikeTask ? item.text : item);
      if (looksLikeTask && item.completed === true) {
        TaskOps.toggleTask(data, parts[0], parts[1], r.task.id, true);
      }
    }
  }
  return data;
}

// ---------------------------------------------------------------------------
h.group('整体结构');

t('有标题', function () {
  h.assertTrue(Pdf.buildPrintHtml(Store.createEmpty()).indexOf('四象限任务') !== -1);
});

t('一天一段，四个象限齐全', function () {
  var html = Pdf.buildPrintHtml(build({ '2026-10-01|I': ['甲'] }));

  h.assertTrue(html.indexOf('2026-10-01') !== -1);
  h.assertEqual((html.match(/print__quad"/g) || []).length, 4, '四个象限都要有');
});

t('象限顺序是 I II III IV', function () {
  var html = Pdf.buildPrintHtml(build({ '2026-10-01|I': ['甲'] }));
  var p1 = html.indexOf('data-quadrant="I"');
  var p2 = html.indexOf('data-quadrant="II"');
  var p3 = html.indexOf('data-quadrant="III"');
  var p4 = html.indexOf('data-quadrant="IV"');
  h.assertTrue(p1 < p2 && p2 < p3 && p3 < p4);
});

t('多天按日期升序', function () {
  var html = Pdf.buildPrintHtml(build({
    '2026-10-03|I': ['丙'], '2026-10-01|I': ['甲'], '2026-10-02|I': ['乙']
  }));
  h.assertTrue(html.indexOf('2026-10-01') < html.indexOf('2026-10-02'));
  h.assertTrue(html.indexOf('2026-10-02') < html.indexOf('2026-10-03'));
});

t('空数据给一句人话', function () {
  h.assertTrue(Pdf.buildPrintHtml(Store.createEmpty()).indexOf('还没有任何数据') !== -1);
});

t('空象限写「暂无任务」', function () {
  h.assertTrue(Pdf.buildPrintHtml(build({ '2026-10-01|I': ['甲'] })).indexOf('（暂无任务）') !== -1);
});

t('只导一天时别的日期不出现', function () {
  var data = build({ '2026-10-01|I': ['甲'], '2026-10-02|I': ['乙'] });
  var html = Pdf.buildPrintHtml(data, { dateStr: '2026-10-01' });

  h.assertTrue(html.indexOf('2026-10-01') !== -1);
  h.assertFalse(html.indexOf('2026-10-02') !== -1);
  h.assertFalse(html.indexOf('乙') !== -1);
});

// ---------------------------------------------------------------------------
h.group('任务条目');

t('未完成的用空方框', function () {
  var html = Pdf.buildPrintHtml(build({ '2026-10-01|I': ['写报告'] }));
  h.assertTrue(html.indexOf('☐') !== -1);
  h.assertTrue(html.indexOf('写报告') !== -1);
});

t('完成的用打勾的方框，并且带 --done 类', function () {
  var html = Pdf.buildPrintHtml(build({
    '2026-10-01|I': [{ text: '回邮件', completed: true }]
  }));
  h.assertTrue(html.indexOf('☑') !== -1);
  h.assertTrue(html.indexOf('print__task--done') !== -1);
});

t('顺序和页面上一致', function () {
  var html = Pdf.buildPrintHtml(build({ '2026-10-01|I': ['甲', '乙', '丙'] }));
  h.assertTrue(html.indexOf('甲') < html.indexOf('乙'));
  h.assertTrue(html.indexOf('乙') < html.indexOf('丙'));
});

// ---------------------------------------------------------------------------
h.group('转义（打印这条路最要紧的一组）');

t('尖括号被转义', function () {
  var html = Pdf.buildPrintHtml(build({
    '2026-10-01|I': ['<img src=x onerror=alert(1)>']
  }));
  h.assertFalse(html.indexOf('<img') !== -1, '原始标签不能出现');
  h.assertTrue(html.indexOf('&lt;img') !== -1, '必须转义');
});

t('script 标签被转义', function () {
  var html = Pdf.buildPrintHtml(build({
    '2026-10-01|I': ['<script>alert(1)</script>']
  }));
  h.assertFalse(html.indexOf('<script>') !== -1);
  h.assertTrue(html.indexOf('&lt;script&gt;') !== -1);
});

t('引号也转义（防止打断属性）', function () {
  var html = Pdf.buildPrintHtml(build({ '2026-10-01|I': ['他说"你好"'] }));
  h.assertTrue(html.indexOf('&quot;') !== -1);
});

t('& 转义，而且不会转成 &amp;lt;', function () {
  var html = Pdf.buildPrintHtml(build({ '2026-10-01|I': ['A & B'] }));
  h.assertTrue(html.indexOf('A &amp; B') !== -1);

  var html2 = Pdf.buildPrintHtml(build({ '2026-10-01|I': ['&lt;'] }));
  h.assertTrue(html2.indexOf('&amp;lt;') !== -1);
});

t('普通中文和标点原样保留', function () {
  var html = Pdf.buildPrintHtml(build({ '2026-10-01|I': ['写季度报告，顺便回邮件。'] }));
  h.assertTrue(html.indexOf('写季度报告，顺便回邮件。') !== -1);
});

t('危险内容被完整转义成文本，不会变成标签', function () {
  // ⚠️ 这里不能去查「输出里有没有 javascript: / onload= 这些子串」——
  // 转义之后它们**作为纯文本当然还在**（`&lt;iframe src=javascript:...&gt;`），
  // 但那已经无害了。查子串是在量错东西。
  //
  // 真正该确认的是：**起关键作用的尖括号被转义掉了**。
  // 只要 `<` 和 `>` 都变成了 `&lt;` `&gt;`，里面的内容就永远跑不出文本区。
  var html = Pdf.buildPrintHtml(build({
    '2026-10-01|I': ['<svg onload=alert(1)>', '<iframe src=javascript:alert(1)>']
  }));

  h.assertFalse(html.indexOf('<svg') !== -1, '不能出现真的 <svg');
  h.assertFalse(html.indexOf('<iframe') !== -1, '不能出现真的 <iframe');

  h.assertTrue(html.indexOf('&lt;svg onload=alert(1)&gt;') !== -1,
    '整段（含结尾的 >）都要被转义 —— 收尾的 > 漏了的话，前面的 &lt; 就白转了');
  h.assertTrue(html.indexOf('&lt;iframe src=javascript:alert(1)&gt;') !== -1);
});

t('每一处用户文本都被转义了，一个漏网的都没有', function () {
  // 把某个象限的输入文本原样找出来核对：生成结果里**不该有裸露的 <**
  var nasty = '<b>加粗</b>';
  var html = Pdf.buildPrintHtml(build({ '2026-10-01|I': [nasty] }));

  h.assertFalse(html.indexOf('<b>') !== -1, '任务文本里的标签不能原样出现');
  h.assertTrue(html.indexOf('&lt;b&gt;加粗&lt;/b&gt;') !== -1);
});

// ---------------------------------------------------------------------------
h.group('阶段');

function withStages() {
  var data = Store.createEmpty();
  var taskId = TaskOps.addTask(data, '2026-10-01', 'I', '写季度报告').task.id;
  var s1 = TaskOps.addStage(data, '2026-10-01', 'I', taskId, '收集数据').stage.id;
  TaskOps.addStage(data, '2026-10-01', 'I', taskId, '写初稿');
  TaskOps.toggleStage(data, '2026-10-01', 'I', taskId, s1, true);
  return data;
}

t('阶段缩进印在任务下面', function () {
  var html = Pdf.buildPrintHtml(withStages());
  h.assertTrue(html.indexOf('print__stages') !== -1, '要有阶段那一层列表');
  h.assertTrue(html.indexOf('收集数据') !== -1);
  h.assertTrue(html.indexOf('写初稿') !== -1);
});

t('完成的阶段带 --done（打印时会划掉）', function () {
  var html = Pdf.buildPrintHtml(withStages());
  h.assertTrue(html.indexOf('print__stage--done') !== -1);
});

t('阶段排在任务后面', function () {
  var html = Pdf.buildPrintHtml(withStages());
  h.assertTrue(html.indexOf('写季度报告') < html.indexOf('收集数据'));
});

t('阶段文本也要转义 —— 这段 HTML 是要进页面的', function () {
  var data = Store.createEmpty();
  var taskId = TaskOps.addTask(data, '2026-10-01', 'I', '任务').task.id;
  TaskOps.addStage(data, '2026-10-01', 'I', taskId, '<img src=x onerror=alert(1)>');

  var html = Pdf.buildPrintHtml(data);
  h.assertFalse(html.indexOf('<img') !== -1);
  h.assertTrue(html.indexOf('&lt;img') !== -1);
});

t('没阶段的任务不会多出一层空列表', function () {
  var data = Store.createEmpty();
  TaskOps.addTask(data, '2026-10-01', 'I', '回邮件');

  h.assertFalse(Pdf.buildPrintHtml(data).indexOf('print__stages') !== -1);
});

// ---------------------------------------------------------------------------
h.group('和页面数据一致');

t('改完之后立刻打印，内容跟着变', function () {
  var data = build({ '2026-10-01|I': ['原来的'] });
  var id = Store.getDayTasks(data, '2026-10-01').I[0].id;
  TaskOps.editTask(data, '2026-10-01', 'I', id, '改过的');

  var html = Pdf.buildPrintHtml(data);
  h.assertTrue(html.indexOf('改过的') !== -1);
  h.assertFalse(html.indexOf('原来的') !== -1);
});

t('删掉的任务不会出现在打印内容里', function () {
  var data = build({ '2026-10-01|I': ['要删的', '留着的'] });
  var id = Store.getDayTasks(data, '2026-10-01').I[0].id;
  TaskOps.removeTask(data, '2026-10-01', 'I', id);

  var html = Pdf.buildPrintHtml(data);
  h.assertFalse(html.indexOf('要删的') !== -1);
  h.assertTrue(html.indexOf('留着的') !== -1);
});

// ---------------------------------------------------------------------------
h.group('和环境判断');

t('Node 里不算安卓 App', function () {
  h.assertFalse(Pdf.isNativeApp());
});

t('Node 里打印不可用（没有 window）', function () {
  // 这条保证：万一在不能打印的环境里调用了，也不会抛错，而是安静地返回 false，
  // 由 app.js 走「退一步给 Markdown」那条路（见 DS 4.2）
  h.assertFalse(Pdf.isAvailable());
});

t('退路给出来的 Markdown 和导出的是同一份', function () {
  var Exporter = require('../js/exporter');
  var data = build({ '2026-10-01|I': ['写报告'] });

  h.assertEqual(Pdf.fallbackMarkdown(data), Exporter.buildMarkdown(data),
    '两种格式必须共用同一份内容（见 D-04）');
});

// ---------------------------------------------------------------------------
h.group('任务块（v1.1，见 DS 2.10）');

/** 造一份「一个块 + 块内两条任务」的数据 */
function pdfWithBlock() {
  var data = Store.createEmpty();
  var block = TaskOps.addBlock(data, '2026-10-01', 'I', '晨间例程').block;
  block.tasks.push({ id: 'c1', text: '喝水', completed: true, createdAt: 1 });
  block.tasks.push({ id: 'c2', text: '锻炼', completed: false, createdAt: 1 });
  return { data: data, block: block };
}

t('块名加粗印成一行，块内任务嵌套缩进', function () {
  var html = Pdf.buildPrintHtml(pdfWithBlock().data);
  h.assertTrue(html.indexOf('<strong class="print__block-name">晨间例程</strong>') !== -1);
  h.assertTrue(html.indexOf('<ul class="print__stages">') !== -1, '块内任务要有嵌套列表');
  h.assertTrue(html.indexOf('喝水') !== -1);
  h.assertTrue(html.indexOf('锻炼') !== -1);
});

t('块名转义：打印那一刻也不能让标签活过来', function () {
  var data = Store.createEmpty();
  var block = TaskOps.addBlock(data, '2026-10-01', 'I', '块').block;
  block.text = '<img src=x onerror=alert(1)>';

  var html = Pdf.buildPrintHtml(data);
  h.assertFalse(html.indexOf('<img src=x') !== -1, '原始标签不该出现');
  h.assertTrue(html.indexOf('&lt;img src=x') !== -1);
});

t('完成的块：☑ 和删除线类都跟上', function () {
  var withBlock = pdfWithBlock();
  TaskOps.toggleBlock(withBlock.data, '2026-10-01', 'I', withBlock.block.id, true);

  var html = Pdf.buildPrintHtml(withBlock.data);
  h.assertTrue(html.indexOf('print__task--done') !== -1);
  h.assertTrue(html.indexOf('☑') !== -1);
});

t('空块：不印嵌套列表', function () {
  var data = Store.createEmpty();
  TaskOps.addBlock(data, '2026-10-01', 'I', '空块');

  var html = Pdf.buildPrintHtml(data);
  h.assertTrue(html.indexOf('<strong class="print__block-name">空块</strong>') !== -1);
  h.assertEqual(html.indexOf('print__stages'), -1, '没有内容就别印空列表');
});

// ---------------------------------------------------------------------------

h.summary('pdf.js 打印内容生成');
