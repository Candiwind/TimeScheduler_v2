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
 * 各种拖拽共用一套机制，只在两处不同：
 *
 *   拖什么    落点找谁                                    能不能跨出去
 *   ────────  ─────────────────────────────────────────  ──────────────
 *   任务      象限区：块头→进块末尾；块内条目→块内位置；   能：四个象限随便拖，
 *            其余→指针底下那个象限的顶层                 也能拖进 / 拖出计划池
 *            池区：指针底下那个池列表（顶层或块内）       （需求 3）
 *   块        象限顶层（规矩 1：块里不许套块，DS 2.10）；  能跨象限、能从池拖回
 *            池顶层                                      象限顶层；**不能进任何块**
 *   阶段      被拖那条自己所属的列表                      不能，只能在同一个任务内部挪
 *   池内条目  ① 指针底下那个池列表（顶层 / 块内都行，    池内跨容器可以了
 *            与来源无关）→ 池内换顺序、跨容器搬运；      （顶层 ↔ 块内互通，
 *            ② 指针底下那个象限（顶层或块内）→ 池→象限     见需求 3 / DS 2.43）
 *   时间视图  指针底下那个时段组的列表                    能，跨时段随便拖
 *
 * 落点统一成 `{ region, quadrantId, blockId, toSlot, index }` 一个形状：
 * region 说「落在哪个区域」，blockId 说「落在哪个块里（顶层为 null）」。
 * 象限块和池内块各有各的 id 空间，靠 region 区分，不会混。
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
              // 池内勾选框（v2.7 需求 1）：按它不进入拖拽。它们是**触摸端的拖动
              // 把手**（需求 2，见 isCheckHandle），鼠标按下去则只勾选不拖 ——
              // 由下面那个 `!(touchLike && onCheck)` 例外放行这一种组合
              closestEl(node, 'pool__check') ||
              closestEl(node, 'pool__block-check') ||
              // 池内块头（v2.6：块也能拖了）与池内的「导入」按钮（需求 2）
              closestEl(node, 'pool__block-toggle') ||
              closestEl(node, 'pool__block-add') ||
              closestEl(node, 'pool__block-del') ||
              closestEl(node, 'pool__import') ||
              closestEl(node, 'pool__block-import') ||
              closestEl(node, 'stage__postpone') ||
              // 推迟按钮（顶层任务 / 块头整体推迟 / 块内无阶段任务）：按它不该触发拖拽
              closestEl(node, 'task__postpone') ||
              closestEl(node, 'block__postpone') ||
              // 时段下拉（DS 2.12）：按它不能触发拖拽
              closestEl(node, 'slot__select') ||
              // Bonus 开关（需求 2）：按它不该拖
              closestEl(node, 'task__bonus') ||
              closestEl(node, 'stage__bonus'));
  }

  /**
   * 指针底下那个池落点 —— 返回 { list, blockId, itemEl } 或 null。
   *
   * - `list`：占位符要插进去的那个 UL；
   * - `blockId`：null = 池**顶层**列表；否则是那个池内块的 id；
   * - `itemEl`：指针底下那条池任务（用来算「插到第几位」），压在块头上时为 null。
   *
   * 块内列表优先：`.pool__block-tasks` 套在 `.pool__list` 里面，先认它。
   * 块折叠着时块内的任务列表不在 DOM 里 → 不作为落点（返回 null）。
   */
  function poolDropTarget(node) {
    if (!node) return null;

    var blockEl = closestEl(node, 'pool__block');
    if (blockEl) {
      var inner = blockEl.querySelector('.pool__block-tasks');
      if (!inner) return null;
      return {
        list: inner,
        blockId: blockEl.getAttribute('data-id'),
        blockEl: blockEl,
        itemEl: closestEl(node, 'pool__item')
      };
    }

    var top = closestEl(node, 'pool__list');
    if (top) {
      return { list: top, blockId: null, blockEl: null, itemEl: closestEl(node, 'pool__item') };
    }
    return null;
  }

  /**
   * 勾选框是触摸端的拖动把手（需求 7 / D-48；池内也一样，见需求 2）。
   *
   * 池里的勾选框从 v2.7 起就有（`pool__check` / `pool__block-check`），但当时
   * 刻意**不**当把手（D-62，池条目整条可拖）。新需求把这条反过来：手机端
   * 「象限模式和计划池中所有任务/阶段的拖拽」都要以勾选框处为把手，其他位置
   * 碰了不触发拖动 —— 于是池条目其余区域腾出来给正常触摸滚动（R-33 的
   * 「池列表在手机上滚不动」顺带一并解决）。
   */
  function isCheckHandle(node) {
    return !!(closestEl(node, 'task__check') ||
              closestEl(node, 'stage__check') ||
              closestEl(node, 'block__check') ||
              closestEl(node, 'pool__check') ||
              closestEl(node, 'pool__block-check'));
  }

  /** 每种拖拽对应的「被拖中」样式类（beginDrag / finish 两处共用） */
  function draggingClass(kind) {
    if (kind === 'stage') return 'stage--dragging';
    if (kind === 'block') return 'block--dragging';
    if (kind === 'pool') return 'pool__item--dragging';
    if (kind === 'tv') return 'timeview__item--dragging';
    return 'task--dragging';
  }

  // -------------------------------------------------------------------------
  // 按下 / 移动 / 松开
  // -------------------------------------------------------------------------

  function onPointerDown(e) {
    if (state || pending) return;
    if (e.button !== undefined && e.button !== 0) return;  // 只认左键
    if (!canDrag || !canDrag()) return;

    // 需求 7 / D-48 + 需求 2：触摸 / 笔只在勾选框（把手）上发起拖拽；鼠标照旧
    // 整行可拖。**象限和计划池一视同仁** —— 池里的勾选框也是把手，池条目其余
    // 区域不再拦截触摸，留给滚动（这条把 D-62 的取舍反过来，见 isCheckHandle）。
    var touchLike = e.pointerType === 'touch' || e.pointerType === 'pen';
    var onCheck = isCheckHandle(e.target);

    // 交互控件（删除 / 编辑 / 下拉等）任何指针类型都不该拖；但触摸按在勾选框
    // 上时勾选框是把手，不能在这里被拦掉。
    if (isInteractive(e.target) && !(touchLike && onCheck)) return;
    // 触摸 / 笔：不是勾选框就不拖（行本体留给滚动）
    if (touchLike && !onCheck) return;

    // **时间视图条目必须先判**（需求 3）：它的条目也带 task / stage 类名，
    // 但没有 quadrant 祖先，按下面的象限分支走会静默 no-op，拖不起来。
    // 条目按 data-kind 分任务 / 阶段，时段的归属从所在组的 data-slot 读。
    var tvEl = closestEl(e.target, 'timeview__item');
    if (tvEl) {
      var tvGroup = closestEl(tvEl, 'timeview__group');
      if (!tvGroup) return;
      var sourceSlot = tvGroup.getAttribute('data-slot');
      var dataKind = tvEl.getAttribute('data-kind');
      var taskId = dataKind === 'stage'
        ? tvEl.getAttribute('data-task-id')
        : tvEl.getAttribute('data-id');
      var stageId = dataKind === 'stage' ? tvEl.getAttribute('data-stage-id') : null;
      var quadrantId = tvEl.getAttribute('data-quadrant');
      if (!sourceSlot || !taskId || !quadrantId) return;

      pending = makePending(e, tvEl, 'tv', {
        dataKind: dataKind,
        taskId: taskId,
        stageId: stageId,
        quadrantId: quadrantId,
        sourceSlot: sourceSlot
      });
      return;
    }

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

    // 按在计划池的条目上：拖的是池内条目 —— 顶层任务，或块内的任务。
    // 落点有三类（需求 3）：池内换顺序 / 池内跨容器、象限顶层、象限的块。
    // 落点解析见 updateTarget。
    var poolEl = closestEl(e.target, 'pool__item');
    if (poolEl) {
      pending = makePending(e, poolEl, 'pool', {
        poolItemId: poolEl.getAttribute('data-id'),
        isPoolBlock: false
      });
      return;
    }

    // 按在池内**任务块**身上（块头 / 块内空白）：拖的是整块（v2.6 需求 1）。
    // 块内任务会先在上面那一步被认走，所以这里只会是块自己
    var poolBlockEl = closestEl(e.target, 'pool__block');
    if (poolBlockEl) {
      pending = makePending(e, poolBlockEl, 'pool', {
        poolItemId: poolBlockEl.getAttribute('data-id'),
        // 块只能落**池顶层**和**象限顶层**：块里不许套块（规矩 1），
        // updateTarget 靠这个标记把「块内列表」的落点排除掉
        isPoolBlock: true
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
    el.classList.add(draggingClass(state.kind));
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

  /**
   * 池列表里参与排序的条目（v2.6 需求 1）。
   * 排除：被拖的那条、占位符、正在编辑的行（新增 / 改文字 / 改时间），
   * 以及空块的提示行 —— 它们都不是可换顺序的条目。
   */
  function poolOthers(listEl) {
    var out = [];
    var children = listEl.children;
    for (var i = 0; i < children.length; i++) {
      var li = children[i];
      if (li === state.el) continue;
      if (li.classList.contains('pool__item--placeholder') ||
          li.classList.contains('pool__item--editing') ||
          li.classList.contains('pool__block-empty')) continue;
      out.push(li);
    }
    return out;
  }

  /** 时间视图列表里参与排序的条目（排除被拖的、占位符、编辑框） */
  function tvOthers(listEl) {
    var out = [];
    var children = listEl.children;
    for (var i = 0; i < children.length; i++) {
      var li = children[i];
      if (li === state.el) continue;
      if (li.classList.contains('timeview__item--placeholder') ||
          li.classList.contains('task--editing') ||
          li.classList.contains('stage--editing')) continue;
      out.push(li);
    }
    return out;
  }

  /**
   * 落点对象统一形状：`{ region, quadrantId, blockId, toSlot, index }`。
   *
   * - `region` = `'quadrant'` | `'pool'`（时间视图的落点只用 toSlot，region 为空）；
   * - `blockId` = **落点所属的那个块**的 id：象限里是象限块的 id，池里是池内块的
   *   id，落在顶层则为 null。区域由 region 区分，所以两种块不会混。
   *
   * v2.6 给池内换顺序单独加的那个布尔落点标记取消了 —— 池内、池外本来就是同一
   * 套「区域 + 容器 + 位次」，多一个标记只会让 sameTarget 的比较漏项（需求 3）。
   */
  function sameTarget(t) {
    return !!(state.target &&
              state.target.region === t.region &&
              state.target.quadrantId === t.quadrantId &&
              state.target.blockId === t.blockId &&
              // 时间视图跨时段拖拽时 toSlot 会变，也要比（象限 / 池拖拽里恒为 undefined）
              state.target.toSlot === t.toSlot &&
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
    // ---- 时间视图（需求 3）：跟着指针找落点时段，可跨时段拖 ----
    if (state.kind === 'tv') {
      var underTv = document.elementFromPoint(x, y);
      var tvGroup = underTv ? closestEl(underTv, 'timeview__group') : null;
      if (!tvGroup) return;   // 拖到时间视图外：保持上一次落点不动
      var tvList = tvGroup.querySelector('.timeview__list');
      if (!tvList) return;
      var tvOthersList = tvOthers(tvList);
      setTarget({ toSlot: tvGroup.getAttribute('data-slot'),
                  index: computeDropIndex(rectsOf(tvOthersList), y) },
                tvList, tvOthersList, 'timeview__item timeview__item--placeholder');
      return;
    }

    // ---- 阶段：落点列表是按下的那一刻就定死的 ----
    if (state.kind === 'stage') {
      var list = state.fixedContainer;
      if (!list || !document.body.contains(list)) return;
      var others = stageOthers(list);
      var index = computeDropIndex(rectsOf(others), y);
      setTarget({ region: 'quadrant', quadrantId: state.quadrantId, blockId: null,
                  index: index },
                list, others, 'stage stage--placeholder');
      return;
    }

    var under = document.elementFromPoint(x, y);

    // ---- 落点在计划池（需求 3）：池内换顺序、池内跨容器、象限 → 池 ----
    //
    // 池里任意一个列表都受理（顶层 ↔ 顶层、块内 ↔ 块内，以及两者互相搬运）。
    // v2.6 的「只认自己所属的那一个列表」（D-58）到此为止 —— 新需求要求象限
    // 里能做到的拖动，池里都得有对应形式，跨容器搬运是其中最基本的一条。
    //
    // 唯一的禁令还是规矩 1：**块里不许套块**。被拖的是块（象限块 `kind:'block'`
    // 或池内块 `isPoolBlock`）时，池里的「块内列表」落点一律不受理，保持上一次
    // 落点不动，比「猜用户想放哪」稳。
    var poolHit = poolDropTarget(under);
    if (poolHit) {
      var draggingBlock = state.isPoolBlock || state.kind === 'block';
      if (draggingBlock && poolHit.blockId) return;

      var poolItems = poolOthers(poolHit.list);
      var poolIndex;
      if (poolHit.itemEl && poolHit.itemEl !== state.el) {
        // 落在池里某条条目上：插到它前面 / 后面（过中点翻位）
        poolIndex = computeDropIndex(rectsOf(poolItems), y);
      } else {
        // 块头、块内空白、列表尾部空白、「把任务拖进来」占位：都算放进末尾
        poolIndex = poolItems.length;
      }

      setTarget({ region: 'pool', quadrantId: null, blockId: poolHit.blockId,
                  index: poolIndex },
                poolHit.list, poolItems, 'pool__item pool__item--placeholder');
      return;
    }

    var section = under ? closestEl(under, 'quadrant') : null;
    if (!section) return;   // 拖到页面空白处：保持上一次的落点不动
    var quadrantId = section.getAttribute('data-quadrant');

    // ---- 块：只能落顶层（规矩 1：块里不许套块）----
    if (state.kind === 'block') {
      var containerB = ensureTasksList(section);
      if (!containerB) return;
      var itemsB = topLevelItems(containerB);
      setTarget({ region: 'quadrant', quadrantId: quadrantId, blockId: null,
                  index: computeDropIndex(rectsOf(itemsB), y) },
                containerB, itemsB, 'block block--placeholder');
      return;
    }

    // ---- 任务，和从池里拖回来的条目：三种落点 —— 块头上（进块末尾）、
    // 块内任务上（块内位置）、其余（顶层）。
    // 池条目落到象限块里也受理（需求 3 的「相互之间的拖动」），所以这里不再
    // 按 kind 分叉，两种来源走同一套判定 ----
    var blockHover = closestEl(under, 'block');
    if (blockHover) {
      var innerList = blockHover.querySelector('.block__tasks');
      if (!innerList) return;
      var innerTask = closestEl(under, 'task');
      var items;
      var index;

      if (innerTask && innerTask !== state.el && blockHover.contains(innerTask)) {
        // 块内某条任务上：插到它前面/后面（过中点翻位）
        items = innerItems(innerList);
        index = computeDropIndex(rectsOf(items), y);
      } else {
        // 块头、块内空白、「把任务拖进来」占位：都算进块末尾
        items = innerItems(innerList);
        index = items.length;
      }

      setTarget({ region: 'quadrant', quadrantId: quadrantId,
                  blockId: blockHover.getAttribute('data-id'), index: index },
                innerList, items, 'task task--placeholder');
      return;
    }

    var container = ensureTasksList(section);
    if (!container) return;
    var items = topLevelItems(container);
    setTarget({ region: 'quadrant', quadrantId: quadrantId, blockId: null,
                index: computeDropIndex(rectsOf(items), y) },
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
    s.el.classList.remove(draggingClass(s.kind));
    document.body.classList.remove('is-dragging');

    if (!commit) return;

    // 拖过之后浏览器还会补一个 click。不拦住的话，松手那一刻就等于
    // 「点开编辑」，会莫名其妙冒出一个输入框
    suppressNextClick();

    if (s.target && onDrop) {
      // 时间视图的落点字段和象限拖拽不同：toSlot 决定落到哪个时段
      if (s.kind === 'tv') {
        onDrop({
          kind: 'tv',
          dataKind: s.dataKind,
          taskId: s.taskId,
          stageId: s.stageId,
          quadrantId: s.quadrantId,
          toSlot: s.target.toSlot,
          index: s.target.index
        });
        return;
      }

      // 落点统一成「区域 + 容器 + 位次」（需求 3）：
      // region 'quadrant' → 象限拖拽；region 'pool' → 池内 / 落进池。
      // 由 app.js 的 onDrop 分派到 task-ops 里对应的那个函数。
      onDrop({
        kind: s.kind,
        region: s.target.region,
        taskId: s.taskId,
        stageId: s.stageId,
        blockId: s.blockId,
        poolItemId: s.poolItemId,
        quadrantId: s.target.quadrantId || null,
        // 落点容器：象限里是象限块的 id，池里是池内块的 id，顶层为 null
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

    // 拖拽的起点有三个：四象限、计划池、时间视图（需求 3）。
    // 移动 / 松开仍只挂在 document 上
    var roots = [];
    if (root) roots.push(root);
    var poolRoot = document.getElementById('pool');
    if (poolRoot) roots.push(poolRoot);
    var timeviewRoot = document.getElementById('timeview');
    if (timeviewRoot) roots.push(timeviewRoot);

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
