/**
 * test-render.js
 *
 * 检查 render.js 里「拼 HTML」的那部分（见 DS 3.2）。
 *
 * 这是整个项目里**最需要自动测试**的一块：任务文本和阶段文本都是用户随手
 * 输入的，一旦漏了转义，`<img src=x onerror=...>` 这种文本就会变成真的标签。
 * 而这类问题在手工点页面时几乎不可能被发现 —— 你得刚好输入一段恶意文本。
 *
 * 跑法：node test/test-render.js
 */
'use strict';

var h = require('./harness');
var Render = require('../js/render');
var TaskOps = require('../js/task-ops');
var CONFIG = require('../js/config');

var t = h.test;

// 真实运行时是 app.js 把 TaskOps.getProgress 传进来的，测试里也照着来 ——
// 进度必须只有一份实现（见 render.js 里 fallbackProgress 的说明）
function view(extra) {
  var base = { progressOf: TaskOps.getProgress };
  for (var k in extra) base[k] = extra[k];
  return base;
}

function task(text, completed) {
  return {
    id: 'id_task_0001',
    text: text,
    completed: !!completed,
    createdAt: 1759300000000
  };
}

/** 造一条带阶段的任务 */
function stagedTask(text, stages) {
  var task = { id: 'id_staged_1', text: text, completed: false, createdAt: 0, stages: [] };
  for (var i = 0; i < stages.length; i++) {
    var item = stages[i];
    var looksLikeStage = item !== null && typeof item === 'object';
    task.stages.push({
      id: 'id_stage_' + i,
      text: looksLikeStage ? item.text : item,
      completed: looksLikeStage ? item.completed === true : false,
      createdAt: 0
    });
  }
  return task;
}

// ---------------------------------------------------------------------------
h.group('任务 HTML 的转义（最重要的一组）');

t('尖括号被转义，不会变成真标签', function () {
  var html = Render.buildTaskHtml(task('<script>alert(1)</script>'), view());
  h.assertFalse(html.indexOf('<script>') !== -1, '原始 <script> 标签不该出现在结果里');
  h.assertTrue(html.indexOf('&lt;script&gt;') !== -1, '应该被转义');
});

t('img onerror 这种也挡住', function () {
  var html = Render.buildTaskHtml(task('<img src=x onerror=alert(1)>'), view());
  h.assertFalse(html.indexOf('<img') !== -1);
  h.assertTrue(html.indexOf('&lt;img') !== -1);
});

t('双引号被转义，不会打断属性', function () {
  var html = Render.buildTaskHtml({
    id: 'id_x" onmouseover="alert(1)',
    text: '正常文本',
    completed: false,
    createdAt: 0
  }, view());
  h.assertFalse(html.indexOf('onmouseover="alert(1)"') !== -1,
    'data-id 里的引号必须被转义，否则能注入属性');
  h.assertTrue(html.indexOf('&quot;') !== -1);
});

t('单引号和 & 也转义', function () {
  var html = Render.buildTaskHtml(task("a'b & c"), view());
  h.assertTrue(html.indexOf('&#39;') !== -1);
  h.assertTrue(html.indexOf('&amp;') !== -1);
});

t('普通中文原样保留', function () {
  var html = Render.buildTaskHtml(task('写季度报告'), view());
  h.assertTrue(html.indexOf('写季度报告') !== -1);
});

// ---------------------------------------------------------------------------
h.group('完成态');

t('未完成的任务不带 task--done', function () {
  h.assertFalse(Render.buildTaskHtml(task('x', false), view()).indexOf('task--done') !== -1);
});

t('完成的任务带 task--done，且 checkbox 是选中状态', function () {
  var html = Render.buildTaskHtml(task('x', true), view());
  h.assertTrue(html.indexOf('task--done') !== -1);
  h.assertTrue(html.indexOf('checked') !== -1);
});

t('任务 id 挂在 data-id 上，供后续操作用', function () {
  h.assertTrue(Render.buildTaskHtml(task('x'), view()).indexOf('data-id="id_task_0001"') !== -1);
});

// ---------------------------------------------------------------------------
h.group('带阶段的任务');

t('没阶段的任务不显示进度', function () {
  // 显示「0/1」是废话
  var html = Render.buildTaskHtml(task('回邮件'), view());
  h.assertFalse(html.indexOf('task__progress') !== -1);
});

t('有阶段的任务显示进度 3/5', function () {
  var task5 = stagedTask('写季度报告', [
    { text: '收集数据', completed: true },
    { text: '写初稿', completed: true },
    { text: '补充数据', completed: true },
    { text: '审阅', completed: false },
    { text: '定稿', completed: false }
  ]);
  var html = Render.buildTaskHtml(task5, view());
  h.assertTrue(html.indexOf('>3/5</span>') !== -1, '应该显示 3/5');
});

t('全完成时进度变色，任务本身也带 task--done', function () {
  var done = stagedTask('准备分享', [
    { text: '列大纲', completed: true },
    { text: '写稿', completed: true }
  ]);
  var html = Render.buildTaskHtml(done, view());
  h.assertTrue(html.indexOf('2/2') !== -1);
  h.assertTrue(html.indexOf('task__progress--done') !== -1);
  h.assertTrue(html.indexOf('task--done') !== -1);
});

t('有阶段时，任务上的勾选框是「全选 / 全不选」，无障碍标签要改口', function () {
  var html = Render.buildTaskHtml(stagedTask('写报告', ['一']), view());
  h.assertTrue(html.indexOf('aria-label="全部勾选或取消"') !== -1,
    '有阶段时不能再念「标记完成」，否则用户以为是勾这一条');
});

t('没阶段时，无障碍标签还是「标记完成」', function () {
  var html = Render.buildTaskHtml(task('回邮件'), view());
  h.assertTrue(html.indexOf('aria-label="标记完成"') !== -1);
});

t('有阶段时勾选框的勾选状态 = 所有阶段都完成了', function () {
  var partial = stagedTask('半途', [
    { text: '一', completed: true }, { text: '二', completed: false }
  ]);
  h.assertFalse(Render.buildTaskHtml(partial, view()).indexOf('checked') !== -1);

  var full = stagedTask('完成了', [
    { text: '一', completed: true }, { text: '二', completed: true }
  ]);
  h.assertTrue(Render.buildTaskHtml(full, view()).indexOf('checked') !== -1);
});

t('阶段文本也要转义', function () {
  var nasty = stagedTask('任务', [{ text: '<img src=x onerror=alert(1)>' }]);
  var html = Render.buildTaskHtml(nasty, view({ expanded: { id_staged_1: true } }));
  h.assertFalse(html.indexOf('<img') !== -1);
  h.assertTrue(html.indexOf('&lt;img') !== -1);
});

// ---------------------------------------------------------------------------
h.group('展开 / 折叠');

t('默认折叠：不渲染阶段列表', function () {
  var html = Render.buildTaskHtml(stagedTask('写报告', ['收集数据']), view());
  h.assertFalse(html.indexOf('收集数据') !== -1, '折叠时阶段不该出现在 HTML 里');
  h.assertFalse(html.indexOf('class="stages"') !== -1);
});

t('折叠时三角是 ▸，展开时是 ▾', function () {
  var folded = Render.buildTaskHtml(stagedTask('x', ['一']), view());
  h.assertTrue(folded.indexOf('▸') !== -1);
  h.assertTrue(folded.indexOf('aria-expanded="false"') !== -1);

  var open = Render.buildTaskHtml(stagedTask('x', ['一']),
    view({ expanded: { id_staged_1: true } }));
  h.assertTrue(open.indexOf('▾') !== -1);
  h.assertTrue(open.indexOf('aria-expanded="true"') !== -1);
});

t('展开后能看到所有阶段', function () {
  var html = Render.buildTaskHtml(
    stagedTask('写季度报告', ['收集数据', '写初稿', '审阅']),
    view({ expanded: { id_staged_1: true } }));

  h.assertTrue(html.indexOf('收集数据') !== -1);
  h.assertTrue(html.indexOf('写初稿') !== -1);
  h.assertTrue(html.indexOf('审阅') !== -1);
  h.assertTrue(html.indexOf('class="stages"') !== -1);
});

t('展开后能看到阶段，末尾不再有「＋ 添加阶段」那一行', function () {
  var html = Render.buildTaskHtml(stagedTask('x', ['一']),
    view({ expanded: { id_staged_1: true } }));
  h.assertFalse(html.indexOf('stage-add__btn') !== -1, '添加阶段的入口挪到任务行右上角了');
  h.assertFalse(html.indexOf('＋ 添加阶段') !== -1);
});

t('没有阶段的任务不显示展开三角', function () {
  var html = Render.buildTaskHtml(task('回邮件'), view());
  h.assertFalse(html.indexOf('task__toggle') !== -1,
    '没阶段的任务展开是空的，不该给一个点了没反应的三角');
});

t('只展开指定的那条，别的还是折叠的', function () {
  var a = stagedTask('展开的', ['甲的阶段']);
  a.id = 'id_a';
  var b = stagedTask('折叠的', ['乙的阶段']);
  b.id = 'id_b';

  var html = Render.buildQuadrantHtml('I', [a, b], view({ expanded: { id_a: true } }));

  h.assertTrue(html.indexOf('甲的阶段') !== -1);
  h.assertFalse(html.indexOf('乙的阶段') !== -1);
});

// ---------------------------------------------------------------------------
h.group('阶段排序只靠拖拽（不再有上下箭头）');

t('阶段行里没有上移 / 下移按钮', function () {
  var html = Render.buildTaskHtml(stagedTask('x', ['一', '二']),
    view({ expanded: { id_staged_1: true } }));
  h.assertFalse(html.indexOf('stage__move') !== -1, '不该再有上移/下移按钮');
  h.assertFalse(html.indexOf('data-dir="up"') !== -1);
  h.assertFalse(html.indexOf('data-dir="down"') !== -1);
});

// ---------------------------------------------------------------------------
h.group('添加阶段按钮（任务右上角，见 DS 2.9）');

t('每个任务右上角都有添加阶段的小按钮', function () {
  var html = Render.buildTaskHtml(task('回邮件'), view());
  h.assertTrue(html.indexOf('task__add-stage') !== -1);
  h.assertTrue(html.indexOf('title="添加阶段"') !== -1);
  h.assertTrue(html.indexOf('aria-label="添加阶段"') !== -1);
});

t('按钮在任务行里，不在阶段列表末尾', function () {
  var html = Render.buildTaskHtml(stagedTask('x', ['一']),
    view({ expanded: { id_staged_1: true } }));
  var rowEnd = html.indexOf('</div>');
  var addStage = html.indexOf('task__add-stage');
  h.assertTrue(addStage < rowEnd, '按钮必须在任务行（第一个 </div> 之前）');
});

t('有阶段的任务也有这个按钮', function () {
  var html = Render.buildTaskHtml(stagedTask('x', ['一', '二']), view());
  h.assertTrue(html.indexOf('task__add-stage') !== -1);
});

// ---------------------------------------------------------------------------
h.group('象限 HTML');

t('空象限显示空状态，不显示空的 ul', function () {
  var html = Render.buildQuadrantHtml('I', [], view());
  h.assertTrue(html.indexOf('暂无任务') !== -1);
  h.assertFalse(html.indexOf('<ul class="tasks">') !== -1);
});

t('象限缺数据时按空处理，不报错', function () {
  h.assertTrue(Render.buildQuadrantHtml('I', undefined, view()).indexOf('暂无任务') !== -1);
});

t('有任务时画成列表', function () {
  var html = Render.buildQuadrantHtml('II', [task('一'), task('二', true)], view());
  h.assertTrue(html.indexOf('<ul class="tasks">') !== -1);
  h.assertFalse(html.indexOf('暂无任务') !== -1);
});

t('象限标题栏的数字和顶部统计用同一套口径（按最细的可勾选单位）', function () {
  // 3 条没阶段且没勾的任务 → 0/3，不是「3」
  var html = Render.buildQuadrantHtml('I', [task('一'), task('二'), task('三')], view());
  h.assertTrue(html.indexOf('>0/3</span>') !== -1);
});

t('象限里有带阶段的任务时，数字按阶段数算', function () {
  // 一条 5 个阶段勾了 3 个，加一条没阶段没勾的
  var staged = stagedTask('大任务', [
    { text: '1', completed: true }, { text: '2', completed: true },
    { text: '3', completed: true }, { text: '4', completed: false },
    { text: '5', completed: false }
  ]);
  var html = Render.buildQuadrantHtml('I', [staged, task('小任务')], view());

  // 5 个阶段 + 1 条普通任务 = 6 个单位，完成 3 个
  h.assertTrue(html.indexOf('>3/6</span>') !== -1);
});

t('空的象限不显示 0/0', function () {
  h.assertFalse(Render.buildQuadrantHtml('I', [], view()).indexOf('0/0') !== -1);
});

t('象限名和 id 都画出来了', function () {
  var html = Render.buildQuadrantHtml('III', [], view());
  h.assertTrue(html.indexOf('紧急不重要') !== -1);
  h.assertTrue(html.indexOf('III') !== -1);
});

t('不认识的象限 id 返回空字符串，而不是崩掉', function () {
  h.assertEqual(Render.buildQuadrantHtml('IX', [], view()), '');
});

// ---------------------------------------------------------------------------
h.group('整天的 HTML');

t('四个象限齐全，顺序是 I II III IV', function () {
  var html = Render.buildDayHtml({ I: [], II: [], III: [], IV: [] }, view());
  var posI = html.indexOf('data-quadrant="I"');
  var posII = html.indexOf('data-quadrant="II"');
  var posIII = html.indexOf('data-quadrant="III"');
  var posIV = html.indexOf('data-quadrant="IV"');
  h.assertTrue(posI < posII && posII < posIII && posIII < posIV);
});

t('day 为 null 时也能画出四个空象限', function () {
  var html = Render.buildDayHtml(null, view());
  h.assertEqual((html.match(/class="quadrant /g) || []).length, 4);
});

t('每个象限都带添加按钮（＋ 任务、▣ 任务块）', function () {
  var html = Render.buildDayHtml({ I: [], II: [], III: [], IV: [] }, view());
  // v1.1：一个象限两个按钮 —— 「＋」加任务、「▣」加任务块（见 DS 2.10）。
  // quadrant__add-block 的类名里包含 quadrant__add 这个子串，必须按完整类名数
  h.assertEqual((html.match(/class="quadrant__add"/g) || []).length, 4);
  h.assertEqual((html.match(/class="quadrant__add-block"/g) || []).length, 4);
});

// ---------------------------------------------------------------------------
h.group('添加按钮的位置（见 D-30）');

t('按钮在标题栏里，不在象限底部', function () {
  var html = Render.buildQuadrantHtml('I', [task('任务一')], view());
  var headEnd = html.indexOf('</header>');
  var bodyStart = html.indexOf('quadrant__body');
  var btn = html.indexOf('quadrant__add');
  h.assertTrue(btn < headEnd, '按钮必须在标题栏结束之前');
  h.assertTrue(btn < bodyStart, '按钮不该在任务列表后面');
});

t('按钮只显示一个「＋」，所以必须有 aria-label 说明用途', function () {
  var html = Render.buildQuadrantHtml('III', [], view());
  h.assertTrue(html.indexOf('aria-label="在「') !== -1);
  h.assertTrue(html.indexOf('title="添加任务"') !== -1);
});

t('象限内容区不再有第二个添加按钮', function () {
  var html = Render.buildQuadrantHtml('IV', [], view());
  var bodyStart = html.indexOf('quadrant__body');
  var bodyEnd = html.indexOf('</div>', bodyStart);
  h.assertEqual(html.slice(bodyStart, bodyEnd).indexOf('quadrant__add'), -1);
});

// ---------------------------------------------------------------------------
h.group('编辑状态');

t('新增任务时，象限末尾多一个空输入框', function () {
  var html = Render.buildQuadrantHtml('I', [task('已有的一条')],
    view({ editing: { quadrantId: 'I', mode: 'add' } }));
  h.assertTrue(html.indexOf('task__input') !== -1);
  h.assertTrue(html.indexOf('task--new') !== -1);
});

t('新增任务时即使一条都没有，也不显示「暂无任务」', function () {
  var html = Render.buildQuadrantHtml('I', [], view({ editing: { quadrantId: 'I', mode: 'add' } }));
  h.assertFalse(html.indexOf('暂无任务') !== -1);
  h.assertTrue(html.indexOf('task__input') !== -1);
});

t('改任务文字时，只有那一条换成输入框', function () {
  var a = task('要改的'); a.id = 'id_aaa';
  var b = task('不动的'); b.id = 'id_bbb';

  var html = Render.buildQuadrantHtml('I', [a, b],
    view({ editing: { quadrantId: 'I', mode: 'edit-task', taskId: 'id_aaa' } }));

  h.assertEqual((html.match(/task__input/g) || []).length, 1);
  h.assertTrue(html.indexOf('value="要改的"') !== -1);
  h.assertTrue(html.indexOf('不动的') !== -1);
});

t('编辑任务时输入框里的引号也转义', function () {
  var x = task('他说"你好"'); x.id = 'id_ccc';
  var html = Render.buildQuadrantHtml('I', [x],
    view({ editing: { quadrantId: 'I', mode: 'edit-task', taskId: 'id_ccc' } }));
  h.assertFalse(html.indexOf('value="他说"你好""') !== -1);
  h.assertTrue(html.indexOf('&quot;') !== -1);
});

t('编辑状态只作用于指定象限', function () {
  var day = { I: [task('一的')], II: [task('二的')], III: [], IV: [] };
  var html = Render.buildDayHtml(day, view({ editing: { quadrantId: 'II', mode: 'add' } }));

  h.assertEqual((html.match(/task__input/g) || []).length, 1);
  var q2 = html.indexOf('data-quadrant="II"');
  var q3 = html.indexOf('data-quadrant="III"');
  var input = html.indexOf('task__input');
  h.assertTrue(input > q2 && input < q3);
});

t('没有编辑状态时，一条输入框都不该出现', function () {
  var day = { I: [task('一的')], II: [], III: [], IV: [] };
  h.assertFalse(Render.buildDayHtml(day, view()).indexOf('task__input') !== -1);
});

// ---------------------------------------------------------------------------
h.group('编辑阶段');

t('给某个任务加阶段时，它的阶段列表末尾挂一个空输入框', function () {
  var html = Render.buildTaskHtml(stagedTask('写报告', ['已有的']), view({
    expanded: { id_staged_1: true },
    editing: { quadrantId: 'I', mode: 'add-stage', taskId: 'id_staged_1' }
  }));

  h.assertTrue(html.indexOf('stage__input') !== -1);
  h.assertTrue(html.indexOf('stage--new') !== -1);
});

t('改阶段文字时，只有那一条换成输入框', function () {
  var task5 = stagedTask('写报告', ['要改的', '不动的']);
  var html = Render.buildTaskHtml(task5, view({
    expanded: { id_staged_1: true },
    editing: { quadrantId: 'I', mode: 'edit-stage', taskId: 'id_staged_1', stageId: 'id_stage_0' }
  }));

  h.assertEqual((html.match(/stage__input/g) || []).length, 1);
  h.assertTrue(html.indexOf('value="要改的"') !== -1);
  h.assertTrue(html.indexOf('不动的') !== -1);
});

t('正在编辑阶段时，即使在给别的任务加阶段，互不干扰', function () {
  var a = stagedTask('甲', ['甲的阶段']);
  a.id = 'id_a';
  var b = stagedTask('乙', ['乙的阶段']);
  b.id = 'id_b';

  var html = Render.buildQuadrantHtml('I', [a, b], view({
    expanded: { id_a: true, id_b: true },
    editing: { quadrantId: 'I', mode: 'edit-stage', taskId: 'id_a', stageId: 'id_stage_0' }
  }));

  h.assertEqual((html.match(/stage__input/g) || []).length, 1, '只该有一个输入框');
});

// ---------------------------------------------------------------------------
h.group('完成率');

t('一条任务都没有时不能除以零', function () {
  h.assertEqual(Render.formatRate(0, 0), '—');
});

t('正常计算', function () {
  h.assertEqual(Render.formatRate(0, 4), '0%');
  h.assertEqual(Render.formatRate(1, 2), '50%');
  h.assertEqual(Render.formatRate(4, 4), '100%');
});

t('四舍五入到整数', function () {
  h.assertEqual(Render.formatRate(1, 3), '33%');
  h.assertEqual(Render.formatRate(2, 3), '67%');
});

// ---------------------------------------------------------------------------
h.group('象限定义和 DS 对得上');

t('四个象限的 id 是 I II III IV', function () {
  h.assertEqual(CONFIG.QUADRANT_IDS.join(','), 'I,II,III,IV');
});

t('每个象限都有名字和颜色', function () {
  for (var i = 0; i < CONFIG.QUADRANTS.length; i++) {
    var q = CONFIG.QUADRANTS[i];
    h.assertTrue(!!q.name, q.id + ' 缺名字');
    h.assertTrue(/^#[0-9a-f]{6}$/i.test(q.color), q.id + ' 的颜色格式不对');
  }
});

// ---------------------------------------------------------------------------
h.group('任务块（v1.1，见 DS 2.10）');

/** 造一个块；children 是任务对象数组 */
function blk(text, children, completed) {
  return {
    id: 'id_block_0001',
    type: 'block',
    text: text,
    completed: !!completed,
    createdAt: 0,
    tasks: children || []
  };
}

// 块的进度要按块内最细单位算，块视图一律传 progressOfItem（和 app.js 同款）
function blockView(extra) {
  extra = extra || {};
  extra.progressOf = TaskOps.progressOfItem;
  return view(extra);
}

t('块头：勾选框 + 块名 + 进度 + 折叠三角 + 删除，块 id 挂在 data-id 上', function () {
  var html = Render.buildBlockHtml(blk('晨间例程', [task('喝水')]), blockView());
  h.assertTrue(html.indexOf('block__check') !== -1, '要有块勾选框');
  h.assertTrue(html.indexOf('block__name') !== -1, '要有块名');
  h.assertTrue(html.indexOf('block__toggle') !== -1, '要有折叠三角');
  h.assertTrue(html.indexOf('block__del') !== -1, '要有删除按钮');
  h.assertTrue(html.indexOf('data-id="id_block_0001"') !== -1, '块 id 要挂 data-id');
});

t('块名转义', function () {
  var html = Render.buildBlockHtml(blk('<b>名</b>'), blockView());
  h.assertFalse(html.indexOf('<b>名</b>') !== -1, '原始标签不该出现');
  h.assertTrue(html.indexOf('&lt;b&gt;名&lt;/b&gt;') !== -1);
});

t('块内任务复用任务的 HTML（task__row），一个算法两种条目', function () {
  var html = Render.buildBlockHtml(blk('块', [task('喝水')]), blockView());
  h.assertTrue(html.indexOf('task__row') !== -1, '块内应该出现任务的行结构');
  h.assertTrue(html.indexOf('喝水') !== -1);
});

t('块的进度按块内最细单位聚合，不全完成时不带 block--done', function () {
  var b = blk('块', [
    stagedTask('带步骤', [{ text: '一', completed: true }, { text: '二', completed: false }]),
    task('独立', true)
  ]);
  var html = Render.buildBlockHtml(b, blockView());
  h.assertTrue(html.indexOf('2/3') !== -1, '阶段 2 条 + 任务 1 条 = 3，完成 2');
  h.assertFalse(html.indexOf('block--done') !== -1);
});

t('块内全完成 → block--done，勾选框选中', function () {
  var b = blk('块', [task('甲', true)], true);
  var html = Render.buildBlockHtml(b, blockView());
  h.assertTrue(html.indexOf('block--done') !== -1);
  h.assertTrue(html.indexOf('checked') !== -1);
});

t('空块：给一句「把任务拖进来」，勾选框不选中（空块不算完成）', function () {
  var html = Render.buildBlockHtml(blk('空块'), blockView());
  h.assertTrue(html.indexOf('block__empty') !== -1);
  h.assertTrue(html.indexOf('把任务拖进来') !== -1);
  h.assertFalse(/block__check[^>]*checked/.test(html), '空块不该是选中态');
});

t('默认展开：有 ▾ 和块内列表', function () {
  var html = Render.buildBlockHtml(blk('块', [task('甲')]), blockView());
  h.assertTrue(html.indexOf('block__tasks') !== -1);
  h.assertTrue(html.indexOf('▾') !== -1);
  h.assertTrue(html.indexOf('aria-expanded="true"') !== -1);
});

t('折叠的块：没有块内列表，三角变 ▸（块的默认态是展开，见 D-36）', function () {
  var html = Render.buildBlockHtml(blk('块', [task('甲')]),
    blockView({ collapsedBlocks: { id_block_0001: true } }));
  h.assertFalse(html.indexOf('block__tasks') !== -1, '折叠了就不该画块内列表');
  h.assertTrue(html.indexOf('▸') !== -1);
  h.assertTrue(html.indexOf('aria-expanded="false"') !== -1);
});

t('改块名：整条收成输入框，带原值', function () {
  var html = Render.buildBlockHtml(blk('旧名'),
    blockView({ editing: { mode: 'edit-block', quadrantId: 'I', blockId: 'id_block_0001' } }));
  h.assertTrue(html.indexOf('block--editing') !== -1);
  h.assertTrue(html.indexOf('task__input') !== -1, '输入框复用 task__input');
  h.assertTrue(html.indexOf('value="旧名"') !== -1);
  h.assertFalse(html.indexOf('block__head') !== -1, '编辑态不该还有块头');
});

t('别的块在改名时，这个块照常显示', function () {
  var html = Render.buildBlockHtml(blk('没在改的'),
    blockView({ editing: { mode: 'edit-block', quadrantId: 'I', blockId: 'id_别的块' } }));
  h.assertTrue(html.indexOf('block__head') !== -1);
  h.assertTrue(html.indexOf('没在改的') !== -1);
});

t('新增块：输入框出现在象限末尾（buildQuadrantHtml 的 add-block 模式）', function () {
  var html = Render.buildQuadrantHtml('I', [],
    view({ editing: { mode: 'add-block', quadrantId: 'I' }, progressOf: TaskOps.progressOfItem }));
  h.assertTrue(html.indexOf('block--new') !== -1);
  h.assertTrue(html.indexOf('输入任务块名称') !== -1, '占位提示要说清这是块');
});

t('象限标题栏计数和块同口径：块内 2 条算 2，不算壳', function () {
  var html = Render.buildQuadrantHtml('I',
    [blk('块', [task('甲'), task('乙', true)])],
    view({ progressOf: TaskOps.progressOfItem }));
  h.assertTrue(html.indexOf('1/2') !== -1, '标题栏该显示 1/2');
});

// ---------------------------------------------------------------------------

h.summary('render.js 的 HTML 生成');
