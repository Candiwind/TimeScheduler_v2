/**
 * exporter.js —— 导出 JSON / Markdown / ZIP，触发 30 天归档的下载，以及 Ctrl+S
 *
 * 加载顺序：第 11 个（见 DS 1.4）。
 *
 * 分两层：
 *   - **生成内容**（Markdown 文本、ZIP 字节）是纯函数，Node 里能测；
 *   - **把它交给浏览器**（下载、打印）才碰 DOM。
 *
 * ZIP 是自己手写的（见 D-05：页面运行时不引第三方库）。压缩方式用「存储」
 * ——也就是不压缩，原样塞进去。JSON 和 Markdown 都是文本，压缩比很高，
 * 但为了省这点体积去自己实现 DEFLATE 不划算，而且那是最容易写错的部分。
 */
var Exporter = (function (CONFIG, Util, Store) {
  'use strict';

  // =========================================================================
  // 纯函数一：UTF-8 编码
  // =========================================================================

  /**
   * 字符串 → UTF-8 字节。
   *
   * 为什么不直接用 TextEncoder：它在老一点的安卓 WebView 里可能没有，
   * 而且自己写这二十行比引一个 polyfill 靠谱（也符合 D-05）。
   * 注意是 **UTF-8 而不是 Latin-1** —— 任务名里全是中文，编码错了
   * 解压出来就是一堆乱码。
   */
  function utf8Bytes(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var code = str.charCodeAt(i);

      // 代理对（emoji 之类）：两个 16 位拼成一个码点
      if (code >= 0xD800 && code <= 0xDBFF && i + 1 < str.length) {
        var next = str.charCodeAt(i + 1);
        if (next >= 0xDC00 && next <= 0xDFFF) {
          code = 0x10000 + ((code - 0xD800) << 10) + (next - 0xDC00);
          i++;
        }
      }

      if (code < 0x80) {
        out.push(code);
      } else if (code < 0x800) {
        out.push(0xC0 | (code >> 6), 0x80 | (code & 0x3F));
      } else if (code < 0x10000) {
        out.push(0xE0 | (code >> 12), 0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F));
      } else {
        out.push(
          0xF0 | (code >> 18),
          0x80 | ((code >> 12) & 0x3F),
          0x80 | ((code >> 6) & 0x3F),
          0x80 | (code & 0x3F)
        );
      }
    }
    return new Uint8Array(out);
  }

  // =========================================================================
  // 纯函数二：CRC32
  // =========================================================================

  var CRC_TABLE = (function () {
    var table = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[n] = c >>> 0;
    }
    return table;
  })();

  /**
   * ZIP 里每条文件头都要带一个 CRC32 校验值。
   * 算错了的后果是：压缩包能被打开、文件列表也能列出来，**但解压时报「文件损坏」**。
   * 所以这个值必须对，test-zip.js 里专门盯着它。
   */
  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) {
      c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  // =========================================================================
  // 纯函数三：打包 ZIP
  // =========================================================================

  /** ZIP 的时间戳格式是 1980 年起的 DOS 格式，不是普通时间戳 */
  function dosDateTime(when) {
    var d = (when instanceof Date) ? when : new Date();
    var time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
    var date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    return { time: time & 0xFFFF, date: date & 0xFFFF };
  }

  function concatBytes(parts) {
    var total = 0;
    for (var i = 0; i < parts.length; i++) total += parts[i].length;

    var out = new Uint8Array(total);
    var at = 0;
    for (var k = 0; k < parts.length; k++) {
      out.set(parts[k], at);
      at += parts[k].length;
    }
    return out;
  }

  /**
   * 把一个文件列表打成 ZIP。
   *
   * @param {Array} files [{ name: 'a.json', bytes: Uint8Array }]
   * @param {Date} [when]
   * @returns {Uint8Array}
   *
   * ZIP 的结构就是三段：每条文件的「本地头 + 内容」，然后是「中央目录」，
   * 最后是「中央目录结束记录」。顺序和偏移必须完全对上，
   * 错一位解压软件就打不开了。
   */
  function buildZip(files, when) {
    var dt = dosDateTime(when);
    var localParts = [];
    var centralParts = [];
    var offset = 0;

    for (var i = 0; i < files.length; i++) {
      var nameBytes = utf8Bytes(files[i].name);
      var dataBytes = files[i].bytes;
      var crc = crc32(dataBytes);

      // ---- 本地文件头 ----
      var local = new Uint8Array(30 + nameBytes.length);
      var lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034B50, true);          // 签名
      lv.setUint16(4, 20, true);                  // 需要的版本
      lv.setUint16(6, 0x0800, true);              // 标志位：文件名是 UTF-8
      lv.setUint16(8, 0, true);                   // 压缩方式：0 = 存储（不压缩）
      lv.setUint16(10, dt.time, true);
      lv.setUint16(12, dt.date, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, dataBytes.length, true);   // 压缩后大小
      lv.setUint32(22, dataBytes.length, true);   // 原始大小（不压缩所以一样）
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);                  // 扩展字段长度
      local.set(nameBytes, 30);

      localParts.push(local, dataBytes);

      // ---- 中央目录的一条 ----
      var cd = new Uint8Array(46 + nameBytes.length);
      var cv = new DataView(cd.buffer);
      cv.setUint32(0, 0x02014B50, true);          // 签名
      cv.setUint16(4, 20, true);                  // 制作版本
      cv.setUint16(6, 20, true);                  // 需要的版本
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, dt.time, true);
      cv.setUint16(14, dt.date, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, dataBytes.length, true);
      cv.setUint32(24, dataBytes.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true);                  // 扩展字段
      cv.setUint16(32, 0, true);                  // 注释
      cv.setUint16(34, 0, true);                  // 起始磁盘号
      cv.setUint16(36, 0, true);                  // 内部属性
      cv.setUint32(38, 0, true);                  // 外部属性
      cv.setUint32(42, offset, true);             // 这条文件的本地头从哪儿开始
      cd.set(nameBytes, 46);
      centralParts.push(cd);

      offset += local.length + dataBytes.length;
    }

    var centralSize = 0;
    for (var c = 0; c < centralParts.length; c++) centralSize += centralParts[c].length;

    // ---- 中央目录结束记录 ----
    var eocd = new Uint8Array(22);
    var ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054B50, true);            // 签名
    ev.setUint16(4, 0, true);                     // 本磁盘号
    ev.setUint16(6, 0, true);                     // 中央目录所在磁盘号
    ev.setUint16(8, files.length, true);          // 本磁盘上的条目数
    ev.setUint16(10, files.length, true);         // 总条目数
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);               // 中央目录从哪儿开始
    ev.setUint16(20, 0, true);                    // 注释长度

    var all = localParts.concat(centralParts);
    all.push(eocd);
    return concatBytes(all);
  }

  // =========================================================================
  // 纯函数四：生成 Markdown
  // =========================================================================

  var MD_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };

  /**
   * 任务文本进 Markdown 之前要挡一下 `<` `>` `&`。
   *
   * 不是为了好看，是**为了安全**：Markdown 会被渲染成网页来打印（见 4.4），
   * 所以任务文本里如果写着 `<img onerror=...>`，不挡的话它会在打印那一刻
   * 变成真的标签执行起来。转成 `&lt;` 之后，渲染回来看还是 `<`，一模一样。
   */
  function escapeMd(text) {
    return String(text).replace(/[&<>]/g, function (ch) { return MD_ESCAPES[ch]; });
  }

  /**
   * 一条任务（含它的阶段）写成 Markdown 行。
   * indent 是前置缩进：顶层任务不缩，块内任务缩一层。
   * 阶段比任务再缩一层，用同样的复选框写法 —— 这样 markdown 渲染出来
   * 就是清清楚楚的多级列表，人一眼看得出谁是谁的子项。
   */
  function pushTaskLines(lines, task, indent) {
    lines.push(indent + '- [' + (task.completed ? 'x' : ' ') + '] ' + escapeMd(task.text));

    var stages = Array.isArray(task.stages) ? task.stages : [];
    for (var s = 0; s < stages.length; s++) {
      lines.push(indent + '  - [' + (stages[s].completed ? 'x' : ' ') + '] ' +
        escapeMd(stages[s].text));
    }
  }

  /**
   * 把数据排成 Markdown：按日期分开，每天四个象限。
   * 象限里的条目有两种：任务，和任务块（块名加粗，块内任务整体缩进一层）。
   *
   * 不传 dateStr 就导出**全部日期**——它是给存档用的，
   * 只存一天没什么意义。
   */
  function buildMarkdown(data, options) {
    options = options || {};
    var dates = options.dateStr ? [options.dateStr] : Store.listDates(data);

    var lines = ['# 四象限任务', ''];

    if (!dates.length) {
      lines.push('（还没有任何数据）');
      lines.push('');
      return lines.join('\n');
    }

    for (var i = 0; i < dates.length; i++) {
      var dateStr = dates[i];
      var day = Store.getDayTasks(data, dateStr);

      lines.push('## ' + dateStr);
      lines.push('');

      for (var q = 0; q < CONFIG.QUADRANTS.length; q++) {
        var quad = CONFIG.QUADRANTS[q];
        var list = day[quad.id];

        lines.push('### ' + quad.id + ' ' + quad.name);
        lines.push('');

        if (!list.length) {
          lines.push('（暂无任务）');
        } else {
          for (var k = 0; k < list.length; k++) {
            var item = list[k];

            if (item.type === 'block') {
              // 块：勾选框照常，块名加粗，让它在列表里一眼认得出是「一组」
              lines.push('- [' + (item.completed ? 'x' : ' ') + '] **' +
                escapeMd(item.text) + '**');

              var children = Array.isArray(item.tasks) ? item.tasks : [];
              for (var b = 0; b < children.length; b++) {
                pushTaskLines(lines, children[b], '  ');
              }
            } else {
              pushTaskLines(lines, item, '');
            }
          }
        }
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  // =========================================================================
  // DOM：把生成好的东西交给浏览器
  // =========================================================================

  /** 文件名用的日期戳，如 2026-10-01 */
  function stamp(when) {
    return Util.todayStr(when instanceof Date ? when : undefined);
  }

  function bytesToBlob(bytes, mime) {
    return new Blob([bytes], { type: mime || 'application/octet-stream' });
  }

  /**
   * 触发一次下载。
   *
   * 返回 true 表示「已经让浏览器去下载了」。**注意这不等于用户真的存下来了** ——
   * 浏览器不告诉我们文件最终有没有落到磁盘上。所以凡是「下载完才能删本地数据」
   * 的地方（30 天归档），都**必须由用户点一下**来触发，不能自己偷偷下，
   * 否则被浏览器拦掉时就是：文件没落盘、本地又删了，数据当场蒸发（见 DS 2.4）。
   */
  function download(filename, blob) {
    if (typeof document === 'undefined' || !document.createElement) return false;

    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // 立刻回收会让部分浏览器来不及取数据，推迟一点
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
    return true;
  }

  /** 导出 JSON：本地全部数据，唯一能重新导入回去的格式 */
  function exportJson(data, when) {
    var text = Store.serialize(data);
    download('quadrant-' + stamp(when) + '.json',
      bytesToBlob(utf8Bytes(text), 'application/json'));
  }

  /** 导出 Markdown */
  function exportMarkdown(data, when) {
    var text = buildMarkdown(data);
    download('quadrant-' + stamp(when) + '.md',
      bytesToBlob(utf8Bytes(text), 'text/markdown'));
  }

  /**
   * 导出 ZIP：JSON + Markdown 两件。
   * 里面没有 PDF —— 程序拿不到 PDF 的字节，这是硬限制（见 4.4、D-18）。
   */
  function exportZip(data, when) {
    var date = stamp(when);
    var zip = buildZip([
      { name: 'quadrant-' + date + '.json', bytes: utf8Bytes(Store.serialize(data)) },
      { name: 'quadrant-' + date + '.md', bytes: utf8Bytes(buildMarkdown(data)) }
    ], when);
    download('quadrant-' + date + '.zip', bytesToBlob(zip, 'application/zip'));
  }

  /**
   * 导出 30 天归档。
   * 调用方必须**先确认这次下载真的发出去了**，才允许从本地删掉那部分数据。
   */
  function exportArchive(data, plan, when) {
    var date = stamp(when);
    var payload = Store.buildArchivePayload(data, plan);
    var text = Store.serialize(payload);
    return download('quadrant-archive-' + date + '.json',
      bytesToBlob(utf8Bytes(text), 'application/json'));
  }

  /**
   * Ctrl+S 的处理。
   *
   * **导出的是 ZIP，不是「JSON 和 Markdown 两个文件」。** 一次手势里连续触发
   * 两个下载，浏览器会当成可疑行为拦下来（弹「是否允许下载多个文件」），
   * 用户在按了 Ctrl+S 之后看到的是一个拦截提示，体验很差。
   * ZIP 里本来就装着这两个格式，一个文件解决。
   */
  function handleCtrlS(data, event) {
    if (event) event.preventDefault();
    exportZip(data);
  }

  // -------------------------------------------------------------------------

  return {
    // 纯函数（Node 里可测）
    utf8Bytes: utf8Bytes,
    crc32: crc32,
    buildZip: buildZip,
    buildMarkdown: buildMarkdown,
    escapeMd: escapeMd,

    // DOM
    download: download,
    exportJson: exportJson,
    exportMarkdown: exportMarkdown,
    exportZip: exportZip,
    exportArchive: exportArchive,
    handleCtrlS: handleCtrlS
  };
})(
  typeof CONFIG !== 'undefined' ? CONFIG : require('./config.js'),
  typeof Util !== 'undefined' ? Util : require('./util.js'),
  typeof Store !== 'undefined' ? Store : require('./store.js')
);

// Node 测试环境用（浏览器里没有 module，这段不会执行）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Exporter;
}
