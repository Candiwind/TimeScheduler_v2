/**
 * test-load-order.js
 *
 * 检查 index.html 里脚本的加载顺序满不满足依赖关系（见 DS 1.4）。
 *
 * ────────────────────────────────────────────────────────────────────────
 * 为什么值得单独写一个测试
 *
 * 每个 js 文件的末尾都有一句：
 *
 *     typeof Render !== 'undefined' ? Render : require('./render.js')
 *
 * 浏览器里没有 require。所以一旦某个文件排在了它依赖的文件**前面**，
 * 这句就会走到 require 那一半，直接抛「require is not defined」——
 *
 *   - 那个文件当场阵亡，它导出的全局变量（Theme 之类）根本没被创建；
 *   - 接着 app.js 因为找不到它，同样抛错；
 *   - 结果是 **boot() 一次都没跑，整个页面白屏**。
 *
 * 而报错信息只会在控制台里写「require is not defined」，完全指不到
 * 真正的原因（是顺序错了）。靠肉眼排查这件事非常费劲，所以交给测试。
 *
 * 跑法：node test/test-load-order.js
 */
'use strict';

var h = require('./harness');
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var t = h.test;

var ROOT = path.join(__dirname, '..');
var INDEX = path.join(ROOT, 'index.html');
var JS_DIR = path.join(ROOT, 'js');

/** index.html 里 <script src> 的顺序 */
function scriptOrder() {
  var html = fs.readFileSync(INDEX, 'utf8');
  var out = [];
  var re = /<script\s+src="js\/([a-z0-9-]+)\.js"/g;
  var m;
  while ((m = re.exec(html)) !== null) out.push(m[1] + '.js');
  return out;
}

/**
 * 某个 js 文件依赖哪些文件。
 * 认的就是那句 fallback 里的 require('./xxx.js')。
 */
function dependenciesOf(file) {
  var code = fs.readFileSync(path.join(JS_DIR, file), 'utf8');
  var out = [];
  var re = /require\('\.\/([a-z0-9-]+\.js)'\)/g;
  var m;
  while ((m = re.exec(code)) !== null) out.push(m[1]);
  return out;
}

var ORDER = scriptOrder();

// ---------------------------------------------------------------------------
h.group('加载顺序满足依赖关系（这条挂了就是白屏）');

t('index.html 里能读到脚本', function () {
  h.assertTrue(ORDER.length >= 10, '只找到 ' + ORDER.length + ' 个脚本，解析是不是坏了');
});

t('每个脚本都真的存在', function () {
  for (var i = 0; i < ORDER.length; i++) {
    h.assertTrue(fs.existsSync(path.join(JS_DIR, ORDER[i])),
      'index.html 引了 ' + ORDER[i] + '，但 js/ 下没有这个文件');
  }
});

t('每个文件依赖的东西，都排在它前面', function () {
  for (var i = 0; i < ORDER.length; i++) {
    var file = ORDER[i];
    var deps = dependenciesOf(file);

    for (var k = 0; k < deps.length; k++) {
      var dep = deps[k];
      var depAt = ORDER.indexOf(dep);

      h.assertTrue(depAt !== -1,
        file + ' 依赖 ' + dep + '，但 index.html 里根本没加载它');

      h.assertTrue(depAt < i,
        file + ' 依赖 ' + dep + '，可是 ' + dep + ' 排在它后面（第 ' +
        (depAt + 1) + ' 位 vs 第 ' + (i + 1) + ' 位）—— ' +
        '这会让 ' + file + ' 走到 require 那一半，浏览器里直接白屏');
    }
  }
});

t('被依赖最多的那几个都排在最前面', function () {
  // config 和 util 谁都不依赖，必须在最前
  h.assertEqual(ORDER[0], 'config.js');
  h.assertEqual(ORDER[1], 'util.js');
  // app.js 用所有东西，必须在最后
  h.assertEqual(ORDER[ORDER.length - 1], 'app.js');
});

t('render.js 排在 theme.js 前面（theme 要用 render 改主题）', function () {
  // 就是这条被踩过 —— DS 1.4 早期的顺序写反了，整页白屏
  h.assertTrue(ORDER.indexOf('render.js') < ORDER.indexOf('theme.js'),
    'theme.js 依赖 render.js，render 必须先加载');
});

// ---------------------------------------------------------------------------
h.group('所有脚本都能在浏览器那种环境里跑起来');

t('按 index.html 的顺序执行一遍，一个都不能抛错', function () {
  // 造一个最朴素的浏览器环境：有 window / document，但**没有 module**
  // （没有 module 是关键 —— 有的话就会走 require 那条路，测不出问题）
  var sandbox = {
    window: {
      localStorage: {
        getItem: function () { return null; },
        setItem: function () {},
        removeItem: function () {}
      }
    },
    document: {
      readyState: 'loading',           // 让它别真的启动，只测加载阶段
      addEventListener: function () {},
      documentElement: { setAttribute: function () {} },
      getElementById: function () { return null; },
      createElement: function () { return { style: {}, classList: { add: function () {} } }; },
      body: { appendChild: function () {}, contains: function () { return false; } }
    },
    console: console,
    setTimeout: setTimeout,
    Date: Date,
    Math: Math,
    JSON: JSON,
    Blob: function () {},
    URL: { createObjectURL: function () { return ''; }, revokeObjectURL: function () {} },
    FileReader: function () {},
    Uint8Array: Uint8Array,
    DataView: DataView,
    isFinite: isFinite
  };
  sandbox.window.document = sandbox.document;
  var ctx = vm.createContext(sandbox);

  for (var i = 0; i < ORDER.length; i++) {
    var file = ORDER[i];
    var code = fs.readFileSync(path.join(JS_DIR, file), 'utf8');
    try {
      vm.runInContext(code, ctx, { filename: file });
    } catch (err) {
      throw new Error(file + ' 在浏览器环境下会抛错：' + err.message +
        '\n       （最可能的原因：它依赖的东西排在它后面，见上面那条）');
    }
  }
});

t('跑完之后该有的全局变量都在', function () {
  var sandbox = {
    window: { localStorage: { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} } },
    document: {
      readyState: 'loading',
      addEventListener: function () {},
      documentElement: { setAttribute: function () {} },
      getElementById: function () { return null; },
      createElement: function () { return { style: {}, classList: { add: function () {} } }; },
      body: { appendChild: function () {}, contains: function () { return false; } }
    },
    console: console, setTimeout: setTimeout, Date: Date, Math: Math, JSON: JSON,
    Blob: function () {},
    URL: { createObjectURL: function () { return ''; }, revokeObjectURL: function () {} },
    FileReader: function () {},
    Uint8Array: Uint8Array, DataView: DataView, isFinite: isFinite
  };
  sandbox.window.document = sandbox.document;
  var ctx = vm.createContext(sandbox);

  ORDER.forEach(function (file) {
    vm.runInContext(fs.readFileSync(path.join(JS_DIR, file), 'utf8'), ctx, { filename: file });
  });

  // 每个文件导出的全局变量，一个都不能少
  var expected = ['CONFIG', 'Util', 'Store', 'Toast', 'Theme', 'Render',
                  'TaskOps', 'Drag', 'DateNav', 'Exporter', 'Importer', 'App'];
  for (var i = 0; i < expected.length; i++) {
    h.assertTrue(typeof ctx[expected[i]] !== 'undefined',
      expected[i] + ' 没有被创建出来 —— 对应的 js 文件加载时挂了');
  }
});

// ---------------------------------------------------------------------------
h.group('每个文件都要能被 Node 单独 require（编辑器的跳转、测试都要靠它）');

t('所有 js 文件在 Node 里都能加载', function () {
  for (var i = 0; i < ORDER.length; i++) {
    var file = ORDER[i];
    try {
      require(path.join(JS_DIR, file));
    } catch (err) {
      throw new Error(file + ' 在 Node 里加载失败：' + err.message);
    }
  }
});

// ---------------------------------------------------------------------------

h.summary('脚本加载顺序');
