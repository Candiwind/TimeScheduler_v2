/**
 * drag.js —— 拖着任务/任务块换位置、换象限；拖着阶段在任务内部换顺序
 *
 * 加载顺序：第 9 个（见 DS 1.4）。
 *
 * ────────────────────────────────────────────────────────────────────────
 * 为什么用 Pointer Events，而不是 HTML5 拖拽（见 D-26）
 *
 * HTML5 那套（draggable + dragstart/dragover/drop）在 Android WebView 的
 * 触摸下**根本不触发** —— 只用它等于移动端没有拖拽。Pointer Events 一套代码
 * 同时覆盖鼠标和触摸，成本并不更高。
 *
 * ────────────────────────────────────────────────────────────────────────
 * 这个文件只干两件事：**算出要放到哪**、**把手指/鼠标的动作接住**。
 * 真正的移动由 task-ops.js 的 moveItem / moveStage 完成 —— 那是数据的事。
 *
 * ────────────────────────────────────────────────────────────────────────
 * 三种拖拽共用一套机制，只在两处不同：
 *
 *   拖什么    落点找谁                                    能不能跨出去
 *   ────────  ─────────────────────────────────────────  ──────────────
 *   任务      指针底下：块头→进块末尾；块内条目→块内       能，四个象限随便拖
 *            位置；其余→指针底下那个象限的顶层
 *   块        指针底下那个象限的**顶层**（规矩 1：         能，四个象限随便拖
 *            块里不许套块，见 DS 2.10）
 *   阶段      被拖那条自己所属的列表                      不能，只能在同一个任务内部挪
 *   池内任务  指针底下那个象限的**顶层**（计划池一期）      能，只做「池 → 象限」；
 *                                                      往池里拖不允许（见 DS 2.11）
 *
 * 阶段不能跨任务，所以它的落点列表在按下的那一刻就定死了，不用跟着指针找。
 * 任务和块跟着指针走，但要认准象限里的 `.tasks` 这一层 ——
 * 块自己的 `.block__tasks` 里的 rect 绝不能混进顶层排序，否则 index 全乱。
 */
var Drag = (function (CONFIG, Util) {
  'use strict';

  // =========================================================================
  // 纯函数：算落点
  // =========================================================================

  /**
   * 指针落在纵向的哪个位置 → 应该插到第几位。
   *
   * @param {Array} rects 每个兄弟元素的 { top, height }，**按渲染顺序**，
   *                      而且**已经排除了正在被拖的那个和占位符**
   * @param {number} y    指针的纵坐标
   * @returns {number}    0 = 插到最前，rects.length = 插到最后
   *
   * 判据是「过没过中点」而不是「过没过上边缘」：过中点才翻位，手感更跟手，
   * 也不会在边界上来回跳。任务和阶段都用它。
   */
  function computeDropIndex(rects, y) {
    for (var i = 0; i < rects.length; i++) {
      var mid = rects[i].top + rects[i].height / 2;
      if (y < mid) return i;
    }
    return rects.length;
  }

  // =========================================================================
  // DOM：接住鼠标和手指
  // =========================================================================

  var THRESHOLD = 6;      // 移动超过几个像素才算拖拽，低于它当点击处理

  var root = null;
  var onDrop = null;
  var canDrag = null;

  var pending = null;     // 按下了但还没确定为拖拽
  var state = null;       // 正在拖拽

  function closestEl(node, className) {
    var el = node;
    while (el && el !== document) {
      if (el.classList && el.classList.contains(className)) return el;
      el = el.parentNode;
    }
    return null;
  }

  /** 打勾、删除、编辑框这些控件不该触发拖拽 */
  function isInteractive(node) {
    return !!(closestEl(node, 'task__check') ||
              closestEl(node, 'task__del') ||
              closestEl(node, 'task__toggle') ||
              closestEl(node, 'task__input') ||
              closestEl(node, 'task__add-stage') ||
              closestEl(node, 'stage__check') ||
              closestEl(node, 'stage__del') ||
              closestEl(node, 'stage__input') ||
              closestEl(node, 'block__check') ||
              closestEl(node, 'block__del') ||
              closestEl(node, 'block__toggle') ||
              closestEl(node, 'block__input') ||
              closestEl(node, 'pool__del') ||
              closestEl(node, 'pool__date') ||
              closestEl(node, 'pool__date-clear') ||
              closestEl(node, 'pool__date-input') ||
              closestEl(node, 'stage__postpone') ||
              // 时段下拉（DS 2.12）：按它不能触发拖拽
              closestEl(node, 'slot__select'));
  }

  // -------------------------------------------------------------------------
  // 按下 / 移动 / 松开
  // -------------------------------------------------------------------------

  function onPointerDown(e) {
    if (state || pending) return;
    if (e.button !== undefined && e.button !== 0) return;  // 只认左键
    if (isInteractive(e.target)) return;
    if (!canDrag || !canDrag()) return;

    var stageEl = closestEl(e.target, 'stage');
    var blockEl = closestEl(e.target, 'block');
    var taskEl = closestEl(e.target, 'task');

    // **判定顺序：阶段 → 块 → 任务。**
    // 阶段的 <li> 套在任务的 <li> 里，任务的 <li> 又可能套在块的 <li> 里 ——
    // 判定顺序反了，拖 A 就会变成拖 B，而且拖起来还挺像回事，非常难发现。
    if (stageEl) {
      var hostTask = closestEl(stageEl, 'task');
      var hostSection = closestEl(stageEl, 'quadrant');
      if (!hostTask || !hostSection) return;

      pending = makePending(e, stageEl, 'stage', {
        taskId: hostTask.getAttribute('data-id'),
        stageId: stageEl.getAttribute('data-id'),
        // 阶段不能跨任务，所以它属于哪个象限现在就记下来 ——
        // 后面算落点、以及最后回调 moveStage，都要用它
        quadrantId: hostSection.getAttribute('data-quadrant'),
        // 落点列表也在这一刻定死（见文件开头的说明）
        fixedContainer: stageEl.parentNode
      });
      return;
    }

    // 按在块身上（块头、块内空白）：拖的是块。
    // 注意块内任务的 closest 链上也有 block，所以要先排除「按的其实是块内任务」
    if (blockEl && (!taskEl || !blockEl.contains(taskEl))) {
      var bSection = closestEl(blockEl, 'quadrant');
      if (!bSection) return;

      pending = makePending(e, blockEl, 'block', {
        blockId: blockEl.getAttribute('data-id')
      });
      return;
    }

    // 按在计划池的条目上：拖的是池内任务（只做「池 → 象限」，见 DS 2.11）。
    // 池不在任何象限里，单独一种 kind，落点解析时只认象限顶层
    var poolEl = closestEl(e.target, 'pool__item');
    if (poolEl) {
      pending = makePending(e, poolEl, 'pool', {
        poolItemId: poolEl.getAttribute('data-id')
      });
      return;
    }

    if (taskEl) {
      var section = closestEl(taskEl, 'quadrant');
      if (!section) return;

      // 块内任务也能拖：fromBlockId 记下它是从哪个块里拿起来的
      var hostBlock = closestEl(taskEl, 'block');
      pending = makePending(e, taskEl, 'task', {
        taskId: taskEl.getAttribute('data-id'),
        fromBlockId: hostBlock ? hostBlock.getAttribute('data-id') : null
      });
    }
  }

  function makePending(e, el, kind, extra) {
    var rect = el.getBoundingClientRect();
    var item = {
      kind: kind,
      pointerId: e.pointerId,
      el: el,
      startX: e.clientX,
      startY: e.clientY,
      // 指针在元素内部的偏移：拖起来的时候元素不该「跳」一下
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      width: rect.width,
      height: rect.height
    };
    for (var k in extra) item[k] = extra[k];
    return item;
  }

  function onPointerMove(e) {
    if (pending && !state) {
      var dx = e.clientX - pending.startX;
      var dy = e.clientY - pending.startY;
      if (dx * dx + dy * dy < THRESHOLD * THRESHOLD) return;
      beginDrag();
    }
    if (!state || e.pointerId !== state.pointerId) return;

    moveGhost(e.clientX, e.clientY);
    updateTarget(e.clientX, e.clientY);
  }

  function onPointerUp(e) {
    pending = null;
    if (!state || e.pointerId !== state.pointerId) return;
    finish(true);
  }

  function onPointerCancel() {
    pending = null;
    if (state) finish(false);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape' && state) finish(false);
  }

  // -------------------------------------------------------------------------
  // 拖拽过程
  // -------------------------------------------------------------------------

  function beginDrag() {
    state = pending;
    pending = null;

    var el = state.el;

    // 跟手的那个克隆。pointer-events: none 很关键 —— 不然 elementFromPoint
    // 每次都只会命中它自己，永远算不出底下是哪个象限。
    var ghost = el.cloneNode(true);
    ghost.className = el.className + ' drag-ghost';
    ghost.style.width = state.width + 'px';
    ghost.style.height = state.height + 'px';
    document.body.appendChild(ghost);

    state.ghost = ghost;
    state.placeholder = null;
    state.target = null;

    // 原位留个淡淡的影子，让用户看得出「是从这儿拿起来的」
    el.classList.add(state.kind === 'stage' ? 'stage--dragging'
                   : state.kind === 'block' ? 'block--dragging'
                   : state.kind === 'pool' ? 'pool__item--dragging'
                   : 'task--dragging');
    document.body.classList.add('is-dragging');

    moveGhost(state.startX, state.startY);
  }

  function moveGhost(x, y) {
    if (!state || !state.ghost) return;
    state.ghost.style.left = (x - state.offsetX) + 'px';
    state.ghost.style.top = (y - state.offsetY) + 'px';
  }

  /** 一组元素的 { top, height }，顺序就是传入顺序 */
  function rectsOf(els) {
    var rects = [];
    for (var i = 0; i < els.length; i++) {
      var r = els[i].getBoundingClientRect();
      rects.push({ top: r.top, height: r.height });
    }
    return rects;
  }

  /** 阶段列表里「别人」（排除被拖的、占位符、编辑框） */
  function stageOthers(list) {
    var out = [];
    var children = list.children;
    for (var i = 0; i < children.length; i++) {
      var li = children[i];
      if (li === state.el) continue;
      if (li.classList.contains('stage--placeholder') ||
          li.classList.contains('stage--editing')) continue;
      out.push(li);
    }
    return out;
  }

  /**
   * 顶层混排列表里「参与排序」的直接子元素。
   *
   * **必须遍历直接子元素，不能 querySelectorAll('.task')** ——
   * 那会把块里的任务也抓进来，顶层 index 就全乱了（见 DS 2.10 混排规则）。
   * 排除：被拖的那个、占位符、正在编辑的输入框条目。
   */
  function topLevelItems(container) {
    var out = [];
    var children = container.children;
    for (var i = 0; i < children.length; i++) {
      var li = children[i];
      if (li === state.el) continue;
      if (li.classList.contains('task--placeholder') ||
          li.classList.contains('block--placeholder') ||
          li.classList.contains('task--editing') ||
          li.classList.contains('block--editing')) continue;
      out.push(li);
    }
    return out;
  }

  /** 块内列表里参与排序的任务（再排除「把任务拖进来」占位条目） */
  function innerItems(listEl) {
    var out = [];
    var children = listEl.children;
    for (var i = 0; i < children.length; i++) {
      var li = children[i];
      if (li === state.el) continue;
      if (li.classList.contains('task--placeholder') ||
          li.classList.contains('task--editing') ||
          li.classList.contains('block__empty')) continue;
      out.push(li);
    }
    return out;
  }

  function sameTarget(t) {
    return !!(state.target &&
              state.target.quadrantId === t.quadrantId &&
              state.target.blockId === t.blockId &&
              state.target.index === t.index);
  }

  /** 把占位符插到 container 的第 index 位（items 是已排除好的「别人」列表） */
  function placePlaceholderIn(container, items, placeholderClass) {
    if (state.placeholder && state.placeholder.parentNode) {
      state.placeholder.parentNode.removeChild(state.placeholder);
    }

    var placeholder = document.createElement('li');
    placeholder.className = placeholderClass;
    // 高度照着被拖那条来，占位才不会忽大忽小
    placeholder.style.height = state.height + 'px';

    if (state.index >= items.length) {
      container.appendChild(placeholder);
    } else {
      container.insertBefore(placeholder, items[state.index]);
    }
    state.placeholder = placeholder;
  }

  /** 记下一次落点并挪占位符。落点没变就不动，免得占位符闪 */
  function setTarget(target, container, items, placeholderClass) {
    if (sameTarget(target)) return;
    state.target = target;
    state.index = target.index;
    placePlaceholderIn(container, items, placeholderClass);
  }

  /** 象限里装条目的那个 ul；空象限只有一句「暂无任务」，得现搭一个出来 */
  function ensureTasksList(section) {
    var body = section.querySelector('.quadrant__body');
    if (!body) return null;
    var tasks = body.querySelector('.tasks');
    if (!tasks) {
      var empty = body.querySelector('.quadrant__empty');
      if (empty) body.removeChild(empty);
      tasks = document.createElement('ul');
      tasks.className = 'tasks';
      body.appendChild(tasks);
    }
    return tasks;
  }

  function updateTarget(x, y) {
    // ---- 阶段：落点列表是按下的那一刻就定死的 ----
    if (state.kind === 'stage') {
      var list = state.fixedContainer;
      if (!list || !document.body.contains(list)) return;
      var others = stageOthers(list);
      var index = computeDropIndex(rectsOf(others), y);
      setTarget({ quadrantId: state.quadrantId, blockId: null, index: index },
                list, others, 'stage stage--placeholder');
      return;
    }

    var under = document.elementFromPoint(x, y);
    var section = under ? closestEl(under, 'quadrant') : null;
    if (!section) return;   // 拖到页面空白处：保持上一次的落点不动
    var quadrantId = section.getAttribute('data-quadrant');

    // ---- 块：只能落顶层（规矩 1：块里不许套块）----
    if (state.kind === 'block') {
      var containerB = ensureTasksList(section);
      if (!containerB) return;
      var itemsB = topLevelItems(containerB);
      setTarget({ quadrantId: quadrantId, blockId: null, index: computeDropIndex(rectsOf(itemsB), y) },
                containerB, itemsB, 'block block--placeholder');
      return;
    }

    // ---- 池内任务：也只落顶层（DS 2.11 拖回象限就是顶层位置），
    // 占位符长得和任务落点一样，但落进块里不允许 ----
    if (state.kind === 'pool') {
      var containerP = ensureTasksList(section);
      if (!containerP) return;
      var itemsP = topLevelItems(containerP);
      setTarget({ quadrantId: quadrantId, blockId: null, index: computeDropIndex(rectsOf(itemsP), y) },
                containerP, itemsP, 'task task--placeholder');
      return;
    }

    // ---- 任务：三种落点 —— 块头上（进块末尾）、块内任务上（块内位置）、其余（顶层）----
    var blockHover = closestEl(under, 'block');
    if (blockHover) {
      var innerList = blockHover.querySelector('.block__tasks');
      var innerTask = closestEl(under, 'task');
      var items;
      var index;

      if (innerList && innerTask && innerTask !== state.el && blockHover.contains(innerTask)) {
        // 块内某条任务上：插到它前面/后面（过中点翻位）
        items = innerItems(innerList);
        index = computeDropIndex(rectsOf(items), y);
      } else {
        // 块头、块内空白、「把任务拖进来」占位：都算进块末尾
        items = innerList ? innerItems(innerList) : [];
        index = items.length;
      }

      setTarget({ quadrantId: quadrantId, blockId: blockHover.getAttribute('data-id'), index: index },
                innerList, items, 'task task--placeholder');
      return;
    }

    var container = ensureTasksList(section);
    if (!container) return;
    var items = topLevelItems(container);
    setTarget({ quadrantId: quadrantId, blockId: null, index: computeDropIndex(rectsOf(items), y) },
              container, items, 'task task--placeholder');
  }

  /**
   * 收尾。
   * commit 为假表示取消（按了 Esc，或者触摸被系统打断）——
   * 取消时**什么都不改**，数据和界面都保持原样。
   */
  function finish(commit) {
    if (!state) return;
    var s = state;
    state = null;

    if (s.ghost && s.ghost.parentNode) s.ghost.parentNode.removeChild(s.ghost);
    if (s.placeholder && s.placeholder.parentNode) {
      s.placeholder.parentNode.removeChild(s.placeholder);
    }
    s.el.classList.remove(s.kind === 'stage' ? 'stage--dragging'
                        : s.kind === 'block' ? 'block--dragging'
                        : s.kind === 'pool' ? 'pool__item--dragging'
                        : 'task--dragging');
    document.body.classList.remove('is-dragging');

    if (!commit) return;

    // 拖过之后浏览器还会补一个 click。不拦住的话，松手那一刻就等于
    // 「点开编辑」，会莫名其妙冒出一个输入框
    suppressNextClick();

    if (s.target && onDrop) {
      onDrop({
        kind: s.kind,
        taskId: s.taskId,
        stageId: s.stageId,
        blockId: s.blockId,
        poolItemId: s.poolItemId,
        // 落点：顶层位置时 targetBlockId 为 null，进块时是那个块的 id
        quadrantId: s.target.quadrantId,
        targetBlockId: s.target.blockId || null,
        index: s.target.index
      });
    }
  }

  function suppressNextClick() {
    var handler = function (e) {
      e.stopPropagation();
      document.removeEventListener('click', handler, true);
    };
    document.addEventListener('click', handler, true);
  }

  // -------------------------------------------------------------------------

  function init(options) {
    options = options || {};
    root = document.getElementById('quadrants');
    onDrop = options.onDrop || null;
    canDrag = options.canDrag || null;

    // 拖拽的起点有两个：四象限和计划池（池内任务拖回象限，见 DS 2.11）。
    // 移动 / 松开仍只挂在 document 上
    var roots = [];
    if (root) roots.push(root);
    var poolRoot = document.getElementById('pool');
    if (poolRoot) roots.push(poolRoot);

    if (!roots.length) return Drag;
    for (var i = 0; i < roots.length; i++) {
      roots[i].addEventListener('pointerdown', onPointerDown);
    }
    // 监听在 document 上而不是象限上：拖到象限外面、甚至拖出窗口，
    // 也要能收到移动和松开
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointercancel', onPointerCancel);
    document.addEventListener('keydown', onKeyDown);
    return Drag;
  }

  /** 测试和排查用 */
  function isDragging() {
    return !!state;
  }

  return {
    // 纯函数（Node 里可测）
    computeDropIndex: computeDropIndex,

    // DOM
    init: init,
    isDragging: isDragging
  };
})(
  typeof CONFIG !== 'undefined' ? CONFIG : require('./config.js'),
  typeof Util !== 'undefined' ? Util : require('./util.js')
);

// Node 测试环境用（浏览器里没有 module，这段不会执行）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Drag;
}
