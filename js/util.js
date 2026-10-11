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
  // 阅读栏的时间戳（v2.8 需求 2）
  //
  // **记的是日期，不是几点几分**：需求「阅读板块的时间指的是日期」。起始日期
  // 默认今天，读完时自动记下今天 —— 读书这件事按天记就够了，记到分钟既没人填
  // 也不好看（v2.8 初版按时分做过，已按反馈改掉，见 DS 2.37 修订）。
  // 日期一律走**本地时区**，不用 toISOString（那会在东八区差一天）。
  // ---------------------------------------------------------------------------

  /**
   * 阅读栏的时间戳合不合法：'YYYY-MM-DD' 合法，**老的 'HH:MM' 也收**。
   *
   * 后半句是兼容，不是功能：v2.8 初版存的是时分，用户手里可能已经有那样的
   * JSON。清洗和导入走这个宽松版（把老值当脏数据抹掉 = 用户记的东西真没了），
   * **写操作走严格版** `isValidDateStr` —— 新写入的一律是日期。
   */
  function isValidReadingStamp(s) {
    return isValidDateStr(s) || isValidTimeStr(s);
  }

  var TIME_RE = /^([0-9]{2}):([0-9]{2})$/;

  /**
   * 是不是一个合法的 'HH:MM'（00:00 ~ 23:59）。空串不算合法。
   *
   * v2.8 起**只有**阅读栏的兼容分支还在用它（读老数据），新代码不要再用。
   * 配套的 `formatTime` / `nowTimeStr`（Date → 'HH:MM'）已经删掉了：口径改成
   * 日期之后一个调用点都不剩，留着只会让人以为阅读栏还能记到分钟。
   */
  function isValidTimeStr(s) {
    if (typeof s !== 'string') return false;
    var m = TIME_RE.exec(s);
    if (!m) return false;
    var hh = Number(m[1]);
    var mm = Number(m[2]);
    return hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59;
  }

  // ---------------------------------------------------------------------------
  // 默认完成时段（v2.12 需求 8）
  //
  // 「新添加的任务或阶段自动分配时间」：第一、三象限按**当前时刻**落在哪一段，
  // 第二、四象限一律「晚上」（那些是「不急」的事，默认放到晚上）。
  //
  // 这里只返回**序号**（0=早上 … 5=晚上），不返回中文串：时段名是 CONFIG.SLOTS
  // 里的用户数据（写进 JSON 就不能改了），util.js 是最底层、不依赖 CONFIG，
  // 把六个中文串抄一份到这里只会多一处要同步的地方。
  // ---------------------------------------------------------------------------

  /**
   * 当前时刻落在第几个时段（0=早上 1=上午 2=中午 3=下午 4=傍晚 5=晚上）。
   *
   * 边界按需求原话切：8:00 前早上、8:00~12:00 上午、12:00~14:00 中午、
   * 14:00~17:00 下午、17:00~19:00 傍晚、19:00 之后晚上 —— 每个区间的
   * **左端点**归它自己（12:00 算中午，不算上午）。
   *
   * @param {Date} [date] 不传就是此刻；测试靠它把时间钉死
   */
  function slotIndexByClock(date) {
    var d = (date instanceof Date && !isNaN(date.getTime())) ? date : new Date();
    var h = d.getHours();
    if (h < 8) return 0;
    if (h < 12) return 1;
    if (h < 14) return 2;
    if (h < 17) return 3;
    if (h < 19) return 4;
    return 5;
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

  // ---------------------------------------------------------------------------
  // 小文件（v2.12 需求 2）
  // ---------------------------------------------------------------------------

  /**
   * 一段文本的 UTF-8 字节数。
   *
   * 用来算小文件占了多少空间 —— 用 `str.length`（UTF-16 码元数）算的话，
   * 中文一个一个算 1、emoji 算 2，和真正写进 localStorage 的体积差一倍以上，
   * 「不超过 1M」这个提示就成了拍脑袋的假数字。编码规则和 exporter.utf8Bytes
   * 同一套（这里只数长度，不生成字节）。
   */
  function utf8ByteLength(str) {
    var s = typeof str === 'string' ? str : '';
    var n = 0;
    for (var i = 0; i < s.length; i++) {
      var code = s.charCodeAt(i);

      // 代理对（emoji 之类）：两个 16 位拼成一个码点（4 字节）
      if (code >= 0xD800 && code <= 0xDBFF && i + 1 < s.length) {
        var next = s.charCodeAt(i + 1);
        if (next >= 0xDC00 && next <= 0xDFFF) {
          code = 0x10000 + ((code - 0xD800) << 10) + (next - 0xDC00);
          i++;
        }
      }

      if (code < 0x80) n += 1;
      else if (code < 0x800) n += 2;
      else if (code < 0x10000) n += 3;
      else n += 4;
    }
    return n;
  }

  /**
   * 把用户起的名字收拾成能当文件名用的样子：去掉路径分隔符和各系统不认的字符，
   * 控制字符也去掉，首尾空白/点清掉（Windows 上以点结尾的名字存不下来）。
   * 全被清光了就给个兜底名 —— 下载一个没名字的文件比下载失败更让人困惑。
   */
  function safeFileName(name, fallback) {
    var s = (typeof name === 'string' ? name : '')
      .replace(/[\\/:*?"<>|\u0000-\u001F]/g, '')
      .replace(/^[\s.]+|[\s.]+$/g, '');
    if (s.length > 80) s = s.slice(0, 80);
    return s || (fallback || 'untitled');
  }

  /** 是不是 .txt（需求 2「只支持 txt 格式」；大小写不敏感，前后空白不算） */
  function isTxtFileName(name) {
    return /\.txt$/i.test(cleanText(name));
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
    isValidReadingStamp: isValidReadingStamp,
    isValidTimeStr: isValidTimeStr,
    slotIndexByClock: slotIndexByClock,
    genId: genId,
    cleanText: cleanText,
    isValidTaskText: isValidTaskText,
    escapeHtml: escapeHtml,
    fileStamp: fileStamp,
    utf8ByteLength: utf8ByteLength,
    safeFileName: safeFileName,
    isTxtFileName: isTxtFileName
  };
})();

// Node 测试环境用（浏览器里没有 module，这段不会执行）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Util;
}
