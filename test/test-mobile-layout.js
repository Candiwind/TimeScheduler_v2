/**
 * test-mobile-layout.js
 *
 * 手机端排版（v2.10 需求 4 + v2.11 需求 1/2，见 DS 2.44 / 2.46 / D-76）：
 *   1. 任务 / 阶段右侧那一串操作按钮，一行放不下时折到下一行；
 *   2. 文字占满整行宽度并自动换行；
 *   3. v2.11 需求 1：折行时文字要**紧挨着勾选框**留在第一行，不许整个掉到
 *      第二行（那样第一行只剩一个勾选框、右侧空一片）；
 *   4. v2.11 需求 2：右侧那串按钮是**一个整体** —— 装不下就整组折到第二行
 *      并靠右对齐、左侧留空，不能拆成一半留在一行、一半掉下去。
 *
 * 「折行」「占满整行」都是浏览器算出来的，node 里量不了宽度，所以这里查
 * **让这些行为成立的那些声明**在不在（沿用 test-style-guards.js 的 CSS guard 思路）。
 * 其中最容易被无意改坏的是文字格的 `flex-basis`：
 *   - `flex: 1`（= basis 0%）时所有格子都「不占地方」，行容器再怎么
 *     `flex-wrap: wrap` 也永远折不出一行来 —— 这是本需求实现上的真正机关；
 *   - 改成 `flex: 1 1 auto`（basis = 文字实际宽度）之后，折不折行才是
 *     「真挤不下」时才发生，文字短的行不会平白多一条空白；
 *   - 但 basis = auto 的长文会算出「比一行还宽」，于是**连文字一起**被挤到
 *     第二行 —— 这就是 `max-width` 上限要治的病（需求 3）。
 * 另外第 3、4 条查的是**真实渲染出来的 HTML**（不是源码文本）：每一类行都得
 * 把右侧控件收进 `<span class="task__actions">`，且 span 配平。
 *
 * 跑法：node test/test-mobile-layout.js
 */
'use strict';

var h = require('./harness');
var fs = require('fs');
var path = require('path');

// v2.11：右侧动作区那两条查的是**真实渲染出来的 HTML**，所以要拉起渲染层
var CONFIG = require('../js/config');
var Store = require('../js/store');
var TaskOps = require('../js/task-ops');
var Render = require('../js/render');

var t = h.test;
var DATE = '2026-10-01';
var css = fs.readFileSync(path.join(__dirname, '..', 'css', 'style.css'), 'utf8');

/**
 * 样式表按「移动端 / 桌面端」切开。
 *
 * `@media (max-width: 600px)` 在文件里有好几段（各组件就近写自己的移动端
 * 覆盖），所以要把它们**全都**归到移动端那一侧 —— 只取第一段会漏掉后写的。
 * 用花括号配平切块，避免把 `@media print` 之类也算进来。
 */
function splitMobile(source) {
  var mobile = '';
  var desktop = '';
  var i = 0;

  while (i < source.length) {
    var at = source.indexOf('@media (max-width: 600px)', i);
    if (at === -1) { desktop += source.slice(i); break; }

    desktop += source.slice(i, at);

    var open = source.indexOf('{', at);
    var depth = 0;
    var end = source.length;
    for (var k = open; k < source.length; k++) {
      if (source.charAt(k) === '{') depth++;
      else if (source.charAt(k) === '}') {
        depth--;
        if (depth === 0) { end = k + 1; break; }
      }
    }
    mobile += source.slice(open + 1, end - 1) + '\n';
    i = end;
  }

  return { mobile: mobile, desktop: desktop };
}

var SPLIT = splitMobile(css);
var MOBILE = SPLIT.mobile;

/** 在移动端那几段里找第一条「规则体含 needle」的规则，返回 { sel, body } */
function ruleWith(needle) {
  var re = /([^{}]+)\{([^}]*)\}/g;
  var m;
  while ((m = re.exec(MOBILE)) !== null) {
    if (m[2].indexOf(needle) !== -1) return { sel: m[1], body: m[2] };
  }
  return null;
}

/**
 * 按**选择器**找规则：选择器含 sel、且规则体含 needle。
 * `ruleWith` 只看规则体，手机上 `margin-left: auto` 这类通用声明可能在别处
 * 先出现，按选择器找才不会认错规则（v2.11 新增）。
 */
function ruleFor(sel, needle) {
  var re = /([^{}]+)\{([^}]*)\}/g;
  var m;
  while ((m = re.exec(MOBILE)) !== null) {
    if (m[1].indexOf(sel) !== -1 && m[2].indexOf(needle) !== -1) {
      return { sel: m[1], body: m[2] };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
h.group('行容器允许折行（需求 4.1）');

t('任务行 / 阶段 / 两个块头共用一条 flex-wrap: wrap', function () {
  h.assertTrue(MOBILE.length > 0, '没找到 max-width: 600px 的移动端样式');

  var rule = ruleWith('flex-wrap: wrap');
  h.assertTrue(rule !== null, '移动端缺 flex-wrap: wrap（行容器不折行，按钮只能被压扁）');

  // 四类「一行 = 勾选框 + 文字 + 一串按钮」的行，少一类就有一处按钮永远挤在一起
  ['.task__row', '.stage', '.block__head', '.pool__block-head'].forEach(function (sel) {
    h.assertTrue(rule && rule.sel.indexOf(sel) !== -1,
      '手机端没管 ' + sel + '（右侧按钮挤不下时折不了行）');
  });
});

// ---------------------------------------------------------------------------
h.group('文字占满整行并自动换行（需求 4.2）');

t('五个文字格改成 flex: 1 1 auto —— 折行才是「真挤不下」时才发生', function () {
  // basis 为 0（写 `flex: 1`）时格子的「假设宽度」是 0，行容器永远算不出
  // 「放不下」，也就永远不折行 —— 这条是需求 4.1 能不能生效的关键
  var rule = ruleWith('flex: 1 1 auto');
  h.assertTrue(rule !== null, '移动端没有 flex: 1 1 auto 的规则');

  ['.task__text', '.stage__text', '.pool__text', '.block__name', '.pool__block-name']
    .forEach(function (sel) {
      h.assertTrue(rule && rule.sel.indexOf(sel) !== -1,
        sel + ' 在手机端该是 flex: 1 1 auto（basis 为 0 时永远折不出一行）');
    });
});

t('文字格仍可收缩、仍会换行（长单词也不溢出）', function () {
  var rule = ruleWith('min-width: 0');
  h.assertTrue(rule !== null, '移动端缺 min-width: 0');
  h.assertTrue(rule && rule.sel.indexOf('.task__text') !== -1,
    '文字格该带 min-width: 0（长单词会把行撑破）');
  h.assertTrue(/overflow-wrap:\s*anywhere/.test(rule.body),
    '缺 overflow-wrap: anywhere（自动换行）');
});

t('时间视图和计划池复用同一批行样式，不另起一套', function () {
  // 时间视图的条目就是 .task__row / .stage，池里的行也是 .task__row ——
  // 所以上面那批规则天然覆盖它们；这条确认 render 出来的结构没被改掉
  var render = fs.readFileSync(path.join(__dirname, '..', 'js', 'render.js'), 'utf8');
  h.assertTrue(render.indexOf("'<div class=\"task__row\">'") !== -1,
    'render.js 里没有 .task__row');
  h.assertTrue(/pool__item[\s\S]{0,400}?task__row/.test(render),
    '池内条目该复用 .task__row（不然手机端折行规则覆盖不到池）');
  h.assertTrue(/timeview__item task[\s\S]{0,200}?task__row/.test(render),
    '时间视图条目该复用 .task__row');
});

// ---------------------------------------------------------------------------
h.group('文字按回第一行（v2.11 需求 1）');

t('五个文字格都夹了 max-width 上限 —— 长文不再整个掉到第二行', function () {
  var rule = ruleWith('max-width: calc(100% - 32px)');
  h.assertTrue(rule !== null,
    '移动端文字格没有 max-width 上限：basis = auto 的长文会算出比一行还宽，连文字一起折到第二行，第一行只剩勾选框');

  ['.task__text', '.stage__text', '.pool__text', '.block__name', '.pool__block-name']
    .forEach(function (sel) {
      h.assertTrue(rule && rule.sel.indexOf(sel) !== -1,
        sel + ' 缺 max-width 上限（「把勾选框右侧的空间也利用上」靠它）');
    });
});

t('上限写成 calc(100% - 32px)：夹得住文字、又窄到塞不下折下来的控件', function () {
  // 上限只减去「勾选框 + 行容器 gap」（浏览器默认勾选框 13px + gap 6~8px
  // ≈ 19~21px）。减太多 → 文字自己都放不进一行，反而整段掉下去；
  // 减太少 → 余量够宽的话，折下来的第一个控件（最窄的完成度「0/1」约 20px）
  // 会被塞进第一行，把「整组折行」拆成两半。32px 落在两者之间。
  var m = /max-width:\s*calc\(100%\s*-\s*(\d+)px\)/.exec(
    (ruleWith('max-width: calc(100% - 32px)') || {}).body || '');
  h.assertTrue(m !== null, '上限没写成 calc(100% - Npx)');
  var n = parseInt(m[1], 10);
  h.assertTrue(n > 24, '减去 ' + n + 'px 太多了：留给勾选框的空间不够，文字会整段掉到第二行');
  h.assertTrue(n < 50, '减去 ' + n + 'px 太少了：余量够塞下最窄的控件，整组折行会被拆开');
});

// ---------------------------------------------------------------------------
h.group('右侧动作区：整组折行 + 靠右对齐（v2.11 需求 2）');

/**
 * 七类「文字 + 右侧一串控件」的行，各渲染一条**真实 HTML**出来。
 * 时间是 view 模块，池的块头要 progressOfItem 传进去（同 app.js 的接法）。
 */
function renderedRows() {
  var view = { progressOf: TaskOps.getProgress };
  var plain = { id: 't1', text: '短任务', completed: false };
  var staged = { id: 't2', text: '带阶段的任务', completed: false,
                 stages: [{ id: 's1', text: '一个阶段', completed: false }] };
  var block = { id: 'b1', type: 'block', text: '一个块', completed: false,
                createdAt: 0, tasks: [plain] };

  var data = Store.createEmpty();
  var tid = TaskOps.addTask(data, DATE, 'I', '设了时段的').task.id;
  TaskOps.setSlot(data, DATE, 'I', tid, CONFIG.SLOTS[0]);

  return [
    ['象限任务行', Render.buildTaskHtml(plain, view)],
    ['有阶段的任务行', Render.buildTaskHtml(staged, view)],
    ['阶段行', Render.buildStageHtml({ id: 's1', text: '一个阶段', completed: false })],
    ['象限任务块头', Render.buildBlockHtml(block, view)],
    ['计划池条目', Render.buildPoolItemHtml(plain, null)],
    ['池内任务块头', Render.buildPoolBlockHtml(block, view)],
    ['时间视图条目', Render.buildTimeViewHtml(TaskOps.getTimeView(data, DATE), view)]
  ];
}

t('七类行的右侧控件都收在一个 task__actions 组里，且 span 配平', function () {
  var rows = renderedRows();
  h.assertEqual(rows.length, 7, '这七类行是需求覆盖的全集（少一类就有行漏了）');

  rows.forEach(function (pair) {
    var html = pair[1];
    h.assertTrue(html.indexOf('<span class="task__actions">') !== -1,
      pair[0] + ' 没有右侧动作区：装不下时按钮会被拆成两半（一半留在第一行）');

    var opens = (html.match(/<span\b/g) || []).length;
    var closes = (html.match(/<\/span>/g) || []).length;
    h.assertEqual(opens, closes, pair[0] + ' 的 <span> 没配平（少一个 </span>）');
  });
});

t('删除键收在动作区**里面**（不在组外漏一个出来）', function () {
  renderedRows().forEach(function (pair) {
    var html = pair[1];
    var open = html.indexOf('<span class="task__actions">');
    var del = html.search(/class="(task__del|stage__del|block__del|pool__del|pool__block-del)"/);
    h.assertTrue(open !== -1 && del !== -1 && del > open,
      pair[0] + '：删除键该在动作区里（否则它不会跟着整组折行）');
  });
});

t('手机端动作区 = flex + margin-left: auto', function () {
  var rule = ruleFor('.task__actions', 'margin-left: auto');
  h.assertTrue(rule !== null,
    '手机端 .task__actions 没有 margin-left: auto：折到第二行的按钮不会靠右');
  h.assertTrue(/display:\s*flex/.test(rule.body),
    '手机端 .task__actions 该是 display: flex（桌面端那层的 display: contents 是透明的）');
  h.assertTrue(/flex-wrap:\s*wrap/.test(rule.body),
    '.task__actions 自身也该能折行（按钮特别多时组内换行，而不是溢出）');
});

t('组内间距跟着行容器走：任务行 8px、其余 6px', function () {
  h.assertTrue(ruleFor('.task__row > .task__actions', 'gap: 8px') !== null,
    '任务行的动作区该用 8px 间距（和该行的 gap 一致，否则宽屏一行的疏密会变）');
  h.assertTrue(ruleFor('.task__actions', 'gap: 6px') !== null,
    '阶段 / 两个块头的动作区该用 6px 间距');
});

// ---------------------------------------------------------------------------
h.group('桌面端不受影响：这些都是手机端的规则');

t('动作区在桌面端是 display: contents（不生成盒子）', function () {
  // 宽屏一行放得下，多这一层盒子只会把原有的 gap 和对齐拆散 ——
  // 所以桌面端必须让它「透明」，等价于没有这层包裹
  h.assertTrue(/\.task__actions\s*\{\s*display:\s*contents/.test(SPLIT.desktop),
    '桌面端的 .task__actions 该是 display: contents');
  h.assertFalse(/\.task__actions\s*\{[^}]*display:\s*flex/.test(SPLIT.desktop),
    '桌面端的 .task__actions 不该变成 flex（会给宽屏多出一层盒子）');
});

t('折行 / flex-basis / margin-left 只写在移动端媒体查询里', function () {
  // 宽屏上一行放得下，多出来的折行只会让排版显得松散 ——
  // 所以这几条只该出现在 max-width: 600px 里
  h.assertFalse(/\.task__row\s*\{[^}]*flex-wrap/.test(SPLIT.desktop),
    '桌面端的 .task__row 不该折行');
  h.assertFalse(/\.task__text\s*\{[^}]*flex:\s*1\s+1\s+auto/.test(SPLIT.desktop),
    '桌面端的 .task__text 该保持 flex: 1（basis 0）');
  h.assertFalse(/\.task__text\s*\{[^}]*max-width:\s*calc\(/.test(SPLIT.desktop),
    '桌面端的 .task__text 不该有 max-width 上限（宽屏本来就放得下）');
});

// ---------------------------------------------------------------------------

h.summary('手机端排版（v2.10 需求 4 / v2.11 需求 1-2）');
