/**
 * store.js —— 唯一的数据出入口（见 DS 1.7 规矩一）
 *
 * 任何文件都不准自己去碰 localStorage 或 Capacitor 的存储插件，
 * 需要读写数据就调这里的函数。
 *
 * ────────────────────────────────────────────────────────────────────────
 * 设计要点一：存储后端是**注入**进来的
 *
 * 按 DS 1.7 规矩二，本文件里不准出现 window / document，否则就没法在
 * Node 里跑测试。所以这里不直接写 window.localStorage，而是由 app.js
 * 在初始化时把后端塞进来：
 *
 *     Store.init({ storage: 浏览器适配器, durable: 安卓Preferences适配器 })
 *
 * 测试里塞一个内存版（test/harness.js 的 createMemoryStorage）就能跑。
 *
 * ────────────────────────────────────────────────────────────────────────
 * 设计要点二：durable 是个**同步**接口
 *
 * 安卓的 Capacitor Preferences 是异步的，但本文件通篇是同步的。做法是：
 * 由 app.js 在启动时先把 Preferences 里的东西一次性读进内存，包成一个
 * 同步的壳再传进来。异步只留在最外层（app.js），核心逻辑保持同步、可测。
 */
var Store = (function (CONFIG, Util) {
  'use strict';

  var storage = null;   // 主存储。必须有 getItem / setItem / removeItem
  var durable = null;   // 安卓那份额外副本，可以没有（网页版就是 null）
  var clock = function () { return Date.now(); };

  var lastBackupAt = 0;      // 上次轮转备份的时刻（限流用）
  var durableDirty = null;   // 待写入 durable 的数据（攒 3 秒用）
  var protectionMode = false; // 保护模式：禁止一切写入（DS 2.4）

  // -------------------------------------------------------------------------
  // 初始化
  // -------------------------------------------------------------------------

  function init(options) {
    options = options || {};
    if (!options.storage) {
      throw new Error('Store.init 必须传入 storage');
    }
    storage = options.storage;
    durable = options.durable || null;
    clock = options.clock || function () { return Date.now(); };
    lastBackupAt = 0;
    durableDirty = null;
    protectionMode = false;
    return Store;
  }

  /** 是否处于保护模式（见 DS 2.4） */
  function isProtectionMode() {
    return protectionMode;
  }

  /**
   * 退出保护模式。只有用户明确做出选择之后才该被调用
   * （点了「从云端恢复」或者「用空数据重新开始」）。
   */
  function exitProtectionMode() {
    protectionMode = false;
  }

  // -------------------------------------------------------------------------
  // 数据结构
  // -------------------------------------------------------------------------

  /** 建一份空数据 */
  function createEmpty() {
    return {
      user: CONFIG.USER_ID,
      schemaVersion: CONFIG.SCHEMA_VERSION,
      dates: {},
      // 计划池（见 DS 2.11）：与 dates 平级的全局列表，不按日期分。
      // 老数据没有这个字段，normalize 读入时会补上
      pool: [],
      // 模板（见 DS 2.14）：同 pool 平级的全局列表。老数据没有 → normalize 补空
      templates: [],
      // 阅读栏（v2.8 需求 2，见 DS 2.37）：同 pool / templates 平级的全局结构，
      // 分「正在阅读」和「已读完成」两张表。老数据没有 → normalize 补空
      reading: { active: [], done: [] }
    };
  }

  /** 该日期的四个象限都是空列表 */
  function emptyDay() {
    var day = {};
    for (var i = 0; i < CONFIG.QUADRANT_IDS.length; i++) {
      day[CONFIG.QUADRANT_IDS[i]] = [];
    }
    return day;
  }

  function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  /** 一个阶段。整理不了就返回 null（当脏数据丢掉） */
  function normalizeStage(raw) {
    if (!isPlainObject(raw)) return null;

    var text = Util.cleanText(raw.text);
    if (!text) return null;

    var stage = {
      id: typeof raw.id === 'string' && raw.id ? raw.id : Util.genId(),
      text: text,
      completed: raw.completed === true,
      createdAt: typeof raw.createdAt === 'number' && isFinite(raw.createdAt)
        ? raw.createdAt
        : clock()
    };

    // slot（完成时段，DS 2.12）是**可选**字段：六值之内保留，
    // 不合法丢字段不丢阶段（和 plannedDate 同一条取舍）
    if (typeof raw.slot === 'string' && CONFIG.SLOTS.indexOf(raw.slot) !== -1) {
      stage.slot = raw.slot;
    }

    // bonus（需求 2）是**可选**布尔字段：只有 === true 才置 true，
    // 其余一律视为普通项（不引入脏字段）
    if (raw.bonus === true) {
      stage.bonus = true;
    }

    // highlight（高亮，见 DS 2.40）同 bonus：可选布尔，只有 === true 才置 true。
    // 加这个字段之前导出的备份里没有它，读进来就是「没高亮」，不用补默认值
    if (raw.highlight === true) {
      stage.highlight = true;
    }

    return stage;
  }

  /**
   * 一堆单位是不是「全完成」（与 task-ops.getProgress 的 isComplete 镜像）。
   *
   * v2.5 口径：**每个单位都完成**才算完成 —— Bonus 也要完成。Bonus 只影响完成率
   * 的分母（需求 2，分母不计 Bonus），不影响「全完成」这个判断。
   * 空列表返回 false（空块不算完成）。
   */
  function allDone(units) {
    if (!units.length) return false;
    for (var i = 0; i < units.length; i++) {
      if (!units[i].completed) return false;
    }
    return true;
  }

  /**
   * 把一个任务整理成标准形状。整理不了就返回 null（当作脏数据丢掉）。
   *
   * 这里走的是「尽量救」而不是「一个不对就全废」：
   * 如果因为一条任务的字段残缺就把整份数据判成损坏，会白白触发保护模式，
   * 反而让用户看到「数据无法读取」。缺什么补什么更划算。
   *
   * 返回 { task, dropped } —— dropped 是这条任务下面被丢掉的脏阶段数。
   */
  function normalizeTask(raw) {
    if (!isPlainObject(raw)) return null;

    var text = Util.cleanText(raw.text);
    if (!text) return null; // 没有文本的任务没有意义，丢掉

    var dropped = 0;
    var task = {
      id: typeof raw.id === 'string' && raw.id ? raw.id : Util.genId(),
      text: text,
      completed: raw.completed === true,
      createdAt: typeof raw.createdAt === 'number' && isFinite(raw.createdAt)
        ? raw.createdAt
        : clock()
    };

    // stages 是**可选**字段：没有就是没有阶段。
    //
    // 这一点很关键：加阶段之前导出的备份里全都没有这个字段，
    // 它们必须能照常读进来。要是把 stages 写成必填，用户手里那些
    // 老备份就全废了（见 DS 3.4 那条「改了数据格式要拿老数据跑一遍」）。
    if (Array.isArray(raw.stages)) {
      var stages = [];
      for (var i = 0; i < raw.stages.length; i++) {
        var stage = normalizeStage(raw.stages[i]);
        if (stage) stages.push(stage);
        else dropped++;
      }

      if (stages.length) {
        task.stages = stages;
        // completed 是个**派生字段**，有阶段时一律以阶段为准 ——
        // 数据里存的那个值可能是手工改过的、或者别的版本写的，
        // 不一致的时候相信阶段（阶段是用户一条条点出来的，更可信）。
        // 口径（v2.5）：每个阶段都完成才算完成，Bonus 阶段也算。
        task.completed = allDone(stages);
      }
    }

    // plannedDate 是**可选**字段（计划池的完成时间，见 DS 2.11 二期）：
    // 合法日期就保留，格式不对丢字段不丢任务 —— 时间是附加信息，
    // 不该让它拦住任务本身。老数据没有这个字段，缺省即「未设定」
    if (typeof raw.plannedDate === 'string' && Util.isValidDateStr(raw.plannedDate)) {
      task.plannedDate = raw.plannedDate;
    }

    // slot（完成时段，DS 2.12）同一条规矩：六值之内保留，不合法丢字段不丢任务
    if (typeof raw.slot === 'string' && CONFIG.SLOTS.indexOf(raw.slot) !== -1) {
      task.slot = raw.slot;
    }

    // bonus（需求 2）同阶段：只有 === true 才置 true
    if (raw.bonus === true) {
      task.bonus = true;
    }

    // highlight（高亮，见 DS 2.40）同阶段：只有 === true 才置 true。
    // 老备份里没有这个字段 → 读进来就是普通任务，兼容不受影响
    if (raw.highlight === true) {
      task.highlight = true;
    }

    return { task: task, dropped: dropped };
  }

  /**
   * 块内「最细可勾选单位」数一遍（与 task-ops.progressOfItem 镜像）。
   * 有阶段的任务按阶段算，没阶段的按任务自己算。
   * 返回 { done, allCount }：done = 已完成单位数，allCount = 全部单位数。
   */
  function countUnits(tasks) {
    var done = 0, allCount = 0;
    for (var i = 0; i < tasks.length; i++) {
      var t = tasks[i];
      var stages = (t && Array.isArray(t.stages)) ? t.stages : [];
      if (stages.length) {
        for (var s = 0; s < stages.length; s++) {
          allCount++;
          if (stages[s].completed) done++;
        }
      } else {
        allCount++;
        if (t.completed) done++;
      }
    }
    return { done: done, allCount: allCount };
  }

  /**
   * 块是不是「完成」：块内**每个单位都完成**才算（v2.5：Bonus 单位也算数）。
   * **空块一律不算完成**。
   *
   * 不能照搬 allStagesDone —— 那个函数对空列表返回 true（阶段永远不为空，
   * 所以那边没问题），块是从空块开始的，照搬的话新建的块会一出生就是「已完成」。
   */
  function blockDone(tasks) {
    var c = countUnits(tasks);
    if (c.allCount === 0) return false;   // 空块一律未完成
    return c.done === c.allCount;
  }

  /**
   * 把一个**条目**整理成标准形状。条目有两种（见 DS 2.10）：
   *   - 普通任务：没有 type 字段
   *   - 任务块：  type === 'block'，带 tasks 子列表
   *
   * 返回 { item, dropped }，整理不了返回 null。
   */
  function normalizeItem(raw) {
    if (!isPlainObject(raw)) return null;

    // ---- 任务块 ----
    if (raw.type === 'block') {
      var bText = Util.cleanText(raw.text);
      if (!bText) return null;

      var bDropped = 0;
      var children = [];

      if (Array.isArray(raw.tasks)) {
        for (var i = 0; i < raw.tasks.length; i++) {
          var childRaw = raw.tasks[i];
          // 规矩 1：块里只能装任务。嵌套块是脏数据，直接丢
          if (isPlainObject(childRaw) && childRaw.type === 'block') {
            bDropped++;
            continue;
          }
          var child = normalizeTask(childRaw);
          if (child) {
            children.push(child.task);
            bDropped += child.dropped;
          } else {
            bDropped++;
          }
        }
      }

      // 原先是个直接 return 的字面量，拆成变量只为了按需挂 highlight ——
      // 可选字段不进字面量，免得写出 highlight: false 这种脏值
      var blockItem = {
        id: typeof raw.id === 'string' && raw.id ? raw.id : Util.genId(),
        type: 'block',
        text: bText,
        completed: blockDone(children),
        createdAt: typeof raw.createdAt === 'number' && isFinite(raw.createdAt)
          ? raw.createdAt
          : clock(),
        tasks: children
      };

      // highlight（高亮，见 DS 2.40）同任务 / 阶段：只有 === true 才置 true。
      // 注意块的高亮**不传染**给块内任务：块头标黄只是「这块整体先看着」，
      // 块内任务各有各的高亮（和 bonus 一样，两者互不影响）
      if (raw.highlight === true) {
        blockItem.highlight = true;
      }

      return { item: blockItem, dropped: bDropped };
    }

    // ---- 普通任务 ----
    var normal = normalizeTask(raw);
    return normal ? { item: normal.task, dropped: normal.dropped } : null;
  }

  /**
   * 把一份模板整理成标准形状（见 DS 2.14）。整理不了返回 null（脏数据丢掉）。
   *
   * 模板 = { id, name, createdAt, items: { 四象限数组 } }。
   * items 里的条目走 normalizeItem 同一条「尽量救」路线。
   */
  function normalizeTemplate(raw) {
    if (!isPlainObject(raw)) return null;

    var name = Util.cleanText(raw.name);
    if (!name) return null; // 没有名字的模板没有意义

    var dropped = 0;
    var items = emptyDay();
    var rawItems = isPlainObject(raw.items) ? raw.items : {};

    for (var q = 0; q < CONFIG.QUADRANT_IDS.length; q++) {
      var qid = CONFIG.QUADRANT_IDS[q];
      var list = rawItems[qid];
      if (!Array.isArray(list)) continue; // 象限缺失当空处理

      for (var k = 0; k < list.length; k++) {
        var normalized = normalizeItem(list[k]);
        if (normalized) {
          items[qid].push(normalized.item);
          dropped += normalized.dropped;
        } else {
          dropped++;
        }
      }
    }

    return {
      template: {
        id: typeof raw.id === 'string' && raw.id ? raw.id : Util.genId(),
        name: name,
        createdAt: typeof raw.createdAt === 'number' && isFinite(raw.createdAt)
          ? raw.createdAt
          : clock(),
        items: items
      },
      dropped: dropped
    };
  }

  /**
   * 清洗一条阅读栏条目（v2.8 需求 2，见 DS 2.37）。
   *
   * 形状 = { id, text, start, doneAt, createdAt }：
   *   - text  书名 / 事项名，去空白后不能为空（和任务同一条规矩）；
   *   - start 开始阅读的**日期** 'YYYY-MM-DD'，没设就是 null（**不是**空串 ——
   *           空串在这里当「没设」，存进去只会让别处的判断多一种情况）；
   *   - doneAt 读完那天的 'YYYY-MM-DD'，正在阅读的条目是 null。
   *
   * 两个日期走的是**宽松**校验（Util.isValidReadingStamp）：老文件里的
   * 'HH:MM' 原样收下，不抹掉 —— 兼容优先，见 DS 2.37 修订。
   *
   * 整理不了（不是对象 / 没文本）返回 null，当脏数据丢掉。
   */
  function normalizeReadingItem(raw) {
    if (!isPlainObject(raw)) return null;

    var text = Util.cleanText(raw.text);
    if (!text) return null; // 没名字的阅读条目没有意义

    return {
      id: typeof raw.id === 'string' && raw.id ? raw.id : Util.genId(),
      text: text,
      start: Util.isValidReadingStamp(raw.start) ? raw.start : null,
      doneAt: Util.isValidReadingStamp(raw.doneAt) ? raw.doneAt : null,
      createdAt: typeof raw.createdAt === 'number' && isFinite(raw.createdAt)
        ? raw.createdAt
        : clock()
    };
  }

  /**
   * 清洗整块阅读栏：{ active: [...], done: [...] }。
   *
   * 返回的 doneAt 会被**强制**对齐所在的那张表：正在阅读表里的条目一律把
   * doneAt 抹成 null，已完成表里的条目一律得有个日期（脏数据就补**今天**）。
   * 这么做的原因是「在哪张表」是唯一的完成判据 —— 留着一个和所在表矛盾的
   * doneAt，只会让别处多出一道「到底信哪个」的判断（见 DS 2.37）。
   */
  function normalizeReading(raw) {
    var out = { active: [], done: [] };
    if (!isPlainObject(raw)) return { reading: out, dropped: 0 };

    var dropped = 0;
    var tables = [['active', raw.active], ['done', raw.done]];
    for (var t = 0; t < tables.length; t++) {
      var name = tables[t][0];
      var list = tables[t][1];
      if (!Array.isArray(list)) continue;

      for (var i = 0; i < list.length; i++) {
        var item = normalizeReadingItem(list[i]);
        if (!item) {
          dropped++;
          continue;
        }
        item.doneAt = (name === 'done') ? (item.doneAt || Util.todayStr()) : null;
        out[name].push(item);
      }
    }
    return { reading: out, dropped: dropped };
  }

  /**
   * 清洗「时间视图顺序记忆」（需求 3，见 DS 2.17）。
   *
   * 形状是 { 时段: [键, ...] }，键 = 't:'+taskId 或 's:'+taskId+':'+stageId。
   * 键必须 ∈ CONFIG.SLOTS，值必须是数组、元素必须是非空字符串。
   * 只拷合法条目；没有任何合法条目就返回 null（不挂 tv 字段，空日期随之丢掉）。
   */
  function sanitizeTvOrder(rawTv) {
    if (!isPlainObject(rawTv)) return null;

    var tv = null;
    var slots = CONFIG.SLOTS;
    for (var s = 0; s < slots.length; s++) {
      var slot = slots[s];
      var list = rawTv[slot];
      if (!Array.isArray(list)) continue;

      var keys = [];
      for (var i = 0; i < list.length; i++) {
        if (typeof list[i] === 'string' && list[i]) keys.push(list[i]);
      }
      if (!keys.length) continue;

      if (!tv) tv = {};
      tv[slot] = keys;
    }
    return tv;
  }

  /**
   * 把解析出来的原始对象整理成标准数据，并报告丢掉了多少条脏任务。
   *
   * 顶层结构（dates 必须是对象）不对就直接抛错 —— 那说明整份数据不可信，
   * 应该交给 load() 去走备份恢复。
   */
  function normalize(raw) {
    if (!isPlainObject(raw)) {
      throw new Error('数据不是一个对象');
    }
    if (!isPlainObject(raw.dates)) {
      throw new Error('数据里缺少 dates');
    }

    var dropped = 0;
    var dates = {};
    var dateKeys = Object.keys(raw.dates);

    for (var i = 0; i < dateKeys.length; i++) {
      var dateStr = dateKeys[i];
      if (!Util.isValidDateStr(dateStr)) {
        dropped++; // 日期本身不合法，整天的数据都不可信
        continue;
      }

      var rawDay = raw.dates[dateStr];
      if (!isPlainObject(rawDay)) {
        dropped++;
        continue;
      }

      var day = emptyDay();
      var hasAny = false;

      for (var q = 0; q < CONFIG.QUADRANT_IDS.length; q++) {
        var qid = CONFIG.QUADRANT_IDS[q];
        var list = rawDay[qid];
        if (!Array.isArray(list)) continue; // 象限缺失当空处理

        for (var k = 0; k < list.length; k++) {
          var normalized = normalizeItem(list[k]);
          if (normalized) {
            day[qid].push(normalized.item);
            dropped += normalized.dropped;
            hasAny = true;
          } else {
            dropped++;
          }
        }
      }

      // tv（时间视图顺序记忆，需求 3）是**可选**字段：清洗后挂到 day 上。
      // 整天都是空的就不占地方了（tv 也跟着一起丢掉，见 DS 2.17）
      var tv = sanitizeTvOrder(rawDay.tv);
      if (tv) day.tv = tv;

      // 整天都是空的就不占地方了
      if (hasAny) dates[dateStr] = day;
    }

    // ---- 计划池（见 DS 2.11）----
    // 元素可以是任务，也可以是任务块（需求：任务块整体推迟进池 / 池里手动加块）。
    // 都走 normalizeItem 同一条「尽量救」路线；老数据没有 pool 字段 ——
    // 补一个空数组，schemaVersion 不动（纯追加）
    var pool = [];
    if (Array.isArray(raw.pool)) {
      for (var p = 0; p < raw.pool.length; p++) {
        var poolItem = normalizeItem(raw.pool[p]);
        if (poolItem) {
          pool.push(poolItem.item);
          dropped += poolItem.dropped;
        } else {
          dropped++;
        }
      }
    }

    // ---- 模板（见 DS 2.14）----
    // 和 pool 同款：老数据没有 templates 字段 → 补空数组，schemaVersion 不动
    var templates = [];
    if (Array.isArray(raw.templates)) {
      for (var ti = 0; ti < raw.templates.length; ti++) {
        var tpl = normalizeTemplate(raw.templates[ti]);
        if (tpl) {
          templates.push(tpl.template);
          dropped += tpl.dropped;
        } else {
          dropped++;
        }
      }
    }

    // ---- 阅读栏（v2.8 需求 2，见 DS 2.37）----
    // 和 pool / templates 同一条规矩：老数据没有 reading 字段 → 补空表
    var readingResult = normalizeReading(raw.reading);
    var reading = readingResult.reading;
    dropped += readingResult.dropped;

    return {
      data: {
        user: typeof raw.user === 'string' && raw.user ? raw.user : CONFIG.USER_ID,
        // 老数据没有这个字段，按 1 处理
        schemaVersion: typeof raw.schemaVersion === 'number'
          ? raw.schemaVersion
          : CONFIG.SCHEMA_VERSION,
        dates: dates,
        pool: pool,
        templates: templates,
        // 阅读栏（v2.8 需求 2）：和 pool / templates 同款 —— 老数据没有这个
        // 字段 → 补一张空表，schemaVersion 不动（纯追加）
        reading: reading
      },
      dropped: dropped
    };
  }

  function serialize(data) {
    return JSON.stringify(data);
  }

  /** 解析一段 JSON 文本；成功返回 {data, dropped}，失败抛错 */
  function parse(text) {
    if (typeof text !== 'string' || !text) {
      throw new Error('数据是空的');
    }
    var raw;
    try {
      raw = JSON.parse(text);
    } catch (e) {
      throw new Error('数据不是合法的 JSON');
    }
    return normalize(raw);
  }

  // -------------------------------------------------------------------------
  // 日期与象限的读取
  // -------------------------------------------------------------------------

  /**
   * 取某一天的四个象限。
   * 那天没有数据就返回四个空列表 —— 这是「空日期」的约定（见 DS 3.3）。
   * 返回的是副本，改它不会影响原数据。
   */
  function getDayTasks(data, dateStr) {
    var day = emptyDay();
    if (!data || !data.dates || !isPlainObject(data.dates[dateStr])) {
      return day;
    }
    var stored = data.dates[dateStr];
    for (var i = 0; i < CONFIG.QUADRANT_IDS.length; i++) {
      var qid = CONFIG.QUADRANT_IDS[i];
      if (Array.isArray(stored[qid])) {
        day[qid] = stored[qid].slice();
      }
    }
    return day;
  }

  /** 某一天有没有任何任务 */
  function hasAnyTask(data, dateStr) {
    var day = getDayTasks(data, dateStr);
    for (var i = 0; i < CONFIG.QUADRANT_IDS.length; i++) {
      if (day[CONFIG.QUADRANT_IDS[i]].length > 0) return true;
    }
    return false;
  }

  /**
   * 确保 data.dates[dateStr] 存在，返回那一天的四个象限（**可写**，不是副本）。
   * 供 task-ops.js 增删改用。
   */
  function ensureDay(data, dateStr) {
    if (!Util.isValidDateStr(dateStr)) {
      throw new Error('日期不合法：' + dateStr);
    }
    if (!data.dates[dateStr]) {
      data.dates[dateStr] = emptyDay();
    }
    return data.dates[dateStr];
  }

  /** 列出数据里所有日期，按时间升序 */
  function listDates(data) {
    if (!data || !data.dates) return [];
    return Object.keys(data.dates).sort();
  }

  // -------------------------------------------------------------------------
  // 备份轮转（DS 2.4）
  // -------------------------------------------------------------------------

  /**
   * 把当前主数据复制进备份槽，旧的依次往后挪，最旧的被挤掉。
   * 超过 BACKUP_THROTTLE_MS 才做一次（用户连续勾选时会不停保存）。
   *
   * 备份里除了数据本身，还记一个 savedAt —— 4.2 的恢复提示要告诉用户
   * 「恢复到了 X 月 X 日 X 点的版本」，没有这个时间戳就报不出来。
   */
  function rotateBackups(force) {
    var now = clock();
    if (!force && now - lastBackupAt < CONFIG.BACKUP_THROTTLE_MS) {
      return false;
    }

    var current = storage.getItem(CONFIG.KEYS.userData);
    if (!current) return false; // 还没有主数据，没什么可备份的

    var envelope = JSON.stringify({ savedAt: now, data: JSON.parse(current) });
    var keys = CONFIG.KEYS.backups;

    // 从最后一份往前挪：backup[3] ← backup[2] ← ... ← backup[0] ← 当前主数据
    for (var i = keys.length - 1; i > 0; i--) {
      var prev = storage.getItem(keys[i - 1]);
      if (prev === null) {
        storage.removeItem(keys[i]);
      } else {
        storage.setItem(keys[i], prev);
      }
    }
    storage.setItem(keys[0], envelope);

    // 只有**真的轮转了**才重置计时。
    // 如果因为「还没有主数据可备份」而空跑一次，不算数 —— 否则本次会话的
    // 头一次保存会把计时器打满，接下来 30 秒内的改动就全都捞不到快照了。
    lastBackupAt = now;
    return true;
  }

  /** 按顺序试每一份备份，返回第一个能读通的 {data, savedAt, index}；全废返回 null */
  function findGoodBackup() {
    var keys = CONFIG.KEYS.backups;
    for (var i = 0; i < keys.length; i++) {
      var text = storage.getItem(keys[i]);
      if (!text) continue;
      var envelope;
      try {
        envelope = JSON.parse(text);
      } catch (e) {
        continue;
      }
      if (!isPlainObject(envelope) || !envelope.data) continue;
      try {
        var result = normalize(envelope.data);
        return {
          data: result.data,
          dropped: result.dropped,
          savedAt: typeof envelope.savedAt === 'number' ? envelope.savedAt : null,
          index: i
        };
      } catch (e) {
        continue;
      }
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // durable 副本（安卓的 Capacitor Preferences，DS 2.2）
  // -------------------------------------------------------------------------

  /**
   * 把数据标记为「待写入 durable」。真正的写入由 flushDurable() 完成，
   * 由 app.js 在 3 秒节流窗口里调用（和传云端共用一个窗口）。
   *
   * 为什么不当场写：Preferences 每次都是整份重写，每敲一个字写一次没意义。
   */
  function markDurableDirty(data) {
    if (!durable) return;
    durableDirty = data;
  }

  /**
   * 立刻把待写入的数据落进 durable，并补上「存过数据」的标记。
   *
   * 顺序很讲究：**先写数据，再写标记**。
   * 标记的含义是「我已经成功存过一份 durable 副本」，如果反过来先写标记，
   * 万一中途挂掉，就会出现「有标记但没数据」——程序会以为能恢复，结果恢复出空。
   */
  function flushDurable() {
    if (!durable || durableDirty === null) return false;
    var payload = JSON.stringify({
      savedAt: clock(),
      data: durableDirty
    });
    durable.setItem(CONFIG.PREFS_KEYS.backup, payload);
    durable.setItem(CONFIG.PREFS_KEYS.marker, '1');
    durableDirty = null;
    return true;
  }

  /** 读 durable 副本，返回 {data, savedAt} 或 null */
  function readDurable() {
    if (!durable) return null;
    if (durable.getItem(CONFIG.PREFS_KEYS.marker) !== '1') return null; // 从没存过
    var text = durable.getItem(CONFIG.PREFS_KEYS.backup);
    if (!text) return null;
    try {
      var envelope = JSON.parse(text);
      if (!isPlainObject(envelope) || !envelope.data) return null;
      var result = normalize(envelope.data);
      return {
        data: result.data,
        dropped: result.dropped,
        savedAt: typeof envelope.savedAt === 'number' ? envelope.savedAt : null
      };
    } catch (e) {
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // 保存
  // -------------------------------------------------------------------------

  /**
   * 保存数据。
   *
   * 返回 {ok:true} 或 {ok:false, error:'PROTECTED' | 'QUOTA' | 'UNKNOWN'}。
   * 调用方（task-ops / app）负责把失败翻译成用户能看懂的提示（见 DS 4.2）。
   */
  function save(data) {
    if (protectionMode) {
      // 保护模式下磁盘上那份原始数据一个字节都不能动（见 DS 2.4）
      return { ok: false, error: 'PROTECTED' };
    }

    var text;
    try {
      text = serialize(data);
    } catch (e) {
      return { ok: false, error: 'UNKNOWN' };
    }

    // 先把上一版挪进备份，再写新的。
    // 顺序不能反：反了的话备份里存的就是新版，等于没有备份。
    try {
      rotateBackups(false);
    } catch (e) {
      // 备份失败不该拦住保存本身 —— 数据能存进去最重要
    }

    try {
      storage.setItem(CONFIG.KEYS.userData, text);
    } catch (e) {
      // 写不进去（多半是空间满了）。主数据还停在改动前的那一版，
      // 所以「本次修改未保存」是真的没保存，没有半新半旧。
      return { ok: false, error: e && e.name === 'QuotaExceededError' ? 'QUOTA' : 'UNKNOWN' };
    }

    markDurableDirty(data);
    return { ok: true };
  }

  /** 测试和调试用：直接重置内部节流状态 */
  function resetThrottle() {
    lastBackupAt = 0;
  }

  // -------------------------------------------------------------------------
  // 主题（DS 2.2：本机偏好，单独一个 key，不进用户数据）
  // -------------------------------------------------------------------------

  /** 读主题；读不出来或值不认识就回到亮色 */
  function getTheme() {
    var t = storage.getItem(CONFIG.KEYS.theme);
    return t === CONFIG.THEMES.DARK ? CONFIG.THEMES.DARK : CONFIG.THEMES.LIGHT;
  }

  /** 存主题。存不进去（比如空间满了）也不该影响主流程 —— 大不了下次回到亮色 */
  function setTheme(theme) {
    var t = theme === CONFIG.THEMES.DARK ? CONFIG.THEMES.DARK : CONFIG.THEMES.LIGHT;
    try {
      storage.setItem(CONFIG.KEYS.theme, t);
    } catch (e) { /* 主题存不上不是大事 */ }
    return t;
  }

  /**
   * 读折叠 / 展开状态（需求 5）。读不出、结构不对都给一份空表 ——
   * 最多就是刷新后回到「默认折叠 / 默认展开」，不算丢数据。
   *
   * v2.8 起多一张 collapsedPanels（哪些**板块**收起了，见需求 3 / DS 2.38）：
   * 和「任务展开 / 块折叠」是同一种界面状态，所以共用这一份存取，不另开
   * 一个 storage key —— 两处分开存只会多一个会坏、会不同步的地方。
   */
  function getFoldState() {
    try {
      var text = storage.getItem(CONFIG.KEYS.foldState);
      if (!text) return { expanded: {}, collapsedBlocks: {}, collapsedPanels: {} };
      var parsed = JSON.parse(text);
      return {
        expanded: (parsed && typeof parsed.expanded === 'object' && parsed.expanded)
          ? parsed.expanded : {},
        collapsedBlocks: (parsed && typeof parsed.collapsedBlocks === 'object' && parsed.collapsedBlocks)
          ? parsed.collapsedBlocks : {},
        collapsedPanels: (parsed && typeof parsed.collapsedPanels === 'object' && parsed.collapsedPanels)
          ? parsed.collapsedPanels : {}
      };
    } catch (e) {
      return { expanded: {}, collapsedBlocks: {}, collapsedPanels: {} };
    }
  }

  /** 存折叠 / 展开状态。存不上也不该影响主流程 */
  function setFoldState(fold) {
    try {
      storage.setItem(CONFIG.KEYS.foldState, JSON.stringify({
        expanded: (fold && fold.expanded) || {},
        collapsedBlocks: (fold && fold.collapsedBlocks) || {},
        collapsedPanels: (fold && fold.collapsedPanels) || {}
      }));
    } catch (e) { /* 界面状态存不上不是大事 */ }
  }

  // -------------------------------------------------------------------------
  // 读取（DS 2.4 的恢复流程）
  // -------------------------------------------------------------------------

  /**
   * 启动时读数据。返回：
   *   { status, data, savedAt, dropped, message }
   *
   * status 一览：
   *   'ok'              正常读到
   *   'new'             新用户，从没存过，给一份空的
   *   'recovered'       主数据坏了，从本地滚动备份救回来了
   *   'recovered-local' 本地全废，从安卓 durable 副本救回来了
   *   'protected'       全都读不出来，进入保护模式
   *
   * 判定顺序（三步都不能省）：
   *   主数据 → 4 份滚动备份 → durable 副本 → 保护模式
   *
   * 为什么不先试 durable：durable 是给「系统清空了 localStorage」兜底的，
   * 而本地备份能救的情况更常见（程序自己写坏了数据）。先试概率大的。
   */
  function load() {
    var text = storage.getItem(CONFIG.KEYS.userData);

    // ---- 第一关：主数据 ----
    if (text) {
      try {
        var result = parse(text);
        protectionMode = false;
        return {
          status: 'ok',
          data: result.data,
          savedAt: null,
          dropped: result.dropped,
          message: null
        };
      } catch (e) {
        // 落到下一关
      }
    }

    // ---- 第二关：本地滚动备份 ----
    var backup = findGoodBackup();
    if (backup) {
      protectionMode = false;
      try {
        storage.setItem(CONFIG.KEYS.userData, serialize(backup.data));
      } catch (e2) {
        // 恢复回去时写不进去（空间满），但数据已经在内存里了，
        // 用户这次至少能用，所以不算失败
      }
      return {
        status: 'recovered',
        data: backup.data,
        savedAt: backup.savedAt,
        dropped: backup.dropped,
        message: '数据异常，已从备份恢复'
      };
    }

    // ---- 第三关：安卓 durable 副本 ----
    var local = readDurable();
    if (local) {
      protectionMode = false;
      try {
        storage.setItem(CONFIG.KEYS.userData, serialize(local.data));
      } catch (e3) { /* 同上 */ }
      return {
        status: 'recovered-local',
        data: local.data,
        savedAt: local.savedAt,
        dropped: local.dropped,
        message: '已从本地副本恢复数据'
      };
    }

    // ---- 第四关：真的什么都没有 ----
    if (!text) {
      // 主数据本来就是空的，而且 durable 也没有标记 —— 是个新用户，
      // 不是「数据丢了」。这时候绝不能弹恢复提示（见 DS 3.3 验收）。
      protectionMode = false;
      return {
        status: 'new',
        data: createEmpty(),
        savedAt: null,
        dropped: 0,
        message: null
      };
    }

    // 主数据有内容但读不出来，备份和 durable 也都废了。
    // 这时候**不能**用空数据把磁盘上那份覆盖掉（见 DS 2.4 保护模式）。
    protectionMode = true;
    return {
      status: 'protected',
      data: createEmpty(),
      savedAt: null,
      dropped: 0,
      message: '数据无法读取，已进入保护模式。你的原始数据没有被改动。'
    };
  }

  // -------------------------------------------------------------------------
  // 30 天归档（DS 2.4）
  // -------------------------------------------------------------------------

  /**
   * 算出哪些日期该归档。
   *
   * 窗口是「今天往前数 30 天」的滑动窗口。未来的日期一律保留 ——
   * 用户提前记的待办不该被当成历史归档掉。
   *
   * 返回 { cutoff, keep: {日期: 天}, archive: {日期: 天}, archivedCount }
   */
  function planArchive(data, today) {
    var todayStr = Util.todayStr(today);
    var cutoff = Util.addDays(todayStr, -(CONFIG.ARCHIVE_WINDOW_DAYS - 1));

    var keep = {};
    var archive = {};
    var archivedCount = 0;

    if (data && data.dates) {
      var keys = Object.keys(data.dates);
      for (var i = 0; i < keys.length; i++) {
        var d = keys[i];
        if (Util.compareDateStr(d, cutoff) < 0) {
          archive[d] = data.dates[d];
          archivedCount++;
        } else {
          keep[d] = data.dates[d];
        }
      }
    }

    return {
      cutoff: cutoff,
      keep: keep,
      archive: archive,
      archivedCount: archivedCount
    };
  }

  /**
   * 把归档计划套用到数据上，返回**新的**数据对象（不改原来那份）。
   * 只有在归档文件确认下载成功之后，才该调用它（见 DS 2.4 那条硬规矩）。
   */
  function applyArchive(data, plan) {
    var next = createEmpty();
    next.user = data.user;
    next.schemaVersion = data.schemaVersion;
    next.dates = plan.keep;
    // 归档只收缩 dates；计划池没有日期，跟着留下（见 DS 2.11 统计与归档）
    next.pool = Array.isArray(data.pool) ? data.pool : [];
    // 模板同样不按日期分，跟着留下（见 DS 2.14）
    next.templates = Array.isArray(data.templates) ? data.templates : [];
    return next;
  }

  /** 归档出来的那部分单独包一份可导出的 JSON 结构（和普通导出格式一致） */
  function buildArchivePayload(data, plan) {
    return {
      user: data.user,
      schemaVersion: data.schemaVersion,
      dates: plan.archive
    };
  }

  // -------------------------------------------------------------------------

  return {
    init: init,
    isProtectionMode: isProtectionMode,
    exitProtectionMode: exitProtectionMode,

    createEmpty: createEmpty,
    emptyDay: emptyDay,
    normalize: normalize,
    normalizeTask: normalizeTask,
    normalizeItem: normalizeItem,
    normalizeTemplate: normalizeTemplate,
    normalizeReading: normalizeReading,
    normalizeReadingItem: normalizeReadingItem,
    blockDone: blockDone,
    allDone: allDone,
    sanitizeTvOrder: sanitizeTvOrder,
    serialize: serialize,
    parse: parse,

    getDayTasks: getDayTasks,
    hasAnyTask: hasAnyTask,
    ensureDay: ensureDay,
    listDates: listDates,

    rotateBackups: rotateBackups,
    findGoodBackup: findGoodBackup,

    markDurableDirty: markDurableDirty,
    flushDurable: flushDurable,
    readDurable: readDurable,

    save: save,
    load: load,
    resetThrottle: resetThrottle,

    getTheme: getTheme,
    setTheme: setTheme,

    getFoldState: getFoldState,
    setFoldState: setFoldState,

    planArchive: planArchive,
    applyArchive: applyArchive,
    buildArchivePayload: buildArchivePayload
  };
})(
  // 浏览器里用全局的 CONFIG / Util（script 标签按 1.4 的顺序加载）；
  // Node 测试里用 require。这段写法让同一个文件两边都能跑。
  typeof CONFIG !== 'undefined' ? CONFIG : require('./config.js'),
  typeof Util !== 'undefined' ? Util : require('./util.js')
);

// Node 测试环境用（浏览器里没有 module，这段不会执行）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Store;
}
