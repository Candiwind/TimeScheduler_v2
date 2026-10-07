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
      '<li class="stage' + (stage.completed ? ' stage--done' : '') +
        // 高亮（requirements 最新一条，见 DS 2.40）：加在整条上，底色画在
        // .stage__text 那段文字上；完成后自动失效交给 CSS（.stage--done 排除）
        (stage.highlight === true ? ' stage--highlight' : '') + '"' +
        ' data-id="' + Util.escapeHtml(stage.id) + '">' +
        '<input type="checkbox" class="stage__check"' +
          (stage.completed ? ' checked' : '') +
          ' aria-label="标记阶段完成">' +
        '<span class="stage__text">' + Util.escapeHtml(stage.text) + '</span>' +
        // v2.11 需求 1/2（见 DS 2.46）：文字右边这串控件收进一个组 ——
        // 手机端装不下时**整组**折到下一行（不会只折一半），且靠右对齐、左侧留空
        '<span class="task__actions">' +
        // 时段挂在各阶段身上（DS 2.12）：有阶段的任务，安排到哪一段由各阶段决定
        buildSlotSelectHtml(stage.slot || null) +
        // Bonus（需求 2）：阶段可单独标记，图标礼品
        '<button type="button" class="stage__bonus' +
          (stage.bonus === true ? ' bonus--on' : '') + '"' +
          ' title="设为 Bonus" aria-label="设为 Bonus">🎁</button>' +
        // 阶段也是推迟对象（requirements 第 3 条）：推迟时保存为池内任务，
        // 文本前加 [所属任务] 前缀（见 DS 2.11 postponeStage）
        '<button type="button" class="stage__postpone"' +
          ' title="推迟到计划池" aria-label="推迟到计划池">推迟</button>' +
        '<button type="button" class="stage__del" aria-label="删除阶段">×</button>' +
        '</span>' +
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
        // v2.11 需求 1/2（见 DS 2.46）：右侧这串控件收进一个组
        '<span class="task__actions">' +
        '<span class="task__progress' + (progress.isComplete ? ' task__progress--done' : '') + '">' +
          progress.done + '/' + progress.total + '</span>' +
        '<button type="button" class="block__toggle" aria-expanded="' + (!isCollapsed) +
          '" aria-label="展开或收起任务块">' + (isCollapsed ? '▸' : '▾') + '</button>' +
        '<button type="button" class="block__postpone" title="整体推迟到计划池"' +
          ' aria-label="整体推迟到计划池">推迟</button>' +
        '<button type="button" class="block__del" aria-label="删除任务块">×</button>' +
        '</span>' +
      '</div>';

    var body = '';
    if (!isCollapsed) {
      // 块内任务多带一个 inBlock 标记：块内**拆了阶段**的任务不给整条「推迟」
      // 按钮（整条推会把阶段一起卷走，靠逐个阶段推迟）；没拆阶段的照给
      // （v2.3 需求 2 / D-54，条件在 buildTaskHtml 里）
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
        // 高亮（见 DS 2.40）：画在块名上 —— 块是容器，标的是块头那行字
        (block.highlight === true ? ' block--highlight' : '') +
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
        '<span class="task__text">' + Util.escapeHtml(task.text) + '</span>' +
        // v2.11 需求 1/2（见 DS 2.46）：右侧这串控件收进一个组 ——
        // 手机端装不下时**整组**折到下一行（不会只折一半），且靠右对齐、左侧留空
        '<span class="task__actions">';

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
      // Bonus（需求 2）：也只给没有阶段的任务本体（有阶段时由各阶段分别标）
      row += '<button type="button" class="task__bonus' +
        (task.bonus === true ? ' bonus--on' : '') + '"' +
        ' title="设为 Bonus" aria-label="设为 Bonus">🎁</button>';
    }

    // 添加阶段的小按钮，永远在任务右上角（见 DS 2.9）。
    // 只显示一个「＋」，靠 aria-label / title 说明它是干什么的
    row += '' +
        '<button type="button" class="task__add-stage"' +
          ' title="添加阶段" aria-label="添加阶段">＋</button>';

    // 「推迟」按钮（DS 2.11）：顶层任务都有；块内任务里**没拆阶段**的也有
    //（requirements 第 2 条：任务块中没划分阶段的任务要支持推迟）。
    // 有阶段的块内任务整条推迟会把阶段一起卷走，仍走「逐个阶段推迟」——
    // view.inBlock 由 buildBlockHtml 传进来，没传 = 顶层任务。
    if (!view.inBlock || !stages.length) {
      row += '<button type="button" class="task__postpone"' +
        ' title="推迟到计划池" aria-label="推迟到计划池">推迟</button>';
    }

    row += '<button type="button" class="task__del" aria-label="删除任务">×</button>' +
      '</span>' +
      '</div>';

    // 高亮（requirements 最新一条，见 DS 2.40）：带阶段的任务本体也能标黄 ——
    // 双击的是任务行那段文字，和下面各阶段的高亮互不影响
    var html = '<li class="task' + (progress.isComplete ? ' task--done' : '') +
      (task.highlight === true ? ' task--highlight' : '') +
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
   *                     'add'         在开头挂一个新增任务的输入框
   *                     'edit-task'   把某条任务换成输入框
   *                     'add-stage'   给某条任务挂一个新增阶段的输入框
   *                     'edit-stage'  把某个阶段换成输入框
   *                     'add-block'   在开头挂一个新增任务块的输入框（v1.1）
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

    // 需求（重命名后 3）：新增任务的输入框挂在**开头**，和「新任务加到开头」
    // 的数据位置对齐 —— 用户在哪敲，任务就落在哪，不会出现「在底部敲、跑到顶部」。
    var newItemHtml = '';
    if (here && here.mode === 'add') newItemHtml = buildNewTaskHtml();
    else if (here && here.mode === 'add-block') newItemHtml = buildNewBlockHtml();
    items = newItemHtml + items;

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
   * v2.7 需求 1 之前这里**没有勾选框**（理由是「池里是待安排的事，勾选会诱导
   * 用户推进它」）；该需求明确要求池内块和象限块同格式同功能，所以勾选框
   * 加回来了 —— 勾完只划掉变淡、沉到所在列表末尾，**不移出池**（要移出仍靠
   * 「导入」或拖回），也就是把「勾选」和「移出池」两件事分开。
   *
   * 池内仍不展开阶段（D-61）：行上是勾选框 + 文字 + 完成时间 + 导入 + 删除。
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

    // 勾选状态读 completed：有阶段时它是派生值（以阶段为准，store.normalize
    // 和每次阶段改动都会同步），没阶段时就是用户自己勾的那个
    var checked = !!task.completed;

    return '' +
      '<li class="pool__item' + (checked ? ' pool__item--done' : '') +
        // 高亮（见 DS 2.40）：从象限推迟进来的任务带着 highlight，池里照画
        (task.highlight === true ? ' pool__item--highlight' : '') +
        '" data-id="' + id + '">' +
        '<div class="task__row">' +
          '<input type="checkbox" class="pool__check"' + (checked ? ' checked' : '') +
            ' aria-label="标记完成">' +
          '<span class="pool__text">' + Util.escapeHtml(task.text) + '</span>' +
          // v2.11 需求 1/2（见 DS 2.46）：右侧这串控件收进一个组
          '<span class="task__actions">' +
          dateHtml +
          // v2.6 需求 2：把这条（含全部阶段）导入当前查看日期的第二象限。
          // 是**移动**不是复制 —— 池里不再保留（见 DS 2.31）
          '<button type="button" class="pool__import" title="导入到第二象限"' +
            ' aria-label="导入到第二象限">导入</button>' +
          '<button type="button" class="pool__del" aria-label="从计划池删除">×</button>' +
          '</span>' +
        '</div>' +
      '</li>';
  }

  /**
   * 计划池里的一个任务块（需求 4；v2.7 起和象限块同格式同功能）。
   *
   * 块头 = 勾选框（一键全勾 / 全取消）+ 块名（点击改名）+ 完成度 n/m +
   * 折叠三角 + 动作按钮（池内是「导入」，象限里是「推迟」—— 池本来就是
   * 推迟的目的地，见 D-61）。体是块内任务列表（复用 buildPoolItemHtml，
   * DDL 逐条挂在任务行上）。
   *
   * 完成度走 view.progressOf（app.js 传的就是 TaskOps.progressOfItem），
   * 和象限块头、顶部统计同一个算法 —— 别在这里另算一套。
   */
  function buildPoolBlockHtml(block, view) {
    view = view || {};
    var editing = view.editing || null;
    var collapsed = view.collapsedBlocks || {};
    var progressOf = view.progressOf || fallbackProgress;
    var id = Util.escapeHtml(block.id);
    var isCollapsed = !!collapsed[block.id];
    var tasks = Array.isArray(block.tasks) ? block.tasks : [];

    // 正在改块名：整条收成一个输入框（和象限改块名同一套交互，见 D-31）
    if (editing && editing.mode === 'edit-pool-block' && editing.blockId === block.id) {
      return '' +
        '<li class="pool__block pool__block--editing" data-id="' + id + '">' +
          '<div class="task__row">' +
            '<input type="text" class="task__input" value="' + Util.escapeHtml(block.text) + '"' +
              ' maxlength="500" aria-label="编辑任务块">' +
          '</div>' +
        '</li>';
    }

    var progress = progressOf(block);

    var head = '' +
      '<div class="pool__block-head">' +
        '<input type="checkbox" class="pool__block-check"' +
          (progress.isComplete ? ' checked' : '') +
          ' aria-label="全部勾选或取消块内任务">' +
        '<span class="pool__block-name">' + Util.escapeHtml(block.text) + '</span>' +
        // v2.11 需求 1/2（见 DS 2.46）：右侧这串控件收进一个组
        '<span class="task__actions">' +
        // 完成度：池内块头也有 n/m，和象限块头同一个类名 / 同一个算法
        '<span class="task__progress' + (progress.isComplete ? ' task__progress--done' : '') + '">' +
          progress.done + '/' + progress.total + '</span>' +
        '<button type="button" class="pool__block-toggle" aria-expanded="' + (!isCollapsed) +
          '" aria-label="展开或收起任务块">' + (isCollapsed ? '▸' : '▾') + '</button>' +
        // v2.6 需求 2：整块（含块内任务）一起导入第二象限，不拆散
        '<button type="button" class="pool__block-import" title="整块导入到第二象限"' +
          ' aria-label="整块导入到第二象限">导入</button>' +
        '<button type="button" class="pool__block-add" title="在块里加任务"' +
          ' aria-label="在块里加任务">＋</button>' +
        '<button type="button" class="pool__block-del" aria-label="删除任务块">×</button>' +
        '</span>' +
      '</div>';

    var body = '';
    if (!isCollapsed) {
      var rows = '';
      for (var i = 0; i < tasks.length; i++) {
        rows += buildPoolItemHtml(tasks[i], editing);
      }

      var isAdding = !!(editing && editing.mode === 'add-pool-block-task' &&
                        editing.blockId === block.id);
      if (isAdding) {
        rows += '<li class="pool__item pool__item--editing">' +
                  '<div class="task__row">' +
                    '<input type="text" class="task__input" value="" maxlength="500"' +
                      ' placeholder="输入任务内容，回车确认" aria-label="新块内任务">' +
                  '</div>' +
                '</li>';
      }
      if (!tasks.length && !isAdding) {
        rows += '<li class="pool__block-empty">块是空的，点右上角「＋」加任务</li>';
      }
      body = '<ul class="pool__block-tasks">' + rows + '</ul>';
    }

    return '<li class="pool__block' + (progress.isComplete ? ' pool__block--done' : '') +
      // 高亮（见 DS 2.40）：池内块和历史一样画在块名上
      (block.highlight === true ? ' pool__block--highlight' : '') +
      '" data-id="' + id + '">' + head + body + '</li>';
  }

  /**
   * 板块收起的三角（v2.8 需求 3）：阅读栏 / 计划池 / 模板池共用。
   *
   * 收起状态本身不靠这个按钮记 —— 它由 app.js 存进本机（foldState 的
   * collapsedPanels），渲染时通过 view.collapsedPanels 传进来，只用来把
   * 三角的朝向和 aria-expanded 画对。所以这里没有任何状态。
   */
  function panelToggleHtml(panelId, view) {
    var collapsed = !!(view && view.collapsedPanels && view.collapsedPanels[panelId]);
    var label = collapsed ? '展开' : '收起';
    return '<button type="button" class="panel__toggle" data-panel="' +
      Util.escapeHtml(panelId) + '" aria-expanded="' + (collapsed ? 'false' : 'true') +
      '" title="' + label + '面板" aria-label="' + label + '面板">▾</button>';
  }

  /**
   * 计划池整块的 HTML（#pool 的 innerHTML，见 DS 2.11）。
   * 空池给一句占位，告诉用户东西从哪儿进来。
   */
  function buildPoolHtml(items, view) {
    view = view || {};
    var editing = view.editing || null;
    var list = Array.isArray(items) ? items : [];

    // 头部三个入口：▾ 收起（v2.8 需求 3）、「＋」加任务（三期）、「▣」加任务块（需求 4）。
    var head = '<header class="pool__head">' + panelToggleHtml('pool', view) +
      '<span class="pool__name">计划池</span>' +
      '<span class="pool__count">' + (list.length ? String(list.length) : '') + '</span>' +
      '<button type="button" class="pool__add"' +
        ' title="添加任务到计划池" aria-label="添加任务到计划池">＋</button>' +
      '<button type="button" class="pool__add-block"' +
        ' title="添加任务块到计划池" aria-label="添加任务块到计划池">▣</button>' +
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

    var addingBlock = !!(editing && editing.mode === 'add-pool-block');
    var addBlockRow = addingBlock
      ? '<li class="pool__item pool__item--editing">' +
          '<div class="task__row">' +
            '<input type="text" class="task__input" value=""' +
              ' maxlength="500" placeholder="输入任务块名称，回车确认" aria-label="新计划池任务块">' +
          '</div>' +
        '</li>'
      : '';

    if (!list.length) {
      var empty = '<p class="pool__empty">计划池是空的。点任务行上的「推迟」，' +
        '或点上面的「＋」「▣」，把暂时不做的事放进来。</p>';
      return head + (adding || addingBlock
        ? '<ul class="pool__list">' + addBlockRow + addRow + '</ul>'
        : empty);
    }

    var rows = '';
    for (var i = 0; i < list.length; i++) {
      rows += (list[i].type === 'block')
        ? buildPoolBlockHtml(list[i], view)
        : buildPoolItemHtml(list[i], editing);
    }
    return head + '<ul class="pool__list">' + rows + addBlockRow + addRow + '</ul>';
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

      html += '<section class="timeview__group" data-slot="' + Util.escapeHtml(group.slot) + '">' +
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
          (item.completed ? ' task--done timeview__item--done' : '') +
          (item.highlight === true ? ' task--highlight' : '') + '"' + taskAttrs + '>' +
        '<div class="task__row">' +
          '<input type="checkbox" class="task__check"' +
            (item.completed ? ' checked' : '') + ' aria-label="标记完成">' +
          '<span class="task__text timeview__text">' + Util.escapeHtml(item.text) + '</span>' +
          // v2.11 需求 1/2（见 DS 2.46）：右侧这串控件收进一个组
          '<span class="task__actions">' +
          (item.bonus ? '<span class="bonus__mark" title="Bonus">🎁</span>' : '') +
          buildSlotSelectHtml(slot) +
          '<button type="button" class="task__del" aria-label="删除任务">×</button>' +
          '</span>' +
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
        (item.completed ? ' stage--done timeview__item--done' : '') +
        (item.highlight === true ? ' stage--highlight' : '') + '"' + stageAttrs + '>' +
      '<input type="checkbox" class="stage__check"' +
        (item.completed ? ' checked' : '') + ' aria-label="标记阶段完成">' +
      '<span class="stage__text timeview__text">' + Util.escapeHtml(item.text) +
        (item.parentText
          ? ' <span class="timeview__parent">· ' + Util.escapeHtml(item.parentText) + '</span>'
          : '') +
      '</span>' +
      // v2.11 需求 1/2（见 DS 2.46）：右侧这串控件收进一个组
      '<span class="task__actions">' +
      (item.bonus ? '<span class="bonus__mark" title="Bonus">🎁</span>' : '') +
      buildSlotSelectHtml(slot) +
      '<button type="button" class="stage__del" aria-label="删除阶段">×</button>' +
      '</span>' +
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

    var head = '<header class="tpl__head">' + panelToggleHtml('templates', view) +
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

  /**
   * 阅读栏（v2.8 需求 2，见 DS 2.37）。
   *
   * 上下两段：**正在阅读**（可勾完成 / 改名 / 设起始时间 / 删除）和
   * **已读完成**（起始 → 完成时刻，可改起始时间、可取消完成、可删除）。
   *
   * 结构 = { active: [...], done: [...] }，两个数组都在数据里，渲染只负责画。
   * 「正在阅读」的条数超过 CONFIG.READING_ACTIVE_HINT 时把计数标红 ——
   * 需求说的是「提示不超过3项」，所以只提示不拦（D-64）。
   */
  function buildReadingHtml(reading, view) {
    view = view || {};
    var editing = view.editing || null;
    var src = (reading && typeof reading === 'object') ? reading : {};
    var active = Array.isArray(src.active) ? src.active : [];
    var done = Array.isArray(src.done) ? src.done : [];
    var limit = CONFIG.READING_ACTIVE_HINT;

    var head = '<header class="reading__head">' + panelToggleHtml('reading', view) +
      '<span class="reading__name">📖 阅读栏</span>' +
      '<span class="reading__count' + (active.length > limit ? ' reading__count--over' : '') +
        '" title="' + (active.length > limit
          ? '正在阅读 ' + active.length + ' 项，建议不超过 ' + limit + ' 项'
          : '正在阅读 / 建议上限') +
        '">' + active.length + '/' + limit + '</span>' +
      '<button type="button" class="reading__add"' +
        ' title="添加正在阅读的事项" aria-label="添加正在阅读的事项">＋</button>' +
      '</header>';

    var adding = !!(editing && editing.mode === 'add-reading');
    var addRow = adding
      ? '<li class="reading__item reading__item--editing">' +
          '<div class="task__row">' +
            '<input type="text" class="task__input" value=""' +
              ' maxlength="500" placeholder="正在读什么？回车确认" aria-label="新阅读事项">' +
          '</div>' +
        '</li>'
      : '';

    if (!active.length && !done.length && !adding) {
      return head + '<p class="reading__empty">还没有在读的东西。点右上角「＋」' +
        '记一条，读完勾掉，它就会出现在下面的「已读完成」里。</p>';
    }

    var rows = '';
    for (var i = 0; i < active.length; i++) {
      rows += buildReadingItemHtml(active[i], editing, false);
    }
    rows += addRow;

    var html = head +
      '<ul class="reading__list">' +
        (rows || '<li class="reading__none">暂时没有正在阅读的事项</li>') +
      '</ul>';

    var doneRows = '';
    for (var k = 0; k < done.length; k++) {
      doneRows += buildReadingItemHtml(done[k], editing, true);
    }

    html += '<div class="reading__done">' +
      '<p class="reading__subtitle">已读完成' +
        '<span class="reading__done-count">' + (done.length ? String(done.length) : '') +
        '</span></p>' +
      (done.length
        ? '<ul class="reading__done-list">' + doneRows + '</ul>'
        : '<p class="reading__done-empty">还没有读完的。勾掉上面的一条，' +
          '这里会记下完成时间。</p>') +
      '</div>';

    return html;
  }

  /**
   * 一条阅读记录。done 为 true 画在「已读完成」那段里：
   * 开头多一个「↩」取消完成，日期后面跨天时多一个「→ 完成日期」。
   *
   * 两个编辑态各用各的输入框：改名复用 task__input（和别处一致，
   * 键盘 / 失焦提交也就共用了），起始日期用 <input type="date">。
   */
  function buildReadingItemHtml(item, editing, done) {
    var id = Util.escapeHtml(item.id);
    var isEditing = !!(editing && editing.mode === 'edit-reading' &&
                       editing.readingItemId === item.id);
    var isEditingStart = !!(editing && editing.mode === 'edit-reading-start' &&
                            editing.readingItemId === item.id);

    if (isEditing) {
      return '<li class="reading__item' + (done ? ' reading__item--done' : '') +
        ' reading__item--editing" data-id="' + id + '">' +
          '<div class="task__row">' +
            '<input type="text" class="task__input" value="' +
              Util.escapeHtml(item.text) + '" maxlength="500" aria-label="编辑阅读事项">' +
          '</div></li>';
    }

    if (isEditingStart) {
      return '<li class="reading__item' + (done ? ' reading__item--done' : '') +
        ' reading__item--editing" data-id="' + id + '">' +
          '<div class="task__row">' +
            '<input type="date" class="reading__start-input" value="' +
              Util.escapeHtml(item.start || '') + '" aria-label="设置起始日期">' +
            '<button type="button" class="reading__start-clear"' +
              ' title="清空起始日期" aria-label="清空起始日期">清除</button>' +
          '</div></li>';
    }

    var left = done
      ? '<button type="button" class="reading__restore"' +
          ' title="取消完成，放回正在阅读" aria-label="取消完成">↩</button>'
      : '<input type="checkbox" class="reading__check" aria-label="标记读完">';

    // 起始日期**两段里都是点得动的按钮**（v2.8 补充修订三）：需求明说已读完成
    // 那边「可以自己修改起息时间」，那就得先有个能点的东西 —— 之前那行画的是
    // 死文本，改不了。长相和池里的完成时间按钮一模一样（D-70）。
    var startBtn = '<button type="button" class="reading__start' +
        (item.start ? '' : ' reading__start--empty') +
        '" title="设定起始日期" aria-label="设定起始日期">' +
        (item.start ? Util.escapeHtml(item.start) : '未设定') + '</button>';

    // 起始日期和完成日期**同一天就只写一个**（读一本书常常当天开始当天读完，
    // 画成「2026-10-06 → 2026-10-06」是纯噪音）；不同天才用箭头连起来
    var doneHtml = Util.escapeHtml(item.doneAt || '');
    var right = (done && item.doneAt && item.doneAt !== item.start)
      ? '<span class="reading__time">' + startBtn +
        '<span class="reading__arrow">→</span>' +
        '<span class="reading__done-at">' + doneHtml + '</span></span>'
      : startBtn;

    return '<li class="reading__item' + (done ? ' reading__item--done' : '') +
      '" data-id="' + id + '">' +
        '<div class="task__row">' +
          left +
          '<span class="reading__text">' + Util.escapeHtml(item.text) + '</span>' +
          right +
          '<button type="button" class="reading__del"' +
            ' aria-label="删除阅读事项">×</button>' +
        '</div></li>';
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
    el.reading = document.getElementById('reading');
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

  /** 画出阅读栏（view.reading 是数据里的 reading = { active, done }，v2.8） */
  function renderReading(reading, view) {
    if (!el.reading) return;
    el.reading.innerHTML = buildReadingHtml(reading, view);
  }

  /**
   * 板块收起（v2.8 需求 3）：把 is-collapsed 落到三个板块元素上。
   *
   * 收起只影响**画出来的样子**，DOM 里的内容照旧重画 —— 这样展开时不用
   * 补渲染，也不会出现「收起期间数据变了、展开后还是旧的」。
   */
  function setCollapsedPanels(collapsedPanels) {
    var panels = CONFIG.PANEL_IDS;
    var map = collapsedPanels || {};
    for (var i = 0; i < panels.length; i++) {
      var node = el[panels[i]];
      if (node) node.classList.toggle('is-collapsed', !!map[panels[i]]);
    }
  }

  /**
   * 切换主区域显示哪个视图（DS 2.13）：'quadrants' 显示四象限 + 计划池 + 模板，
   * 'time' 显示时间视图 + 计划池（计划池两个视图都留着，它跟日期无关，见 DS 2.11；
   * 模板面板只在四象限视图出现）。只是 hidden 开关，内容都在 DOM 里
   *
   * 阅读栏（v2.8）和计划池同待遇：**两个视图都露着**。它记的是「正在读什么」，
   * 和日期、象限都无关，藏起来用户就点不到「完成」了。
   */
  function setViewMode(mode) {
    var isTime = (mode === 'time');
    if (el.quadrants) el.quadrants.hidden = isTime;
    if (el.pool) el.pool.hidden = false;
    if (el.reading) el.reading.hidden = false;
    if (el.templates) el.templates.hidden = isTime;
    if (el.timeview) el.timeview.hidden = !isTime;
  }

  /**
   * 编辑框出现之后把光标放进去。
   * 整块重画会丢掉焦点，所以每次重画完都要手动补一次。
   *
   * 谁先看得见就先找谁：时间视图开着时编辑框可能长在它里面（v1.2 起
   * 时间视图可编辑），别让焦点落进藏着的那一半。
   * 计划池的编辑框复用 task__input，外加它独有的 pool__date-input；
   * 阅读栏同理，多一个 reading__start-input（v2.8）。
   */
  function focusEditor(selectAll) {
    var hosts = [];
    if (el.timeview && !el.timeview.hidden) hosts.push(el.timeview);
    if (el.quadrants && !el.quadrants.hidden) hosts.push(el.quadrants);
    if (el.reading) hosts.push(el.reading);
    if (el.pool) hosts.push(el.pool);
    if (el.templates) hosts.push(el.templates);

    var input = null;
    for (var i = 0; i < hosts.length && !input; i++) {
      // 一次列全所有编辑框的输入框。**屏幕上同时只有一个编辑框**（state.editing
      // 是单个对象，渲染也只画一处），所以不必按 mode 逐个挑 —— 那种写法每加一种
      // 编辑框都得回来补一笔，漏了就静默失效（见 DS R-40）。
      input = hosts[i].querySelector(
        '.task__input, .stage__input, .pool__date-input, .reading__start-input');
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
    // 完成率（需求 2）：分母只计非 Bonus；全是 Bonus 时退化为 Bonus 总数
    var den = total > 0 ? total : ((stats && stats.bonusCount) || 0);
    el.statRate.textContent = formatRate(done, den);
  }

  /** 整页重画（view.pool 带计划池、view.templates 带模板数据时就连着一起画） */
  function render(day, stats, view) {
    renderQuadrants(day, view);
    renderStats(stats);
    renderPool(view && view.pool, view);
    renderReading(view && view.reading, view);
    renderTemplates(view && view.templates, view);
    // 收起状态一并在重画时落下去：换视图 / 改数据都不该把收起的面板弹开
    setCollapsedPanels(view && view.collapsedPanels);
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
  // 滚动位置快照（v2.10 需求 1）
  //
  // 重画走的是**整块 innerHTML 替换**（见 DS 2.1 的取舍）：容器元素是新造的，
  // 浏览器的 scrollTop 天然回到 0。于是「滚到列表中间勾一条完成」这个动作会
  // 把用户的滚动位置吃掉，条目一多就非常难用。
  //
  // 修法不能改成增量更新 DOM（那是把 DS 2.1 整个推翻，代价太大），而是在
  // **重画前后各做一次快照**：渲染器只负责「采」和「贴」，什么时候用由
  // app.js 决定（见 renderCurrent 的 keepScroll 选项）。
  //
  // 键必须**由结构和内容决定**，不能用元素身份 —— 每次重画都是新元素：
  //   - 象限 / 时间视图 / 池内块各自有多份，靠 data-quadrant / data-slot /
  //     data-id 区分；
  //   - 计划池、模板池、阅读栏各只有一份，给个固定名就行。
  // -------------------------------------------------------------------------

  /**
   * 登记表：**页面上每一个会纵向滚动的容器都要在这里有一行**，
   * 漏一个那一处就还是老样子（滚回顶部）。
   *
   * sel   = 滚动元素本身的选择器（样式表里 overflow-y: auto 的那些）；
   * scope = 往上找最近的这个祖先，用它的属性当键的一部分；
   * attr  = 拿哪个属性当键（没有 scope 的行写 null）。
   */
  var SCROLL_SLOTS = [
    { key: 'q',   sel: '.quadrant__body',     scope: '.quadrant',        attr: 'data-quadrant' },
    { key: 'tv',  sel: '.timeview__list',     scope: '.timeview__group', attr: 'data-slot' },
    { key: 'pb',  sel: '.pool__list',         scope: null,               attr: null },
    { key: 'tpl', sel: '.tpl__list',          scope: null,               attr: null },
    { key: 'rd',  sel: '.reading__list',      scope: null,               attr: null },
    { key: 'rdd', sel: '.reading__done-list', scope: null,               attr: null }
  ];

  /** 一个滚动元素对应哪个键；定不出键（祖先属性缺了）就返回 null，跳过 */
  function scrollKeyOf(node, slot) {
    if (!slot.scope) return slot.key;
    var scope = node.closest ? node.closest(slot.scope) : null;
    if (!scope) return null;
    var v = scope.getAttribute(slot.attr);
    return v ? (slot.key + ':' + v) : null;
  }

  /**
   * 拍快照：`{ 键 → scrollTop }`。
   *
   * 只在浏览器里有意义，Node 里（测试跑纯函数）没有 document，
   * 直接返回空快照 —— 调用方不必自己判环境。
   */
  function captureScroll() {
    var snap = {};
    if (typeof document === 'undefined') return snap;

    for (var i = 0; i < SCROLL_SLOTS.length; i++) {
      var slot = SCROLL_SLOTS[i];
      var nodes = document.querySelectorAll(slot.sel);
      for (var j = 0; j < nodes.length; j++) {
        var key = scrollKeyOf(nodes[j], slot);
        if (key) snap[key] = nodes[j].scrollTop;
      }
    }
    return snap;
  }

  /**
   * 把快照贴回去。**只认键，不认元素** —— 找得到同名容器就还原，
   * 找不到（那一段这次没画出来）就跳过，不报错。
   */
  function restoreScroll(snap) {
    if (!snap || typeof document === 'undefined') return;

    for (var i = 0; i < SCROLL_SLOTS.length; i++) {
      var slot = SCROLL_SLOTS[i];
      var nodes = document.querySelectorAll(slot.sel);
      for (var j = 0; j < nodes.length; j++) {
        var key = scrollKeyOf(nodes[j], slot);
        if (key && snap[key] !== undefined) nodes[j].scrollTop = snap[key];
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
   * 弹一个多选对话框，让用户在几个动作里挑一个（导入的「合并 / 覆盖」用）。
   *
   * @param {Object} options { title, message, choices: [{ act, label, danger }] }
   * @param {Function} onPick 用户点了某个动作才回调（传那个动作的 act）；取消不回调
   */
  function openChoice(options, onPick) {
    options = options || {};
    var host = ensureConfirmHost();

    var buttons = '';
    var choices = Array.isArray(options.choices) ? options.choices : [];
    for (var i = 0; i < choices.length; i++) {
      var c = choices[i];
      buttons += '<button type="button" class="btn ' +
        (c.danger ? 'btn--danger' : 'btn--primary') + '" data-act="' +
        Util.escapeHtml(c.act) + '">' + Util.escapeHtml(c.label) + '</button>';
    }

    host.innerHTML = '' +
      '<div class="modal__box" role="dialog" aria-modal="true">' +
        '<h2 class="modal__title">' + Util.escapeHtml(options.title || '') + '</h2>' +
        (options.message
          ? '<p class="modal__text">' + Util.escapeHtml(options.message) + '</p>'
          : '') +
        '<div class="modal__actions">' +
          buttons +
          '<button type="button" class="btn" data-act="cancel">取消</button>' +
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
        if (e.target === host) close();
        return;
      }
      var act = btn.getAttribute('data-act');
      close();
      if (act !== 'cancel' && onPick) onPick(act);
    }

    function onKeyDown(e) {
      if (e.key === 'Escape') close();
    }

    host.addEventListener('click', onClick);
    document.addEventListener('keydown', onKeyDown);
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
    buildPoolBlockHtml: buildPoolBlockHtml,
    buildTimeViewHtml: buildTimeViewHtml,
    buildTemplatesHtml: buildTemplatesHtml,
    buildTemplateItemHtml: buildTemplateItemHtml,
    buildReadingHtml: buildReadingHtml,
    buildReadingItemHtml: buildReadingItemHtml,
    panelToggleHtml: panelToggleHtml,
    formatRate: formatRate,
    fallbackProgress: fallbackProgress,

    // DOM
    init: init,
    render: render,
    renderQuadrants: renderQuadrants,
    renderPool: renderPool,
    renderTimeView: renderTimeView,
    renderTemplates: renderTemplates,
    renderReading: renderReading,
    setCollapsedPanels: setCollapsedPanels,
    setViewMode: setViewMode,
    renderStats: renderStats,
    focusEditor: focusEditor,
    setBanner: setBanner,
    setReadOnly: setReadOnly,
    setTheme: setTheme,
    // 滚动快照（v2.10 需求 1）：登记表也导出，供守卫测试核对「每一个
    // 纵向滚动容器都登记了」
    SCROLL_SLOTS: SCROLL_SLOTS,
    captureScroll: captureScroll,
    restoreScroll: restoreScroll,
    openConfirm: openConfirm,
    openChoice: openChoice,
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
