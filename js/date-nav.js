/**
 * date-nav.js —— 日期选择器、切换日期
 *
 * 加载顺序：第 10 个（见 DS 1.4）。
 *
 * 它只管「用户在选日期」这件事，**不管数据、不管重画**。选好了就回调
 * app.js，由 app.js 去读那天的数据重画。当前是哪个日期由 app.js 持有，
 * 这里存一份镜像只是为了让「前一天 / 后一天」知道该从哪天开始算。
 */
var DateNav = (function (CONFIG, Util) {
  'use strict';

  var onChange = null;   // app.js 传进来的回调
  var current = null;    // 当前日期，只为前后翻页用
  var els = {};

  function init(options) {
    options = options || {};
    onChange = options.onChange || null;

    els.picker = document.getElementById('date-picker');
    els.prev = document.getElementById('btn-prev-day');
    els.next = document.getElementById('btn-next-day');
    els.today = document.getElementById('btn-today');

    if (els.prev) {
      els.prev.addEventListener('click', function () { shift(-1); });
    }
    if (els.next) {
      els.next.addEventListener('click', function () { shift(1); });
    }
    if (els.today) {
      els.today.addEventListener('click', function () { set(Util.todayStr()); });
    }
    if (els.picker) {
      els.picker.addEventListener('change', function () {
        var value = els.picker.value;
        if (Util.isValidDateStr(value)) {
          set(value);
        } else {
          // 用户可能把日期框敲空了、或者敲了个 2026-13-01。
          // 不能拿它去查数据（会得到一片空），把框弹回当前日期就好。
          els.picker.value = current || '';
        }
      });
    }
    return DateNav;
  }

  /**
   * 切到某一天。日期非法就直接拒绝，什么都不做。
   * 回调只在**日期真的变了**的时候触发 —— 免得重复点「今天」把页面刷来刷去。
   */
  function set(dateStr) {
    if (!Util.isValidDateStr(dateStr)) return false;
    if (dateStr === current) return true;

    current = dateStr;
    if (els.picker) els.picker.value = dateStr;
    if (onChange) onChange(dateStr);
    return true;
  }

  /** 前后翻 N 天。跨月跨年由 Util.addDays 处理，这里不用管 */
  function shift(days) {
    if (!current) return false;
    var next = Util.addDays(current, days);
    return next ? set(next) : false;
  }

  /** 当前显示的是哪天 */
  function getCurrent() {
    return current;
  }

  /**
   * 强制把 UI 同步成某一天，**不触发回调**。
   * 给启动时用：app.js 自己已经把日期定好了，只需要让控件显示对。
   */
  function syncUI(dateStr) {
    if (!Util.isValidDateStr(dateStr)) return;
    current = dateStr;
    if (els.picker) els.picker.value = dateStr;
  }

  return {
    init: init,
    set: set,
    shift: shift,
    getCurrent: getCurrent,
    syncUI: syncUI
  };
})(
  typeof CONFIG !== 'undefined' ? CONFIG : require('./config.js'),
  typeof Util !== 'undefined' ? Util : require('./util.js')
);

// Node 测试环境用（浏览器里没有 module，这段不会执行）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DateNav;
}
