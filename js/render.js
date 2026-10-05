/**
 * render.js —— 把数据画成页面
 *
 * 加载顺序：第 6 个（见 DS 1.4）。
 *
 * **本文件只读数据，绝不改数据**（见 DS 1.3）。
 * 需要改数据时调 task-ops.js，改完由 app.js 重新调这里的 render。
 *
 * 分两层：
 *   - 「拼 HTML 字符串」的部分是**纯函数**，不碰 document，所以能在 Node 里测；
 *   - 「塞进页面」的部分才碰 DOM。
 * 这样任务文本的转义（最容易出 XSS 的地方）就有自动测试覆盖了。
 */
var Render = (function (CONFIG, Util) {
  'use strict';

  var QUADRANT_BY_ID = {};
  for (var qi = 0; qi < CONFIG.QUADRANTS.length; qi++) {
    QUADRANT_BY_ID[CONFIG.QUADRANTS[qi].id] = CONFIG.QUADRANTS[qi];
  }

  // ===========================================================================
  // 纯函数部分：只拼字符串，不碰 DOM —— 可以在 Node 里测
  // ===========================================================================

  /**
   * 没传 progressOf 时的兜底：当成「这条任务没有阶段」。
   *
   * **只有测试会走到这里。** 真实运行永远由 app.js 把 `TaskOps.getProgress`
   * 传进来 —— 进度的算法必须只有一份实现，否则任务行上的「3/5」和顶部的
   * 完成率迟早会对不上，而且这种不一致很难被发现。
   */
  function fallbackProgress(task) {
    return {
      done: task.completed ? 1 : 0,
      total: 1,
      hasStages: false,
      isComplete: !!task.completed
    };
  }

  /**
   * 时段下拉（DS 2.12）：原生 <select>，第一项「未设定」（value 为空串，
   * 提交时由 app.js 翻成清除），其余六项是「图标 + 文字」。
   *
   * 为什么用原生 select 而不是图标网格 / 自绘弹层，见 D-39。
   */
  function buildSlotSelectHtml(current, ariaLabel) {
    var html = '<select class="slot__select' + (current ? '' : ' slot__select--empty') +
      '" aria-label="' + (ariaLabel || '选择完成时段') + '">' +
      '<option value="">未设定</option>';
    for (var i = 0; i < CONFIG.SLOTS.length; i++) {
      var slot = CONFIG.SLOTS[i];
      html += '<option value="' + slot + '"' +
        (current === slot ? ' selected' : '') + '>' +
        (CONFIG.SLOT_ICONS[slot] || '') + ' ' + slot + '</option>';
    }
    return html + '</select>';
  }

  /**
   * 一个阶段。
   *
   * 排序只靠拖拽（见 DS 2.9），这里不再放上移/下移的小箭头——
   * 那两个箭头占地方、在手机上还不好点，拖拽一条路就够了。
   */
  function buildStageHtml(stage, isEditing) {
    if (isEditing) {
      return '' +
        '<li class="stage stage--editing" data-id="' + Util.escapeHtml(stage.id) + '">' +
          '<input type="text" class="stage__input" value="' + Util.escapeHtml(stage.text) + '"' +
            ' maxlength="500" aria-label="编辑阶段">' +
        '</li>';
    }

    return '' +
      '<li class="stage' + (stage.completed ? ' stage--done' : '') + '"' +
        ' data-id="' + Util.escapeHtml(stage.id) + '">' +
        '<input type="checkbox" class="stage__check"' +
          (stage.completed ? ' checked' : '') +
          ' aria-label="标记阶段完成">' +
        '<span class="stage__text">' + Util.escapeHtml(stage.text) + '</span>' +
        // 时段挂在各阶段身上（DS 2.12）：有阶段的任务，安排到哪一段由各阶段决定
        buildSlotSelectHtml(stage.slot || null) +
        // 阶段也是推迟对象（requirements 第 3 条）：推迟时保存为池内任务，
        // 文本前加 [所属任务] 前缀（见 DS 2.11 postponeStage）
        '<button type="button" class="stage__postpone"' +
          ' title="推迟到计划池" aria-label="推迟到计划池">推迟</button>' +
        '<button type="button" class="stage__del" aria-label="删除阶段">×</button>' +
      '</li>';
  }

  /** 新增阶段时那个还没提交的输入框 */
  function buildNewStageHtml() {
    return '' +
      '<li class="stage stage--editing stage--new">' +
        '<input type="text" class="stage__input" value=""' +
          ' maxlength="500" placeholder="输入阶段内容，回车确认" aria-label="新阶段">' +
      '</li>';
  }

  /**
   * 任务正在改文字时，整条换成一个输入框。
   * 值也要转义：任务文本里可能有引号，不转义会把 value 属性提前闭合。
   */
  function buildEditingTaskHtml(task) {
    return '' +
      '<li class="task task--editing" data-id="' + Util.escapeHtml(task.id) + '">' +
        '<div class="task__row">' +
          '<input type="text" class="task__input" value="' + Util.escapeHtml(task.text) + '"' +
            ' maxlength="500" aria-label="编辑任务">' +
        '</div>' +
      '</li>';
  }

  /** 新增任务时那个还没提交的输入框 */
  function buildNewTaskHtml() {
    return '' +
      '<li class="task task--editing task--new">' +
        '<div class="task__row">' +
          '<input type="text" class="task__input" value=""' +
            ' maxlength="500" placeholder="输入任务内容，回车确认" aria-label="新任务">' +
        '</div>' +
      '</li>';
  }

  /** 新增任务块时那个还没提交的输入框（输入框复用 task__input，键盘 / 失焦逻辑共用） */
  function buildNewBlockHtml() {
    return '' +
      '<li class="block block--editing block--new">' +
        '<div class="task__row">' +
          '<input type="text" class="task__input" value=""' +
            ' maxlength="500" placeholder="输入任务块名称，回车确认" aria-label="新任务块">' +
        '</div>' +
      '</li>';
  }

  /**
   * 一个任务块的 HTML（见 DS 2.10）。
   *
   * 块头是「勾选框 + 块名 + 进度 + 三角 + ×」，块体是块内任务列表——
   * 子条目**复用 buildTaskHtml**，形状和顶层任务完全一样，所以勾选、编辑、
   * 阶段那套逻辑零改动就能在块内工作。
   *
   * @param {Object} block
   * @param {Object} view 同 buildTaskHtml 的 view，多一个：
   *        collapsedBlocks { 块id: true } 收起的块（块的默认态是**展开**，见 D-36）
   */
  function buildBlockHtml(block, view) {
    view = view || {};
    var editing = view.editing || null;
    var collapsed = view.collapsedBlocks || {};
    var progressOf = view.progressOf || fallbackProgress;
    var id = Util.escapeHtml(block.id);

    // 正在改块名：整条收成一个输入框（和任务编辑同一套交互，见 D-31）
    if (editing && editing.mode === 'edit-block' && editing.blockId === block.id) {
      return '' +
        '<li class="block block--editing" data-id="' + id + '">' +
          '<div class="task__row">' +
            '<input type="text" class="task__input" value="' + Util.escapeHtml(block.text) + '"' +
              ' maxlength="500" aria-label="编辑任务块">' +
          '</div>' +
        '</li>';
    }

    var progress = progressOf(block);
    var isCollapsed = !!collapsed[block.id];
    var tasks = Array.isArray(block.tasks) ? block.tasks : [];

    var head = '' +
      '<div class="block__head">' +
        '<input type="checkbox" class="block__check"' +
          (progress.isComplete ? ' checked' : '') +
          ' aria-label="全部勾选或取消块内任务">' +
        '<span class="block__name">' + Util.escapeHtml(block.text) + '</span>' +
        '<span class="task__progress' + (progress.isComplete ? ' task__progress--done' : '') + '">' +
          progress.done + '/' + progress.total + '</span>' +
        '<button type="button" class="block__toggle" aria-expanded="' + (!isCollapsed) +
          '" aria-label="展开或收起任务块">' + (isCollapsed ? '▸' : '▾') + '</button>' +
        '<button type="button" class="block__del" aria-label="删除任务块">×</button>' +
      '</div>';

    var body = '';
    if (!isCollapsed) {
      // 块内任务多带一个 inBlock 标记：「推迟」按钮只给顶层任务，
      // 块内任务没有（要推迟先把它拖出块，见 DS 2.11 界面）
      var childView = {};
      for (var vk in view) childView[vk] = view[vk];
      childView.inBlock = true;

      body = '<ul class="block__tasks">';
      for (var i = 0; i < tasks.length; i++) {
        body += buildTaskHtml(tasks[i], childView);
      }
      // 空块给一句占位：一是告诉用户这里能放东西，二是给拖拽一个看得见的目标
      if (!tasks.length) {
        body += '<li class="block__empty">把任务拖进来</li>';
      }
      body += '</ul>';
    }

    return '' +
      '<li class="block' + (progress.isComplete ? ' block--done' : '') +
        '" data-id="' + id + '">' + head + body + '</li>';
  }

  /**
   * 一条任务的 HTML。
   *
   * @param {Object} task
   * @param {Object} view 这一天的界面状态：
   *        editing    正在编辑什么（见 buildQuadrantHtml 的说明）
   *        expanded   展开状态表 { 任务id: true }
   *        progressOf 算进度的函数（app.js 传 TaskOps.getProgress 进来）
   */
  function buildTaskHtml(task, view) {
    view = view || {};
    var editing = view.editing || null;
    var expanded = view.expanded || {};
    var progressOf = view.progressOf || fallbackProgress;

    if (editing && editing.mode === 'edit-task' && editing.taskId === task.id) {
      return buildEditingTaskHtml(task);
    }

    var stages = Array.isArray(task.stages) ? task.stages : [];
    var progress = progressOf(task);
    var isOpen = !!expanded[task.id];
    var id = Util.escapeHtml(task.id);

    // 勾选框的勾选状态：有阶段时表示「是不是全完成了」
    var checked = progress.isComplete;

    var row = '' +
      '<div class="task__row">' +
        '<input type="checkbox" class="task__check"' +
          (checked ? ' checked' : '') +
          // 有阶段时它是个「全选 / 全不选」的开关，标签要说清楚，
          // 否则屏幕阅读器只会念一句「标记完成」，用户以为是勾这一条
          ' aria-label="' + (stages.length ? '全部勾选或取消' : '标记完成') + '">' +
        '<span class="task__text">' + Util.escapeHtml(task.text) + '</span>';

    // 进度只在有阶段时显示 —— 没阶段的任务显示「0/1」是废话
    if (progress.hasStages) {
      row += '<span class="task__progress' +
        (progress.isComplete ? ' task__progress--done' : '') + '">' +
        progress.done + '/' + progress.total + '</span>';
    }

    // 展开 / 收起的小三角只有**有阶段**时才值得显示——
    // 没阶段的任务展开就是空的，三角只会让用户点了个寂寞
    if (stages.length) {
      row += '<button type="button" class="task__toggle" aria-expanded="' +
        (isOpen ? 'true' : 'false') + '" aria-label="展开或收起阶段">' +
        (isOpen ? '▾' : '▸') + '</button>';
    }

    // 完成时段（DS 2.12）：只给**没有阶段**的任务本体 ——
    // 有阶段时安排到哪一段由各阶段决定（和统计「数最细单位」同口径），
    // 否则同一件事出现两个时段，时间视图不知道听谁的
    if (!stages.length) {
      row += buildSlotSelectHtml(task.slot || null);
    }

    // 添加阶段的小按钮，永远在任务右上角（见 DS 2.9）。
    // 只显示一个「＋」，靠 aria-label / title 说明它是干什么的
    row += '' +
        '<button type="button" class="task__add-stage"' +
          ' title="添加阶段" aria-label="添加阶段">＋</button>';

    // 「推迟」按钮（DS 2.11）：只有**顶层任务**有 —— view.inBlock 由
    // buildBlockHtml 传进来，块内任务没有；要推迟先把它拖出块
    if (!view.inBlock) {
      row += '<button type="button" class="task__postpone"' +
        ' title="推迟到计划池" aria-label="推迟到计划池">推迟</button>';
    }

    row += '<button type="button" class="task__del" aria-label="删除任务">×</button>' +
      '</div>';

    var html = '<li class="task' + (progress.isComplete ? ' task--done' : '') +
      '" data-id="' + id + '">' + row;

    // 展开时才挂阶段列表。没阶段、又不是「正在加阶段」的任务，
    // 展开也只有一个空的 ul，所以干脆不画（见上面对三角的处理）
    var isAddingStage = !!(editing && editing.mode === 'add-stage' && editing.taskId === task.id);
    if (isOpen && (stages.length || isAddingStage)) {
      html += '<ul class="stages">';

      for (var i = 0; i < stages.length; i++) {
        var isEditingStage = !!(editing && editing.mode === 'edit-stage' &&
                                editing.taskId === task.id &&
                                editing.stageId === stages[i].id);
        html += buildStageHtml(stages[i], isEditingStage);
      }

      if (isAddingStage) {
        html += buildNewStageHtml();
      }

      html += '</ul>';
    }

    return html + '</li>';
  }

  /**
   * 一个象限的 HTML。
   *
   * @param {string} quadrantId
   * @param {Array} tasks
   * @param {Object} [view] 这一天的界面状态：
   *        editing    { quadrantId, mode, taskId, stageId, itemId }
   *                   mode 有六种：
   *                     'add'         在末尾挂一个新增任务的输入框
   *                     'edit-task'   把某条任务换成输入框
   *                     'add-stage'   给某条任务挂一个新增阶段的输入框
   *                     'edit-stage'  把某个阶段换成输入框
   *                     'add-block'   在末尾挂一个新增任务块的输入框（v1.1）
   *                     'edit-block'  把某个块收成改名输入框（v1.1）
   *        expanded   { 任务id: true } 哪些任务是展开的
   *        collapsedBlocks { 块id: true } 哪些块是收起的（块默认展开，见 D-36）
   *        progressOf 算进度的函数（app.js 传 TaskOps.progressOfItem 进来：
   *                   块聚合、任务算自己，两边一个算法）
   */
  function buildQuadrantHtml(quadrantId, tasks, view) {
    var quad = QUADRANT_BY_ID[quadrantId];
    if (!quad) return '';

    view = view || {};
    var editing = view.editing || null;
    var progressOf = view.progressOf || fallbackProgress;

    // 编辑状态只作用于它自己那个象限
    var here = (editing && editing.quadrantId === quadrantId) ? editing : null;

    var list = Array.isArray(tasks) ? tasks : [];
    var items = '';
    var unitDone = 0;
    var unitTotal = 0;

    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      var itemView = {
        editing: here,
        expanded: view.expanded,
        collapsedBlocks: view.collapsedBlocks,
        progressOf: progressOf
      };

      // 条目分两种：块走 buildBlockHtml（子条目在它里面递归复用 buildTaskHtml），
      // 普通任务走 buildTaskHtml。判断只认 type 标记，和 task-ops.isBlock 一个口径
      items += (item && item.type === 'block')
        ? buildBlockHtml(item, itemView)
        : buildTaskHtml(item, itemView);

      // 象限标题栏上的数字和顶部统计**用同一套口径**（按最细的可勾选单位算）。
      // 两边口径要是不同，用户会看到「象限里 2 条、顶部总数 7」这种对不上的数。
      // progressOf 由 app.js 传 progressOfItem 进来：块聚合块内、不算壳自己
      var progress = progressOf(item);
      unitDone += progress.done;
      unitTotal += progress.total;
    }

    if (here && here.mode === 'add') items += buildNewTaskHtml();
    if (here && here.mode === 'add-block') items += buildNewBlockHtml();

    // 空的象限不显示「0/0」，那是一句废话 —— 底下那句「暂无任务」已经说清楚了
    var countText = unitTotal ? (unitDone + '/' + unitTotal) : '';

    var body;
    if (items) {
      body = '<ul class="tasks">' + items + '</ul>';
    } else {
      body = '<p class="quadrant__empty">暂无任务</p>';
    }

    return '' +
      '<section class="quadrant quadrant--' + quad.id + '" data-quadrant="' + quad.id + '">' +
        '<header class="quadrant__head">' +
          '<span class="quadrant__name">' +
            '<i class="quadrant__dot"></i>' +
            '<b class="quadrant__id">' + quad.id + '</b>' +
            Util.escapeHtml(quad.name) +
          '</span>' +
          '<span class="quadrant__tools">' +
            '<span class="quadrant__count">' + countText + '</span>' +
            // 添加按钮放在象限标题栏的右上角（见 D-30）。
            // 只显示一个「＋」，所以必须靠 aria-label / title 说明它是干什么的。
            '<button type="button" class="quadrant__add"' +
              ' title="添加任务"' +
              ' aria-label="在「' + Util.escapeHtml(quad.name) + '」添加任务">＋</button>' +
            // v1.1：右边再加一个符号，添加**任务块**（requirements.txt 第 1 条）。
            // 同样遵守 D-30：32×32 点击区、aria-label、不随视觉缩小
            '<button type="button" class="quadrant__add-block"' +
              ' title="添加任务块"' +
              ' aria-label="在「' + Util.escapeHtml(quad.name) + '」添加任务块">▣</button>' +
          '</span>' +
        '</header>' +
        '<div class="quadrant__body">' + body + '</div>' +
      '</section>';
  }

  /**
   * 整天的 HTML（四个象限拼在一起）。
   *
   * view 直接原样往下传 —— 里面的 editing 自带 quadrantId，四个象限各自
   * 判断该不该响应它。展开状态也是全局一份，按任务 id 查。
   */
  function buildDayHtml(day, view) {
    var html = '';
    for (var i = 0; i < CONFIG.QUADRANT_IDS.length; i++) {
      var qid = CONFIG.QUADRANT_IDS[i];
      html += buildQuadrantHtml(qid, day ? day[qid] : [], view);
    }
    return html;
  }

  /**
   * 计划池里的一条（见 DS 2.11）。
   *
   * 池里是「待安排」的事，不是「正在做」的事：**没有勾选框** —— 显示勾选框
   * 会诱导用户在池里勾任务，而池内任务的完成状态只是进池前的历史遗留，
   * 进池后不再推进。一期池内也不展开阶段，行上只有文字和删除。
   */
  function buildPoolItemHtml(task, editing) {
    var id = Util.escapeHtml(task.id);

    // 正在改池内文字：整条收成输入框（复用 task__input，键盘 / 失焦逻辑共用）
    if (editing && editing.mode === 'edit-pool' && editing.poolItemId === task.id) {
      return '' +
        '<li class="pool__item pool__item--editing" data-id="' + id + '">' +
          '<div class="task__row">' +
            '<input type="text" class="task__input" value="' + Util.escapeHtml(task.text) + '"' +
              ' maxlength="500" aria-label="编辑计划池任务">' +
          '</div>' +
        '</li>';
    }

    // 正在改完成时间（DS 2.11 二期）：原地换一个日期输入框 + 清除按钮。
    // 输入框清空提交 = 清除时间（回「未设定」）
    if (editing && editing.mode === 'edit-pool-date' && editing.poolItemId === task.id) {
      return '' +
        '<li class="pool__item pool__item--editing" data-id="' + id + '">' +
          '<div class="task__row">' +
            '<input type="date" class="pool__date-input" value="' +
              Util.escapeHtml(task.plannedDate || '') + '" aria-label="设定完成时间">' +
            '<button type="button" class="pool__date-clear" aria-label="清除完成时间">清除</button>' +
          '</div>' +
        '</li>';
    }

    // 完成时间：未设定显示「未设定」（任务持续保留，不会被清掉），点了设定
    var dateHtml = task.plannedDate
      ? '<button type="button" class="pool__date" title="修改完成时间"' +
        ' aria-label="修改完成时间">' + Util.escapeHtml(task.plannedDate) + '</button>'
      : '<button type="button" class="pool__date pool__date--empty" title="设定完成时间"' +
        ' aria-label="设定完成时间">未设定</button>';

    return '' +
      '<li class="pool__item" data-id="' + id + '">' +
        '<div class="task__row">' +
          '<span class="pool__text">' + Util.escapeHtml(task.text) + '</span>' +
          dateHtml +
          '<button type="button" class="pool__del" aria-label="从计划池删除">×</button>' +
        '</div>' +
      '</li>';
  }

  /**
   * 计划池整块的 HTML（#pool 的 innerHTML，见 DS 2.11）。
   * 空池给一句占位，告诉用户东西从哪儿进来。
   */
  function buildPoolHtml(items, view) {
    view = view || {};
    var editing = view.editing || null;
    var list = Array.isArray(items) ? items : [];

    // 头部的「＋」是手动添加入口（三期）：点它在列表末尾长出输入框，
    // 和象限加任务同一套交互（D-31）
    var head = '<header class="pool__head">' +
      '<span class="pool__name">计划池</span>' +
      '<span class="pool__count">' + (list.length ? String(list.length) : '') + '</span>' +
      '<button type="button" class="pool__add"' +
        ' title="添加任务到计划池" aria-label="添加任务到计划池">＋</button>' +
      '</header>';

    // 正在添加：输入框挂在列表末尾（池空时没有列表，直接跟在提示后面）
    var adding = !!(editing && editing.mode === 'add-pool');
    var addRow = adding
      ? '<li class="pool__item pool__item--editing">' +
          '<div class="task__row">' +
            '<input type="text" class="task__input" value=""' +
              ' maxlength="500" placeholder="输入任务内容，回车确认" aria-label="新计划池任务">' +
          '</div>' +
        '</li>'
      : '';

    if (!list.length) {
      var empty = '<p class="pool__empty">计划池是空的。点任务行上的「推迟」，' +
        '或点上面的「＋」，把暂时不做的事放进来。</p>';
      return head + (adding ? '<ul class="pool__list">' + addRow + '</ul>' : empty);
    }

    var rows = '';
    for (var i = 0; i < list.length; i++) {
      rows += buildPoolItemHtml(list[i], editing);
    }
    return head + '<ul class="pool__list">' + rows + addRow + '</ul>';
  }

  /**
   * 时间视图（DS 2.13）：按时段分组的当天任务。
   *
   * groups 是 task-ops.getTimeView 算好的 [{ slot, items }]。这里只管画：
   * 每组一张卡片（图标 + 名称 + 条数 + 条目列表），包在一个网格容器里——
   * 两列还是单列是 CSS 的事（网页两列、≤600px 单列，见 D-40）。
   *
   * v1.2 起条目可操作（勾选 / 改文字 / 删除 / 改时段，D-40 修订）：
   * 类名和数据属性与象限视图一致，编辑框复用 task__input / stage__input，
   * app.js 的 commitEdit / 键盘 / 失焦逻辑零改动共用。
   */
  function buildTimeViewHtml(groups, view) {
    view = view || {};
    var editing = view.editing || null;
    var list = Array.isArray(groups) ? groups : [];

    if (!list.length) {
      return '<p class="timeview__empty">今天还没有安排时段的任务。' +
        '在任务行或阶段行的下拉里选一个时段，它们就会出现在这里。</p>';
    }

    var html = '<div class="timeview__grid">';
    for (var i = 0; i < list.length; i++) {
      var group = list[i];
      var icon = CONFIG.SLOT_ICONS[group.slot] || '';

      html += '<section class="timeview__group">' +
        '<h2 class="timeview__title">' + icon + ' ' + Util.escapeHtml(group.slot) +
          '<span class="timeview__count">' + group.items.length + '</span>' +
        '</h2>' +
        '<ul class="timeview__list">';

      for (var k = 0; k < group.items.length; k++) {
        html += buildTimeViewItemHtml(group.items[k], group.slot, editing);
      }

      html += '</ul></section>';
    }
    return html + '</div>';
  }

  /**
   * 时间视图里的一条条目（任务或阶段）。
   *
   * 类名和象限视图保持一致（task / task__row / task__check / task__text /
   * task__del，阶段是 stage / stage__check / stage__text / stage__del）——
   * 完成态划线、保护模式锁死、删除钮悬停出现那套 CSS 直接生效，不用抄一遍。
   * 数据属性带齐 data-quadrant / data-id / data-task-id / data-stage-id：
   * 象限从 DOM 嵌套反查 id，时间视图没有那层嵌套，id 直接写在条目身上，
   * 查出来以后走的是同一批 task-ops 函数、同一份数据。
   *
   * 时段下拉显示的「当前值」就是所在组的时段（条目正是按它进组的）。
   */
  function buildTimeViewItemHtml(item, slot, editing) {
    var qid = Util.escapeHtml(item.quadrantId);

    // ---- 任务条目 ----
    if (item.kind === 'task') {
      var taskAttrs = ' data-kind="task"' +
        ' data-id="' + Util.escapeHtml(item.taskId) + '"' +
        ' data-quadrant="' + qid + '"';

      if (editing && editing.mode === 'edit-task' && editing.taskId === item.taskId) {
        return '<li class="timeview__item task task--editing"' + taskAttrs + '>' +
          '<div class="task__row">' +
            '<input type="text" class="task__input" value="' + Util.escapeHtml(item.text) + '"' +
              ' maxlength="500" aria-label="编辑任务">' +
          '</div>' +
        '</li>';
      }

      return '<li class="timeview__item task' +
          (item.completed ? ' task--done timeview__item--done' : '') + '"' + taskAttrs + '>' +
        '<div class="task__row">' +
          '<input type="checkbox" class="task__check"' +
            (item.completed ? ' checked' : '') + ' aria-label="标记完成">' +
          '<span class="task__text timeview__text">' + Util.escapeHtml(item.text) + '</span>' +
          buildSlotSelectHtml(slot) +
          '<button type="button" class="task__del" aria-label="删除任务">×</button>' +
        '</div>' +
      '</li>';
    }

    // ---- 阶段条目（带所属任务标注：时间视图里看不到任务树，得说清它是谁的）----
    var stageAttrs = ' data-kind="stage"' +
      ' data-id="' + Util.escapeHtml(item.stageId) + '"' +
      ' data-task-id="' + Util.escapeHtml(item.taskId) + '"' +
      ' data-stage-id="' + Util.escapeHtml(item.stageId) + '"' +
      ' data-quadrant="' + qid + '"';

    if (editing && editing.mode === 'edit-stage' &&
        editing.taskId === item.taskId && editing.stageId === item.stageId) {
      return '<li class="timeview__item stage stage--editing"' + stageAttrs + '>' +
        '<input type="text" class="stage__input" value="' + Util.escapeHtml(item.text) + '"' +
          ' maxlength="500" aria-label="编辑阶段">' +
      '</li>';
    }

    return '<li class="timeview__item stage' +
        (item.completed ? ' stage--done timeview__item--done' : '') + '"' + stageAttrs + '>' +
      '<input type="checkbox" class="stage__check"' +
        (item.completed ? ' checked' : '') + ' aria-label="标记阶段完成">' +
      '<span class="stage__text timeview__text">' + Util.escapeHtml(item.text) +
        (item.parentText
          ? ' <span class="timeview__parent">· ' + Util.escapeHtml(item.parentText) + '</span>'
          : '') +
      '</span>' +
      buildSlotSelectHtml(slot) +
      '<button type="button" class="stage__del" aria-label="删除阶段">×</button>' +
    '</li>';
  }

  /** 完成率显示文本：一条任务都没有时不能除以零（见 DS 3.2） */
  function formatRate(done, total) {
    if (!total) return '—';
    return Math.round((done / total) * 100) + '%';
  }

  // -------------------------------------------------------------------------
  // 模板面板（DS 2.14）
  // -------------------------------------------------------------------------

  /** 一条模板的 HTML。改名模式整条收成输入框（复用 task__input，键盘 / 失焦逻辑共用） */
  function buildTemplateItemHtml(tpl, editing) {
    var id = Util.escapeHtml(tpl.id);

    if (editing && editing.mode === 'rename-template' && editing.templateId === tpl.id) {
      return '' +
        '<li class="tpl__item tpl__item--editing" data-id="' + id + '">' +
          '<div class="task__row">' +
            '<input type="text" class="task__input" value="' + Util.escapeHtml(tpl.name) + '"' +
              ' maxlength="100" aria-label="编辑模板名称">' +
          '</div>' +
        '</li>';
    }

    return '' +
      '<li class="tpl__item" data-id="' + id + '">' +
        '<div class="task__row">' +
          '<span class="tpl__name">' + Util.escapeHtml(tpl.name) + '</span>' +
          '<button type="button" class="tpl__apply" title="填充到当前查看的日期"' +
            ' aria-label="应用到当前日期">应用</button>' +
          '<button type="button" class="tpl__rename" title="重命名"' +
            ' aria-label="重命名模板">改名</button>' +
          '<button type="button" class="tpl__del" title="删除"' +
            ' aria-label="删除模板">×</button>' +
        '</div>' +
      '</li>';
  }

  /**
   * 模板面板整块的 HTML（#templates 的 innerHTML，见 DS 2.14）。
   * 布局复用计划池那套：头部（名称 + 计数 + 「存今天为模板」）+ 行列表。
   */
  function buildTemplatesHtml(templates, view) {
    view = view || {};
    var editing = view.editing || null;
    var list = Array.isArray(templates) ? templates : [];

    var head = '<header class="tpl__head">' +
      '<span class="tpl__title">模板</span>' +
      '<span class="tpl__count">' + (list.length ? String(list.length) : '') + '</span>' +
      '<button type="button" class="tpl__save"' +
        ' title="把当天任务表缓存为模板" aria-label="存今天为模板">存今天为模板</button>' +
      '</header>';

    if (!list.length) {
      return head + '<p class="tpl__empty">还没有模板。把今天的安排存成模板，' +
        '以后可以一键填充到别的日子。</p>';
    }

    var rows = '';
    for (var i = 0; i < list.length; i++) {
      rows += buildTemplateItemHtml(list[i], editing);
    }
    return head + '<ul class="tpl__list">' + rows + '</ul>';
  }

  // ===========================================================================
  // DOM 部分：把这些字符串塞进页面
  // ===========================================================================

  var el = {};

  function init() {
    el.banner = document.getElementById('banner');
    el.stats = document.getElementById('stats');
    el.statDone = document.getElementById('stat-done');
    el.statTotal = document.getElementById('stat-total');
    el.statRate = document.getElementById('stat-rate');
    el.quadrants = document.getElementById('quadrants');
    el.pool = document.getElementById('pool');
    el.timeview = document.getElementById('timeview');
    el.templates = document.getElementById('templates');
    el.toastHost = document.getElementById('toast-host');
    return Render;
  }

  /** 画出四个象限 */
  function renderQuadrants(day, view) {
    if (!el.quadrants) return;
    el.quadrants.innerHTML = buildDayHtml(day, view);
  }

  /** 画出四象限下方的计划池（view.pool 是数据里的 pool 数组） */
  function renderPool(pool, view) {
    if (!el.pool) return;
    el.pool.innerHTML = buildPoolHtml(pool, view);
  }

  /** 画出时间视图（groups 是 task-ops.getTimeView 算好的分组，view 带编辑状态） */
  function renderTimeView(groups, view) {
    if (!el.timeview) return;
    el.timeview.innerHTML = buildTimeViewHtml(groups, view);
  }

  /** 画出模板面板（view.templates 是数据里的 templates 数组） */
  function renderTemplates(templates, view) {
    if (!el.templates) return;
    el.templates.innerHTML = buildTemplatesHtml(templates, view);
  }

  /**
   * 切换主区域显示哪个视图（DS 2.13）：'quadrants' 显示四象限 + 计划池 + 模板，
   * 'time' 显示时间视图 + 计划池（计划池两个视图都留着，它跟日期无关，见 DS 2.11；
   * 模板面板只在四象限视图出现）。只是 hidden 开关，内容都在 DOM 里
   */
  function setViewMode(mode) {
    var isTime = (mode === 'time');
    if (el.quadrants) el.quadrants.hidden = isTime;
    if (el.pool) el.pool.hidden = false;
    if (el.templates) el.templates.hidden = isTime;
    if (el.timeview) el.timeview.hidden = !isTime;
  }

  /**
   * 编辑框出现之后把光标放进去。
   * 整块重画会丢掉焦点，所以每次重画完都要手动补一次。
   *
   * 谁先看得见就先找谁：时间视图开着时编辑框可能长在它里面（v1.2 起
   * 时间视图可编辑），别让焦点落进藏着的那一半。
   * 计划池的编辑框复用 task__input，外加它独有的 pool__date-input。
   */
  function focusEditor(selectAll) {
    var hosts = [];
    if (el.timeview && !el.timeview.hidden) hosts.push(el.timeview);
    if (el.quadrants && !el.quadrants.hidden) hosts.push(el.quadrants);
    if (el.pool) hosts.push(el.pool);
    if (el.templates) hosts.push(el.templates);

    var input = null;
    for (var i = 0; i < hosts.length && !input; i++) {
      input = hosts[i].querySelector('.task__input') ||
              hosts[i].querySelector('.stage__input') ||
              (hosts[i] === el.pool
                ? hosts[i].querySelector('.pool__date-input')
                : null);
    }
    if (!input) return;
    input.focus();
    if (selectAll) input.select();
  }

  /**
   * 更新顶部统计。
   * 数字是**算好了传进来的**（task-ops.js 负责算），这里只负责显示 —— 算画分离（DS 1.7 规矩二）。
   */
  function renderStats(stats) {
    if (!el.statDone) return;
    var done = (stats && stats.done) || 0;
    var total = (stats && stats.total) || 0;
    el.statDone.textContent = String(done);
    el.statTotal.textContent = String(total);
    el.statRate.textContent = formatRate(done, total);
  }

  /** 整页重画（view.pool 带计划池、view.templates 带模板数据时就连着一起画） */
  function render(day, stats, view) {
    renderQuadrants(day, view);
    renderStats(stats);
    renderPool(view && view.pool, view);
    renderTemplates(view && view.templates, view);
  }

  /**
   * 顶部提示条。传空字符串就隐藏。
   * 用于保护模式那种「必须让用户看见、但又不该是一闪而过的 toast」的状态（见 DS 2.4）。
   */
  function setBanner(text, actions) {
    if (!el.banner) return;
    if (!text) {
      el.banner.hidden = true;
      el.banner.innerHTML = '';
      return;
    }
    var html = '<span class="banner__text">' + Util.escapeHtml(text) + '</span>';
    if (actions && actions.length) {
      html += '<span class="banner__actions">';
      for (var i = 0; i < actions.length; i++) {
        html += '<button type="button" class="btn btn--ghost" data-action="' +
          Util.escapeHtml(actions[i].action) + '">' +
          Util.escapeHtml(actions[i].label) + '</button>';
      }
      html += '</span>';
    }
    el.banner.innerHTML = html;
    el.banner.hidden = false;
  }

  /**
   * 保护模式下把整个界面锁死：禁止一切写操作（见 DS 2.4）。
   * 这一步不能省 —— 只要允许编辑一次，保存就会把空数据写回主数据 key，
   * 把那份「读不出来但可能还能救」的原始数据永久覆盖。
   */
  function setReadOnly(readOnly) {
    document.body.classList.toggle('is-readonly', !!readOnly);
    if (el.quadrants) {
      // 添加任务、添加阶段 —— 能改数据的东西统统锁上
      var buttons = el.quadrants.querySelectorAll(
        '.quadrant__add, .task__add-stage');
      for (var i = 0; i < buttons.length; i++) {
        buttons[i].disabled = !!readOnly;
      }
    }
  }

  // -------------------------------------------------------------------------
  // 确认框
  // -------------------------------------------------------------------------

  var confirmHost = null;

  function ensureConfirmHost() {
    if (confirmHost && document.body.contains(confirmHost)) return confirmHost;
    confirmHost = document.createElement('div');
    confirmHost.className = 'modal';
    confirmHost.hidden = true;
    document.body.appendChild(confirmHost);
    return confirmHost;
  }

  /**
   * 弹一个确认框。
   *
   * 为什么不用浏览器自带的 `confirm()`：手机上样式很丑，而且它**会把整个页面卡住**
   * （见 DS 4.3）。这个是自己画的，长相和提示、和页面是一套。
   *
   * @param {Object} options { title, message, okLabel, cancelLabel, danger }
   * @param {Function} onOk 用户点了确认才回调；取消什么都不做
   */
  function openConfirm(options, onOk) {
    options = options || {};
    var host = ensureConfirmHost();

    host.innerHTML = '' +
      '<div class="modal__box" role="dialog" aria-modal="true">' +
        '<h2 class="modal__title">' + Util.escapeHtml(options.title || '') + '</h2>' +
        (options.message
          ? '<p class="modal__text">' + Util.escapeHtml(options.message) + '</p>'
          : '') +
        '<div class="modal__actions">' +
          '<button type="button" class="btn" data-act="cancel">' +
            Util.escapeHtml(options.cancelLabel || '取消') + '</button>' +
          '<button type="button" class="btn ' +
            (options.danger ? 'btn--danger' : 'btn--primary') + '" data-act="ok">' +
            Util.escapeHtml(options.okLabel || '确定') + '</button>' +
        '</div>' +
      '</div>';
    host.hidden = false;

    function close() {
      host.hidden = true;
      host.innerHTML = '';
      host.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKeyDown);
    }

    function onClick(e) {
      var btn = (e.target && e.target.closest) ? e.target.closest('[data-act]') : null;
      if (!btn) {
        // 点框外面（遮罩）等于取消
        if (e.target === host) close();
        return;
      }
      var act = btn.getAttribute('data-act');
      close();
      if (act === 'ok' && onOk) onOk();
    }

    function onKeyDown(e) {
      if (e.key === 'Escape') close();
    }

    host.addEventListener('click', onClick);
    document.addEventListener('keydown', onKeyDown);

    var okBtn = host.querySelector('[data-act="ok"]');
    if (okBtn) okBtn.focus();
  }

  /**
   * 弹一个只读的文本框，让用户自己复制内容。
   *
   * 用在「这条路走不通，但内容还能给你」的场合 —— 比如这台设备不能打印，
   * 那就把 Markdown 文本摆出来（见 DS 4.2）。
   *
   * @param {Object} options { title, message }
   * @param {string} text 要展示的文本
   * @param {Function} [onCopied] 复制成功后的回调（用来弹提示）
   */
  function openText(options, text, onCopied) {
    options = options || {};
    var host = ensureConfirmHost();

    host.innerHTML = '' +
      '<div class="modal__box modal__box--wide" role="dialog" aria-modal="true">' +
        '<h2 class="modal__title">' + Util.escapeHtml(options.title || '') + '</h2>' +
        (options.message
          ? '<p class="modal__text">' + Util.escapeHtml(options.message) + '</p>'
          : '') +
        // 用 textarea 的 value 装内容，天然不会当成 HTML —— 不给 XSS 留缝
        '<textarea class="modal__area" readonly rows="12" spellcheck="false"></textarea>' +
        '<div class="modal__actions">' +
          '<button type="button" class="btn" data-act="close">关闭</button>' +
          '<button type="button" class="btn btn--primary" data-act="copy">复制</button>' +
        '</div>' +
      '</div>';
    host.hidden = false;

    var area = host.querySelector('.modal__area');
    area.value = text;
    area.focus();
    area.select();

    function close() {
      host.hidden = true;
      host.innerHTML = '';
      host.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKeyDown);
    }

    function copy() {
      // 先试标准的剪贴板接口；它需要安全上下文，file:// 下会失败
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
          function () { if (onCopied) onCopied(); },
          function () { legacyCopy(); }
        );
        return;
      }
      legacyCopy();
    }

    function legacyCopy() {
      // 退回到 execCommand —— 已废弃，但覆盖面广，而且用户已经手动选中了
      area.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      if (onCopied) onCopied(ok);
    }

    function onClick(e) {
      var btn = (e.target && e.target.closest) ? e.target.closest('[data-act]') : null;
      if (!btn) {
        if (e.target === host) close();
        return;
      }
      var act = btn.getAttribute('data-act');
      if (act === 'copy') copy();
      else close();
    }

    function onKeyDown(e) {
      if (e.key === 'Escape') close();
    }

    host.addEventListener('click', onClick);
    document.addEventListener('keydown', onKeyDown);
  }

  /** 主题落到 <html data-theme="..."> 上，具体颜色由 CSS 变量决定 */
  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
  }

  return {
    // 纯函数（Node 里可测）
    buildTaskHtml: buildTaskHtml,
    buildStageHtml: buildStageHtml,
    buildSlotSelectHtml: buildSlotSelectHtml,
    buildBlockHtml: buildBlockHtml,
    buildNewBlockHtml: buildNewBlockHtml,
    buildQuadrantHtml: buildQuadrantHtml,
    buildDayHtml: buildDayHtml,
    buildPoolHtml: buildPoolHtml,
    buildPoolItemHtml: buildPoolItemHtml,
    buildTimeViewHtml: buildTimeViewHtml,
    buildTemplatesHtml: buildTemplatesHtml,
    buildTemplateItemHtml: buildTemplateItemHtml,
    formatRate: formatRate,
    fallbackProgress: fallbackProgress,

    // DOM
    init: init,
    render: render,
    renderQuadrants: renderQuadrants,
    renderPool: renderPool,
    renderTimeView: renderTimeView,
    renderTemplates: renderTemplates,
    setViewMode: setViewMode,
    renderStats: renderStats,
    focusEditor: focusEditor,
    setBanner: setBanner,
    setReadOnly: setReadOnly,
    setTheme: setTheme,
    openConfirm: openConfirm,
    openText: openText
  };
})(
  typeof CONFIG !== 'undefined' ? CONFIG : require('./config.js'),
  typeof Util !== 'undefined' ? Util : require('./util.js')
);

// Node 测试环境用（浏览器里没有 module，这段不会执行）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Render;
}
