/**
 * test-export-md.js
 *
 * 检查生成的 Markdown 内容对不对、任务里的特殊符号会不会出问题（见 DS 3.2）。
 *
 * 「特殊符号」这条不是为了排版好看 —— Markdown 会被渲染成网页来打印 PDF，
 * 所以任务文本里如果写着 `<img onerror=...>`，不挡的话它会在打印那一刻变成
 * 真的标签执行起来。
 *
 * 跑法：node test/test-export-md.js
 */
'use strict';

var h = require('./harness');
var Store = require('../js/store');
var TaskOps = require('../js/task-ops');
var Exporter = require('../js/exporter');

var t = h.test;

function build(spec) {
  var data = Store.createEmpty();
  var keys = Object.keys(spec || {});
  for (var i = 0; i < keys.length; i++) {
    var parts = keys[i].split('|');   // '2026-10-01|I'
    var texts = spec[keys[i]];
    // addTask 默认把新任务加在开头（需求 3），倒着加才能让最终顺序和 spec 一致
    for (var k = texts.length - 1; k >= 0; k--) {
      var item = texts[k];
      // 注意变量名：这里是个**布尔值**，不是那个对象本身。
      // 起名 isObj 然后写 isObj.completed，拿到的是 undefined（true.completed），
      // 条件永远是假 —— 犯了这么一次，所以才特意写清楚。
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
  h.assertTrue(Exporter.buildMarkdown(Store.createEmpty()).indexOf('# MyPal') !== -1);
});

t('一天一个二级标题', function () {
  var md = Exporter.buildMarkdown(build({
    '2026-10-01|I': ['甲'],
    '2026-10-02|I': ['乙']
  }));
  h.assertTrue(md.indexOf('## 2026-10-01') !== -1);
  h.assertTrue(md.indexOf('## 2026-10-02') !== -1);
});

t('四个象限各有一个三级标题，顺序是 I II III IV', function () {
  var md = Exporter.buildMarkdown(build({ '2026-10-01|I': ['甲'] }));
  var p1 = md.indexOf('### I ');
  var p2 = md.indexOf('### II ');
  var p3 = md.indexOf('### III ');
  var p4 = md.indexOf('### IV ');

  h.assertTrue(p1 !== -1 && p2 !== -1 && p3 !== -1 && p4 !== -1, '四个都要有');
  h.assertTrue(p1 < p2 && p2 < p3 && p3 < p4, '顺序要对');
});

t('日期按时间升序排', function () {
  var md = Exporter.buildMarkdown(build({
    '2026-10-03|I': ['丙'],
    '2026-10-01|I': ['甲'],
    '2026-10-02|I': ['乙']
  }));
  var a = md.indexOf('## 2026-10-01');
  var b = md.indexOf('## 2026-10-02');
  var c = md.indexOf('## 2026-10-03');
  h.assertTrue(a < b && b < c);
});

t('空数据也给一句人话，而不是一个空文件', function () {
  h.assertTrue(Exporter.buildMarkdown(Store.createEmpty()).indexOf('还没有任何数据') !== -1);
});

t('空的象限写「暂无任务」', function () {
  var md = Exporter.buildMarkdown(build({ '2026-10-01|I': ['甲'] }));
  h.assertTrue(md.indexOf('（暂无任务）') !== -1);
});

// ---------------------------------------------------------------------------
h.group('任务条目');

t('未完成的写成空方框', function () {
  var md = Exporter.buildMarkdown(build({ '2026-10-01|I': ['写报告'] }));
  h.assertTrue(md.indexOf('- [ ] 写报告') !== -1);
});

t('完成的写成打了勾的方框', function () {
  var md = Exporter.buildMarkdown(build({
    '2026-10-01|I': [{ text: '回邮件', completed: true }]
  }));
  h.assertTrue(md.indexOf('- [x] 回邮件') !== -1);
});

t('任务的先后顺序就是 Markdown 里的顺序', function () {
  var md = Exporter.buildMarkdown(build({ '2026-10-01|I': ['甲', '乙', '丙'] }));
  h.assertTrue(md.indexOf('甲') < md.indexOf('乙'));
  h.assertTrue(md.indexOf('乙') < md.indexOf('丙'));
});

t('单选一天时，别的日期不出现', function () {
  var data = build({ '2026-10-01|I': ['甲'], '2026-10-02|I': ['乙'] });
  var md = Exporter.buildMarkdown(data, { dateStr: '2026-10-01' });

  h.assertTrue(md.indexOf('2026-10-01') !== -1);
  h.assertFalse(md.indexOf('2026-10-02') !== -1, '只要一天的时候不该混进别的日期');
  h.assertFalse(md.indexOf('乙') !== -1);
});

// ---------------------------------------------------------------------------
h.group('特殊符号（这一组是为了安全，不是为了好看）');

t('尖括号被转义 —— 否则打印时会变成真的标签', function () {
  var md = Exporter.buildMarkdown(build({
    '2026-10-01|I': ['<img src=x onerror=alert(1)>']
  }));

  h.assertFalse(md.indexOf('<img') !== -1, '原始标签不能出现在结果里');
  h.assertTrue(md.indexOf('&lt;img') !== -1, '必须转义');
});

t('script 标签也一样', function () {
  var md = Exporter.buildMarkdown(build({
    '2026-10-01|I': ['<script>alert(1)</script>']
  }));
  h.assertFalse(md.indexOf('<script>') !== -1);
  h.assertTrue(md.indexOf('&lt;script&gt;') !== -1);
});

t('& 被转义', function () {
  var md = Exporter.buildMarkdown(build({ '2026-10-01|I': ['A & B'] }));
  h.assertTrue(md.indexOf('A &amp; B') !== -1);
});

t('转义之后在 Markdown 里看回来还是原来的字', function () {
  // 转义不是「改内容」，是把 `<` 换成它等价的写法。
  // 渲染出来给用户看的时候，还是 `<`
  var md = Exporter.buildMarkdown(build({ '2026-10-01|I': ['a < b'] }));
  h.assertTrue(md.indexOf('- [ ] a &lt; b') !== -1);
});

t('普通中文和标点一点不动', function () {
  var md = Exporter.buildMarkdown(build({
    '2026-10-01|I': ['写季度报告，顺便回一下邮件。']
  }));
  h.assertTrue(md.indexOf('写季度报告，顺便回一下邮件。') !== -1);
});

t('引号、星号、井号这些 Markdown 记号不会被转义', function () {
  // 只挡 < > & 三个。把引号星号也转掉的话，用户看到的就是一堆 &#39;，
  // 那才是真的毁了内容
  var md = Exporter.buildMarkdown(build({ '2026-10-01|I': ['他说"你好" *重要*'] }));
  h.assertTrue(md.indexOf('他说"你好" *重要*') !== -1);
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

t('阶段缩进一层写在任务下面', function () {
  var md = Exporter.buildMarkdown(withStages());
  h.assertTrue(md.indexOf('- [ ] 写季度报告') !== -1);
  h.assertTrue(md.indexOf('  - [x] 收集数据') !== -1, '阶段要缩进两格');
  h.assertTrue(md.indexOf('  - [ ] 写初稿') !== -1);
});

t('阶段排在任务后面', function () {
  var md = Exporter.buildMarkdown(withStages());
  h.assertTrue(md.indexOf('写季度报告') < md.indexOf('收集数据'));
  h.assertTrue(md.indexOf('收集数据') < md.indexOf('写初稿'));
});

t('阶段文本也要转义', function () {
  var data = Store.createEmpty();
  var taskId = TaskOps.addTask(data, '2026-10-01', 'I', '任务').task.id;
  TaskOps.addStage(data, '2026-10-01', 'I', taskId, '<script>alert(1)</script>');

  var md = Exporter.buildMarkdown(data);
  h.assertFalse(md.indexOf('<script>') !== -1);
  h.assertTrue(md.indexOf('&lt;script&gt;') !== -1);
});

t('没阶段的任务照常只有一行，下面不会多出空行', function () {
  var data = Store.createEmpty();
  TaskOps.addTask(data, '2026-10-01', 'I', '回邮件');

  var md = Exporter.buildMarkdown(data);
  var lines = md.split('\n').filter(function (l) { return l.indexOf('回邮件') !== -1; });
  h.assertEqual(lines.length, 1);
  h.assertEqual(lines[0], '- [ ] 回邮件');
});

// ---------------------------------------------------------------------------
h.group('和页面上的数据一致');

t('改完之后立刻导出，内容跟着变', function () {
  var data = build({ '2026-10-01|I': ['原来的'] });
  var id = Store.getDayTasks(data, '2026-10-01').I[0].id;

  TaskOps.editTask(data, '2026-10-01', 'I', id, '改过的');

  var md = Exporter.buildMarkdown(data);
  h.assertTrue(md.indexOf('改过的') !== -1);
  h.assertFalse(md.indexOf('原来的') !== -1);
});

t('删掉的任务不会出现在 Markdown 里', function () {
  var data = build({ '2026-10-01|I': ['要删的', '留着的'] });
  var id = Store.getDayTasks(data, '2026-10-01').I[0].id;
  TaskOps.removeTask(data, '2026-10-01', 'I', id);

  var md = Exporter.buildMarkdown(data);
  h.assertFalse(md.indexOf('要删的') !== -1);
  h.assertTrue(md.indexOf('留着的') !== -1);
});

// ---------------------------------------------------------------------------
h.group('UTF-8 编码（中文不能变成乱码）');

t('中文编码成 3 个字节', function () {
  // '中' 的 UTF-8 是 E4 B8 AD
  var bytes = Exporter.utf8Bytes('中');
  h.assertEqual(bytes.length, 3);
  h.assertEqual(bytes[0], 0xE4);
  h.assertEqual(bytes[1], 0xB8);
  h.assertEqual(bytes[2], 0xAD);
});

t('ASCII 还是 1 个字节', function () {
  h.assertEqual(Exporter.utf8Bytes('abc').length, 3);
});

t('emoji（4 字节）也能编码', function () {
  var bytes = Exporter.utf8Bytes('😀');
  h.assertEqual(bytes.length, 4, 'emoji 是 4 字节，按 UTF-8 长度算对了才说明代理对处理对了');
});

t('空字符串', function () {
  h.assertEqual(Exporter.utf8Bytes('').length, 0);
});

// ---------------------------------------------------------------------------
h.group('任务块（v1.1，见 DS 2.10）');

/** 造一份「一个块 + 块内两条任务（其中一条带阶段）」的数据 */
function mdWithBlock() {
  var data = Store.createEmpty();
  var block = TaskOps.addBlock(data, '2026-10-01', 'I', '晨间例程').block;
  block.tasks.push({ id: 'c1', text: '喝水', completed: true, createdAt: 1 });
  block.tasks.push({
    id: 'c2', text: '锻炼', completed: false, createdAt: 1,
    stages: [{ id: 's1', text: '热身', completed: true, createdAt: 1 }]
  });
  return { data: data, block: block };
}

t('块名加粗成一行，带勾选框', function () {
  var md = Exporter.buildMarkdown(mdWithBlock().data);
  h.assertTrue(md.indexOf('- [ ] **晨间例程**') !== -1, '块名要加粗：' + md);
});

t('块内任务缩进一层', function () {
  var md = Exporter.buildMarkdown(mdWithBlock().data);
  h.assertTrue(md.indexOf('  - [x] 喝水') !== -1);
  h.assertTrue(md.indexOf('  - [ ] 锻炼') !== -1);
});

t('块内任务的阶段再缩一层（共三级）', function () {
  var md = Exporter.buildMarkdown(mdWithBlock().data);
  h.assertTrue(md.indexOf('    - [x] 热身') !== -1);
});

t('块全完成 → 勾选框打叉', function () {
  var withBlock = mdWithBlock();
  TaskOps.toggleBlock(withBlock.data, '2026-10-01', 'I', withBlock.block.id, true);
  var md = Exporter.buildMarkdown(withBlock.data);
  h.assertTrue(md.indexOf('- [x] **晨间例程**') !== -1);
});

t('块名里的特殊符号照常转义', function () {
  var data = Store.createEmpty();
  var block = TaskOps.addBlock(data, '2026-10-01', 'I', '<b>名</b>').block;
  block.tasks.push({ id: 'c1', text: '<i>甲</i>', completed: false, createdAt: 1 });

  var md = Exporter.buildMarkdown(data);
  h.assertTrue(md.indexOf('**&lt;b&gt;名&lt;/b&gt;**') !== -1);
  h.assertTrue(md.indexOf('  - [ ] &lt;i&gt;甲&lt;/i&gt;') !== -1);
});

// ---------------------------------------------------------------------------
h.group('日报只记当天（v2.6 需求 4）');

t('传 dateStr 时只导出那一天，别的日期整段不出现', function () {
  var md = Exporter.buildMarkdown(build({
    '2026-10-01|I': ['甲'],
    '2026-10-02|I': ['乙'],
    '2026-10-03|I': ['丙']
  }), { dateStr: '2026-10-02' });

  h.assertTrue(md.indexOf('## 2026-10-02') !== -1, '要包含选中的那天');
  h.assertTrue(md.indexOf('## 2026-10-01') === -1, '别把前一天也带上');
  h.assertTrue(md.indexOf('## 2026-10-03') === -1, '别把后一天也带上');
  h.assertTrue(md.indexOf('乙') !== -1);
  h.assertTrue(md.indexOf('甲') === -1);
  h.assertTrue(md.indexOf('丙') === -1);
});

t('那一天的统计行照常在', function () {
  var md = Exporter.buildMarkdown(build({ '2026-10-01|I': ['甲'] }),
    { dateStr: '2026-10-01' });
  h.assertTrue(md.indexOf('> ✅ 已完成 0 / 总数 1') !== -1, '当日统计行不该少：' + md);
});

t('不传 dateStr 时保持老行为：全部日期都导', function () {
  var md = Exporter.buildMarkdown(build({
    '2026-10-01|I': ['甲'],
    '2026-10-02|I': ['乙']
  }));
  h.assertTrue(md.indexOf('## 2026-10-01') !== -1);
  h.assertTrue(md.indexOf('## 2026-10-02') !== -1);
});

t('那一天没有数据 → 四个象限显示「暂无任务」，不报错', function () {
  var md = Exporter.buildMarkdown(build({ '2026-10-01|I': ['甲'] }),
    { dateStr: '2026-11-11' });
  h.assertTrue(md.indexOf('## 2026-11-11') !== -1);
  h.assertEqual((md.match(/（暂无任务）/g) || []).length, 4, '四个象限各一句占位');
  h.assertTrue(md.indexOf('甲') === -1);
});

t('dateStr 为空串 / null 时按「没指定」处理（不是导一天空的）', function () {
  var data = build({ '2026-10-01|I': ['甲'], '2026-10-02|I': ['乙'] });
  h.assertTrue(Exporter.buildMarkdown(data, { dateStr: '' }).indexOf('## 2026-10-02') !== -1);
  h.assertTrue(Exporter.buildMarkdown(data, { dateStr: null }).indexOf('## 2026-10-02') !== -1);
});

// ---------------------------------------------------------------------------

h.summary('exporter.js 的 Markdown 生成');
