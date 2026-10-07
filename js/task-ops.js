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
   * 新增一条任务，加到该象限列表的**开头**（需求 3）。
   *
   * 新加的东西排在最前，用户刚敲进去的任务一眼就能看到，不用滚到底下去找。
   * 时间视图走同一条规矩（v2.5）：新增的条目也排在该时段最前。
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

    Store.ensureDay(data, dateStr)[quadrantId].unshift(task);
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
      // 无阶段任务：它自己就是一个条目。Bonus 时 total 是 0（纯加分），
      // done 照算（勾了就是 1），isComplete 就是它自己的 completed。
      var isBonus = !!(task && task.bonus === true);
      var plainDone = (task && task.completed) ? 1 : 0;
      return {
        done: plainDone,
        total: isBonus ? 0 : 1,
        bonusDone: isBonus && plainDone ? 1 : 0,
        bonusCount: isBonus ? 1 : 0,
        hasStages: false,
        isComplete: !!(task && task.completed)
      };
    }

    // 有阶段：**完成率**口径（需求 2，v2.5 未动）——分母只计非 Bonus 阶段、
    // 分子计全部（含 Bonus），所以完成率可以超过 100%。
    //
    // 「全完成」（isComplete）是**另一条**口径（v2.5 改）：每个阶段都勾完才算完成，
    // Bonus 阶段没做就不算全完成。和 store.allDone、importer.copyTask 同一套。
    var done = 0;
    var total = 0;
    var bonusDone = 0;
    var bonusCount = 0;
    for (var i = 0; i < stages.length; i++) {
      var s = stages[i];
      if (s.completed) done++;
      if (s.bonus === true) {
        bonusCount++;
        if (s.completed) bonusDone++;
      } else {
        total++;
      }
    }

    return {
      done: done,
      total: total,
      bonusDone: bonusDone,
      bonusCount: bonusCount,
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
    var bonusDone = 0;
    var bonusCount = 0;
    var allCount = 0;
    for (var i = 0; i < tasks.length; i++) {
      var p = getProgress(tasks[i]);
      done += p.done;
      total += p.total;
      bonusDone += p.bonusDone || 0;
      bonusCount += p.bonusCount || 0;
      allCount += (p.total || 0) + (p.bonusCount || 0);
    }

    // 全完成 = 块内每个最细单位都勾完（v2.5：Bonus 单位也算数）；空块不算完成
    var isComplete = allCount > 0 && done === allCount;

    return {
      done: done,
      total: total,
      bonusDone: bonusDone,
      bonusCount: bonusCount,
      hasStages: true,   // 块头上总要显示 n/n，哪怕里面装的是普通任务
      isComplete: isComplete
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

    var wasComplete = getProgress(located.task).isComplete;
    found.stage.completed = (typeof completed === 'boolean')
      ? completed
      : !found.stage.completed;

    syncCompleted(located.task);
    syncHostBlock(data, dateStr, located.quadrantId, located.blockId);

    // 阶段本身不沉底；但勾完最后一个阶段导致父任务转成「已完成」时，
    // 父任务要沉底（需求 6 只豁免阶段，父任务仍是任务）
    if (!wasComplete && getProgress(located.task).isComplete) {
      sendCompletedToEnd(data, dateStr, located.quadrantId, located);
    }
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

    var wasComplete = getProgress(located.task).isComplete;
    var stages = stagesOf(located.task);
    for (var i = 0; i < stages.length; i++) {
      stages[i].completed = !!completed;
    }
    syncCompleted(located.task);
    syncHostBlock(data, dateStr, located.quadrantId, located.blockId);

    // 一键全勾导致父任务转成「已完成」时沉底（需求 6，同 toggleStage 口径）
    if (!wasComplete && getProgress(located.task).isComplete) {
      sendCompletedToEnd(data, dateStr, located.quadrantId, located);
    }

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

    var wasComplete = getProgress(task).isComplete;
    setUnitDone(task, target);
    syncHostBlock(data, dateStr, quadrantId, found.blockId);

    // 完成沉底（需求 6）：只在「未完成 → 已完成」方向移动，取消勾选不移回
    if (!wasComplete && getProgress(task).isComplete) {
      sendCompletedToEnd(data, dateStr, quadrantId, found);
    }

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
   * 新建一个**空**任务块，加到该象限顶层的开头（和 addTask 同一个位置逻辑：
   * 新东西排最前，用户刚建的块一眼就能看到）。
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

    Store.ensureDay(data, dateStr)[quadrantId].unshift(block);
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

    // 记下「未完成 → 已完成」转变的子任务，勾完后逐条沉底（需求 6）
    var flipped = [];
    for (var i = 0; i < tasks.length; i++) {
      var was = getProgress(tasks[i]).isComplete;
      setUnitDone(tasks[i], target);
      if (!was && getProgress(tasks[i]).isComplete) flipped.push(tasks[i]);
    }
    syncBlockCompleted(found.block);

    for (var j = 0; j < flipped.length; j++) {
      sendCompletedToEnd(data, dateStr, quadrantId, { blockId: blockId, task: flipped[j] });
    }

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
   * 在池里**任意位置**找一条条目：顶层任务 / 顶层任务块 / 块内任务。
   * 需求（重命名后 4）：DDL 以任务为单位，块内任务也要能定位、改 DDL、删、改文字。
   *
   * 返回 { container: 'pool', index, item } 或
   *      { container: 'block', block, index, item } 或 null。
   */
  function locatePoolItem(data, id) {
    var pool = ensurePool(data);
    for (var i = 0; i < pool.length; i++) {
      if (pool[i].id === id) {
        return { container: 'pool', index: i, item: pool[i] };
      }
      if (pool[i].type === 'block' && Array.isArray(pool[i].tasks)) {
        var tasks = pool[i].tasks;
        for (var j = 0; j < tasks.length; j++) {
          if (tasks[j].id === id) {
            return { container: 'block', block: pool[i], index: j, item: tasks[j] };
          }
        }
      }
    }
    return null;
  }

  /**
   * 在池里找一个**任务块**（块只存在于池顶层，规矩 1）。
   * 返回 { index, block } 或 null。
   */
  function findPoolBlock(data, blockId) {
    var pool = ensurePool(data);
    for (var i = 0; i < pool.length; i++) {
      if (pool[i].type === 'block' && pool[i].id === blockId) {
        return { index: i, block: pool[i] };
      }
    }
    return null;
  }

  /**
   * 把池内一条条目从它现在所在的地方摘出来（顶层任务 / 顶层块 / 块内任务三类）。
   * 块内任务摘出后宿主块完成度重算（和 removePoolItem 同一条规矩）。
   *
   * 收口成一个函数：`removePoolItem` / `restoreFromPool` / `movePoolItemTo`
   * 三处都是「先摘出来、再决定放哪」，摘出这一步只该有一份实现
   * （同类教训见 DS R-41）。
   */
  function detachPoolItem(data, found) {
    if (found.container === 'block') {
      found.block.tasks.splice(found.index, 1);
      syncBlockCompleted(found.block);
    } else {
      ensurePool(data).splice(found.index, 1);
    }
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
    // 阶段是 Bonus 的话，推迟出来的池内任务也带着 Bonus（需求 2 的数据流转）
    if (found.stage.bonus === true) pooled.bonus = true;
    // 高亮同理：阶段标了黄，推迟出来的池内任务接着标（见 DS 2.40）
    if (found.stage.highlight === true) pooled.highlight = true;

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
   * 需求（重命名后 4）：把一个任务块**整体**推迟进计划池。
   * 块连块内任务原样搬走，不拆散；和推迟单条任务同一条默认 ——
   * 块内每条任务的完成时间默认设成所属日期 + 1 天（DDL 以任务为单位，
   * 之后在池里可逐条改，见 DS 2.20）。
   */
  function postponeBlock(data, dateStr, quadrantId, blockId) {
    var bad = checkTarget(dateStr, quadrantId);
    if (bad) return fail(bad);

    var found = findBlock(data, dateStr, quadrantId, blockId);
    if (!found) return fail(ERR.NOT_FOUND);

    var removed = found.block;
    data.dates[dateStr][quadrantId].splice(found.index, 1);

    // 推迟和删除一样会把某一天掏空 —— 空了就收掉
    if (!Store.hasAnyTask(data, dateStr)) {
      delete data.dates[dateStr];
    }

    // 默认完成时间逐条设到块内任务上（不是设在块上 —— 块只是分组容器）
    var children = blockTasks(removed);
    for (var i = 0; i < children.length; i++) {
      children[i].plannedDate = Util.addDays(dateStr, 1);
    }

    ensurePool(data).push(removed);
    return { ok: true, block: removed };
  }

  /**
   * requirements（拖拽互通）第 3 条：把象限里的一条任务**拖**进计划池。
   *
   * 和 `postponeTask` 是同一种语义（从象限摘出、完成时间默认所属日期 + 1 天），
   * 差别只在落点由拖拽指定：`toBlockId` 为 null 落池**顶层**，否则落进那个块的
   * 任务列表；`toIndex` 口径和 moveTask 一致（以「摘出来之后」的列表为准）。
   *
   * 任务可能从象限顶层或某个块里被拖出来，所以用 `findTaskAnywhere` 定位
   * （调用方只给「拖的是哪条」，不必告诉是哪个象限 —— 和 moveItem 同一条）。
   */
  function moveTaskToPool(data, dateStr, taskId, toBlockId, toIndex) {
    if (!Util.isValidDateStr(dateStr)) return fail(ERR.BAD_DATE);

    var found = findTaskAnywhere(data, dateStr, taskId);
    if (!found) return fail(ERR.NOT_FOUND);

    var dstBlock = null;
    if (toBlockId) {
      var blockFound = findPoolBlock(data, toBlockId);
      if (!blockFound) return fail(ERR.NOT_FOUND);
      dstBlock = blockFound.block;
    }

    // 摘出来（从块里拖出来 = 拖出块，不是删掉），宿主块完成度重算
    if (found.blockId) {
      var host = findBlock(data, dateStr, found.quadrantId, found.blockId);
      if (!host) return fail(ERR.NOT_FOUND);
      host.block.tasks.splice(found.index, 1);
      syncBlockCompleted(host.block);
    } else {
      data.dates[dateStr][found.quadrantId].splice(found.index, 1);
    }

    // 和推迟一样会把某一天掏空 —— 空了就收掉
    if (!Store.hasAnyTask(data, dateStr)) {
      delete data.dates[dateStr];
    }

    // 推迟进池的默认完成时间：所属日期 + 1 天（和 postponeTask 同一条）
    found.task.plannedDate = Util.addDays(dateStr, 1);

    var list = dstBlock ? blockTasks(dstBlock) : ensurePool(data);
    var idx = clampIndex(toIndex, list.length);
    list.splice(idx, 0, found.task);
    if (dstBlock) syncBlockCompleted(dstBlock);

    return { ok: true, task: found.task, index: idx };
  }

  /**
   * requirements（拖拽互通）第 3 条：把象限里的一个任务块**拖**进计划池顶层。
   *
   * 和 `postponeBlock` 同一条语义（整块原样搬走、不拆散，块内每条任务完成时间
   * +1 天，块本体不设），差别只在落点由拖拽给出（`toIndex`），不再固定压到末尾。
   * 块只能落在池顶层（块里不许套块，规矩 1）。
   */
  function moveBlockToPool(data, dateStr, blockId, toIndex) {
    if (!Util.isValidDateStr(dateStr)) return fail(ERR.BAD_DATE);

    var found = findBlockAnywhere(data, dateStr, blockId);
    if (!found) return fail(ERR.NOT_FOUND);

    data.dates[dateStr][found.quadrantId].splice(found.index, 1);
    if (!Store.hasAnyTask(data, dateStr)) {
      delete data.dates[dateStr];
    }

    var children = blockTasks(found.block);
    for (var i = 0; i < children.length; i++) {
      children[i].plannedDate = Util.addDays(dateStr, 1);
    }

    var pool = ensurePool(data);
    var idx = clampIndex(toIndex, pool.length);
    pool.splice(idx, 0, found.block);
    return { ok: true, block: found.block, index: idx };
  }

  /**
   * 设定 / 修改 / 清除池内任务的完成时间（requirements 第 3 条：可修改）。
   * 传 'YYYY-MM-DD' 设定，传 null 清除（回到「未设定」——
   * 未设定的时间任务是**持续保留**的，不会被清掉或提醒）。
   */
  function setPoolDate(data, poolItemId, dateStr) {
    // 需求（重命名后 4）：DDL 以任务为单位，块内任务也要能定位到
    var found = locatePoolItem(data, poolItemId);
    if (!found) return fail(ERR.NOT_FOUND);

    if (dateStr === null) {
      delete found.item.plannedDate;
      return { ok: true, task: found.item };
    }

    if (!Util.isValidDateStr(dateStr)) return fail(ERR.BAD_DATE);

    found.item.plannedDate = dateStr;
    return { ok: true, task: found.item };
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

  /**
   * 需求（重命名后 4）：计划池里直接**添加任务块**（空块，和象限里的空块一样，
   * 任务后续往里加）。块是分组容器，自己不设 DDL；块内任务各自设 DDL。
   */
  function addPoolBlock(data, text) {
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

    ensurePool(data).push(block);
    return { ok: true, block: block };
  }

  /**
   * 需求（重命名后 4）：往池内某个任务块里加一条任务。
   * 和手动加池任务同一条默认 —— 完成时间 = 当前查看日期 + 7 天。
   */
  function addPoolBlockTask(data, dateStr, blockId, text) {
    if (!Util.isValidDateStr(dateStr)) return fail(ERR.BAD_DATE);

    var clean = Util.cleanText(text);
    if (!clean) return fail(ERR.EMPTY_TEXT);

    var found = findPoolItem(data, blockId);
    if (!found || found.task.type !== 'block') return fail(ERR.NOT_FOUND);

    var task = {
      id: Util.genId(),
      text: clean,
      completed: false,
      createdAt: Date.now(),
      plannedDate: Util.addDays(dateStr, 7)
    };

    var tasks = found.task.tasks;
    if (!Array.isArray(tasks)) { tasks = []; found.task.tasks = tasks; }
    tasks.push(task);
    syncBlockCompleted(found.task);

    return { ok: true, task: task, block: found.task };
  }

  /**
   * v2.6 需求 1：池内换顺序（拖拽的数据那半边）。
   *
   * 语义 = 「**原地**换顺序」：落点就是这条现在所属的那个列表（顶层 at 顶层、
   * 同一块内 at 同一块内），所以能拿它当「同列表排序」的窄入口。
   * v2.10 需求 3 放开了池内跨容器搬运，那条走 movePoolItemTo —— 这里
   * 就只是它的一层「按现状补全 toBlockId」的包装。
   *
   * toIndex 口径和 moveTask 完全一致（见 moveTask 的说明）：以「把这条
   * 摘出来之后」的列表为准，0 = 最前，list.length = 最后（越界自动夹紧）。
   */
  function movePoolItem(data, poolItemId, toIndex) {
    var found = locatePoolItem(data, poolItemId);
    if (!found) return fail(ERR.NOT_FOUND);

    return movePoolItemTo(data, poolItemId,
                          found.container === 'block' ? found.block.id : null,
                          toIndex);
  }

  /**
   * requirements（拖拽互通）第 3 条：池内条目挪位置，**同列表换顺序与跨容器都走它**。
   *
   * `toBlockId` 为 null = 落到池**顶层**；否则落进那个块的任务列表。
   * 池内跨容器（顶层 ↔ 块内）原来是明确不支持的（D-58），本版按需求
   * 「象限里能做的拖动，池里也要能做」放开：象限里能把任务拖进 / 拖出块，
   * 池里对应地也能。两端的宿主块都重算完成度（进出都改变块内完成数）。
   *
   * 块本体仍不能进块（块里不许套块，规矩 1），也不能把块拖进自己。
   * `toIndex` 口径和 movePoolItem 一致（以「摘出来之后」的列表为准，越界夹紧）。
   */
  function movePoolItemTo(data, poolItemId, toBlockId, toIndex) {
    var found = locatePoolItem(data, poolItemId);
    if (!found) return fail(ERR.NOT_FOUND);

    var dstBlock = null;
    if (toBlockId) {
      var blockFound = findPoolBlock(data, toBlockId);
      if (!blockFound) return fail(ERR.NOT_FOUND);
      dstBlock = blockFound.block;

      // 块里的位置放不下另一个块，也放不下它自己
      if (found.item === dstBlock || found.item.type === 'block') {
        return fail(ERR.NOT_FOUND);
      }
    }

    detachPoolItem(data, found);

    var list = dstBlock ? blockTasks(dstBlock) : ensurePool(data);
    var idx = clampIndex(toIndex, list.length);
    list.splice(idx, 0, found.item);
    if (dstBlock) syncBlockCompleted(dstBlock);

    return { ok: true, task: found.item, index: idx };
  }

  /**
   * v2.6 需求 3：一条池条目的「到期日」—— 自动导入拿它和今天比。
   *
   * - 普通任务（含阶段）：自己的 `plannedDate`；
   * - 任务块：块内任务里**最早**的那个（块本体没有 `plannedDate`，见 D-51）。
   *   取最早是「整块按该做的那天回来」；块内任务不单独到期，否则
   *   `postponeBlock` 设下的「+1 天」会让块第二天就被掏空（见 2.32 / D-60）。
   * - 取不到 / 脏数据 → null（当「未设定」，永远不到期，D-38）。
   */
  function poolItemDueDate(item) {
    if (!item) return null;

    if (item.type === 'block') {
      var children = blockTasks(item);
      var earliest = null;
      for (var i = 0; i < children.length; i++) {
        var d = children[i].plannedDate;
        if (typeof d === 'string' && Util.isValidDateStr(d) &&
            (earliest === null || d < earliest)) {
          earliest = d;
        }
      }
      return earliest;
    }

    var own = item.plannedDate;
    return (typeof own === 'string' && Util.isValidDateStr(own)) ? own : null;
  }

  /**
   * v2.6 需求 3：把「计划日期到了」的池内条目自动导入今天。
   *
   * - 到期判据：`dueDate <= todayStr` —— 过期没做的也算到期。
   *   'YYYY-MM-DD' 定长，字符串的字典序就是日期序，直接比。
   * - 只处理**池顶层**（任务 / 任务块），块内任务不单独触发：整块一起回来，
   *   不拆散「整体推迟」的块（见 poolItemDueDate / D-60）。
   * - 导入 = **移动**：从池里摘掉，按池内顺序整批放到今天 Q-II 的**开头**
   *   （和象限「新增任务加在开头」同一条规矩）。所以重复调用天然幂等 ——
   *   导过的条目已经不在池里了。
   * - 一条都没有时**不建**今天的记录（不留空壳日期）。
   *
   * quadrantId 不传就用 CONFIG.IMPORT_QUADRANT（第二象限）。
   */
  function autoImportDuePoolItems(data, todayStr, quadrantId) {
    var to = quadrantId || CONFIG.IMPORT_QUADRANT;
    var bad = checkTarget(todayStr, to);
    if (bad) return fail(bad);

    var pool = ensurePool(data);
    var due = [];

    for (var i = 0; i < pool.length; i++) {
      var dueDate = poolItemDueDate(pool[i]);
      if (dueDate !== null && dueDate <= todayStr) due.push(pool[i]);
    }
    if (!due.length) return { ok: true, imported: 0, items: [] };

    // 从池里摘掉。按对象身份找下标，不按下标批量删（避免删着删着错位）
    for (var d = 0; d < due.length; d++) {
      var at = pool.indexOf(due[d]);
      if (at !== -1) pool.splice(at, 1);
    }

    // 整批插到今天 Q-II 的开头。不能逐条 unshift —— 那会把池内顺序倒过来
    var day = Store.ensureDay(data, todayStr);
    day[to] = due.concat(day[to]);

    return { ok: true, imported: due.length, items: due };
  }

  // -------------------------------------------------------------------------
  // 池内勾选与沉底（v2.7 需求 1：池内任务块对齐象限）
  //
  // 池里的条目和象限里的任务长得一样了，勾选也得是同一套口径：有阶段就设
  // 全部阶段（setUnitDone）、完成态由阶段派生（syncCompleted）、勾完沉底。
  // 「池里不画阶段」是界面的事，数据不能因此走另一套 —— 两条口径并存
  // 是 v2.5 修过的那类病（见 D-56 / 2.34）。
  // -------------------------------------------------------------------------

  /**
   * 池内条目沉底：移到**它所属的那个列表**的末尾。
   *
   * 所属列表 = 块内任务的宿主块 `tasks`，其余（顶层任务 / 顶层块）是 `data.pool`。
   * 和象限的 `sendCompletedToEnd` 同一个形状，但池条目没有 `slot`，
   * 所以不需要顺带沉时间视图的键。
   */
  function sendPoolCompletedToEnd(data, found) {
    if (!found || !found.item) return;

    var list = (found.container === 'block')
      ? blockTasks(found.block)
      : ensurePool(data);

    var idx = list.indexOf(found.item);
    if (idx === -1 || idx === list.length - 1) return;   // 找不到或已在最后
    list.splice(idx, 1);
    list.push(found.item);
  }

  /**
   * v2.7 需求 1：勾选池内一个**任务块** —— 块内所有任务（连同阶段）设成同一状态。
   * 和象限 `toggleBlock` 同一套骨架，区别只在定位方式：池内块没有日期，
   * 靠 `findPoolItem`（块只存在于池顶层，和象限「块只在顶层」是同一条规矩）。
   *
   * 取反看块现在是不是全完成；空块设了也无效果（`syncBlockCompleted` 对空块恒 false）。
   */
  function togglePoolBlock(data, blockId, completed) {
    var found = findPoolItem(data, blockId);
    if (!found || !isBlock(found.task)) return fail(ERR.NOT_FOUND);

    var block = found.task;
    var tasks = blockTasks(block);
    var target = (typeof completed === 'boolean')
      ? completed
      : !progressOfItem(block).isComplete;

    // 记下「未完成 → 已完成」转变的子任务，勾完后逐条沉底（和 toggleBlock 一样）
    var flipped = [];
    for (var i = 0; i < tasks.length; i++) {
      var was = getProgress(tasks[i]).isComplete;
      setUnitDone(tasks[i], target);
      if (!was && getProgress(tasks[i]).isComplete) flipped.push(tasks[i]);
    }
    syncBlockCompleted(block);

    for (var j = 0; j < flipped.length; j++) {
      sendPoolCompletedToEnd(data, {
        container: 'block', block: block, item: flipped[j]
      });
    }

    return { ok: true, block: block };
  }

  /**
   * v2.7 需求 1：勾选池内一个条目。
   *
   * 给的是**块** id 就转给 `togglePoolBlock`（和象限 `toggleItem` 一样只留一个
   * 入口，调用方不必先判类型）；给的是任务 → 走下面：
   *
   * - 取反看「全完成」（有阶段时是所有阶段都勾完）；
   * - `setUnitDone` 设状态 —— **有阶段就设全部阶段**，池里看不见阶段不代表
   *   可以只改父级的 `completed`（那会让派生的 `completed` 和阶段对不上，
   *   导入 / 统计 / 另一处渲染全跟着错）；
   * - 在块内时宿主块重算一次完成状态（规矩 2）；
   * - 「未完成 → 已完成」才沉底，取消勾选不移回（D-47 同一条规矩）。
   */
  function togglePoolItem(data, poolItemId, completed) {
    var blockFound = findPoolItem(data, poolItemId);
    if (blockFound && isBlock(blockFound.task)) {
      return togglePoolBlock(data, poolItemId, completed);
    }

    var located = locatePoolItem(data, poolItemId);
    if (!located) return fail(ERR.NOT_FOUND);

    var item = located.item;
    var target = (typeof completed === 'boolean')
      ? completed
      : !getProgress(item).isComplete;

    var wasComplete = getProgress(item).isComplete;
    setUnitDone(item, target);

    if (located.container === 'block') syncBlockCompleted(located.block);

    if (!wasComplete && getProgress(item).isComplete) {
      sendPoolCompletedToEnd(data, located);
    }

    return { ok: true, task: item };
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

  // -------------------------------------------------------------------------
  // Bonus（需求 2）：任务 / 阶段标记为「额外加分」，图标礼品。
  //
  // Bonus 是**最细可勾选单位**的属性（和 slot 的「谁可以有时段」同口径）：
  // 无阶段的任务本体、或阶段可以标；带阶段的任务本体没有 Bonus（阶段各自标），
  // 块本体没有 Bonus（块是容器）。完成率口径见 getProgress / getStats。
  // -------------------------------------------------------------------------

  /** 设定 / 清除一条任务的 Bonus（只在**没有阶段**的任务上有意义） */
  function setBonus(data, dateStr, quadrantId, taskId, bonus) {
    var located = locateTask(data, dateStr, quadrantId, taskId);
    if (!located) return fail(ERR.NOT_FOUND);

    if (bonus) located.task.bonus = true;
    else delete located.task.bonus;

    // 块内任务标 / 取消 Bonus 会改块的完成度分母（规矩 2：块状态派生）
    syncHostBlock(data, dateStr, located.quadrantId, located.blockId);
    return { ok: true, task: located.task };
  }

  /** 设定 / 清除一条阶段的 Bonus */
  function setStageBonus(data, dateStr, quadrantId, taskId, stageId, bonus) {
    var located = locateTask(data, dateStr, quadrantId, taskId);
    if (!located) return fail(ERR.NOT_FOUND);

    var found = findStage(located.task, stageId);
    if (!found) return fail(ERR.NOT_FOUND);

    if (bonus) found.stage.bonus = true;
    else delete found.stage.bonus;

    syncCompleted(located.task);
    syncHostBlock(data, dateStr, located.quadrantId, located.blockId);
    return { ok: true, stage: found.stage, task: located.task };
  }

  // -------------------------------------------------------------------------
  // 高亮（requirements 最新一条，见 DS 2.40）
  //
  // 「高亮」= 给**一整条**（任务的整段文字 / 阶段的整段文字 / 任务块的块名）
  // 加浅橙色底色，界面上用**连续双击**切换。它是最细可勾选单位的属性，
  // 和 bonus 同一档：无阶段任务本体、阶段、块本体都可以标。
  //
  // 和 bonus / slot 的两点不同，都是故意的：
  //   1. 可选布尔字段，**不参与任何计算** —— 完成率、全完成、排序一概不看它，
  //      所以这些 set 函数不需要 syncCompleted / syncHostBlock（那两位是给
  //      「改了分母」的字段收尾的，高亮不改分母）；
  //   2. 高亮**不传染**：标了块不等于标了块内任务，反之亦然。
  //
  // 存储上走 optional 字段 + 只有 true 才置（老备份照常读，见 store.normalizeTask）。
  // -------------------------------------------------------------------------

  /** 设定 / 清除一条任务整体的高亮 */
  function setHighlight(data, dateStr, quadrantId, taskId, highlight) {
    var located = locateTask(data, dateStr, quadrantId, taskId);
    if (!located) return fail(ERR.NOT_FOUND);

    if (highlight) located.task.highlight = true;
    else delete located.task.highlight;

    return { ok: true, task: located.task };
  }

  /** 设定 / 清除一条阶段的高亮 */
  function setStageHighlight(data, dateStr, quadrantId, taskId, stageId, highlight) {
    var located = locateTask(data, dateStr, quadrantId, taskId);
    if (!located) return fail(ERR.NOT_FOUND);

    var found = findStage(located.task, stageId);
    if (!found) return fail(ERR.NOT_FOUND);

    if (highlight) found.stage.highlight = true;
    else delete found.stage.highlight;

    return { ok: true, stage: found.stage, task: located.task };
  }

  /** 设定 / 清除一个任务块的高亮（标的是块头，块内任务不受影响） */
  function setBlockHighlight(data, dateStr, quadrantId, blockId, highlight) {
    var bad = checkTarget(dateStr, quadrantId);
    if (bad) return fail(bad);

    var found = findBlock(data, dateStr, quadrantId, blockId);
    if (!found) return fail(ERR.NOT_FOUND);

    if (highlight) found.block.highlight = true;
    else delete found.block.highlight;

    return { ok: true, block: found.block };
  }

  /**
   * 设定 / 清除**计划池**里一条条目的高亮：顶层任务 / 顶层块 / 块内任务都认
   * （locatePoolItem 三条路都覆盖）。
   *
   * 为什么池也要有：推迟是「同一个对象搬位置」（见本文件 计划池 段首），
   * 一条在象限里标了黄的任务被推迟之后，如果不认、不画，看着就像高亮丢了。
   */
  function setPoolHighlight(data, poolItemId, highlight) {
    if (typeof poolItemId !== 'string' || !poolItemId) return fail(ERR.NOT_FOUND);

    var located = locatePoolItem(data, poolItemId);
    if (!located) return fail(ERR.NOT_FOUND);

    if (highlight) located.item.highlight = true;
    else delete located.item.highlight;

    return { ok: true, item: located.item };
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
                    completed: stage.completed,
                    bonus: stage.bonus === true,
                    highlight: stage.highlight === true
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
                completed: task.completed,
                bonus: task.bonus === true,
                highlight: task.highlight === true
              });
            }
          }
        }
      }
    }

    var tv = (day && day.tv) ? day.tv : null;
    var out = [];
    for (var m = 0; m < CONFIG.SLOTS.length; m++) {
      var slot = CONFIG.SLOTS[m];
      if (bySlot[slot] && bySlot[slot].length) {
        var items = bySlot[slot];
        // 时间视图顺序记忆（需求 3，v2.5）：有记忆就按记忆排；不在记忆里的
        // 条目（多半是刚新增、刚设了时段的）排在最前 —— 和象限视图
        // 「新任务加在开头」同一条规矩。
        if (tv && Array.isArray(tv[slot]) && tv[slot].length) {
          items = orderByKeys(items, tv[slot]);
        }
        out.push({ slot: slot, items: items });
      }
    }
    return out;
  }

  /** 时间视图条目的顺序键（需求 3）：阶段 = s:任务:阶段，任务 = t:任务 */
  function timeKey(kind, taskId, stageId) {
    return kind === 'stage' ? 's:' + taskId + ':' + stageId : 't:' + taskId;
  }

  /**
   * 按键列表排条目：键列表里有的按它的顺序排，没有的**排最前**（v2.5：
   * 新任务排最前）。稳定排序保证没有键的那些之间仍保持原扫描顺序，
   * 而扫描顺序里新增任务本来就在最前。
   */
  function orderByKeys(items, keys) {
    var rank = {};
    for (var i = 0; i < keys.length; i++) rank[keys[i]] = i;
    var result = items.slice();
    result.sort(function (a, b) {
      var ra = rank[timeKey(a.kind, a.taskId, a.stageId)];
      var rb = rank[timeKey(b.kind, b.taskId, b.stageId)];
      if (ra === undefined) ra = -1;   // 没记忆的排最前
      if (rb === undefined) rb = -1;
      return ra - rb;
    });
    return result;
  }

  /** 重建某时段当前的完整键列表（从 getTimeView 现算，键一定齐全） */
  function buildSlotKeys(data, dateStr, slot) {
    var groups = getTimeView(data, dateStr);
    for (var i = 0; i < groups.length; i++) {
      if (groups[i].slot === slot) {
        var keys = [];
        for (var k = 0; k < groups[i].items.length; k++) {
          var it = groups[i].items[k];
          keys.push(timeKey(it.kind, it.taskId, it.stageId));
        }
        return keys;
      }
    }
    return [];
  }

  /** 把某键从其它时段的顺序记忆里清掉（防跨时段拖拽后留残影） */
  function pruneTimeKey(data, dateStr, key, exceptSlot) {
    var day = data.dates[dateStr];
    if (!day || !day.tv) return;
    for (var s = 0; s < CONFIG.SLOTS.length; s++) {
      var slot = CONFIG.SLOTS[s];
      if (slot === exceptSlot) continue;
      var list = day.tv[slot];
      if (!Array.isArray(list)) continue;
      var idx = list.indexOf(key);
      if (idx !== -1) list.splice(idx, 1);
      if (!list.length) delete day.tv[slot];
    }
  }

  /** 把某时段里的某个键沉到末尾；该时段还没有记忆就先建完整键列表再沉 */
  function sinkTimeKey(data, dateStr, slot, key) {
    if (typeof slot !== 'string' || CONFIG.SLOTS.indexOf(slot) === -1) return;
    var day = data.dates[dateStr];
    if (!day) return;
    if (!day.tv) day.tv = {};

    var list = day.tv[slot];
    if (!Array.isArray(list)) {
      list = buildSlotKeys(data, dateStr, slot); // 完整列表，键一定在里面
    }
    var idx = list.indexOf(key);
    if (idx !== -1) {
      list.splice(idx, 1);
      list.push(key);
    }
    day.tv[slot] = list;
  }

  /**
   * 时间视图里的拖拽落地（需求 3，drag.js → app.js → 这里）。
   *
   * info: { dataKind: 'task'|'stage', taskId, stageId, quadrantId, toSlot, index }
   * index 口径和 moveTask 一致：以「把这条摘出来之后」的列表为准。
   * 跨时段拖拽顺带把 slot 改掉（复用 setSlot / setStageSlot 的校验）。
   */
  function moveTimeViewItem(data, dateStr, info) {
    if (!info) return fail(ERR.NOT_FOUND);
    if (!Util.isValidDateStr(dateStr)) return fail(ERR.BAD_DATE);
    if (info.dataKind !== 'task' && info.dataKind !== 'stage') return fail(ERR.NOT_FOUND);
    if (typeof info.toSlot !== 'string' || CONFIG.SLOTS.indexOf(info.toSlot) === -1) {
      return fail(ERR.BAD_SLOT);
    }
    if (CONFIG.QUADRANT_IDS.indexOf(info.quadrantId) === -1) return fail(ERR.BAD_QUADRANT);

    var located = locateTask(data, dateStr, info.quadrantId, info.taskId);
    if (!located) return fail(ERR.NOT_FOUND);

    var key;
    if (info.dataKind === 'stage') {
      var found = findStage(located.task, info.stageId);
      if (!found) return fail(ERR.NOT_FOUND);
      key = timeKey('stage', info.taskId, info.stageId);
    } else {
      key = timeKey('task', info.taskId, null);
    }

    // 跨时段：先改 slot（复用既有校验与错误码）
    if (info.dataKind === 'stage') {
      var set = setStageSlot(data, dateStr, info.quadrantId, info.taskId, info.stageId, info.toSlot);
      if (!set.ok) return set;
    } else {
      var set2 = setSlot(data, dateStr, info.quadrantId, info.taskId, info.toSlot);
      if (!set2.ok) return set2;
    }

    var day = Store.ensureDay(data, dateStr);

    // 重建目标时段的完整键列表（此刻已含刚改完 slot 的这条），摘出再插回
    var keys = buildSlotKeys(data, dateStr, info.toSlot);
    var from = keys.indexOf(key);
    if (from !== -1) keys.splice(from, 1);

    var idx = clampIndex(info.index, keys.length);
    keys.splice(idx, 0, key);

    if (!day.tv) day.tv = {};
    day.tv[info.toSlot] = keys;
    pruneTimeKey(data, dateStr, key, info.toSlot);

    return { ok: true, slot: info.toSlot, index: idx, key: key };
  }

  // -------------------------------------------------------------------------
  // 完成沉底（需求 6）：任务勾选完成后自动排到同组最后（数据搬移，非渲染排序，
  // 见 DS 2.18 / D-46）。阶段不沉底；块本体不沉底；取消勾选不自动移回。
  // -------------------------------------------------------------------------

  /**
   * 把某条任务移到它所在列表（顶层象限列表或块内 tasks）的末尾，
   * 并同步把时间视图里对应时段的键沉底（无阶段任务才有时段键）。
   */
  function sendCompletedToEnd(data, dateStr, quadrantId, found) {
    if (!found || !found.task) return;

    var list;
    if (found.blockId) {
      var host = findBlock(data, dateStr, quadrantId, found.blockId);
      if (!host) return;
      list = blockTasks(host.block);
    } else {
      var qList = data.dates[dateStr] && data.dates[dateStr][quadrantId];
      if (!Array.isArray(qList)) return;
      list = qList;
    }

    var idx = list.indexOf(found.task);
    if (idx === -1 || idx === list.length - 1) return; // 找不到或已在最后
    list.splice(idx, 1);
    list.push(found.task);

    if (!stagesOf(found.task).length && found.task.slot) {
      sinkTimeKey(data, dateStr, found.task.slot, 't:' + found.task.id);
    }
  }

  /**
   * 把池里的一条任务放回某个象限。池内**块里的任务**也能放回 ——
   * 界面上它就是一条可拖的池条目，拖回时从宿主块里摘出来，宿主块完成度重算
   * （和 removePoolItem / postponeTask 穿透块是同一条规矩）。
   *
   * toIndex 口径和 moveTask 一致（以插入后的合法下标为准，越界夹紧）：
   * 拖拽回来时带上占位符承诺的位置；不带 toIndex 就排末尾 —— 回象限是按
   * 占位符落位，不走 addTask 的「加在开头」。
   *
   * `toBlockId`（requirements 拖拽互通第 3 条）：落进那个**象限块**的块内列表，
   * 而不是象限顶层。池里的任务拖进象限的块里是这个入口；块本体（`type:'block'`）
   * 仍只能落顶层 —— 块里不许套块（规矩 1），落进块时目标块完成度重算。
   */
  function restoreFromPool(data, dateStr, quadrantId, poolItemId, toIndex, toBlockId) {
    var bad = checkTarget(dateStr, quadrantId);
    if (bad) return fail(bad);

    var found = locatePoolItem(data, poolItemId);
    if (!found) return fail(ERR.NOT_FOUND);

    var dstBlock = null;
    if (toBlockId) {
      var blockFound = findBlockAnywhere(data, dateStr, toBlockId);
      if (!blockFound) return fail(ERR.NOT_FOUND);
      if (found.item.type === 'block') return fail(ERR.NOT_FOUND);
      dstBlock = blockFound.block;
    }

    detachPoolItem(data, found);

    var target = dstBlock
      ? blockTasks(dstBlock)
      : Store.ensureDay(data, dateStr)[quadrantId];
    var idx = clampIndex(toIndex, target.length);
    target.splice(idx, 0, found.item);
    if (dstBlock) syncBlockCompleted(dstBlock);
    return { ok: true, task: found.item, quadrantId: quadrantId, index: idx };
  }

  /**
   * 从池里删除一条。顶层任务 / 顶层块（连块内任务一起）/ 块内任务都能删；
   * 块内任务删掉后宿主块重算一次完成状态。和象限里的删除一样：直接删，没有回收站。
   */
  function removePoolItem(data, poolItemId) {
    var found = locatePoolItem(data, poolItemId);
    if (!found) return fail(ERR.NOT_FOUND);

    detachPoolItem(data, found);
    return { ok: true, task: found.item };
  }

  /** 改池内任务的文字。改空拒绝、原文保留（和 D-31 同一条规矩）；块内任务也能改 */
  function editPoolItem(data, poolItemId, text) {
    var found = locatePoolItem(data, poolItemId);
    if (!found) return fail(ERR.NOT_FOUND);

    var clean = Util.cleanText(text);
    if (!clean) return fail(ERR.EMPTY_TEXT);

    found.item.text = clean;
    return { ok: true, task: found.item };
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
        if (src.stages[i].bonus === true) stage.bonus = true;
        if (src.stages[i].highlight === true) stage.highlight = true;
        task.stages.push(stage);
      }
    }
    if (src.slot) task.slot = src.slot;
    if (src.plannedDate) task.plannedDate = src.plannedDate;
    // Bonus 是「最细单位」的属性：无阶段任务本体才有；带阶段任务本体忽略
    if (src.bonus === true && !task.stages) task.bonus = true;
    // 高亮照抄，但**不跟 stages 挂钩**：双击的是任务行那段文字，
    // 阶段在下面单独一块 —— 带阶段的任务本体照样可以标黄（见 DS 2.40）
    if (src.highlight === true) task.highlight = true;
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
      // 块头的高亮照抄（高亮不传染：块内任务各自的 highlight 在上面各走各的）
      if (src.highlight === true) block.highlight = true;
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
    var bonusCount = 0;
    var bonusDone = 0;

    for (var i = 0; i < CONFIG.QUADRANT_IDS.length; i++) {
      var list = day[CONFIG.QUADRANT_IDS[i]];
      for (var k = 0; k < list.length; k++) {
        // progressOfItem：任务算自己（有阶段算阶段），块算它内部的最细单位，
        // 块这个壳自身不占一条（见 DS 2.10 统计口径）
        var progress = progressOfItem(list[k]);
        total += progress.total;
        done += progress.done;
        bonusCount += progress.bonusCount || 0;
        bonusDone += progress.bonusDone || 0;
      }
    }

    // 完成率（需求 2）：分母只计非 Bonus（total），分子计全部（done，含 Bonus），
    // 所以可超过 100%；全 Bonus（total===0）退化为「已完成 Bonus / 全部 Bonus」；
    // 一条都没有时 null（交给渲染显示「—」）。
    var den = total > 0 ? total : bonusCount;
    return {
      done: done,
      total: total,
      bonusCount: bonusCount,
      bonusDone: bonusDone,
      remaining: total - (done - bonusDone),
      rate: den === 0 ? null : done / den
    };
  }

  // -------------------------------------------------------------------------
  // 搜索过滤（需求 3）：纯只读变换，过滤的是「画出来的那份」，数据一个字不动
  // -------------------------------------------------------------------------

  /** 关键词命中：小写化后做子串匹配（空关键词由调用方拦掉，这里不兜） */
  function keywordHit(text, kw) {
    return String(text || '').toLowerCase().indexOf(kw) !== -1;
  }

  /** 一条任务是否命中：任务文字命中，或任一阶段文字命中（阶段命中要保住宿主任务） */
  function taskHitsKeyword(task, kw) {
    if (keywordHit(task && task.text, kw)) return true;
    var stages = stagesOf(task);
    for (var i = 0; i < stages.length; i++) {
      if (keywordHit(stages[i].text, kw)) return true;
    }
    return false;
  }

  /**
   * 按关键词过滤一天的四象限内容（需求 3）。
   *
   * 返回一份**新对象**（不改动传入的 day）：
   *   - 普通任务：命中才留下（任务文字或任一阶段文字命中）；
   *   - 任务块：块名命中 → 整块连所有子任务留下；
   *             块名不中、有子任务命中 → 留下只含命中子任务的块副本；
   *             都不中 → 整个块消失。
   * 没命中的象限就是空数组 —— 渲染出来就是那个象限的空白态。
   */
  function filterDayByKeyword(day, keyword) {
    var out = { I: [], II: [], III: [], IV: [] };
    if (!day) return out;

    var kw = String(keyword || '').trim().toLowerCase();
    var quadIds = ['I', 'II', 'III', 'IV'];
    if (!kw) {
      // 空关键词 = 不过滤，浅拷贝一份返回（调用方拿到的始终是新对象）
      for (var q0 = 0; q0 < quadIds.length; q0++) {
        var src0 = day[quadIds[q0]];
        out[quadIds[q0]] = Array.isArray(src0) ? src0.slice() : [];
      }
      return out;
    }

    for (var qi = 0; qi < quadIds.length; qi++) {
      var list = Array.isArray(day[quadIds[qi]]) ? day[quadIds[qi]] : [];
      for (var i = 0; i < list.length; i++) {
        var item = list[i];
        if (isBlock(item)) {
          if (keywordHit(item.text, kw)) {
            out[quadIds[qi]].push(item);   // 块名命中：整块保留（共享引用，只读展示）
            continue;
          }
          var kids = [];
          var tasks = blockTasks(item);
          for (var k = 0; k < tasks.length; k++) {
            if (taskHitsKeyword(tasks[k], kw)) kids.push(tasks[k]);
          }
          if (kids.length) {
            // 只留命中子任务的块副本 —— 不能改原块，过滤只是「画的时候少画」
            var copy = {
              id: item.id,
              type: 'block',
              text: item.text,
              completed: item.completed,
              createdAt: item.createdAt,
              tasks: kids
            };
            // 副本是逐字段挑的（不是浅拷贝），可选的显示类字段要自己带上，
            // 否则一进搜索模式块头的高亮就没了（见 DS 2.40）
            if (item.highlight === true) copy.highlight = true;
            out[quadIds[qi]].push(copy);
          }
        } else if (taskHitsKeyword(item, kw)) {
          out[quadIds[qi]].push(item);
        }
      }
    }
    return out;
  }

  /**
   * 按关键词过滤时间视图分组（需求 3）。
   * 组（时段块）全部保留，只是组内只留下命中的条目 ——
   * 没命中的时段块显示空白，和象限「没命中的象限显示空白」同一条约定。
   * 条目命中看条目文字；阶段条目顺带看它所属任务的标注文字（parentText）。
   */
  function filterTimeViewByKeyword(groups, keyword) {
    var kw = String(keyword || '').trim().toLowerCase();
    if (!kw) return groups;

    var out = [];
    var list = Array.isArray(groups) ? groups : [];
    for (var i = 0; i < list.length; i++) {
      var items = [];
      var src = Array.isArray(list[i].items) ? list[i].items : [];
      for (var k = 0; k < src.length; k++) {
        if (keywordHit(src[k].text, kw) || keywordHit(src[k].parentText, kw)) {
          items.push(src[k]);
        }
      }
      out.push({ slot: list[i].slot, items: items });
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // 阅读栏（v2.8 需求 2，见 DS 2.37）
  // -------------------------------------------------------------------------

  /**
   * 拿到阅读栏那张表，缺了就补上。
   *
   * 读老数据 / 导入老 JSON 时 reading 字段可能不存在（normalize 会补，但
   * 直接拿着手写对象调数据层的测试和上层调用不一定走 normalize），
   * 所以每个写函数进门都先过这一道，不在别处假设它一定在。
   */
  function ensureReading(data) {
    if (!data.reading || typeof data.reading !== 'object') {
      data.reading = { active: [], done: [] };
    }
    if (!Array.isArray(data.reading.active)) data.reading.active = [];
    if (!Array.isArray(data.reading.done)) data.reading.done = [];
    return data.reading;
  }

  /**
   * 按 id 找一条阅读条目，返回 { item, list, done }。
   * done 标记它在「已读完成」那张表里 —— 取消完成时要靠它决定搬回哪边。
   */
  function findReadingItem(data, readingItemId) {
    var reading = ensureReading(data);
    var tables = [['active', false], ['done', true]];
    for (var t = 0; t < tables.length; t++) {
      var list = reading[tables[t][0]];
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === readingItemId) {
          return { item: list[i], list: list, done: tables[t][1] };
        }
      }
    }
    return null;
  }

  /**
   * 往「正在阅读」加一条。
   *
   * startDate 不传 / 非法 → 取**今天**（需求「可以自己设置起始时间」，没设时
   * 按「今天开始读」算，总比留一个空着好看）。文本去空白后为空就拒绝 ——
   * 和任务同一条规矩。
   *
   * 时间是**日期**不是时分（需求：阅读板块的时间指的是日期），只收
   * 'YYYY-MM-DD'；老数据里的 'HH:MM' 由清洗层兜着（见 Util.isValidReadingStamp），
   * 写操作不放宽。
   */
  function addReadingItem(data, text, startDate) {
    var name = Util.cleanText(text);
    if (!name) return fail(ERR.EMPTY_TEXT);

    if (startDate !== undefined && startDate !== null && startDate !== '' &&
        !Util.isValidDateStr(startDate)) {
      return fail(ERR.BAD_DATE);
    }

    var item = {
      id: Util.genId(),
      text: name,
      start: Util.isValidDateStr(startDate) ? startDate : Util.todayStr(),
      doneAt: null,
      createdAt: Date.now()
    };
    ensureReading(data).active.push(item);
    return { ok: true, item: item };
  }

  /** 改书名 / 事项名（改空了拒绝，保留原名 —— 和任务同款） */
  function editReadingItem(data, readingItemId, text) {
    var found = findReadingItem(data, readingItemId);
    if (!found) return fail(ERR.NOT_FOUND);

    var name = Util.cleanText(text);
    if (!name) return fail(ERR.EMPTY_TEXT);

    found.item.text = name;
    return { ok: true, item: found.item };
  }

  /**
   * 设 / 改起始日期。传空 = 清成「未设定」（null，不是空串）。
   * 正在阅读和已读完成两边都能改 —— 需求里明确写了下方（已完成）也能改。
   */
  function setReadingStart(data, readingItemId, dateStr) {
    var found = findReadingItem(data, readingItemId);
    if (!found) return fail(ERR.NOT_FOUND);

    if (dateStr === null || dateStr === undefined || dateStr === '') {
      found.item.start = null;
      return { ok: true, item: found.item };
    }
    if (!Util.isValidDateStr(dateStr)) return fail(ERR.BAD_DATE);

    found.item.start = dateStr;
    return { ok: true, item: found.item };
  }

  function removeReadingItem(data, readingItemId) {
    var found = findReadingItem(data, readingItemId);
    if (!found) return fail(ERR.NOT_FOUND);

    found.list.splice(found.list.indexOf(found.item), 1);
    return { ok: true };
  }

  /**
   * 勾完成：从「正在阅读」搬到「已读完成」的**开头**。
   *
   * doneDate 不传就取**今天**（需求「点击完成之后自动在下方已读完成的内容项上
   * 显示完成时间」）。搬完**不删 start** —— 行上要显示「2026-10-06 → 2026-10-09」，
   * 起始日期是这条记录的一部分，跟池里勾完保留 DDL 同理。
   *
   * 已经在已完成表里再勾一次：不重复搬，只把 doneAt 更新成传进来的值
   * （补日期用），条目位置不动。
   */
  function completeReadingItem(data, readingItemId, doneDate) {
    var found = findReadingItem(data, readingItemId);
    if (!found) return fail(ERR.NOT_FOUND);

    if (doneDate !== undefined && doneDate !== null && doneDate !== '' &&
        !Util.isValidDateStr(doneDate)) {
      return fail(ERR.BAD_DATE);
    }
    var stamp = Util.isValidDateStr(doneDate) ? doneDate : Util.todayStr();

    if (found.done) {
      found.item.doneAt = stamp;
      return { ok: true, item: found.item };
    }

    var reading = ensureReading(data);
    found.list.splice(found.list.indexOf(found.item), 1);
    found.item.doneAt = stamp;
    // 插到开头：刚读完的排最前，一眼看得见（和「新增排在开头」同一条规矩）
    reading.done.unshift(found.item);
    return { ok: true, item: found.item };
  }

  /**
   * 取消完成：搬回「正在阅读」（需求没写，但点错了没有退路是硬伤，见 D-65）。
   * 落回正在阅读表的**开头**，doneAt 清掉（它已经不在已完成表里了，
   * 留着只会和所在表矛盾 —— normalizeReading 也会把它抹掉）。
   */
  function restoreReadingItem(data, readingItemId) {
    var found = findReadingItem(data, readingItemId);
    if (!found) return fail(ERR.NOT_FOUND);
    if (!found.done) return { ok: true, item: found.item };   // 本来就在读，什么都不做

    var reading = ensureReading(data);
    found.list.splice(found.list.indexOf(found.item), 1);
    found.item.doneAt = null;
    reading.active.unshift(found.item);
    return { ok: true, item: found.item };
  }

  /**
   * 阅读栏的计数与「超过 3 项」提示（需求「提示不超过3项」，见 D-64）。
   *
   * 只报数、不做拦截：over 为 true 时界面上标一句，加还是照样能加。
   */
  function getReadingStats(data) {
    var reading = ensureReading(data);
    var limit = CONFIG.READING_ACTIVE_HINT;
    return {
      active: reading.active.length,
      done: reading.done.length,
      limit: limit,
      over: reading.active.length > limit
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

    // 计划池（DS 2.11 + 需求 4 的任务块 / 逐条 DDL）
    postponeTask: postponeTask,
    postponeStage: postponeStage,
    postponeBlock: postponeBlock,
    restoreFromPool: restoreFromPool,
    removePoolItem: removePoolItem,
    editPoolItem: editPoolItem,
    setPoolDate: setPoolDate,
    addPoolItem: addPoolItem,
    addPoolBlock: addPoolBlock,
    addPoolBlockTask: addPoolBlockTask,
    findPoolItem: findPoolItem,
    findPoolBlock: findPoolBlock,
    locatePoolItem: locatePoolItem,
    // 象限 ↔ 计划池 双向拖拽（requirements 拖拽互通第 3 条）
    moveTaskToPool: moveTaskToPool,
    moveBlockToPool: moveBlockToPool,
    movePoolItemTo: movePoolItemTo,
    // 池内排序与到期自动导入（v2.6 需求 1 / 需求 3）
    movePoolItem: movePoolItem,
    poolItemDueDate: poolItemDueDate,
    autoImportDuePoolItems: autoImportDuePoolItems,
    // 池内勾选与沉底（v2.7 需求 1：池内块对齐象限）
    togglePoolItem: togglePoolItem,
    togglePoolBlock: togglePoolBlock,

    // 完成时段（DS 2.12）
    setSlot: setSlot,
    setStageSlot: setStageSlot,

    // Bonus（需求 2）
    setBonus: setBonus,
    setStageBonus: setStageBonus,

    // 高亮（requirements 最新一条，见 DS 2.40）
    setHighlight: setHighlight,
    setStageHighlight: setStageHighlight,
    setBlockHighlight: setBlockHighlight,
    setPoolHighlight: setPoolHighlight,

    // 时间视图（DS 2.13 + 需求 3）
    getTimeView: getTimeView,
    moveTimeViewItem: moveTimeViewItem,

    // 模板（DS 2.14）
    saveDayAsTemplate: saveDayAsTemplate,
    renameTemplate: renameTemplate,
    removeTemplate: removeTemplate,
    applyTemplate: applyTemplate,
    findTemplate: findTemplate,

    // 阅读栏（v2.8 需求 2）
    ensureReading: ensureReading,
    findReadingItem: findReadingItem,
    addReadingItem: addReadingItem,
    editReadingItem: editReadingItem,
    setReadingStart: setReadingStart,
    removeReadingItem: removeReadingItem,
    completeReadingItem: completeReadingItem,
    restoreReadingItem: restoreReadingItem,
    getReadingStats: getReadingStats,

    // 阶段
    stagesOf: stagesOf,
    getProgress: getProgress,
    addStage: addStage,
    editStage: editStage,
    toggleStage: toggleStage,
    removeStage: removeStage,
    moveStage: moveStage,
    setAllStages: setAllStages,

    getStats: getStats,

    // 搜索过滤（需求 3，只读变换）
    filterDayByKeyword: filterDayByKeyword,
    filterTimeViewByKeyword: filterTimeViewByKeyword
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
