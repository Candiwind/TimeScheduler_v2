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

/** 取出某个「单行选择器」的规则体（选择器后面紧跟 `{`，到第一个 `}` 为止） */
function ruleBody(selector) {
  var start = css.indexOf(selector + ' {');
  if (start === -1) return '';
  var open = css.indexOf('{', start);
  var close = css.indexOf('}', open);
  return css.slice(open + 1, close);
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

h.summary('纯样式守卫（需求 4 + 5 + 新）');
