/**
 * test/harness.js —— 极简测试跑法
 *
 * 不装任何东西，`node test/xxx.js` 直接能跑（见 DS 3.2）。
 * 跑完有问题会直接打印出来，并用非 0 退出码收场。
 *
 * 注意：本文件不是测试，是被各个 test-*.js 引用的工具。
 */
'use strict';

var passed = 0;
var failed = 0;
var currentGroup = '';

function group(name) {
  currentGroup = name;
  console.log('\n[' + name + ']');
}

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok   ' + name);
  } catch (err) {
    failed++;
    console.log('  FAIL ' + name);
    console.log('       ' + (err && err.message ? err.message : String(err)));
    if (err && err.stack) {
      var line = String(err.stack).split('\n')[1];
      if (line) console.log('       ' + line.trim());
    }
  }
}

/** 把值转成能读的字符串，用于报错信息 */
function show(v) {
  if (typeof v === 'string') return JSON.stringify(v);
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (typeof v === 'object') {
    try { return JSON.stringify(v); } catch (e) { return String(v); }
  }
  return String(v);
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error((msg ? msg + '：' : '') +
      '期望 ' + show(expected) + '，实际 ' + show(actual));
  }
}

function assertTrue(value, msg) {
  if (!value) {
    throw new Error((msg || '断言为真失败') + '，实际 ' + show(value));
  }
}

function assertFalse(value, msg) {
  if (value) {
    throw new Error((msg || '断言为假失败') + '，实际 ' + show(value));
  }
}

function assertNull(value, msg) {
  if (value !== null) {
    throw new Error((msg ? msg + '：' : '') + '期望 null，实际 ' + show(value));
  }
}

/** 断言 fn 会抛错；可选地检查报错内容里是否包含某段文字 */
function assertThrows(fn, contains, msg) {
  var threw = false;
  var err = null;
  try { fn(); } catch (e) { threw = true; err = e; }
  if (!threw) {
    throw new Error((msg || '期望抛出错误，但没有抛') );
  }
  if (contains) {
    var text = err && err.message ? err.message : String(err);
    if (text.indexOf(contains) === -1) {
      throw new Error('报错内容里没有「' + contains + '」，实际是：' + text);
    }
  }
}

function summary(title) {
  var total = passed + failed;
  console.log('\n' + '-'.repeat(60));
  if (failed === 0) {
    console.log((title || '测试') + '：全部通过（' + total + ' 项）');
  } else {
    console.log((title || '测试') + '：' + failed + ' 项失败 / 共 ' + total + ' 项');
  }
  console.log('-'.repeat(60));
  if (failed > 0) process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// 给 store 相关测试用的假存储
// ---------------------------------------------------------------------------

/**
 * 内存版存储后端，接口和 localStorage 一样。
 *
 * store.js 不认 window，存储后端是**注入**进来的（见 DS 1.7 规矩二），
 * 所以 Node 里塞这个进去就能测，不需要浏览器，也不需要 jsdom。
 *
 * @param {Object} [options]
 * @param {number} [options.quotaBytes] 超过这个总字节数就抛 QuotaExceededError，
 *                                      用来模拟「存储空间满了」（DS 4.2）
 */
function createMemoryStorage(options) {
  options = options || {};
  var quotaBytes = typeof options.quotaBytes === 'number' ? options.quotaBytes : Infinity;
  var map = {};

  function totalBytes() {
    var n = 0;
    for (var k in map) {
      if (Object.prototype.hasOwnProperty.call(map, k)) n += k.length + map[k].length;
    }
    return n;
  }

  return {
    getItem: function (key) {
      return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null;
    },
    setItem: function (key, value) {
      var v = String(value);
      var before = Object.prototype.hasOwnProperty.call(map, key) ? map[key].length : 0;
      var after = totalBytes() - before + v.length;
      if (after > quotaBytes) {
        var err = new Error('存储空间不足（模拟）');
        err.name = 'QuotaExceededError';
        throw err;
      }
      map[key] = v;
    },
    removeItem: function (key) {
      delete map[key];
    },
    /** 测试用：当前所有 key */
    keys: function () {
      return Object.keys(map);
    },
    /** 测试用：总占用字节数 */
    size: totalBytes
  };
}

module.exports = {
  group: group,
  test: test,
  assertEqual: assertEqual,
  assertTrue: assertTrue,
  assertFalse: assertFalse,
  assertNull: assertNull,
  assertThrows: assertThrows,
  summary: summary,
  createMemoryStorage: createMemoryStorage
};
