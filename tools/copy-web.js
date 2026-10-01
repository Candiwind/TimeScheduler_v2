/**
 * tools/copy-web.js —— 把页面文件拷进 www/，给 Capacitor 打包用
 *
 * **这个脚本只在打包那一步跑，平时开发完全不需要它。**
 * 平时还是直接双击 index.html 看效果（见 DS 1.1）。
 *
 * 为什么要多这一步：Capacitor 会把 `webDir` **整个目录**塞进 APK。
 * 如果直接把仓库根目录当 webDir，`node_modules/`、`doc/`、`test/`、`.git/`
 * 会一起被打进去 —— APK 会平白胖出一两百兆，里面还塞着源码和文档。
 *
 * 所以规矩是：**仓库根目录是唯一的源**，www/ 是每次打包时重新生成的产物，
 * 不进版本库（在 .gitignore 里）。改页面永远改根目录那一份，不要改 www/。
 */
'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var OUT = path.join(ROOT, 'www');

/** 要拷进 APK 的东西。**只列真正跑在页面里的**，别的都不该进去 */
var ITEMS = ['index.html', 'css', 'js'];

function rmrf(target) {
  if (!fs.existsSync(target)) return;
  var stat = fs.statSync(target);
  if (stat.isDirectory()) {
    fs.readdirSync(target).forEach(function (name) {
      rmrf(path.join(target, name));
    });
    fs.rmdirSync(target);
  } else {
    fs.unlinkSync(target);
  }
}

function copyItem(from, to) {
  var stat = fs.statSync(from);

  if (stat.isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    fs.readdirSync(from).forEach(function (name) {
      copyItem(path.join(from, name), path.join(to, name));
    });
    return;
  }

  fs.copyFileSync(from, to);
}

function main() {
  // 每次都从干净的目录开始，免得删掉的旧文件还赖在 APK 里
  rmrf(OUT);
  fs.mkdirSync(OUT, { recursive: true });

  var count = 0;

  ITEMS.forEach(function (name) {
    var from = path.join(ROOT, name);
    if (!fs.existsSync(from)) {
      console.error('找不到 ' + name + '，根目录是不是被改动了？');
      process.exit(1);
    }
    copyItem(from, path.join(OUT, name));
  });

  (function countFiles(dir) {
    fs.readdirSync(dir).forEach(function (name) {
      var p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) countFiles(p);
      else count++;
    });
  })(OUT);

  console.log('已生成 www/：' + ITEMS.join('、') + '，共 ' + count + ' 个文件');
  console.log('（www/ 是打包产物，不要手改；改页面请改根目录那一份）');
}

main();
