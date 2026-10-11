/**
 * test-style-guards.js
 *
 * 纯样式需求的 CSS 守卫（需求 4、5，见 DS 2.19）。
 *
 * 底色 / 最大高度这类「坏了也不报错、node 里又算不了层叠」的东西，
 * 直接查样式表里关键声明在不在（沿用 test-timeview.js 的 CSS guard 思路）。
 * 拖拽把手（需求 7）单独在 test-drag-handle.js。
 *
 * 跑法：node test/test-style-guards.js
 */
'use strict';

var h = require('./harness');
var fs = require('fs');
var path = require('path');

var t = h.test;
var css = fs.readFileSync(path.join(__dirname, '..', 'css', 'style.css'), 'utf8');

/** 正则里要转义的字符 */
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 取出某个「单行选择器」的规则体（选择器独占一行、后面紧跟 `{`，到第一个 `}` 为止）。
 *
 * **必须锚在行首**，不能用 `indexOf(selector + ' {')`：那会先撞上把同一个类名
 * 写在后半截的**后代选择器**。v2.13 就踩过一次 ——
 * `.timeview__group.is-collapsed .timeview__list { display: none; }` 里带着
 * `.timeview__list {`，于是「时段块最大高度」那条守卫读到的是 `display: none`，
 * 报「缺 max-height: 60vh」而其实它在（同 DS R-41 记的那条教训：取规则体
 * 别图省事用 indexOf，要按完整选择器匹配）。
 */
function ruleBody(selector) {
  var re = new RegExp('(?:^|\\n)[ \\t]*' + escapeRe(selector) + '[ \\t]*\\{([^}]*)\\}');
  var m = re.exec(css);
  return m ? m[1] : '';
}

// ---------------------------------------------------------------------------
h.group('需求 1：四个象限高度互不牵制');

t('.quadrants 行高按内容来，不是 1fr 1fr 拉伸', function () {
  var body = ruleBody('.quadrants');
  h.assertTrue(body.indexOf('grid-template-rows: auto auto') !== -1,
    '.quadrants 缺 grid-template-rows: auto auto');
  h.assertFalse(body.indexOf('grid-template-rows: 1fr 1fr') !== -1,
    '不能再把行高设成 1fr 1fr（那样两行会被拉成一样高）');
  h.assertTrue(body.indexOf('align-items: start') !== -1,
    '.quadrants 缺 align-items: start（不拉伸象限卡片）');
});

// ---------------------------------------------------------------------------
h.group('需求 4：时间视图象限浅色底');

t('一二三四象限各有一条带 color-mix 的浅色底规则', function () {
  ['I', 'II', 'III', 'IV'].forEach(function (q) {
    var re = new RegExp('\\.timeview__item\\[data-quadrant="' + q + '"\\][^{]*\\{[^}]*background\\s*:\\s*color-mix');
    h.assertTrue(re.test(css), '缺第 ' + q + ' 象限的浅色底规则');
  });
});

// ---------------------------------------------------------------------------
h.group('需求 5：各面板最大高度 + 右侧滚动');

t('象限 / 时间视图块 / 计划池 / 模板池都设了最大高度和滚动', function () {
  var panels = [
    ['.quadrant__body', '60vh'],
    ['.timeview__list', '60vh'],
    ['.pool__list', '40vh'],
    ['.tpl__list', '40vh']
  ];
  panels.forEach(function (p) {
    var body = ruleBody(p[0]);
    h.assertTrue(body.indexOf('max-height: ' + p[1]) !== -1,
      p[0] + ' 缺 max-height: ' + p[1]);
    h.assertTrue(body.indexOf('overflow-y: auto') !== -1,
      p[0] + ' 缺 overflow-y: auto');
  });
});

t('移动端媒体查询里象限最大高度收紧到 40vh', function () {
  h.assertTrue(/@media[^{]*max-width\s*:\s*600px[^{]*\{[\s\S]*?\.quadrant__body\s*\{[^}]*max-height\s*:\s*40vh/.test(css),
    '移动端象限 60vh → 40vh 缺失');
});

// ---------------------------------------------------------------------------
h.group('需求（新）：任务块的推迟键不那么显眼');

t('.block__postpone 是透明低调按钮，默认收起、hover 才出现', function () {
  // 用「行首的 .block__postpone」锚定基础规则，避开 .drag-ghost .block__postpone
  // 和 @media 里缩进的那条（ruleBody 的 indexOf 会先撞上 drag-ghost 那条）
  var m = /^\.block__postpone\s*\{([^}]*)\}/m.exec(css);
  h.assertTrue(m !== null, '缺 .block__postpone 基础规则');
  var body = m ? m[1] : '';
  h.assertTrue(body.indexOf('background: transparent') !== -1, '缺 background: transparent');
  h.assertTrue(body.indexOf('border: 0') !== -1, '缺 border: 0');
  h.assertTrue(body.indexOf('opacity: 0') !== -1, '默认该收起（opacity: 0）');
  h.assertTrue(css.indexOf('.block:hover .block__postpone { opacity: 1; }') !== -1,
    '缺 hover 展开规则');
});

t('拖拽克隆上不冒出「推迟」按钮', function () {
  h.assertTrue(/\.drag-ghost \.block__postpone\s*\{[^}]*display:\s*none/.test(css),
    '.drag-ghost .block__postpone 该 display: none');
});

// ---------------------------------------------------------------------------
h.group('v2.12：三个新板块的最大高度 + 滚动（需求 2 / 3 / 4）');

/**
 * 一条规则体，按「选择器列表里含这个选择器」找（几条规则共用一份声明时用）。
 *
 * 先剥掉注释再找：`([^{}]+)\{` 这种朴素正则会把上一条规则后面的注释当成
 * 「选择器文本」的一部分，于是第一条选择器前面挂着一串注释、比不中。
 */
var cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
function ruleBodyFor(sel) {
  var re = /([^{}]+)\{([^}]*)\}/g;
  var m;
  while ((m = re.exec(cssNoComments)) !== null) {
    var sels = m[1].split(',').map(function (s) { return s.trim(); });
    if (sels.indexOf(sel) !== -1) return m[2];
  }
  return '';
}

t('原则池两段 / 技能池 / 小文件都设了最大高度和滚动条', function () {
  // 这几个容器同时被 Render.SCROLL_SLOTS 登记着（见 test-scroll-keep.js 的
  // 交叉核对）—— 样式和登记表是一件事的两半。四条共用一份声明，所以按
  // 「选择器列表里含它」来找，不能用 ruleBody 那种 `sel + ' {'`（会找不到）
  ['.principles__list', '.principles__archived-list', '.skills__list', '.files__list']
    .forEach(function (sel) {
      var body = ruleBodyFor(sel);
      h.assertTrue(body.length > 0, '找不到 ' + sel + ' 的规则');
      h.assertTrue(body.indexOf('max-height: 40vh') !== -1, sel + ' 缺 max-height');
      h.assertTrue(body.indexOf('overflow-y: auto') !== -1, sel + ' 缺 overflow-y: auto');
    });
});

t('六个板块收起时都要藏住正文（含新加的三个）', function () {
  var collapsed = css.slice(css.indexOf('.pool.is-collapsed .pool__list'),
                            css.indexOf('.pool.is-collapsed .pool__head'));
  ['.principles.is-collapsed .principles__list',
   '.principles.is-collapsed .principles__archived',
   '.skills.is-collapsed .skills__list',
   '.files.is-collapsed .files__list'].forEach(function (sel) {
    h.assertTrue(collapsed.indexOf(sel) !== -1, '缺 ' + sel + ' 的收起规则');
  });
});

t('小文件用量超限的标红规则在（只标红，不拦）', function () {
  var body = ruleBody('.files__usage--over');
  h.assertTrue(body.indexOf('color: var(--q1)') !== -1, '.files__usage--over 该标红');
  h.assertFalse(body.indexOf('display: none') !== -1);
});

// ---------------------------------------------------------------------------
h.group('v2.12 需求 6：模板高亮的 CSS');

t('模板高亮和任务那一组同源，且画在名字那段文字上', function () {
  var rule = /\.tpl__item--highlight \.tpl__name\s*\{([^}]*)\}/.exec(css);
  h.assertTrue(rule !== null, '找不到 .tpl__item--highlight .tpl__name');
  var body = rule ? rule[1] : '';
  h.assertTrue(body.indexOf('background: var(--hl-bg)') !== -1);
  h.assertTrue(body.indexOf('color: var(--hl-text)') !== -1);
  h.assertTrue(body.indexOf('padding: 0 3px') !== -1);
  h.assertTrue(body.indexOf('margin: 0 -3px') !== -1);
});

t('模板没有完成态：那条规则里不写 :not(--done)', function () {
  h.assertFalse(/\.tpl__item--highlight[^{]*:not\(/.test(css));
});

t('模板改名入口是名字本身（单击），CSS 里没有多余的改名按钮规则', function () {
  // 需求 6 把「改名」按钮去掉了，.tpl__name 变成可点目标
  h.assertTrue(/\.tpl__name\s*\{[^}]*cursor/.test(css) ||
                /\.tpl__item[^{]*\.tpl__name/.test(css),
    '名字该是点得动的（cursor 之类）');
  h.assertFalse(css.indexOf('.tpl__rename') !== -1,
    '.tpl__rename 的样式该跟着按钮一起去掉');
});

// ---------------------------------------------------------------------------

h.summary('纯样式守卫（需求 4 + 5 + 新 + v2.12）');
