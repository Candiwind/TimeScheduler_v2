/**
 * task-ops.js —— 任务的增删改、勾选、统计
 *
 * 加载顺序：第 7 个（见 DS 1.4）。
 *
 * 按 DS 1.7 规矩二，本文件是**纯算逻辑**：不准出现 window / document，
 * 只操作传进来的 data 对象。所以它能在 Node 里完整地测。
 *
 * 这一层**不负责保存，也不负责重画**。它只改数据，改完由 app.js 去调
 * Store.save() 和 Render.render() —— 也就是 DS 1.6 说的「改数据 → 保存 → 重画」。
 *
 * 每个函数都返回一个结果对象：
 *   { ok: true,  task: {...} }        成功了，顺带把那条任务带出来（提示用得上）
 *   { ok: false, error: '错误码' }     失败了，错误码由 app.js 翻译成用户看得懂的话
 *
 * 错误码是稳定的字符串，不要直接往这里塞中文句子 —— 文案集中管理（见 DS 4.3）。
 */
var TaskOps = (function (CONFIG, Util, Store) {
  'use strict';

  /** 和 app.js 对好的错误码 */
  var ERR = {
    EMPTY_TEXT: 'EMPTY_TEXT',       // 文本去掉空白后是空的
    EMPTY_DAY: 'EMPTY_DAY',         // 空的一天不能缓存成模板（DS 2.14）
    BAD_DATE: 'BAD_DATE',           // 日期格式不对
    BAD_QUADRANT: 'BAD_QUADRANT',   // 象限 id 不认识
    BAD_SLOT: 'BAD_SLOT',           // 完成时段不在六个之内（DS 2.12）
    NOT_FOUND: 'NOT_FOUND'          // 找不到这条任务
  };

  function fail(error) {
    return { ok: false, error: error };
  }

  /** 日期和象限的合法性检查，几个函数都要用 */
  function checkTarget(dateStr, quadrantId) {
    if (!Util.isValidDateStr(dateStr)) return ERR.BAD_DATE;
    if (CONFIG.QUADRANT_IDS.indexOf(quadrantId) === -1) return ERR.BAD_QUADRANT;
    return null;
  }

  /** 把「想插到第几位」夹进合法范围，几个移动函数共用 */
  function clampIndex(toIndex, length) {
    var idx = (typeof toIndex === 'number' && isFinite(toIndex)) ? Math.floor(toIndex) : length;
    if (idx < 0) idx = 0;
    if (idx > length) idx = length;
    return idx;
  }

  // -------------------------------------------------------------------------
  // 任务块（DS 2.10）
  //
  // 象限列表里的条目有两种：普通任务、任务块。块的形状见 store.js 的
  // normalizeItem —— 这里只关心四条规矩：
  //   1. 块只有一层，块里只能装任务
  //   2. 块的完成状态只由块内任务决定；勾块 = 全勾/全取消块内任务
  //   3. 块和任务在象限列表里混排，先后就是列表顺序
  //   4. 空块合法
  // -------------------------------------------------------------------------

  /** 是不是任务块。判断只认 type 标记 */
  function isBlock(item) {
    return !!item && item.type === 'block';
  }

  /** 块内的任务列表（永远返回数组） */
  function blockTasks(block) {
    return (block && Array.isArray(block.tasks)) ? block.tasks : [];
  }

  /** 块的完成状态同步：所有最细单位都完成才算完成，**空块一律未完成** */
  function syncBlockCompleted(block) {
    block.completed = Store.blockDone(blockTasks(block));
    return block.completed;
  }

  /**
   * 任务所在的**宿主块**跟着重算一次完成状态（规矩 2：块的状态是派生的）。
   * 任务在顶层时 blockId 为 null，什么都不做 —— 没有宿主可同步。
   *
   * 凡是改了块内任务完成状态的入口（勾任务、勾阶段、加删阶段）都要调它，
   * 漏掉的后果是：块里的任务全勾完了，块头上的勾选框却没跟上。
   */
  function syncHostBlock(data, dateStr, quadrantId, blockId) {
    if (!blockId) return;
    var host = findBlock(data, dateStr, quadrantId, blockId);
    if (host) syncBlockCompleted(host.block);
  }

  /**
   * 把一个「可整勾的条目」设成某个完成状态：有阶段就设所有阶段，
   * 没阶段就设它自己。toggleTask / toggleBlock 共用它，别处不要再写一遍。
   */
  function setUnitDone(task, target) {
    var stages = stagesOf(task);
    if (stages.length) {
      for (var i = 0; i < stages.length; i++) {
        stages[i].completed = target;
      }
      syncCompleted(task);
    } else {
      task.completed = target;
    }
  }

  /**
   * 在数据里找一条任务。
   * 返回 { quadrantId, blockId, index, task }，找不到返回 null。
   *
   * **任务可能在象限顶层，也可能在某个块里**（见 DS 2.10），
   * 所以这个函数要穿透块去找：
   *   blockId 为 null → 在象限顶层，index 是顶层列表的下标
   *   blockId 为块 id → 在那个块里，index 是块内列表的下标
   *
   * 注意：**只在指定的象限里找**。同一份数据里任务 id 是唯一的，
   * 带上象限是为了顺带拿到 index —— 删除和移动都要用它。
   */
  function findTask(data, dateStr, quadrantId, taskId) {
    if (!data || !data.dates[dateStr]) return null;
    var list = data.dates[dateStr][quadrantId];
    if (!Array.isArray(list)) return null;

    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      if (isBlock(item)) {
        var tasks = blockTasks(item);
        for (var k = 0; k < tasks.length; k++) {
          if (tasks[k].id === taskId) {
            return { quadrantId: quadrantId, blockId: item.id, index: k, task: tasks[k] };
          }
        }
      } else if (item.id === taskId) {
        return { quadrantId: quadrantId, blockId: null, index: i, task: item };
      }
    }
    return null;
  }

  /** 跨四个象限找一条任务（调用方不知道它在哪个象限时用） */
  function findTaskAnywhere(data, dateStr, taskId) {
    for (var i = 0; i < CONFIG.QUADRANT_IDS.length; i++) {
      var found = findTask(data, dateStr, CONFIG.QUADRANT_IDS[i], taskId);
      if (found) return found;
    }
    return null;
  }

  /**
   * 在某天某象限的**顶层**找一个任务块。返回 { quadrantId, index, block } 或 null。
   * 块只存在于顶层（规矩 1），所以不用往下找。
   */
  function findBlock(data, dateStr, quadrantId, blockId) {
    if (!data || !data.dates[dateStr]) return null;
    var list = data.dates[dateStr][quadrantId];
    if (!Array.isArray(list)) return null;

    for (var i = 0; i < list.length; i++) {
      if (isBlock(list[i]) && list[i].id === blockId) {
        return { quadrantId: quadrantId, index: i, block: list[i] };
      }
    }
    return null;
  }

  /** 跨四个象限找一个块 */
  function findBlockAnywhere(data, dateStr, blockId) {
    for (var i = 0; i < CONFIG.QUADRANT_IDS.length; i++) {
      var found = findBlock(data, dateStr, CONFIG.QUADRANT_IDS[i], blockId);
      if (found) return found;
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // 增
  // -------------------------------------------------------------------------

  /**
   * 新增一条任务，加到该象限列表的**末尾**。
   *
   * 为什么不插到开头：末尾是用户预期得到的位置 —— 新加的东西排在最后，
   * 不会把已经排好的任务顺序挤乱（顺序是用户手动拖出来的，见 D-10）。
   */
  function addTask(data, dateStr, quadrantId, text) {
    var bad = checkTarget(dateStr, quadrantId);
    if (bad) return fail(bad);

    var clean = Util.cleanText(text);
    if (!clean) return fail(ERR.EMPTY_TEXT);

    var task = {
      id: Util.genId(),
      text: clean,
      completed: false,
      createdAt: Date.now()
    };

    Store.ensureDay(data, dateStr)[quadrantId].push(task);
    return { ok: true, task: task };
  }

  // -------------------------------------------------------------------------
  // 阶段
  //
  // 「阶段」是任务下面的一层步骤，有自己的文字和自己的勾选状态：
  //   写季度报告 = 收集数据 → 写初稿 → 审阅 → 定稿
  //
  // 几条定死的规矩（见 DS 2.9）：
  //   1. **阶段只有一层**，阶段下面不能再挂阶段
  //   2. **父任务的完成状态只由阶段决定**，父任务不能"自己"完成
  //   3. **阶段只能在同一个任务内部换顺序**，不能拖到别的任务去
  //   4. 没有阶段的任务，**它自己就是一个条目** —— 勾选框就是它自己
  // -------------------------------------------------------------------------

  /** 取一条任务的阶段列表（永远返回数组；老数据没有这个字段也安全） */
  function stagesOf(task) {
    return (task && Array.isArray(task.stages)) ? task.stages : [];
  }

  /**
   * 一条任务的进度。统计和界面都靠它，别在别处另算一套。
   *
   * 没阶段的任务：它自己就是一个条目 —— 0/1 或者 1/1。
   * 有阶段的任务：按阶段数来。
   *
   * 这就是「统计按最细的可勾选单位算」那句话的落地：有阶段就数阶段，
   * 没阶段就数任务自己。
   */
  function getProgress(task) {
    var stages = stagesOf(task);

    if (!stages.length) {
      return {
        done: task && task.completed ? 1 : 0,
        total: 1,
        hasStages: false,
        isComplete: !!(task && task.completed)
      };
    }

    var done = 0;
    for (var i = 0; i < stages.length; i++) {
      if (stages[i].completed) done++;
    }

    return {
      done: done,
      total: stages.length,
      hasStages: true,
      isComplete: done === stages.length
    };
  }

  /**
   * 一个**条目**的进度：任务走 getProgress，块聚合它内部的最细可勾选单位。
   *
   * 顶部统计、象限标题栏计数、块头上的 n/n 必须都用它 ——
   * 「两边必须同一个算法」的规矩（见 DS 2.9 / 2.10），别处不准另算一套。
   * 块自身永远不计数：统计数的是块里的东西，不是块这个壳。
   */
  function progressOfItem(item) {
    if (!isBlock(item)) return getProgress(item);

    var tasks = blockTasks(item);
    var done = 0;
    var total = 0;
    for (var i = 0; i < tasks.length; i++) {
      var p = getProgress(tasks[i]);
      done += p.done;
      total += p.total;
    }

    return {
      done: done,
      total: total,
      hasStages: true,   // 块头上总要显示 n/n，哪怕里面装的是普通任务
      isComplete: total > 0 && done === total
    };
  }

  /**
   * 有阶段时，把父任务的 completed 同步成「阶段是不是全完成了」。
   *
   * **没阶段时一个字都不动** —— 那时候 completed 是用户自己勾的，
   * 覆盖掉就等于把用户的勾选抹了。
   *
   * 为什么要存这个"冗余"字段：导出的 JSON 是给人和别的程序看的，
   * 里面每条任务自带一个明确的 completed 更省事；也让将来可能存在的
   * 老版本读新数据时，至少大致状态是对的。
   */
  function syncCompleted(task) {
    var stages = stagesOf(task);
    if (!stages.length) return task.completed;
    task.completed = getProgress(task).isComplete;
    return task.completed;
  }

  /** 在任务里找一个阶段 */
  function findStage(task, stageId) {
    var stages = stagesOf(task);
    for (var i = 0; i < stages.length; i++) {
      if (stages[i].id === stageId) {
        return { index: i, stage: stages[i] };
      }
    }
    return null;
  }

  /** 定位任务：返回 { quadrantId, task }，找不到返回 null */
  function locateTask(data, dateStr, quadrantId, taskId) {
    var bad = checkTarget(dateStr, quadrantId);
    if (bad) return null;
    var found = findTask(data, dateStr, quadrantId, taskId);
    // blockId 带出来：改完任务里的东西，宿主块的状态要跟着重算（规矩 2）
    return found
      ? { quadrantId: quadrantId, blockId: found.blockId, task: found.task }
      : null;
  }

  /**
   * 给任务加一个阶段。
   *
   * 加的瞬间，父任务的 completed 会被同步成「阶段全完成了吗」——
   * 也就是变成 false（新加的这条还没勾）。这是有意的：
   * 一条任务从「没阶段、已完成」变成「有阶段、未完成」，才符合直觉。
   */
  function addStage(data, dateStr, quadrantId, taskId, text) {
    var located = locateTask(data, dateStr, quadrantId, taskId);
    if (!located) return fail(ERR.NOT_FOUND);

    var clean = Util.cleanText(text);
    if (!clean) return fail(ERR.EMPTY_TEXT);

    var task = located.task;
    if (!Array.isArray(task.stages)) task.stages = [];

    var stage = {
      id: Util.genId(),
      text: clean,
      completed: false,
      createdAt: Date.now()
    };
    task.stages.push(stage);
    syncCompleted(task);
    syncHostBlock(data, dateStr, located.quadrantId, located.blockId);

    return { ok: true, stage: stage };
  }

  /** 改阶段的文字。改空了拒绝，原文恢复（和任务一样，见 editTask 的说明） */
  function editStage(data, dateStr, quadrantId, taskId, stageId, text) {
    var located = locateTask(data, dateStr, quadrantId, taskId);
    if (!located) return fail(ERR.NOT_FOUND);

    var found = findStage(located.task, stageId);
    if (!found) return fail(ERR.NOT_FOUND);

    var clean = Util.cleanText(text);
    if (!clean) return fail(ERR.EMPTY_TEXT);

    found.stage.text = clean;
    return { ok: true, stage: found.stage };
  }

  /** 勾选 / 取消勾选一个阶段，顺带把父任务的状态同步过去 */
  function toggleStage(data, dateStr, quadrantId, taskId, stageId, completed) {
    var located = locateTask(data, dateStr, quadrantId, taskId);
    if (!located) return fail(ERR.NOT_FOUND);

    var found = findStage(located.task, stageId);
    if (!found) return fail(ERR.NOT_FOUND);

    found.stage.completed = (typeof completed === 'boolean')
      ? completed
      : !found.stage.completed;

    syncCompleted(located.task);
    syncHostBlock(data, dateStr, located.quadrantId, located.blockId);
    return { ok: true, stage: found.stage };
  }

  /** 删掉一个阶段 */
  function removeStage(data, dateStr, quadrantId, taskId, stageId) {
    var located = locateTask(data, dateStr, quadrantId, taskId);
    if (!located) return fail(ERR.NOT_FOUND);

    var found = findStage(located.task, stageId);
    if (!found) return fail(ERR.NOT_FOUND);

    var task = located.task;
    task.stages.splice(found.index, 1);

    // 阶段删光了就把这个字段收掉，别留一个空数组在数据里
    if (!task.stages.length) delete task.stages;

    syncCompleted(task);
    syncHostBlock(data, dateStr, located.quadrantId, located.blockId);
    return { ok: true, stage: found.stage };
  }

  /**
   * 一键把所有阶段勾上 / 全取消。
   *
   * 这是任务行左边那个勾选框干的事（见 DS 2.9）：
   * 它的含义永远是「把这一条整个勾上 / 取消」——
   * 没阶段时就是任务自己，有阶段时就是下面所有阶段。
   */
  function setAllStages(data, dateStr, quadrantId, taskId, completed) {
    var located = locateTask(data, dateStr, quadrantId, taskId);
    if (!located) return fail(ERR.NOT_FOUND);

    var stages = stagesOf(located.task);
    for (var i = 0; i < stages.length; i++) {
      stages[i].completed = !!completed;
    }
    syncCompleted(located.task);
    syncHostBlock(data, dateStr, located.quadrantId, located.blockId);

    return { ok: true, task: located.task };
  }

  /**
   * 阶段内部换顺序。
   *
   * toIndex 的口径和 moveTask 一致：**以「把这条摘出来之后」的列表为准**。
   * 阶段只能在**同一个任务内部**挪 —— 跨任务移动这一版不做（见 DS 2.9）。
   */
  function moveStage(data, dateStr, quadrantId, taskId, stageId, toIndex) {
    var located = locateTask(data, dateStr, quadrantId, taskId);
    if (!located) return fail(ERR.NOT_FOUND);

    var task = located.task;
    var found = findStage(task, stageId);
    if (!found) return fail(ERR.NOT_FOUND);

    var list = task.stages;
    list.splice(found.index, 1);

    var idx = clampIndex(toIndex, list.length);
    list.splice(idx, 0, found.stage);
    return { ok: true, stage: found.stage, index: idx };
  }

  // -------------------------------------------------------------------------
  // 改
  // -------------------------------------------------------------------------

  /**
   * 改任务文本。
   *
   * 改空了怎么办：**拒绝，并且保持原文不变**。
   * 不能改成空字符串，也不能把这条删掉 —— 用户可能只是想清空重打，
   * 手一滑就丢了一条任务，是最容易让人骂人的那种交互。
   */
  function editTask(data, dateStr, quadrantId, taskId, text) {
    var bad = checkTarget(dateStr, quadrantId);
    if (bad) return fail(bad);

    var found = findTask(data, dateStr, quadrantId, taskId);
    if (!found) return fail(ERR.NOT_FOUND);

    var clean = Util.cleanText(text);
    if (!clean) return fail(ERR.EMPTY_TEXT);

    found.task.text = clean;
    return { ok: true, task: found.task };
  }

  /**
   * 勾选 / 取消勾选**一条任务**。
   *
   * 这个勾选框的含义永远是「把这一条整个勾上 / 取消」（见 DS 2.9）：
   *   - 没阶段的任务：就是它自己的完成状态
   *   - 有阶段的任务：把下面**所有阶段**一起勾上 / 一起取消，
   *     父任务自己不单独存状态，完全由阶段推出来
   *
   * 所以「有阶段时父亲能不能自己完成」这个问题的答案是：不能 ——
   * 这个入口只是给了个一次性勾完全部阶段的快捷方式。
   *
   * 不传 completed 就取反，传了就按传的来。
   * 有阶段时，「取反」看的是**是不是已经全完成了**，不是某一个阶段。
   */
  function toggleTask(data, dateStr, quadrantId, taskId, completed) {
    var bad = checkTarget(dateStr, quadrantId);
    if (bad) return fail(bad);

    var found = findTask(data, dateStr, quadrantId, taskId);
    if (!found) return fail(ERR.NOT_FOUND);

    var task = found.task;

    var target = (typeof completed === 'boolean')
      ? completed
      : !getProgress(task).isComplete;

    setUnitDone(task, target);
    syncHostBlock(data, dateStr, quadrantId, found.blockId);

    return { ok: true, task: task };
  }

  // -------------------------------------------------------------------------
  // 删
  // -------------------------------------------------------------------------

  /**
   * 删除一条任务。**直接删，没有回收站**（见 FS 的 P0 约定）。
   * 任务可能在顶层也可能在块里（findTask 穿透块），在哪儿就从哪儿删。
   *
   * 返回里带上被删掉的那条，是为了让调用方能在提示里说清「删掉了什么」——
   * 删错了才发现是最难受的，至少要让他知道刚才删的是哪条。
   */
  function removeTask(data, dateStr, quadrantId, taskId) {
    var bad = checkTarget(dateStr, quadrantId);
    if (bad) return fail(bad);

    var found = findTask(data, dateStr, quadrantId, taskId);
    if (!found) return fail(ERR.NOT_FOUND);

    var removed = found.task;
    if (found.blockId) {
      var host = findBlock(data, dateStr, quadrantId, found.blockId);
      if (host) {
        host.block.tasks.splice(found.index, 1);
        // 删掉的可能正是那条没完成的 —— 剩下的全完成时，块要跟着翻成完成
        syncBlockCompleted(host.block);
      }
    } else {
      data.dates[dateStr][quadrantId].splice(found.index, 1);
    }

    // 删空了就把这一天整个收掉，别留一个四条空数组占地方
    if (!Store.hasAnyTask(data, dateStr)) {
      delete data.dates[dateStr];
    }

    return { ok: true, task: removed };
  }

  // -------------------------------------------------------------------------
  // 任务块：增改名勾删移（DS 2.10）
  // -------------------------------------------------------------------------

  /**
   * 新建一个**空**任务块，加到该象限顶层的末尾（和 addTask 同一个位置逻辑：
   * 新东西排最后，不挤乱用户排好的顺序）。
   */
  function addBlock(data, dateStr, quadrantId, text) {
    var bad = checkTarget(dateStr, quadrantId);
    if (bad) return fail(bad);

    var clean = Util.cleanText(text);
    if (!clean) return fail(ERR.EMPTY_TEXT);

    var block = {
      id: Util.genId(),
      type: 'block',
      text: clean,
      completed: false,
      createdAt: Date.now(),
      tasks: []
    };

    Store.ensureDay(data, dateStr)[quadrantId].push(block);
    return { ok: true, block: block };
  }

  /** 改块名。改空了拒绝、原名保留（和任务同一条交互规矩，见 D-31） */
  function editBlock(data, dateStr, quadrantId, blockId, text) {
    var bad = checkTarget(dateStr, quadrantId);
    if (bad) return fail(bad);

    var found = findBlock(data, dateStr, quadrantId, blockId);
    if (!found) return fail(ERR.NOT_FOUND);

    var clean = Util.cleanText(text);
    if (!clean) return fail(ERR.EMPTY_TEXT);

    found.block.text = clean;
    return { ok: true, block: found.block };
  }

  /**
   * 勾选 / 取消一个**块**：把块内所有任务（连同它们的阶段）一起设成同一状态。
   * 「取反」看的是块现在是不是全完成。空块没有可设的东西，设了也无效果
   * （completed 由 syncBlockCompleted 算出来，空块永远是 false）。
   */
  function toggleBlock(data, dateStr, quadrantId, blockId, completed) {
    var bad = checkTarget(dateStr, quadrantId);
    if (bad) return fail(bad);

    var found = findBlock(data, dateStr, quadrantId, blockId);
    if (!found) return fail(ERR.NOT_FOUND);

    var tasks = blockTasks(found.block);
    var target = (typeof completed === 'boolean')
      ? completed
      : !progressOfItem(found.block).isComplete;

    for (var i = 0; i < tasks.length; i++) {
      setUnitDone(tasks[i], target);
    }
    syncBlockCompleted(found.block);

    return { ok: true, block: found.block };
  }

  /**
   * 删除一个**条目**：块（连块内任务一起删）或任务（顶层或块内）都走这里。
   * 返回里的 kind 告诉调用方删掉的是什么，提示文案要用（删块必须说清楚
   * 「连里面的几条任务一起删了」）。
   */
  function removeItem(data, dateStr, quadrantId, itemId) {
    var blockFound = findBlock(data, dateStr, quadrantId, itemId);
    if (blockFound) {
      var removed = blockFound.block;
      data.dates[dateStr][quadrantId].splice(blockFound.index, 1);
      if (!Store.hasAnyTask(data, dateStr)) {
        delete data.dates[dateStr];
      }
      return { ok: true, kind: 'block', block: removed, taskCount: blockTasks(removed).length };
    }

    var result = removeTask(data, dateStr, quadrantId, itemId);
    if (result.ok) result.kind = 'task';
    return result;
  }

  /** 勾选一个条目：块 → 一键全勾/全取消块内；任务 → 原逻辑 */
  function toggleItem(data, dateStr, quadrantId, itemId, completed) {
    var blockFound = findBlock(data, dateStr, quadrantId, itemId);
    if (blockFound) {
      return toggleBlock(data, dateStr, quadrantId, itemId, completed);
    }
    return toggleTask(data, dateStr, quadrantId, itemId, completed);
  }

  /** 改一个条目的文字：块改块名，任务改文本 */
  function editItem(data, dateStr, quadrantId, itemId, text) {
    var blockFound = findBlock(data, dateStr, quadrantId, itemId);
    if (blockFound) {
      return editBlock(data, dateStr, quadrantId, itemId, text);
    }
    return editTask(data, dateStr, quadrantId, itemId, text);
  }

  /**
   * 把一条任务拖进某个块。
   *
   * 任务可能在任何象限的顶层、也可能在另一个块里 —— 先摘出来再插进去。
   * 源块和目标块的完成状态都要重新同步（进出都会改变块内完成数）。
   */
  function moveTaskIntoBlock(data, dateStr, taskId, blockId, toIndex) {
    var found = findTaskAnywhere(data, dateStr, taskId);
    if (!found) return fail(ERR.NOT_FOUND);

    var target = findBlockAnywhere(data, dateStr, blockId);
    if (!target) return fail(ERR.NOT_FOUND);

    if (!Array.isArray(target.block.tasks)) target.block.tasks = [];

    // 摘出来
    if (found.blockId) {
      var host = findBlock(data, dateStr, found.quadrantId, found.blockId);
      if (!host) return fail(ERR.NOT_FOUND);
      host.block.tasks.splice(found.index, 1);
      syncBlockCompleted(host.block);
    } else {
      data.dates[dateStr][found.quadrantId].splice(found.index, 1);
    }

    var idx = clampIndex(toIndex, target.block.tasks.length);
    target.block.tasks.splice(idx, 0, found.task);
    syncBlockCompleted(target.block);

    return { ok: true, task: found.task, blockId: blockId, index: idx };
  }

  /**
   * 挪一个块：同象限换位置或跨象限，块内任务跟着走。
   * 块只能落**顶层**（规矩 1），这里就是数据侧的强制点。
   */
  function moveBlock(data, dateStr, blockId, toQuadrantId, toIndex) {
    var bad = checkTarget(dateStr, toQuadrantId);
    if (bad) return fail(bad);

    var found = findBlockAnywhere(data, dateStr, blockId);
    if (!found) return fail(ERR.NOT_FOUND);

    data.dates[dateStr][found.quadrantId].splice(found.index, 1);

    var target = Store.ensureDay(data, dateStr)[toQuadrantId];
    var idx = clampIndex(toIndex, target.length);
    target.splice(idx, 0, found.block);
    return { ok: true, block: found.block, quadrantId: toQuadrantId, index: idx };
  }

  /**
   * 拖拽落地的统一入口（drag.js → app.js → 这里）。
   *
   * info: { kind: 'task'|'block', id, toQuadrantId, toBlockId, toIndex }
   *
   * 规矩 1 在这里兜底：块的落点即使带了 toBlockId，也按顶层处理。
   */
  function moveItem(data, dateStr, info) {
    if (!info || (info.kind !== 'task' && info.kind !== 'block')) {
      return fail(ERR.NOT_FOUND);
    }
    if (info.kind === 'block') {
      return moveBlock(data, dateStr, info.id, info.toQuadrantId, info.toIndex);
    }
    if (info.toBlockId) {
      return moveTaskIntoBlock(data, dateStr, info.id, info.toBlockId, info.toIndex);
    }
    return moveTask(data, dateStr, info.id, info.toQuadrantId, info.toIndex);
  }

  // -------------------------------------------------------------------------
  // 移动（拖拽的数据那半边）
  // -------------------------------------------------------------------------

  /**
   * 把一条任务挪到某个象限的第 toIndex 位。同象限换位置、跨象限移动都是它。
   *
   * **toIndex 以「把这条摘出来之后」的列表为准**：
   *   0            → 插到最前面
   *   list.length  → 插到最后面（越界会自动夹到合法范围）
   *
   * 为什么这么定：拖拽时算出来的位置天然就是「在其它几条之间的第几个」——
   * 被拖的那条自己不算数。要是按「摘出来之前」的序列算，同象限往后拖的时候
   * 每挪一格都要 ±1 修正，特别容易差一位，而且差一位这种 bug 肉眼很难看出来。
   *
   * 只移动、不删除也不新建，所以**不需要**考虑「源象限空了要不要收掉整天」——
   * 那条任务还在，只是换了个地方。
   */
  function moveTask(data, dateStr, taskId, toQuadrantId, toIndex) {
    var bad = checkTarget(dateStr, toQuadrantId);
    if (bad) return fail(bad);

    // 任务可能在四个象限里的任何一个、顶层或块内，所以是全局找
    var found = findTaskAnywhere(data, dateStr, taskId);
    if (!found) return fail(ERR.NOT_FOUND);

    var target = Store.ensureDay(data, dateStr)[toQuadrantId];

    // 从原来的地方摘出来。从块里拖出来 = 「拖出块」，不是删掉
    if (found.blockId) {
      var host = findBlock(data, dateStr, found.quadrantId, found.blockId);
      if (!host) return fail(ERR.NOT_FOUND);
      host.block.tasks.splice(found.index, 1);
      syncBlockCompleted(host.block);
    } else {
      data.dates[dateStr][found.quadrantId].splice(found.index, 1);
    }

    var idx = clampIndex(toIndex, target.length);
    target.splice(idx, 0, found.task);
    return { ok: true, task: found.task, quadrantId: toQuadrantId, index: idx };
  }

  // -------------------------------------------------------------------------
  // 计划池（DS 2.11）
  //
  // data.pool 是与 dates 平级的全局数组，里面装的就是任务形状的对象
  // （可以有 stages）。进池出池都是同一个对象搬位置，字段零转换。
  //
  // 池不计入统计（getStats 只扫 dates，天然正确）、30 天归档不动它
  // （applyArchive 会把 pool 原样带走）。
  // -------------------------------------------------------------------------

  /** 确保 data.pool 存在（老数据 / 被手工改过的数据可能没有这个字段） */
  function ensurePool(data) {
    if (!Array.isArray(data.pool)) data.pool = [];
    return data.pool;
  }

  /** 在池里找一条任务。返回 { index, task } 或 null */
  function findPoolItem(data, poolItemId) {
    var pool = ensurePool(data);
    for (var i = 0; i < pool.length; i++) {
      if (pool[i].id === poolItemId) {
        return { index: i, task: pool[i] };
      }
    }
    return null;
  }

  /**
   * 推迟：把一条任务从象限摘出来，压进池的**末尾**。
   * 文字、完成状态、阶段原样带走 —— 进池不是删除，什么都不丢。
   *
   * 界面只给**顶层任务**推迟按钮（块是手动分组的整体，不随单个任务的推迟
   * 而拆散），但数据层不禁止块内：findTask 穿透块找到哪就从哪摘，
   * 摘完宿主块重算一次完成状态（规矩 2）。
   */
  function postponeTask(data, dateStr, quadrantId, taskId) {
    var bad = checkTarget(dateStr, quadrantId);
    if (bad) return fail(bad);

    var found = findTask(data, dateStr, quadrantId, taskId);
    if (!found) return fail(ERR.NOT_FOUND);

    var removed = found.task;
    if (found.blockId) {
      var host = findBlock(data, dateStr, quadrantId, found.blockId);
      if (!host) return fail(ERR.NOT_FOUND);
      host.block.tasks.splice(found.index, 1);
      syncBlockCompleted(host.block);
    } else {
      data.dates[dateStr][quadrantId].splice(found.index, 1);
    }

    // 推迟和删除一样会把某一天掏空 —— 空了就收掉，别留四条空数组占地方
    if (!Store.hasAnyTask(data, dateStr)) {
      delete data.dates[dateStr];
    }

    // requirements 第 3 条：从象限推迟的，完成时间默认**下一天**，
    // 以被推迟任务所属的日期为基准（为什么不用真实今天，见 DS 2.11）。
    // dateStr 已经过 checkTarget 校验，addDays 不会失败
    removed.plannedDate = Util.addDays(dateStr, 1);

    ensurePool(data).push(removed);
    return { ok: true, task: removed };
  }

  /**
   * 推迟一条**阶段**（requirements 第 3 条）：把它从父任务里摘出来，
   * 保存为池内的一条**任务**。
   *
   * 文本前用中括号标注所属任务：`[父文本]阶段文本` —— 前缀直接拼进文本，
   * 不挂父任务引用（父任务可能被删、被改、自己也进了池，引用会悬空）。
   * 完成状态照抄阶段自己；阶段不再有自己的阶段，所以不建 stages 字段。
   */
  function postponeStage(data, dateStr, quadrantId, taskId, stageId) {
    var bad = checkTarget(dateStr, quadrantId);
    if (bad) return fail(bad);

    var located = locateTask(data, dateStr, quadrantId, taskId);
    if (!located) return fail(ERR.NOT_FOUND);

    var found = findStage(located.task, stageId);
    if (!found) return fail(ERR.NOT_FOUND);

    var pooled = {
      id: Util.genId(),
      text: '[' + located.task.text + ']' + found.stage.text,
      completed: found.stage.completed,
      createdAt: Date.now(),
      // 和推迟任务同一个默认：所属日期 + 1 天
      plannedDate: Util.addDays(dateStr, 1)
    };

    // 从父任务里摘出去，走 removeStage 同一套收尾：
    // 删光阶段时 syncCompleted 一个字不动（状态停住，见 2.9），
    // 还有剩的阶段时按剩下的重算；宿主块跟着同步（规矩 2）
    var task = located.task;
    task.stages.splice(found.index, 1);
    if (!task.stages.length) delete task.stages;
    syncCompleted(task);
    syncHostBlock(data, dateStr, located.quadrantId, located.blockId);

    ensurePool(data).push(pooled);
    return { ok: true, task: pooled, parent: task };
  }

  /**
   * 设定 / 修改 / 清除池内任务的完成时间（requirements 第 3 条：可修改）。
   * 传 'YYYY-MM-DD' 设定，传 null 清除（回到「未设定」——
   * 未设定的时间任务是**持续保留**的，不会被清掉或提醒）。
   */
  function setPoolDate(data, poolItemId, dateStr) {
    var found = findPoolItem(data, poolItemId);
    if (!found) return fail(ERR.NOT_FOUND);

    if (dateStr === null) {
      delete found.task.plannedDate;
      return { ok: true, task: found.task };
    }

    if (!Util.isValidDateStr(dateStr)) return fail(ERR.BAD_DATE);

    found.task.plannedDate = dateStr;
    return { ok: true, task: found.task };
  }

  /**
   * 池内**直接添加**一条任务（三期：用户指令「计划池也要允许自己添加任务」）。
   *
   * 和推迟进池同构：压进末尾、就是一条普通任务。差别只在默认时间——
   * 手动添加的 `plannedDate = dateStr + 7 天`（「默认 7 天后」）；
   * dateStr 是当前查看的日期，和推迟默认 +1 用同一个基准（见 DS 2.11
   * 「为什么手动添加的默认是查看日期 + 7」）。
   */
  function addPoolItem(data, dateStr, text) {
    if (!Util.isValidDateStr(dateStr)) return fail(ERR.BAD_DATE);

    var clean = Util.cleanText(text);
    if (!clean) return fail(ERR.EMPTY_TEXT);

    var task = {
      id: Util.genId(),
      text: clean,
      completed: false,
      createdAt: Date.now(),
      plannedDate: Util.addDays(dateStr, 7)
    };

    ensurePool(data).push(task);
    return { ok: true, task: task };
  }

  // -------------------------------------------------------------------------
  // 完成时段（DS 2.12）
  //
  // 时段是**纯标记**：这两个操作只改 `slot` 字段，不碰 completed、不碰统计、
  // 不触发重排。唯一的消费方是时间视图（DS 2.13）。
  // -------------------------------------------------------------------------

  /** 把「想设成的时段」翻成可写的值：null = 清除；六值之一 = 原样；其余 = 失败 */
  function checkSlot(slot) {
    if (slot === null) return { ok: true, value: null };
    if (typeof slot === 'string' && CONFIG.SLOTS.indexOf(slot) !== -1) {
      return { ok: true, value: slot };
    }
    return fail(ERR.BAD_SLOT);
  }

  /**
   * 设定 / 清除一条任务的完成时段。
   * 传六值之一（CONFIG.SLOTS）设定，传 null 清除（删字段，回「未设定」）。
   * 界面只给**没有阶段**的任务本体提供这个入口（有阶段时由各阶段分别设），
   * 但数据层不拦——块内任务一样能设（见 DS 2.12「谁可以有时段」）。
   */
  function setSlot(data, dateStr, quadrantId, taskId, slot) {
    var located = locateTask(data, dateStr, quadrantId, taskId);
    if (!located) return fail(ERR.NOT_FOUND);

    var checked = checkSlot(slot);
    if (!checked.ok) return checked;

    if (checked.value === null) delete located.task.slot;
    else located.task.slot = checked.value;
    return { ok: true, task: located.task };
  }

  /** 设定 / 清除一条阶段的完成时段（有阶段的任务，时段挂在各阶段身上） */
  function setStageSlot(data, dateStr, quadrantId, taskId, stageId, slot) {
    var located = locateTask(data, dateStr, quadrantId, taskId);
    if (!located) return fail(ERR.NOT_FOUND);

    var found = findStage(located.task, stageId);
    if (!found) return fail(ERR.NOT_FOUND);

    var checked = checkSlot(slot);
    if (!checked.ok) return checked;

    if (checked.value === null) delete found.stage.slot;
    else found.stage.slot = checked.value;
    return { ok: true, stage: found.stage, task: located.task };
  }

  /**
   * 时间视图的分组（DS 2.13）：把当天设了时段的任务 / 阶段按时段归堆。
   *
   * 返回 [{ slot, items: [...] }]，只含**有任务**的时段，按从早到晚排
   * （requirements：「根据时间段数量展示对应内容」）。纯读取，不改数据。
   *
   * 几条口径（和 2.12「谁可以有时段」严格对应）：
   *   - 无阶段任务：任务本体带 slot 就进组；
   *   - 有阶段任务：进组的是**设了 slot 的阶段**（带 parentText 标注所属任务），
   *     任务本体不进；
   *   - 块被拍平：块是分组不是内容，块内任务带 slot 照常进组；
   *   - 没设时段的不进任何组；计划池不进（池不按日期分，D-37）。
   */
  function getTimeView(data, dateStr) {
    var day = (data && data.dates) ? data.dates[dateStr] : null;
    var bySlot = {};

    function push(slot, item) {
      if (!bySlot[slot]) bySlot[slot] = [];
      bySlot[slot].push(item);
    }

    if (day) {
      for (var q = 0; q < CONFIG.QUADRANT_IDS.length; q++) {
        var qid = CONFIG.QUADRANT_IDS[q];
        var list = day[qid];
        if (!Array.isArray(list)) continue;

        for (var i = 0; i < list.length; i++) {
          var entry = list[i];
          var tasks = isBlock(entry) ? blockTasks(entry) : [entry];

          for (var k = 0; k < tasks.length; k++) {
            var task = tasks[k];
            if (!task) continue;
            var stages = stagesOf(task);

            if (stages.length) {
              for (var s = 0; s < stages.length; s++) {
                var stage = stages[s];
                if (stage.slot && CONFIG.SLOTS.indexOf(stage.slot) !== -1) {
                  push(stage.slot, {
                    kind: 'stage',
                    taskId: task.id,
                    stageId: stage.id,
                    quadrantId: qid,
                    text: stage.text,
                    parentText: task.text,
                    completed: stage.completed
                  });
                }
              }
            } else if (task.slot && CONFIG.SLOTS.indexOf(task.slot) !== -1) {
              push(task.slot, {
                kind: 'task',
                taskId: task.id,
                stageId: null,
                quadrantId: qid,
                text: task.text,
                parentText: null,
                completed: task.completed
              });
            }
          }
        }
      }
    }

    var out = [];
    for (var m = 0; m < CONFIG.SLOTS.length; m++) {
      var slot = CONFIG.SLOTS[m];
      if (bySlot[slot] && bySlot[slot].length) {
        out.push({ slot: slot, items: bySlot[slot] });
      }
    }
    return out;
  }

  /**
   * 把池里的一条任务放回某个象限。
   *
   * toIndex 口径和 moveTask 一致（以插入后的合法下标为准，越界夹紧）：
   * 拖拽回来时带上占位符承诺的位置；不带 toIndex 就排末尾 ——
   * 和 addTask 同一个位置逻辑，不挤乱用户排好的顺序。
   */
  function restoreFromPool(data, dateStr, quadrantId, poolItemId, toIndex) {
    var bad = checkTarget(dateStr, quadrantId);
    if (bad) return fail(bad);

    var found = findPoolItem(data, poolItemId);
    if (!found) return fail(ERR.NOT_FOUND);

    ensurePool(data).splice(found.index, 1);

    var target = Store.ensureDay(data, dateStr)[quadrantId];
    var idx = clampIndex(toIndex, target.length);
    target.splice(idx, 0, found.task);
    return { ok: true, task: found.task, quadrantId: quadrantId, index: idx };
  }

  /** 从池里删除一条。和象限里的删除一样：直接删，没有回收站 */
  function removePoolItem(data, poolItemId) {
    var found = findPoolItem(data, poolItemId);
    if (!found) return fail(ERR.NOT_FOUND);

    ensurePool(data).splice(found.index, 1);
    return { ok: true, task: found.task };
  }

  /** 改池内任务的文字。改空拒绝、原文保留（和 D-31 同一条规矩） */
  function editPoolItem(data, poolItemId, text) {
    var found = findPoolItem(data, poolItemId);
    if (!found) return fail(ERR.NOT_FOUND);

    var clean = Util.cleanText(text);
    if (!clean) return fail(ERR.EMPTY_TEXT);

    found.task.text = clean;
    return { ok: true, task: found.task };
  }

  // -------------------------------------------------------------------------
  // 模板（DS 2.14）：把某一天的四象限存成能反复用的底稿
  //
  // 「覆盖同名」纯按名字判定，不存「是否重命名过」标记位（D-41）：
  // 缓存 X 日 → 自动名就是 X；列表里有叫 X 的就覆盖它的 items，没有就新建。
  // 用户改过名 → 不再撞名 → 自然走新建。两条路都不需要额外的状态。
  // -------------------------------------------------------------------------

  function ensureTemplates(data) {
    if (!Array.isArray(data.templates)) data.templates = [];
    return data.templates;
  }

  function findTemplate(data, templateId) {
    var list = ensureTemplates(data);
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === templateId) return { template: list[i], index: i };
    }
    return null;
  }

  /** 深拷贝一份条目（数据全是 JSON 形状，直接走 JSON 往返最省事也最不容易漏字段） */
  function cloneItem(item) {
    return JSON.parse(JSON.stringify(item));
  }

  /**
   * 把当前查看日期的四象限任务表缓存成一份模板。
   *
   * - 自动名 = 日期串；已有同名模板 → 覆盖它的 items（返回 overwritten: true）；
   *   没有 → 新建一条（D-41 的纯名字判定）。
   * - 空的一天拒绝（EMPTY_DAY）——没有内容的模板没有意义。
   * - 存的是**深拷贝**：之后改那天的任务，模板不动（副本不是引用）。
   */
  function saveDayAsTemplate(data, dateStr) {
    if (!Util.isValidDateStr(dateStr)) return fail(ERR.BAD_DATE);

    if (!Store.hasAnyTask(data, dateStr)) return fail(ERR.EMPTY_DAY);

    var day = Store.getDayTasks(data, dateStr);
    var items = {};
    for (var q = 0; q < CONFIG.QUADRANT_IDS.length; q++) {
      var qid = CONFIG.QUADRANT_IDS[q];
      items[qid] = [];
      for (var i = 0; i < day[qid].length; i++) {
        items[qid].push(cloneItem(day[qid][i]));
      }
    }

    var list = ensureTemplates(data);
    for (var t = 0; t < list.length; t++) {
      if (list[t].name === dateStr) {
        list[t].items = items; // 撞名 = 未重命名 → 覆盖内容，id / createdAt 不动
        return { ok: true, template: list[t], overwritten: true };
      }
    }

    var template = {
      id: Util.genId(),
      name: dateStr,
      createdAt: Date.now(),
      items: items
    };
    list.push(template);
    return { ok: true, template: template, overwritten: false };
  }

  /** 改模板名。改空拒绝（和 D-31 同一条规矩） */
  function renameTemplate(data, templateId, name) {
    var found = findTemplate(data, templateId);
    if (!found) return fail(ERR.NOT_FOUND);

    var clean = Util.cleanText(name);
    if (!clean) return fail(ERR.EMPTY_TEXT);

    found.template.name = clean;
    return { ok: true, template: found.template };
  }

  /** 删一份模板。模板是副本不是引用，不影响任何日期的任务 */
  function removeTemplate(data, templateId) {
    var found = findTemplate(data, templateId);
    if (!found) return fail(ERR.NOT_FOUND);

    ensureTemplates(data).splice(found.index, 1);
    return { ok: true, template: found.template };
  }

  /**
   * 应用一条条目进象限：深拷贝 + 编号全部换新 + 勾选清零。
   *
   * 清零是「模板是计划不是记录」的核心（D-41）：把周一的已完成搬到周二，
   * 周二一打开就是半完成状态，统计全乱。阶段清零后父任务和块跟着 false。
   * slot / plannedDate 照抄 —— 「几点做」本来就是模板想搬的安排。
   */
  function applyTaskCopy(src) {
    var task = {
      id: Util.genId(),
      text: src.text,
      completed: false,
      createdAt: Date.now()
    };
    if (Array.isArray(src.stages) && src.stages.length) {
      task.stages = [];
      for (var i = 0; i < src.stages.length; i++) {
        var stage = {
          id: Util.genId(),
          text: src.stages[i].text,
          completed: false,
          createdAt: Date.now()
        };
        if (src.stages[i].slot) stage.slot = src.stages[i].slot;
        task.stages.push(stage);
      }
    }
    if (src.slot) task.slot = src.slot;
    if (src.plannedDate) task.plannedDate = src.plannedDate;
    return task;
  }

  function applyItemCopy(src) {
    if (isBlock(src)) {
      var block = {
        id: Util.genId(),
        type: 'block',
        text: src.text,
        completed: false,
        createdAt: Date.now(),
        tasks: []
      };
      var children = blockTasks(src);
      for (var i = 0; i < children.length; i++) {
        block.tasks.push(applyTaskCopy(children[i]));
      }
      return block;
    }
    return applyTaskCopy(src);
  }

  /**
   * 把模板内容填充进指定日期（界面上是「当前查看的日期」）。
   *
   * 同象限已有**同文本**条目的跳过（防重复应用出双份，和导入判重同一个
   * 思路）；原有任务一条不动。返回 { added, skipped }。
   */
  function applyTemplate(data, dateStr, templateId) {
    if (!Util.isValidDateStr(dateStr)) return fail(ERR.BAD_DATE);

    var found = findTemplate(data, templateId);
    if (!found) return fail(ERR.NOT_FOUND);

    var day = Store.ensureDay(data, dateStr);
    var added = 0;
    var skipped = 0;

    for (var q = 0; q < CONFIG.QUADRANT_IDS.length; q++) {
      var qid = CONFIG.QUADRANT_IDS[q];
      var srcList = (found.template.items && found.template.items[qid]) || [];
      var target = day[qid];

      for (var i = 0; i < srcList.length; i++) {
        var text = srcList[i].text;
        var dup = false;
        for (var k = 0; k < target.length; k++) {
          if (target[k].text === text) { dup = true; break; }
        }
        if (dup) { skipped++; continue; }

        target.push(applyItemCopy(srcList[i]));
        added++;
      }
    }

    return { ok: true, added: added, skipped: skipped, dateStr: dateStr };
  }

  // -------------------------------------------------------------------------
  // 统计
  // -------------------------------------------------------------------------

  /**
   * 当天的完成 / 总数 / 完成率。
   *
   * **按「最细的可勾选单位」算**（见 DS 2.9）：有阶段的任务数它的阶段，
   * 没阶段的任务数它自己。举例：
   *
   *   写季度报告（5 个阶段，勾了 3 个）→ 5 条，完成 3
   *   回邮件（没有阶段，没勾）        → 1 条，完成 0
   *   准备分享（2 个阶段，都勾了）     → 2 条，完成 2
   *   买咖啡豆（没有阶段，没勾）       → 1 条，完成 0
   *                                   ──────────────
   *                                   总数 9，完成 5
   *
   * 一条都没有时 total 是 0，**不能拿它做除数** —— 除零会得到 NaN 或
   * Infinity，页面上就会出现「完成率 NaN%」（见 DS 3.2）。这里直接给一个
   * 明确表示「算不出来」的 null，由 render.js 决定显示成「—」。
   */
  function getStats(data, dateStr) {
    var day = Store.getDayTasks(data, dateStr);
    var total = 0;
    var done = 0;

    for (var i = 0; i < CONFIG.QUADRANT_IDS.length; i++) {
      var list = day[CONFIG.QUADRANT_IDS[i]];
      for (var k = 0; k < list.length; k++) {
        // progressOfItem：任务算自己（有阶段算阶段），块算它内部的最细单位，
        // 块这个壳自身不占一条（见 DS 2.10 统计口径）
        var progress = progressOfItem(list[k]);
        total += progress.total;
        done += progress.done;
      }
    }

    return {
      done: done,
      total: total,
      remaining: total - done,
      rate: total === 0 ? null : done / total
    };
  }

  // -------------------------------------------------------------------------

  return {
    ERR: ERR,
    findTask: findTask,
    findTaskAnywhere: findTaskAnywhere,
    addTask: addTask,
    editTask: editTask,
    toggleTask: toggleTask,
    removeTask: removeTask,
    moveTask: moveTask,

    // 任务块（DS 2.10）
    isBlock: isBlock,
    blockTasks: blockTasks,
    findBlock: findBlock,
    findBlockAnywhere: findBlockAnywhere,
    addBlock: addBlock,
    editBlock: editBlock,
    toggleBlock: toggleBlock,
    removeItem: removeItem,
    toggleItem: toggleItem,
    editItem: editItem,
    moveItem: moveItem,
    moveTaskIntoBlock: moveTaskIntoBlock,
    moveBlock: moveBlock,
    progressOfItem: progressOfItem,

    // 定位（只读，测试和上层查询用）
    locateTask: locateTask,

    // 计划池（DS 2.11）
    postponeTask: postponeTask,
    postponeStage: postponeStage,
    restoreFromPool: restoreFromPool,
    removePoolItem: removePoolItem,
    editPoolItem: editPoolItem,
    setPoolDate: setPoolDate,
    addPoolItem: addPoolItem,
    findPoolItem: findPoolItem,

    // 完成时段（DS 2.12）
    setSlot: setSlot,
    setStageSlot: setStageSlot,

    // 时间视图（DS 2.13）
    getTimeView: getTimeView,

    // 模板（DS 2.14）
    saveDayAsTemplate: saveDayAsTemplate,
    renameTemplate: renameTemplate,
    removeTemplate: removeTemplate,
    applyTemplate: applyTemplate,
    findTemplate: findTemplate,

    // 阶段
    stagesOf: stagesOf,
    getProgress: getProgress,
    addStage: addStage,
    editStage: editStage,
    toggleStage: toggleStage,
    removeStage: removeStage,
    moveStage: moveStage,
    setAllStages: setAllStages,

    getStats: getStats
  };
})(
  typeof CONFIG !== 'undefined' ? CONFIG : require('./config.js'),
  typeof Util !== 'undefined' ? Util : require('./util.js'),
  typeof Store !== 'undefined' ? Store : require('./store.js')
);

// Node 测试环境用（浏览器里没有 module，这段不会执行）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TaskOps;
}
