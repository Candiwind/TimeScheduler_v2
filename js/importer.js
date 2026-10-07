/**
 * importer.js —— 导入 JSON 文件，检查格式、去掉重复
 *
 * 加载顺序：第 12 个（见 DS 1.4）。
 *
 * 按 DS 1.7 规矩二，本文件是**纯算逻辑**：不准出现 window / document，
 * 所以整条「读文件 → 检查 → 合并」的链路都能在 Node 里测。
 * 真正读磁盘上的文件由 app.js 负责（那是浏览器的事）。
 *
 * ────────────────────────────────────────────────────────────────────────
 * 这里的检查比 store.js 严格得多，这不是重复劳动
 *
 * `store.js` 读的是**我们自己写进去的数据**，所以它走「尽量救」路线：
 * 字段缺了补上，条目坏了单独丢掉，能救几条是几条。
 *
 * 而导入面对的是**来路不明的文件**：手工改过的、别的版本导出的、甚至根本不是
 * 我们程序的 JSON。这种数据不能拿去「救」——补出来的东西没人能保证是对的。
 * 所以这里走「**一个地方不对就整份拒绝**」，原数据一个字节都不动。
 */
var Importer = (function (CONFIG, Util, Store) {
  'use strict';

  /** 错误码。文案由 app.js 统一翻译（见 DS 4.3） */
  var ERR = {
    NOT_JSON: 'NOT_JSON',           // 内容不是合法的 JSON
    NOT_OBJECT: 'NOT_OBJECT',       // 顶层不是个对象
    NO_DATES: 'NO_DATES',           // 缺少 dates
    BAD_DATE: 'BAD_DATE',           // 日期格式不对
    BAD_DAY: 'BAD_DAY',             // 某一天不是一个对象
    MISSING_QUADRANT: 'MISSING_QUADRANT', // 缺象限键
    BAD_QUADRANT: 'BAD_QUADRANT',   // 象限不是一个数组
    BAD_TASK: 'BAD_TASK',           // 某条任务不合法
    BAD_STAGE: 'BAD_STAGE',         // 某个阶段不合法
    BAD_BLOCK: 'BAD_BLOCK',         // 某个任务块不合法（含块里套块）
    BAD_POOL: 'BAD_POOL',           // 计划池不合法（不是列表 / 里面有块或坏任务）
    BAD_TEMPLATE: 'BAD_TEMPLATE',   // 模板不合法（不是列表 / 没名字 / items 不合法）
    BAD_READING: 'BAD_READING'      // 阅读栏不合法（不是对象 / active / done 不是列表 / 条目没名字）
  };

  var ERR_TEXT = {};
  ERR_TEXT[ERR.NOT_JSON] = '文件内容不是合法的 JSON。';
  ERR_TEXT[ERR.NOT_OBJECT] = '文件里不是一个数据对象。';
  ERR_TEXT[ERR.NO_DATES] = '文件里缺少 dates 这一层。';
  ERR_TEXT[ERR.BAD_DATE] = '文件里的日期格式不对。';
  ERR_TEXT[ERR.BAD_DAY] = '文件里某一天的数据不是一个对象。';
  ERR_TEXT[ERR.MISSING_QUADRANT] = '文件里缺少象限列表。';
  ERR_TEXT[ERR.BAD_QUADRANT] = '文件里某个象限不是一个列表。';
  ERR_TEXT[ERR.BAD_TASK] = '文件里某条任务的内容不合法。';
  ERR_TEXT[ERR.BAD_STAGE] = '文件里某个阶段的内容不合法。';
  ERR_TEXT[ERR.BAD_BLOCK] = '文件里某个任务块的内容不合法。';
  ERR_TEXT[ERR.BAD_POOL] = '文件里计划池的内容不合法。';
  ERR_TEXT[ERR.BAD_TEMPLATE] = '文件里模板的内容不合法。';
  ERR_TEXT[ERR.BAD_READING] = '文件里阅读栏的内容不合法。';

  function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  function fail(error, detail) {
    return {
      ok: false,
      error: error,
      // 给用户看的说明：只说人话，附上「哪里不对」，别让用户自己去猜
      message: ERR_TEXT[error] + (detail ? '（' + detail + '）' : '')
    };
  }

  /**
   * 检查一个**可选**的日期字段（阅读栏的起始 / 完成日期，v2.8）。
   * 没有 / 空串 = 没设（回 null）；有但不合法 → 拒绝，不猜也不静默丢掉。
   *
   * 走的是宽松版 `isValidReadingStamp`：v2.8 初版存的是 'HH:MM'，用户手里
   * 那样的文件必须还能导进来，否则「兼容前面版本导出的 JSON」就破了。
   */
  function readOptionalStamp(value, where) {
    if (value === undefined || value === null || value === '') {
      return { ok: true, stamp: null };
    }
    if (!Util.isValidReadingStamp(value)) {
      return { ok: false, fail: fail(ERR.BAD_READING, where + '不是 YYYY-MM-DD') };
    }
    return { ok: true, stamp: value };
  }

  // -------------------------------------------------------------------------
  // 检查
  // -------------------------------------------------------------------------

  /**
   * 检查一条任务（严格）。通过返回 { ok:true, task }，
   * 不过返回 { ok:false, fail } —— fail 是能给用户的完整失败结果。
   * where 是位置描述，比如「2026-10-01 的「Q1」第 3 条」，报错要说得出哪儿坏了。
   */
  function checkTask(rawTask, where) {
    if (!isPlainObject(rawTask) || !Util.isValidTaskText(rawTask.text)) {
      return { ok: false, fail: fail(ERR.BAD_TASK, where) };
    }

    // 阶段是**可选**的：加阶段之前导出的文件里全都没有这个字段，
    // 它们必须能照常导进来。所以「没有」是合法的，「有但不合法」才拒绝。
    var stages = null;
    if (rawTask.stages !== undefined && rawTask.stages !== null) {
      if (!Array.isArray(rawTask.stages)) {
        return { ok: false,
          fail: fail(ERR.BAD_STAGE, where + '任务的阶段不是一个列表') };
      }

      stages = [];
      for (var s = 0; s < rawTask.stages.length; s++) {
        var rawStage = rawTask.stages[s];
        if (!isPlainObject(rawStage) || !Util.isValidTaskText(rawStage.text)) {
          return { ok: false,
            fail: fail(ERR.BAD_STAGE, where + '任务里，第 ' + (s + 1) + ' 个阶段不合法') };
        }
        stages.push({
          text: Util.cleanText(rawStage.text),
          completed: rawStage.completed === true,
          // slot（DS 2.12）可选：六值之内保留，不合法丢字段
          slot: (typeof rawStage.slot === 'string' &&
                 CONFIG.SLOTS.indexOf(rawStage.slot) !== -1)
            ? rawStage.slot
            : null,
          // Bonus（需求 2）：只认 === true，别的都当普通
          bonus: rawStage.bonus === true ? true : null,
          // 高亮（DS 2.40）：同 bonus，只认 === true
          highlight: rawStage.highlight === true ? true : null
        });
      }
      if (!stages.length) stages = null;
    }

    return {
      ok: true,
      task: {
        text: Util.cleanText(rawTask.text),
        // 勾选状态照抄 —— 这一条最后会不会被采纳，取决于它是不是重复的
        completed: rawTask.completed === true,
        createdAt: (typeof rawTask.createdAt === 'number' && isFinite(rawTask.createdAt))
          ? rawTask.createdAt
          : null,
        // null 表示「这条任务没有阶段」，不是「有零个阶段」
        stages: stages,
        // plannedDate（DS 2.11 二期）是**可选**字段：没有是合法的（老备份），
        // 格式不对丢字段不拒整份 —— 时间是附加信息，不该拦住任务本身
        plannedDate: (typeof rawTask.plannedDate === 'string' &&
                      Util.isValidDateStr(rawTask.plannedDate))
          ? rawTask.plannedDate
          : null,
        // slot（DS 2.12）同一条取舍：六值之内保留，不合法丢字段
        slot: (typeof rawTask.slot === 'string' &&
               CONFIG.SLOTS.indexOf(rawTask.slot) !== -1)
          ? rawTask.slot
          : null,
        // Bonus（需求 2）：只认 === true，别的都当普通
        bonus: rawTask.bonus === true ? true : null,
        // 高亮（DS 2.40）：同 bonus，只认 === true；老备份没有这个字段
        // → null，当「没高亮」收下，不拒整份
        highlight: rawTask.highlight === true ? true : null
      }
    };
  }

  /**
   * 检查一个任务块（严格）。块内必须全是普通任务 ——
   * **块里套块直接整份拒绝**（规矩 1，见 DS 2.10）：页面造不出这种数据，
   * 造得出的只有手工改过的文件，收进来渲染层也兜不住。
   */
  function checkBlock(rawBlock, where) {
    if (!isPlainObject(rawBlock) || !Util.isValidTaskText(rawBlock.text)) {
      return { ok: false, fail: fail(ERR.BAD_BLOCK, where) };
    }
    if (!Array.isArray(rawBlock.tasks)) {
      return { ok: false,
        fail: fail(ERR.BAD_BLOCK, where + '（块的任务列表缺失或不是列表）') };
    }

    var label = Util.cleanText(rawBlock.text);
    var children = [];
    for (var i = 0; i < rawBlock.tasks.length; i++) {
      var rawChild = rawBlock.tasks[i];
      var childWhere = where + '里，块「' + label + '」的第 ' + (i + 1) + ' 条';

      if (isPlainObject(rawChild) && rawChild.type === 'block') {
        return { ok: false,
          fail: fail(ERR.BAD_BLOCK, childWhere + '（块里不允许再套块）') };
      }

      var checked = checkTask(rawChild, childWhere);
      if (!checked.ok) return checked;
      children.push(checked.task);
    }

    return {
      ok: true,
      block: {
        type: 'block',
        text: label,
        completed: rawBlock.completed === true,
        createdAt: (typeof rawBlock.createdAt === 'number' && isFinite(rawBlock.createdAt))
          ? rawBlock.createdAt
          : null,
        // 高亮（DS 2.40）：同任务，只认 === true
        highlight: rawBlock.highlight === true ? true : null,
        tasks: children
      }
    };
  }

  /**
   * 严格检查一份文本能不能当数据导进来。
   * 全部通过返回 { ok:true, data }，否则返回 { ok:false, error, message }。
   *
   * **必须一次检查完再决定**：不能边检查边往本地写。中途才发现有问题时，
   * 已经写进去的那部分就留在里面了，本地数据会变成半新半旧（见 DS 2.5）。
   */
  function validate(text) {
    if (typeof text !== 'string' || !text) {
      return fail(ERR.NOT_JSON, '内容是空的');
    }

    var raw;
    try {
      raw = JSON.parse(text);
    } catch (e) {
      return fail(ERR.NOT_JSON);
    }

    if (!isPlainObject(raw)) {
      return fail(ERR.NOT_OBJECT);
    }
    if (!isPlainObject(raw.dates)) {
      return fail(ERR.NO_DATES);
    }

    var dates = {};
    var dateKeys = Object.keys(raw.dates);

    for (var i = 0; i < dateKeys.length; i++) {
      var dateStr = dateKeys[i];

      if (!Util.isValidDateStr(dateStr)) {
        return fail(ERR.BAD_DATE, '出问题的是「' + dateStr + '」');
      }

      var rawDay = raw.dates[dateStr];
      if (!isPlainObject(rawDay)) {
        return fail(ERR.BAD_DAY, '出问题的是「' + dateStr + '」');
      }

      var day = {};
      for (var q = 0; q < CONFIG.QUADRANT_IDS.length; q++) {
        var qid = CONFIG.QUADRANT_IDS[q];

        // 四个象限键必须都在 —— 我们自己导出的文件一定四个都有，
        // 缺了说明这文件不是我们导出的，或者被手工改坏了
        if (!Object.prototype.hasOwnProperty.call(rawDay, qid)) {
          return fail(ERR.MISSING_QUADRANT,
            dateStr + ' 缺「' + qid + '」');
        }
        if (!Array.isArray(rawDay[qid])) {
          return fail(ERR.BAD_QUADRANT,
            dateStr + ' 的「' + qid + '」不是一个列表');
        }

        day[qid] = [];
        for (var k = 0; k < rawDay[qid].length; k++) {
          var rawItem = rawDay[qid][k];
          var where = dateStr + ' 的「' + qid + '」第 ' + (k + 1) + ' 条';

          if (!isPlainObject(rawItem)) {
            return fail(ERR.BAD_TASK, where);
          }

          // 条目分两种：任务块走 checkBlock，普通任务走 checkTask
          if (rawItem.type === 'block') {
            var checkedBlock = checkBlock(rawItem, where);
            if (!checkedBlock.ok) return checkedBlock.fail;
            day[qid].push(checkedBlock.block);
            continue;
          }

          var checkedTask = checkTask(rawItem, where);
          if (!checkedTask.ok) return checkedTask.fail;
          day[qid].push(checkedTask.task);
        }
      }

      dates[dateStr] = day;
    }

    // ---- 计划池（见 DS 2.11）：**可选** —— 加计划池之前导出的文件里
    // 没有这个字段，它们必须能照常导进来。「没有」合法，「有但不合法」才拒绝
    var pool = null;
    if (raw.pool !== undefined && raw.pool !== null) {
      if (!Array.isArray(raw.pool)) {
        return fail(ERR.BAD_POOL, 'pool 不是一个列表');
      }
      pool = [];
      for (var p = 0; p < raw.pool.length; p++) {
        var rawPoolItem = raw.pool[p];
        var poolWhere = '计划池的第 ' + (p + 1) + ' 条';

        // 需求（重命名后 4）：池里可以是任务，也可以是任务块（整体推迟下来的）。
        // 块内仍遵守规矩 1（块里不允许再套块），坏块整份拒绝
        if (isPlainObject(rawPoolItem) && rawPoolItem.type === 'block') {
          var checkedPoolBlock = checkBlock(rawPoolItem, poolWhere);
          if (!checkedPoolBlock.ok) return checkedPoolBlock.fail;
          pool.push(checkedPoolBlock.block);
          continue;
        }

        var checkedPool = checkTask(rawPoolItem, poolWhere);
        if (!checkedPool.ok) return checkedPool.fail;
        pool.push(checkedPool.task);
      }
    }

    // ---- 模板（见 DS 2.14）：**可选** —— 和 pool 同一条规矩，
    // 「没有」合法，「有但不合法」整份拒绝（坏一份整份拒绝，和日期数据同款）
    var templates = null;
    if (raw.templates !== undefined && raw.templates !== null) {
      if (!Array.isArray(raw.templates)) {
        return fail(ERR.BAD_TEMPLATE, 'templates 不是一个列表');
      }
      templates = [];
      for (var ti = 0; ti < raw.templates.length; ti++) {
        var rawTpl = raw.templates[ti];
        var tplWhere = '第 ' + (ti + 1) + ' 份模板';

        if (!isPlainObject(rawTpl) || !Util.cleanText(rawTpl.name)) {
          return fail(ERR.BAD_TEMPLATE, tplWhere + '（没有合法的名字）');
        }
        if (!isPlainObject(rawTpl.items)) {
          return fail(ERR.BAD_TEMPLATE, tplWhere + '（items 缺失或不是一个对象）');
        }

        var tplItems = {};
        for (var tq = 0; tq < CONFIG.QUADRANT_IDS.length; tq++) {
          var tqid = CONFIG.QUADRANT_IDS[tq];
          var tList = rawTpl.items[tqid];
          if (!Array.isArray(tList)) {
            return fail(ERR.BAD_TEMPLATE,
              tplWhere + '（items 缺少「' + tqid + '」象限列表）');
          }
          tplItems[tqid] = [];
          for (var tk = 0; tk < tList.length; tk++) {
            var tItem = tList[tk];
            var tItemWhere = tplWhere + '「' + tqid + '」的第 ' + (tk + 1) + ' 条';
            if (isPlainObject(tItem) && tItem.type === 'block') {
              var checkedTBlock = checkBlock(tItem, tItemWhere);
              if (!checkedTBlock.ok) return checkedTBlock.fail;
              tplItems[tqid].push(checkedTBlock.block);
              continue;
            }
            var checkedTTask = checkTask(tItem, tItemWhere);
            if (!checkedTTask.ok) return checkedTTask.fail;
            tplItems[tqid].push(checkedTTask.task);
          }
        }

        templates.push({
          name: Util.cleanText(rawTpl.name),
          createdAt: typeof rawTpl.createdAt === 'number' && isFinite(rawTpl.createdAt)
            ? rawTpl.createdAt
            : null,
          items: tplItems
        });
      }
    }

    // ---- 阅读栏（v2.8 需求 2）：**可选** —— 和 pool / templates 同一条规矩，
    // 「没有」合法（v2.8 之前导出的文件都没有），「有但不合法」整份拒绝
    var reading = null;
    if (raw.reading !== undefined && raw.reading !== null) {
      if (!isPlainObject(raw.reading)) {
        return fail(ERR.BAD_READING, 'reading 不是一个对象');
      }
      reading = { active: [], done: [] };
      var readingTables = ['active', 'done'];
      for (var rt = 0; rt < readingTables.length; rt++) {
        var tableName = readingTables[rt];
        var rawList = raw.reading[tableName];
        if (rawList === undefined || rawList === null) continue; // 缺一张表当空表
        if (!Array.isArray(rawList)) {
          return fail(ERR.BAD_READING, 'reading.' + tableName + ' 不是一个列表');
        }
        for (var ri = 0; ri < rawList.length; ri++) {
          var rawRead = rawList[ri];
          var readWhere = '阅读栏「' + (tableName === 'active' ? '正在阅读' : '已读完成') +
            '」第 ' + (ri + 1) + ' 条';
          if (!isPlainObject(rawRead) || !Util.isValidTaskText(rawRead.text)) {
            return fail(ERR.BAD_READING, readWhere + '（没有内容）');
          }
          // 日期字段：没有 / 空串当「没设」，有但不合法就拒绝（脏数据不猜）
          var readStart = readOptionalStamp(rawRead.start, readWhere + '的起始日期');
          if (!readStart.ok) return readStart.fail;
          var readDoneAt = readOptionalStamp(rawRead.doneAt, readWhere + '的完成日期');
          if (!readDoneAt.ok) return readDoneAt.fail;

          reading[tableName].push({
            text: Util.cleanText(rawRead.text),
            start: readStart.stamp,
            doneAt: (tableName === 'done') ? readDoneAt.stamp : null,
            createdAt: (typeof rawRead.createdAt === 'number' && isFinite(rawRead.createdAt))
              ? rawRead.createdAt
              : null
          });
        }
      }
    }

    return {
      ok: true,
      data: {
        user: (typeof raw.user === 'string' && raw.user) ? raw.user : CONFIG.USER_ID,
        schemaVersion: (typeof raw.schemaVersion === 'number')
          ? raw.schemaVersion
          : CONFIG.SCHEMA_VERSION,
        dates: dates,
        pool: pool,          // null 表示文件里没有计划池，不是「有零条的池」
        templates: templates, // null 同理：文件里没有模板
        reading: reading     // 同上：文件里没有阅读栏
      }
    };
  }

  // -------------------------------------------------------------------------
  // 合并
  // -------------------------------------------------------------------------

  /**
   * 某一天、某个象限里，是不是已经有一条文本相同的任务。
   *
   * **注意入参：一天一份数据。** 判重的比较范围就是「那一天」，别的日期不参与
   * （见 D-09）。这个函数如果被改成拿整个 dates 去比，10 月 1 号和 10 月 2 号的
   * 同名任务就会被当成同一条——「写日报」这种每天都要做的任务会被吃掉 29 天，
   * 而用户只看到一句「跳过 N 条」，事后根本查不出少了什么。
   */
  function hasSameText(day, quadrantId, text) {
    var list = day ? day[quadrantId] : null;
    if (!Array.isArray(list)) return false;

    for (var i = 0; i < list.length; i++) {
      if (Util.cleanText(list[i].text) === text) return true;
    }
    return false;
  }

  /**
   * 把导入的一条任务深拷贝成本地的新任务。
   * **编号全部换新的** —— 文件里的编号在本地可能撞车（见 D-09）。
   * 阶段跟着一起搬，completed 以阶段为准 —— 文件里那个值可能和阶段对不上。
   * 判断口径走 `Store.allDone`（v2.5）：每个阶段（含 Bonus）都完成才算完成。
   */
  function copyTask(src) {
    var task = {
      id: Util.genId(),
      text: src.text,
      completed: src.completed,
      createdAt: src.createdAt !== null ? src.createdAt : Date.now()
    };

    // 计划池的完成时间跟着文件走（DS 2.11 二期）
    if (src.plannedDate) task.plannedDate = src.plannedDate;

    // 完成时段跟着文件走（DS 2.12）
    if (src.slot) task.slot = src.slot;

    // Bonus 跟着文件走（需求 2）
    if (src.bonus) task.bonus = true;

    // 高亮跟着文件走（DS 2.40）。老板份里 checkTask 给的是 null → 不写字段
    if (src.highlight) task.highlight = true;

    if (src.stages && src.stages.length) {
      task.stages = [];
      for (var s = 0; s < src.stages.length; s++) {
        var stage = src.stages[s];
        var copiedStage = {
          id: Util.genId(),
          text: stage.text,
          completed: stage.completed,
          createdAt: Date.now()
        };
        if (stage.slot) copiedStage.slot = stage.slot;
        if (stage.bonus) copiedStage.bonus = true;
        if (stage.highlight) copiedStage.highlight = true;
        task.stages.push(copiedStage);
      }
      // 口径和 store / task-ops 共用同一份（v2.5）：每个阶段都完成才算完成。
      // 别在这里另写一套 —— 口径一旦分叉，导入进来的 completed 就和界面上的对不上。
      task.completed = Store.allDone(task.stages);
    }

    return task;
  }

  /**
   * 把导入的一个任务块深拷贝成本地的新块。
   * 和 copyTask 同一条规矩：块自己换新 id，块内任务也各换新 id（见 D-09），
   * 完成状态以块内任务为准。
   */
  function copyBlock(src) {
    var srcChildren = Array.isArray(src.tasks) ? src.tasks : [];
    var block = {
      id: Util.genId(),
      type: 'block',
      text: src.text,
      completed: src.completed,
      createdAt: src.createdAt !== null ? src.createdAt : Date.now(),
      tasks: []
    };
    for (var c = 0; c < srcChildren.length; c++) {
      block.tasks.push(copyTask(srcChildren[c]));
    }
    // 块头的高亮跟着文件走（高亮不传染，块内任务各走各的，见 DS 2.40）
    if (src.highlight) block.highlight = true;
    block.completed = Store.blockDone(block.tasks);
    return block;
  }

  /**
   * 本地的计划池里，是不是已经有一条文本相同的任务。
   * 池没有象限和日期可比，判重只能按文本（见 DS 2.11 导入与合并）。
   */
  function poolHasSameText(localData, text) {
    var pool = Array.isArray(localData.pool) ? localData.pool : [];
    for (var i = 0; i < pool.length; i++) {
      if (Util.cleanText(pool[i].text) === text) return true;
    }
    return false;
  }

  /**
   * 把导入的数据**合并**进本地数据，返回 { added, skipped, data }。
   *
   * 合并的含义：本地已有的东西**一条都不会被删掉**。本期不做「用文件替换本地
   * 全部数据」那种模式——用户拿一份不完整的旧备份导进来，就能把本地较新的
   * 数据全部清掉，风险太高（见 DS 2.5）。
   *
   * 判重规则（D-09 / D-16）：**同一天内**，象限和文本都相同就算同一条，跳过；
   * 跳过后**保留本地已有的勾选状态**，不被文件里的状态覆盖。
   * 任务块也是按名字判重 —— 块是不可拆分的整体，块内任务不再单独判重，
   * 不然「合并」就成了把用户的分组拆散。
   */
  function merge(localData, imported) {
    var added = 0;
    var skipped = 0;
    var dateKeys = Object.keys(imported.dates);

    for (var i = 0; i < dateKeys.length; i++) {
      var dateStr = dateKeys[i];
      var incomingDay = imported.dates[dateStr];

      for (var q = 0; q < CONFIG.QUADRANT_IDS.length; q++) {
        var qid = CONFIG.QUADRANT_IDS[q];
        var incoming = incomingDay[qid];

        for (var k = 0; k < incoming.length; k++) {
          var incomingItem = incoming[k];
          var text = incomingItem.text;

          // 对着**当前本地这一天的这一份**比，而不是对着刚打开时的快照比 ——
          // 这样同一个文件里自带的重复条目也会被去掉
          var localDay = localData.dates[dateStr];
          if (hasSameText(localDay, qid, text)) {
            skipped++;
            continue;
          }

          if (incomingItem.type === 'block') {
            // 块整体搬入：块自己换新 id，块内任务也各换新 id（同一个道理，见 D-09）。
            // 这里**改成调 copyBlock**，不再就地重写一遍同形状的块：原先两处
            // 各写各的，加 highlight 时漏了这一处，块的高亮就悄悄丢了
            // （见 DS 2.40 / R-41）。同一个形状只能有一处实现。
            Store.ensureDay(localData, dateStr)[qid].push(copyBlock(incomingItem));
            added++;
            continue;
          }

          Store.ensureDay(localData, dateStr)[qid].push(copyTask(incomingItem));
          added++;
        }
      }
    }

    // ---- 计划池合并（见 DS 2.11）：判重只按文本，跳过的照旧保留本地的。
    // 需求（重命名后 4）：池内条目可能是任务也可能是任务块，各走各的拷贝
    if (Array.isArray(imported.pool)) {
      for (var p = 0; p < imported.pool.length; p++) {
        var incomingPoolItem = imported.pool[p];

        if (poolHasSameText(localData, incomingPoolItem.text)) {
          skipped++;
          continue;
        }

        if (!Array.isArray(localData.pool)) localData.pool = [];
        localData.pool.push(incomingPoolItem.type === 'block'
          ? copyBlock(incomingPoolItem)
          : copyTask(incomingPoolItem));
        added++;
      }
    }

    // 整份都是空的日期不该凭空留在本地（ensureDay 只在真要加东西时才会建）
    // ---- 模板合并（见 DS 2.14）：判重只按**名字**，同名跳过（本地的不动）；
    // 新模板搬入时模板 id 和条目 id 全部换新（同 D-09）
    if (Array.isArray(imported.templates)) {
      if (!Array.isArray(localData.templates)) localData.templates = [];

      for (var t = 0; t < imported.templates.length; t++) {
        var incomingTpl = imported.templates[t];
        var nameDup = false;
        for (var lt = 0; lt < localData.templates.length; lt++) {
          if (Util.cleanText(localData.templates[lt].name) === incomingTpl.name) {
            nameDup = true;
            break;
          }
        }
        if (nameDup) { skipped++; continue; }

        var tpl = {
          id: Util.genId(),
          name: incomingTpl.name,
          createdAt: incomingTpl.createdAt !== null
            ? incomingTpl.createdAt
            : Date.now(),
          items: {}
        };
        for (var mq = 0; mq < CONFIG.QUADRANT_IDS.length; mq++) {
          var mqid = CONFIG.QUADRANT_IDS[mq];
          tpl.items[mqid] = [];
          var srcList = incomingTpl.items[mqid];
          for (var mk = 0; mk < srcList.length; mk++) {
            var srcItem = srcList[mk];
            if (srcItem.type === 'block') {
              // 同样不再就地重写一遍块（理由见上面象限那处）：块这一形状
              // 只有 copyBlock 一处实现，它认得全 highlight / bonus / slot
              tpl.items[mqid].push(copyBlock(srcItem));
              continue;
            }
            tpl.items[mqid].push(copyTask(srcItem));
          }
        }
        localData.templates.push(tpl);
        added++;
      }
    }

    // ---- 阅读栏合并（v2.8 需求 2）：和池同一条规矩 —— 判重只按**文本**，
    // 跳过时保留本地那条（连本地记的起始 / 完成日期一起留着，文件里的不动它）；
    // 新搬进来的换新 id（同 D-09），完成日期照文件里的带过来
    if (imported.reading) {
      if (!localData.reading || typeof localData.reading !== 'object') {
        localData.reading = { active: [], done: [] };
      }
      if (!Array.isArray(localData.reading.active)) localData.reading.active = [];
      if (!Array.isArray(localData.reading.done)) localData.reading.done = [];

      var readingTables = ['active', 'done'];
      for (var rt = 0; rt < readingTables.length; rt++) {
        var tableName = readingTables[rt];
        var incomingList = imported.reading[tableName] || [];
        for (var ri = 0; ri < incomingList.length; ri++) {
          var incomingRead = incomingList[ri];
          var dup = false;
          for (var lr = 0; lr < localData.reading[tableName].length; lr++) {
            if (Util.cleanText(localData.reading[tableName][lr].text) ===
                Util.cleanText(incomingRead.text)) {
              dup = true;
              break;
            }
          }
          if (dup) { skipped++; continue; }

          localData.reading[tableName].push({
            id: Util.genId(),
            text: incomingRead.text,
            start: incomingRead.start || null,
            doneAt: (tableName === 'done') ? (incomingRead.doneAt || null) : null,
            createdAt: incomingRead.createdAt !== null
              ? incomingRead.createdAt
              : Date.now()
          });
          added++;
        }
      }
    }

    return { added: added, skipped: skipped, data: localData };
  }

  /** 一步到位：检查 + 合并。任何一步出问题都原样返回，不动本地数据 */
  function importText(localData, text) {
    var checked = validate(text);
    if (!checked.ok) return checked;

    var result = merge(localData, checked.data);
    return {
      ok: true,
      added: result.added,
      skipped: result.skipped,
      data: result.data
    };
  }

  /**
   * 覆盖导入（需求 2）：用文件内容**整体替换**本地数据。
   *
   * 实现上就是「往一份空数据里做一次合并」—— 判重对着空数据，永远不跳过，
   * 所以进来的东西一条不落地全搬进去；编号照旧全换新（copyTask / copyBlock）。
   * 返回形状和 merge 一致（{ added, skipped, data }），调用方不用另学一套。
   */
  function overwrite(localData, imported) {
    var empty = {
      user: imported.user,
      schemaVersion: imported.schemaVersion,
      dates: {},
      pool: [],
      templates: [],
      reading: { active: [], done: [] }
    };
    return merge(empty, imported);
  }

  return {
    ERR: ERR,
    ERR_TEXT: ERR_TEXT,
    validate: validate,
    merge: merge,
    overwrite: overwrite,
    importText: importText,
    hasSameText: hasSameText
  };
})(
  typeof CONFIG !== 'undefined' ? CONFIG : require('./config.js'),
  typeof Util !== 'undefined' ? Util : require('./util.js'),
  typeof Store !== 'undefined' ? Store : require('./store.js')
);

// Node 测试环境用（浏览器里没有 module，这段不会执行）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Importer;
}
