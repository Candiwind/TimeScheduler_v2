/**
 * app.js —— 程序从这里启动
 *
 * 加载顺序：最后一个（见 DS 1.4）。它要用前面所有东西。
 *
 * 这里是**唯一**允许直接接触 window / document 的地方之一（另一个是 render.js）。
 * 存储后端就在这个文件里创建、注入给 Store —— 这样 store.js 才能完全脱离浏览器
 * 在 Node 里跑测试（见 DS 1.7 规矩二）。
 *
 * 它扮演的是「调度员」：用户在界面上点一下 → 调 task-ops 改数据 → 调 store 保存
 * → 调 render 重画。**task-ops 自己既不保存也不重画**，这就是 DS 1.6 那条
 * 「改数据 → 保存 → 重画」的落地方式。
 *
 * 当前进度：第 3 步。能加任务、勾选、改文字、删除，顶部统计跟着动。
 * 日期切换、拖拽、导入导出由后续步骤接进来。
 */
var App = (function (CONFIG, Util, Store, Toast, Theme, Render, TaskOps, Drag, DateNav,
                     Exporter, Pdf, Importer, Prefs) {
  'use strict';

  var state = {
    data: null,
    date: null,
    /**
     * 当前正在编辑的东西，十种取值：
     *   null                                                   没在编辑
     *   { mode: 'add',        quadrantId }                    正在新增任务
     *   { mode: 'edit-task',  quadrantId, taskId }            正在改任务文字
     *   { mode: 'add-stage',  quadrantId, taskId }            正在给某条任务加阶段
     *   { mode: 'edit-stage', quadrantId, taskId, stageId }   正在改阶段文字
     *   { mode: 'add-block',  quadrantId }                    正在新增任务块
     *   { mode: 'edit-block', quadrantId, blockId }           正在改任务块名称
     *   { mode: 'edit-pool',  poolItemId }                    正在改计划池任务的文字（见 DS 2.11）
     *   { mode: 'edit-pool-date', poolItemId }                正在改计划池任务的完成时间（见 DS 2.11 二期）
     *   { mode: 'add-pool' }                                  正在往计划池直接添加任务（见 DS 2.11 三期）
     *   { mode: 'add-pool-block' }                            正在往计划池添加任务块（需求 4）
     *   { mode: 'add-pool-block-task', blockId }              正在往池内某块添加任务（需求 4）
     *   { mode: 'rename-template', templateId }               正在改某份模板的名字（见 DS 2.14）
     * 同一时刻只允许有一个 —— 两个输入框同时开着，用户根本不知道该提交哪个。
     */
    editing: null,

    /**
     * 哪些任务展开着（阶段列表露出来）。
     * 这是**界面状态**，不进用户数据 —— 不属于「用户的任务」，
     * 也没必要跟着导出、备份跑。但会单独记在本机、刷新后保持（需求 5，
     * 见 DS 2.9），通过 Store.getFoldState / setFoldState 存取。
     */
    expanded: {},

    /**
     * 哪些任务块**折叠**着（块内任务收起来）。
     * 和 expanded 相反：块默认展开（新块空着，折叠了用户会以为没建成），
     * 所以记录的是「折叠了谁」。同样是界面状态，单独记在本机、刷新后保持
     * （需求 5，见 DS 2.10 / D-36）。
     */
    collapsedBlocks: {},

    /**
     * 哪些**板块**收起了（v2.8 需求 3）：{ reading: true, pool: true, templates: true }。
     * 记录的是「收起了谁」——三个板块默认都是展开的。
     * 同样是界面状态，和 expanded / collapsedBlocks 一起存在 foldState 里
     * （同一份存取、同一个 key，见 DS 2.38），刷新后保持。
     */
    collapsedPanels: {},

    /**
     * 主区域显示哪个视图（DS 2.13）：'quadrants' 四象限 + 计划池，'time' 时间视图。
     * 界面状态，不进用户数据 —— 刷新回四象限（四象限是主视图，D-40）
     */
    view: 'quadrants',

    /**
     * 搜索关键词（需求 3）：null = 没在搜；字符串 = 输入框当前内容。
     * 界面状态，不进用户数据、也不记本机 —— 刷新后搜索自然清掉。
     * 过滤只发生在渲染前的只读变换（TaskOps.filterDayByKeyword /
     * filterTimeViewByKeyword），数据本身一个字不动。
     */
    search: null,

    /**
     * 上一次**单击**点到了哪一条（requirements 最新一条：连续双击标高亮，见 DS 2.40）。
     *
     * 为什么要记下来而不是双击时现问 DOM：双击的**第一下**点文字就已经把这一条
     * 变成编辑框了（点文字 = 改文字），第二下到来时 e.target 是个输入框，
     * 那时候再问「刚才点的是谁」已经问不出来。所以第一下把判断存这儿，
     * 第二下取用，**用完即弃**（置回 null）—— 一次连击只翻一次高亮，
     * 三下、四下连点不会翻来翻去。
     *
     * 形状见 hitOfQuadrant / hitOfTimeView / hitOfPool；没点到任何一条就是 null。
     * 纯界面状态，不进用户数据。
     */
    clickHit: null,

    stats: { done: 0, total: 0 }
  };

  /**
   * 浏览器版存储后端。
   * 这是整个项目里唯一一处直接碰 localStorage 的代码（见 DS 1.7 规矩一）。
   */
  function createLocalStorageAdapter() {
    return {
      getItem: function (key) { return window.localStorage.getItem(key); },
      setItem: function (key, value) { window.localStorage.setItem(key, value); },
      removeItem: function (key) { window.localStorage.removeItem(key); }
    };
  }

  // -------------------------------------------------------------------------
  // 小工具
  // -------------------------------------------------------------------------

  function closest(node, className) {
    var el = node;
    while (el && el !== document) {
      if (el.classList && el.classList.contains(className)) return el;
      el = el.parentNode;
    }
    return null;
  }

  function quadrantOf(node) {
    var section = closest(node, 'quadrant');
    return section ? section.getAttribute('data-quadrant') : null;
  }

  function taskIdOf(node) {
    var li = closest(node, 'task');
    return li ? li.getAttribute('data-id') : null;
  }

  function stageIdOf(node) {
    var li = closest(node, 'stage');
    return li ? li.getAttribute('data-id') : null;
  }

  function blockIdOf(node) {
    var li = closest(node, 'block');
    return li ? li.getAttribute('data-id') : null;
  }

  function poolItemIdOf(node) {
    var li = closest(node, 'pool__item');
    return li ? li.getAttribute('data-id') : null;
  }

  function poolBlockIdOf(node) {
    var li = closest(node, 'pool__block');
    return li ? li.getAttribute('data-id') : null;
  }

  /**
   * 展开状态。
   *
   * 这是**界面状态**，不进用户数据 —— 它不属于「用户的任务」，
   * 也没必要跟着导出、备份跑。存在内存里，刷新页面就全折叠（这正是
   * 「默认折叠」想要的效果，见 DS 2.9）。
   */
  function toggleExpanded(taskId) {
    if (state.expanded[taskId]) delete state.expanded[taskId];
    else state.expanded[taskId] = true;
    persistFoldState();
    renderCurrent();
  }

  /** 折叠 / 展开一个任务块（默认展开，所以记的是折叠名单） */
  function toggleCollapsed(blockId) {
    if (state.collapsedBlocks[blockId]) delete state.collapsedBlocks[blockId];
    else state.collapsedBlocks[blockId] = true;
    persistFoldState();
    renderCurrent();
  }

  /**
   * 收起 / 展开一个板块（v2.8 需求 3）：阅读栏 / 计划池 / 模板池。
   *
   * 只认 CONFIG.PANEL_IDS 里列的三个名字 —— 从 DOM 的 data-panel 传上来的
   * 值不可全信（手工改过 DOM 的话），脏名字直接忽略，别写进本机。
   */
  function togglePanel(panelId) {
    if (CONFIG.PANEL_IDS.indexOf(panelId) === -1) return;
    if (state.collapsedPanels[panelId]) delete state.collapsedPanels[panelId];
    else state.collapsedPanels[panelId] = true;
    persistFoldState();
    renderCurrent();
  }

  /** 把折叠 / 展开状态落到本机，刷新后保持（需求 5；v2.8 起连板块收起一起） */
  function persistFoldState() {
    Store.setFoldState({
      expanded: state.expanded,
      collapsedBlocks: state.collapsedBlocks,
      collapsedPanels: state.collapsedPanels
    });
  }

  // -------------------------------------------------------------------------
  // 保存与重画
  // -------------------------------------------------------------------------

  /**
   * 保存。失败时翻译成用户看得懂的话（见 DS 4.2）。
   * 返回是否成功 —— 失败时调用方**不应该**假装改成功了。
   */
  function persist() {
    var result = Store.save(state.data);

    if (result.ok) return true;

    if (result.error === 'QUOTA') {
      // 空间满了：这次修改确实没存进去，主数据还停在改动前那一版，
      // 所以要老实告诉用户，不能让他以为存上了
      Toast.error('存储空间不足，本次修改未保存。请先导出备份，再清理历史数据。');
    } else if (result.error === 'PROTECTED') {
      Toast.error('当前处于保护模式，不能修改数据。请先导入备份文件。');
    } else {
      Toast.error('保存失败，本次修改未保存。');
    }
    return false;
  }

  /**
   * 把当前日期的内容和统计重画一遍。
   *
   * `options.keepScroll`（v2.10 需求 1）：重画前拍一张滚动位置快照，画完贴回去。
   * 「勾一下完成 / 取消完成」是**原地改一个字段**，条目位置、列表长度都没变，
   * 用户没有理由期待视角被重置 —— 而重画是整块 innerHTML 替换（DS 2.1），
   * 不贴回去滚动条就会弹回顶部。走这个开关的是各个勾选分支。
   *
   * 其余操作（新增、删除、推迟、切日期、搜索…）**不传**：那些情况下列表内容
   * 真的变了，画完从头看反而是对的（新增任务还加在开头，见 D-50）。
   *
   * @param {{keepScroll: boolean}} [options]
   */
  function renderCurrent(options) {
    var scrollSnap = (options && options.keepScroll) ? Render.captureScroll() : null;

    var day = Store.getDayTasks(state.data, state.date);
    state.stats = TaskOps.getStats(state.data, state.date);

    // 搜索（需求 3）：有关键词时，画的是过滤后的那份 —— 纯只读变换，
    // 数据不动；没命中的象限 / 时段块渲染成空白，匹配的那格只显示匹配的
    var kw = activeKeyword();
    var viewDay = kw ? TaskOps.filterDayByKeyword(day, kw) : day;

    // 编辑状态往哪边传：带 quadrantId 的（任务 / 阶段 / 块）是象限类编辑。
    // 时间视图开着时，这份编辑得由时间视图画 —— 四象限那边不能再画一份
    // 输入框，不然 DOM 里同时存在两个 .task__input，commitEdit 的
    // document.querySelector 会读到藏在四象限里、没动过的那一份，
    // 用户在时间视图里改的字就丢了。
    // 池 / 模板的编辑（没有 quadrantId）不受视图切换影响，照常传。
    var quadrantEditing = (state.editing && state.editing.quadrantId)
      ? state.editing : null;
    var panelEditing = quadrantEditing ? null : state.editing;

    Render.render(viewDay, state.stats, {
      editing: (state.view === 'time') ? panelEditing : state.editing,
      expanded: state.expanded,
      collapsedBlocks: state.collapsedBlocks,
      // 板块收起（v2.8 需求 3）：界面状态，画的时候落成 is-collapsed 类名
      collapsedPanels: state.collapsedPanels,
      // 进度按「最细的可勾选单位」算，任务自己有阶段数阶段、块数块内 ——
      // 算法只有 task-ops 一份（见 render.js 里 fallbackProgress 的说明）
      progressOf: TaskOps.progressOfItem,
      // 计划池跟日期无关，画的是全局那一份（见 DS 2.11）
      pool: Array.isArray(state.data.pool) ? state.data.pool : [],
      // 模板同样是全局列表（见 DS 2.14）
      templates: Array.isArray(state.data.templates) ? state.data.templates : [],
      // 阅读栏（v2.8 需求 2）：也是全局的，跟日期无关
      reading: TaskOps.ensureReading(state.data)
    });
    // 时间视图是另一份内容（按时段分组，DS 2.13）：开着就重画它；
    // 显示哪一边由 setViewMode 的 hidden 开关决定，两边内容都在 DOM 里
    if (state.view === 'time') {
      var groups = TaskOps.getTimeView(state.data, state.date);
      Render.renderTimeView(kw ? TaskOps.filterTimeViewByKeyword(groups, kw) : groups, {
        editing: quadrantEditing
      });
    }
    Render.setViewMode(state.view);
    Render.setReadOnly(Store.isProtectionMode());

    // 贴回滚动位置。放在最后一步 —— 得等 hidden 开关也设好，
    // 被隐藏的容器量不到高度、scrollTop 会被浏览器夹成 0
    if (scrollSnap) Render.restoreScroll(scrollSnap);
  }

  // -------------------------------------------------------------------------
  // 编辑流程
  // -------------------------------------------------------------------------

  function startAdd(quadrantId) {
    if (Store.isProtectionMode()) return;
    commitEdit();  // 手上还有没提交的，先落下来，别丢

    state.editing = { mode: 'add', quadrantId: quadrantId };
    renderCurrent();
    Render.focusEditor(false);
  }

  function startEdit(quadrantId, taskId) {
    if (Store.isProtectionMode()) return;
    commitEdit();

    state.editing = { mode: 'edit-task', quadrantId: quadrantId, taskId: taskId };
    renderCurrent();
    Render.focusEditor(true);
  }

  /** 开始给某条任务加阶段 —— 顺手把它展开，不然输入框看不见 */
  function startAddStage(quadrantId, taskId) {
    if (Store.isProtectionMode()) return;
    commitEdit();

    state.expanded[taskId] = true;
    persistFoldState();   // 顺手展开也算折叠状态，刷新后要保持（需求 5）
    state.editing = { mode: 'add-stage', quadrantId: quadrantId, taskId: taskId };
    renderCurrent();
    Render.focusEditor(false);
  }

  /** 开始改某个阶段的文字 */
  function startEditStage(quadrantId, taskId, stageId) {
    if (Store.isProtectionMode()) return;
    commitEdit();

    state.expanded[taskId] = true;
    persistFoldState();   // 同上：顺手展开也要落本机（需求 5）
    state.editing = {
      mode: 'edit-stage',
      quadrantId: quadrantId,
      taskId: taskId,
      stageId: stageId
    };
    renderCurrent();
    Render.focusEditor(true);
  }

  /** 开始新增任务块（输入框出现在象限列表末尾） */
  function startAddBlock(quadrantId) {
    if (Store.isProtectionMode()) return;
    commitEdit();  // 手上还有没提交的，先落下来，别丢

    state.editing = { mode: 'add-block', quadrantId: quadrantId };
    renderCurrent();
    Render.focusEditor(false);
  }

  /** 开始改某个任务块的名称 */
  function startEditBlock(quadrantId, blockId) {
    if (Store.isProtectionMode()) return;
    commitEdit();

    state.editing = { mode: 'edit-block', quadrantId: quadrantId, blockId: blockId };
    renderCurrent();
    Render.focusEditor(true);
  }

  /** 开始改某条计划池任务的文字（见 DS 2.11） */
  function startEditPool(poolItemId) {
    if (Store.isProtectionMode()) return;
    commitEdit();

    state.editing = { mode: 'edit-pool', poolItemId: poolItemId };
    renderCurrent();
    Render.focusEditor(true);
  }

  /** 开始改某条计划池任务的完成时间（见 DS 2.11 二期） */
  function startEditPoolDate(poolItemId) {
    if (Store.isProtectionMode()) return;
    commitEdit();

    state.editing = { mode: 'edit-pool-date', poolItemId: poolItemId };
    renderCurrent();
    Render.focusEditor(false);
  }

  /** 开始往计划池直接添加任务（见 DS 2.11 三期） */
  function startAddPool() {
    if (Store.isProtectionMode()) return;
    commitEdit();

    state.editing = { mode: 'add-pool' };
    renderCurrent();
    Render.focusEditor(false);
  }

  /** 开始往计划池添加任务块（需求 4） */
  function startAddPoolBlock() {
    if (Store.isProtectionMode()) return;
    commitEdit();

    state.editing = { mode: 'add-pool-block' };
    renderCurrent();
    Render.focusEditor(false);
  }

  /** 开始往池内某个任务块里加任务（需求 4） */
  function startAddPoolBlockTask(blockId) {
    if (Store.isProtectionMode()) return;
    commitEdit();

    state.editing = { mode: 'add-pool-block-task', blockId: blockId };
    renderCurrent();
    Render.focusEditor(false);
  }

  /** 开始改池内某个任务块的名称（v2.7 需求 1：和象限块一样点块名就能改） */
  function startEditPoolBlock(blockId) {
    if (Store.isProtectionMode()) return;
    commitEdit();

    state.editing = { mode: 'edit-pool-block', blockId: blockId };
    renderCurrent();
    Render.focusEditor(true);
  }

  /** 开始改某份模板的名字（见 DS 2.14） */
  function startRenameTemplate(templateId) {
    if (Store.isProtectionMode()) return;
    commitEdit();

    state.editing = { mode: 'rename-template', templateId: templateId };
    renderCurrent();
    Render.focusEditor(true);
  }

  function cancelEdit() {
    if (!state.editing) return;
    state.editing = null;
    renderCurrent();
  }

  /**
   * 提交正在编辑的内容。
   *
   * 一进来就把 state.editing 清掉 —— 回车和失焦都会走到这里，
   * 清掉之后重复调用会直接返回，不会提交两次。
   */
  function commitEdit() {
    if (!state.editing) return;
    var editing = state.editing;
    state.editing = null;

    // 编辑框里的值从哪儿读：**一次列出所有编辑框的输入框**。
    //
    // 屏幕上同时只有一个编辑框 —— state.editing 是**单个**对象，渲染时也只画
    // 一处，所以谁在 DOM 里就读谁。以前是按 mode 逐个三元挑（池的日期框就是被
    // 特判的那一个），每加一种编辑框都得回来补一笔：v2.8 补的阅读栏日期框漏了，
    // 于是提交时读到 null → value 成了空串 → 把用户刚选好的日期**清成 null**，
    // 看着就像「日期设定坏了」（见 DS R-40）。test-reading.js 有一条自动守卫
    // 盯着这张清单：render.js 里画出来的输入框 class 必须都在这儿。
    var input = document.querySelector(
      '.stage__input, .task__input, .pool__date-input, .reading__start-input');
    var value = input ? input.value : '';

    // ---- 新增（任务、阶段、任务块或池内任务）----
    // 块和池内新增的输入框都复用 task__input（见 render.js），键盘/失焦逻辑共用。
    // **每一个新增模式都必须列在这里**：漏一个（比如 v2.8 的 add-reading）就会
    // 掉进下面的「改文字」链，被当成 editBlock 提交 —— 结果是回车之后一点反应
    // 都没有（新增被静默丢弃）。test-reading.js 有一条源码守卫专门盯这件事。
    if (editing.mode === 'add' || editing.mode === 'add-stage' ||
        editing.mode === 'add-block' || editing.mode === 'add-pool' ||
        editing.mode === 'add-pool-block' || editing.mode === 'add-pool-block-task' ||
        editing.mode === 'add-reading') {
      // 点了「＋」又反悔 —— 安静地取消就好。这时候弹「内容不能为空」
      // 是在骂用户，他本来就没想提交任何东西
      if (!Util.isValidTaskText(value)) {
        renderCurrent();
        return;
      }

      var added;
      if (editing.mode === 'add') {
        added = TaskOps.addTask(state.data, state.date, editing.quadrantId, value);
      } else if (editing.mode === 'add-stage') {
        added = TaskOps.addStage(state.data, state.date, editing.quadrantId,
                                 editing.taskId, value);
      } else if (editing.mode === 'add-pool') {
        // 默认完成时间 = 当前查看日期 + 7 天（见 DS 2.11 三期）
        added = TaskOps.addPoolItem(state.data, state.date, value);
      } else if (editing.mode === 'add-pool-block') {
        // 需求 4：计划池里允许直接建任务块（空的，再往块里加任务）
        added = TaskOps.addPoolBlock(state.data, value);
      } else if (editing.mode === 'add-reading') {
        // v2.8 需求 2：起始日期不在这里设 —— 先建出来（默认**今天**），
        // 行上再点日期去改（和池里「先加任务再设完成时间」同一个节奏）
        added = TaskOps.addReadingItem(state.data, value, null);
      } else if (editing.mode === 'add-pool-block-task') {
        // 需求 4：往池内某块加任务，默认完成时间 = 当前查看日期 + 7 天
        added = TaskOps.addPoolBlockTask(state.data, state.date, editing.blockId, value);
      } else {
        added = TaskOps.addBlock(state.data, state.date, editing.quadrantId, value);
      }

      if (added.ok) persist();
      renderCurrent();
      return;
    }

    // ---- 改文字（任务、阶段、任务块、计划池）或计划池完成时间 ----
    var edited;
    if (editing.mode === 'edit-task') {
      edited = TaskOps.editTask(state.data, state.date, editing.quadrantId,
                                editing.taskId, value);
    } else if (editing.mode === 'edit-stage') {
      edited = TaskOps.editStage(state.data, state.date, editing.quadrantId,
                                 editing.taskId, editing.stageId, value);
    } else if (editing.mode === 'edit-pool') {
      edited = TaskOps.editPoolItem(state.data, editing.poolItemId, value);
    } else if (editing.mode === 'edit-pool-block') {
      // v2.7：改池内块名复用 editPoolItem —— 它本来就作用在 locatePoolItem 上，
      // 改块名和改池内任务文字是同一种写入（D-63）
      edited = TaskOps.editPoolItem(state.data, editing.blockId, value);
    } else if (editing.mode === 'edit-reading') {
      edited = TaskOps.editReadingItem(state.data, editing.readingItemId, value);
    } else if (editing.mode === 'edit-reading-start') {
      // 清空提交 = 起始日期回「未设定」（不是删除条目，和池里清 DDL 同款）
      edited = TaskOps.setReadingStart(state.data, editing.readingItemId, value);
    } else if (editing.mode === 'edit-pool-date') {
      // 输入框清空提交 = 清除完成时间，任务回「未设定」继续留在池里（DS 2.11 二期）
      edited = (value === '')
        ? TaskOps.setPoolDate(state.data, editing.poolItemId, null)
        : TaskOps.setPoolDate(state.data, editing.poolItemId, value);
    } else if (editing.mode === 'rename-template') {
      edited = TaskOps.renameTemplate(state.data, editing.templateId, value);
    } else {
      edited = TaskOps.editBlock(state.data, state.date, editing.quadrantId,
                                 editing.blockId, value);
    }

    if (!edited.ok && edited.error === TaskOps.ERR.EMPTY_TEXT) {
      Toast.warn('内容不能为空，已恢复原来的内容。');
    }
    if (!edited.ok && edited.error === TaskOps.ERR.BAD_DATE) {
      // 浏览器的 <input type="date"> 正常只会给出 '' 或合法日期，
      // 这条是给手工改过 DOM 之类的极端情况兜底的
      // （池里的完成时间和阅读栏的起始日期都是这个框，同一条兜底）
      Toast.warn('日期格式不对，已保持原来的设定。');
    }
    if (edited.ok) persist();
    renderCurrent();
  }

  // -------------------------------------------------------------------------
  // 各个操作
  // -------------------------------------------------------------------------

  function doToggle(quadrantId, taskId, checked) {
    var result = TaskOps.toggleTask(state.data, state.date, quadrantId, taskId, checked);
    if (result.ok) persist();
    // 勾选是原地改字段：保留滚动位置（v2.10 需求 1）。注意勾完任务会沉到
    // 列表末尾（需求 7），条目确实换了位置 —— 但「看住的那一片」不该动
    renderCurrent({ keepScroll: true });
  }

  /**
   * 删除一个条目（块或任务，顶层或块内都走这里）。
   * 提示文案按 kind 区分：删块必须说清楚「连里面的几条任务一起删了」，
   * 不然用户回头找不到任务会以为出了 bug。
   */
  function doRemoveItem(quadrantId, itemId) {
    var result = TaskOps.removeItem(state.data, state.date, quadrantId, itemId);
    if (!result.ok) {
      renderCurrent();
      return;
    }

    if (result.kind === 'block') {
      // 块没了，块内任务的展开状态也一起收掉
      var children = TaskOps.blockTasks(result.block);
      for (var i = 0; i < children.length; i++) delete state.expanded[children[i].id];
      delete state.collapsedBlocks[itemId];
      persistFoldState();
      persist();
      renderCurrent();
      Toast.show('已删除任务块「' + result.block.text + '」（含 ' +
                 result.taskCount + ' 条任务）');
      return;
    }

    delete state.expanded[itemId];   // 任务都没了，展开状态也一起收掉
    persistFoldState();
    persist();
    renderCurrent();
    // 删除没有回收站（见 FS P0），所以至少要说清楚删掉的是哪条 ——
    // 删错了才发现是最难受的
    Toast.show('已删除「' + result.task.text + '」');
  }

  // -------------------------------------------------------------------------
  // 计划池（见 DS 2.11）
  // -------------------------------------------------------------------------

  /** 推迟：任务从象限消失，进四象限下方的计划池 */
  function doPostpone(quadrantId, taskId) {
    if (Store.isProtectionMode()) return;
    commitEdit();

    var result = TaskOps.postponeTask(state.data, state.date, quadrantId, taskId);
    if (result.ok) {
      delete state.expanded[taskId];   // 任务进池了，展开状态一起收掉
      persistFoldState();
      persist();
      Toast.show('已推迟「' + result.task.text + '」，可在下方计划池找回。');
    }
    renderCurrent();
  }

  /** 从计划池删除一条 */
  function doRemovePoolItem(poolItemId) {
    if (Store.isProtectionMode()) return;
    commitEdit();

    var result = TaskOps.removePoolItem(state.data, poolItemId);
    if (result.ok) {
      // 删的是块的话，块的折叠状态和块内任务的展开状态一起收掉
      if (result.task.type === 'block') {
        delete state.collapsedBlocks[poolItemId];
        var kids = TaskOps.blockTasks(result.task);
        for (var i = 0; i < kids.length; i++) delete state.expanded[kids[i].id];
      } else {
        delete state.expanded[poolItemId];
      }
      persistFoldState();
      persist();
      Toast.show('已删除「' + result.task.text + '」');
    }
    renderCurrent();
  }

  /** 推迟一个阶段：从任务里摘出来，保存成池内任务，文本带 [所属任务] 前缀（DS 2.11 二期） */
  function doPostponeStage(quadrantId, taskId, stageId) {
    if (Store.isProtectionMode()) return;
    commitEdit();

    var result = TaskOps.postponeStage(state.data, state.date, quadrantId,
                                       taskId, stageId);
    if (result.ok) {
      persist();
      Toast.show('已把阶段推迟为任务「' + result.task.text + '」，可在下方计划池找回。');
    }
    renderCurrent();
  }

  /** 整体推迟一个任务块：整块从象限进计划池，块内每条任务的完成时间都顺延到明天（需求 4） */
  function doPostponeBlock(quadrantId, blockId) {
    if (Store.isProtectionMode()) return;
    commitEdit();

    var result = TaskOps.postponeBlock(state.data, state.date, quadrantId, blockId);
    if (result.ok) {
      delete state.collapsedBlocks[blockId];   // 块进池了，折叠状态一起收掉
      var children = TaskOps.blockTasks(result.block);
      for (var i = 0; i < children.length; i++) delete state.expanded[children[i].id];
      persistFoldState();
      persist();
      Toast.show('已把任务块「' + result.block.text + '」整体推迟，可在下方计划池找回。');
    }
    renderCurrent();
  }

  /** 设定 / 清除池内任务的完成时间（dateStr 为 null 就是清除，见 DS 2.11 二期） */
  function doSetPoolDate(poolItemId, dateStr) {
    if (Store.isProtectionMode()) return;
    commitEdit();

    var result = TaskOps.setPoolDate(state.data, poolItemId, dateStr);
    if (result.ok) {
      persist();
      // 清除要说清楚后果：任务不会被顺手删掉，只是回「未设定」继续留着
      if (dateStr === null) Toast.show('已清除完成时间，任务继续留在计划池。');
    } else if (result.error === TaskOps.ERR.BAD_DATE) {
      Toast.warn('时间格式不对，已保持原来的设定。');
    }
    renderCurrent();
  }

  /**
   * v2.7 需求 1：勾选池内一条任务。
   *
   * 勾完**不移出池** —— 文字划掉变淡、沉到所在列表末尾（数据层做完搬移），
   * 要靠「导入」或拖回才出池。保护模式由 CSS（pointer-events: none）先挡，
   * 和象限的 doToggle 保持同一个形状（数据层的写由 persist() 兜底报错）。
   */
  function doTogglePoolItem(poolItemId, checked) {
    var result = TaskOps.togglePoolItem(state.data, poolItemId, checked);
    if (result.ok) persist();
    // 计划池同样保留滚动位置（v2.10 需求 1：象限和时间视图的时间栏都要保，
    // 计划池没有理由例外 —— 它也会沉到池底，一滚就回顶部更难受）
    renderCurrent({ keepScroll: true });
  }

  /** v2.7 需求 1：勾池内块头 = 一键全勾 / 全取消块内（和象限块头同一个分派） */
  function doTogglePoolBlock(blockId, checked) {
    var result = TaskOps.togglePoolBlock(state.data, blockId, checked);
    if (result.ok) persist();
    renderCurrent({ keepScroll: true });
  }

  /**
   * 把池内一条（或整块）导入象限（v2.6 需求 2）。
   *
   * 目标是**当前查看日期**的第二象限（`CONFIG.IMPORT_QUADRANT`），落在该象限
   * 列表**开头** ——和象限视图「新增任务加在开头」同一条规矩（D-50），导完
   * 一眼就看得见。落在「正在看的那一天」而不是真实今天：池面板在任何日期都
   * 显示，导到看不见的另一天会像「东西没了」（D-59）。
   *
   * 语义是**移动**：直接复用既有的 `restoreFromPool`，池里不再保留；含阶段的
   * 任务连阶段一起走，块连块内任务整块走，块内任务单独导入则从块里摘出来、
   * 宿主块完成度重算。
   */
  function doImportPoolItem(poolItemId) {
    if (Store.isProtectionMode()) return;
    commitEdit();

    var result = TaskOps.restoreFromPool(state.data, state.date,
                                         CONFIG.IMPORT_QUADRANT, poolItemId, 0);
    if (result.ok) {
      // 东西搬出池了，它自己的折叠 / 展开记录跟着收掉，别留指向别处条目的孤儿键
      delete state.collapsedBlocks[poolItemId];
      delete state.expanded[poolItemId];
      persistFoldState();
      persist();
      Toast.show('已导入到 ' + state.date + ' 的第二象限。');
    }
    renderCurrent();
  }

  /**
   * v2.6 需求 3：计划日期到了的池内条目自动导入今天。
   *
   * 只在**启动**和**切换日期**时各查一次（不是每次渲染就查）——渲染太频繁，
   * 而且用户刚把某条的计划日期设成今天、它就在眼皮底下跳走会很怪。
   *
   * 判据是**真实今天**（不是正在查看的那一天）：往前翻历史、往后看未来，
   * 都不该把池里的任务搬走，那不算明确意图（D-60）。要安排在别的日期，
   * 用行上的「导入」按钮。
   */
  function autoImportDuePool() {
    if (Store.isProtectionMode()) return;   // 保护模式：任何写操作都不放行

    var today = Util.todayStr();
    var result = TaskOps.autoImportDuePoolItems(state.data, today);
    if (result.ok && result.imported > 0) {
      persist();
      Toast.show('计划池有 ' + result.imported + ' 条到了计划日期，已导入今天（' +
        today + '）的第二象限。');
    }
  }

  /**
   * 计划池自己的事件。和四象限那套是**两棵独立的子树**，各绑各的；
   * 池内没有勾选框、没有阶段，所以只有「删除 / 改文字 / 编辑框键盘」三件事。
   */
  function bindPool() {
    var pool = document.getElementById('pool');
    if (!pool) return;

    // ---- 点击 ----
    pool.addEventListener('click', function (e) {
      var target = e.target;

      // 连续双击 → 高亮（池内的任务 / 块，见 高亮 段首）。
      // 池这一片还套着板块收起的三角，双击它也只是把这一下吞掉，不放行下去
      if (e.detail >= 2) {
        handleSecondClick();
        return;
      }
      state.clickHit = rememberHit(hitOfPool(target));

      // 收起 / 展开（v2.8 需求 3）—— 纯界面动作，保护模式下也放行
      var toggle = closest(target, 'panel__toggle');
      if (toggle) {
        togglePanel(toggle.getAttribute('data-panel'));
        return;
      }

      // 头部「＋」→ 直接往池里添加任务（三期）
      if (closest(target, 'pool__add')) {
        startAddPool();
        return;
      }

      // 头部「▣」→ 往池里添加任务块（需求 4）
      if (closest(target, 'pool__add-block')) {
        startAddPoolBlock();
        return;
      }

      // 块头上的 ▾/▸ → 折叠 / 展开块内任务（需求 5，和象限里的块共用一份折叠名单）
      if (closest(target, 'pool__block-toggle')) {
        var bTgPool = poolBlockIdOf(target);
        if (bTgPool) { commitEdit(); toggleCollapsed(bTgPool); }
        return;
      }

      // 块头勾选框 → 一键全勾 / 全取消块内（v2.7 需求 1，和象限块头同一条分派）
      if (closest(target, 'pool__block-check')) {
        var bChkPool = poolBlockIdOf(target);
        if (bChkPool) { commitEdit(); doTogglePoolBlock(bChkPool, target.checked); }
        return;
      }

      // 点块名 → 原地改名（v2.7 需求 1；象限里点块名也是这一套）
      if (closest(target, 'pool__block-name')) {
        var bNamePool = poolBlockIdOf(target);
        if (bNamePool) startEditPoolBlock(bNamePool);
        return;
      }

      // 块头上的「＋」→ 往块里加任务（需求 4）
      if (closest(target, 'pool__block-add')) {
        var bAddPool = poolBlockIdOf(target);
        if (bAddPool) startAddPoolBlockTask(bAddPool);
        return;
      }

      // 删除整个任务块（连块内任务一起）
      if (closest(target, 'pool__block-del')) {
        var bDelPool = poolBlockIdOf(target);
        if (bDelPool) {
          commitEdit();
          doRemovePoolItem(bDelPool);
        }
        return;
      }

      // 块头「导入」→ 整块（含块内任务）一起导入第二象限，不拆散（v2.6 需求 2）
      if (closest(target, 'pool__block-import')) {
        var bImport = poolBlockIdOf(target);
        if (bImport) doImportPoolItem(bImport);
        return;
      }

      // 行上「导入」→ 把这一条（含全部阶段 / 从宿主块里摘出）导入第二象限
      if (closest(target, 'pool__import')) {
        var importId = poolItemIdOf(target);
        if (importId) doImportPoolItem(importId);
        return;
      }

      if (closest(target, 'pool__del')) {
        var delId = poolItemIdOf(target);
        if (delId) doRemovePoolItem(delId);
        return;
      }

      // 行上的勾选框 → 勾完成（v2.7 需求 1）。顶层块内的任务也在 .pool__item 里，
      // 所以块内任务勾完由数据层顺带重算宿主块
      if (closest(target, 'pool__check')) {
        var chkId = poolItemIdOf(target);
        if (chkId) { commitEdit(); doTogglePoolItem(chkId, target.checked); }
        return;
      }

      // 清除按钮只存在于日期编辑态里；点了 = 不光退出编辑，时间也一起清掉
      if (closest(target, 'pool__date-clear')) {
        var clearId = poolItemIdOf(target);
        if (clearId) doSetPoolDate(clearId, null);
        return;
      }

      if (closest(target, 'pool__date')) {
        var dateId = poolItemIdOf(target);
        if (dateId) startEditPoolDate(dateId);
        return;
      }

      if (closest(target, 'pool__text')) {
        var editId = poolItemIdOf(target);
        if (editId) startEditPool(editId);
        return;
      }
    });

    // ---- 编辑框里的键盘（文字框复用 task__input，日期框是 pool__date-input）----
    pool.addEventListener('keydown', function (e) {
      if (!closest(e.target, 'task__input') &&
          !closest(e.target, 'pool__date-input')) return;

      if (e.key === 'Enter') {
        e.preventDefault();
        commitEdit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelEdit();
      }
    });

    // ---- 失焦即提交（和象限里同一个套路）----
    pool.addEventListener('focusout', function (e) {
      if (!closest(e.target, 'task__input') &&
          !closest(e.target, 'pool__date-input')) return;
      var input = e.target;
      setTimeout(function () {
        if (!document.body.contains(input)) return;
        commitEdit();
      }, 0);
    });
  }

  // -------------------------------------------------------------------------
  // 模板（DS 2.14）
  // -------------------------------------------------------------------------

  /** 把当天任务表缓存成模板。撞名（未重命名）会覆盖，toast 要说清是哪种 */
  function doSaveTemplate() {
    if (Store.isProtectionMode()) return;
    commitEdit();

    var result = TaskOps.saveDayAsTemplate(state.data, state.date);
    if (result.ok) {
      persist();
      Toast.show(result.overwritten
        ? '已用今天的任务表覆盖模板「' + result.template.name + '」。'
        : '已把今天的任务表存成模板「' + result.template.name + '」。');
    } else if (result.error === TaskOps.ERR.EMPTY_DAY) {
      // 空的一天存不出有意义的模板（见 FS 模板边界）
      Toast.warn('今天还没有任务，没有可缓存的内容。');
    }
    renderCurrent();
  }

  /** 把模板填充到当前查看的日期（副本：编号全换、勾选清零、同文本跳过） */
  function doApplyTemplate(templateId) {
    if (Store.isProtectionMode()) return;
    commitEdit();

    var found = TaskOps.findTemplate(state.data, templateId);
    var result = TaskOps.applyTemplate(state.data, state.date, templateId);
    if (result.ok) {
      persist();
      Toast.show('已把模板「' + (found ? found.template.name : '') + '」应用到 ' +
        state.date + '：新增 ' + result.added + ' 条' +
        (result.skipped ? '，跳过已有的 ' + result.skipped + ' 条' : '') + '。');
    }
    renderCurrent();
  }

  /** 删一份模板。模板是副本，不影响任何日期的任务 */
  function doRemoveTemplate(templateId) {
    if (Store.isProtectionMode()) return;
    commitEdit();

    var result = TaskOps.removeTemplate(state.data, templateId);
    if (result.ok) {
      persist();
      Toast.show('已删除模板「' + result.template.name + '」');
    }
    renderCurrent();
  }

  /**
   * 模板面板自己的事件。和计划池那套一样：独立子树，各绑各的。
   * 只有「存今天 / 应用 / 改名 / 删除」四件事，改名输入框复用 task__input。
   */
  function bindTemplates() {
    var root = document.getElementById('templates');
    if (!root) return;

    root.addEventListener('click', function (e) {
      var target = e.target;

      // 收起 / 展开（v2.8 需求 3）—— 纯界面动作，保护模式下也放行
      var toggle = closest(target, 'panel__toggle');
      if (toggle) {
        togglePanel(toggle.getAttribute('data-panel'));
        return;
      }

      if (closest(target, 'tpl__save')) {
        doSaveTemplate();
        return;
      }

      var item = closest(target, 'tpl__item');
      var templateId = item ? item.getAttribute('data-id') : null;

      if (closest(target, 'tpl__apply')) {
        if (templateId) doApplyTemplate(templateId);
        return;
      }
      if (closest(target, 'tpl__rename')) {
        if (templateId) startRenameTemplate(templateId);
        return;
      }
      if (closest(target, 'tpl__del')) {
        if (templateId) doRemoveTemplate(templateId);
        return;
      }
    });

    // ---- 改名输入框的键盘（复用 task__input，逻辑和别处共用 commitEdit）----
    root.addEventListener('keydown', function (e) {
      if (!closest(e.target, 'task__input')) return;

      if (e.key === 'Enter') {
        e.preventDefault();
        commitEdit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelEdit();
      }
    });

    // ---- 失焦即提交 ----
    root.addEventListener('focusout', function (e) {
      if (!closest(e.target, 'task__input')) return;
      var input = e.target;
      setTimeout(function () {
        if (!document.body.contains(input)) return;
        commitEdit();
      }, 0);
    });
  }

  // -------------------------------------------------------------------------
  // 阅读栏（v2.8 需求 2）
  // -------------------------------------------------------------------------

  /** id 在 .reading__item 的 data-id 上，交给 closest 一路往上找 */
  function readingItemIdOf(node) {
    var item = closest(node, 'reading__item');
    return item ? item.getAttribute('data-id') : null;
  }

  function startAddReading() {
    if (Store.isProtectionMode()) return;
    commitEdit();
    state.editing = { mode: 'add-reading' };
    renderCurrent();
    Render.focusEditor(true);
  }

  function startEditReading(readingItemId) {
    if (Store.isProtectionMode()) return;
    commitEdit();
    state.editing = { mode: 'edit-reading', readingItemId: readingItemId };
    renderCurrent();
    Render.focusEditor(true);
  }

  /** 开始改某条的起始日期（和池里的 startEditPoolDate 一个形状，见 D-70） */
  function startEditReadingStart(readingItemId) {
    if (Store.isProtectionMode()) return;
    commitEdit();

    state.editing = { mode: 'edit-reading-start', readingItemId: readingItemId };
    renderCurrent();
    // 日期框不 select()：select 对 <input type="date"> 没有意义，
    // 和池里的完成时间同款（那边也是 false）
    Render.focusEditor(false);
  }

  /** 勾完成：自动记下**当下**的时刻（需求「自动显示完成时间」） */
  function doCompleteReading(readingItemId, checked) {
    if (Store.isProtectionMode()) return;
    if (!checked) {
      // 取消勾选 = 取消完成（从已完成搬回正在阅读），需求没写但点错了得有退路
      doRestoreReading(readingItemId);
      return;
    }
    var result = TaskOps.completeReadingItem(state.data, readingItemId);
    if (result.ok) persist();
    renderCurrent();
  }

  function doRestoreReading(readingItemId) {
    if (Store.isProtectionMode()) return;
    var result = TaskOps.restoreReadingItem(state.data, readingItemId);
    if (result.ok) persist();
    renderCurrent();
  }

  function doRemoveReading(readingItemId) {
    if (Store.isProtectionMode()) return;
    var result = TaskOps.removeReadingItem(state.data, readingItemId);
    if (result.ok) persist();
    renderCurrent();
  }

  /** 设定 / 清除起始日期（dateStr 为 null 就是清除，见 DS 2.37 修订三） */
  function doSetReadingStart(readingItemId, dateStr) {
    if (Store.isProtectionMode()) return;
    // 先把手上的编辑落下 —— 少了这句，state.editing 还挂着，重画之后编辑框
    // **原地不动**（清没清用户看不出来）。池里的 doSetPoolDate 就是这么写的
    commitEdit();

    var result = TaskOps.setReadingStart(state.data, readingItemId, dateStr);
    if (result.ok) {
      persist();
      // 清完说一声：条目继续留着，只是回「未设定」（和池里清 DDL 同一套反馈）
      if (dateStr === null) Toast.show('已清除起始日期。');
    } else if (result.error === TaskOps.ERR.BAD_DATE) {
      Toast.warn('日期格式不对，已保持原来的设定。');
    }
    renderCurrent();
  }

  /**
   * 阅读栏自己的事件。和计划池 / 模板那套一样：独立子树，各绑各的。
   * 头部有收起三角和「＋」，行上有勾选框 / 文字 / 起始日期 / 取消完成 / 删除。
   */
  function bindReading() {
    var root = document.getElementById('reading');
    if (!root) return;

    root.addEventListener('click', function (e) {
      var target = e.target;

      // 收起 / 展开（v2.8 需求 3）—— 纯界面动作，保护模式下也放行
      var toggle = closest(target, 'panel__toggle');
      if (toggle) {
        togglePanel(toggle.getAttribute('data-panel'));
        return;
      }

      if (closest(target, 'reading__add')) {
        startAddReading();
        return;
      }

      var id = readingItemIdOf(target);
      if (!id) return;

      // 起始日期：正在阅读那边是「设定」，已完成那边是「修改」（需求里写明下方能改）
      if (closest(target, 'reading__start')) {
        startEditReadingStart(id);
        return;
      }

      // 编辑态里的「×」= 清空起始日期（不是删条目，和池里的 date-clear 同款小心）
      if (closest(target, 'reading__start-clear')) {
        doSetReadingStart(id, null);
        return;
      }

      if (closest(target, 'reading__check')) {
        commitEdit();
        doCompleteReading(id, target.checked);
        return;
      }

      if (closest(target, 'reading__restore')) {
        commitEdit();
        doRestoreReading(id);
        return;
      }

      if (closest(target, 'reading__del')) {
        commitEdit();
        doRemoveReading(id);
        return;
      }

      if (closest(target, 'reading__text')) {
        startEditReading(id);
        return;
      }
    });

    // ---- 编辑框里的键盘：文字框复用 task__input，起始日期框是 reading__start-input ----
    root.addEventListener('keydown', function (e) {
      if (!closest(e.target, 'task__input') &&
          !closest(e.target, 'reading__start-input')) return;

      if (e.key === 'Enter') {
        e.preventDefault();
        commitEdit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelEdit();
      }
    });

    // ---- 失焦即提交 ----
    root.addEventListener('focusout', function (e) {
      if (!closest(e.target, 'task__input') &&
          !closest(e.target, 'reading__start-input')) return;
      var input = e.target;
      setTimeout(function () {
        if (!document.body.contains(input)) return;
        commitEdit();
      }, 0);
    });
  }

  // -------------------------------------------------------------------------
  // 阶段
  // -------------------------------------------------------------------------

  function doToggleStage(quadrantId, taskId, stageId, checked) {
    var result = TaskOps.toggleStage(state.data, state.date, quadrantId,
                                     taskId, stageId, checked);
    if (result.ok) persist();
    // 同 doToggle：勾阶段也是原地改字段，保留滚动位置（v2.10 需求 1）
    renderCurrent({ keepScroll: true });
  }

  function doRemoveStage(quadrantId, taskId, stageId) {
    var result = TaskOps.removeStage(state.data, state.date, quadrantId, taskId, stageId);
    if (result.ok) {
      persist();
      Toast.show('已删除阶段「' + result.stage.text + '」');
    }
    renderCurrent();
  }

  // -------------------------------------------------------------------------
  // Bonus（需求 2）：任务 / 阶段标记成「额外加分」，图标礼品
  // -------------------------------------------------------------------------

  /** 标记 / 取消一条任务的 Bonus（只在没有阶段的任务本体上有这个按钮） */
  function doSetBonus(quadrantId, taskId) {
    if (Store.isProtectionMode()) return;
    commitEdit();

    var found = TaskOps.findTask(state.data, state.date, quadrantId, taskId);
    if (!found) return;
    var result = TaskOps.setBonus(state.data, state.date, quadrantId, taskId,
                                  !(found.task.bonus === true));
    if (result.ok) persist();
    renderCurrent();
  }

  /** 标记 / 取消一条阶段的 Bonus */
  function doSetStageBonus(quadrantId, taskId, stageId) {
    if (Store.isProtectionMode()) return;
    commitEdit();

    var located = TaskOps.locateTask(state.data, state.date, quadrantId, taskId);
    if (!located) return;
    var stages = TaskOps.stagesOf(located.task);
    var current = false;
    for (var i = 0; i < stages.length; i++) {
      if (stages[i].id === stageId) { current = stages[i].bonus === true; break; }
    }
    var result = TaskOps.setStageBonus(state.data, state.date, quadrantId, taskId,
                                       stageId, !current);
    if (result.ok) persist();
    renderCurrent();
  }

  // -------------------------------------------------------------------------
  // 高亮（requirements 最新一条：连续双击给整条加浅橙底色，见 DS 2.40）
  //
  // 双击这个手势和「点文字 → 改文字」是**打架**的：单击已经用来进编辑了，
  // 而浏览器在派发第一下 click 时不会先等第二下，所以双击的第一下必然
  // 先开出一个编辑框。两条路都是既成事实，只能这么接：
  //
  //   第一下：照常开编辑框，顺便把「点到了哪一条」记进 state.clickHit；
  //   第二下：e.detail >= 2 → 把编辑框提交掉（用户要的是高亮，不是改文字），
  //          再翻 state.clickHit 那条的高亮。
  //
  // 没做成「把单击推迟一个双击窗口」是有意的：那会让最高频的「点一下改文字」
  // 整体变迟钝，为了一个低频手势牺牲高频手势，不划算（见 D-71）。
  // -------------------------------------------------------------------------

  /**
   * 「第一下」的记录最多认多久。
   *
   * 双击两下的间隔上限就是系统的双击阈值（Windows 默认 500ms，能调到大约不到
   * 1 秒），1500ms 足够宽裕。留这个上限不是为了卡双击，是为了**不认陈旧记录**：
   * 拖拽结束时浏览器会吃掉紧跟着的那一下 click（drag.js 的 suppressNextClick），
   * 那一下走不到这里、也就不会刷新记录，万一接着来一次双击，第二下就会翻到
   * 上一次记的那条上。宁可不做，也不能标错一条。
   */
  var DOUBLE_CLICK_MAX_MS = 1500;

  /** 记下这一下点到了哪一条，顺手打上时间戳（上面那条上限要用它） */
  function rememberHit(hit) {
    if (!hit) return null;
    hit.at = Date.now();
    return hit;
  }

  /**
   * 这次点击是不是落在控件上 —— 是的话双击就不算「给这一条加高亮」。
   *
   *   - 勾选框：点两下 = 勾上又取消，浏览器本来就这规矩，别顺带标高亮；
   *   - 按钮 / 下拉：连点两下多半是想连按两次（推迟两条之类），别抢；
   *   - 输入框 / 文本域：**编辑框里双击 = 选词**，这是系统手势，让给浏览器。
   *     少了这一条，双击任务文字进编辑之后想选个词就选不动了。
   */
  function isControlNode(node) {
    var el = node;
    while (el && el.nodeType === 1) {
      var tag = el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
          tag === 'BUTTON') return true;
      el = el.parentNode;
    }
    return false;
  }

  /**
   * 点到了哪一条（象限视图）。判断顺序和点击分流同一条规矩：**从里往外**。
   *
   * 阶段 → 任务 → 块，块必须排在任务**后面**：块内任务的 closest('block')
   * 一样会命中宿主块，先判块的话，点块内任务会被当成点整个块。
   */
  function hitOfQuadrant(target) {
    if (isControlNode(target)) return null;

    var qid = quadrantOf(target);
    if (!qid) return null;

    var stageId = stageIdOf(target);
    if (stageId) {
      var taskOfStage = taskIdOf(target);
      if (!taskOfStage) return null;
      return {
        list: 'quadrant', kind: 'stage',
        quadrantId: qid, taskId: taskOfStage, stageId: stageId
      };
    }

    var taskId = taskIdOf(target);
    if (taskId) {
      return { list: 'quadrant', kind: 'task', quadrantId: qid, taskId: taskId };
    }

    var blockId = blockIdOf(target);
    if (blockId) {
      return { list: 'quadrant', kind: 'block', quadrantId: qid, blockId: blockId };
    }
    return null;
  }

  /** 点到了哪一条（时间视图）：条目自己身上带着 data-kind / 各种 id */
  function hitOfTimeView(target) {
    if (isControlNode(target)) return null;

    var info = timeItemOf(target);
    if (!info || !info.quadrantId || !info.taskId) return null;
    if (info.kind !== 'task' && info.kind !== 'stage') return null;

    return {
      list: 'timeview', kind: info.kind,
      quadrantId: info.quadrantId, taskId: info.taskId, stageId: info.stageId
    };
  }

  /**
   * 点到了哪一条（计划池）。条目（任务）排在块前面，理由同上：
   * 块内任务也在 .pool__block 里面，先判块就分不清是块还是块内任务。
   */
  function hitOfPool(target) {
    if (isControlNode(target)) return null;

    var itemId = poolItemIdOf(target);
    if (itemId) {
      return { list: 'pool', kind: 'task', poolItemId: itemId };
    }

    var blockId = poolBlockIdOf(target);
    if (blockId) {
      return { list: 'pool', kind: 'block', poolItemId: blockId };
    }
    return null;
  }

  /** 取出这一条的数据对象（决定高亮要翻成什么）；已经不存在了返回 null */
  function findHighlightTarget(hit) {
    if (hit.list === 'pool') {
      var inPool = TaskOps.locatePoolItem(state.data, hit.poolItemId);
      return inPool ? inPool.item : null;
    }

    if (hit.kind === 'block') {
      var block = TaskOps.findBlock(state.data, state.date, hit.quadrantId, hit.blockId);
      return block ? block.block : null;
    }

    var located = TaskOps.locateTask(state.data, state.date, hit.quadrantId, hit.taskId);
    if (!located) return null;

    if (hit.kind === 'stage') {
      var stages = TaskOps.stagesOf(located.task);
      for (var i = 0; i < stages.length; i++) {
        if (stages[i].id === hit.stageId) return stages[i];
      }
      return null;
    }
    return located.task;
  }

  /**
   * 双击的第二下：给这一条整体加 / 取消高亮。
   *
   * 高亮落在**数据**里（那条的 highlight 字段），不是界面上的临时状态 ——
   * 所以刷新、导出、导入都跟着走，和 Bonus 一样。
   */
  function doToggleHighlight(hit) {
    if (Store.isProtectionMode()) return;

    // 第一下已经把这条开成编辑框了，先落下来 —— 用户要的是高亮，
    // 文字一个字没改，但编辑框不该继续杵着
    commitEdit();

    var target = findHighlightTarget(hit);
    if (!target) return;

    // 一个 set 一个落盘，和 setBonus 那套一样；高亮不进统计、不改分母，
    // 所以不用 syncCompleted / syncHostBlock 收尾（见 DS 2.40）
    var on = !(target.highlight === true);
    var result;

    if (hit.list === 'pool') {
      result = TaskOps.setPoolHighlight(state.data, hit.poolItemId, on);
    } else if (hit.kind === 'stage') {
      result = TaskOps.setStageHighlight(state.data, state.date, hit.quadrantId,
                                        hit.taskId, hit.stageId, on);
    } else if (hit.kind === 'block') {
      result = TaskOps.setBlockHighlight(state.data, state.date, hit.quadrantId,
                                         hit.blockId, on);
    } else {
      result = TaskOps.setHighlight(state.data, state.date, hit.quadrantId,
                                    hit.taskId, on);
    }

    if (result.ok) persist();
    // 高亮不加 Toast：颜色当场就看得见，再用一行字复述一遍只是噪音
    // （和 Bonus 同一条：标记类操作不弹提示）
    renderCurrent();
  }

  /**
   * 三处点击分流共用的入口：`e.detail >= 2` 就是一次连击里的第二下。
   *
   * 取的是**上一次单击**记下的那一条（state.clickHit），不是现在拿 e.target 查的
   * —— 第一下开出来的编辑框已经把原节点换掉了。取完即弃：一次连击只翻一次，
   * 三下、四下连点不会翻来翻去。
   *
   * 没记下任何一条（第一下落在控件上、或者根本没点到条目）就什么都不做，
   * 但仍然把这一下**吞掉**：连击的第二下不该顺带再开一个编辑框，
   * 也不该替用户再按一次「推迟」「删除」。
   */
  function handleSecondClick() {
    var hit = state.clickHit;
    state.clickHit = null;
    if (!hit) return;
    // 记录太旧就不敢用（多半不是这次连击的第一下留的，见 DOUBLE_CLICK_MAX_MS）
    if (Date.now() - hit.at > DOUBLE_CLICK_MAX_MS) return;
    doToggleHighlight(hit);
  }

  // -------------------------------------------------------------------------
  // 事件绑定
  // -------------------------------------------------------------------------

  function bindQuadrants() {
    var root = document.getElementById('quadrants');
    if (!root) return;

    // ---- 点击 ----
    //
    // 分流顺序有讲究：**从里往外**判断。阶段的 <li> 套在任务的 <li> 里面，
    // 先判任务的话，点阶段上的东西会被当成点任务。
    // 另外属性（象限、任务 id）都要在 commitEdit 之前取好 ——
    // 提交会重画，节点会被换掉，之后再问就什么都问不到了。
    root.addEventListener('click', function (e) {
      var target = e.target;

      // 连续双击（requirements 最新一条）→ 给这一条整体加 / 取消高亮。
      // 必须在**最前面**判：双击的第二下不该再走下面「点击 = 编辑 / 推迟 / 删除」
      // 那套分流（见上面的说明和 DS 2.40）
      if (e.detail >= 2) {
        handleSecondClick();
        return;
      }

      // 第一下：照常走下面的分流，顺便记下「点到了哪一条」给双击的第二下用
      state.clickHit = rememberHit(hitOfQuadrant(target));

      // 展开 / 收起阶段
      if (closest(target, 'task__toggle')) {
        var idToggle = taskIdOf(target);
        if (idToggle) { commitEdit(); toggleExpanded(idToggle); }
        return;
      }

      // 阶段行上的「推迟」→ 阶段保存为池内任务（requirements 第 3 条，DS 2.11 二期）
      if (closest(target, 'stage__postpone')) {
        var qSp = quadrantOf(target);
        var tSp = taskIdOf(target);
        var sSp = stageIdOf(target);
        if (qSp && tSp && sSp) doPostponeStage(qSp, tSp, sSp);
        return;
      }

      // 阶段行上的「🎁」→ 标记 / 取消该阶段 Bonus（需求 2）
      if (closest(target, 'stage__bonus')) {
        var qBo = quadrantOf(target);
        var tBo = taskIdOf(target);
        var sBo = stageIdOf(target);
        if (qBo && tBo && sBo) doSetStageBonus(qBo, tBo, sBo);
        return;
      }

      // 删除阶段
      if (closest(target, 'stage__del')) {
        var qSd = quadrantOf(target);
        var tSd = taskIdOf(target);
        var sSd = stageIdOf(target);
        if (qSd && tSd && sSd) {
          commitEdit();
          doRemoveStage(qSd, tSd, sSd);
        }
        return;
      }

      // 任务右上角的「＋」→ 添加阶段
      if (closest(target, 'task__add-stage')) {
        var qSa = quadrantOf(target);
        var tSa = taskIdOf(target);
        if (qSa && tSa) startAddStage(qSa, tSa);
        return;
      }

      // 任务行上的「🎁」→ 标记 / 取消该任务 Bonus（需求 2，只在无阶段任务上）
      if (closest(target, 'task__bonus')) {
        var qTb = quadrantOf(target);
        var tTb = taskIdOf(target);
        if (qTb && tTb) doSetBonus(qTb, tTb);
        return;
      }

      // 点阶段文字 → 改阶段
      if (closest(target, 'stage__text')) {
        var qSe = quadrantOf(target);
        var tSe = taskIdOf(target);
        var sSe = stageIdOf(target);
        if (qSe && tSe && sSe) startEditStage(qSe, tSe, sSe);
        return;
      }

      // 象限右上角的「＋」→ 新增任务
      if (closest(target, 'quadrant__add')) {
        var q = quadrantOf(target);
        if (q) startAdd(q);
        return;
      }

      // 象限右上角的「▣」→ 新增任务块
      if (closest(target, 'quadrant__add-block')) {
        var qAb = quadrantOf(target);
        if (qAb) startAddBlock(qAb);
        return;
      }

      // 块头上的 ▾/▸ → 折叠 / 展开块内任务
      if (closest(target, 'block__toggle')) {
        var bTg = blockIdOf(target);
        if (bTg) { commitEdit(); toggleCollapsed(bTg); }
        return;
      }

      // 块头上的「推迟」→ 整块进计划池（需求 4）
      if (closest(target, 'block__postpone')) {
        var qBp = quadrantOf(target);
        var bBp = blockIdOf(target);
        if (qBp && bBp) doPostponeBlock(qBp, bBp);
        return;
      }

      // 删除任务块（连块内任务一起）
      if (closest(target, 'block__del')) {
        var qBd = quadrantOf(target);
        var bBd = blockIdOf(target);
        if (qBd && bBd) {
          commitEdit();               // 先把正在编辑的内容落下来，别顺手丢了
          doRemoveItem(qBd, bBd);
        }
        return;
      }

      // 点块名 → 改块名
      if (closest(target, 'block__name')) {
        var qBn = quadrantOf(target);
        var bBn = blockIdOf(target);
        if (qBn && bBn) startEditBlock(qBn, bBn);
        return;
      }

      // 任务行上的「推迟」→ 进下方计划池（见 DS 2.11）
      if (closest(target, 'task__postpone')) {
        var qPo = quadrantOf(target);
        var tPo = taskIdOf(target);
        if (qPo && tPo) doPostpone(qPo, tPo);
        return;
      }

      // 删除任务（顶层或块内的都走这里）
      if (closest(target, 'task__del')) {
        var qDel = quadrantOf(target);
        var idDel = taskIdOf(target);
        if (qDel && idDel) {
          commitEdit();               // 先把正在编辑的内容落下来，别顺手丢了
          doRemoveItem(qDel, idDel);
        }
        return;
      }

      // 点任务文字 → 改任务
      if (closest(target, 'task__text')) {
        var qEdit = quadrantOf(target);
        var idEdit = taskIdOf(target);
        if (qEdit && idEdit) startEdit(qEdit, idEdit);
        return;
      }
    });

    // ---- 勾选 ----
    root.addEventListener('change', function (e) {
      // 时段下拉（DS 2.12）：change 和勾选框走同一个监听器。
      // 阶段行上的下拉 → setStageSlot；任务行上的 → setSlot。
      // 选中第一项（value 为空串）= 清除，回「未设定」
      if (closest(e.target, 'slot__select')) {
        if (Store.isProtectionMode()) return;
        var qSlot = quadrantOf(e.target);
        var tSlot = taskIdOf(e.target);
        var sSlot = stageIdOf(e.target);   // 阶段行的下拉，closest 链上才有 stage
        if (!qSlot || !tSlot) return;
        var slotValue = e.target.value === '' ? null : e.target.value;
        var slotResult = sSlot
          ? TaskOps.setStageSlot(state.data, state.date, qSlot, tSlot, sSlot, slotValue)
          : TaskOps.setSlot(state.data, state.date, qSlot, tSlot, slotValue);
        if (slotResult.ok) persist();
        renderCurrent();
        return;
      }

      var isStageCheck = closest(e.target, 'stage__check');
      var isBlockCheck = closest(e.target, 'block__check');
      var isTaskCheck = closest(e.target, 'task__check');
      if (!isStageCheck && !isTaskCheck && !isBlockCheck) return;

      var quadrantId = quadrantOf(e.target);
      var checked = e.target.checked;
      if (!quadrantId) return;

      commitEdit();

      if (isBlockCheck) {
        // 块的勾选框：一键全勾 / 全取消块内（见 DS 2.10 完成派生）
        var blockId = blockIdOf(e.target);
        if (blockId) {
          var blockResult = TaskOps.toggleItem(state.data, state.date,
                                               quadrantId, blockId, checked);
          if (blockResult.ok) persist();
        }
        renderCurrent({ keepScroll: true });   // v2.10 需求 1
        return;
      }

      var taskId = taskIdOf(e.target);
      if (!taskId) return;

      if (isStageCheck) {
        var stageId = stageIdOf(e.target);
        if (stageId) doToggleStage(quadrantId, taskId, stageId, checked);
      } else {
        // 有阶段时这是「全部勾选 / 全不选」，没阶段时就是这条任务自己 ——
        // 两种都由 task-ops 的 toggleTask 统一处理（见 DS 2.9）
        doToggle(quadrantId, taskId, checked);
      }
    });

    // ---- 编辑框里的键盘 ----（任务和阶段共用一套）
    root.addEventListener('keydown', function (e) {
      if (!closest(e.target, 'task__input') && !closest(e.target, 'stage__input')) return;

      if (e.key === 'Enter') {
        e.preventDefault();   // 别让回车触发别的东西
        commitEdit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelEdit();
      }
    });

    // ---- 失焦即提交 ----
    root.addEventListener('focusout', function (e) {
      if (!closest(e.target, 'task__input') && !closest(e.target, 'stage__input')) return;
      var input = e.target;

      // 放到下一个事件循环再提交：用户点别处时，先让那次点击正常处理完。
      // 如果那次点击重画了页面，这个输入框就已经不在文档里了 —— 说明
      // 该做的都做过了，别再提交一遍。
      setTimeout(function () {
        if (!document.body.contains(input)) return;
        commitEdit();
      }, 0);
    });
  }

  /**
   * 时间视图自己的事件（DS 2.13，v1.2 起可操作）。
   *
   * 条目的类名 / 数据属性和象限视图一致，所以这里只是「换一棵树，查 id
   * 的方式不同」：象限从 DOM 嵌套反查（section[data-quadrant] > li[data-id]），
   * 时间视图没有那层嵌套，id 直接写在条目自己身上 —— 查出来以后，
   * 走的还是同一批 start* / do* 函数、同一份数据。
   */
  function timeItemOf(node) {
    var li = closest(node, 'timeview__item');
    if (!li) return null;
    var kind = li.getAttribute('data-kind');
    return {
      kind: kind,
      quadrantId: li.getAttribute('data-quadrant'),
      taskId: (kind === 'stage') ? li.getAttribute('data-task-id')
                                 : li.getAttribute('data-id'),
      stageId: (kind === 'stage') ? li.getAttribute('data-stage-id') : null
    };
  }

  function bindTimeView() {
    var root = document.getElementById('timeview');
    if (!root) return;

    // ---- 点击 ----
    root.addEventListener('click', function (e) {
      var target = e.target;

      // 连续双击 → 高亮（和象限视图同一套，见 高亮 段首）
      if (e.detail >= 2) {
        handleSecondClick();
        return;
      }
      state.clickHit = rememberHit(hitOfTimeView(target));

      // 删除（任务走 doRemoveItem、阶段走 doRemoveStage，和象限同一批函数。
      // 属性要在 commitEdit 之前取好 —— 提交会重画，节点会被换掉）
      if (closest(target, 'task__del') || closest(target, 'stage__del')) {
        var del = timeItemOf(target);
        if (!del || !del.quadrantId || !del.taskId) return;
        commitEdit();               // 先把正在编辑的内容落下来，别顺手丢了
        if (del.kind === 'stage') doRemoveStage(del.quadrantId, del.taskId, del.stageId);
        else doRemoveItem(del.quadrantId, del.taskId);
        return;
      }

      // 点任务文字 → 改任务
      if (closest(target, 'task__text')) {
        var et = timeItemOf(target);
        if (et && et.quadrantId && et.taskId) startEdit(et.quadrantId, et.taskId);
        return;
      }

      // 点阶段文字 → 改阶段
      if (closest(target, 'stage__text')) {
        var es = timeItemOf(target);
        if (es && es.quadrantId && es.taskId && es.stageId) {
          startEditStage(es.quadrantId, es.taskId, es.stageId);
        }
        return;
      }
    });

    // ---- 勾选与时段下拉 ----（change 走同一个监听器，和象限一个套路）
    root.addEventListener('change', function (e) {
      var info = timeItemOf(e.target);
      if (!info || !info.quadrantId || !info.taskId) return;

      // 时段下拉（DS 2.12）：选中「未设定」（value 为空串）= 清除。
      // 改了时段条目就换组（清除则离开时间视图）—— 由 renderCurrent
      // 重画解决，DOM 不手动挪
      if (closest(e.target, 'slot__select')) {
        if (Store.isProtectionMode()) return;
        var slotValue = e.target.value === '' ? null : e.target.value;
        var slotResult = (info.kind === 'stage')
          ? TaskOps.setStageSlot(state.data, state.date, info.quadrantId,
                                 info.taskId, info.stageId, slotValue)
          : TaskOps.setSlot(state.data, state.date, info.quadrantId,
                            info.taskId, slotValue);
        if (slotResult.ok) persist();
        renderCurrent();
        return;
      }

      if (closest(e.target, 'task__check')) {
        commitEdit();
        // 任务条目都是「无阶段任务本体」（有阶段的进组的是阶段，见 getTimeView），
        // 所以这里就是勾这条任务自己
        doToggle(info.quadrantId, info.taskId, e.target.checked);
        return;
      }

      if (closest(e.target, 'stage__check')) {
        commitEdit();
        doToggleStage(info.quadrantId, info.taskId, info.stageId, e.target.checked);
        return;
      }
    });

    // ---- 编辑框里的键盘 / 失焦即提交（和象限、计划池同一个套路）----
    root.addEventListener('keydown', function (e) {
      if (!closest(e.target, 'task__input') && !closest(e.target, 'stage__input')) return;

      if (e.key === 'Enter') {
        e.preventDefault();
        commitEdit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelEdit();
      }
    });

    root.addEventListener('focusout', function (e) {
      if (!closest(e.target, 'task__input') && !closest(e.target, 'stage__input')) return;
      var input = e.target;

      // 放到下一个事件循环再提交（原因见 bindQuadrants 的失焦处理）
      setTimeout(function () {
        if (!document.body.contains(input)) return;
        commitEdit();
      }, 0);
    });
  }

  // -------------------------------------------------------------------------
  // 启动
  // -------------------------------------------------------------------------


  /** 时间视图切换（DS 2.13）：四象限 ⇄ 时间视图，按钮文字跟着当前状态变 */
  function bindViewToggle() {
    var btn = document.getElementById('btn-view-toggle');
    if (!btn) return;

    btn.addEventListener('click', function () {
      commitEdit();
      state.view = (state.view === 'time') ? 'quadrants' : 'time';
      btn.textContent = (state.view === 'time') ? '四象限' : '时间视图';
      renderCurrent();
    });
  }

  // -------------------------------------------------------------------------
  // 搜索（需求 3）：右上角 🔍 入口，关键词实时过滤象限 / 时间视图
  // -------------------------------------------------------------------------

  /** 当前生效的搜索关键词（null 或 trim 后为空 = 没在搜） */
  function activeKeyword() {
    if (state.search === null || state.search === undefined) return null;
    var kw = String(state.search).trim();
    return kw ? kw : null;
  }

  /** 退出搜索：收起输入框、清空关键词、重画回完整内容 */
  function exitSearch() {
    var input = document.getElementById('search-input');
    var btn = document.getElementById('btn-search');
    state.search = null;
    if (input) { input.value = ''; input.hidden = true; }
    if (btn) btn.classList.remove('btn--on');
    renderCurrent();
  }

  function bindSearch() {
    var btn = document.getElementById('btn-search');
    var input = document.getElementById('search-input');
    if (!btn || !input) return;

    btn.addEventListener('click', function () {
      if (activeKeyword() !== null || !input.hidden) {
        // 已经开着：再点一下 = 收起（关键词也清掉）
        exitSearch();
        return;
      }
      commitEdit();  // 手上还有没提交的编辑，先落下来
      state.search = '';
      input.hidden = false;
      btn.classList.add('btn--on');
      input.focus();
    });

    // 每敲一个字都重画 —— 渲染本来就走防抖合并（renderCurrent 一层不重），
    // 过滤是纯只读变换，数据一个字不动
    input.addEventListener('input', function () {
      state.search = input.value;
      renderCurrent();
    });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') exitSearch();
    });
  }

  /** 日期切换 */
  function bindDateNav() {
    DateNav.init({
      onChange: function (dateStr) {
        // 换日期之前先把手上没提交的编辑落下 ——
        // 用户改了一半就切走，那段字不该凭空消失
        commitEdit();
        state.editing = null;
        // 展开状态是「这一天的哪些任务摊开着」，换一天就没意义了
        state.expanded = {};
        state.date = dateStr;
        // 需求 3：换了日期就查一次「有没有计划日期到了的池条目」——
        // 应用跨天开着（或一直没重启）时也能把今天该做的事带出来
        autoImportDuePool();
        renderCurrent();
      }
    });
    // 启动时只让控件显示对，不触发回调 —— 日期已经定好了
    DateNav.syncUI(state.date);
  }

  /** 拖拽 */
  function bindDrag() {
    Drag.init({
      // 保护模式下不许拖：任何写操作都不能放行（见 DS 2.4）
      canDrag: function () { return !Store.isProtectionMode(); },

      onDrop: function (info) {
        commitEdit();

        // 时间视图拖拽（需求 3）：落到 moveTimeViewItem，记忆顺序、可跨时段改 slot
        if (info.kind === 'tv') {
          var moved = TaskOps.moveTimeViewItem(state.data, state.date, {
            dataKind: info.dataKind,
            taskId: info.taskId,
            stageId: info.stageId,
            quadrantId: info.quadrantId,
            toSlot: info.toSlot,
            index: info.index
          });
          if (moved.ok) persist();
          renderCurrent();
          return;
        }

        // 四种拖拽共用一套机制，最后落到不同的数据操作上（见 drag.js 开头的说明）。
        // 落点统一是 `{ region, quadrantId, targetBlockId, index }`（需求 3），
        // region 说明落到哪个区域，targetBlockId 说明落进哪个块（顶层为 null）。
        // 象限块和池内块的 id 分属两套空间，靠 region 区分。

        // ---- 落点在计划池 ----
        if (info.region === 'pool') {
          var toPool;
          if (info.kind === 'pool') {
            // 池 → 池：换顺序、跨容器搬运（顶层 ↔ 块内）都归它一份实现
            // （v2.6 需求 1 只支持同容器，需求 3 要求打通，见 DS 2.43）
            toPool = TaskOps.movePoolItemTo(state.data, info.poolItemId,
                                            info.targetBlockId, info.index);
          } else if (info.kind === 'block') {
            // 象限整块 → 池顶层（需求 3；块里不许套块，落点永远解析成顶层）
            toPool = TaskOps.moveBlockToPool(state.data, state.date,
                                             info.blockId, info.index);
          } else {
            // 象限任务 → 池顶层任务位置 / 池内任务块里（需求 3 的两条）
            toPool = TaskOps.moveTaskToPool(state.data, state.date, info.taskId,
                                            info.targetBlockId, info.index);
          }
          if (toPool.ok) persist();
          renderCurrent();
          return;
        }

        // ---- 落点在象限 ----
        if (info.kind === 'pool') {
          // 池内条目拖回象限：顶层位置，或者进象限块（需求 3 的「相互之间」）
          var restored = TaskOps.restoreFromPool(state.data, state.date,
                                                 info.quadrantId,
                                                 info.poolItemId, info.index,
                                                 info.targetBlockId);
          if (restored.ok) persist();
          renderCurrent();
          return;
        }

        var result = (info.kind === 'stage')
          ? TaskOps.moveStage(state.data, state.date, info.quadrantId,
                              info.taskId, info.stageId, info.index)
          : TaskOps.moveItem(state.data, state.date, {
              kind: info.kind,
              id: (info.kind === 'block') ? info.blockId : info.taskId,
              toQuadrantId: info.quadrantId,
              toBlockId: info.targetBlockId,
              toIndex: info.index
            });

        if (result.ok) persist();
        renderCurrent();
      }
    });
  }

  // -------------------------------------------------------------------------
  // 导出
  // -------------------------------------------------------------------------

  function doExport(format) {
    try {
      if (format === 'pdf') {
        doExportPdf();
        return;
      }

      if (format === 'json') {
        Exporter.exportJson(state.data);
      } else if (format === 'md') {
        // v2.6 需求 4：日报只记**当前查看的那一天**（JSON / ZIP 仍是整份存档）
        Exporter.exportMarkdown(state.data, undefined, state.date);
      } else {
        Exporter.exportZip(state.data);
      }
      // 网页版：浏览器不告诉我们文件最后有没有落盘，措辞保守。
      // 安卓 App：exporter 走原生插件，自己提示「已保存到下载文件夹 / 失败」，
      // 这里不再重复提示。
      if (!Exporter.isNative()) {
        Toast.success('已开始下载，请查看浏览器的下载栏。');
      }
    } catch (err) {
      Toast.error('导出失败：' + ((err && err.message) || '未知原因'));
    }
  }

  /**
   * 导出 PDF。
   *
   * 注意这里的说法：**它是弹出一个打印对话框，不是点一下就下载。**
   * 用户得在对话框里选「另存为 PDF」再确认，文件才会落盘。
   * 不提前讲清楚，用户会以为按钮坏了（见 DS 4.4）。
   */
  function doExportPdf() {
    if (Pdf.print(state.data)) {
      Toast.show('已打开打印对话框，在里面选「另存为 PDF」再确认。不同浏览器的排版会略有差别。');
      return;
    }

    // 这台设备打不了印（老浏览器，或者 App 内置浏览器）。
    // 退一步：把 Markdown 文本摆出来让用户自己复制（见 DS 4.2）
    Render.openText({
      title: '当前环境无法打印',
      message: '已经把 Markdown 文本准备好了，复制走就能用；也可以直接用「导出 Markdown」存成文件。'
    }, Pdf.fallbackMarkdown(state.data), function (ok) {
      if (ok === false) Toast.warn('复制没成功，请手动全选后复制。');
      else Toast.success('已复制到剪贴板。');
    });
  }

  function bindExport() {
    var btn = document.getElementById('btn-export');
    var menu = document.getElementById('export-menu');
    if (!btn || !menu) return;

    // 安卓 App 里把 PDF 这一项拿掉：那边的 window.print() 是空壳，
    // 留着就是一个点了没反应的按钮（见 DS 4.4）
    var pdfItem = document.getElementById('menu-pdf');
    if (pdfItem && !Pdf.isAvailable()) pdfItem.hidden = true;

    function close() {
      menu.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
    }

    btn.addEventListener('click', function (e) {
      e.stopPropagation();   // 别让下面那个「点别处关闭」立刻把它关掉
      var opening = menu.hidden;
      menu.hidden = !opening;
      btn.setAttribute('aria-expanded', opening ? 'true' : 'false');
    });

    menu.addEventListener('click', function (e) {
      var item = (e.target && e.target.closest) ? e.target.closest('[data-format]') : null;
      if (!item) return;
      var format = item.getAttribute('data-format');
      close();
      commitEdit();     // 导出前先把手上没提交的编辑落下，别导出个旧的
      doExport(format);
    });

    document.addEventListener('click', close);
  }

  // -------------------------------------------------------------------------
  // 导入
  // -------------------------------------------------------------------------

  function onFileLoaded(text) {
    // 先整份检查。不合格就到这儿为止，本地数据一个字节都不动（见 DS 2.5）
    var checked = Importer.validate(text);
    if (!checked.ok) {
      Toast.error(checked.message);
      return;
    }

    // 需求 2：让用户自己选「合并」还是「覆盖」。
    // 覆盖 = 先清空本地、再把这版文件内容当初始数据（危险，标红）。
    Render.openChoice({
      title: '选择导入方式',
      // 这里只是纯文本，不认 Markdown 记号
      message: '合并：文件内容并入本地，本地已有的任务不会被删，重复的自动跳过。\n' +
               '覆盖：清空本地现有数据，只保留文件里的内容。\n' +
               '两种方式都建议先导出一份备份。',
      choices: [
        { act: 'merge', label: '合并导入' },
        { act: 'overwrite', label: '覆盖导入', danger: true }
      ]
    }, function (act) {
      var wasProtected = Store.isProtectionMode();
      var isOverwrite = (act === 'overwrite');
      var result = isOverwrite
        ? Importer.overwrite(state.data, checked.data)
        : Importer.merge(state.data, checked.data);

      // 覆盖是在一份全新的数据上做的合并，结果对象不是原来的 state.data，
      // 所以这里要把引用接回来；合并分支里它就是 state.data 自己，接一下也无妨
      state.data = result.data;

      // 保护模式下「导入备份文件」本来就是唯一的救援通道，
      // 所以导入成功之后要顺带把它解除掉
      if (wasProtected) {
        Store.exitProtectionMode();
        Render.setBanner('');
      }

      persist();
      renderCurrent();
      Toast.success(isOverwrite
        ? '已用文件内容覆盖本地数据。'
        : '新增 ' + result.added + ' 条，跳过 ' + result.skipped + ' 条。');

      // 导进来的数据可能跨度超过 30 天，得再看一眼要不要归档
      checkArchive();
    });
  }

  function bindImport() {
    var btn = document.getElementById('btn-import');
    var input = document.getElementById('file-input');
    if (!btn || !input) return;

    btn.addEventListener('click', function () {
      commitEdit();
      // 清空一下，否则连续选同一个文件不会触发 change
      input.value = '';
      input.click();
    });

    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      if (!file) return;

      var reader = new FileReader();
      reader.onload = function () {
        try {
          onFileLoaded(String(reader.result));
        } catch (err) {
          Toast.error('导入失败：' + ((err && err.message) || '文件读不出来'));
        }
      };
      reader.onerror = function () { Toast.error('读取文件失败。'); };
      reader.readAsText(file, 'utf-8');
    });
  }

  // -------------------------------------------------------------------------
  // 30 天归档（见 DS 2.4）
  // -------------------------------------------------------------------------

  /**
   * 看一眼本地是不是堆了超过 30 天的数据，是的话挂提示条。
   *
   * **这里只是提示，不自动下载、更不自动删。** 浏览器对没有用户手势触发的
   * 下载会拦截，程序又没法知道文件到底落盘没有 —— 要是「没落盘也照删」，
   * 数据当场就蒸发了。所以必须由用户点一下那个按钮，我们才敢往下走。
   */
  function checkArchive() {
    if (Store.isProtectionMode()) return;

    var plan = Store.planArchive(state.data);
    if (!plan.archivedCount) {
      Render.setBanner('');
      return;
    }

    Render.setBanner(
      '本地已有超过 30 天的历史数据（' + plan.archivedCount + ' 天）。' +
      '归档会把它导出成 JSON 文件并**从本地移除**，以后想看需要把那个文件再导入回来。',
      [{ action: 'archive', label: '归档并下载' }]
    );
  }

  function doArchive() {
    var plan = Store.planArchive(state.data);
    if (!plan.archivedCount) {
      Render.setBanner('');
      return;
    }

    // 网页端 exportArchive 同步返回结果；安卓端走原生插件是异步的，
    // 得等插件写成功才删本地数据，避免「文件没落盘、本地又删了」的数据蒸发
    Exporter.exportArchive(state.data, plan, undefined, function (saved) {
      if (!saved) {
        Toast.error('导出失败，未归档。请先手动「导出 JSON」备份，再回来归档。');
        return;
      }

      // 走到这儿才算文件真的发出去了。归档提示条会一直说明白：
      // 数据从本地移除了，要看就导入回来
      state.data = Store.applyArchive(state.data, plan);
      persist();
      renderCurrent();
      Render.setBanner('');
      Toast.success('已归档 ' + plan.archivedCount + ' 天的历史数据，请到「下载」文件夹确认文件已保存。');
    });
  }

  /** 保护模式下的「用空数据重新开始」—— 必须二次确认（见 D-22） */
  function confirmRestartEmpty() {
    Render.openConfirm({
      title: '用空数据重新开始？',
      message: '这会覆盖磁盘上现有的数据，且无法撤销。\n' +
               '如果那份数据还有救，请先取消，改用「导入备份文件」。',
      okLabel: '确认覆盖',
      danger: true
    }, function () {
      Store.exitProtectionMode();
      state.data = Store.createEmpty();
      persist();
      renderCurrent();
      Render.setBanner('');
      Toast.warn('已用空数据重新开始。');
    });
  }

  /** 提示条上的按钮 */
  function bindBanner() {
    var banner = document.getElementById('banner');
    if (!banner) return;

    banner.addEventListener('click', function (e) {
      var btn = (e.target && e.target.closest) ? e.target.closest('[data-action]') : null;
      if (!btn) return;

      var action = btn.getAttribute('data-action');
      if (action === 'import-file') {
        var importBtn = document.getElementById('btn-import');
        if (importBtn) importBtn.click();
      } else if (action === 'restart-empty') {
        confirmRestartEmpty();
      } else if (action === 'archive') {
        doArchive();
      }
    });
  }

  // -------------------------------------------------------------------------
  // 快捷键
  // -------------------------------------------------------------------------

  function bindShortcuts() {
    document.addEventListener('keydown', function (e) {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key !== 's' && e.key !== 'S') return;

      // 不拦的话浏览器会弹「保存网页」
      e.preventDefault();
      commitEdit();
      // 导出的是 ZIP 而不是两个文件：一次手势里连续触发两个下载，
      // 浏览器会当成可疑行为拦下来（见 exporter.js 里的说明）
      Exporter.handleCtrlS(state.data, e);
      Toast.success('已开始下载 ZIP（内含 JSON 和 Markdown）。');
    });
  }

  /**
   * 处理读取结果。
   *
   * 「读不出来」和「读到了但是有问题」必须让用户看见 —— 最糟糕的做法是
   * 悄悄返回一个空的，用户以为数据被清空了，其实还在磁盘上（见 DS 2.4）。
   */
  function handleLoadResult(loaded) {
    state.data = loaded.data;

    if (loaded.status === 'protected') {
      Render.setBanner(loaded.message, [
        { action: 'import-file', label: '导入备份文件' },
        { action: 'restart-empty', label: '用空数据重新开始' }
      ]);
    } else if (loaded.status === 'recovered' || loaded.status === 'recovered-local') {
      Render.setBanner(loaded.message + '，请检查一下数据是否完整。');
    } else {
      Render.setBanner('');
    }
  }

  function boot() {
    // 安卓上先把原生存储里的副本读进内存。
    //
    // Capacitor 的 Preferences 是**异步**的，而 store.js 通篇是**同步**的
    // （它得能在 Node 里简简单单跑测试）。所以异步就在这一处收口：读完内存之后，
    // 交给 store 的是一个同步的壳（见 prefs.js）。
    //
    // 网页版里这一步是空跑，立刻进下一步。
    // 两个分支都走 startApp —— preload 永远不会 reject，万一 reject 了也照常启动，
    // 大不了这次没有原生副本兜底，绝不能因为存储插件出问题就白屏。
    Prefs.preload().then(startApp, startApp);
  }

  function startApp() {
    Store.init({
      storage: createLocalStorageAdapter(),
      durable: Prefs.adapter()
    });

    Toast.init();
    Render.init();

    // 主题要在第一次绘制之前应用。不过真正抢先的是 index.html <head> 里
    // 那段防闪白的脚本 —— 这里这行是给它收尾（按钮图标、以及万一那边没跑成）
    Theme.init();

    handleLoadResult(Store.load());

    // 需求 5：把本机记住的折叠 / 展开状态读回来（读不出就回到默认折叠 / 展开）。
    // v2.8 需求 3 起，三个板块的收起状态也在这一份里（见 DS 2.38）
    var fold = Store.getFoldState();
    state.expanded = fold.expanded;
    state.collapsedBlocks = fold.collapsedBlocks;
    state.collapsedPanels = fold.collapsedPanels;

    // 默认停在今天（见 DS 1.5）
    state.date = Util.todayStr();

    // 需求 3：开机先查一次「计划日期到了的池条目」，让它们今天就出现在象限里。
    // 放在首屏渲染之前，用户一进来看到的就是补过的那份
    autoImportDuePool();

    bindQuadrants();
    bindTimeView();
    bindReading();
    bindPool();
    bindTemplates();
    bindDateNav();
    bindViewToggle();
    bindSearch();
    bindDrag();
    bindExport();
    bindImport();
    bindBanner();
    bindShortcuts();

    renderCurrent();
    // 上次退出之后可能已经过了很久，数据跨度超了就得提醒归档
    checkArchive();
  }

  // 加 typeof 判断是为了让这个文件在 Node 里也能被 require（test-load-order.js 会做这件事）。
  // 浏览器里 document 一定存在，走的是同一个分支，行为完全不变。
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot);
    } else {
      boot();
    }
  }

  return {
    state: state,
    renderCurrent: renderCurrent
  };
})(
  typeof CONFIG !== 'undefined' ? CONFIG : require('./config.js'),
  typeof Util !== 'undefined' ? Util : require('./util.js'),
  typeof Store !== 'undefined' ? Store : require('./store.js'),
  typeof Toast !== 'undefined' ? Toast : require('./toast.js'),
  typeof Theme !== 'undefined' ? Theme : require('./theme.js'),
  typeof Render !== 'undefined' ? Render : require('./render.js'),
  typeof TaskOps !== 'undefined' ? TaskOps : require('./task-ops.js'),
  typeof Drag !== 'undefined' ? Drag : require('./drag.js'),
  typeof DateNav !== 'undefined' ? DateNav : require('./date-nav.js'),
  typeof Exporter !== 'undefined' ? Exporter : require('./exporter.js'),
  typeof Pdf !== 'undefined' ? Pdf : require('./pdf.js'),
  typeof Importer !== 'undefined' ? Importer : require('./importer.js'),
  typeof Prefs !== 'undefined' ? Prefs : require('./prefs.js')
);
