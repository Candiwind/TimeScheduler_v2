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
     *   { mode: 'rename-template', templateId }               正在改某份模板的名字（见 DS 2.14）
     * 同一时刻只允许有一个 —— 两个输入框同时开着，用户根本不知道该提交哪个。
     */
    editing: null,

    /**
     * 哪些任务展开着（阶段列表露出来）。
     * 这是**界面状态**，不进用户数据 —— 不属于「用户的任务」，
     * 也没必要跟着导出、备份跑。存内存里，刷新页面就全折叠（见 DS 2.9）。
     */
    expanded: {},

    /**
     * 哪些任务块**折叠**着（块内任务收起来）。
     * 和 expanded 相反：块默认展开（新块空着，折叠了用户会以为没建成），
     * 所以记录的是「折叠了谁」。同样是界面状态，进存内存（见 DS 2.10 / D-36）。
     */
    collapsedBlocks: {},

    /**
     * 主区域显示哪个视图（DS 2.13）：'quadrants' 四象限 + 计划池，'time' 时间视图。
     * 界面状态，不进用户数据 —— 刷新回四象限（四象限是主视图，D-40）
     */
    view: 'quadrants',

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
    renderCurrent();
  }

  /** 折叠 / 展开一个任务块（默认展开，所以记的是折叠名单） */
  function toggleCollapsed(blockId) {
    if (state.collapsedBlocks[blockId]) delete state.collapsedBlocks[blockId];
    else state.collapsedBlocks[blockId] = true;
    renderCurrent();
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

  /** 把当前日期的内容和统计重画一遍 */
  function renderCurrent() {
    var day = Store.getDayTasks(state.data, state.date);
    state.stats = TaskOps.getStats(state.data, state.date);

    // 编辑状态往哪边传：带 quadrantId 的（任务 / 阶段 / 块）是象限类编辑。
    // 时间视图开着时，这份编辑得由时间视图画 —— 四象限那边不能再画一份
    // 输入框，不然 DOM 里同时存在两个 .task__input，commitEdit 的
    // document.querySelector 会读到藏在四象限里、没动过的那一份，
    // 用户在时间视图里改的字就丢了。
    // 池 / 模板的编辑（没有 quadrantId）不受视图切换影响，照常传。
    var quadrantEditing = (state.editing && state.editing.quadrantId)
      ? state.editing : null;
    var panelEditing = quadrantEditing ? null : state.editing;

    Render.render(day, state.stats, {
      editing: (state.view === 'time') ? panelEditing : state.editing,
      expanded: state.expanded,
      collapsedBlocks: state.collapsedBlocks,
      // 进度按「最细的可勾选单位」算，任务自己有阶段数阶段、块数块内 ——
      // 算法只有 task-ops 一份（见 render.js 里 fallbackProgress 的说明）
      progressOf: TaskOps.progressOfItem,
      // 计划池跟日期无关，画的是全局那一份（见 DS 2.11）
      pool: Array.isArray(state.data.pool) ? state.data.pool : [],
      // 模板同样是全局列表（见 DS 2.14）
      templates: Array.isArray(state.data.templates) ? state.data.templates : []
    });
    // 时间视图是另一份内容（按时段分组，DS 2.13）：开着就重画它；
    // 显示哪一边由 setViewMode 的 hidden 开关决定，两边内容都在 DOM 里
    if (state.view === 'time') {
      Render.renderTimeView(TaskOps.getTimeView(state.data, state.date), {
        editing: quadrantEditing
      });
    }
    Render.setViewMode(state.view);
    Render.setReadOnly(Store.isProtectionMode());
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
    state.editing = { mode: 'add-stage', quadrantId: quadrantId, taskId: taskId };
    renderCurrent();
    Render.focusEditor(false);
  }

  /** 开始改某个阶段的文字 */
  function startEditStage(quadrantId, taskId, stageId) {
    if (Store.isProtectionMode()) return;
    commitEdit();

    state.expanded[taskId] = true;
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

    var isStage = (editing.mode === 'add-stage' || editing.mode === 'edit-stage');
    // 日期输入框（pool__date-input）单独认：它的「空值」含义是清除时间，
    // 和文字输入框的空值不是一回事，所以不能混用选择器
    var input = document.querySelector(
      editing.mode === 'edit-pool-date' ? '.pool__date-input'
        : isStage ? '.stage__input' : '.task__input');
    var value = input ? input.value : '';

    // ---- 新增（任务、阶段、任务块或池内任务）----
    // 块和池内新增的输入框都复用 task__input（见 render.js），键盘/失焦逻辑共用
    if (editing.mode === 'add' || editing.mode === 'add-stage' ||
        editing.mode === 'add-block' || editing.mode === 'add-pool') {
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
      Toast.warn('时间格式不对，已保持原来的设定。');
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
    renderCurrent();
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
      persist();
      renderCurrent();
      Toast.show('已删除任务块「' + result.block.text + '」（含 ' +
                 result.taskCount + ' 条任务）');
      return;
    }

    delete state.expanded[itemId];   // 任务都没了，展开状态也一起收掉
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
   * 计划池自己的事件。和四象限那套是**两棵独立的子树**，各绑各的；
   * 池内没有勾选框、没有阶段，所以只有「删除 / 改文字 / 编辑框键盘」三件事。
   */
  function bindPool() {
    var pool = document.getElementById('pool');
    if (!pool) return;

    // ---- 点击 ----
    pool.addEventListener('click', function (e) {
      var target = e.target;

      // 头部「＋」→ 直接往池里添加任务（三期）
      if (closest(target, 'pool__add')) {
        startAddPool();
        return;
      }

      if (closest(target, 'pool__del')) {
        var delId = poolItemIdOf(target);
        if (delId) doRemovePoolItem(delId);
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
  // 阶段
  // -------------------------------------------------------------------------

  function doToggleStage(quadrantId, taskId, stageId, checked) {
    var result = TaskOps.toggleStage(state.data, state.date, quadrantId,
                                     taskId, stageId, checked);
    if (result.ok) persist();
    renderCurrent();
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
        renderCurrent();
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

        // 四种拖拽共用一套机制，最后落到不同的数据操作上（见 drag.js 开头的说明）。
        // 任务和块统一走 moveItem：块落点永远解析为顶层（规矩 1），
        // 任务落点带 targetBlockId 时是进块
        if (info.kind === 'pool') {
          // 池内任务拖回象限：按占位符的位置放回顶层（见 DS 2.11）
          var restored = TaskOps.restoreFromPool(state.data, state.date,
                                                 info.quadrantId,
                                                 info.poolItemId, info.index);
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
        Exporter.exportMarkdown(state.data);
      } else {
        Exporter.exportZip(state.data);
      }
      // 说「已开始下载」而不是「已导出」：浏览器不告诉我们文件最后有没有
      // 真的落到磁盘上，把话说满了就是在骗用户
      Toast.success('已开始下载，请查看浏览器的下载栏。');
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

    Render.openConfirm({
      title: '确认合并导入？',
      // 这里只是纯文本，不认 Markdown 记号
      message: '文件里的任务会合并进本地，本地已有的任务一条都不会被删掉。\n' +
               '重复的（同一天、同一象限、文字相同）会自动跳过。\n' +
               '建议先导出一份备份。',
      okLabel: '合并导入'
    }, function () {
      var wasProtected = Store.isProtectionMode();
      var result = Importer.merge(state.data, checked.data);

      // 保护模式下「导入备份文件」本来就是唯一的救援通道，
      // 所以导入成功之后要顺带把它解除掉
      if (wasProtected) {
        Store.exitProtectionMode();
        Render.setBanner('');
      }

      persist();
      renderCurrent();
      Toast.success('新增 ' + result.added + ' 条，跳过 ' + result.skipped + ' 条。');

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

    var started = Exporter.exportArchive(state.data, plan);
    if (!started) {
      Toast.error('浏览器不让自动下载。请先手动「导出 JSON」备份，再回来归档。');
      return;
    }

    // 走到这儿才算「下载已经发出去了」。仍然不等于文件一定落盘了，
    // 所以归档提示条会一直说明白：数据从本地移除了，要看就导入回来
    state.data = Store.applyArchive(state.data, plan);
    persist();
    renderCurrent();
    Render.setBanner('');
    Toast.success('已归档 ' + plan.archivedCount + ' 天的历史数据，请确认下载栏里的文件已保存。');
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

    // 默认停在今天（见 DS 1.5）
    state.date = Util.todayStr();

    bindQuadrants();
    bindTimeView();
    bindPool();
    bindTemplates();
    bindDateNav();
    bindViewToggle();
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
