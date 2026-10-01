/**
 * toast.js —— 所有给用户看的提示，统一从这里弹（见 DS 4.3）
 *
 * 加载顺序：第 4 个（见 DS 1.4）。
 *
 * 为什么要统一出口：
 *   - 浏览器自带的 alert 在手机上样式很丑，而且会**卡住整个页面**
 *   - 只在控制台打日志等于**没提示** —— 用户根本看不到，只会觉得「点了没反应」
 *
 * 错误提示至少停留 5 秒（见 DS 4.3）：用户还没看清就消失，和没提示是一样的。
 */
var Toast = (function (CONFIG) {
  'use strict';

  var host = null;

  function init() {
    host = document.getElementById('toast-host');
    return Toast;
  }

  /**
   * 弹一条提示。
   *
   * @param {string} message 要说的话。**只说人话，不要说错误码**。
   * @param {string} [type]  'info'（默认）| 'warn' | 'error'
   * @param {number} [ms]    停留毫秒数；不传则按类型取默认值
   */
  function show(message, type, ms) {
    if (!host) init();
    if (!host || !message) return;

    var kind = (type === 'error' || type === 'warn') ? type : 'info';

    // 错误要停够久，让用户来得及看清
    var duration = typeof ms === 'number'
      ? ms
      : (kind === 'error' ? CONFIG.TOAST_ERROR_MS : 2600);

    var node = document.createElement('div');
    node.className = 'toast' + (kind === 'info' ? '' : ' toast--' + kind);
    // 用 textContent 而不是 innerHTML：提示里会带用户输入的内容（比如任务文本），
    // 走 innerHTML 就等于给自己开了一个 XSS 口子
    node.textContent = message;
    host.appendChild(node);

    setTimeout(function () {
      if (node.parentNode) node.parentNode.removeChild(node);
    }, duration);

    return node;
  }

  function success(message) { return show(message, 'info'); }
  function warn(message) { return show(message, 'warn'); }
  function error(message) { return show(message, 'error'); }

  return {
    init: init,
    show: show,
    success: success,
    warn: warn,
    error: error
  };
})(
  typeof CONFIG !== 'undefined' ? CONFIG : require('./config.js')
);

// Node 测试环境用（浏览器里没有 module，这段不会执行）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Toast;
}
