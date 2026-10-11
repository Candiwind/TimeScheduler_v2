/**
 * test-files.js
 *
 * v2.12 需求 2（见 DS 2.50 / D-80 / D-86）：「我存的一些小文件（提示总共不能
 * 超过 1M 空间或 10 个文件），允许像任务信息一样被导入和导出，只支持 txt 格式」。
 *
 * 覆盖：数据层增删改查（空正文合法 / 空名字拒绝 / 改名 / 换正文 / 删）；
 * `getFilesStats` 的条数与 **UTF-8 字节**（中文按 3 字节算）与两条软线；
 * 渲染（头部用量、超限标红、行、空态、转义）；`Util.safeFileName` /
 * `isTxtFileName` / `utf8ByteLength`；导出文件名（补 .txt）；
 * JSON 往返 + 老文件（没有 files 字段）导入不受影响。
 *
 * 跑法：node test/test-files.js
 */
'use strict';

var h = require('./harness');
var fs = require('fs');
var path = require('path');
var CONFIG = require('../js/config');
var Util = require('../js/util');
var Store = require('../js/store');
var TaskOps = require('../js/task-ops');
var Render = require('../js/render');
var Exporter = require('../js/exporter');
var Importer = require('../js/importer');

var t = h.test;
var DATE = '2026-10-01';
var renderSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'render.js'), 'utf8');
var appSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');

/** 把一次导出的文件名拦下来 —— 工具见 harness.js 的 captureDownload */
var captureDownload = h.captureDownload;

// ---------------------------------------------------------------------------
h.group('Util：文件名收拾、.txt 判断、UTF-8 字节数');

t('safeFileName 去掉路径与非法字符', function () {
  h.assertEqual(Util.safeFileName('a/b\\c:d*e?f"g<h>i|j.txt'), 'abcdefghij.txt');
  h.assertEqual(Util.safeFileName('  笔记.txt  '), '笔记.txt');
});

t('safeFileName：全是非法字符 / 空 / 只点 → 兜底名', function () {
  h.assertEqual(Util.safeFileName('///', 'untitled'), 'untitled');
  h.assertEqual(Util.safeFileName('', 'file.txt'), 'file.txt');
  h.assertEqual(Util.safeFileName('...'), 'untitled', '首尾的点会被清掉');
});

t('safeFileName：超长截断到 80，不带扩展名也要能兜住', function () {
  var long = new Array(200).join('あ');
  h.assertTrue(Util.safeFileName(long).length <= 80);
});

t('isTxtFileName：大小写不敏感、认前后空白、别的后缀拒绝', function () {
  h.assertTrue(Util.isTxtFileName('备忘.txt'));
  h.assertTrue(Util.isTxtFileName('NOTE.TXT'));
  h.assertTrue(Util.isTxtFileName('  备忘.txt  '));
  h.assertFalse(Util.isTxtFileName('备忘.md'));
  h.assertFalse(Util.isTxtFileName('备忘'));
  h.assertFalse(Util.isTxtFileName('txt'));
});

t('utf8ByteLength：ASCII 1 字节、中文 3 字节、emoji 4 字节', function () {
  h.assertEqual(Util.utf8ByteLength('abc'), 3);
  h.assertEqual(Util.utf8ByteLength('中文'), 6);
  h.assertEqual(Util.utf8ByteLength('😀'), 4);
  h.assertEqual(Util.utf8ByteLength('a中😀'), 8);
  h.assertEqual(Util.utf8ByteLength(''), 0);
  h.assertEqual(Util.utf8ByteLength(null), 0);
});

// ---------------------------------------------------------------------------
h.group('数据层：增删改查');

t('addFile：名字去空白、正文原样（空正文合法）', function () {
  var data = Store.createEmpty();
  var r = TaskOps.addFile(data, '  备忘.txt  ', '');
  h.assertTrue(r.ok);
  h.assertEqual(r.file.name, '备忘.txt');
  h.assertEqual(r.file.text, '');
  h.assertEqual(data.files.length, 1);
  h.assertTrue(!!r.file.id && typeof r.file.createdAt === 'number');
});

t('addFile：名字为空 / 全是空白 → EMPTY_TEXT', function () {
  var data = Store.createEmpty();
  h.assertEqual(TaskOps.addFile(data, '   ', 'x').error, TaskOps.ERR.EMPTY_TEXT);
  h.assertEqual(TaskOps.addFile(data, null, 'x').error, TaskOps.ERR.EMPTY_TEXT);
  h.assertEqual(data.files.length, 0);
});

t('renameFile：改名成功；空名拒绝且原名保留', function () {
  var data = Store.createEmpty();
  var f = TaskOps.addFile(data, 'a.txt', 'hi').file;

  h.assertTrue(TaskOps.renameFile(data, f.id, 'b.txt').ok);
  h.assertEqual(f.name, 'b.txt');

  h.assertEqual(TaskOps.renameFile(data, f.id, '  ').error, TaskOps.ERR.EMPTY_TEXT);
  h.assertEqual(f.name, 'b.txt', '改空了保留原名');
});

t('setFileText：换正文，**空串也接受**（空文件是合法文件）', function () {
  var data = Store.createEmpty();
  var f = TaskOps.addFile(data, 'a.txt', 'hi').file;

  TaskOps.setFileText(data, f.id, '多行\n正文');
  h.assertEqual(f.text, '多行\n正文');

  TaskOps.setFileText(data, f.id, '');
  h.assertEqual(f.text, '', '不能拿「内容不能为空」拦它');
});

t('removeFile / findFile / NOT_FOUND 三件套', function () {
  var data = Store.createEmpty();
  var f = TaskOps.addFile(data, 'a.txt', 'hi').file;
  h.assertTrue(!!TaskOps.findFile(data, f.id));

  h.assertTrue(TaskOps.removeFile(data, f.id).ok);
  h.assertEqual(data.files.length, 0);
  h.assertNull(TaskOps.findFile(data, f.id));

  h.assertEqual(TaskOps.renameFile(data, 'no-such', 'x').error, TaskOps.ERR.NOT_FOUND);
  h.assertEqual(TaskOps.setFileText(data, 'no-such', 'x').error, TaskOps.ERR.NOT_FOUND);
  h.assertEqual(TaskOps.removeFile(data, 'no-such').error, TaskOps.ERR.NOT_FOUND);
});

t('同名文件允许存两份（不判重 —— 需求没要求，D-09 那条只针对任务 / 池 / 阅读栏）', function () {
  var data = Store.createEmpty();
  TaskOps.addFile(data, '同名.txt', 'A');
  TaskOps.addFile(data, '同名.txt', 'B');
  h.assertEqual(data.files.length, 2);
});

// ---------------------------------------------------------------------------
h.group('用量统计（软提示的两条判据）');

t('count 与 bytes（名字 + 正文，按 UTF-8 算）', function () {
  var data = Store.createEmpty();
  TaskOps.addFile(data, 'a.txt', '中文');   // 5 + 6 = 11
  TaskOps.addFile(data, 'b.txt', '');       // 5 + 0 = 5

  var s = TaskOps.getFilesStats(data);
  h.assertEqual(s.count, 2);
  h.assertEqual(s.bytes, 16);
  h.assertEqual(s.maxCount, CONFIG.FILES_MAX_COUNT);
  h.assertEqual(s.maxBytes, CONFIG.FILES_MAX_BYTES);
  h.assertFalse(s.over);
});

t('超过 10 个 → overCount，但**照样存得下**（软提示不是硬闸）', function () {
  var data = Store.createEmpty();
  for (var i = 0; i < 11; i++) TaskOps.addFile(data, 'f' + i + '.txt', '');

  var s = TaskOps.getFilesStats(data);
  h.assertEqual(s.count, 11, '第 11 个确实存进去了');
  h.assertTrue(s.overCount);
  h.assertTrue(s.over);
});

t('超过 1MB → overBytes（中文按 3 字节算，别用 String.length 糊弄）', function () {
  var data = Store.createEmpty();
  TaskOps.addFile(data, 'big.txt', new Array(Math.ceil(CONFIG.FILES_MAX_BYTES / 3) + 10)
    .join('中'));

  var s = TaskOps.getFilesStats(data);
  h.assertTrue(s.bytes > CONFIG.FILES_MAX_BYTES);
  h.assertTrue(s.overBytes);
  h.assertTrue(s.over);
});

t('空表 → 0 个 0 字节、不超限', function () {
  var s = TaskOps.getFilesStats(Store.createEmpty());
  h.assertEqual(s.count, 0);
  h.assertEqual(s.bytes, 0);
  h.assertFalse(s.over);
});

// ---------------------------------------------------------------------------
h.group('渲染：头部用量、行、空态、转义');

function buildFiles(list, view) {
  var data = Store.createEmpty();
  data.files = list;
  var v = view || {};
  v.fileStats = TaskOps.getFilesStats(data);
  return Render.buildFilesHtml(data.files, v);
}

t('头部：名称 + 用量 n/10 + 导入 / ＋ + 收起三角', function () {
  var html = buildFiles([{ id: 'f1', name: 'a.txt', text: 'hi', createdAt: 1 }]);
  h.assertTrue(html.indexOf('小文件') !== -1);
  h.assertTrue(html.indexOf('files__usage') !== -1);
  h.assertTrue(html.indexOf('1/10 个文件') !== -1);
  h.assertTrue(html.indexOf('files__load') !== -1, '导入入口在');
  h.assertTrue(html.indexOf('files__add') !== -1);
  h.assertTrue(html.indexOf("panelToggleHtml('files'") === -1);   // 是渲染结果，不是源码
  h.assertTrue(html.indexOf('data-panel="files"') !== -1, '头上有收起三角');
});

t('超限时用量带 --over（只标红，不拦）', function () {
  var list = [];
  for (var i = 0; i < 11; i++) list.push({ id: 'f' + i, name: 'f' + i + '.txt', text: '', createdAt: 1 });
  var html = buildFiles(list);
  h.assertTrue(html.indexOf('files__usage--over') !== -1);
  h.assertTrue(html.indexOf('11/10 个文件') !== -1);
});

t('行：文件名（点它开编辑器）+ ✎改名 + 导出 + ×', function () {
  var html = buildFiles([{ id: 'f1', name: '备忘.txt', text: 'x', createdAt: 1 }]);
  h.assertTrue(html.indexOf('files__open') !== -1);
  h.assertTrue(html.indexOf('备忘.txt') !== -1);
  h.assertTrue(html.indexOf('files__rename') !== -1);
  h.assertTrue(html.indexOf('files__export') !== -1);
  h.assertTrue(html.indexOf('files__del') !== -1);
  h.assertTrue(html.indexOf('data-id="f1"') !== -1);
});

t('空态：一句引导，不画列表', function () {
  var html = buildFiles([]);
  h.assertTrue(html.indexOf('files__empty') !== -1);
  h.assertFalse(html.indexOf('files__list') !== -1);
});

t('新建态：列表里插一个名字输入框（默认名带 .txt）', function () {
  var html = buildFiles([], { editing: { mode: 'add-file' } });
  h.assertTrue(html.indexOf('files__name-input') !== -1);
  h.assertTrue(html.indexOf('value="新文件.txt"') !== -1);
});

t('改名态：整行收成输入框，值转义', function () {
  var html = buildFiles([{ id: 'f1', name: 'a<b>.txt', text: '', createdAt: 1 }],
    { editing: { mode: 'rename-file', fileId: 'f1' } });
  h.assertTrue(html.indexOf('files__name-input') !== -1);
  h.assertTrue(html.indexOf('a&lt;b&gt;.txt') !== -1, '名字要转义');
});

t('文件名的转义：尖括号不会变成真标签', function () {
  var html = buildFiles([{ id: 'f1', name: '<img src=x onerror=alert(1)>',
                           text: '', createdAt: 1 }]);
  h.assertFalse(html.indexOf('<img') !== -1);
  h.assertTrue(html.indexOf('&lt;img') !== -1);
});

// ---------------------------------------------------------------------------
h.group('导出 .txt：文件名补后缀、内容不走样');

t('导出：名字已经是 .txt 就用原名', function () {
  var name = captureDownload(function () {
    Exporter.exportTextFile('备忘.txt', '内容');
  });
  h.assertEqual(name, '备忘.txt');
});

t('导出：名字没有后缀 / 是别的后缀 → 补成 .txt', function () {
  h.assertEqual(captureDownload(function () {
    Exporter.exportTextFile('备忘', '内容');
  }), '备忘.txt');

  h.assertEqual(captureDownload(function () {
    Exporter.exportTextFile('备忘.md', '内容');
  }), '备忘.md.txt');
});

t('导出：名字全是非法字符 → 兜底 untitled.txt', function () {
  h.assertEqual(captureDownload(function () {
    Exporter.exportTextFile('///', 'x');
  }), 'untitled.txt');
});

t('导出：空正文也是合法导出（导出一个空 txt）', function () {
  var name = captureDownload(function () {
    Exporter.exportTextFile('空.txt', '');
  });
  h.assertEqual(name, '空.txt');
});

// ---------------------------------------------------------------------------
h.group('JSON 往返与兼容（老文件、覆盖导入）');

t('序列化 → 解析：文件一条不少、内容不变', function () {
  var data = Store.createEmpty();
  TaskOps.addFile(data, 'a.txt', '第一行\n第二行');
  TaskOps.addFile(data, 'b.txt', '');

  var back = Store.parse(Store.serialize(data)).data;
  h.assertEqual(back.files.length, 2);
  h.assertEqual(back.files[0].name, 'a.txt');
  h.assertEqual(back.files[0].text, '第一行\n第二行');
  h.assertEqual(back.files[1].text, '');
});

t('老文件（没有 files 字段）导入不受影响，本地文件一条不动', function () {
  var old = JSON.stringify({ user: 'default', schemaVersion: 1,
    dates: { '2026-10-01': { I: [], II: [], III: [], IV: [] } } });
  var checked = Importer.validate(old);
  h.assertTrue(checked.ok);
  h.assertNull(checked.data.files, '「文件里没有」= null，不是「有零个」');

  var local = Store.createEmpty();
  TaskOps.addFile(local, '本地.txt', '别动我');
  Importer.merge(local, checked.data);
  h.assertEqual(local.files.length, 1);
  h.assertEqual(local.files[0].name, '本地.txt');
});

t('导入：同名文件跳过（保留本地那份内容）', function () {
  var local = Store.createEmpty();
  TaskOps.addFile(local, 'a.txt', '本地内容');

  var incoming = Importer.validate(JSON.stringify({ user: 'default', schemaVersion: 1,
    dates: {}, files: [{ name: 'a.txt', text: '文件内容' },
                       { name: 'b.txt', text: '新文件' }] })).data;

  var r = Importer.merge(local, incoming);
  h.assertEqual(r.added, 1);
  h.assertEqual(r.skipped, 1);
  h.assertEqual(local.files.length, 2);
  h.assertEqual(local.files[0].text, '本地内容', '跳过的那条保留本地的');
  h.assertEqual(local.files[1].name, 'b.txt');
});

t('导入：坏形状整份拒绝（不是列表 / 没有文件名 / 内容是数字）', function () {
  h.assertFalse(Importer.validate('{"dates":{},"files":"x"}').ok);
  h.assertFalse(Importer.validate('{"dates":{},"files":[{"text":"没有名字"}]}').ok);
  h.assertFalse(Importer.validate('{"dates":{},"files":[{"name":"a.txt","text":123}]}').ok);
});

t('覆盖导入：文件也整体换掉', function () {
  var local = Store.createEmpty();
  TaskOps.addFile(local, '旧的.txt', 'x');

  var incoming = Importer.validate(JSON.stringify({ user: 'default', schemaVersion: 1,
    dates: {}, files: [{ name: '新的.txt', text: 'y' }] })).data;
  var r = Importer.overwrite(local, incoming);

  h.assertEqual(r.data.files.length, 1);
  h.assertEqual(r.data.files[0].name, '新的.txt');
});

t('Store 清洗：脏条目丢掉、空名丢掉、正文非字符串收成空串', function () {
  var raw = {
    dates: {},
    files: [
      { name: ' 好.txt ', text: 'ok' },
      { text: '   ' },                 // 没名字 → 丢
      '不是对象',                       // → 丢
      { name: '数字正文.txt', text: 42 }  // 正文收成空串，条目留着
    ]
  };
  var r = Store.normalize(raw);
  h.assertEqual(r.data.files.length, 2);
  h.assertEqual(r.data.files[0].name, '好.txt');
  h.assertEqual(r.data.files[1].text, '');
  h.assertEqual(r.dropped, 2);
});

// ---------------------------------------------------------------------------
h.group('接线与命名（app.js / render.js 源码守卫）');

t('小文件不参与 30 天归档：applyArchive 把它整份带走', function () {
  var data = Store.createEmpty();
  TaskOps.addFile(data, 'a.txt', 'x');
  data.dates['2020-01-01'] = Store.emptyDay();

  var plan = Store.planArchive(data, new Date(2026, 9, 1));
  var next = Store.applyArchive(data, plan);
  h.assertEqual(next.files.length, 1, '归档只收缩 dates，全局板块一份都不能丢');
});

t('「导入」按钮叫 files__load，不叫 files__import', function () {
  // 为什么较这个真：test-drag-handle.js 会把 render.js 里所有 `*__import` 当成
  // 「池的导入按钮」，要求它们出现在 drag.js 的 isInteractive 名单里（鼠标按它
  // 不该起拖）。这边这个「导入」是**从本机选 txt 文件**，和小文件板块的拖拽
  // 毫无关系 —— 叫 files__import 会让那条守卫红，而往 drag.js 里塞一个不相干
  // 的类名只会让人看不懂。所以换个名字，并在测试里把这条理由钉住。
  h.assertTrue(renderSrc.indexOf("'files__load'") !== -1 ||
               renderSrc.indexOf('class="files__load"') !== -1);
  h.assertFalse(renderSrc.indexOf('files__import') !== -1,
    '别把它改成 files__import（drag-handle 守卫会把它当成池的导入按钮）');
});

t('app.js：导入只认 .txt，超过 1MB 挡下来（不然要把本机配额撑爆）', function () {
  var body = appSrc.slice(appSrc.indexOf('function importTxtFile('));
  body = body.slice(0, body.indexOf('\n  }'));
  h.assertTrue(body.indexOf('Util.isTxtFileName') !== -1, '只认 .txt 后缀');
  h.assertTrue(body.indexOf('CONFIG.FILES_MAX_BYTES') !== -1, '单个文件超过 1MB 挡下来');
  h.assertTrue(body.indexOf("readAsText(file, 'utf-8')") !== -1, '按 UTF-8 读，中文不乱码');
});

t('app.js：正文编辑器走 Render.openEditor，保存才写回', function () {
  var body = appSrc.slice(appSrc.indexOf('function openFileEditor('));
  body = body.slice(0, body.indexOf('\n  }'));
  h.assertTrue(body.indexOf('Render.openEditor') !== -1);
  h.assertTrue(body.indexOf('TaskOps.setFileText') !== -1);
  h.assertTrue(body.indexOf('Store.isProtectionMode()') !== -1);
});

t('app.js：五个写函数都拦了保护模式', function () {
  ['importTxtFile', 'startAddFile', 'startRenameFile', 'openFileEditor', 'doRemoveFile']
    .forEach(function (fn) {
      var start = appSrc.indexOf('function ' + fn + '(');
      h.assertTrue(start !== -1, '找不到 ' + fn);
      var body = appSrc.slice(start, appSrc.indexOf('\n  }', start));
      h.assertTrue(body.indexOf('Store.isProtectionMode()') !== -1, fn + ' 少了保护模式检查');
    });
});

t('app.js：开机绑上 bindFiles，改动后重画', function () {
  h.assertTrue(appSrc.indexOf('bindFiles();') !== -1);
});

// ---------------------------------------------------------------------------

h.summary('小文件（v2.12 需求 2）');
