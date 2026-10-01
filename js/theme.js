/**
 * theme.js —— 亮色 / 暗色主题的切换和记住
 *
 * 加载顺序：第 5 个（见 DS 1.4）。
 *
 * 主题是**本机偏好**，不进用户数据（见 D-11）：它存在自己单独的 key 里
 * （`quadrant_ui_theme`，见 2.2），导出、备份都带不走它。
 * 换台设备想要暗色，得自己再点一下 —— 这是对的，因为「看着舒服」是设备的事，
 * 不是数据的事。
 *
 * 真正改颜色的是 CSS 变量：这里只负责往 <html> 上挂一个 data-theme，
 * 剩下交给 style.css。
 */
var Theme = (function (CONFIG, Store, Render) {
  'use strict';

  /** 亮↔暗。纯函数，好测 */
  function next(current) {
    return current === CONFIG.THEMES.LIGHT ? CONFIG.THEMES.DARK : CONFIG.THEMES.LIGHT;
  }

  /** 把认识的、不认识的值都收敛成合法主题。默认亮色（见 2.2） */
  function normalize(theme) {
    return theme === CONFIG.THEMES.DARK ? CONFIG.THEMES.DARK : CONFIG.THEMES.LIGHT;
  }

  // 按钮上的图标表示「点了会变成什么」，不是「现在是什么」——
  // 显示当前状态的按钮，用户会以为点了是刷新
  var ICONS = {};
  ICONS[CONFIG.THEMES.LIGHT] = { text: '☾', label: '切换到暗色主题' };
  ICONS[CONFIG.THEMES.DARK]  = { text: '☀', label: '切换到亮色主题' };

  var button = null;
  var current = null;

  /** 真正把主题应用出去 */
  function apply(theme) {
    var t = normalize(theme);
    current = t;
    Render.setTheme(t);

    if (button) {
      var icon = ICONS[t];
      button.textContent = icon.text;
      button.setAttribute('aria-label', icon.label);
      button.setAttribute('title', icon.label);
    }
    return t;
  }

  /**
   * 切换。
   * **先存再应用**：万一存不进去（空间满了之类），下次打开回到亮色，
   * 至少这一次点的时候是对的。
   */
  function toggle() {
    var t = apply(next(current));
    Store.setTheme(t);
    return t;
  }

  function init() {
    button = document.getElementById('btn-theme');

    // 启动时用存下来的那个（存不出来或没存过就是亮色）
    apply(Store.getTheme());

    if (button) {
      button.addEventListener('click', function () { toggle(); });
    }
    return Theme;
  }

  return {
    // 纯函数
    next: next,
    normalize: normalize,

    // DOM
    init: init,
    apply: apply,
    toggle: toggle,
    getCurrent: function () { return current; }
  };
})(
  typeof CONFIG !== 'undefined' ? CONFIG : require('./config.js'),
  typeof Store !== 'undefined' ? Store : require('./store.js'),
  typeof Render !== 'undefined' ? Render : require('./render.js')
);

// Node 测试环境用（浏览器里没有 module，这段不会执行）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Theme;
}
