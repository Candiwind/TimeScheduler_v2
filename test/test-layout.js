/**
 * test-layout.js
 *
 * v2.8 需求 1：**时间视图下，计划池也要在下面**（见 DS 2.36）。
 * v2.8 需求 3：**阅读栏在四象限上面**，三个板块都要能收起（见 DS 2.38）。
 *
 * 这两条需求是纯版面顺序 / 纯界面状态，node 里算不了层叠、也算不了浏览器的
 * 盒模型，所以守卫分两半：
 *
 *   1. 页面结构：`index.html` 里 `#reading` 排在 `#quadrants` **前面**、
 *      `#timeview` 排在 `#pool` **前面** —— 既然 `#timeview` 在象限模式下是
 *      hidden（没有布局盒子），这个顺序同时满足「象限视图：计划池在最下」和
 *      「时间视图：计划池在时间视图下面」；
 *   2. 切换逻辑：`render.setViewMode` 在两种模式下都得让计划池和阅读栏露着
 *      （`el.pool.hidden = false`）—— 顺序对了但板块被藏了，需求同样不成立。
 *
 * 为什么值得单独写：section 的顺序在 HTML 里就是两行相邻的代码，
 * 谁顺手挪一下「看起来更整齐」，页面上就变成「池跑到时间视图上面去了」，
 * 而这种回归肉眼只在切到时间视图时才发现。
 *
 * 跑法：node test/test-layout.js
 */
'use strict';

var h = require('./harness');
var fs = require('fs');
var path = require('path');

var t = h.test;
var ROOT = path.join(__dirname, '..');
var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
var renderSrc = fs.readFileSync(path.join(ROOT, 'js', 'render.js'), 'utf8');
var css = fs.readFileSync(path.join(ROOT, 'css', 'style.css'), 'utf8');

/** 某个 id 在 index.html 里第一次出现的位置（-1 = 没有） */
function at(id) {
  return html.indexOf('id="' + id + '"');
}

/** 取出 render.js 里某个函数的函数体（到下一个顶格 `}` 为止） */
function fnBody(name) {
  var start = renderSrc.indexOf('function ' + name + '(');
  if (start === -1) return '';
  var end = renderSrc.indexOf('\n  }', start);
  return renderSrc.slice(start, end === -1 ? renderSrc.length : end);
}

// ---------------------------------------------------------------------------
h.group('页面结构：时间视图排在计划池前面');

t('#timeview 与 #pool 都还在', function () {
  h.assertTrue(at('timeview') !== -1, 'index.html 里没有 #timeview 了');
  h.assertTrue(at('pool') !== -1, 'index.html 里没有 #pool 了');
});

t('#timeview 排在 #pool 前面（计划池在时间视图下面）', function () {
  h.assertTrue(at('timeview') < at('pool'),
    '#timeview 排到了 #pool 后面 —— 切到时间视图时计划池会跑到上面去（v2.8 需求 1）');
});

t('四个板块都在：#quadrants 最前，后面才是时间视图 / 计划池 / 模板', function () {
  ['quadrants', 'timeview', 'pool', 'templates'].forEach(function (id) {
    h.assertTrue(at(id) !== -1, '缺 #' + id + ' 板块');
  });

  h.assertTrue(at('quadrants') < at('timeview'),
    '四象限必须在最前：象限视图下计划池要落在四象限下面');
});

t('计划池排在模板池前面（模板仍在最底）', function () {
  h.assertTrue(at('pool') < at('templates'),
    '计划池该在模板池前面，别把两个板块一起挪乱了');
});

t('四个板块各只有一个 id，没有重复', function () {
  ['quadrants', 'timeview', 'pool', 'templates'].forEach(function (id) {
    var re = new RegExp('id="' + id + '"', 'g');
    var n = (html.match(re) || []).length;
    h.assertEqual(n, 1, '#' + id + ' 出现了 ' + n + ' 次（id 必须唯一）');
  });
});

t('#reading 排在 #quadrants 前面，也只有一个 id（v2.8 需求 3）', function () {
  h.assertTrue(at('reading') !== -1, 'index.html 里没有 #reading 了');
  h.assertTrue(at('reading') < at('quadrants'),
    '阅读栏该在四象限**上面**（v2.8 需求 3 明说了「顶部，四象限上面」）');

  var n = (html.match(/id="reading"/g) || []).length;
  h.assertEqual(n, 1, '#reading 只能有一个');
});

// ---------------------------------------------------------------------------
h.group('切换逻辑：两种模式下计划池都露着');

t('setViewMode 里计划池是无条件显示的', function () {
  var body = fnBody('setViewMode');

  h.assertTrue(body.indexOf('el.pool.hidden = false') !== -1,
    'setViewMode 没有「计划池一直显示」那句 —— 切到时间视图池就没了');
  h.assertFalse(/el\.pool\.hidden = isTime/.test(body),
    '计划池不能跟着视图藏起来（它是两个视图共用的）');
});

t('时间视图只在 time 模式下显示，象限 / 模板反过来', function () {
  var body = fnBody('setViewMode');

  h.assertTrue(body.indexOf('el.timeview.hidden = !isTime') !== -1,
    '时间视图该按 isTime 取反显示');
  h.assertTrue(body.indexOf('el.quadrants.hidden = isTime') !== -1,
    '时间视图下四象限该藏起来');
  h.assertTrue(body.indexOf('el.templates.hidden = isTime') !== -1,
    '时间视图下模板该藏起来');
});

t('切回来能恢复：四个板块都有 [hidden] 的 display:none 守卫', function () {
  // .quadrants 自己写了 display:grid，作者样式赢过浏览器默认的 [hidden]
  ['quadrants', 'timeview', 'pool', 'templates', 'reading'].forEach(function (id) {
    h.assertTrue(css.indexOf('.' + id + '[hidden]') !== -1,
      '缺 .' + id + '[hidden] 守卫 —— 切视图后这个板块会赖着不走');
  });
});

t('阅读栏在两个视图下都露着（它不属于任何一个视图）', function () {
  var body = fnBody('setViewMode');
  h.assertTrue(body.indexOf('el.reading.hidden = false') !== -1,
    'setViewMode 没有「阅读栏一直显示」那句 —— 切视图它就没了');
  h.assertFalse(/el\.reading\.hidden = isTime/.test(body),
    '阅读栏不能跟着视图藏起来');
});

// ---------------------------------------------------------------------------
h.group('板块收起（v2.8 需求 3）：三个板块都要能收，且记在本机');

t('三个板块（阅读栏 / 计划池 / 模板池）的头上都有收起三角', function () {
  var NodeSource = renderSrc;
  ['reading', 'pool', 'templates'].forEach(function (id) {
    h.assertTrue(NodeSource.indexOf("panelToggleHtml('" + id + "'") !== -1,
      'render.js 里 ' + id + ' 的头上没有收起三角');
  });
});

t('收起状态由 render.setCollapsedPanels 落到 .is-collapsed 上', function () {
  var body = fnBody('setCollapsedPanels');
  h.assertTrue(body.indexOf('CONFIG.PANEL_IDS') !== -1,
    '该按 CONFIG.PANEL_IDS 遍历，别写死三个 id');
  h.assertTrue(body.indexOf('is-collapsed') !== -1);
});

t('render 主流程会调 setCollapsedPanels（换视图 / 重画都得跟上）', function () {
  var body = fnBody('render');
  h.assertTrue(body.indexOf('setCollapsedPanels(') !== -1,
    'render 没把收起状态画上去，刷新后就白记了');
});

t('index.html 里三个板块都是 section（收起三角挂在各自头上）', function () {
  ['reading', 'pool', 'templates'].forEach(function (id) {
    h.assertTrue(html.indexOf('<section id="' + id + '"') !== -1,
      '#' + id + ' 该是个 section');
  });
});

// ---------------------------------------------------------------------------

h.summary('页面版面顺序与板块收起（v2.8 需求 1 / 需求 3）');
