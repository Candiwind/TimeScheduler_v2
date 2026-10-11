/**
 * test-board-fold.js
 *
 * v2.13 需求：**每个板块都要能折叠 / 展开，并且下次进来保持上次的状态** ——
 * 明确点名了「四象限的每一个象限、时间视图的每一个时段块」。
 *
 * 和 v2.12 需求 10（六个大板块默认收起）是两件事，差别有三处，测试要一起钉住：
 *   1. **默认值相反**：象限 / 时段块默认**展开**（一进 App 就该看见今天的任务），
 *      六个大板块默认收起；
 *   2. **两张独立的表**：`collapsedBoards`（q:<象限> / tv:<时段>）与
 *      `collapsedPanels`（六个板块名）各存各的，互不影响；
 *   3. **渲染位置不同**：象限的折叠状态画在 `section.quadrant` 上、时段块画在
 *      `section.timeview__group` 上（六个板块是 `setCollapsedPanels` 在 DOM 上 toggle）。
 *
 * 这条需求点名的是手机端 APK，但代码两端同一份：这里测的就是那份代码
 * （网页版因此一起生效，代价是网页版折叠一格会在网格里留个空位 —— 见 DS 2.58）。
 *
 * 跑法：node test/test-board-fold.js
 */
'use strict';

var h = require('./harness');
var fs = require('fs');
var path = require('path');

var CONFIG = require('../js/config');
var Store = require('../js/store');
var TaskOps = require('../js/task-ops');
var Render = require('../js/render');

var t = h.test;
var ROOT = path.join(__dirname, '..');
var appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
var renderSrc = fs.readFileSync(path.join(ROOT, 'js', 'render.js'), 'utf8');
var storeSrc = fs.readFileSync(path.join(ROOT, 'js', 'store.js'), 'utf8');
var css = fs.readFileSync(path.join(ROOT, 'css', 'style.css'), 'utf8');
var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
var DATE = '2026-10-01';

function fresh() {
  var storage = h.createMemoryStorage();
  Store.init({ storage: storage, clock: function () { return 1759300000000; } });
  return storage;
}

/** 取一个函数的函数体（到下一个顶格 `}` 为止） */
function fnBody(src, name) {
  var start = src.indexOf('function ' + name + '(');
  if (start === -1) return '';
  var end = src.indexOf('\n  }', start);
  return src.slice(start, end === -1 ? src.length : end);
}

// ---------------------------------------------------------------------------
h.group('数据层：collapsedBoards 存得住、读得回、坏值不崩');

t('从没存过 → 空表（= 全展开，没有「默认收起」那回事）', function () {
  fresh();
  var f = Store.getFoldState();
  h.assertEqual(typeof f.collapsedBoards, 'object');
  h.assertEqual(Object.keys(f.collapsedBoards).length, 0,
    '象限 / 时段块该默认展开，所以从没记录过时是空表');
});

t('存进去能原样读回（q:I / tv:上午 两种键）', function () {
  fresh();
  Store.setFoldState({ collapsedBoards: { 'q:I': true, 'tv:上午': true } });
  var f = Store.getFoldState();
  h.assertEqual(f.collapsedBoards['q:I'], true);
  h.assertEqual(f.collapsedBoards['tv:上午'], true);
  h.assertEqual(f.collapsedBoards['q:II'], undefined, '没折叠的那格不该跟着一起折');
});

t('和 collapsedPanels 互不干扰（两张表各存各的）', function () {
  fresh();
  Store.setFoldState({
    collapsedPanels: { pool: true },
    collapsedBoards: { 'q:III': true }
  });
  var f = Store.getFoldState();
  h.assertEqual(f.collapsedPanels.pool, true);
  h.assertEqual(f.collapsedPanels['q:III'], undefined, '板的键不该跑进面板那张表');
  h.assertEqual(f.collapsedBoards['q:III'], true);
  h.assertEqual(f.collapsedBoards.pool, undefined, '面板名不该跑进板那张表');
});

t('值坏了（不是对象 / JSON 坏）→ 回空表，不崩', function () {
  var storage = fresh();
  storage.setItem(CONFIG.KEYS.foldState, JSON.stringify({ collapsedBoards: '不是对象' }));
  h.assertEqual(Object.keys(Store.getFoldState().collapsedBoards).length, 0);

  storage.setItem(CONFIG.KEYS.foldState, '{{{ 坏 JSON');
  h.assertEqual(Object.keys(Store.getFoldState().collapsedBoards).length, 0);
});

t('传空 / 缺字段 → 存成空表', function () {
  fresh();
  Store.setFoldState(null);
  h.assertEqual(Object.keys(Store.getFoldState().collapsedBoards).length, 0);
});

t('折叠状态只住 foldState 这一个 key，不碰主数据', function () {
  var storage = fresh();
  Store.setFoldState({ collapsedBoards: { 'q:IV': true } });
  h.assertEqual(storage.keys().join(','), CONFIG.KEYS.foldState,
    '除了 foldState 不该多出别的 key');
});

// ---------------------------------------------------------------------------
h.group('渲染：四个象限各一个折叠三角，折叠状态画在 section 上');

t('象限头上都有折叠三角，data-board = q:<象限 id>', function () {
  var data = Store.createEmpty();
  TaskOps.addTask(data, DATE, 'I', '任务甲');
  var day = Store.getDayTasks(data, DATE);
  var out = Render.buildDayHtml(day, { progressOf: TaskOps.progressOfItem });

  CONFIG.QUADRANT_IDS.forEach(function (qid) {
    h.assertTrue(out.indexOf('class="board__toggle" data-board="q:' + qid + '"') !== -1,
      qid + ' 的头上没有折叠三角');
  });
  h.assertEqual(out.split('board__toggle').length - 1, 4, '四个象限各一个，不多不少');
});

t('默认（没折叠）不画 is-collapsed', function () {
  var data = Store.createEmpty();
  TaskOps.addTask(data, DATE, 'I', '任务甲');
  var out = Render.buildDayHtml(Store.getDayTasks(data, DATE), {
    progressOf: TaskOps.progressOfItem
  });
  h.assertFalse(out.indexOf('is-collapsed') !== -1, '默认该是全部展开');
});

t('折叠了哪个象限，就只有那个象限带 is-collapsed', function () {
  var data = Store.createEmpty();
  TaskOps.addTask(data, DATE, 'I', '任务甲');
  var out = Render.buildDayHtml(Store.getDayTasks(data, DATE), {
    progressOf: TaskOps.progressOfItem,
    collapsedBoards: { 'q:I': true }
  });

  h.assertTrue(/class="quadrant quadrant--I is-collapsed"/.test(out),
    '折叠的 I 象限该带上 is-collapsed');
  h.assertFalse(/class="quadrant quadrant--II is-collapsed"/.test(out),
    '没折叠的 II 象限不该跟着折');
  h.assertTrue(out.indexOf('aria-expanded="false"') !== -1,
    '折叠时三角的 aria-expanded 该是 false');
});

t('折叠时内容照旧画在 DOM 里（只是 CSS 藏起来）', function () {
  var data = Store.createEmpty();
  TaskOps.addTask(data, DATE, 'I', '折叠也别丢内容');
  var out = Render.buildDayHtml(Store.getDayTasks(data, DATE), {
    progressOf: TaskOps.progressOfItem,
    collapsedBoards: { 'q:I': true }
  });
  h.assertTrue(out.indexOf('折叠也别丢内容') !== -1,
    '折叠是纯界面动作，内容该照旧渲染（展开时不用补画）');
});

// ---------------------------------------------------------------------------
h.group('渲染：时间视图每个时段块各一个折叠三角');

t('每个时段块头上一个三角，data-board = tv:<时段>；折叠只影响那一块', function () {
  var data = Store.createEmpty();
  TaskOps.addTask(data, DATE, 'I', '早上的事', new Date(2026, 9, 1, 7, 0));   // 早上
  TaskOps.addTask(data, DATE, 'I', '晚上的事', new Date(2026, 9, 1, 21, 0));  // 晚上
  var groups = TaskOps.getTimeView(data, DATE);

  var out = Render.buildTimeViewHtml(groups, {});
  h.assertTrue(out.indexOf('class="board__toggle" data-board="tv:早上"') !== -1);
  h.assertTrue(out.indexOf('class="board__toggle" data-board="tv:晚上"') !== -1);
  h.assertFalse(out.indexOf('is-collapsed') !== -1, '默认不折叠');

  var folded = Render.buildTimeViewHtml(groups, { collapsedBoards: { 'tv:早上': true } });
  h.assertTrue(folded.indexOf('class="timeview__group is-collapsed" data-slot="早上"') !== -1);
  h.assertFalse(folded.indexOf('class="timeview__group is-collapsed" data-slot="晚上"') !== -1);
  h.assertTrue(folded.indexOf('早上的事') !== -1 && folded.indexOf('晚上的事') !== -1,
    '两块的内容都还在 DOM 里');
});

t('条数照旧画（折叠不影响 count）', function () {
  var data = Store.createEmpty();
  TaskOps.addTask(data, DATE, 'I', '早上的事', new Date(2026, 9, 1, 7, 0));
  var groups = TaskOps.getTimeView(data, DATE);
  var out = Render.buildTimeViewHtml(groups, { collapsedBoards: { 'tv:早上': true } });
  h.assertTrue(out.indexOf('<span class="timeview__count">1</span>') !== -1);
});

// ---------------------------------------------------------------------------
h.group('接线：toggleBoard 的白名单、落盘与重画');

t('toggleBoard 只认 q:<象限> / tv:<时段>，脏键忽略', function () {
  var body = fnBody(appSrc, 'toggleBoard');
  h.assertTrue(body.indexOf('CONFIG.QUADRANT_IDS.indexOf(parts[1])') !== -1,
    '象限 id 该对着 CONFIG.QUADRANT_IDS 校验');
  h.assertTrue(body.indexOf('CONFIG.SLOTS.indexOf(parts[1])') !== -1,
    '时段名该对着 CONFIG.SLOTS 校验');
  h.assertTrue(body.indexOf('parts.length !== 2') !== -1, '格式不对先挡掉');
  h.assertTrue(body.indexOf('persistFoldState()') !== -1, '翻完要落本机（刷新后保持）');
  h.assertTrue(body.indexOf('renderCurrent()') !== -1, '翻完要重画');
});

t('persistFoldState 把 collapsedBoards 一起存了', function () {
  var body = fnBody(appSrc, 'persistFoldState');
  h.assertTrue(body.indexOf('collapsedBoards: state.collapsedBoards') !== -1);
  h.assertTrue(body.indexOf('collapsedPanels: state.collapsedPanels') !== -1,
    '六个板块那张表照旧一起存（两张表都要）');
});

t('开机把它读回来（不读回来，重启就白记了）', function () {
  h.assertTrue(appSrc.indexOf('state.collapsedBoards = fold.collapsedBoards || {}') !== -1);
});

t('renderCurrent 把 collapsedBoards 传给象限和时间视图两边', function () {
  var body = fnBody(appSrc, 'renderCurrent');
  h.assertTrue(body.indexOf('collapsedBoards: state.collapsedBoards') !== -1,
    'Render.render 的 view 里没带折叠状态');
  h.assertTrue(body.split('collapsedBoards: state.collapsedBoards').length - 1 >= 2,
    'renderTimeView 那边也要带上（时段块各收各的）');
});

t('象限与时间视图两处点击分流都认 board__toggle，且排在删除 / 编辑之前', function () {
  ['bindQuadrants', 'bindTimeView'].forEach(function (fn) {
    var body = fnBody(appSrc, fn);
    h.assertTrue(body.indexOf("closest(target, 'board__toggle')") !== -1,
      fn + ' 里没接折叠三角');
    h.assertTrue(body.indexOf('toggleBoard(') !== -1, fn + ' 里没调 toggleBoard');
    h.assertTrue(body.indexOf("closest(target, 'board__toggle')") < body.indexOf("closest(target, 'task__del')"),
      fn + ' 里折叠三角该排在删除键之前判');
    h.assertTrue(body.indexOf('commitEdit()') < body.indexOf('toggleBoard('),
      fn + ' 里该先把手上没提交的编辑落下，再折叠');
  });
});

t('板不和双击高亮抢手势（落在按钮上不记落点）', function () {
  // isControlNode 认得 BUTTON —— 折叠三角是 <button>，双击它不会标高亮
  h.assertTrue(appSrc.indexOf("tag === 'BUTTON'") !== -1);
});

// ---------------------------------------------------------------------------
h.group('样式：折叠只留标题栏，且三角在保护模式下照常能点');

t('两处内容折起来就藏（象限体 / 时段块列表）', function () {
  h.assertTrue(/\.quadrant\.is-collapsed\s+\.quadrant__body[^{]*\{[^}]*display:\s*none/.test(css),
    '折叠的象限该把 .quadrant__body 藏起来');
  h.assertTrue(/\.timeview__group\.is-collapsed\s+\.timeview__list[^{]*\{[^}]*display:\s*none/.test(css),
    '折叠的时段块该把 .timeview__list 藏起来');
});

t('.board__toggle 有样式、折叠时三角转朝右', function () {
  h.assertTrue(css.indexOf('.board__toggle {') !== -1);
  h.assertTrue(css.indexOf('.is-collapsed .board__toggle') !== -1);
});

t('.board__toggle 不在保护模式名单里（它是纯界面动作）', function () {
  var m = /body\.is-readonly[^{]*\{([^}]*)\}/.exec(css);
  var list = m ? m[1] : '';
  h.assertFalse(list.indexOf('board__toggle') !== -1,
    '折叠不发写操作，保护模式下该照常能点（同 .panel__toggle）');
});

t('象限头部不再用 space-between（多了个三角，名字会被推到中间）', function () {
  var head = /\.quadrant__head\s*\{([^}]*)\}/.exec(css);
  h.assertTrue(head !== null, '找不到 .quadrant__head 的规则');
  h.assertFalse(/justify-content:\s*space-between/.test(head[1]),
    '三个子项 + space-between 会把象限名推到中间');
  h.assertTrue(/margin-left:\s*auto/.test(/\.quadrant__tools\s*\{([^}]*)\}/.exec(css)[1]),
    '改成「工具区自己顶到最右」');
});

t('页面结构没被这一步改坏（象限 / 时间视图都还在）', function () {
  h.assertTrue(html.indexOf('id="quadrants"') !== -1 && html.indexOf('id="timeview"') !== -1);
  h.assertTrue(renderSrc.indexOf('function boardToggleHtml') !== -1);
  h.assertTrue(storeSrc.indexOf('collapsedBoards') !== -1);
});

// ---------------------------------------------------------------------------

h.summary('每个板块都能折叠 / 展开且记住状态（v2.13 需求）');
