/**
 * util.js —— 小工具
 *
 * 加载顺序：第 2 个（见 DS 1.4）。
 *
 * 按 DS 1.7 规矩二，本文件属于「纯算逻辑」，**不准出现 window / document**，
 * 这样 Node 里可以直接跑测试。
 */
var Util = (function () {
  'use strict';

  var DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  var MS_PER_DAY = 24 * 60 * 60 * 1000;

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  /**
   * 把一个 Date 格式化成 'YYYY-MM-DD'。
   * 用的是**本地时区**的 getFullYear / getMonth / getDate，不用 toISOString()。
   * 用 toISOString() 会在东八区把「10 月 1 日 00:30」变成「9 月 30 日」，
   * 是个非常隐蔽的跨日 bug。
   */
  function formatDate(date) {
    if (!(date instanceof Date) || isNaN(date.getTime())) return null;
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
  }

  /**
   * 判断是不是一个合法的 'YYYY-MM-DD'。
   * 光用正则不够 —— '2026-13-01'、'2026-02-30' 都能过正则，
   * 必须再构造一次 Date 验证它没有被 JS 悄悄进位。
   */
  function isValidDateStr(s) {
    if (typeof s !== 'string') return false;
    var m = DATE_RE.exec(s);
    if (!m) return false;

    var y = Number(m[1]);
    var mo = Number(m[2]);
    var d = Number(m[3]);
    if (mo < 1 || mo > 12) return false;
    if (d < 1 || d > 31) return false;

    var date = new Date(y, mo - 1, d);
    // 如果日期非法（比如 2026-02-30），Date 会进位成 3 月 2 日，
    // 回读出来的月份/日就和输入对不上了。
    return date.getFullYear() === y &&
           date.getMonth() === mo - 1 &&
           date.getDate() === d;
  }

  /**
   * 'YYYY-MM-DD' → 本地零点的 Date；非法则返回 null。
   */
  function parseDate(s) {
    if (!isValidDateStr(s)) return null;
    var m = DATE_RE.exec(s);
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }

  /**
   * 日期加减若干天，返回 'YYYY-MM-DD'。
   * 交给 Date.setDate 处理跨月跨年（它会自动进位），不要自己算。
   */
  function addDays(dateStr, n) {
    var d = parseDate(dateStr);
    if (!d || typeof n !== 'number' || !isFinite(n)) return null;
    d.setDate(d.getDate() + n);
    return formatDate(d);
  }

  /** 今天（本地时区）的 'YYYY-MM-DD' */
  function todayStr(nowDate) {
    return formatDate(nowDate instanceof Date ? nowDate : new Date());
  }

  /**
   * b - a，单位天。两个参数都是 'YYYY-MM-DD'。
   * 用 Math.round 是为了躲开夏令时——有些时区一天不是正好 86400000 毫秒。
   */
  function diffDays(a, b) {
    var da = parseDate(a);
    var db = parseDate(b);
    if (!da || !db) return null;
    return Math.round((db.getTime() - da.getTime()) / MS_PER_DAY);
  }

  /** 按字典序比大小即可，'YYYY-MM-DD' 的字典序就是时间序 */
  function compareDateStr(a, b) {
    if (a === b) return 0;
    return a < b ? -1 : 1;
  }

  // ---------------------------------------------------------------------------
  // 唯一编号
  // ---------------------------------------------------------------------------

  var idCounter = 0;

  /**
   * 生成任务编号，形如 id_m1abcd_x7k2。
   *
   * 只需要在**本机**唯一：导入判重按「象限 + 文本」，不按编号（见 DS 2.6），
   * 所以两台设备各自生成的重号不会有任何影响。
   * 带一个自增计数器是为了躲开「同一毫秒内连续建两条」的撞号。
   */
  function genId() {
    idCounter = (idCounter + 1) % 46656; // 36^3
    return 'id_' +
      Date.now().toString(36) + '_' +
      Math.random().toString(36).slice(2, 6) +
      idCounter.toString(36);
  }

  // ---------------------------------------------------------------------------
  // 文本
  // ---------------------------------------------------------------------------

  /**
   * 任务文本的清洗：去掉首尾空白。
   * 注意这里只 trim，不把中间的空格压掉 —— 用户写「写 报告」是他的自由。
   */
  function cleanText(s) {
    if (typeof s !== 'string') return '';
    // 　 是全角空格，中文输入法下很常见，trim() 不认它
    return s.replace(/^[\s　]+|[\s　]+$/g, '');
  }

  /** 任务文本是否合法（去空白后不能为空，见 DS 2.3） */
  function isValidTaskText(s) {
    return cleanText(s).length > 0;
  }

  var HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  /**
   * 转义 HTML 特殊字符。任务文本是用户随手输入的，
   * 直接塞进 innerHTML 会让 `<img onerror=...>` 这种文本变成真的标签。
   */
  function escapeHtml(s) {
    if (typeof s !== 'string') return '';
    return s.replace(/[&<>"']/g, function (ch) { return HTML_ESCAPES[ch]; });
  }

  /** 给 JSON 文件名用的紧凑时间戳：20261001-1530 */
  function fileStamp(nowDate) {
    var d = nowDate instanceof Date ? nowDate : new Date();
    return String(d.getFullYear()) + pad2(d.getMonth() + 1) + pad2(d.getDate()) +
      '-' + pad2(d.getHours()) + pad2(d.getMinutes());
  }

  return {
    pad2: pad2,
    formatDate: formatDate,
    isValidDateStr: isValidDateStr,
    parseDate: parseDate,
    addDays: addDays,
    todayStr: todayStr,
    diffDays: diffDays,
    compareDateStr: compareDateStr,
    genId: genId,
    cleanText: cleanText,
    isValidTaskText: isValidTaskText,
    escapeHtml: escapeHtml,
    fileStamp: fileStamp
  };
})();

// Node 测试环境用（浏览器里没有 module，这段不会执行）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Util;
}
