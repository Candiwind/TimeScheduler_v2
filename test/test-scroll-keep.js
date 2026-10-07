/**
 * test-scroll-keep.js
 *
 * 勾选完成 / 取消完成之后，各列表的滚动位置要原地不动（v2.10 需求 1，
 * 见 DS 2.41 / D-72）。
 *
 * 这一条容易坏在「漏登记」上：滚动位置是靠 Render.captureScroll / restoreScroll
 * 拍的快照贴回去的（重画走整块 innerHTML 替换，见 DS 2.1），而快照只认
 * SCROLL_SLOTS 那张登记表。以后新加一个能滚的面板、忘了往表里加一行，
 * 表现就是「那个列表勾一下还是弹回顶部」—— 肉眼很难在几个面板之间对上账。
 * 所以这里做**交叉核对**：样式表里所有 `overflow-y: auto` 的容器，登记表里
 * 必须都有。
 *
 * 跑法：node test/test-scroll-keep.js
 */
'use strict';

var h = require('./harness');
var fs = require('fs');
var path = require('path');

var t = h.test;
var ROOT = path.join(__dirname, '..');

var Render = require('../js/render');
var css = fs.readFileSync(path.join(ROOT, 'css', 'style.css'), 'utf8');
var appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
var renderSrc = fs.readFileSync(path.join(ROOT, 'js', 'render.js'), 'utf8');

/**
 * 样式表里所有纵向滚动容器的选择器。
 *
 * 认「规则体里带 overflow-y: auto」的规则，逗号分隔的选择器拆成多条。
 * 只管平铺规则：嵌套在 @media 里的规则体被第一个 `}` 截断，正好不会误判
 * （媒体查询里也没改过 overflow-y）。
 */
function scrollableSelectors(source) {
  var out = [];
  var re = /([^{}]+)\{([^}]*)\}/g;
  var m;
  while ((m = re.exec(source)) !== null) {
    if (!/overflow-y\s*:\s*auto/.test(m[2])) continue;
    m[1].split(',').forEach(function (sel) {
      sel = sel.trim();
      // 只认「单行选择器」，@media 这种开头带 @ 的跳过
      if (sel && sel.charAt(0) === '.' && out.indexOf(sel) === -1) out.push(sel);
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
h.group('登记表：每个纵向滚动容器都拍得到、贴得回');

t('样式表里每个 overflow-y: auto 的容器都在 SCROLL_SLOTS 里', function () {
  var sels = scrollableSelectors(css);
  h.assertTrue(sels.length >= 5,
    '至少该找到象限 / 时间视图 / 计划池 / 模板池 / 阅读栏这些滚动容器，实际：' +
    sels.join(', '));

  var registered = Render.SCROLL_SLOTS.map(function (s) { return s.sel; });
  sels.forEach(function (sel) {
    h.assertTrue(registered.indexOf(sel) !== -1,
      sel + ' 没登记进 SCROLL_SLOTS —— 那一处勾完完成度还是会弹回顶部');
  });
});

t('多份的容器（象限 / 时间视图）靠 data 属性分键', function () {
  var bySel = {};
  Render.SCROLL_SLOTS.forEach(function (s) { bySel[s.sel] = s; });

  // 四个象限、若干时段块：光靠类名分不出是哪一份，键里必须带 data 属性
  h.assertEqual(bySel['.quadrant__body'].attr, 'data-quadrant',
    '象限滚动位置该按 data-quadrant 分别记');
  h.assertEqual(bySel['.timeview__list'].attr, 'data-slot',
    '时间视图每个时间栏该按 data-slot 分别记');

  // 这两条要和 render.js 真正画出来的属性对上 —— 对不上就一个也贴不回去
  h.assertTrue(renderSrc.indexOf('class="quadrant quadrant--') !== -1 &&
    renderSrc.indexOf('data-quadrant="') !== -1,
    'render.js 里象限元素上没有 data-quadrant，键定不出来');
  h.assertTrue(renderSrc.indexOf('class="timeview__group" data-slot="') !== -1,
    'render.js 里时段组上没有 data-slot，键定不出来');
});

t('只有一份的容器用固定键，不依赖属性', function () {
  var bySel = {};
  Render.SCROLL_SLOTS.forEach(function (s) { bySel[s.sel] = s; });
  ['.pool__list', '.tpl__list', '.reading__list', '.reading__done-list'].forEach(function (sel) {
    h.assertTrue(!!bySel[sel], sel + ' 没登记');
    h.assertEqual(bySel[sel].scope, null, sel + ' 只有一份，不需要往上找祖先');
  });
});

// ---------------------------------------------------------------------------
h.group('Node 里不炸：没有 document 时快照是空的');

t('captureScroll 在没有 document 时返回空对象', function () {
  h.assertEqual(typeof document, 'undefined', 'Node 里本就没有 document');
  var snap = Render.captureScroll();
  h.assertEqual(typeof snap, 'object');
  h.assertEqual(Object.keys(snap).length, 0);
});

t('restoreScroll 传空 / undefined 不报错', function () {
  Render.restoreScroll({});
  Render.restoreScroll(null);
  Render.restoreScroll(undefined);
});

// ---------------------------------------------------------------------------
h.group('接线：renderCurrent 提供开关，勾选分支打开它');

t('renderCurrent 接受 options 并在重画前后采 / 贴快照', function () {
  var m = /function renderCurrent\(options\)\s*\{([\s\S]*?)\n  \}/.exec(appSrc);
  h.assertTrue(m !== null, 'renderCurrent 该带一个 options 参数');
  var body = m ? m[1] : '';

  h.assertTrue(body.indexOf('Render.captureScroll()') !== -1,
    'renderCurrent 该在重画前拍快照');
  h.assertTrue(body.indexOf('Render.restoreScroll(scrollSnap)') !== -1,
    'renderCurrent 该在重画后贴回快照');

  // 贴回必须在最后一步：容器还 hidden 的时候量不到高度，scrollTop 会被夹成 0
  h.assertTrue(body.lastIndexOf('Render.restoreScroll') >
               body.lastIndexOf('Render.setViewMode'),
    'restoreScroll 要排在 setViewMode 之后（隐藏的容器贴不回去）');
});

t('四个勾选分支都传了 keepScroll', function () {
  // 任务 / 阶段 / 池内任务 / 池内块头 —— 每条都要保留滚动位置。
  // 漏一条，那一处勾完就还是弹回顶部（表现和只修一半一样，很难发现）
  var handlers = [
    ['doToggle', /function doToggle\(quadrantId[\s\S]*?\n  \}/],
    ['doToggleStage', /function doToggleStage\(quadrantId[\s\S]*?\n  \}/],
    ['doTogglePoolItem', /function doTogglePoolItem\([\s\S]*?\n  \}/],
    ['doTogglePoolBlock', /function doTogglePoolBlock\([\s\S]*?\n  \}/]
  ];
  handlers.forEach(function (item) {
    var m = item[1].exec(appSrc);
    h.assertTrue(m !== null, '没找到 ' + item[0]);
    h.assertTrue(m && m[0].indexOf('renderCurrent({ keepScroll: true })') !== -1,
      item[0] + ' 里没有保留滚动位置（keepScroll）');
  });

  // 象限块头勾选框是内联处理的（没单独的函数），单独认一次
  h.assertTrue(appSrc.indexOf("renderCurrent({ keepScroll: true });   // v2.10 需求 1") !== -1,
    '象限块头的一键全勾也要保留滚动位置');
});

t('时间视图的勾选走的是同一个 doToggle / doToggleStage（不另起一份）', function () {
  var tv = appSrc.slice(appSrc.indexOf('function bindTimeView'));
  h.assertTrue(tv.indexOf('doToggle(info.quadrantId, info.taskId, e.target.checked)') !== -1,
    '时间视图任务勾选该复用 doToggle');
  h.assertTrue(tv.indexOf('doToggleStage(info.quadrantId, info.taskId, info.stageId, e.target.checked)') !== -1,
    '时间视图阶段勾选该复用 doToggleStage');
});

t('内容真变了的操作不传 keepScroll（画完从头看才对）', function () {
  // 新增 / 删除 / 推迟 / 导入这类操作不该带开关：列表本身变了，
  // 粘住旧位置反而会让人以为没生效
  ['doRemoveItem', 'doPostpone', 'doRemovePoolItem', 'doImportPoolItem'].forEach(function (name) {
    var m = new RegExp('function ' + name + '\\([\\s\\S]*?\\n  \\}').exec(appSrc);
    h.assertTrue(m !== null, '没找到 ' + name);
    h.assertFalse(m && m[0].indexOf('keepScroll') !== -1,
      name + ' 不该保留滚动位置（内容变了）');
  });
});

// ---------------------------------------------------------------------------

h.summary('勾选后保留滚动位置（v2.10 需求 1）');
