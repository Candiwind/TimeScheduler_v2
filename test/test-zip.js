/**
 * test-zip.js
 *
 * 检查打包出来的 zip 能不能正常打开（见 DS 3.2）。
 *
 * ZIP 是**手写**的（见 D-05），最容易错的就是字节偏移和 CRC32：
 * 这两样一旦错了，压缩包在文件管理器里看着正常、也能列出文件，
 * **但解压的时候才报「文件损坏」** —— 那时候用户已经以为备份好了。
 *
 * 所以这个测试不是「看一眼能不能跑」，而是**把生成出来的字节重新解析一遍**：
 * 顺着中央目录找到每条文件，验签名、验大小、验 CRC，再和原文比对。
 *
 * 跑法：node test/test-zip.js
 */
'use strict';

var h = require('./harness');
var Exporter = require('../js/exporter');

var t = h.test;

// ---------------------------------------------------------------------------
// 一个极简的 ZIP 解析器，专门用来验我们自己写出来的东西
// ---------------------------------------------------------------------------

function u32(b, at) {
  return (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
}
function u16(b, at) {
  return (b[at] | (b[at + 1] << 8)) >>> 0;
}

/** UTF-8 解码，把字节还原成字符串 */
function decode(bytes) {
  var out = '';
  var i = 0;
  while (i < bytes.length) {
    var b = bytes[i];
    if (b < 0x80) {
      out += String.fromCharCode(b);
      i += 1;
    } else if ((b & 0xE0) === 0xC0) {
      out += String.fromCharCode(((b & 0x1F) << 6) | (bytes[i + 1] & 0x3F));
      i += 2;
    } else if ((b & 0xF0) === 0xE0) {
      out += String.fromCharCode(((b & 0x0F) << 12) |
        ((bytes[i + 1] & 0x3F) << 6) | (bytes[i + 2] & 0x3F));
      i += 3;
    } else {
      var cp = ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3F) << 12) |
               ((bytes[i + 2] & 0x3F) << 6) | (bytes[i + 3] & 0x3F);
      cp -= 0x10000;
      out += String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF));
      i += 4;
    }
  }
  return out;
}

/**
 * 把 zip 解回 [{ name, data }]。
 * 任何一处结构不对就直接抛错 —— 报出来的错就是解压软件会报的错。
 */
function readZip(bytes) {
  // ---- 找中央目录结束记录：从后往前找签名 ----
  var eocdAt = -1;
  for (var i = bytes.length - 22; i >= 0; i--) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4B &&
        bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) {
      eocdAt = i;
      break;
    }
  }
  if (eocdAt === -1) throw new Error('找不到中央目录结束记录，这个 zip 是坏的');

  var totalEntries = u16(bytes, eocdAt + 10);
  var cdSize = u32(bytes, eocdAt + 12);
  var cdOffset = u32(bytes, eocdAt + 16);

  if (cdOffset + cdSize > bytes.length) {
    throw new Error('中央目录偏移越界了');
  }

  // ---- 顺着中央目录一条条读 ----
  var files = [];
  var at = cdOffset;

  for (var n = 0; n < totalEntries; n++) {
    if (u32(bytes, at) !== 0x02014B50) {
      throw new Error('第 ' + (n + 1) + ' 条中央目录记录的签名不对');
    }

    var crcExpected = u32(bytes, at + 16);
    var size = u32(bytes, at + 24);
    var nameLen = u16(bytes, at + 28);
    var localAt = u32(bytes, at + 42);
    var name = decode(bytes.subarray(at + 46, at + 46 + nameLen));

    // ---- 跳到本地头，把内容取出来 ----
    if (u32(bytes, localAt) !== 0x04034B50) {
      throw new Error('「' + name + '」的本地文件头签名不对');
    }
    var lNameLen = u16(bytes, localAt + 26);
    var lExtraLen = u16(bytes, localAt + 28);
    var lCrc = u32(bytes, localAt + 14);
    var lSize = u32(bytes, localAt + 18);

    if (lCrc !== crcExpected) {
      throw new Error('「' + name + '」本地头和中央目录里的 CRC 对不上');
    }
    if (lSize !== size) {
      throw new Error('「' + name + '」本地头和中央目录里的大小对不上');
    }

    var dataAt = localAt + 30 + lNameLen + lExtraLen;
    if (dataAt + size > bytes.length) {
      throw new Error('「' + name + '」的内容越界了');
    }
    var data = bytes.subarray(dataAt, dataAt + size);

    // ---- 验 CRC：这条过了才说明内容真的是完整的 ----
    var crcActual = Exporter.crc32(data);
    if (crcActual !== crcExpected) {
      throw new Error('「' + name + '」的 CRC 校验不过：文件内容已经损坏');
    }

    files.push({ name: name, data: data, size: size });
    at += 46 + nameLen + u16(bytes, at + 30) + u16(bytes, at + 32);  // 跳过扩展字段和注释
  }

  return { files: files, totalEntries: totalEntries };
}

/** 方便：把构建结果解回来看 */
function roundTrip(list) {
  var zip = Exporter.buildZip(list.map(function (f) {
    return { name: f.name, bytes: Exporter.utf8Bytes(f.text) };
  }));
  return { zip: zip, parsed: readZip(zip) };
}

// ---------------------------------------------------------------------------
h.group('结构：能被解压软件正确读出来');

t('打出来的是合法的 zip（解密一遍不报错）', function () {
  var r = roundTrip([{ name: 'a.txt', text: 'hello' }]);
  h.assertEqual(r.parsed.totalEntries, 1);
});

t('文件内容原样还原', function () {
  var r = roundTrip([{ name: 'a.txt', text: 'hello world' }]);
  h.assertEqual(r.parsed.files.length, 1);
  h.assertEqual(r.parsed.files[0].name, 'a.txt');
  h.assertEqual(decode(r.parsed.files[0].data), 'hello world');
});

t('两个文件都在，顺序不变', function () {
  var r = roundTrip([
    { name: 'one.json', text: '{"a":1}' },
    { name: 'two.md', text: '# 标题' }
  ]);
  h.assertEqual(r.parsed.files.length, 2);
  h.assertEqual(r.parsed.files[0].name, 'one.json');
  h.assertEqual(r.parsed.files[1].name, 'two.md');
});

t('第一个字节就是 zip 的签名 PK\\x03\\x04', function () {
  // 有的解压工具就是靠开头这 4 个字节认文件类型的
  var r = roundTrip([{ name: 'a.txt', text: 'x' }]);
  h.assertEqual(r.zip[0], 0x50);
  h.assertEqual(r.zip[1], 0x4B);
  h.assertEqual(r.zip[2], 0x03);
  h.assertEqual(r.zip[3], 0x04);
});

t('压缩方式标的是「存储」，不是「压缩」', function () {
  // 我们没做压缩，标成 deflate 的话解压软件会拿压缩数据去解，直接报错
  var r = roundTrip([{ name: 'a.txt', text: 'x' }]);

  h.assertEqual(u16(r.zip, 8), 0, '本地头里的压缩方式应该是 0');

  // 中央目录里也要标对：解压软件是照着中央目录来的
  var eocdAt = r.zip.length - 22;
  var cdAt = u32(r.zip, eocdAt + 16);
  h.assertEqual(u32(r.zip, cdAt), 0x02014B50, '先确认真找到中央目录了');
  h.assertEqual(u16(r.zip, cdAt + 10), 0, '中央目录里的压缩方式也要是 0');
});

t('文件名标了 UTF-8 标志位', function () {
  // 不标的话，解压软件会用系统的编码去解文件名，中文名字就是乱码
  var r = roundTrip([{ name: 'a.txt', text: 'x' }]);
  h.assertTrue((u16(r.zip, 6) & 0x0800) !== 0, '本地头的标志位里要有 UTF-8 位');
});

t('空文件也能正确打包', function () {
  var zip = Exporter.buildZip([{ name: 'empty.txt', bytes: new Uint8Array(0) }]);
  var parsed = readZip(zip);
  h.assertEqual(parsed.files.length, 1);
  h.assertEqual(parsed.files[0].size, 0);
});

t('一个文件的包', function () {
  var r = roundTrip([{ name: 'only.txt', text: 'only' }]);
  h.assertEqual(r.parsed.files.length, 1);
});

// ---------------------------------------------------------------------------
h.group('CRC32 必须对 —— 错了就报「文件损坏」');

t('已知答案：空内容的 CRC 是 0', function () {
  h.assertEqual(Exporter.crc32(new Uint8Array(0)), 0);
});

t('已知答案：ASCII "123456789" 的 CRC32 是 0xCBF43926', function () {
  // 这是 CRC32 的标准测试向量，对不上说明表算错了
  h.assertEqual(Exporter.crc32(Exporter.utf8Bytes('123456789')), 0xCBF43926);
});

t('内容差一个字节，CRC 就完全不同', function () {
  var a = Exporter.crc32(Exporter.utf8Bytes('hello'));
  var b = Exporter.crc32(Exporter.utf8Bytes('hellp'));
  h.assertFalse(a === b);
});

t('每一条文件的 CRC 都被写进去了，而且是对的', function () {
  // readZip 内部会对每条文件重算 CRC 并比对，这里跑一遍多文件的
  var r = roundTrip([
    { name: 'a.txt', text: '第一条' },
    { name: 'b.txt', text: '第二条' },
    { name: 'c.txt', text: '' }
  ]);
  h.assertEqual(r.parsed.files.length, 3);
});

// ---------------------------------------------------------------------------
h.group('中文不能变成乱码');

t('中文文件名', function () {
  var r = roundTrip([{ name: '四象限任务.json', text: 'x' }]);
  h.assertEqual(r.parsed.files[0].name, '四象限任务.json');
});

t('中文内容', function () {
  var r = roundTrip([{ name: 'a.md', text: '- [ ] 写季度报告' }]);
  h.assertEqual(decode(r.parsed.files[0].data), '- [ ] 写季度报告');
});

t('中英文混排 + emoji', function () {
  var text = '写季度报告 report 😀 done';
  var r = roundTrip([{ name: 'a.txt', text: text }]);
  h.assertEqual(decode(r.parsed.files[0].data), text);
});

// ---------------------------------------------------------------------------
h.group('和真实导出的内容对得上');

t('真实数据导出的 zip，两件套内容都完整', function () {
  var Store = require('../js/store');
  var TaskOps = require('../js/task-ops');

  var data = Store.createEmpty();
  TaskOps.addTask(data, '2026-10-01', 'I', '写季度报告');
  TaskOps.addTask(data, '2026-10-01', 'II', '准备下周的分享');
  TaskOps.addTask(data, '2026-10-02', 'IV', '买咖啡豆');

  var json = Store.serialize(data);
  var md = Exporter.buildMarkdown(data);

  var zip = Exporter.buildZip([
    { name: 'quadrant-2026-10-01.json', bytes: Exporter.utf8Bytes(json) },
    { name: 'quadrant-2026-10-01.md', bytes: Exporter.utf8Bytes(md) }
  ]);

  var parsed = readZip(zip);
  h.assertEqual(parsed.files.length, 2);

  // JSON 那件要能原样解析回来
  var jsonText = decode(parsed.files[0].data);
  h.assertEqual(jsonText, json);
  var restored = JSON.parse(jsonText);
  h.assertEqual(restored.dates['2026-10-01'].I[0].text, '写季度报告');

  // Markdown 那件要包含所有三天的内容
  var mdText = decode(parsed.files[1].data);
  h.assertTrue(mdText.indexOf('写季度报告') !== -1);
  h.assertTrue(mdText.indexOf('准备下周的分享') !== -1);
  h.assertTrue(mdText.indexOf('买咖啡豆') !== -1);
});

// ---------------------------------------------------------------------------
h.group('边界');

t('零个文件也能打出一个合法的空包', function () {
  // 解压软件打开会看到「0 个文件」，但不该报错
  var zip = Exporter.buildZip([]);
  var parsed = readZip(zip);
  h.assertEqual(parsed.totalEntries, 0);
  h.assertEqual(parsed.files.length, 0);
});

t('大一点的内容（几千条任务）也能正确打包', function () {
  var Store = require('../js/store');
  var TaskOps = require('../js/task-ops');

  var data = Store.createEmpty();
  for (var i = 0; i < 2000; i++) {
    TaskOps.addTask(data, '2026-10-01', 'I', '任务编号 ' + i + ' 内容内容内容');
  }

  var json = Store.serialize(data);
  var zip = Exporter.buildZip([
    { name: 'big.json', bytes: Exporter.utf8Bytes(json) }
  ]);

  var parsed = readZip(zip);
  h.assertEqual(decode(parsed.files[0].data), json, '大文件的内容也不能出错');
});

// ---------------------------------------------------------------------------

h.summary('exporter.js 的 ZIP 打包');
