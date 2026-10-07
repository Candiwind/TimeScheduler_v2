/**
 * config.js —— 全项目共用的固定值
 *
 * 加载顺序：第 1 个（见 DS 1.4）。
 * 本文件是纯常量，不依赖任何东西。
 */
var CONFIG = (function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // 四个象限
  //
  // id 会被写进用户数据里，并且是导入判重的一部分（见 DS 2.6）。
  // 一旦有用户存过数据，这几个 id 就再也不能改了 —— 改了等于数据全丢。
  // ---------------------------------------------------------------------------
  var QUADRANTS = [
    { id: 'I',   name: '重要且紧急',   color: '#e74c3c' },
    { id: 'II',  name: '重要不紧急',   color: '#3498db' },
    { id: 'III', name: '紧急不重要',   color: '#f1c40f' },
    { id: 'IV',  name: '不重要不紧急', color: '#2ecc71' }
  ];

  var QUADRANT_IDS = ['I', 'II', 'III', 'IV'];

  // ---------------------------------------------------------------------------
  // 存储位置的名字（见 DS 2.2）
  //
  // 这些 key 一旦写进用户设备就不能改了，改了等于数据全丢。
  // ---------------------------------------------------------------------------
  var USER_ID = 'default';

  var KEYS = {
    // 主数据：只放最近 30 天的任务
    userData: 'quadrant_user_data:' + USER_ID,
    // 4 份滚动备份
    backups: [
      'quadrant_user_data:' + USER_ID + '_backup',
      'quadrant_user_data:' + USER_ID + '_backup_1',
      'quadrant_user_data:' + USER_ID + '_backup_2',
      'quadrant_user_data:' + USER_ID + '_backup_3'
    ],
    // 同步凭据（含坚果云账号密码和中转代理口令）
    // 守住三条线：不进导出、不进同步、不进任何备份（见 DS 2.2 / D-23）
    syncConfig: 'quadrant_sync_config',
    // 主题（本机偏好，不跟着数据同步）
    //
    // ⚠️ 这个名字在 index.html 的 <head> 里被硬编码了一份 ——
    // 那段防闪白的脚本要在 CSS 生效前读它，来不及等这里的代码加载。
    // 改这个 key 的话，那边也要跟着改（两处有注释互指）。
    theme: 'quadrant_ui_theme',
    // 折叠 / 展开状态（本机偏好，不跟着数据同步，见 DS 2.9 / 需求 5）
    //
    // 需求 5：有阶段的任务、有任务的任务块都能折叠 / 展开，折叠状态记在本机、
    // 刷新后保持。和主题一样属于「界面状态」，单独存，不混进主数据。
    foldState: 'quadrant_ui_fold_state'
  };

  // 安卓端 Capacitor Preferences 的键（见 DS 2.2）
  var PREFS_KEYS = {
    backup: 'quadrant_prefs_backup',
    // 「存过数据」的标记。必须存在 Preferences 里 —— 存在 localStorage 的
    // 话，系统回收时会和主数据一起消失，程序就会误判成「新用户从没存过」，
    // 于是既不恢复也不提示，救援副本形同虚设。
    marker: 'quadrant_prefs_marker'
  };

  // ---------------------------------------------------------------------------
  // 计划池导入的目标象限（v2.6 需求 2 / 需求 3）
  //
  // 池里的东西是「还没安排的重要事」，所以默认送进第二象限（重要不紧急）。
  // 需求原话就是「默认导入到第二象限」，这里不提供改的入口 —— 真放错了，
  // 象限里拖一下就到别的象限了（见 DS 2.31 / D-59）。
  // ---------------------------------------------------------------------------
  var IMPORT_QUADRANT = 'II';

  // ---------------------------------------------------------------------------
  // 数据格式版本（见 DS 2.3 / D-24）
  // ---------------------------------------------------------------------------
  var SCHEMA_VERSION = 1;

  // ---------------------------------------------------------------------------
  // 阅读栏（v2.8 需求 2）
  //
  // 「正在阅读」建议不超过 3 项 —— 需求原话是「提示不超过3项」，所以这是个
  // **软提示**：加第 4 项照常加进去，只在标题旁标一句「建议不超过 3 项」，
  // 不做硬拦截（拦下来会让想同时读 4 本的用户无从下手）。见 FS v2.8 / D-64。
  // ---------------------------------------------------------------------------
  var READING_ACTIVE_HINT = 3;

  // ---------------------------------------------------------------------------
  // 可收起的三个板块（v2.8 需求 3）
  //
  // 阅读栏 / 计划池 / 模板池都能收起，收起状态记在本机、刷新后保持（存在
  // foldState 那张表的 collapsedPanels 里，见 DS 2.38）。
  //
  // 这几个串会写进用户的本地存储，并且和 HTML 上的 `data-panel` 一一对应 ——
  // 和象限 id 一样：**定了就别改**，改名等于用户的收起状态丢失。
  // ---------------------------------------------------------------------------
  var PANEL_IDS = ['reading', 'pool', 'templates'];

  // ---------------------------------------------------------------------------
  // 各种阈值和节流
  // ---------------------------------------------------------------------------
  var BACKUP_COUNT = 4;                       // 滚动备份保留几份
  var BACKUP_THROTTLE_MS = 30 * 1000;         // 备份轮转最快 30 秒一次
  var SYNC_DEBOUNCE_MS = 3 * 1000;            // 改动攒 3 秒再同步（DS 2.5）
  var ARCHIVE_WINDOW_DAYS = 30;               // 本地只保留最近 30 天（DS 2.4）
  var ARCHIVE_CHECK_MS = 60 * 1000;           // 归档检查的节流
  var STORAGE_WARN_RATIO = 0.8;               // localStorage 用到 80% 就提醒
  var STORAGE_LIMIT_BYTES = 5 * 1024 * 1024;  // localStorage 每源约 5MB，用于估算
  var TOAST_ERROR_MS = 5000;                  // 错误提示至少停留 5 秒（DS 4.3）

  // ---------------------------------------------------------------------------
  // 主题
  // ---------------------------------------------------------------------------
  var THEMES = { LIGHT: 'light', DARK: 'dark' };

  // ---------------------------------------------------------------------------
  // 完成时段（见 DS 2.12）
  //
  // 六个时段，顺序就是一天从早到晚。它们会作为任务 / 阶段身上 `slot` 字段的
  // 值**写进用户数据**，并且参与导出导入 —— 和象限 id 同理，一旦有用户存过
  // 数据，这些中文串就不能再改了，改了等于老数据里的时段全失效。
  // ---------------------------------------------------------------------------
  var SLOTS = ['早上', '上午', '中午', '下午', '傍晚', '晚上'];

  // 时段对应的图标。**只活在渲染层**，不进数据 —— 数据里永远只有中文串，
  // 图标是给人看的装饰，换图标不影响任何已存数据（见 D-39）
  var SLOT_ICONS = {
    '早上': '🌅',
    '上午': '☀️',
    '中午': '🌞',
    '下午': '⛅',
    '傍晚': '🌇',
    '晚上': '🌙'
  };

  return {
    QUADRANTS: QUADRANTS,
    QUADRANT_IDS: QUADRANT_IDS,
    USER_ID: USER_ID,
    KEYS: KEYS,
    PREFS_KEYS: PREFS_KEYS,
    IMPORT_QUADRANT: IMPORT_QUADRANT,
    SCHEMA_VERSION: SCHEMA_VERSION,
    READING_ACTIVE_HINT: READING_ACTIVE_HINT,
    PANEL_IDS: PANEL_IDS,
    BACKUP_COUNT: BACKUP_COUNT,
    BACKUP_THROTTLE_MS: BACKUP_THROTTLE_MS,
    SYNC_DEBOUNCE_MS: SYNC_DEBOUNCE_MS,
    ARCHIVE_WINDOW_DAYS: ARCHIVE_WINDOW_DAYS,
    ARCHIVE_CHECK_MS: ARCHIVE_CHECK_MS,
    STORAGE_WARN_RATIO: STORAGE_WARN_RATIO,
    STORAGE_LIMIT_BYTES: STORAGE_LIMIT_BYTES,
    TOAST_ERROR_MS: TOAST_ERROR_MS,
    THEMES: THEMES,
    SLOTS: SLOTS,
    SLOT_ICONS: SLOT_ICONS
  };
})();

// Node 测试环境用（浏览器里没有 module，这段不会执行）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CONFIG;
}
