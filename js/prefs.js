/**
 * prefs.js —— 安卓原生存储（Capacitor Preferences）的适配器
 *
 * 加载顺序：第 4 个（见 DS 1.4）。
 *
 * ────────────────────────────────────────────────────────────────────────
 * 它解决的是什么问题
 *
 * 安卓系统在存储空间紧张时，会回收 App 内置浏览器的 localStorage。
 * 这是官方写明的已知行为 —— Capacitor 文档说 localStorage「必须被视为临时的，
 * 你的 App 需要预期数据最终会丢失」。
 *
 * 所以安卓端每次保存时，额外再往系统自己的存储（SharedPreferences）里写一份。
 * localStorage 读不出来时，靠这份把数据救回来（见 DS 2.1、2.2、R-10）。
 *
 * ────────────────────────────────────────────────────────────────────────
 * 为什么要包这么一层
 *
 * Capacitor 的 Preferences 接口**是异步的**（返回 Promise），而 store.js
 * 通篇是同步的 —— 它得能在 Node 里简简单单地跑测试，不该被 Promise 污染。
 *
 * 做法是**在这一个地方把异步收口**：
 *   - 启动时（`preload()`）把两份数据一次性读进内存；
 *   - 之后给 store.js 的是一个**同步的壳**：读走内存，写内存 + 甩一个异步落盘出去。
 *
 * 网页版里 `window.Capacitor` 不存在，这里所有函数都会安静地退化成空操作 ——
 * 所以这个文件在浏览器里加载是完全安全的。
 */
var Prefs = (function (CONFIG) {
  'use strict';

  var cache = {};
  var plugin = null;
  var loaded = false;

  /** 现在是不是跑在安卓 App 里 */
  function available() {
    if (typeof window === 'undefined') return false;
    var C = window.Capacitor;
    return !!(C && C.Plugins && C.Plugins.Preferences);
  }

  /**
   * 启动时把两份数据读进内存。
   *
   * **这个 Promise 永远不会 reject。** 读不出来就当没存过 ——
   * 绝不能因为原生存储出了点问题，就让整个程序起不来（那才是真的丢数据）。
   */
  function preload() {
    if (!available()) {
      loaded = true;
      return Promise.resolve(false);
    }

    plugin = window.Capacitor.Plugins.Preferences;

    var keys = [CONFIG.PREFS_KEYS.backup, CONFIG.PREFS_KEYS.marker];
    var jobs = [];

    for (var i = 0; i < keys.length; i++) {
      jobs.push(readOne(keys[i]));
    }

    return Promise.all(jobs).then(function () {
      loaded = true;
      return true;
    })['catch'](function () {
      // 兜底：上面每个都自己 catch 过了，正常走不到这里
      loaded = true;
      return false;
    });
  }

  function readOne(key) {
    return plugin.get({ key: key }).then(function (result) {
      cache[key] = (result && typeof result.value === 'string') ? result.value : null;
    })['catch'](function () {
      cache[key] = null;
    });
  }

  /**
   * store.js 要的那个**同步**存储壳。
   * 网页版返回 null —— store.js 会直接跳过所有 durable 相关的动作。
   */
  function adapter() {
    if (!available()) return null;

    return {
      getItem: function (key) {
        return Object.prototype.hasOwnProperty.call(cache, key) ? cache[key] : null;
      },

      setItem: function (key, value) {
        var text = String(value);
        cache[key] = text;
        // 甩出去就不管了。失败了也不该影响页面 —— 内存里那份还在，
        // 而且 localStorage 那份才是日常读写的主力（见 DS 2.1 的分工）
        plugin.set({ key: key, value: text })['catch'](function () {});
      },

      removeItem: function (key) {
        delete cache[key];
        plugin.remove({ key: key })['catch'](function () {});
      }
    };
  }

  /** 测试和排查用 */
  function isLoaded() { return loaded; }
  function isNative() { return available(); }

  return {
    available: available,
    preload: preload,
    adapter: adapter,
    isLoaded: isLoaded,
    isNative: isNative
  };
})(
  typeof CONFIG !== 'undefined' ? CONFIG : require('./config.js')
);

// Node 测试环境用（浏览器里没有 module，这段不会执行）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Prefs;
}
