/**
 * test-drag-handle.js
 *
 * 拖动把手 = 勾选框（需求 7，见 DS 2.19 / D-48；v2.10 需求 2 起扩到计划池）。
 *
 * 覆盖（见 DS 三、测试策略）：
 *   CSS 层：勾选框（task/stage/block/pool/pool__block）有 touch-action:none；
 *           行本体（任务行 / 块 / 时间视图条目 / **池内条目 / 池内块头**）
 *           都不再有 touch-action:none —— 触摸端全部腾给滚动。
 *   JS 层守卫：render.js 里画出来的交互按钮（推迟等），drag.js 的 isInteractive
 *           都得认 —— 漏一个，那个按钮按下去就变成拖拽（v2.5 修的正是这一类）。
 *
 * v2.10 需求 2 把 D-62 的取舍反过来：池内的勾选框以前只做勾选、整条池条目可拖
 * （.pool__item 上的 touch-action:none 就是为它设的），但后果是池列表在手机上
 * 根本滚不动（R-33）。现在池和象限一视同仁，把手只有勾选框。
 *
 * 手感（按住勾选框拖 vs 轻点勾选、松手不误触）属真机手工验收，这里不做。
 *
 * 跑法：node test/test-drag-handle.js
 */
'use strict';

var h = require('./harness');
var fs = require('fs');
var path = require('path');

var t = h.test;
var css = fs.readFileSync(path.join(__dirname, '..', 'css', 'style.css'), 'utf8');

/** 取出某个「单行选择器」的规则体（选择器后面紧跟 `{`，到第一个 `}` 为止） */
function ruleBody(selector) {
  var start = css.indexOf(selector + ' {');
  if (start === -1) return '';
  var open = css.indexOf('{', start);
  var close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

// ---------------------------------------------------------------------------
h.group('勾选框是拖动把手：有 touch-action:none');

t('五种勾选框共用一条 touch-action:none 规则', function () {
  // 象限三个 + 池内两个，选择器放在同一条规则里，规则体带 touch-action: none
  var matches = css.match(/\.(task|stage|block|pool)__check[^{]*\{[^}]*touch-action\s*:\s*none/g);
  h.assertTrue(matches && matches.length >= 1,
    '缺勾选框的 touch-action:none 规则（拖动把手）');
  ['pool__check', 'pool__block-check'].forEach(function (cls) {
    h.assertTrue(css.indexOf('.' + cls) !== -1, '缺 ' + cls + '（v2.10 需求 2）');
  });
});

// ---------------------------------------------------------------------------
h.group('行本体恢复触摸滚动：不再有 touch-action:none');

t('任务行 / 块 / 时间视图条目本体都不再设 touch-action:none', function () {
  ['#quadrants .task', '.block', '.timeview__item'].forEach(function (sel) {
    // 只认「声明」touch-action:（带冒号），注释里提到「不设 touch-action」不算
    h.assertTrue(ruleBody(sel).indexOf('touch-action:') === -1,
      sel + ' 本体不该再有 touch-action（否则挡住页面滚动）');
  });
});

t('计划池条目本体也不再设 touch-action:none（v2.10 需求 2，解 R-33）', function () {
  h.assertTrue(ruleBody('.pool__item').indexOf('touch-action:') === -1,
    '.pool__item 不该再有 touch-action（池条目整条可拖会让手机端滚不动池列表）');
});

// ---------------------------------------------------------------------------
h.group('交互按钮不触发拖拽：render 画了哪些，drag 就得认哪些');

t('所有 __postpone 按钮都在 drag.js 的 isInteractive 名单里', function () {
  var renderSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'render.js'), 'utf8');
  var dragSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'drag.js'), 'utf8');

  // 把 render.js 里所有 class="..." 里的 __postpone 类名收集出来
  var classes = [];
  var re = /class="([^"]*)"/g;
  var m;
  while ((m = re.exec(renderSrc)) !== null) {
    m[1].split(/\s+/).forEach(function (cls) {
      if (/_+postpone$/.test(cls) && classes.indexOf(cls) === -1) classes.push(cls);
    });
  }

  h.assertTrue(classes.length >= 3,
    '至少有阶段 / 块 / 任务三种推迟按钮，实际只找到：' + classes.join(','));
  classes.forEach(function (cls) {
    h.assertTrue(dragSrc.indexOf("closestEl(node, '" + cls + "')") !== -1,
      cls + ' 不在 isInteractive 里 —— 鼠标按它会变成拖拽，推迟点不动');
  });
});

t('池内的「导入」按钮也在 isInteractive 名单里（v2.6 需求 2）', function () {
  var renderSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'render.js'), 'utf8');
  var dragSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'drag.js'), 'utf8');

  // 和推迟按钮同一条守卫：render 画了哪些 __import，drag 就得认哪些。
  // 漏一个，那个按钮按下去就变成拖拽（v2.5 的 ② 正是这类回归）
  var classes = [];
  var re = /class="([^"]*)"/g;
  var m;
  while ((m = re.exec(renderSrc)) !== null) {
    m[1].split(/\s+/).forEach(function (cls) {
      // pool__import / pool__block-import 都算（BEM 的「块-元素」写法用的是连字符）
      if (/[-_]import$/.test(cls) && classes.indexOf(cls) === -1) classes.push(cls);
    });
  }

  h.assertTrue(classes.length >= 2,
    '池行上和块头上各一个导入按钮，实际只找到：' + classes.join(','));
  classes.forEach(function (cls) {
    h.assertTrue(dragSrc.indexOf("closestEl(node, '" + cls + "')") !== -1,
      cls + ' 不在 isInteractive 里 —— 鼠标按它会变成拖拽，导入点不动');
  });
});

t('池内块头也能拖（v2.6 需求 1），但触摸端起手在块头的勾选框上', function () {
  // 块头不是 .pool__item，以前整块根本拖不动；需求 1 之后它得能起手。
  // v2.10 需求 2：鼠标整条块头可拖，触摸端只有勾选框是把手 —— 所以块头本体
  // 的 touch-action:none 撤掉（它挡着池列表滚动），把手落在 pool__block-check 上
  h.assertTrue(css.indexOf('.pool__block-check') !== -1,
    '缺 .pool__block-check（触摸端拖块的把手）');
  h.assertTrue(ruleBody('.pool__block-head').indexOf('touch-action:') === -1,
    '.pool__block-head 不该再有 touch-action（触摸端只剩勾选框是把手）');
  h.assertTrue(css.indexOf('.pool__item--placeholder {') !== -1,
    '缺池内排序的落点占位样式');
});

// ---------------------------------------------------------------------------

h.summary('拖动把手 = 勾选框（需求 7）');
