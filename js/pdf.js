/**
 * pdf.js —— 把内容打印成 PDF（**仅网页版**）
 *
 * 加载顺序：第 12 个（见 DS 1.4）。
 *
 * ────────────────────────────────────────────────────────────────────────
 * 先说清楚这条路为什么只在网页版成立
 *
 * 安卓 WebView **根本没有实现 `window.print()`** —— 这是 Chromium 主动禁掉的，
 * 不是我们代码写得不对。Capacitor 打出来的 App 里调它不会有任何反应。
 * 要打印只能装原生打印插件（第三方依赖，主流那个还是付费的）。为了一个
 * 「顺带导出」的功能引付费插件，不值得。所以安卓端**从界面上就把这个选项拿掉**
 * （见 DS 4.4、D-18）—— 不留一个点了没反应的按钮。
 *
 * ────────────────────────────────────────────────────────────────────────
 * 思路：先排成和 Markdown 一样的内容，再交给浏览器打印
 *
 * 数据 → Markdown 文本 ─┬─ 存成 .md 文件
 *                       └─ 变成网页 → 套打印样式 → 浏览器打印成 PDF
 *
 * 为什么绕这一圈：Markdown 和 PDF 用**同一份内容**。要是两种格式各写一套排版
 * 代码，将来改了任务显示格式，很容易只改了一处、忘了另一处，导出的两种文件
 * 就对不上了（见 D-04）。
 *
 * 分两层：拼 HTML 是纯函数（Node 里能测），调 window.print() 才碰 DOM。
 */
var Pdf = (function (CONFIG, Util, Store, Exporter) {
  'use strict';

  // =========================================================================
  // 纯函数：数据 → 打印用的 HTML
  // =========================================================================

  /**
   * 一条任务（含阶段）打印成一个 <li>。
   * **每一处文本都必须转义**：这段 HTML 是要塞进页面的，任务文本又是
   * 用户随手输入的 —— 不转义的话，一条写着 `<img src=x onerror=...>` 的任务
   * 会在打印那一刻变成真的标签执行起来。
   */
  function taskHtml(task) {
    var html = '<li class="print__task' +
      (task.completed ? ' print__task--done' : '') + '">' +
      '<span class="print__box">' + (task.completed ? '☑' : '☐') + '</span>' +
      Util.escapeHtml(task.text);

    // 阶段缩进一层印在任务下面，和页面上看到的是同一个结构
    var stages = Array.isArray(task.stages) ? task.stages : [];
    if (stages.length) {
      html += '<ul class="print__stages">';
      for (var s = 0; s < stages.length; s++) {
        html += '<li class="print__stage' +
          (stages[s].completed ? ' print__stage--done' : '') + '">' +
          '<span class="print__box">' + (stages[s].completed ? '☑' : '☐') + '</span>' +
          Util.escapeHtml(stages[s].text) + '</li>';
      }
      html += '</ul>';
    }

    return html + '</li>';
  }

  /** 一个任务块：块名加粗一行，块内任务缩进一层（列表嵌套，和页面同构） */
  function blockHtml(block) {
    var children = Array.isArray(block.tasks) ? block.tasks : [];

    var html = '<li class="print__task print__block' +
      (block.completed ? ' print__task--done' : '') + '">' +
      '<span class="print__box">' + (block.completed ? '☑' : '☐') + '</span>' +
      '<strong class="print__block-name">' + Util.escapeHtml(block.text) + '</strong>';

    if (children.length) {
      // 缩进列表复用 print__stages 的样式规则（都是「下一级缩进」）
      html += '<ul class="print__stages">';
      for (var i = 0; i < children.length; i++) html += taskHtml(children[i]);
      html += '</ul>';
    }

    return html + '</li>';
  }

  /**
   * 生成打印用的 HTML。象限里的条目两种都有：任务和任务块。
   */
  function buildPrintHtml(data, options) {
    options = options || {};
    var dates = options.dateStr ? [options.dateStr] : Store.listDates(data);

    var html = '<h1 class="print__title">四象限任务</h1>';

    if (!dates.length) {
      return html + '<p class="print__empty">（还没有任何数据）</p>';
    }

    for (var i = 0; i < dates.length; i++) {
      var dateStr = dates[i];
      var day = Store.getDayTasks(data, dateStr);

      html += '<section class="print__day">';
      html += '<h2 class="print__date">' + Util.escapeHtml(dateStr) + '</h2>';

      for (var q = 0; q < CONFIG.QUADRANTS.length; q++) {
        var quad = CONFIG.QUADRANTS[q];
        var list = day[quad.id];

        html += '<div class="print__quad" data-quadrant="' + quad.id + '">';
        html += '<h3 class="print__quad-name">' +
          Util.escapeHtml(quad.id + ' ' + quad.name) + '</h3>';

        if (!list.length) {
          html += '<p class="print__quad-empty">（暂无任务）</p>';
        } else {
          html += '<ul class="print__list">';
          for (var k = 0; k < list.length; k++) {
            var item = list[k];
            html += (item.type === 'block') ? blockHtml(item) : taskHtml(item);
          }
          html += '</ul>';
        }
        html += '</div>';
      }
      html += '</section>';
    }

    return html;
  }

  // =========================================================================
  // DOM：交给浏览器打印
  // =========================================================================

  /** 安卓 App 里识别一下 —— 那儿的 window.print() 是空壳，不能给用户这个选项 */
  function isNativeApp() {
    if (typeof window === 'undefined') return false;
    return !!(window.Capacitor &&
              typeof window.Capacitor.isNativePlatform === 'function' &&
              window.Capacitor.isNativePlatform());
  }

  /** 这台设备到底能不能打印 */
  function isAvailable() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return false;
    if (isNativeApp()) return false;
    return typeof window.print === 'function';
  }

  var host = null;
  var token = 0;

  function ensureHost() {
    if (host && document.body.contains(host)) return host;
    host = document.createElement('div');
    // 这个容器平时是 display:none，只在打印时露出来（见 style.css 的 @media print）
    host.className = 'print-doc';
    document.body.appendChild(host);
    return host;
  }

  /**
   * 弹出打印对话框。用户在里面选「另存为 PDF」并确认，文件才会落盘。
   *
   * **这不是「点一下就自动下载」** —— 这是浏览器的机制，改不了，所以界面上
   * 要跟用户讲清楚，别让他以为点了没反应（见 DS 4.4）。
   */
  function print(data, options) {
    if (!isAvailable()) return false;

    var node = ensureHost();
    node.innerHTML = buildPrintHtml(data, options);

    var mine = ++token;

    function cleanup() {
      // 期间又打印过一次的话，这次清理不该把新内容抹掉
      if (mine !== token) return;
      window.removeEventListener('afterprint', cleanup);
      node.innerHTML = '';
    }

    window.addEventListener('afterprint', cleanup);
    // 有些环境不触发 afterprint（打印被取消、或者浏览器不支持），兜个底。
    // 上面那句 token 判断保证它不会误伤下一次打印
    setTimeout(cleanup, 60000);

    window.print();
    return true;
  }

  /**
   * 打印这条路走不通时的退路：把 Markdown 文本生成出来让用户自己复制。
   * 返回文本，由 app.js 决定怎么展示（见 DS 4.2）。
   *
   * 直接复用 exporter 里那份，不另写一套 —— 这正是 D-04「两种格式共用一份内容」
   * 想要的效果：将来改了任务怎么显示，Markdown 和 PDF 一起变，不会只对上一个。
   */
  function fallbackMarkdown(data) {
    return Exporter.buildMarkdown(data);
  }

  return {
    // 纯函数（Node 里可测）
    buildPrintHtml: buildPrintHtml,

    // 环境判断
    isNativeApp: isNativeApp,
    isAvailable: isAvailable,

    // DOM
    print: print,
    fallbackMarkdown: fallbackMarkdown
  };
})(
  typeof CONFIG !== 'undefined' ? CONFIG : require('./config.js'),
  typeof Util !== 'undefined' ? Util : require('./util.js'),
  typeof Store !== 'undefined' ? Store : require('./store.js'),
  typeof Exporter !== 'undefined' ? Exporter : require('./exporter.js')
);

// Node 测试环境用（浏览器里没有 module，这段不会执行）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Pdf;
}
