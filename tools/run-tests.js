/**
 * tools/run-tests.js —— 一次把所有测试跑完
 *
 * 用法：npm test    或者    node tools/run-tests.js
 *
 * 单独跑某一个还是老办法：node test/test-store-recovery.js
 */
'use strict';

var fs = require('fs');
var path = require('path');
var execFileSync = require('child_process').execFileSync;

var TEST_DIR = path.join(__dirname, '..', 'test');

var files = fs.readdirSync(TEST_DIR)
  .filter(function (name) { return /^test-.*\.js$/.test(name); })
  .sort();

if (!files.length) {
  console.error('test/ 里一个测试都没找到');
  process.exit(1);
}

var total = 0;
var failedFiles = [];

files.forEach(function (name) {
  var out = '';
  var ok = true;

  try {
    out = execFileSync(process.execPath, [path.join(TEST_DIR, name)], { encoding: 'utf8' });
  } catch (err) {
    // 有断言失败时子进程用非 0 退出码收场，输出还在 stdout 里
    out = (err && err.stdout) || '';
    ok = false;
  }

  var m = out.match(/（(\d+) 项）/);
  var n = m ? Number(m[1]) : 0;
  total += n;

  if (!ok) failedFiles.push(name);

  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + name.padEnd(30) + n + ' 项');
});

console.log('');
console.log('  合计 ' + total + ' 项，' +
  (failedFiles.length ? failedFiles.length + ' 个文件失败：' + failedFiles.join('、') : '全部通过'));

process.exit(failedFiles.length ? 1 : 0);
