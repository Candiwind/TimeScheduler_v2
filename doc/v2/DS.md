# DS-TimeScheduler（第二版）

## 版本记录

**2026/10/7 v2.11**

对应 `doc/v2/requirements.txt` **最前面两条**（v2.10 之后补充的两条手机端排版收尾），以及 `doc/v2/FS.md` v2.11。**完全不改存储格式**：`schemaVersion` 仍为 1，`Store.serialize` 的输出与 v2.10 逐字节同构，没有新增任何字段。两条都是**手机端排版** —— 一条是文字格的 CSS 上限，一条是渲染层给右侧控件加一个包裹盒子 —— 因此 v2.1–v2.10 导出的 JSON 都能照常导入，v2.11 导出的文件老版本也读得下。

| 条 | 需求 | 设计在哪 | 状态 |
|---|---|---|---|
| 1 | 手机端文字换行时，把第一行勾选框右侧的空间也用上 | 2.46 + D-77 | 已实现（纯 CSS：文字格夹 `max-width`，把长文按回第一行） |
| 2 | 手机端右侧按键：够放就显示在这一行右侧；放不下就**整组**折到下一行、靠右对齐、左侧留空 | 2.46 + D-76 | 已实现（`.task__actions` 包裹 + 手机端 `flex` + `margin-left: auto`） |

**2026/10/7 v2.10**

对应 `doc/v2/requirements.txt` 第 1~4 条（v2.9 之后追加的四条），以及 `doc/v2/FS.md` v2.10。**完全不改存储格式**：`schemaVersion` 仍为 1，`Store.serialize` 的输出与 v2.9 逐字节同构，没有新增任何字段。四条全是**交互与样式**层的改动，因此 v2.1–v2.9 导出的 JSON 都能照常导入，v2.10 导出的文件老版本也读得下。

| 条 | 需求 | 设计在哪 | 状态 |
|---|---|---|---|
| 1 | 各象限 / 时间视图各时间栏 / 计划池里，勾选完成状态后**不弹回顶部** | 2.41 + D-72 | 已实现（渲染层只提供「拍 / 贴快照」两个动作，入口层决定何时用） |
| 2 | 手机端**象限和计划池**的拖动把手统一成勾选框 | 2.42 + D-73（**反转 D-62**，解 R-33） | 已实现（池条目本体不再拦触摸，手机端池列表可滚动） |
| 3 | 象限 ↔ 计划池**双向**拖拽，象限里能做的池里都要有 | 2.43 + D-74（**放开 D-58 的跨容器禁令**） | 已实现（落点统一成 `{ region, quadrantId, blockId, toSlot, index }`） |
| 4 | 手机端排版：按钮折到下一行、文字占满整行并换行 | 2.44 + D-75 | 已实现（纯 CSS，`max-width: 600px`） |

**2026/10/6 v2.9**

对应 `doc/v2/requirements.txt` 第 1 条（v2.8 补充之后追加的一条），以及 `doc/v2/FS.md` v2.9。**几乎不改存储格式**（`schemaVersion` 仍为 1）：只多一个**可选布尔**字段 `highlight`，挂在任务 / 阶段 / 块（象限的块与池里的块）身上，老数据 / 老备份零影响（同 `bonus` / `slot` / `plannedDate` 的取舍，append-only）。

| 条 | 需求 | 设计在哪 | 状态 |
|---|---|---|---|
| 1 | 连续双击给任务 / 任务块 / 阶段的**整体**加浅橙高亮，**盖满字高** | 2.40 + D-71 + R-41 / R-42 | 已实现（纯标记，不进统计；随 JSON 导出导入，兼容老版本） |

**2026/10/6 v2.8**

对应 `doc/v2/requirements.txt` 第 1~3 条（v2.7 之后追加的三条），以及 `doc/v2/FS.md` v2.8。**几乎不改存储格式**（`schemaVersion` 仍为 1）：只多一个**可选**顶层字段 `reading`，老数据 / 老备份零影响；板块收起状态进的是既有的 `foldState` key（D-53 那一条路），不碰主数据。

| 条 | 需求 | 设计在哪 | 状态 |
|---|---|---|---|
| 1 | 时间视图下计划池也排到下面 | 2.36 | 已实现（纯版面顺序） |
| 2 | 阅读栏（正在阅读 / 已读完成 / 起始与完成日期 / 展示上限） | 2.37 + D-64 / D-65 / D-66 | 已实现 |
| 3 | 阅读栏 / 计划池 / 模板池可收起，收起状态刷新后保持 | 2.38 | 已实现 |

**2026/10/6 v2.8 补充**（试用反馈的几条）

| 条 | 需求 | 设计在哪 | 状态 |
|---|---|---|---|
| 1 | 阅读栏点「＋」输入后**回车没有反应** | 2.37（修订一）+ R-38 | 已修复 |
| 2 | 计划池里的任务块渲染格式对齐象限，**带一个蓝色边框** | 2.39 | 已实现（纯样式） |
| 3 | 阅读栏的时间指的是**日期**（不是时分） | 2.37（修订二）+ D-67 / R-39 | 已实现（兼容老文件的 `HH:MM`） |
| 4 | 阅读栏的日期设定改成和计划池**一套格式**（点得动、改得掉、清得掉） | 2.37（修订三）+ D-70 / R-40 | 已实现 |

**2026/10/6 v2.7**

对应 `doc/v2/requirements.txt` 第 1 条（v2.6 之后追加的一条），以及 `doc/v2/FS.md` v2.7。**不改存储格式**（`schemaVersion` 仍为 1）：池内块本来就有 `completed` 和 `tasks`（v2.2 起 `syncBlockCompleted` 就在维护），本版只是把界面按同一套画出来。

| 条 | 需求 | 设计在哪 | 状态 |
|---|---|---|---|
| 1 | 池内任务块与象限任务块同格式同功能 | 2.34 + 2.35 + D-61 / D-62 / D-63 | 已实现 |

**2026/10/6 v2.6**

对应 `doc/v2/requirements.txt` 第 1~4 条（v2.5 之后追加的四条），以及 `doc/v2/FS.md` v2.6。**不改存储格式**（`schemaVersion` 仍为 1）：四条全部是既有结构的新行为，无新增字段。

| 条 | 需求 | 设计在哪 | 状态 |
|---|---|---|---|
| 1 | 池内拖拽改顺序（各自列表内） | 2.30 + D-58 | 已实现 |
| 2 | 池条目「导入」到第二象限（移动语义） | 2.31 + D-59 | 已实现 |
| 3 | 计划日期到了自动导入今天 | 2.32 + D-60 | 已实现 |
| 4 | Markdown 日报只记当前查看的那天 | 2.33 | 已实现 |

**2026/10/5 v2.5**

代码审查后的修正版，不改存储格式（`schemaVersion` 仍为 1），只改口径与四处实现缺陷：

| 条 | 改了什么 | 设计在哪 | 状态 |
|---|---|---|---|
| 1 | 「全完成」口径改为**每个阶段 / 子任务都做完**才算（Bonus 没做完不算），与完成率口径分开 | 2.16（改写）+ D-56（修订 D-42/D-43） | 已实现 |
| 2 | 时间视图新增任务改为排该时段**最前**，与象限视图统一（原「排最后」作废） | 2.17 + 2.21 + D-57（修订 D-50） | 已实现 |
| 3 | 池内**块里的任务**拖回象限不再静默失败 | 2.20 + 2.29 | 已实现 |
| 4 | 推迟按钮（任务 / 块头 / 阶段）不再被当成拖拽把手 | 2.29 | 已实现 |
| 5 | 加阶段 / 改阶段的顺手展开也落本机折叠状态 | 2.23 + 2.29 | 已实现 |
| 6 | 两处过期注释（addTask「加在末尾」、块内任务无推迟按钮）改正 | 2.29 | 已实现（注释） |

对应 `doc/v2/FS.md` v2.5。**这两条口径是用户明确决定反过来的**（原 D-42 / D-50 按当时需求写，现按 2026/10/5 的决定改；`requirements.txt` 第 2、3 条正文已同步注明）。

**2026/10/5 v2.4**

对应 `doc/v2/requirements.txt` 第 3 条（搜索），以及 `doc/v2/FS.md` v2.4：

| 条 | 需求 | 设计在哪 | 状态 |
|---|---|---|---|
| 3 | 象限 / 时间模式下按关键词搜索过滤 | 2.28 + D-55 | 已实现 |

**2026/10/5 v2.3**

对应 `doc/v2/requirements.txt` 第 1~2 条（v2.2 之后追加的两条），以及 `doc/v2/FS.md` v2.3：

| 条 | 需求 | 设计在哪 | 状态 |
|---|---|---|---|
| 1 | 任务块推迟键低调化 | 2.26 | 已实现（纯样式） |
| 2 | 块内无阶段任务支持推迟 | 2.27 + D-54 | 已实现 |

**2026/10/5 v2.2**

对应 `doc/v2/requirements.txt` 第 1~6 条（v2.1 七条之后追加的六条），以及 `doc/v2/FS.md` v2.2。同样按「先补 FS → 再补 DS → 实现 → 补测试」走：

| 条 | 需求 | 设计在哪 | 状态 |
|---|---|---|---|
| 1 | 四象限高度互不牵制 | 2.24 | 已实现（纯样式） |
| 2 | 导入自选合并 / 覆盖 | 2.22 + D-52 | 已实现 |
| 3 | 象限任务默认加到开头 | 2.21 + D-50 | 已实现 |
| 4 | 计划池任务块 / 整体推迟 / 按任务 DDL | 2.20 + D-51 | 已实现 |
| 5 | 折叠状态本机持久化 | 2.23 + D-53 | 已实现 |
| 6 | 应用重命名 MyPal | 2.25 | 已实现 |

**2026/10/5 v2.1**

对应 `doc/v2/requirements.txt` 的 7 条需求，以及 `doc/v2/FS.md` v2.1。逐条按「先补 FS → 再补 DS → 实现 → 补测试」走：

| 条 | 需求 | 设计在哪 | 状态 |
|---|---|---|---|
| 1 | 日报自动加入当日统计 | 2.15 + D-44 | 已实现 |
| 2 | Bonus 任务 / 阶段 | 2.16 + D-42/D-43 | 已实现（「全完成」口径 v2.5 改，见 D-56） |
| 3 | 时间视图拖拽 + 位置记忆 | 2.17 + D-45 | 已实现（新增排最前 v2.5 改，见 D-57） |
| 4 | 时间视图象限浅色底 | 2.19 | 已实现（纯样式） |
| 5 | 各面板最大高度 + 滚动 | 2.19 | 已实现（网页版；手机端媒体查询同套 CSS） |
| 6 | 完成自动沉底 | 2.18 + D-46/D-47 | 已实现 |
| 7 | 移动端拖动把手 | 2.19 + D-48 | 已实现（网页版与 APK 共用；真机手感待验） |

**2026/10/1 v2.0**

对应 `doc/v2/FS.md` v2.0 与 `doc/v1/DS.md`（v2 的第二版在 v1 基础上补全，工程与存储方案完全沿用 v1，见「与第一版设计的关系」）。

---

## 与第一版设计的关系

v2.1 的七条需求全部是**在 v1 既有架构上做加法**，没有推倒任何一条 v1 的设计决定：

- 数据模型仍是一个 `schemaVersion: 1` 的 JSON，新增字段全部是**纯追加、可选**（和 v1 的 `stages` / `slot` / `plannedDate` 同一条取舍）——老数据、老备份**零影响**，`schemaVersion` 不升。
- 分层仍沿用「数据层 / 业务层 / 渲染层 / 交互层 / 入口层」，七条需求分别落在既有文件里，不新增模块。
- 统计仍以 `task-ops.getProgress` 为全项目唯一进度算法，Bonus 口径在它内部改，渲染 / 统计面板 / 日报三处自动保持一致。
- 拖拽仍是 Pointer Events 一套机制，时间视图的拖拽只是给 `drag.js` 多认一种「可拖对象」，真正挪数据仍由 `task-ops.js` 完成。

想查 v1 的口径（存储、备份、导入去重、阶段 / 任务块 / 计划池 / 时段 / 时间视图 / 模板的既有设计），看 `doc/v1/DS.md`。本文只写 v2.1 **新增或改变**的部分。

---

## 二、v2.1 的七条需求怎么实现

### 2.15 日报自动加入当日统计（需求 1）

**是什么**：导出的日报里，每个日期标题下方自动加一行当日统计。

**「日报」指的是什么**：本应用没有独立的「日报」功能页；用户能拿到的成文产出就是**导出**——Markdown（`.md`）和 PDF（由 Markdown 内容打印而来）。所以「日报自动加入统计」落实为：`exporter.js` 生成的 Markdown 和 `pdf.js` 生成的打印页，都在每个 `## 日期` 标题后加一行统计。

**统计行格式**（一条，纯文本）：

```
> ✅ 已完成 X / 总数 Y · 完成率 Z%
```

- `X` = `getStats(done)`，`Y` = `getStats(total)`，`Z%` = `formatRate(done, total)`。
- 有 Bonus 时在末尾补一句 `· 含 Bonus B/C`（`B` = 已完成 Bonus 数，`C` = Bonus 总数），没有则省略。
- Bonus 项在 Markdown / PDF 的任务文字前加 🎁 前缀（任务和阶段都加）。

**实现**：

- `exporter.js` 新增导出函数 `statsLine(data, dateStr)`：调 `TaskOps.getStats(data, dateStr)` 拼出上面的字符串。`buildMarkdown` 在每个 `## 日期` + 空行后 `lines.push(Exporter.statsLine(...))`。为拿到 `getStats`，`exporter.js` 的 IIFE 依赖新增 `TaskOps`（第 4 个参数 + 末尾 `require('./task-ops.js')` 兜底），task-ops 在加载顺序里排第 8、早于 exporter（第 11），`test-load-order.js` 会自动校验这条依赖。
- `pdf.js` 的 `buildPrintHtml` 在每个日期标题后加 `<p class="print__stats">` + 同一个 `Exporter.statsLine(...)` 文本（复用，不复制逻辑）；`.print__stats` 在打印样式块里定义。

**为什么统计走 `getStats` 而不是各导出函数自己算**：统计口径（含 Bonus，见 2.16）只有 `getStats` 一份实现，日报直接消费它，才不会出现「日报数字和首页对不上」（FS 六、统计与日报那条「三处一个算法」的直接延伸）。

### 2.16 Bonus 任务与阶段（需求 2）

**是什么**：任务或阶段可以标记为 Bonus，图标用礼品 🎁。完成率计算时 Bonus 是**额外加分**：分母不计 Bonus，分子计 Bonus，所以完成率可以超过 100%。

#### 数据长什么样

```json
{ "id": "id_…", "text": "写周报", "completed": false, "createdAt": 1759300000000, "bonus": true }
```

- `bonus` 是任务和阶段身上的**可选布尔字段**，`true` 表示 Bonus。**缺字段 = 普通项**（和 `stages` / `slot` / `plannedDate` 同一条取舍）。
- 任务块本体**没有** Bonus 概念——块是容器不是可完成单元（同 2.12 的「谁可以有时段」）；块内任务照常有。块的完成度由块内任务按 Bonus 口径算。
- `store.js` 清洗：`raw.bonus === true` 才置 `bonus: true`（其余值一律视为「没有」），不引入脏字段。

#### 两条口径：完成率 ≠ 全完成（v2.5 分开）

**这是两条不同的口径，别混用**：

**① 完成率**（只用于「显示一个百分比」，算法是 `getStats` + `getProgress` 的 `done/total`）：

- 分母（`total`）= 非 Bonus 单位数。
- 分子（`done`）= 全部已完成单位数（**含 Bonus**）。
- 完成率 = `done / total`，`total === 0` 时（全 Bonus）退化为 `done / bonusCount`（即「已完成 Bonus / 全部 Bonus」）。所以完成率可以超过 100%。

**② 全完成**（`isComplete` / 派生 `completed`：打勾样式、完成沉底、导出的 `completed` 都用它，v2.5 改）：

```
isComplete = 每个单位都完成（Bonus 单位也算），空列表为 false
```

- **Bonus 没做完就不算全完成** —— 哪怕完成率已经 100% 甚至更高。Bonus 只影响完成率的分母，不影响这个判断。
- 空列表（空块 / 一个阶段都没有的任务走另一条分支）返回 false。

落到各层：

| 对象 | total（完成率分母） | done（完成率分子） | isComplete（全完成） |
|---|---|---|---|
| 普通任务（无阶段） | `bonus ? 0 : 1` | `completed ? 1 : 0` | `completed` |
| 带阶段任务 | 非 Bonus 阶段数 | 全部已完成阶段数（含 Bonus） | 每个阶段都完成 |
| 任务块 | 块内非 Bonus 单位数 | 块内已完成单位数 | 块内每个单位都完成 |

`getProgress` 返回结构仍是 `{ done, total, bonusDone, bonusCount, hasStages, isComplete }`（`bonusDone` / `bonusCount` 缺省 0）；`progressOfItem`（块聚合）与 `getStats` 同口径。

**普通（无阶段）Bonus 任务**：`isComplete` 就是它自己的 `completed`，但 `total` 是 0——勾完它「完成率」不含它，属于纯加分。

**三处口径必须一致**（原来在四个文件里各写了一遍，`importer.copyTask` 那遍还用着旧口径，v2.5 收口）：

| 在哪 | 管什么 | v2.5 之后 |
|---|---|---|
| `task-ops.getProgress` | 任务 / 阶段的 `isComplete` | `done === stages.length` |
| `task-ops.progressOfItem` | 任务块的 `isComplete` | `allCount > 0 && done === allCount` |
| `store.allDone`（原 `allRequiredDone`，已改名） | `normalize` 里带阶段任务的派生 `completed` | 每个阶段都完成 |
| `store.blockDone` | `normalize` 里块的派生 `completed` | 每个单位都完成 |
| `importer.copyTask` | 导入时重算的 `completed` | 直接调 `store.allDone`，不再自己写一套 |

**渲染**（`render.js` / `app.js` / `task-ops.js`）：

- 任务行、阶段行各加一个 Bonus 按钮（类 `task__bonus` / `stage__bonus`，激活时加 `bonus--on`，图标 🎁）。放在时段下拉之后、推迟 / 加阶段之前。
- `task-ops.setBonus(data, dateStr, quadrantId, taskId, bonus)` 置 / 删任务 `bonus` 字段（删 = 回到普通），随后 `syncHostBlock`；`setStageBonus(..., stageId, bonus)` 同理，随后 `syncCompleted` + `syncHostBlock`。
- 时间视图条目**只读展示**一个 `🎁` 标记（不能在那儿改 Bonus，结构与四象限对齐——时间视图本就不做结构修改）。
- `getTimeView` 的条目带上 `bonus` 字段，供时间视图渲染标记。

**数据流转**：`applyTaskCopy` / `applyTemplate` 复制 Bonus（任务和阶段都带）；`postponeStage` 推迟阶段成任务时若该阶段是 Bonus，池内任务也带 `bonus: true`；`importer.js` 检查 `bonus === true` 才认，`copyTask` 复制时带上——v1 旧文件没有 `bonus` 字段，导入照常。

### 2.17 时间视图拖拽与位置记忆（需求 3）

**是什么**：时间视图里条目可拖拽排序、可跨时段拖；拖后的顺序**按天记住**，切日期 / 刷新 / 切视图再回来仍保持。象限视图里新增的任务（同一时段）默认排在该时段时间视图列表**最前**（v2.5 改；v2.4 及以前是「最后」）。

#### 数据长什么样

```json
{
  "user": "default",
  "schemaVersion": 1,
  "dates": {
    "2026-10-05": {
      "I": [ … ], "II": [ … ], "III": [ … ], "IV": [ … ],
      "tv": { "上午": ["t:id_1", "s:id_2:id_3"], "晚上": ["t:id_4"] }
    }
  },
  "pool": [ … ],
  "templates": [ … ]
}
```

- `tv` 是**每个日期对象里可选的新字段**，一个「时段 → 条目键列表」的映射。
- 条目键：任务 = `'t:' + taskId`；阶段 = `'s:' + taskId + ':' + stageId`。**只记顺序、不记内容**——内容永远现查任务 / 阶段的 `slot` 字段。
- 键列表里没列出的时段 = 没记忆 = 用默认扫描顺序；列表里出现但已不存在的键（任务被删 / 改了时段）在读取时忽略。
- `schemaVersion` **保持 1**（纯追加，老数据没有 `tv` 完全合法）。

**`store.js` 清洗**（`sanitizeTvOrder`）：`tv` 必须是普通对象；键必须 ∈ `CONFIG.SLOTS`；值必须是数组、元素必须是非空字符串；只拷合法条目，没有合法条目就**不挂 `tv`**（空日期的 `tv` 也随空日期一起丢掉）。

#### 排序怎么算（`getTimeView`）

`getTimeView` 每个时段组内，条目按 `tv[slot]` 里的键顺序排；`tv` 里没有的条目（记忆里排不上号的）**排在最前**（`orderByKeys` 把它们的 rank 记为 -1），它们之间按 I → II → III → IV 扫描顺序、ES2019 稳定排序保持相对顺序。效果：

- 拖过的那些条目之间，记忆顺序优先；
- 不在记忆里的条目——象限视图新增的、刚设上时段的——排在该组最前（v2.5：需求 3 的后半句从「最后」改成「最前」，和象限列表 unshift 统一）。
- **不用往 `tv` 里补写新键**：不写也排最前；一旦用户拖过这个时段，`moveTimeViewItem` 会把当前完整顺序（含新条目）整个重建进 `tv`，新条目就在那一刻「入册」。

#### 跨时段拖拽 = 改 slot + 记位置

`moveTimeViewItem(data, dateStr, info)`：

```
info = { dataKind: 'task'|'stage', taskId, stageId, quadrantId, toSlot, index }
```

1. 校验日期 / `dataKind` / `toSlot ∈ CONFIG.SLOTS`；
2. `locateTask` 定位（阶段再 `findStage`）；跨时段先走 `setSlot` / `setStageSlot`（复用既有校验，顺带把 `slot` 字段改掉）；
3. 用 `getTimeView` 重建 `toSlot` 的完整键列表（此刻已含刚改完 slot 的这条），摘出被移动的键，按 `info.index`（「摘出来之后」的下标，`clampIndex` 夹紧）插回；
4. 写 `day.tv[toSlot]`，并把该键从其他时段的键列表里清掉（防残影）。

**为什么 `index` 语义是「摘出来之后」**：渲染时占位符的位置就是「其余条目」里第几个，摘出被拖条目后按这个下标插回，和 `drag.js` 的 `computeDropIndex` 语义一致。

**导入对 `tv` 的处理**：`importer.js` **忽略 `tv`**——导入时所有 id 全部重生成，旧 id 组成的顺序键无法对应到新条目，忽略是最干净的选择。v1 文件没有 `tv` 照常；v2 文件导回 v1 代码时，v1 不认识 `tv`（多出来的可选字段），导出的数据里它会被 v1 原样忽略、无副作用。

### 2.18 完成自动沉底（需求 6）

**是什么**：任务（含任务块内的子任务）勾选完成后自动排到同组最后；**阶段不沉底**，永远按原顺序；取消勾选不自动移回。

**关键决定：沉底 = 改数据（把条目移到列表末尾），不是渲染时排序。**（D-46）

原因：`drag.js` 的 `computeDropIndex`、`moveTask` / `moveItem` 全部建立在「**数据顺序 = 渲染顺序**」这个假设上——它们数的是容器里 `<li>` 的位置，映射回列表下标。如果改成「渲染时把已完成排到最后」，数据顺序和渲染顺序就脱钩了，拖拽落点会算错、拖一下数据顺序就乱。

**实现**（`task-ops.js`）：

- `sendCompletedToEnd(data, dateStr, quadrantId, found)`：`found` 里那条在它所在列表（顶层象限列表或块内 `tasks`）里 `indexOf` → `splice` → `push`（已在最后则不操作）。若这是无阶段任务且 `slot` 有效，同步把时间视图里该时段的键沉到底（`sinkTimeKey`）。
- `sinkTimeKey(data, dateStr, slot, key)`：`tv[slot]` 存在就移该键到末尾；不存在就先用 `getTimeView` 把该时段当前完整键列表建出来，再把键移到末尾写回——保证「建列表时是完整的，键一定在」。
- **只在「未完成 → 已完成」这个方向触发**：`toggleTask` / `toggleStage`（阶段走这个不沉底，只做宿主重算）/ `toggleBlock` / `setAllStages` 在改之前记 `isComplete`，改完由 false→true 才调沉底。`toggleBlock` 一次勾完多条子任务，逐条按原顺序沉底（稳定）。

**明确不做（文档锁定，避免被当 bug「修」）**：

- **阶段不自动沉底**（需求原话），阶段顺序只靠用户手动拖。
- **块本体不沉底**（需求只点名「任务」和「任务块里的任务」；块是容器）。
- 取消勾选**不**移回原位。
- `removeStage` 删阶段引起的父任务变完成、导入 / normalize / 应用模板，都**不**触发重排（这些不是「用户勾选完成」这个动作）。
- 计划池**没有勾选框**（v1 的刻意决定，见 v1 DS 2.11 界面），池内不存在「勾选完成」入口，本条对池天然 N/A。

### 2.19 纯样式改动（需求 4、5、7）

这三条不碰数据、不碰业务逻辑，全部落在 `css/style.css`，且**网页版与 APK 共用同一套 CSS**（APK 就是 Capacitor 套的同一个页面）。

**需求 4 —— 时间视图象限浅色底**：`.timeview__item[data-quadrant="I"]` 等四条规则，用 `color-mix(in srgb, var(--q1) 8%, var(--surface))` 分别套一 / 二 / 三 / 四象限的浅色背景（`--q1`…`--q4` 是主题里既有的四色变量，亮暗主题自动跟随）；加圆角与少许水平内边距。已完成条目保留背景、只划文字（和象限视图同视觉语言）。

**需求 5 —— 各面板最大高度 + 右侧滚动条**：

| 面板 | 最大高度 | 滚动 |
|---|---|---|
| 象限（`.quadrant__body`） | 60vh | `overflow-y: auto` |
| 时间视图每块（`.timeview__list`） | 60vh | `overflow-y: auto` |
| 计划池列表（`.pool__list`） | 40vh | `overflow-y: auto` |
| 模板池列表（`.tpl__list`） | 40vh | `overflow-y: auto` |

手机端（`@media (max-width:600px)`）象限最大高度改小到 40vh（既有移动端规则已有一句，v2.1 收紧为与桌面统一的滚动条做法）。

**需求 7 —— 移动端拖动把手（勾选框 = 拖动把手）**：

- 把 `touch-action: none` 从任务行、块本体上**移除**（恢复任务行区域的正常触摸滚动）。
- 只保留勾选框（`.task__check` / `.stage__check` / `.block__check`）上的 `touch-action: none`——因为 `touch-action` 在手势开始那一刻就定死，按住勾选框拖时页面不会滚，拖拽才能接管。
- `drag.js` 判定（D-48）：`pointerType === 'touch' || 'pen'` 时，只有按在勾选框上才发起拖拽；鼠标照旧整行可拖。计划池无勾选框，池内条目仍整条可拖（文档记为此处已知限制）。
- **轻点勾选框 = 勾选，按住拖 = 移动**：拖拽未越过阈值就松手不产生 `suppressNextClick`，点按仍正常触发勾选（既有行为已经正确，v2.1 只是收窄「从哪发起」）。

---

## 数据格式变化汇总（schemaVersion 保持 1）

| 位置 | 新字段 | 类型 | 何时有 | 兼容 |
|---|---|---|---|---|
| 任务 / 阶段 | `bonus` | 布尔（仅 `true`） | 用户标记 Bonus 时 | 缺字段 = 普通，v1 文件照常 |
| 每天 | `tv` | `{ 时段: 键列表 }` | 用户在时间视图拖过之后 | 缺字段 = 默认扫描顺序，v1 文件照常 |

两条都满足 v1 的「纯追加、可选、缺省即空」原则，`schemaVersion` 不升，v1 JSON 导入 / 导出往返不丢（测试覆盖，见下）。

**v2.2 不新增主数据字段**：计划池放块用的是既有的 `block` 结构（v1.1 就有），只是从「只放任务」放宽为「也放块」；折叠状态（2.23）存在独立的 `foldState` key，不进主数据 JSON。所以 `schemaVersion` 仍保持 1，v2.2 的导出对 v2.1 / v1 代码零影响。

---

## 网页版与 APK 差异点（v2.1）

| 需求 | 网页版 | APK（安卓） |
|---|---|---|
| 面板最大高度（需求 5） | 象限 60vh / 时段块 60vh / 池与模板池 40vh | 同一套 CSS；手机媒体查询里象限 60vh → 40vh |
| 拖动把手（需求 7） | 鼠标可按住任务行任意非交互区域拖动 | 触摸只认勾选框一处；任务行其余区域正常滚动 |
| 导出（JSON / Markdown / ZIP） | `<a download>` + blob 触发浏览器下载 | 原生插件 `ExportFile` 写进系统「下载」文件夹（D-49） |

其余五条（日报统计、Bonus、时间视图拖拽记忆、象限底色、完成沉底）两端行为**完全一致**。

**v2.2 无新增 APK 差异**：六条需求两端行为完全一致——四象限高度（2.24）是同一套 CSS；导入选择框（2.22）在 WebView 里就是同一个 `openChoice` 弹窗；unshift / 计划池块 / 折叠持久化都是同一套 JS；重命名（2.25）网页改 `<title>`、APK 改 `appName`，`appId` 保持不变以兼容已安装应用的升级。v2.2 沿用 v2.1 已有的三条差异（面板高度、拖动把手、导出）。

---

## 三、测试策略（v2.1 追加）

新增以下测试文件，仍用 `test/harness.js`，跑法 `node tools/run-tests.js` 自动纳入：

| 文件 | 检查什么 |
|---|---|
| `test-bonus.js` | `setBonus` / `setStageBonus`（置 / 删 / 非法 id）；`getProgress` 带 Bonus 阶段（v2.5：Bonus 没做完就不算全完成、全 Bonus 时全勾才完成、`bonusDone`/`bonusCount` 字段）；`progressOfItem` 块含 Bonus 子项；`getStats` 分母不含 Bonus / 分子含 Bonus / 完成率可 >100% / 全 Bonus 退化口径 / 无普通项视为未完成；`store.js` 镜像（`blockDone` / `allDone`）与 normalize 保 `bonus:true`、丢 `bonus:false`；**全完成口径三处一致**（normalize 派生值 / `getProgress` / 导入的 `copyTask`）；导入往返（含 v1 无 `bonus` 旧文件照常）；`applyTaskCopy` / `applyTemplate` / `postponeStage` 带 Bonus；`buildMarkdown` 统计行 + 🎁、`buildPrintHtml` 统计行 |
| `test-timeview-order.js` | `moveTimeViewItem` 同时段重排 / 跨时段（slot 改掉 + 顺序记住）；v2.5：新增任务 / 刚设时段的条目同段**排最前**、记忆里的相对顺序不动；normalize 保 `tv` / 丢非法 `tv`；导入忽略 `tv`；完成沉底（`toggleTask` → 列表末尾 + 时间视图键沉底；阶段不沉底；块内子任务在 `tasks` 内沉底；`toggleBlock` 多子稳定沉底；取消勾选不移回）；序列化往返保 `tv` |
| `test-drag-handle.js` | 需求 7 拖动把手：勾选框（task/stage/block）有 `touch-action:none`；任务行 / 块 / 时间视图条目本体不再有；计划池条目保留（整条可拖的已知限制）。v2.5 扩充：`render.js` 里所有 `*__postpone` 按钮都必须在 `drag.js` 的 `isInteractive` 名单里（跨文件守卫） |
| `test-style-guards.js` | 需求 4 象限浅色底 + 需求 5 面板最大高度 / 滚动：`fs.readFileSync` + 正则断言关键声明存在 |

既有 637 项测试必须全绿。**唯一允许改动的既有断言**：那些「勾选后仍断言列表顺序」的用例——R6 改了行为，改成断言「完成后沉到末尾」。（顺序断言只此一处受 R6 影响，其余不动。）

CSS 三条（底色 / 最大高度 / 把手）用 `fs.readFileSync` + 正则断言关键选择器存在（沿用 `test-timeview.js` 已有的 CSS guard 写法），手感类（拖拽是否顺畅）仍留手工验收。

**v2.2 追加的测试**（仍用 `test/harness.js`，`node tools/run-tests.js` 自动纳入）：

| 文件 | 检查什么 |
|---|---|
| `test-pool-block.js` | `addPoolBlock`（空块 / 空文本拒绝 / 去空白）；`addPoolBlockTask`（+7 天 DDL / 块重算 / 非块 NOT_FOUND / 错误路径）；`postponeBlock`（整块进池 / 象限消失 / 逐条 +1 天 / 块本体无 DDL / 空块可推迟 / 整天空收掉 / 错误路径）；`locatePoolItem` 三类定位；`setPoolDate` / `editPoolItem` / `removePoolItem` 对块内任务生效；v2.5：`restoreFromPool` 也支持块内任务（摘出 + 宿主块重算 / 按占位符位置插 / 摘空后块留着 / 顶层不回归 / 错误路径）；序列化往返 + 导入池块换新 id、DDL 保留 |
| `test-fold-state.js` | `getFoldState` / `setFoldState`：没存过 / 坏 JSON / 字段非对象 → 空表不崩；往返一致 / 覆盖；存空 → 空表；foldState key 独立、不混主数据；存不上（配额满）吞异常。v2.5 扩充：`app.js` 源码守卫 —— `startAddStage` / `startEditStage` 的顺手展开必须调 `persistFoldState()` |
| `test-style-guards.js`（扩充） | 需求 1：`.quadrants` 含 `grid-template-rows: auto auto` + `align-items: start`、且不含 `1fr 1fr`；v2.3 需求 1：`.block__postpone` 透明低调 + hover 展开 + 拖拽克隆隐藏 |
| `test-import-merge.js`（扩充） | `overwrite` 清空本地、只保留文件内容、编号换新、返回形状与 merge 一致 |

**v2.3 追加的测试**：

| 文件 | 检查什么 |
|---|---|
| `test-render.js`（扩充） | 块头有 `block__postpone`；顶层任务有 `task__postpone`；块内无阶段任务也有 `task__postpone`；块内有阶段任务没有 |
| `test-pool.js`（修正） | 「块内任务的行上没有推迟按钮」旧断言按 D-54 修正为「无阶段的给、有阶段的不给」 |
| `test-style-guards.js`（扩充） | `.block__postpone` 低调样式 + 拖拽克隆隐藏（CSS 守卫） |
| `test-search.js`（v2.4 新增） | `filterDayByKeyword`：普通任务命中 / 阶段文字命中 / 块名命中整块 / 子任务命中留块副本且不动原数据 / 都不中块消失 / 空关键词不过滤 / null 输入不崩；`filterTimeViewByKeyword`：组全保留组内过滤 / parentText 命中 / 空关键词原样返回 |

既有 720 项测试必须全绿。**唯一允许改动的既有断言**：需求 3（unshift）改掉了「新任务排在末尾」的旧假设，涉及顺序断言的用例改成「新增排在开头」；需求 4 放宽了 pool 可放块，原来「池内块非法」的两条断言改为「块合法」。

**v2.5 追加 / 改写的测试**（`npm test` 全绿，共 751 项）：

| 文件 | 检查什么 |
|---|---|
| `test-bonus.js`（改写 3 条 + 新增 1 组） | 全完成口径：Bonus 没做完不算全完成（带阶段任务 / 块内 Bonus 子任务 / `blockDone`）；`allDone` 空表 false；**三处一致**（normalize 派生 `completed` ↔ `getProgress` ↔ 导入 `copyTask`，正是旧 `copyTask` 自成一派的那条回归） |
| `test-timeview-order.js`（改写 1 组 + 新增 1 条） | 不在 `tv` 记忆里的条目排最前；连续新增保持「新的最前」；刚设时段的条目同样排最前；已有记忆的相对顺序不动 |
| `test-pool-block.js`（新增 1 组 5 条） | 池内块里的任务拖回象限：摘出 + 宿主块重算 / 按位置插 / 摘空 / 顶层不回归 / `NOT_FOUND` |
| `test-drag-handle.js`（新增 1 条） | 跨文件守卫：`render.js` 画出的每个 `*__postpone` 类名都在 `drag.js` 的 `isInteractive` 里 |
| `test-fold-state.js`（新增 1 条） | 源码守卫：`app.js` 的两个「顺手展开」入口都调 `persistFoldState()` |

**v2.6 追加的测试**（仍用 `test/harness.js`，`node tools/run-tests.js` 自动纳入；全绿，共 799 项）：

| 文件 | 检查什么 |
|---|---|
| `test-pool-order.js`（新增） | `movePoolItem`：顶层重排（往前 / 往后 / 头尾 / 原位）、块内重排、越界夹紧、`NOT_FOUND`、池长度不变（移动不是复制）、顶层块也是合法条目；`autoImportDuePoolItems`：到期导入今天 Q-II 开头、多条按池内顺序、未到期不动、无计划日期不动、过期也算到期、块按最早子项日期整块回来、块内任务不单独自动导入、连跑两次只导入一次、`todayStr` 非法 → `BAD_DATE`、空池 / 空块不建今天记录；`restoreFromPool` 导入落点（`toIndex 0` → 开头、块头目标 Q-II）；以及四条需求的源码守卫（`render.js` 的两个导入按钮类名、`app.js` 用 `CONFIG.IMPORT_QUADRANT` / `restoreFromPool` / 两处 `autoImportDuePool()` / 保护模式早退 / `Util.todayStr()` / Markdown 导出传 `state.date`、`exporter.js` 透传与文件名、`drag.js` 的 `poolContainerOf` 与 `poolReorder`） |
| `test-drag-handle.js`（扩充） | 跨文件守卫：`render.js` 里所有 `*__import` 类名（`pool__import` / `pool__block-import`）都必须在 `drag.js` 的 `isInteractive` 名单里（和 `*__postpone` 同一条守卫逻辑）；`.pool__block-head` 有 `touch-action: none`（块头能拖，需求 1）、`.pool__item--placeholder` 占位样式存在 |
| `test-export-md.js`（扩充） | `buildMarkdown(data, { dateStr })` 只含那一天（别的日期标题不出现）、当天的统计行照常在、那天没数据也不报错、空串 / null 按「没指定」处理；不传 dateStr 时行为不变（全部日期） |
| `test-load-order.js`（既有） | 自动校验新依赖（`drag.js` 不新增依赖；`task-ops` 新增函数不引入新模块） |

**v2.7 追加的测试**（仍用 `test/harness.js`，`node tools/run-tests.js` 自动纳入；全绿，共 845 项）：

| 文件 | 检查什么 |
|---|---|
| `test-pool-align.js`（新增，46 项） | 数据层 `togglePoolItem` / `togglePoolBlock`：顶层勾选 / 取消 / 取反、**勾完不移出池**、沉到池末尾、已在末尾不重复搬、取消勾选不移回（D-47 同一条规矩）、块内任务在块内沉底且不把宿主块搬到池末尾；块内任务勾选 → 宿主块完成度重算；带阶段任务勾选 = 全部阶段一起设、只勾一半时取反是「补齐」、块内带阶段任务逐级往上重算；块 id 转给 `togglePoolItem` 走块头全勾；`togglePoolBlock` 全勾 / 全取消 / 部分完成补齐 / 稳定沉底 / 空块不报错但永远不算完成（`store.blockDone`）/ 块本体不沉底 / `NOT_FOUND` / 任务 id 传进来也是 `NOT_FOUND`。渲染：块头「勾选框 → 块名 → 完成度 n/m → 折叠三角」四件套齐全且顺序与象限一致、空块 0/0、完成态 `pool__block--done` + `checked`、块名与编辑框值都转义、编辑态收成 `task__input` 且只收编辑中的那一块；行上有 `pool__check`、完成态 `pool__item--done` + `checked`、带阶段任务读**派生** `completed`（不是数阶段）、块内任务行也有勾选框、编辑文字时整行只有输入框（老行为不动）。跨文件守卫：两个池内勾选框都在 `drag.js` 的 `isInteractive` 里；`pool__check` **不在** `isCheckHandle` 里且 `.pool__item` 仍有 `touch-action: none`（D-62 / R-33）；`app.js` 三个 `bindPool` 分支 + `startEditPoolBlock` + `commitEdit` 的 `edit-pool-block` + 两处数据层调用；改块名复用 `editPoolItem` 且**没有**多出 `editPoolBlock`（D-63）；CSS 声明守卫（完成态划掉、块名 `cursor: text`、`.pool__check` 不设 `touch-action`、保护模式名单里有池内勾选框和块名） |
| `test-pool.js`（改写 1 条 + 组标题） | 旧断言「池内每一行……没有勾选框」按 v2.7 改写为「有 `pool__check`，但仍**不是** `task__check`」——池里勾选 ≠ 象限里「正在做」，池内条目照样整条可拖 |
| `test-drag-handle.js`（既有） | 池条目仍整条可拖（本版没动拖拽手势本身） |
| `test-load-order.js`（既有） | 自动校验新依赖（本版 `task-ops` 只加函数、`render.js` 只改块头，都不引入新模块） |

**v2.8 追加的测试**（仍用 `test/harness.js`，`node tools/run-tests.js` 自动纳入；全绿，共 972 项）：

| 文件 | 检查什么 |
|---|---|
| `test-reading.js`（新增，101 → 111 项） | 数据层：`addReadingItem` 正常 / 默认取**今天** / 空串也算没传 / 空白文本 `EMPTY_TEXT` / 坏日期 `BAD_DATE`（月份 13、2 月 30、没补零、两位年份、中文）/ 合法边界（月末、闰年 `2028-02-29` 收、`2026-02-29` 拒）/ **写路径不收老的 `HH:MM`**；`editReadingItem` 改成功 + 改空保留原名；`setReadingStart` 设定 / 清成 `null`（不是空串）/ 坏值不动原值 / **已完成条目也能改**；`completeReadingItem` 搬表 + 自动记**今天** / 传日期 / **保留 start** / 新读完排开头 / 坏日期原地不动 / 已在 `done` 不重复搬只更新日期；`restoreReadingItem` 搬回 + 清 `doneAt` + 保留 `start` / 本来在读则空操作；五个写函数的 `NOT_FOUND`；`getReadingStats` 计数 + 恰好 3 项不算超 + 第 4 项才 over + **超了照样能加**（软提示不是硬闸，D-64）+ 已完成不占名额。`Util.isValidReadingStamp` 契约（日期收 / 老 `HH:MM` 收 / 别的拒）+ 自导自入一整轮日期不丢。`ensureReading` 缺字段 / 垃圾值 / 表不是数组。`Store`：`normalizeReadingItem` 丢空文本、坏日期收敛成 `null`、**老 `HH:MM` 原样收下**；`normalizeReading` 不是对象 / 脏条目计数 / **`active` 的 `doneAt` 强制抹成 `null`** / **`done` 缺日期补今天**；`normalize` 整轮往返日期与文本不丢；老数据（无 `reading`）补空表且 `dropped === 0`；`createEmpty` 带空阅读栏。渲染：头部名字 / `n/3` / 超限 `reading__count--over` 且条目一条不少 / 勾选框 / 未设定 `--empty` / 已完成的 `reading__restore` + `reading__time` + 箭头 + 完成日期 / **同一天只画一个日期** / **起始没设也不画「未设定 →」** / `reading__item--done` / 空态引导 / 「正在阅读空但已完成有货」两段各画各的 / 数据缺字段不崩 / 两种编辑态（改名只影响那一条、起始用 `type="date"` + 清空按钮、新增态插在开头、已完成条目也能进起始编辑态）/ 文字转义。`panelToggleHtml` 展开与收起两个朝向 + 三个板块头上都有。导入：**没有 `reading` 字段的老文件校验通过且 `reading === null`**（「文件里没有」≠「有零条」）/ 有则原样带过来 / `active` 带 `doneAt` 被抹掉 / 缺表当空表 / 不是对象 / 表不是列表 / 条目没名字 / 坏日期 → 整份 `BAD_READING` 拒绝 / **v2.8 初版带 `HH:MM` 的文件正常导入且老值原样保留** / 空串日期当没设 / 合并换新 id 且带 `start` / 同名文本判重跳过并保留本地日期 / 已完成条目带 `doneAt` 过来 / 文件没有阅读栏则本地一条不动 / 覆盖导入整体换掉 / 错误说明是人话不是错误码。跨文件守卫：`app.js` 的 `bindReading()` 在 boot、`renderCurrent` 传 `reading` 与 `collapsedPanels`、`commitEdit` 三个模式、`addReadingItem` 调用点、开机读回 `state.collapsedPanels`、`togglePanel` 白名单、四个写函数的保护模式早退、**日期框仍被键盘 / 失焦提交认**；**`render.js` 里再没有 `type="time"`**；**`drag.js` 里没有 `reading`**；`CONFIG.PANEL_IDS` 就是那三个；CSS 声明守卫（两个列表都有 `max-height` + `overflow-y: auto`、三个板块的 `.is-collapsed` 藏内容、三角 `rotate(-90deg)`、完成态 `--done-opacity`、保护模式名单含六个阅读栏控件与 `.reading__text`、`.reading__start-clear` 有样式、**日期框和 `pool__date-input` 同一副样式**、`.reading__time` 不折行、**`.panel__toggle` 不在保护模式名单里**） |
| `test-layout.js`（扩充，8 → 14 项） | `#reading` 排在 `#quadrants` 前面且 id 唯一；`setViewMode` 里 `el.reading.hidden = false`（两个视图都露着）；`.reading[hidden]` 守卫；三个板块头上都有 `panelToggleHtml`；`setCollapsedPanels` 走 `CONFIG.PANEL_IDS` 并落 `is-collapsed`；`render` 主流程调了 `setCollapsedPanels`（不调的话刷新后记了也白记） |
| `test-fold-state.js`（扩充，11 → 19 项） | `collapsedPanels` 没存过是空表、存了能读回、三个板块各收各的、和展开名单互不干扰、是垃圾值回空表；`persistFoldState` 带上 `collapsedPanels`、开机赋值、`togglePanel` 的白名单与落本机 |
| `test-store-serialize.js` / `test-theme.js` / `test-fold-state.js`（各改写 1 条） | 主数据 key 集合的硬断言补上 `reading`（这三个文件本来就在锁「主题 / 折叠状态不进主数据」，`reading` 是**真数据**，和 `pool` / `templates` 同类，所以预期集合要一起更新） |

**v2.8 补充追加的测试**（`node tools/run-tests.js` 自动纳入；全绿，共 982 项）：

| 文件 | 检查什么 |
|---|---|
| `test-reading.js`（扩充，88 → 89 → 101 → 111 项） | 补充需求 1：**自动**守卫：扫出 `app.js` 里所有 `mode: 'add-*'` 模式，逐个要求出现在 `commitEdit`「新增」分支的外层条件里（R-38）。已验证：把 `'add-reading'` 从条件里删掉，这条会红。补充需求 3（日期口径）：`Util.isValidReadingStamp` 契约（日期收 / 老 `HH:MM` 收 / 别的拒）、默认取今天、坏日期五种写法各拒一次、合法边界（闰年 / 月末）、**写路径不收 `HH:MM`**、清洗与导入**原样收下**老 `HH:MM`、自导自入一整轮日期不丢、render 里没有 `type="time"`、同天只画一个日期、日期框和 `pool__date-input` 同一副样式。补充需求 4（日期设定对齐计划池）：**已完成那行的日期是点得动的按钮**（需求「下方可以自己修改起息时间」，改之前是死文本）、已完成没设过起始时留「未设定」按钮且完成日期照画、清除按钮文案是「清除」（和池里渲染出来的字符串直接比）、**CSS 逐条一致**（按选择器取规则体剥注释后整份比对：`.reading__start` / `:hover` / `--empty` / `--empty:hover` 对 `.pool__date` 系列，`.reading__start-input` / `-clear` 对 `.pool__date-input` / `-clear`）、**R-40 自动守卫**（扫 `render.js` 里所有编辑框输入框的 class，逐个要求出现在 `commitEdit` 与 `focusEditor` 的选择器里；另加 `state.editing` 不是列表、`doSetReadingStart` 先 `commitEdit()`、唤起日期框用 `focusEditor(false)` 三条）。**四条守卫都做过变异验证**：把 `.reading__start-input` 从选择器里去掉 → commitEdit 那条红；去掉 `doSetReadingStart` 的 `commitEdit()` → 清空那条红；从 `focusEditor` 去掉 → 那条红；把 `.reading__start` 的 `border: 0` 改回有边框 → CSS 逐条一致那条红 |
| `test-pool-align.js`（扩充，46 → 50 项） | 池内块外框对齐象限块：`border-left` 是 `3px solid var(--q2)`（蓝色，需求点名的那条）；`border` / `border-left` / `border-radius` / `background` 四条声明在 `.block` 与 `.pool__block` 之间**逐条一致**；不再有 `border-left: 3px solid var(--border)` 那条灰竖线；加了边框之后块里有内边距。取 `.block` 的规则体按完整选择器比对（不能用 `indexOf('.block {')`，会撞上后代选择器的尾巴），比对前剥掉 CSS 注释 |

---

## 六、v2.2 的六条需求怎么实现

### 2.20 计划池任务块 / 整体推迟 / 按任务 DDL（需求 4）

**是什么**：计划池里允许直接新建任务块；象限里的任务块可以「整体推迟」进计划池；完成截止日期（DDL）以**任务**为单位设到块内任务上，块本身是容器不设 DDL。

**数据长什么样**（pool 里的块与象限里的块同一套 `block` 结构）：

```json
{ "id": "…", "type": "block", "text": "搬家", "completed": false, "createdAt": 1759300000000,
  "tasks": [ { "id": "…", "text": "打包装箱", "completed": false, "createdAt": 1759300000000, "plannedDate": "2026-10-08" } ] }
```

- 块本体没有 `plannedDate`（DDL 只属于任务）；块内任务各自带 `plannedDate`。
- 主数据 `schemaVersion` 不升：pool 字段 v1.1 就有了，只是之前只放任务，现在**也放块**；块结构完全沿用象限里的 `block`。

**实现**（`task-ops.js`）：

- `addPoolBlock(data, text)`：新建空块（`type:'block'`、`tasks:[]`），压进 pool 末尾。
- `addPoolBlockTask(data, dateStr, blockId, text)`：往池内指定块里加任务，`plannedDate = 查看日期 + 7 天`（与 `addPoolItem` 手动加池任务同一条默认）。
- `postponeBlock(data, dateStr, quadrantId, blockId)`：把象限里的块**原样搬进** pool（同一 id，不是复制），块内每条任务 `plannedDate = 所属日期 + 1 天`，块本体不设；某天被掏空就收掉该天。
- `locatePoolItem` 升级为能定位三类位置——顶层任务（`container:'pool'`）、顶层块（`container:'pool'`）、块内任务（`container:'block'` + 宿主块）——于是 `setPoolDate` / `editPoolItem` / `removePoolItem` 天然支持「以任务为单位改 DDL / 改文字 / 删」，块内任务也能逐条操作。
- `restoreFromPool`（拖回象限）也改走 `locatePoolItem`（v2.5 修复）：落在池顶层就照旧从 `pool` 里摘，落在块内就从宿主块 `tasks` 里摘并 `syncBlockCompleted` 重算宿主块。原实现只查池顶层（`findPoolItem`），而块内任务在界面上就是一条可拖的 `pool__item`，拖出去会静默 `NOT_FOUND`、什么都不发生。

**数据流转**：`store.js` 清洗认 pool 里的块；`importer.js` 的 `copyBlock` 复制块时 id 换新、块内任务的 `plannedDate` 保留；序列化 → normalize 往返池内块和 DDL 不丢。

### 2.21 象限任务默认加到开头（需求 3）

**是什么**：象限视图里新增任务 / 任务块，默认插到该象限列表**开头**，不是末尾。

**实现**：`addTask` / `addBlock` 把 `Store.ensureDay(data, dateStr)[quadrantId].push(...)` 改成 `.unshift(...)`。只改象限列表；计划池 `addPoolItem` / `addPoolBlock` 仍是 `push`（末尾）、块内 `addPoolBlockTask` 仍是 `tasks.push`（末尾）——需求只点名「象限」。

**与时间视图的关系**（D-50，v2.5 修订见 D-57）：象限列表的 unshift 与时间视图的 `tv` 是两套独立结构，互不写入；但**排序规则统一**了——`tv` 里没记忆的条目（含象限新增的、刚设时段的）在时间视图里同样**排该时段最前**，所以两个视图看到的新任务都在最前。v2.4 及以前的「象限新增排该时段最后」自 v2.5 起作废。

### 2.22 导入自选合并 / 覆盖（需求 2）

**是什么**：导入 JSON 时，弹一个「选择导入方式」的地方，让用户自己选「合并」还是「覆盖」。

**实现**：

- `render.js` 新增通用选择弹窗 `openChoice({ title, message, choices:[{act, label, danger}] }, onPick)`——`danger:true` 的项标红（覆盖是危险操作）。
- `importer.js` 新增 `overwrite(localData, imported)`：实现为「往一份空数据里做一次合并」（`merge(empty, imported)`）。判重对着空数据、永远不跳过，所以进来的东西一条不落地全搬进去；编号照旧由 `copyTask` / `copyBlock` 全换新。返回形状与 `merge` 一致 `{ added, skipped, data }`，调用方不用另学一套。
- `app.js` 的 `onFileLoaded`：先 `Importer.validate(text)` 整份检查（不合格直接拒绝、本地一个字节不动），合格后 `Render.openChoice` 二选一，再按选择调 `merge` 或 `overwrite`。

**关键点（D-52）**：`overwrite` 返回的 `result.data` 是一个**新对象**（不是原来的 `state.data`），所以 `onFileLoaded` 必须 `state.data = result.data;` 接回引用，再 `persist()` + `renderCurrent()`——否则「数据进了但页面还是旧的」。合并分支里它就是 `state.data` 自己，接一下也无妨。保护模式下导入成功顺带 `exitProtectionMode()`（导入备份文件是保护模式唯一的救援通道）。

### 2.23 折叠状态本机持久化（需求 5）

**是什么**：有阶段的任务、有任务的任务块都能折叠 / 展开，状态存本机、刷新 / 重开保持。

**数据长什么样**（单独 key，不进主数据）：

```json
{ "expanded": { "taskId": true }, "collapsedBlocks": { "blockId": true } }
```

- 存在 `CONFIG.KEYS.foldState`（`'quadrant_ui_fold_state'`），与主数据 key 分开。
- `expanded` = 展开状态名单（有阶段任务的展开），`collapsedBlocks` = 折叠的任务块名单；两张表互补，各存各的。

**实现**：

- `config.js` 加 `KEYS.foldState`。
- `store.js` `getFoldState()`：读不出 / JSON 坏 / 字段不是对象 → 给 `{ expanded:{}, collapsedBlocks:{} }`，绝不崩；`setFoldState(fold)`：JSON 化后写入，存不上（空间满）吞异常——界面状态存不上最多回到默认折叠，不算丢数据。
- `app.js`：`state.expanded` / `state.collapsedBlocks` 在 `startApp` 从 `getFoldState()` 载入；`toggleExpanded` / `toggleCollapsed` 每次翻转都调 `persistFoldState()`（写 `{ expanded: state.expanded, collapsedBlocks: state.collapsedBlocks }`）；`doPostponeBlock` 推迟块后清掉该块及块内条目的折叠记录；删除池条目 / 象限块时同步清理折叠状态，避免留下指向已删除条目的孤儿键。

### 2.24 四象限高度互不牵制（需求 1，纯样式）

**是什么**：四个象限行高各自按内容撑开，不再两行同步拉成一样高。

**实现**：`.quadrants` 的 `grid-template-rows: 1fr 1fr` 改成 `auto auto`，并加 `align-items: start`。纯 CSS、无数据 / 业务改动，网页版与 APK 共用同一套。用 `test-style-guards.js` 断言 `.quadrants` 含 `grid-template-rows: auto auto` 与 `align-items: start`、且不再含 `1fr 1fr`。

### 2.25 重命名 MyPal（需求 6）

**是什么**：应用统一改名 MyPal。

**实现**：`index.html` `<title>MyPal`、`package.json` `name: mypal`、`capacitor.config.json` `appName: MyPal`。`appId` 保持 `com.candiwind.timescheduler` **不变**——改 appId 会让已安装的 App 无法原地升级。

### 2.26 任务块推迟键低调化（v2.3 需求 1，纯样式）

**是什么**：块头上的「整体推迟」按钮改成不显眼的形式。

**实现**：`css/style.css` 新增 `.block__postpone` 规则，与 `.block__del`（删除按钮）完全同款——透明底、无边框、`--text-dim` 淡色文字、桌面端 `opacity: 0`（`.block:hover` 时才出现）、触摸端（`hover: none`）半透明常显。同时把 `.block__postpone` 加进 `.drag-ghost` 的 `display: none` 列表（拖拽克隆上不冒按钮）。纯 CSS、无 JS 改动，网页版与 APK 共用。

### 2.27 块内无阶段任务支持推迟（v2.3 需求 2）

**是什么**：任务块里没划分阶段的任务，任务行上也有「推迟」按钮，可单独推迟进计划池。

**为什么只放开无阶段的**（D-54）：块内任务**整条**推迟会把它的阶段一起卷走，而阶段有自己的独立推迟通道（`postponeStage`），卷走会让「阶段单独推迟」和「整条推迟」两条路语义打架。所以拆开：无阶段的块内任务 = 和顶层任务同待遇（有「推迟」按钮）；有阶段的块内任务 = 不给整条按钮，继续靠逐个阶段推迟。

**实现**：数据层 `postponeTask` **本来就穿透块**（`findTask` 返回 `blockId`，摘出后 `syncBlockCompleted` 重算宿主块，v1 就支持），所以只改渲染：`render.js` 的 `buildTaskHtml` 把「推迟」按钮的条件从 `!view.inBlock` 放宽为 `!view.inBlock || !stages.length`。`app.js` 的 `task__postpone` 点击处理不变（`findTask` 自己会定位到块内）。推迟的收尾规则全部沿用既有：DDL = 所属日期 + 1 天、某天掏空收掉、宿主块完成度重算。

### 2.28 搜索过滤（v2.4 需求 3）

**是什么**：象限模式和时间模式下都能按关键词过滤当天任务——只显示含关键词的任务，其余位置显示空白；入口（🔍）在整个界面右上角。

**关键决定：搜索是「画的时候少画」，不是删数据。**（D-55）

需求原文「清空其余任务」指的是**显示上**清空——数据一条不动，收起搜索完整内容原样回来。所以过滤发生在 `renderCurrent` 渲染前的只读变换，绝不碰 `state.data`。

**实现**：

- `task-ops.js` 新增两个纯只读变换：
  - `filterDayByKeyword(day, keyword)`：返回一份**新对象**。普通任务命中（任务文字或任一阶段文字）才留下；块名命中 → 整块留下；块名不中但子任务命中 → 留下只含命中子任务的**块副本**（不能改原块）；都不中 → 块消失。没命中的象限是空数组（渲染成该象限的空白态）。
  - `filterTimeViewByKeyword(groups, keyword)`：时段组**全保留**，组内只留命中条目（阶段条目顺带看 `parentText` 所属任务标注）——没命中的时段块显示空白，和象限同一条约定。
  - 匹配规则：小写化后子串匹配（大小写不敏感），关键词先 trim；空关键词 = 不过滤。
- `app.js`：`state.search`（界面状态，null = 没在搜，不进数据、不记本机）；`bindSearch()` 绑 🔍 按钮（点开输入框 / 再点收起）和输入框（`input` 事件实时重画、Esc 收起）；`renderCurrent` 里 `activeKeyword()` 非空就先过滤再画——象限视图过滤 `day`，时间视图过滤 `groups`。
- `index.html`：顶栏动作区（整个界面右上角）加 `#search-input`（默认 `hidden`）+ `#btn-search`（🔍）。
- `css/style.css`：`.search-input`（与顶栏按钮同高，≤600px 收窄到 120px）、`.btn--on`（搜索开着时 🔍 的激活态，一眼知道看到的是过滤后的内容）。

**计划池 / 模板池不参与过滤**：搜索针对的是「当天的任务」（象限 / 时段两种看法），池是跟日期无关的另一块区域，需求没点名，保持原样。

**为什么过滤放在 task-ops 而不是 render**：过滤是数据塑形（谁该出现），不是排版；render 拿到的就是「该画的内容」，保持「render 只管画」的分层。两个函数都有独立测试（`test-search.js`）。

### 2.29 v2.5 的四处实现修复

两条口径改动见 2.16（全完成）与 2.17 / 2.21（新任务排最前），这里记剩下的四处缺陷修复 —— 都不改数据格式。

**① 池内块里的任务拖不回象限**（`task-ops.restoreFromPool`）：改用 `locatePoolItem` 定位三类位置，块内任务从宿主块摘出并重算宿主块完成度。原实现只 `findPoolItem` 查池顶层，块内任务拖出去 → `NOT_FOUND` → 静默失败（界面上「拖了没反应」，也没有报错）。补测试：`test-pool-block.js` 新增一组（摘出 / 按位置插 / 摘空 / 顶层不回归 / 错误路径）。

**② 推迟按钮被当成拖拽把手**（`drag.js` 的 `isInteractive`）：名单里原来只有 `stage__postpone`，漏了 `task__postpone`（顶层任务、块内无阶段任务）和 `block__postpone`（块头整体推迟）。鼠标按下去挪动超过阈值 → 变成拖拽，`suppressNextClick` 又把 click 吃掉，**推迟按不动**。补测试：`test-drag-handle.js` 加一条跨文件守卫 —— 把 `render.js` 里所有 `*__postpone` 类名抓出来，逐个要求出现在 `drag.js` 的 `isInteractive` 里（以后再加推迟按钮，忘了登记就会红）。

**③ 顺手展开没落本机**（`app.js` 的 `startAddStage` / `startEditStage`）：给折叠着的任务加阶段 / 改阶段文字时，任务会自动展开，但这两处只改了 `state.expanded`、没调 `persistFoldState()`，刷新后又变回折叠（需求 5 的「折叠状态刷新后保持」在这条路径上不成立）。补测试：`test-fold-state.js` 加一条源码守卫，按函数体检查这两个函数里都有 `persistFoldState()`。

**④ 两处过期注释**：`addTask` 的 JSDoc 第一句还写着「加到该象限列表的**末尾**」（v2.2 已改成 unshift 加开头）；`restoreFromPool` 的注释说「和 addTask 同一个位置逻辑」（实际一个 unshift、一个按占位符末尾落）；`render.js` 块内任务那段的注释说「块内任务没有推迟按钮」（v2.3 已放开给无阶段的）。三处按实现改正。

---

## 七、v2.6 的四条需求怎么实现

四条都在既有分层里做加法：**数据层两个新函数 + 交互层多一种落点 + 渲染层两个按钮 + 入口层两处调用**，没有新模块、没有新字段。`schemaVersion` 保持 1（池、`plannedDate`、`buildMarkdown` 的 `dateStr` 选项都是 v1 就有的东西）。

### 2.30 池内拖拽排序（需求 1）

**是什么**：池内条目可拖拽换顺序——顶部条目之间换、同一条任务块内的任务之间换；**各自列表内排，不跨容器**。

**数据层**（`task-ops.movePoolItem(data, poolItemId, toIndex)`）：

- 用 `locatePoolItem` 定位（顶层任务 / 顶层块 / 块内任务三类都能定位，v2.2 就有）；
- `list` = 顶层就取 `ensurePool(data)`，块内就取 `blockTasks(found.block)`；
- 摘出来再按 `clampIndex(toIndex, list.length)` 插回 —— 和 `moveTask` 同一条 **toIndex 语义**（以「摘出来之后」的列表为准，越界夹紧）；
- 已在原位（`idx === found.index`）也算成功，不动数据。

**交互层**（`drag.js`）：

- 池内条目原来只有 `pool__item` 一种可拖对象，现在**加上 `pool__block`**（块头不是 `pool__item`，以前整块根本拖不动），并把「我属于哪个列表」记在按下那一刻：`poolContainer` = 所在的 `.pool__list`（顶层）或 `.pool__block-tasks`（块内）。
- `updateTarget` 的 `pool` 分支**先认池列表**：指针底下的 `pool__block-tasks` / `pool__list` 跟 `poolContainer` 是同一个元素 → 用 `poolOthers` 算落点、放占位符（`kind` 仍是 `pool`，落点加一个 `poolReorder: true` 标记，`sameTarget` 一起比它）。落到**别的**池列表 → `return`（保持上一次落点），不吸附、不跨容器。
- 不在池列表里 → 走原来的分支：认象限顶层，`onDrop` 回 `restoreFromPool`（**池 → 象限**的既有通路，块和块内任务都走得通）。
- 块头从「整条可拖」受益：`pool__block` 的头部按钮（`pool__block-toggle` / `pool__block-add` / `pool__block-del` / `pool__block-import`）全部登记进 `isInteractive`，按它们不会变成拖拽；触摸端 `onPool` 也认 `pool__block`。CSS 给 `.pool__block-head` 加 `touch-action: none`，块头按住能拖、块内任务区照旧。

**渲染层**：占位符用 `pool__item pool__item--placeholder`（不复用 `.task--placeholder`，池行的高度和内边距跟象限任务不同）；`poolOthers` 排除被拖的那条、占位符、编辑态行和 `.pool__block-empty`。

### 2.31 池条目「导入」到第二象限（需求 2）

**是什么**：池条目行 / 块头上一个「导入」按钮，一键导入**当前查看日期**的 Q-II。

**语义定成「移动」而不是「复制」**（D-59）：和既有的「拖回象限」完全同构，**不新增数据层函数** —— 直接调 `restoreFromPool(data, state.date, CONFIG.IMPORT_QUADRANT, poolItemId, 0)`：

- `toIndex = 0` → 落在该象限**开头**，和象限视图「新增任务加在开头」（D-50）同一条规矩，用户导入完一眼就能看到；
- `restoreFromPool` 本来就支持三类位置（顶层任务 / 顶层块 / 块内任务，v2.5 修过），块内任务会从宿主块摘出并重算宿主块完成度；
- 源数据不动是不成立的（移动语义）：池里不再保留。用户想退回去，用「推迟」或把象限里那条拖回池里。

**入口层**：`app.js` 新增 `doImportPoolItem(poolItemId)`，`bindPool` 的点击分支认 `pool__import`（行上）和 `pool__block-import`（块头），都落在同一个函数上；保护模式直接 return；成功后 `persist()` + toast「已导入到 <日期> 的第二象限。」——**toast 里写明是哪个日期**，因为用户可能正看着别的日期。

**为什么目标日期是「当前查看的日期」而不是真实今天**（D-59）：池面板在两个视图都显示，用户完全可能正翻着别的日期；导入到真实今天而界面上什么都没变，看起来就是「东西没了」。落在正在看的那一天，用户立刻看到它出现在 Q-II 开头。正看着今天时，两者本来就是同一件事。

### 2.32 计划日期到了自动导入（需求 3）

**是什么**：真实今天 ≥ 计划日期的顶层池条目，启动 / 切日期时自动移入**今天**的 Q-II。

**数据层**（`task-ops.autoImportDuePoolItems(data, todayStr)`）：

- 遍历池顶层，逐条算「到期日」：
  - 普通任务（含阶段）→ 自己的 `plannedDate`（`Util.isValidDateStr` 校验，脏数据当「未设定」）；
  - 任务块 → 块内任务里**最早**的有效 `plannedDate`（块本体没有 `plannedDate`，见 D-51；取最早是为了「整块按最早该做的那天回来」）；
  - 都没有 → 不到期（「未设定」= 持续保留，D-38）。
- 到期判据是字符串比较 `dueDate <= todayStr`（`YYYY-MM-DD` 定长，字典序即日期序），**过期的也算到期**。
- 收集到的条目**按池内顺序**一次插到今天 Q-II 的**开头**（不是逐条 unshift —— 那会把顺序倒过来），池里同时摘掉；返回 `{ ok: true, imported: N, items: [...] }`，一条都没有时 `imported: 0` 且不建那一天的记录。
- 日期非法 → `BAD_DATE`；保护模式由调用方拦（数据层不做界面状态判断）。

**入口层**（`app.js` 的 `autoImportDuePool()`）：启动时（数据读入之后、首屏渲染之前）和 `bindDateNav` 的 `onChange` 里各调一次。都先 `Store.isProtectionMode()` 判断，保护模式一次都不执行（保护模式下任何写操作都不放行）。有导入时 `persist()` + toast「计划池有 N 条到期，已导入今天（<日期>）的第二象限。」

**为什么块整块回来、块内任务不单独触发**（D-60）：`postponeBlock` 给块内每条任务都设了「+1 天」，如果块内任务各自按自己的日期自动导入，**第二天这个块就会被掏空、任务一条条散进象限**——「整体推迟」的意义就没了。所以自动导入只认顶层条目：块的到期日由块内最早的计划日期**推导**，回来时整块一起回来，不拆散。块内任务仍可**手动**用自己行上的「导入」单独导入（那是明确意图）。

**为什么只认真实今天**（D-60）：若按「正在查看的日期」判断，用户往前翻一眼历史、或往后翻看一眼下周，都会把池里的任务搬走——「翻一下」不是「我要安排它」的明确意图。所以自动导入只对真实今天生效；要在别的日期安排，用行上的「导入」按钮。

### 2.33 Markdown 日报只记当天（需求 4）

**是什么**：导出的 Markdown 只含**当前查看的那一天**。

**实现**：`buildMarkdown(data, options)` **本来就支持** `options.dateStr`（不传才是全部日期，那是给存档用的）——只是 `exportMarkdown` 一直没传。改动只有三处：

- `exporter.exportMarkdown(data, when, dateStr)`：第三个参数透传给 `buildMarkdown(data, { dateStr: dateStr })`；文件名跟着变成 `quadrant-<那一天>.md`（没传 dateStr 时退回原来的时间戳命名，保持向后兼容）。
- `app.js` 的 `doExport('md')`：`Exporter.exportMarkdown(state.data, undefined, state.date)`。
- `index.html` 导出菜单里 Markdown 那项的说明从「按日期排好的文本」改成「当前查看日期的日报」。

**JSON / ZIP / PDF 不动**：JSON 和 ZIP 是**存档**，必须整份才导得回来（ZIP 里的 `.md` 也保持全部日期，它是备份的一部分，不是日报）；PDF 打印页同样保持全部日期（这一条只点了 Markdown）。

---

## 八、v2.7 的那条需求怎么实现

需求原话：「计划池中的任务块，请设计成和象限中的任务块**完全一样的格式和功能**（编辑性）」。

**现状对照**（改之前）：

| 能力 | 象限的任务块 | 池内的任务块（改前） |
|---|---|---|
| 折叠 ▾/▸ | 有 | 有 |
| 改块名 | 点块名 → 输入框 | **没有**（块名是死文本） |
| 块头勾选框（全勾 / 全取消） | 有 | **没有** |
| 块头完成度 n/m | 有 | **没有** |
| 块内任务勾完成 | 有 | **没有**（池里连勾选框都没有） |
| 块内任务改文字 / 删除 | 有 | 有 |
| 块头动作按钮 | 「推迟」（→ 池） | 「导入」（→ 象限）—— 对应关系正确，**保留** |
| 块内任务的完成时间 DDL | — | 有（池独有，**保留**） |
| 块内任务的阶段 / 时段 / Bonus | 有 | 不画（本版仍不画，见 D-61） |

### 2.34 池内块头对齐象限块头（需求 1 前半）

**渲染层**（`render.js` 的 `buildPoolBlockHtml`）：块头按象限块的顺序排 —— `pool__block-check`（勾选框）→ `pool__block-name`（块名，可点）→ 完成度（复用 `task__progress` / `task__progress--done`）→ `pool__block-toggle` → `pool__block-import` → `pool__block-add` → `pool__block-del`。完成度走 `progressOfItem`，和象限块头、顶部统计是**同一个算法**（DS 1.3 规矩二），没有第二份实现。

**改名**：新增编辑态 `edit-pool-block`（`{ mode, blockId }`），渲染成和 `edit-block` 一样的输入框（`pool__block` + `task__input`），`app.js` 里新增 `startEditPoolBlock()`，`commitEdit` 的「改文字」分支调**既有的** `editPoolItem(data, blockId, value)` —— `editPoolItem` 本来就作用在 `locatePoolItem` 上，改块名和改池内任务文字是同一种写入，不新增数据层函数。

**勾块头**：新增 `togglePoolBlock(data, blockId, completed)`，照抄象限 `toggleBlock` 的骨架：`setUnitDone` 逐条设（有阶段设全部阶段）→ `syncBlockCompleted` 重算块自身 → 记下「未完成 → 已完成」翻转的子任务，逐个沉底。取反看 `progressOfItem(block).isComplete`，空块设了也无效果（`syncBlockCompleted` 对空块恒为 false）。

### 2.35 池内任务勾完成（需求 1 后半：「功能」）

**数据层**（`task-ops.togglePoolItem(data, poolItemId, completed)`）：

- 顶层**块** id 进来自动转给 `togglePoolBlock`（和象限 `toggleItem` 的分派方式一致，池版就一个入口）；
- 任务走 `getProgress` 取反（不传 `completed` 时）→ `setUnitDone`（**有阶段就设所有阶段**，和象限同一套，池内不画阶段不代表数据可以分岔）→ 在块内时 `syncBlockCompleted` 重算宿主块；
- 完成后调 `sendPoolCompletedToEnd(data, found)`：把条目移到**它所属的那个列表**（`container === 'block'` 用宿主块的 `tasks`，否则 `ensurePool(data)`）的末尾；只在 false → true 方向触发，取消勾选不移回（D-47 同一条规矩）。池条目没有 `slot`，所以不像象限沉底那样要顺带 `sinkTimeKey`。

**渲染层**（`buildPoolItemHtml`）：行首加 `pool__check`（`checked` 取 `task.completed`），完成态给 `<li>` 加 `pool__item--done`，CSS 用 `.pool__item--done .pool__text` 划掉 + 降透明度（和 `.task--done .task__text` 同款，但池行的类名不是 `task`，不能复用那条选择器）。

**交互层**（`drag.js` 的 `isInteractive`）：`pool__check`、`pool__block-check` 登记进去 —— 鼠标按住勾选框挪动不该变成拖拽（v2.5 修过的同一类回归）。**但不加进 `isCheckHandle`**：池里的勾选框只做勾选，不是拖拽把手（理由见 D-62 / R-33）。

**入口层**（`app.js`）：`doTogglePoolItem` / `doTogglePoolBlock`（成功后 `persist()` + 重画，和象限 `doToggle` 同一个形状：不做保护模式判断 —— 保护模式下由 CSS `pointer-events: none` 挡住点击，写路径再兜一层）。`bindPool` 的点击分支新增 `pool__block-check`、`pool__block-name`、`pool__check` 三个。

**保护模式**（DS 2.4）：`body.is-readonly` 的选择器名单补上 `.pool__check`、`.pool__block-check`（`pointer-events: none` + 降透明度）和 `.pool__block-name`（改名点不动），和象限的 `.task__check` / `.block__name` 同待遇。

---

## 九、v2.8 的三条需求怎么实现

### 2.36 时间视图下计划池排在下面（需求 1）

**问题**：计划池是**两个视图共用**的板块，但它在 `index.html` 里排在 `#timeview` **之后**，所以切到时间视图时池会跑到时间视图上面去。

**做法**：把 `#timeview` 整段移到 `#pool` **前面**，成为 `#reading → #quadrants → #timeview → #pool → #templates`。

**为什么不改 CSS `order` / JS `insertBefore`**：这是两行相邻的 HTML 顺序问题，改 HTML 是最小改动，而且**象限视图的观感完全不变** —— `#timeview` 在象限模式下是 `hidden`（`setViewMode` 里 `el.timeview.hidden = !isTime`），没有布局盒子，它排在哪都不影响下面的元素。用 CSS `order` 会把顺序这一件事拆到两处（HTML 一处、CSS 一处），用 JS `insertBefore` 则要新增一段「切视图时挪 DOM」的运行时代码，两者都比改一行多。

**回归守卫**：`test-layout.js` 断言 `at('timeview') < at('pool')`。顺序是 HTML 里最容易被人「顺手摆整齐」的东西，而回归只在切到时间模式时才肉眼可见。

### 2.37 阅读栏（需求 2）

需求原话：「加入一个阅读栏，允许自己添加正在阅读的事项（提示不超过3项），可以自己设置起始时间，下方还有已阅读完成的内容，在将上面正在阅读的事项点击完成之后，自动在下方已阅读完成的内容项上显示完成时间，当然在下方可以自己修改起息时间。已阅读完成的内容设置一个展示上限，已完成阅读的内容很多的话要支持滚动条拖动。」位置由 v2.8 需求 3 定死：**顶部，四象限上面**。

**数据模型**（`store.js`）：主数据多一个**可选**顶层字段

```
reading: {
  active: [ { id, text, start, doneAt, createdAt } ],
  done:   [ { id, text, start, doneAt, createdAt } ]
}
```

- `text` 去空白后不能为空（和任务同一条规矩，D-31）；
- `start` / `doneAt` 是**日期** `'YYYY-MM-DD'`（v2.8 补充：需求「阅读板块的时间指的是日期」），`start` 可以没有（存 `null`，**不是**空串 —— 见下）；
- 老数据 / 老备份 / 老导出文件里没有 `reading` → `normalize` 补一张空表，`schemaVersion` **不动**（纯追加，和 v1.1 的 `pool` / v2.1 的 `templates` 同一条取舍）；
- **导出带着它**（`Store.serialize(data)` 直接序列化整个 data，JSON / ZIP 白拿），**但它不进 Markdown / PDF 日报**（日报是「那天干了什么」的产出，阅读栏不按天组织，硬塞进去只会让日报多一段和当天无关的内容）；
- 不进 `buildArchivePayload`（30 天归档只搬「某几天的日期数据」，阅读栏没有日期，不参与归档）。

**「在哪张表」是唯一的完成判据**：`normalizeReading` **强制**对齐 —— `active` 里的条目一律把 `doneAt` 抹成 `null`，`done` 里的条目一律得有个日期（脏数据补**今天**）。留一个和所在表矛盾的 `doneAt`，只会让渲染、统计、导入三处各多一道「到底信哪个」的判断。

**为什么 `start` 的「没设」是 `null` 不是 `''`**：空串和 `null` 在 JS 里都是假值，但一旦两者并存，每个判断都要写成 `if (!x || x === '')`。收口成一个值（`null`）就不会有第二种情况。

**数据层**（`task-ops.js`，一组自洽的纯函数）：

| 函数 | 行为 | 失败 |
|---|---|---|
| `ensureReading(data)` | 缺表 / 表不是数组就地补齐（老数据、手写对象都扛得住） | — |
| `findReadingItem(data, id)` | 两张表里找一条，返回 `{item, list, done}` | `null` |
| `addReadingItem(data, text, startDate)` | 加进 `active` 末尾；`startDate` 不传 / 非法取 `Util.todayStr()` | `EMPTY_TEXT` / `BAD_DATE` |
| `editReadingItem(data, id, text)` | 改名 | `NOT_FOUND` / `EMPTY_TEXT` |
| `setReadingStart(data, id, dateStr)` | 设 / 改起始日期；传空 → `null` | `NOT_FOUND` / `BAD_DATE` |
| `removeReadingItem(data, id)` | 删 | `NOT_FOUND` |
| `completeReadingItem(data, id, doneDate)` | `active` → `done` **开头**，`doneDate` 不传取**今天**；已在 `done` 里则只更新日期、不重复搬 | `NOT_FOUND` / `BAD_DATE` |
| `restoreReadingItem(data, id)` | `done` → `active` **开头**，`doneAt` 清成 `null` | `NOT_FOUND` |
| `getReadingStats(data)` | `{active, done, limit, over}` | — |

搬完**不删 `start`**：行上要显示「2026-10-01 → 2026-10-05」，起始日期是这条记录的一部分（和池条目勾完保留 DDL 同理）。两个日期**相同就只画一个**（当天开始当天读完是常态，画「X → X」是废信息）；`start` 没设过时同理只画完成日期，不画「未设定 → …」。

**渲染层**（`render.js`）：`buildReadingHtml(reading, view)` 画上下两段 —— 头部（收起三角 + 「📖 阅读栏」+ `n/3` 计数 + 「＋」）、`reading__list`、`reading__done`（小标题 + 个数 + `reading__done-list`）。`buildReadingItemHtml(item, editing, done)` 画一条：正在阅读那边是 `reading__check` + 文字 + `reading__start` + `reading__del`；已完成那边是 `reading__restore`（↩）+ 文字 + `reading__time`（日期按钮，跨天时后面再跟「→ 完成日期」）+ `reading__del`。**两段里的日期都是同一个 `reading__start` 按钮**（v2.8 补充修订三）—— 需求明说「下方可以自己修改起息时间」，而在那之前已完成那行画的是死文本，点不动，改不了。两个编辑态各用各的输入框：改名复用 `task__input`（和别处一致，键盘 / 失焦提交也就共用了），起始日期用 `<input type="date" class="reading__start-input">` + `reading__start-clear`（清成未设定）。日期框的样式和提交方式和计划池的 `pool__date-input` **完全一样**（同一个控件不该做成两样，`.reading__time` 加 `white-space: nowrap` 防日期从中间折行）。

**交互层**（`app.js`）：`bindReading()` 独立绑 `#reading` 子树（和 `bindPool` / `bindTemplates` 一个形状）。`reading__check` 的 `change` 分两路 —— 勾上走 `doCompleteReading`，取消勾走 `doRestoreReading`（取消勾 = 取消完成，见 D-65）。`commitEdit` 认得 `add-reading` / `edit-reading` / `edit-reading-start` 三个模式。四个写函数（`doCompleteReading` / `doRestoreReading` / `doRemoveReading` / `doSetReadingStart`）进门先判 `Store.isProtectionMode()`，和其余所有写路径同一条规矩。

**编辑框里的值从哪儿读**（v2.8 补充修订三）：`commitEdit` 不再按 `mode` 逐个三元挑输入框，而是一次列出**所有**编辑框的选择器（`.stage__input, .task__input, .pool__date-input, .reading__start-input`）。依据是「屏幕上同时只有一个编辑框」—— `state.editing` 是**单个**对象，渲染时也只画一处，所以谁在 DOM 里就读谁。原来那种写法每加一种编辑框都得回来补一个分支，漏了就静默失效（见 R-40）。

**阅读栏不参与拖拽**：`.reading__item` 不是拖拽容器，`drag.js` 里**一个字都没有**「reading」。它是纯清单，没有排序需求（需求没提，D-64 那条「照需求做」的取舍同样适用）。`test-reading.js` 用 `dragSrc.indexOf('reading') === -1` 把这条钉死。

**修订一（2026/10/6，试用反馈）：回车没反应** —— 根因是 `commitEdit` 的**分发骨架**而不是阅读栏本身，详见 R-38。修法是把 `'add-reading'` 补进「新增」分支的外层条件，阅读栏的数据层 / 渲染层一行没改。

**修订二（2026/10/6，试用反馈）：时间是日期** —— 需求「阅读板块的时间指的是日期」。初版把 `start` / `doneAt` 做成 `'HH:MM'`（当时的口径是「今天几点开始读的」，见 5.3 旧第 2 条），现在统一改成 `'YYYY-MM-DD'`：

| 点 | 初版（时分） | 现在（日期） |
|---|---|---|
| 字段形状 | `start` / `doneAt` = `'HH:MM'` | `start` / `doneAt` = `'YYYY-MM-DD'`（**字段名不动**） |
| 不传时的默认 | `Util.nowTimeStr()`（此刻） | `Util.todayStr()`（今天） |
| 输入控件 | `<input type="time" class="reading__start-input">` | `<input type="date" class="reading__start-input">`（和 `pool__date-input` 同一副样式） |
| 校验 | `Util.isValidTimeStr` | 写路径 `Util.isValidDateStr`；读路径 `Util.isValidReadingStamp` |
| 错误码 | `BAD_TIME`（已删） | `BAD_DATE`（和池里完成时间共用一个码，文案「日期格式不对」） |
| 已完成那行 | 恒画「起始 → 完成」 | 两个日期相同 / 起始没设 → 只画一个日期 |
| 提示语 | 「起始时间 / 清空起始时间」 | 「起始日期 / 清空起始日期」 |
| `Util.formatTime` / `nowTimeStr` | 阅读栏在用 | **已删**（改口径后一个调用点都不剩，留着会让人以为还能记到分钟） |

**兼容怎么保的（关键取舍）**：用户手里可能已经有 v2.8 初版导出的、带 `'HH:MM'` 的 JSON。「兼容前面版本导出的 JSON」是硬约束，所以**读路径一律宽松**：

- `Util.isValidReadingStamp(s)` = `isValidDateStr(s) || isValidTimeStr(s)` —— 老值**原样保留**，不当脏数据抹掉（抹掉 = 用户记的东西真没了）；
- 用它的地方只有两处，都是读：`Store.normalizeReadingItem`（清洗本机老数据）和 `importer.readOptionalStamp`（导入老文件）；
- **写路径仍是严格版** `isValidDateStr`：新增 / 改起始日期传 `'09:30'` 会被 `BAD_DATE` 拒掉。否则「时间指的是日期」这条永远收不了口 —— 老值是尾巴，不是功能。

代价说清楚：老条目的日期框里会是**空的**（`<input type="date">` 认不了 `'09:30'`），行上照常显示 `09:30`；用户点一下选个日期就换成日期了。这是「保留老值」和「框里能显示」之间**必须选一个**的地方，选了前者（数据优先）。

**修订三（2026/10/6，试用反馈）：日期设定改成和计划池一套** —— 需求「阅读栏的日期设定功能仍然有问题。改成和计划池的日期设定类似的格式」。计划池那套是**能用的**（试用反馈里它是被当成正确样板提出来的），所以把两者逐条对齐，同时修掉两处**只有阅读栏才有**的功能缺陷：

| 点 | 计划池（正确样板） | 阅读栏（改之前） | 改之后 |
|---|---|---|---|
| 行上的日期 | `pool__date` 按钮：无边框、淡色 12px 文字、`opacity .8`；没设时 `pool__date--empty` 加斜体 `opacity .45` | `reading__start` 按钮：1px 边框小方块、`--empty` 只是 `opacity .6` | 与 `pool__date` / `--empty` **逐条一致**（同一条声明清单，测试按选择器取规则体比对） |
| 唤起编辑 | 点日期 → `startEditPoolDate` → `Render.focusEditor(false)` | 点日期 → `startEditReadingStart` → `focusEditor(**true**)`（对日期框 `select()` 无意义） | 改成 `focusEditor(false)`，和池同款 |
| 编辑框 | `.pool__date-input`（蓝边 + `min-height: 32px`） | `.reading__start-input`（上一轮已对齐样式） | 不变（已经一致） |
| 清除按钮 | `pool__date-clear`，文案「清除」，12px / `padding: 4px 6px` | `reading__start-clear`，文案「×」，14px / `padding: 4px 8px` | 与 `pool__date-clear` **逐条一致**，文案也改成「清除」 |
| **提交时读哪个框** | `commitEdit` 特判了 `edit-pool-date` → 读到正确的值 | **没有特判**，掉进默认分支去读 `.task__input` → 读不到 → `value = ''` → **把刚选的日期清成 `null`** | 一次列出所有编辑框选择器（见上），读到正确的值 |
| **点「清除」之后** | `doSetPoolDate` 进门先 `commitEdit()` → 编辑框关闭、显示「未设定」 | `doSetReadingStart` **没调** `commitEdit` → `state.editing` 还挂着 → 重画之后**编辑框原地不动**（清没清用户看不出来） | 和 `doSetPoolDate` 同款：先 `commitEdit()`，再 `setReadingStart`，清完给一句「已清除起始日期。」 |
| 已完成那行 | 日期按钮**一直都在**（池里没有完成态差异） | 画的是死文本 `reading__time`，**点不动** → 需求「下方可以自己修改起息时间」根本做不到 | 同样画日期按钮（跨天时后面跟「→ 完成日期」），点得动、能改 |

一句话总结前两条功能缺陷的共同形状：**计划池那套是对的，阅读栏少了「让提交逻辑认出这个框」和「清空时先收掉编辑态」这两步** —— 它们都不是样式问题，所以只改 CSS 是修不好的。

**已完成那行现在也带「未设定」**：改之前 `start` 没设过的已完成条目只画完成日期（「不画废信息」）。现在那行得留一个点得动的按钮（否则改不了起始日期），所以显示成「未设定 → 2026-10-05」。这是**故意接受**的一点噪音，换来的是需求原文那句「下方可以自己修改起息时间」真的能做到；两个日期相同时仍然只画一个（D-68 不变）。

### 2.38 三个板块可收起（需求 3）

需求原话：「顶部，四象限上面，可以收起。计划池和模板池也要可收起，同时刷新页面后收起状态应是可以被记忆的」。

**做法**：阅读栏 / 计划池 / 模板池的头部最左边各加一个收起三角（`render.panelToggleHtml(panelId, view)`，`data-panel` 是短名 `reading` / `pool` / `templates`）。

**收起状态存在哪**：**复用 `foldState`**（D-53 那条路），给它加第三个字段 `collapsedPanels`：

```
foldState: { expanded: {...}, collapsedBlocks: {...}, collapsedPanels: { pool: true } }
```

理由和 D-53 写的一模一样：这是「这台设备看着顺手」的**界面状态**，不是用户数据。既然已经有了一条「界面状态存哪、怎么读坏、存不上怎么办」的路，再加一个存储 key 只会多一处会坏的地方（`getFoldState` / `setFoldState` 的每个分支都得同步维护两份）。

**渲染**：`render.setCollapsedPanels(collapsedPanels)` 遍历 `CONFIG.PANEL_IDS`，给对应板块 `classList.toggle('is-collapsed')`；`render()` 主流程里调一次，所以换视图 / 重画都跟得上。CSS 只需两条：`.is-collapsed` 时把内容（各板块自己的列表 / 空态）`display: none`，头部边框去掉。

**入口**（`app.js`）：`togglePanel(panelId)` 白名单校验（`CONFIG.PANEL_IDS.indexOf(panelId) === -1` 直接 return）→ 翻转 `state.collapsedPanels[panelId]` → `persistFoldState()` → `renderCurrent()`。白名单是必须的：`data-panel` 的值来自 DOM，手工改过的 DOM 能往本机写进任意 key。

**收起是纯界面动作，保护模式下照常能点**：它不写用户数据，所以 `.panel__toggle` **故意不进** `body.is-readonly` 的 `pointer-events: none` 名单（CSS 里有一条注释写明这件事，`test-reading.js` 也有一条反向守卫 —— 谁哪天顺手把它加进名单，测试会红）。`bindReading` / `bindPool` / `bindTemplates` 三个点击处理器的第一件事都是 `closest(target, 'panel__toggle')`，命中就 `togglePanel` 并 return —— 所以收起动作在保护模式下也走通了（那三个 handler 的**写操作**分支各自有 `isProtectionMode` 早退，收起分支在它们之前）。

### 2.39 池内块的外框对齐象限（v2.8 补充需求 2，纯样式）

需求原话：「将计划池里的任务块的渲染格式改成和象限池一样，带一个蓝色边框。」

**现状对照**（改之前）：v2.7 已经把池内块的**格式和功能**对齐了（2.34 / 2.35），但 **CSS 外框没跟上**：

| | 象限的块 `.block` | 池内的块 `.pool__block`（改前） |
|---|---|---|
| 左侧竖线 | `3px solid var(--q2)`（蓝，`#3498db`） | `3px solid var(--border)`（灰） |
| 整圈边框 | `1px solid var(--border)` | **没有** |
| 底色 | `color-mix(in srgb, var(--q2) 4%, var(--surface))`（浅蓝） | **没有**（透明） |
| 圆角 | `6px` | **没有** |

**做法**：把 `.pool__block` 的这四条声明改成和 `.block` **逐字一致**。DOM 结构一个字没动（池内块头 / 块内列表的类名和 v2.7 完全一样），所以拖拽、勾选、改名、导入、折叠全部行为不受影响 —— 这是一次纯渲染层的样式对齐。

**保留的差异**：块内任务列表的缩进。象限是 `.block__tasks { padding: 0 0 0 30px }`，池内是 `.pool__block-tasks { padding: 0 0 0 8px }`。这一条**故意不抄**：池面板比象限列窄得多，30px 缩进加上池条目自己的勾选框会把任务文字挤出可视区。需求点名要的是「渲染格式一样，带一个蓝色边框」，外框对齐即达成视觉同一性；缩进是列宽决定的局部排版，不属于「格式」。

**回归守卫**：`test-pool-align.js` 新增一组「外框对齐象限块」—— 逐条断言 `border` / `border-left` / `border-radius` / `background` 四条声明在 `.block` 和 `.pool__block` 里**完全一致**，再加上「不再是灰竖线」和「加了边框要有内边距」。取 `.block` 的规则体不能图省事用 `indexOf('.block {')`：那会先撞上后代选择器（`.quadrant--dragging .block { ... }`）的尾巴。守卫按规则逐条比对完整选择器，比对前先剥掉 CSS 注释。

---

## 十、v2.9 的那条需求怎么实现

### 2.40 连续双击整条高亮（需求 1）

需求原话：「连续双击可以给当前任务 / 任务块 / 阶段的整体加上高亮效果。高亮效果用浅橙色，完全覆盖字体的高度。」

#### 数据：一个可选布尔，挂在**最细可勾选单位**上

`highlight` 和 `bonus` 同一档：**任务本体**（无阶段任务 / 块内任务 / 池内任务）、**阶段**、**块本体**（象限的块 / 池内的块）都能标。存储走项目一贯的 append-only 可选字段：

| 层 | 做法 |
|---|---|
| `Store.normalizeTask` / `normalizeStage` | `if (raw.highlight === true) task.highlight = true;` —— **严格 `=== true`**，不认 `"yes"` / `1` / 空对象这类脏值 |
| `Store.normalizeItem` 的块分支 | 同上；块内的任务各自走 `normalizeTask` |
| `Store.serialize` | 就是 `JSON.stringify(data)`，**一个新字段就自动进了导出**，不需要改导出层 |
| `importer` 的 `checkTask` / `checkStage` / `checkBlock` | 形状里带 `highlight: raw.highlight === true ? true : null`；`copyTask` / `copyBlock` 逐条搬过去 |
| 老文件 / 新版本互通 | 老文件没有这个字段 → 读进来就是「没高亮」，**不补默认值**；旧版本读 v2.9 的文件只当它是个不认识的键，忽略。`schemaVersion` 保持 1 |

**为什么不传染**：标一个任务块**不等于**标它的任务。块头标橙的语义是「这整块先看着」，块内每条任务该有自己的高亮；反之亦然（`store.js` 里那段注释写明了这条）。这跟「块完成度**由**块内任务推导」正好相反 —— 高亮是**标记**不是**状态**，不走推导。

#### 业务：四个 set 函数，**故意不做 sync 收尾**

`task-ops.js` 新增 `setHighlight` / `setStageHighlight` / `setBlockHighlight` / `setPoolHighlight`，形状和 `setBonus` / `setStageBonus` 一模一样（定位 → 置位或 `delete` → 返回 `{ ok, … }`，定位不到就 `NOT_FOUND`）。

和 `toggleDone` / `setSlot` 那类函数的两点不同，都是故意的：

1. **不调 `syncCompleted` / `syncHostBlock`**。那两个是给「改了分母」的字段收尾的（勾选、改时段都会动完成度）。高亮**不改分母**、不改 `completed`、不改排序、不改 DDL，调了反而是无谓的重算。
2. **`setPoolHighlight` 也认块内任务**（`locatePoolItem` 三条路全走），因为池里能标的东西和池里能显示的东西是同一批。象限里没有「块内任务单独高亮」这条独立入口 —— 块内任务的 `hit` 解析出来是「任务」这一档（见下），落到 `setHighlight`。

#### 数据流：高亮要跟着**对象**走，这是本版最容易漏的地方

推迟 / 导入 / 复制 / 套模板都是**同一个对象搬位置**或**造一个副本**，每一个路径都得把 `highlight` 带上，否则用户会看到「标了黄，推一下就没了」。逐条核对过：

| 路径 | 落在哪 | 做法 |
|---|---|---|
| 任务 / 块 / 阶段整体推迟 | `postponeTask` / `postponeBlock` / `postponeStage` | 任务与块是搬对象（字段自己跟着走）；**阶段推迟是新建一条池条目**，所以 `postponeStage` 里显式 `if (found.stage.highlight === true) pooled.highlight = true;` |
| 池 → 象限「导入」/ 拖回 | `restoreFromPool` | 搬同一对象，字段跟着走 |
| 模板套用 | `applyTaskCopy` / `applyItemCopy` | 逐条复制：阶段 + 任务 + 块都要显式抄 `highlight`。**注意任务这一条不套用 Bonus 那个 `!task.stages` 条件** —— Bonus 只给无阶段任务（有阶段的走阶段 bonus），高亮则无阶段 / 有阶段都能标 |
| 搜索过滤 | `filterDayByKeyword` | 过滤是**造副本**，块和数据项两条复制路径都要抄 `highlight` |
| 时间视图 | `getTimeView` | 每个 item 带出 `highlight: xxx.highlight === true`（任务是任务自己的，阶段是阶段自己的） |

#### 手势：双击的第二下**吞掉**，用的是第一下记下的落点

这是本版唯一有设计取舍的地方。难点是：**点一下已经是别的事**（点文字进编辑、点勾选框勾完成、点按钮触发按钮），而双击的**第一下**必然先走完那套分流。

**做法**（`app.js`）：

1. 三处点击处理器（象限 / 时间视图 / 计划池）的**最前面**判 `e.detail >= 2` —— 是第二下就调 `handleSecondClick()` 并 `return`，不进下面的分流。
2. 不是第二下（第一下）时，照常走原有分流，但**先**把「点到了哪一条」记进 `state.clickHit`（`rememberHit` 顺手打时间戳）。落点解析 `hitOfQuadrant` / `hitOfTimeView` / `hitOfPool` 的**判断顺序必须是「从里往外」**：阶段 → 任务 → 块，池内任务 → 池内块。顺序反了，点块内任务会被 `closest('block')` 当成点整个块（和 v2.5 修过的那类错同形）。
3. `handleSecondClick` 取 `state.clickHit` 并**立刻清空**（一次连击只翻一次，三下 / 四下连点不会来回翻），再判陈旧（见下），然后 `doToggleHighlight(hit)`。
4. `doToggleHighlight`：保护模式早退 → `commitEdit()`（第一下已经把这条开成编辑框了，先落下；文字一个字没改，但编辑框不该继续杵着）→ **按落点重新查一遍数据**（`findHighlightTarget`，那一条可能在这两次点击之间被删了）→ `on = !(target.highlight === true)` → 调对应的 set 函数 → `persist()` + `renderCurrent()`。

**为什么不用第二下的 `e.target`**：第一下开了编辑框，渲染重画已经把原来的节点换掉了，第二下再去问 DOM 会什么都问不到。取第一下记下的落点，稳。

**为什么不在控件上记落点**（`isControlNode`：`INPUT` / `TEXTAREA` / `SELECT` / `BUTTON` 或它们的祖先）：三种控件各有理由 ——

- **勾选框**：连点两下 = 勾上又取消，浏览器本来就这规矩，不该顺带标高亮；
- **按钮 / 下拉**：连点两下多半是想连按两次（推迟两条），别抢；
- **输入框 / 文本域**：**编辑框里双击 = 选词**，这是系统手势。少了这一条，双击任务文字进编辑之后想选个词就选不动了。

**`commitEdit` 在保护模式下也不写东西**，所以保护模式那条早退放在最前面就够了（它是「任何写操作不放行」的同一道门）。

#### 样式：把底色画在**文字 span** 上，不是画在 `li` 上

需求原话「完全覆盖字体的高度」是这一条的关键，也是唯一需要解释的实现细节：

```css
.task--highlight:not(.task--done) .task__text,
.stage--highlight:not(.stage--done) .stage__text,
.block--highlight:not(.block--done) .block__name,
.pool__item--highlight:not(.pool__item--done) .pool__text,
.pool__block--highlight:not(.pool__block--done) .pool__block-name {
  background: var(--hl-bg);
  color: var(--hl-text);
  padding: 0 3px;
  margin: 0 -3px;
  border-radius: 3px;
}
```

- **画在 `.task__text` 这类文字 span 上，不画在行 `li` 上**：行 `li` 有 padding，底色会漫成一条色带；span 是 inline，背景高度按**行盒**算（`line-height: 1.6` × 字号），而字形实际高度只有 1em 左右 —— 底色必然盖满整个字高、上下还各多一点边。这就是「完全覆盖字体的高度」的落点。
- **`padding: 0 3px` + `margin: 0 -3px`**：底色左右各多出 3px（不贴着字，像荧光笔划过去），等量负边距把占位抵消掉，加 / 取消高亮时旁边的勾选框、按钮**一个都不动**。
- **颜色变量定死**（`:root { --hl-bg: #ffd8a8; --hl-text: #3a2a12; }`）：浅橙底 + 深棕字。文字色**不跟 `--text` 走** —— 暗色主题下 `--text` 是浅灰，压在浅橙上根本看不清。**`[data-theme="dark"]` 刻意不覆盖这两个变量**，两端、两种主题一致（FS 原话「暗色模式下高亮是纯色覆盖整个字高，文字必须看得清」）。
- **`:not(--done)` 表达「完成后自动失效」**：做完了本来就划线变淡，再压一层橙底反而看不清划线。**只是不显色，数据里的 `highlight` 不动** —— 取消勾选后高亮自己回来，不用用户重标一遍。这和 v1 的片段高亮是同一条口径（FS「七、推迟与标记」）。
- **渲染层**：`render.js` 的六个构造器各加一个类（任务 / 阶段 / 块的 `li`，池条目、池块，以及时间视图两种变体）。**编辑态的那几个分支一个字没改** —— 编辑框里不需要底色。

#### 回归守卫（`test/test-highlight.js`，54 项）

| 组（`test-highlight.js`，9 组 54 项） | 锁住什么 |
|---|---|
| `setHighlight` | 任务本体的置 / 删 / `NOT_FOUND` / 非法日期与象限；块内任务这一档；**加高亮前后统计逐项不变** |
| `setStageHighlight` | 阶段的置 / 删；**不动任务本体**（不传染） |
| `setBlockHighlight` / `setPoolHighlight` | 顶层任务、顶层块、块内任务、非法 id 四档 |
| `store.normalize` | 严格 `=== true`（`false` / `'yes'` / `1` / `0` / `null` / `{}` / `[]` 全丢）；老数据读进来**没有**这个字段（不是 `false`）；序列化往返；模板条目 |
| 导入导出 | 三种形状往返、老备份、脏值、覆盖导入、池内条目 |
| 渲染 | 六处类名挂在该挂的地方、`done + highlight` 两个类同时存在、编辑态不变、转义不破 |
| 数据流转 | 上面那张表逐条：`filterDayByKeyword` 的块副本、`getTimeView`、`applyTemplate`、三条推迟、`restoreFromPool` |
| CSS 守卫 | `--hl-bg` 确实是浅橙（r > g > b 且够亮）、`--hl-text` 在 `--hl-bg` 上对比度 **> 4.5**、暗色主题**不**覆盖 `--hl-*`、五条选择器齐全、**没有** `.task--highlight {` 这种画在 `li` 上的规则、`padding: 0 3px` + `margin: 0 -3px` 成对存在 |
| app.js 源码守卫 | 三处点击分流最前面都判 `e.detail >= 2`（另有两条注释也提到它，所以守卫用的是更严的正则 `if (e.detail >= 2) {` + 紧跟 `handleSecondClick();`，只认真正的三处代码）、三处 `rememberHit(...)` 赋值、`handleSecondClick` 消费落点 + 判陈旧、解析顺序「阶段 < 任务 < 块」与「池内任务 < 池内块」、`isControlNode` 的四种标签、保护模式、`commitEdit`、四个 set 调用 + `persist` + `renderCurrent`、`clickHit` 只在 app.js（**不进 store.js**，它是界面状态不是用户数据） |

没有 DOM 跑不了真实双击，所以手势那部分只能靠源码守卫 + CSS 守卫锁住形状，真机手感列在 5.3。

---

## 十一、v2.10 的四条需求怎么实现

### 2.41 勾选后保留滚动位置（需求 1）

#### 问题从哪来

渲染是**整块 `innerHTML` 替换**（DS 2.1 的取舍：拼字符串 + 一次性灌进页面，换取「数据 = 页面」这条不会漂移的对应关系）。代价是**容器元素每次都是新造的**，浏览器的 `scrollTop` 天然回到 0。于是在一个滚到中段的列表里勾一下完成度，视角就被弹回顶部 —— 条目一多，用户得重新滚回去找刚才那一条。

#### 修法：不改渲染方式，改成「拍快照 → 重画 → 贴回去」

推翻 `innerHTML` 方案（改成增量 DOM 更新）要付出的代价远大于问题本身：整套「数据顺序 = 渲染顺序」的假设（D-46 沉底、`computeDropIndex` 的落点算法）都建立在「重画是幂等的」之上。所以选择绕开它：

```
app.js renderCurrent({ keepScroll: true })
  ① Render.captureScroll()          → { 键 → scrollTop }
  ② Render.render(...) / renderTimeView(...)   （整块替换，滚动位置归零）
  ③ Render.setViewMode(...)          ← 必须在这之前贴回（见下）
  ④ Render.restoreScroll(快照)       → 找同名容器，写回 scrollTop
```

**职责切分**：渲染层只提供「拍」和「贴」两个纯动作（`render.js` 只读数据 / 不碰数据的既有规矩不变），**什么时候用**由入口层决定 —— 就是 `renderCurrent(options)` 上的 `keepScroll` 开关。

#### 键怎么定（这一条最容易出错）

快照的键**必须由结构和内容决定**，不能用元素身份（每次重画都是新元素）。登记表在 `render.js`：

| 滚动容器 | 选择器 | 键 |
|---|---|---|
| 四个象限 | `.quadrant__body` | `q:<data-quadrant>` |
| 时间视图每个时间栏 | `.timeview__list` | `tv:<data-slot>` |
| 计划池 | `.pool__list` | `pb`（只有一份） |
| 模板池 | `.tpl__list` | `tpl` |
| 阅读栏「正在阅读」 | `.reading__list` | `rd` |
| 阅读栏「已读完成」 | `.reading__done-list` | `rdd` |

`data-quadrant` 挂在 `section.quadrant` 上、`data-slot` 挂在 `section.timeview__group` 上（都是 `render.js` 早就在画的属性），所以键不需要新加任何 DOM 属性。

#### 贴回要排在最后

`restoreScroll` **必须**在 `setViewMode` 之后调用：被 `hidden` 的容器量不到高度，浏览器会把写进去的 `scrollTop` 夹成 0。顺序反了，时间视图和象限视图之间切一次就会把位置吃掉。

#### 哪些动作带这个开关

**带**（都是「原地改一个字段」，列表长度和条目位置都没变）：
- `doToggle`（任务）、`doToggleStage`（阶段）
- 象限块头勾选框（内联在 change 监听里，一键全勾 / 全取消）
- `doTogglePoolItem`（池内任务）、`doTogglePoolBlock`（池内块头）

时间视图里的勾选走的是同一个 `doToggle` / `doToggleStage`（`bindTimeView` 直接复用），所以自动覆盖。

**不带**（内容真的变了，画完从头看才对）：新增、删除、推迟、导入、切日期、切视图、改搜索词。特别是新增任务加在**开头**（D-50），粘住旧位置反而像「没生效」。

#### 回归守卫（`test/test-scroll-keep.js`，9 项）

| 组（9 项） | 锁住什么 |
|---|---|
| 登记表 | 从 `style.css` 里把所有带 `overflow-y: auto` 的规则扫出来，逐个要求出现在 `Render.SCROLL_SLOTS` 里 —— **以后新加一个能滚的面板而忘了登记，测试直接红**（这类「漏一处」正是本条的失败模式） |
| 键的来源 | `.quadrant__body` 按 `data-quadrant`、`.timeview__list` 按 `data-slot` 分键，并反向核对 `render.js` 里确实画了这两个属性；只有一份的四个容器用固定键、不找祖先 |
| Node 安全 | 没有 `document` 时 `captureScroll()` 返回空表、`restoreScroll(空 / null)` 不报错（测试跑纯函数，不能因为碰 DOM 就崩） |
| 接线 | `renderCurrent` 带 `options`、前后各有采 / 贴，且 `restoreScroll` 排在 `setViewMode` **之后**；五处勾选分支都传了 `keepScroll`；时间视图复用 `doToggle`；四个「内容变了」的操作**不带**开关 |

### 2.42 手机端拖动把手统一成勾选框（需求 2）

#### 改的是哪条既有决定

v2.7 的 **D-62** 明确写了「池里的勾选框**只做勾选、不当把手**」，理由是要保住池条目「整条可拖」这条既有通路。代价记在 **R-33**：`.pool__item` 上留着 `touch-action: none`，手机端手指按在池条目上就被判成拖拽，**池列表根本滚不动**。

v2.10 需求 2 的原话是「**象限模式和计划池中**所有任务 / 阶段的拖拽都要以完成勾选位置处为把手，其他位置触碰到之后不应该触发拖动」—— 直接点名池也要一样。于是 D-62 被反转，R-33 顺带解除。

#### 三处改动

1. **`isCheckHandle` 收下池内两个勾选框**：`pool__check`、`pool__block-check` 加进把手名单（象限的三个照旧）。
2. **`isInteractive` 的例外**：池内勾选框本来就在「按它不进入拖拽」的名单里（防鼠标误拖，R-34）。现在要放行**触摸**这一种组合：
   ```js
   var touchLike = e.pointerType === 'touch' || e.pointerType === 'pen';
   var onCheck = isCheckHandle(e.target);
   if (isInteractive(e.target) && !(touchLike && onCheck)) return;
   if (touchLike && !onCheck) return;   // 触摸 / 笔：不是勾选框就不拖
   ```
   鼠标按勾选框仍然是「只勾选、不拖」（改这条老行为没人要求，且鼠标整行都能拖，把手不必收窄）。
3. **CSS 搬把手**：`touch-action: none` 从 `.pool__item`、`.pool__block-head` 搬到 `.pool__check`、`.pool__block-check`（和象限的 `.task__check` 等合成一条规则）。`touch-action` 在**手势开始那一刻就定死**，所以它必须挂在真正的起手位置。

#### 副作用（都是想要的）

- 池列表在手机上**能正常滚动了** —— R-33 解除。
- 池内条目、池内块头的其余区域不再拦触摸，手指按上去就是滚列表。
- 「勾选框是把手」这条象限口径现在**两个区域一致**，R-24（用户以为拖拽坏了）的说明也统一了。

#### 回归守卫

- `test-drag-handle.js`：五种勾选框共用一条 `touch-action: none`；`.pool__item` / `.pool__block-head` **本体**不再有 `touch-action`。
- `test-pool-align.js`：`isCheckHandle` 里**必须**有 `pool__check` / `pool__block-check`（把 v2.7 时那条反向断言改过来，注释里写明是被需求反转的）。

### 2.43 象限 ↔ 计划池双向拖拽（需求 3）

#### 需求怎么落到落点上

需求原话：「象限中所有可能的拖动情况，在计划池中都需要相应支持，相互之间的拖动都需要支持」。象限里的落点有四类 —— 顶层换位、跨象限、**进块**、**出块**；池里对应地要有 —— 池顶层换位、池内块内换位、**进池块**、**出池块**；再加上两个区域之间的两向搬运。

v2.6 的池内拖拽有一条明确禁令（**D-58**）：**只在各自列表内排序**，跨容器一律不受理。它挡住的正是「进池块 / 出池块」这两类 —— 需求要求补齐，所以 D-58 的禁令部分作废（toIndex 口径那部分继续有效）。

#### 落点对象统一成一个形状

v2.6 给池内换顺序单独挂过一个布尔标记（`poolReorder`）。要再加上「区域」这一维，标记法就开始漏项了，所以统一成：

```
{ region: 'quadrant' | 'pool', quadrantId, blockId, toSlot, index }
```

- `region` 说落在哪个区域；
- `quadrantId` 只在 `region === 'quadrant'` 时有值；
- `blockId` = **落点所属的那个块**：象限里是象限块的 id，池里是池内块的 id，顶层为 `null`（两套 id 空间靠 `region` 区分，不会混）；
- `toSlot` 只有时间视图用。

`sameTarget` 就比这五项，`poolReorder` 一并取消 —— 少一个特例，以后加落点类型不会漏比。

#### drag.js 侧的改动

- `poolContainerOf` / `poolListUnder` → 收口成 **`poolDropTarget(node)`**：返回指针底下那个池列表（`.pool__block-tasks` 优先于 `.pool__list`）+ `blockId` + `itemEl`。落点只认「指针底下那个列表」，与来源容器无关。
- `updateTarget` 的池分支**对所有 kind 生效**（象限任务 / 象限块也能落在池里），并且不再比对「是不是自己那个列表」。
- **块不许进块**：被拖的是块（象限块 `kind:'block'` 或池内块 `state.isPoolBlock`）时，池里的「块内列表」落点一律 `return`（保持上一次落点、不改数据）。
- 象限分支里，池内条目（`kind === 'pool'`）不再单独走一条「只落顶层」的路，和任务合并 —— 于是池任务也能落进**象限的块**。
- `finish()` 去掉 `poolReorder` 那条特例分支，统一报 `{ kind, region, ..., quadrantId, targetBlockId, index }`。

#### task-ops 侧的入口

| 拖什么 | 落哪 | 入口 |
|---|---|---|
| 象限任务 → 池 | `moveTaskToPool(data, date, taskId, toBlockId, toIndex)` | 新 |
| 象限块 → 池顶层 | `moveBlockToPool(data, date, blockId, toIndex)` | 新 |
| 池任务 → 池（换序 / 跨容器） | `movePoolItemTo(data, poolItemId, toBlockId, toIndex)` | 新（`movePoolItem` 变成它的一层包装） |
| 池任务 → 象限（顶层 / 象限块） | `restoreFromPool(data, date, quadrant, poolItemId, toIndex, toBlockId)` | 既有的，加第 6 个参数 |

**摘出这一步只写一份**：`removePoolItem` / `movePoolItemTo` / `restoreFromPool` 三处都要做「从池顶层 / 从宿主块里摘出来，摘完重算宿主块完成度」，收口成 `detachPoolItem(data, found)`（**R-41 的教训**：同一条逻辑写两遍，新字段必然漏在其中一处）。`test-cross-drag.js` 用一条源码守卫钉住「三处都调它」。

**两种「进池」的语义对齐「推迟」**：`moveTaskToPool` / `moveBlockToPool` 把完成时间默认设成**所属日期 + 1 天**；块内每条任务各设一份、**块本体不设**（D-51 不变）；拖完某一天空了就收掉（和 `postponeTask` / `postponeBlock` 同一条）。

#### 为什么数据层能做真测试

这一半全是纯函数，`test-cross-drag.js` 直接跑真数据（23 项）：七种落点各一条、块不许进块、越界夹紧、`NOT_FOUND` 不改数据、非法日期、宿主块完成度重算、拖空一天收掉日期。drag.js / app.js 那一半没有 DOM 跑不了，用源码守卫锁「入口在不在、有没有被绕过」。

### 2.44 手机端排版（需求 4，纯 CSS）

#### 折行的机关在 `flex-basis`，不在 `flex-wrap`

行容器是 `[勾选框, 文字(flex:1), 一串按钮]`。只加 `flex-wrap: wrap` **折不出一行来** —— `flex: 1` 是 `flex: 1 1 0%`，文字格的「假设宽度」是 **0**，行容器永远算不出「放不下」，按钮也就永远不会被挤到下一行。

所以真正起作用的是把文字格改成 **`flex: 1 1 auto`**（basis = **文字的实际宽度**）：

- 文字短 → 勾选框 + 文字 + 按钮一行放得下 → **照旧一行**，不会平白多一条空白；
- 文字长 → 整段宽度塞不下 → 文字占满第一行（`flex-grow: 1`）并自动换行，**整串按钮折到第二行**。

这正好对上需求的两句话：「一行放不下时按钮移到下一行」+「文字占满整行宽度并自动换行」。

#### 改在哪儿

```css
@media (max-width: 600px) {
  .task__row, .stage, .block__head, .pool__block-head { flex-wrap: wrap; }
  .task__text, .stage__text, .pool__text, .block__name, .pool__block-name {
    flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere;
  }
}
```

- 四类行容器：任务行、阶段行（`.stage` 自己就是行）、象限块头、池内块头。
- 五个文字格。**时间视图条目和计划池条目复用的就是 `.task__row` / `.stage`**，所以不用各写一套（`render.js` 里池行和时间视图条目都是 `'<div class="task__row">'`）。
- `min-width: 0` + `overflow-wrap: anywhere` 保留，长单词不撑破卡片。

#### 折下来的按钮**不拉伸**

v2.1 的 FS 写过「操作按钮折到第二行**均分宽度**」。本版改掉这个口径：一排「＋」「×」「🎁」被拉成等宽的粗块既难看又难认，而且会误导点击目标。按钮按各自原宽排布，左对齐。FS「十二、PWA 与移动端」那条已同步改口（见 FS v2.10 需求 4）。

#### 桌面端零影响

全部写在 `max-width: 600px` 里。`test-mobile-layout.js` 有一条**反向**守卫：桌面端段的 `.task__row` 不许有 `flex-wrap`、`.task__text` 不许有 `flex: 1 1 auto`。

#### 回归守卫（`test/test-mobile-layout.js`，5 项）

先把样式表按 `@media (max-width: 600px)` 切成「移动端 / 桌面端」两侧（文件里有好几段这样的媒体查询，**全都要归到移动端**，只取第一段会漏），然后在移动端侧找「规则体含 `flex-wrap: wrap`」和「含 `flex: 1 1 auto`」的那两条规则，核对选择器名单齐全；`min-width: 0` / `overflow-wrap: anywhere` 在不在；再反向断言桌面端没有这两条。

---

### 2.45 v2.10 测试策略汇总

四条需求里只有第 3 条的数据层能真跑，其余三条是 DOM 行为 / CSS 布局 —— node 里没有渲染引擎，所以这版的主力还是**源码守卫 + CSS 守卫**，外加两条**自动**守卫（扫清单，而不是人眼核清单）。

| 新增 / 改动 | 项数 | 覆盖什么 |
|---|---|---|
| `test/test-scroll-keep.js`（新增） | 9 | 需求 1：登记表与 `overflow-y: auto` 的**自动**交叉核对、分键属性来源、Node 安全、`renderCurrent` 采 / 贴顺序与 `setViewMode` 的先后、五处勾选传 `keepScroll`、四个「内容变了」的操作不传 |
| `test/test-cross-drag.js`（新增） | 23 | 需求 3：七种落点各一条真数据（象限→池顶层 / 池块、象限块→池、池↔象限顶层 / 象限块、池顶层↔池块）、块不许进块、越界夹紧、`NOT_FOUND` 不改数据、非法日期、宿主块完成度重算、拖空一天收掉；`detachPoolItem` 三处共用；drag.js / app.js 五条接线守卫 |
| `test/test-mobile-layout.js`（新增） | 5 | 需求 4：移动端段里两条规则的选择器名单、`min-width: 0` / `overflow-wrap: anywhere`、时间视图与池复用 `.task__row`、**桌面端反向**不许有折行 |
| `test/test-drag-handle.js`（改） | — | 需求 2：五种勾选框共用一条 `touch-action: none`；池条目本体与池块头**不再**有 `touch-action` |
| `test/test-pool-align.js`（改） | — | 需求 2：`isCheckHandle` 里**必须**有 `pool__check` / `pool__block-check`（v2.7 那条反向断言改过来，注释写明是被需求反转的） |
| `test/test-pool-order.js`（改） | — | 需求 3：`poolContainerOf` / `poolReorder` 那组断言换成 `poolDropTarget` + `region: 'pool'` |

全量：**1073 项，全部通过**（v2.9 末 1036 项，本版净增 37 项）。`node --check` 对 `drag.js` / `render.js` / `app.js` / `task-ops.js` 四个改动文件逐个通过。

**这套守不住的**：真机上「按住勾选框拖 vs 轻点勾选」「拖过池上方时落点是否太灵敏」「折行后的按钮排布好不好按」—— 都列进 5.3 的真机验收清单，node 侧只锁得住形状。

---

## 网页版与 APK 差异点（v2.10）

网页版与 APK 共用同一个页面、同一套 CSS 与 JS（APK 是 Capacitor 套的 `www/`），所以差异全部来自**输入方式**，不来自代码分叉：

| 点 | 网页版 | APK |
|---|---|---|
| 需求 1 勾选后不弹回顶部 | 同样生效 —— 和输入方式无关 | 同样生效。**触摸滚动本身**也会被 `innerHTML` 重画重置，但因为只在勾选时贴回快照，正常滚动浏览不受影响 |
| 需求 2 拖动把手 | 鼠标**整行都能拖**，按勾选框只勾选（老行为不动，D-73） | 触摸 / 笔**只有勾选位置能起拖**，其余区域交给列表滚动。这是四条里唯一「两端行为不同」的一点 |
| 需求 2 的副作用 | 无变化 | 池列表恢复触摸滚动（R-33 解除）—— 网页版本来就能用滚轮，看不出区别 |
| 需求 3 双向拖拽 | 需按住并移动（鼠标拖） | 触摸拖：从**勾选框**起手（需求 2 的把手口径），拖到池、拖回象限都对得上 |
| 需求 4 手机端排版 | 宽屏不触发 `max-width: 600px`，无变化 | `flex-wrap: wrap` + `flex: 1 1 auto` 生效：文字长了按钮折行（D-75） |
| 数据格式 | 完全一致，`schemaVersion` 仍为 1，无新增字段 | 同左。v2.1–v2.9 导出的 JSON 都能导入，v2.10 导出的老版本也读得下 |

三条纯交互 / 版面的需求（1、3、4）在两端**逻辑一致**，唯一的行为分叉是需求 2 的「触摸端起拖要点勾选框」—— 这是 v2.1 需求 7（D-48）就定下的口径，v2.10 把它从象限扩到计划池。

---

## 十二、v2.11 的两条需求怎么实现

### 2.46 手机端折行的两处收尾（需求 1、2）

#### 现状对照（改之前）

v2.10 需求 4 给四类行容器加了 `flex-wrap: wrap`、给五个文字格加了 `flex: 1 1 auto`。DS 2.44 当时写的是「文字占满第一行并自动换行，整串按钮折到第二行」，但那只在**文字格还留在第一行**的前提下成立。真实的 flex 折行算法不是这么算的：

> 每个 flex 子项先算自己的**外部假设主尺寸**（outer hypothetical main size）= `flex-basis` 定出的基准尺寸、再被 `min-` / `max-width` 夹紧。**按这个尺寸**决定它上哪一行 —— 装得下就在当前行，装不下就整个挪到下一行。

`flex-basis: auto` 的文字格，基准尺寸是 **max-content（整段文字一行的宽度）**，长文算出来比一行还宽，于是：

```
勾选框 |（空）
长文长文长文长文长文长文……      ← 文字整段掉到第二行
[🎁] [＋] [推迟] [×]            ← 按钮各自折行、且靠左
```

第一行只剩一个勾选框 + 一大片空白（需求 1 要治的），按钮还可能被拆成「一半在第一行、一半在第二行」（需求 2 要治的）—— 因为 v2.10 是**每个控件各自**参与折行的。

#### 需求 1：给文字格夹一个上限

`max-width: calc(100% - 32px)` 把「假设主尺寸」从 max-content 夹到「一行减去勾选框和间距」：

- **长文**：假设尺寸 ≈ 一行宽 → **放得进第一行**，于是它留在第一行、在勾选框右边占满剩余宽度、自己换行。第一行不再是「勾选框 + 空白」。
- **短文**：max-content 本来就小，夹不夹都一样 → 行为不变（照旧可能一行放得下）。

**32px 这个数不是随手写的**，两头都有约束：

| 方向 | 约束 | 依据 |
|---|---|---|
| 不能太大 | 文字自己得放得进第一行 | 勾选框浏览器默认 13px + 行容器 `gap`（任务行 8px、其余 6px）≈ 19~21px，减 32px 留 11px 余量，勾选框得宽到 24px 才会破功 |
| 不能太小 | 折下来的第一个控件不能被塞进第一行 | 减太多余量就够宽，最窄的控件（完成度「0/1」约 20px）会被塞进第一行，把「整组折行」拆成两半 |

`test-mobile-layout.js` 的守卫把这两头都钉住：上限必须写成 `calc(100% - Npx)`，且 `24 < N < 50`。

#### 需求 2：右侧控件包成一个组

「整组折行」这件事**单个控件做不到** —— 折行是按子项算的，散着的按钮必然按各自宽度逐个上/下行。所以在渲染层把文字右边那一串控件包进一个盒子：

```html
<div class="task__row">
  <input class="task__check">
  <span class="task__text">…</span>
  <span class="task__actions">      ← 新增：整组
    完成度 / 三角 / 时段 / 🎁 / ＋ / 推迟 / ×
  </span>
</div>
```

包成**一个** flex 子项之后，它的假设尺寸 = 组内控件的总宽：装得下就在第一行，装不下**整组**一起折 —— 不会再被拆成两半（D-76）。

**靠右对齐**用 `margin-left: auto` 而不是 `justify-content: flex-end`：

- auto 边距吃掉的只是**它所在那一行**的剩余空间：在第一行时把整组顶到最右（文字被 `flex-grow` 撑满，视觉与宽屏一致）；折到第二行时把这一行也顶到最右，**左侧自然留空** —— 正好是需求 2 的第二句。
- `justify-content: flex-end` 是对**每一行**生效的：万一第一行真剩下一两个像素的余量，勾选框会被推离左边缘，得不偿失。

**桌面端零影响**用 `display: contents`：这层盒子在宽屏上**不生成**，它的孩子直接参与父级 flex，间距与对齐与加它之前逐像素等价。只在 `max-width: 600px` 里换成 `display: flex`。若在宽屏上也真生成盒子，父级的 `gap` 就被拆成「父级 gap + 组内 gap」两段，各行容器的 gap 还不一样（任务行 8px、其余 6px），宽屏疏密必然变。

#### 改在哪儿

| 文件 | 改动 |
|---|---|
| `js/render.js` | 七处拼行的地方把文字右边的控件包进 `<span class="task__actions">`：任务行、阶段行、象限块头、池内块头、时间视图**任务**条目、时间视图**阶段**条目、计划池条目。编辑态（整条换成输入框）本来就没有按键，不动 |
| `css/style.css` | 桌面端 `.task__actions { display: contents; }`；手机端：文字格加 `max-width: calc(100% - 32px)`，`.task__actions` 加 `display: flex` + `flex-wrap: wrap` + `margin-left: auto`，组内间距按所在行容器给（`.task__row > .task__actions` 用 8px、其余 6px） |

**覆盖范围**与 v2.10 需求 4 完全一致（那七类行）。**模板池条目**和**阅读栏条目**不在内：它们不是「任务」，v2.10 也没管它们，这版不顺手扩大范围。

### 2.47 v2.11 测试策略汇总

两条都是**浏览器算宽度**的排版规则，Node 里既没有排版引擎、也没有宽度。所以这版的主力仍是**源码守卫 + CSS 守卫**，外加一组**基于真实渲染输出**的结构守卫（比扫源码更硬：直接断言 `render.js` 拼出来的 HTML 里有没有那个组、span 配不配平）。

| 新增 / 改动 | 项数 | 覆盖什么 |
|---|---|---|
| `test/test-mobile-layout.js`（改） | 5 → 12 | 需求 1：`max-width: calc(100% - 32px)` 在五个文字格那条规则里、且数值落在 `24 < N < 50`。需求 2：**渲染七类行各一条真实 HTML**，断言都含 `<span class="task__actions">`、span 配平、删除键在组**内**；CSS 侧 `.task__actions` 是 `flex` + `margin-left: auto` + 自身可折行、组内间距按行容器分（8px / 6px）。反向：桌面端 `.task__actions` 必须是 `display: contents`、不许是 `flex`，`.task__text` 不许有 `max-width` |

其余测试文件**一个都没动** —— 这版没碰数据层，`Store.serialize` 输出与 v2.10 逐字节同构（`test-store-serialize.js` 原有断言原样通过）。

全量：**1080 项，全部通过**（v2.10 末 1073 项，本版净增 7 项）。新增的两组守卫都做过**变异测试**：拿掉 `max-width` 一行 → 前两条红；拿掉阶段行那个开标签（留一个孤儿 `</span>`）→ 后两条红。

## 网页版与 APK 差异点（v2.11）

两条都是手机端排版规则，实现是「CSS + 渲染层一个包裹盒子」，**网页版和 APK 跑同一份代码，逐条没有差异**：

| 点 | 网页版 | APK（安卓 WebView） |
|---|---|---|
| 文字换行占用第一行 | 宽度 > 600px 不触发（宽屏放得下） | 屏幕 ≤ 600px 生效 |
| 按键整组折行、靠右对齐 | 同左，宽屏不折行 | 同左，窄屏才折 |
| 覆盖的行 | 任务行 / 阶段行 / 两个块头 / 时间视图条目 / 计划池条目 | 同左（模板池、阅读栏不在内） |
| 数据格式 | **没有**新增任何字段 | 同左，与 v2.1–v2.10 的 JSON 双向兼容 |
| 同步到 APK | — | `npm run sync:web` → `npm run android:sync` |

## 五、决策与风险（v2.1 追加）

### 5.1 已定下来的决定

| 编号 | 决定 | 为什么这么定 |
|---|---|---|
| D-42 | Bonus = 任务 / 阶段身上可选 `bonus:true`；**完成率**分母计非 Bonus、分子计全部（含 Bonus），可 >100%；全 Bonus 按「已完成 / 全部 Bonus」退化。**「全完成」口径 v2.5 改到 D-56** | 需求原话是「分母不计 Bonus、分子记上、允许超过 100%」。字段用可选布尔（缺省即普通）和 v1 的 `stages`/`slot` 同一条取舍，老备份零影响。全 Bonus 时 `total=0`，若不退化完成率会除零或无意义，故按已完成 Bonus / 全部 Bonus 算；「一个普通项都没有」视为未完成，避免空集被误判成 100%。**v2.5 修订**：原表里 `isComplete` 那一列（「非 Bonus 全完成即完成」）作废，见 D-56 |
| D-43 | 「全完成」口径在 `task-ops.getProgress`（＋`progressOfItem`）实现，`store.js` 里 `blockDone`/`allDone` 留一份镜像 | `getProgress` 是全项目唯一进度算法（v1 DS 1.3 规矩二的延伸）；`store.js` 是纯数据层、不能反向依赖 `task-ops`（加载顺序 store 在前），所以 `normalize` 里推导 `completed` 需要的那份口径在 store 内镜像一份，两处靠同一套测试锁住不漂移。**v2.5 修订**：镜像函数 `allRequiredDone` 改名 `allDone`（新口径下它跟 Bonus 无关，旧名字会误导），`importer.copyTask` 也改为直接调它，不再自写一套 |
| D-44 | 日报统计落实为「Markdown / PDF 每个日期标题后加一行统计」，走 `getStats` | 本应用没有独立日报页，成文产出就是导出。统计必须消费 `getStats` 而不是各导出函数自己算，才不会和首页对不上（FS「三处一个算法」） |
| D-45 | 时间视图顺序记忆 = 每天可选 `tv: { 时段: 键列表 }`，键只记 id 组合、内容永远现查 `slot`；`schemaVersion` 保持 1；导入忽略 `tv` | 顺序只属于「视图的排法」，内容（谁在哪个时段）仍由 `slot` 字段唯一决定，避免两处状态对不上。键只记 id 组合、不存文本，是因为文本 / 时段都可能被改，id 才稳定。导入时 id 全重生成，旧键无法对应，忽略最干净。保持 1 是因为纯追加、老数据无需转换（v1 DS D-24 的「只在需要转换时升版本」） |
| D-46 | **完成沉底 = 改数据**（把条目移到列表末尾），不是渲染时排序 | `drag.js` 的 `computeDropIndex` / `moveTask` / `moveItem` 依赖「数据顺序 = 渲染顺序」；渲染时排序会让两者脱钩，拖拽落点算错。沉底直接在数据里搬移，顺序天然一致 |
| D-47 | 阶段不自动沉底，块本体不沉底，取消勾选不自动移回 | 需求原话只点名「任务 / 任务块里的任务」；阶段顺序留给用户手动。取消勾选不移回是「只朝完成方向动、不打扰手动排好的顺序」 |
| D-48 | 移动端拖动把手 = **勾选框**，`touch-action:none` 只留在勾选框上，任务行其余区域恢复触摸滚动 | 需求建议「拖动位置和勾选位置合并」。`touch-action` 在手势开始就定死，把手留在勾选框上，按住勾选框拖不滚页、点按不移动仍勾选；任务行其余区域滚得动，解决 v1 DS 5.3 里「触摸拖拽和页面滚动打架」那个悬而未决的问题 |
| D-49 | 安卓端导出走原生插件 `ExportFile`，把文件写进系统「下载」文件夹：Android 10+（API 29+）用 MediaStore Downloads（免权限），更老系统退回公共 Download 目录（声明 `WRITE_EXTERNAL_STORAGE`，`maxSdkVersion=28`） | WebView 不认 blob 下载，网页版 `<a download>` 在 App 里静默失效。MediaStore 是 scoped storage 下写公共下载目录的合规做法。归档流程改成「等插件写成功才删本地数据」，避免「文件没落盘、本地又删了」的数据蒸发 |
| D-50 | 象限新增任务默认加到开头（unshift），只作用于象限列表；计划池仍 push、块内任务仍 push；时间视图「新增排最后」靠 `tv` 记忆独立成立 | 需求只点名「象限」。时间视图顺序由 `tv` + 扫描顺序决定，与象限列表是两套结构，unshift 不会碰 `tv`，所以 v2.1 的「时间视图新增排最后」不回退 |
| D-51 | 计划池里放块用既有的 `block` 结构；DDL 以任务为单位（块本体不设 `plannedDate`）；手动加池任务 / 块内任务默认「查看日期 + 7 天」，象限块整体推迟默认「所属日期 + 1 天」 | pool 字段 v1.1 就有，只是放宽为「也放块」，`schemaVersion` 不升；块是容器不是可完成单元，DDL 只能挂在任务上；+7 是「一周内安排」、+1 是「今天没做完推到明天」的既有口径（v1 DS 2.11） |
| D-52 | 覆盖导入 = `merge(empty, imported)`，返回的 `result.data` 是新对象，`onFileLoaded` 必须 `state.data = result.data` 接回引用 | 判重对着空数据、永远不跳过，实现「整体替换」且复用 merge 的换 id / 复制逻辑；覆盖结果对象不是原 `state.data`，不接回引用会「数据进了但页面还是旧的」 |
| D-53 | 折叠状态存独立 key `foldState`（`expanded` + `collapsedBlocks` 两张表），不进主数据；读坏 / 存不上都回空表、不崩 | 折叠状态是**界面偏好**，和主数据（任务内容）不是一类东西，混进主数据会让导入 / 导出把 UI 状态也带过去；独立 key 存不上最多回到默认折叠，不算丢数据 |
| D-54 | 块内**无阶段**任务给「推迟」按钮；块内**有阶段**任务不给，继续靠逐个阶段推迟 | 块内任务整条推迟会把阶段一起卷走，而阶段有自己的独立推迟通道（`postponeStage`），两条路并存会语义打架。无阶段任务没有这个问题，和顶层任务同待遇即可。数据层 `postponeTask` 本来就穿透块，只需放开渲染层按钮 |
| D-56 | **「全完成」= 每个阶段 / 子任务都做完（Bonus 也不例外）**，与完成率口径分开：Bonus 只影响完成率的分母（`done`/`total`），不影响 `isComplete`。`store.allDone`（原 `allRequiredDone` 改名）/ `blockDone` / `progressOfItem` / `importer.copyTask` 全部对齐 | **用户 2026/10/5 明确决定**，针对的问题：口径原来在四处各写一遍，`importer.copyTask` 还留着「所有阶段都完成」的旧写法，导致导入进来的 `completed` 和界面上的勾选状态对不上。收口成一条：谁要判断「全完成」都走同一个口径，Bonus 不享受豁免 |
| D-57 | **时间视图新增任务排该时段最前**（原「排最后」作废）：`orderByKeys` 把不在 `tv` 里的键 rank 记为 -1；不往 `tv` 补写新键，等用户真拖过时由 `moveTimeViewItem` 重建入册 | **用户 2026/10/5 明确决定**：和象限视图「新增任务加在开头」（D-50）统一成一条规矩。实现上只改排序的 fallback，不动 `tv` 的数据含义、不动 `schemaVersion`；旧数据里已有的 `tv` 顺序继续生效，只是「没记忆的」从末尾挪到最前 |
| D-50（修订） | 象限新增任务默认加到开头（unshift），只作用于象限列表；计划池仍 push、块内任务仍 push。**原「时间视图新增排最后」作废**，见 D-57 | 原决定建立在「四象限扫描顺序 = 时间视图默认顺序」上；v2.5 改成两个视图统一「新的在最前」，所以象限 unshift 与时间视图 fallback 现在指向同一个方向，不再是相反的约定 |
| D-58 | 池内拖拽**只在各自列表内排序**：顶层 ↔ 顶层、同一块内 ↔ 同一块内；不支持跨容器（不把顶层任务拖进块、不把块内任务拖回顶层）。`movePoolItem` 照 `moveTask` 的 toIndex 语义（摘出来之后的下标，越界夹紧） | **用户 2026/10/6 明确选择**。跨容器会引入一组新语义（拖进块要不要重算宿主块、块里能不能混排、空块怎么显示），而需求只要求「改变顺序」。落在别的池列表时保持上一次落点、不改数据，比「猜用户想放哪」更不会出错。**v2.10 修订（需求 3）：禁令的另一半作废** —— 那时候挡住的正是「进池块 / 出池块」这两类跨容器搬运，而 v2.10 需求 3 的原话是「象限中所有可能的拖动情况，在计划池中都需要相应支持」，正好点到这两类，所以跨容器**放开**（见 D-74 / 2.43）。**保留下来的是 toIndex 口径那一段**：「摘出来之后的下标、越界夹紧」一条不改，`movePoolItem` 继续是这个语义（现在它是 `movePoolItemTo` 的一层包装） |
| D-59 | 池条目的「导入」= **移动到当前查看日期的 Q-II 开头**（复用 `restoreFromPool(..., 'II', id, 0)`）；目标象限固定 Q-II（`CONFIG.IMPORT_QUADRANT`）；toast 里写明导入到了哪一天 | **用户 2026/10/6 决定**：手动导入与拖回象限、自动导入统一成**移动**语义（v2.0 文档原写的「立刻导入 = 复制」作废），避免池里留下同名副本。落点是开头，与 D-50「象限新增加在开头」一致。目标日期用**正在看的那天**而不是真实今天：池面板在任何日期都显示，导到看不见的另一天会像「东西没了」；正看今天时两者相同 |
| D-60 | 自动导入只对**真实今天**生效（启动 / 切日期时检查一次）；只处理**池顶层**条目；任务块的到期日 = 块内任务里**最早**的有效 `plannedDate`（块本体仍不存 `plannedDate`，D-51 不变），整块一起回来 | **用户 2026/10/6 决定「只认真实今天」**：往前翻历史 / 往后翻未来都不该把任务搬走，那不是明确意图。只处理顶层、块取最早子项日期，是因为 `postponeBlock` 给块内每条任务都设了 +1 天——若块内任务各自自动导入，第二天块就被掏空、「整体推迟」失去意义（见 2.32） |
| D-61 | 池内块对齐象限块的范围 = **块头（勾选框 / 完成度 / 点块名改名）+ 块内任务勾选完成**；**不**把阶段、时段、Bonus 搬进池（池内块内任务仍不画阶段列表，只有池独有的 DDL）。块头的动作按钮池内是「导入」而不是「推迟」 | **用户 2026/10/6 选择「块头对齐 + 块内可勾选」**。阶段 / 时段是「这一天里怎么安排」的东西，池里的任务还没被安排到任何一天；真要拆阶段，导入象限后再拆（推迟进池的任务其阶段原样保留在数据里，导入时一起回来）。「推迟」以池为目的，池里再放一个推辞按钮没有意义，对应关系是池内「导入」↔ 象限「推迟」（见 2.34 的现状对照表） |
| D-62 | 池内新加的勾选框**只做勾选，不当拖拽把手**：`isInteractive` 收下它们（按它不触发拖拽），但 `isCheckHandle` 不收，`.pool__item` 的 `touch-action: none` 保持原样，触摸端池内条目仍**整条可拖** | 象限里「勾选框 = 把手、行本体可滚动」是 v2.1 需求 7 明确点名要的（D-48）；池里没有这条需求，而池内整条拖拽是**既有通路**（拖回象限，DS 2.11）。把池的把手收窄到勾选框，等于顺手改掉一个用户没要求改的既有手势，还把「池列表在手机上不能触摸滚动」这条已知限制换了个理由而不是解决它。本版按最小改动走，把限制如实记在 R-33。**v2.10 修订（需求 2）：本条被反转** —— 需求原话点名「象限模式和**计划池**中所有任务 / 阶段的拖拽都要以完成勾选位置处为把手」，池也要一样。`isCheckHandle` 收下 `pool__check` / `pool__block-check`，`touch-action: none` 从 `.pool__item` / `.pool__block-head` 搬到两个勾选框上，`isInteractive` 对「触摸 + 勾选框」开一个例外（鼠标按勾选框仍是「只勾选、不拖」，不动老行为）。R-33 顺带解除 |
| D-63 | 池内块改名**复用既有的** `editPoolItem`（它本来就作用在 `locatePoolItem` 上），不新增 `editPoolBlock`；只有「勾块」需要新函数（`togglePoolBlock`），因为象限的 `toggleBlock` 认的是「某天某象限」的块 | 池内块和池内任务文字的写入是同一件事，多一个函数就多一份「改空拒绝 + 原文保留」的实现要维护（D-31 那条规矩只该有一处）。而勾选不是同一件事：`toggleBlock` 的定位参数是 `(dateStr, quadrantId)`，池内块没有日期，硬套会把池的 id 塞进日期位，正是 v2.5 修过的那类错 |
| D-64 | 阅读栏「提示不超过 3 项」实现成**软提示**：头部显示 `n/3`，超了标红并给一句 title，**不拦截**第 4 条及以后的添加；上限值取自 `CONFIG.READING_ACTIVE_HINT` | 需求原话是「提示不超过3项」——「提示」二字说明用户要的是**提醒**，不是硬闸。做成硬拦截会带来一串需求没提的问题：满了之后「＋」要不要禁用、禁用后用户想换一本书得先删哪条、拖到第 4 本时该报什么错。软提示保留了用户对自己清单的控制权，也保留了「偶尔同时读 4 本」这种真实情况。**注意这条是文档默认，用户没有明确确认过**（见 5.3） |
| D-65 | 已完成条目给一个「取消完成」（`reading__restore`，行首 ↩），把条目搬回正在阅读并清掉 `doneAt`；同时正在阅读的勾选框**取消勾选**也走同一条路 | 需求只写了「点击完成」这一个方向。但「点错了没有退路」是硬伤 —— 勾错了只能删掉重加，还得重新输一遍书名和起始日期。同一个勾选框的取消动作给一条回退路径是最小、最自然的设计（和普通任务取消勾选不算「完成」是同一种直觉）。这条是**文档默认，用户没有明确确认过**（见 5.3） |
| D-66 | 「已读完成的展示上限」实现成**列表最大高度 + 内部滚动**（`.reading__done-list { max-height: 40vh; overflow-y: auto }`），**不截断条数、不折叠上限外的条目** | 需求原话是「设置一个展示上限……支持滚动条拖动」。这里「上限」直接指向**视觉高度**：列表最多占 40vh，超了就在列表里滚。做成「只显示最近 N 条 + 其余藏起来」会丢数据可见性（用户找不到第 11 本读完的书），而需求紧接着那句「要支持滚动条拖动」正说明用户想要的是**滚动**而不是**截断**。`reading__list`（正在阅读那段）同样处理，理由一致。这条是**文档默认，用户没有明确确认过**（见 5.3） |
| D-67 | 阅读栏的 `start` / `doneAt` 从 `'HH:MM'` 改成 **`'YYYY-MM-DD'`**，**字段名不动**；不传时的默认从 `Util.nowTimeStr()` 改成 `Util.todayStr()`；错误码从 `BAD_TIME` 并到 `BAD_DATE` | **用户 2026/10/6 明确决定**：「阅读板块的时间指的是日期」。读书这件事是按天记的（哪天开始、哪天读完），记到分钟既没人填也不好看。**字段名不动是为了兼容**：改名（比如 `startDate`）会让老 JSON 里的 `start` 变成导入器不认识的字段而被丢掉，那就破了「兼容前面版本导出的 JSON」这条硬约束。改的只是值的形状，所以 `schemaVersion` 仍是 1 |
| D-68 | 已读完成那行，**起始日期和完成日期相同（或起始没设）时只画一个日期**，不同才画「起始 → 完成」 | 日期比时分长一倍，两个一样的日期并排画成「2026-10-06 → 2026-10-06」占地方又没信息量。当天开始当天读完是常态，这时真正有用的只有「哪天读完的」。保留箭头只在**跨天**时出现，那时它才真的在说「读了三天」 |
| D-69 | 阅读栏的日期框**沿用计划池那一套提交方式**（回车 / 失焦提交、Esc 取消），**不额外加 `change` 自动提交** | 两个 `<input type="date">` 是同一个控件，行为不该做成两样。加 `change` 自动提交看着更顺手，但会引入一个只在阅读栏存在的提交时机，以后调计划池的日期框就会分岔；而且失焦已经覆盖了「选完点到别处」这条主路径（真机手感仍待验收，见 5.3） |
| D-70 | 阅读栏的日期设定**整条链路**都对齐计划池：显示按钮（`reading__start` 的声明与 `pool__date` 逐条一致、`--empty` 用斜体 `.45`）、唤起方式（`focusEditor(false)`）、清除按钮（文案「清除」、样式与 `pool__date-clear` 一致、点了之后先收编辑态）、**提交时读框的方式**（一次列出所有编辑框的选择器）。**并且已完成那行也画这个按钮** | **用户 2026/10/6 明确决定**：「阅读栏的日期设定功能仍然有问题。改成和计划池的日期设定类似的格式」。用户把计划池那套当成正确样板，那就不是「长得像」而是**行为逐条对齐**：同一个控件（`<input type="date">`）、同一套提交、同一个清除按钮，以后调一处另一处不会分岔。已完成那行必须也有按钮，是因为需求原文「下方可以自己修改起息时间」在改之前**物理上做不到**（那一行画的是死文本）；这一条不是格式对齐，是补齐一个漏掉的功能入口 |

| D-71 | 双击高亮**不推迟单击**：第一下照常走原有分流（进编辑 / 勾选 / 按钮），只在第二下（`e.detail >= 2`）用**第一下记下的落点**切高亮，并把这第二下**吞掉**（不再走分流、也不替用户按第二次按钮）。落点记录带时间戳，超过 `DOUBLE_CLICK_MAX_MS = 1500` 视为陈旧、直接丢弃 | 另一条路是「把单击推迟一个双击窗口再执行」（`setTimeout` 250~500ms 后再决定是单击还是双击）—— 那会让**最高频**的「点一下改文字 / 勾完成」整体变迟钝，为了一个**低频**标记手势牺牲高频手势，不划算；而且延迟执行还会让「点完立刻拖拽 / 立刻点下一个」这类快速操作打架。取第一下的落点是因为第一下已经把这一条开成编辑框、原节点被换掉，第二下问 DOM 问不到东西（见 2.40）。**「吞掉第二下」是有代价的**：连点两下 × / 推迟只会触发一次。这是刻意的 —— 让连击的第二下保持「什么都不做」比「猜用户想连按两次」更可预测。**1500ms 不是双击窗口**（系统阈值 ≤1s），它只是「陈旧记录的上限」，用来挡住拖拽结束被 `suppressNextClick` 吃掉的那一下（见 R-42） |
| D-71（补充） | 落点在**控件**上（输入框 / 文本域 / 下拉 / 按钮及其祖先）时**不记落点**，双击也不高亮 | 三条各有硬理由：输入框里双击 = **选词**（系统手势，抢了就没法选词）；勾选框连点 = 勾上又取消（浏览器规矩，别顺带标黄）；按钮连点 = 想连按两次（推迟两条），别抢。见 `isControlNode` |
| D-72 | 勾选后**保留滚动位置**做成 `renderCurrent` 的**可选开关** `{ keepScroll: true }`，并且只给「原地改一个字段」的动作开：五个勾选分支（任务 / 阶段 / 象限块头 / 池任务 / 池块头）。渲染层只提供 `Render.captureScroll()` / `Render.restoreScroll(snap)` 两个纯动作 | 渲染是整块 `innerHTML` 替换（DS 2.1），容器每次都是新造的，`scrollTop` 天然归零 —— 要改就得推翻「数据顺序 = 渲染顺序」这条整套落点算法依赖的假设（D-46 / `computeDropIndex`），代价远大于问题本身。所以绕开：重画前拍快照、重画完贴回去。**键必须由结构和内容决定**（`q:<data-quadrant>`、`tv:<data-slot>`、池 / 模板 / 阅读栏用固定键），不能用元素身份。**默认不开**：新增（加在开头，D-50）、删除、推迟、导入、切日期、切视图这些「内容真变了」的动作，粘住旧位置反而像没生效 |
| D-73 | 手机端（触摸 / 笔）的拖动把手**只有勾选框**，两个区域统一：`isCheckHandle` 收下 `pool__check` / `pool__block-check`；`touch-action: none` 从池条目本体与块头搬到这两个勾选框；`isInteractive` 里对「触摸 / 笔 + 勾选框」开例外（鼠标按勾选框照旧只勾选、不拖） | v2.10 需求 2 直接点名池，**反转 D-62**。`touch-action` 在**手势开始那一刻就定死**，所以它必须挂在真正的起手位置 —— 挂在池条目本体上，手机端整个池列表都滚不动（R-33）。给鼠标留原样，是因为鼠标整行都能拖、把手不必收窄，改这条老行为没人要求 |
| D-74 | 拖拽落点统一成一个形状 **`{ region: 'quadrant' \| 'pool', quadrantId, blockId, toSlot, index }`**：`region` 说落在哪个区域，`blockId` = 落点**所属的块**（象限块 / 池内块的 id，顶层为 `null`，两套 id 空间靠 `region` 区分），`toSlot` 只有时间视图用。v2.6 的 `poolReorder` 标记取消，`sameTarget` 就比这五项。**池内跨容器放开**（D-58 的禁令作废）：顶层 ↔ 块内两个方向都通 | v2.6 那条布尔标记是给「池内换顺序」这一个特例挂的；再要加上「区域」这一维，标记法就开始漏项（`sameTarget` 少比一项就是「落点没变」判错，拖不动）。统一成结构体之后，象限能做的四类落点（换位 / 跨象限 / 进块 / 出块）在池里一对一都有对应，需求 3 的「相互之间都要支持」就是这张对照表。**块不许进块**在 `updateTarget` 里挡（象限块和池内块两种都要挡），数据层兜底也拒（规矩 1 两边一致） |
| D-75 | 手机端排版的折行机关是文字格的 **`flex: 1 1 auto`**，不是行容器的 `flex-wrap: wrap`（后者只写在 `max-width: 600px` 里，和前者同一条媒体查询）；折下来的按钮**按各自原宽排布、不拉伸** | `flex: 1` 等于 `flex: 1 1 0%`，文字格的「假设宽度」是 **0**，行容器永远算不出「放不下」，`flex-wrap` 再写也折不出一行来。改成 basis = 文字实际宽度之后，**文字短的行照旧一行**（不凭空多一条空白），只有真挤不下时才把整串按钮折到第二行 —— 这正好是需求 4 的两句话。按钮不拉伸：把「＋」「×」「🎁」拉成等宽粗块既难看又难认，还会误导点击目标（v2.1 的 FS 曾写过「均分宽度」，本版改口） |
| D-76 | 手机端「右侧按键整组折行 + 靠右对齐」靠**渲染层多包一层 `<span class="task__actions">`**（七处拼行）实现：组内 `display: flex` + `flex-wrap: wrap`，折行对齐用 **`margin-left: auto`** 而不是 `justify-content: flex-end`；桌面端这层盒子 `display: contents`（不生成） | 「整组折行」**单个控件做不到** —— flex 折行按子项算，散着的按钮必然按各自宽度逐个上下行，要拆成两半（这正是 v2.10 没做成的部分）。包成**一个**子项后，它的假设尺寸 = 组内控件总宽，装不下就整组一起走。**用 auto 边距不用 `justify-content`**：auto 边距吃掉的只是它所在那一行的剩余空间，第一行顶最右、第二行也顶最右（左侧自然留空 —— 需求 2 第二句），而 `justify-content: flex-end` 对**每一行**生效，第一行只要剩一两个像素余量就会把勾选框推离左边缘。**桌面端必须透明**：真生成盒子会把父级 `gap` 拆成「父级 gap + 组内 gap」两段，而各行容器 gap 还不一样（任务行 8px、其余 6px），宽屏疏密必变 |
| D-77 | 手机端五个文字格加 **`max-width: calc(100% - 32px)`**，把长文**按回第一行** | flex 折行按**外部假设主尺寸**（`flex-basis` 定出、再被 min/max 夹紧）决定上哪一行。`flex-basis: auto` 的文字格基准尺寸是 **max-content**，长文算出来比一行还宽 → **整段文字**掉到第二行，第一行只剩勾选框 + 一片空白（需求 1 要治的）。夹上限后长文算出来 ≈ 一行宽，放得进第一行。**32px 两头都有约束**：下界看勾选框（默认 13px + 行 gap 6~8px ≈ 19~21px，留余量后勾选框得宽到 24px 才破功），上界看最窄的控件（完成度「0/1」约 20px —— 余量够宽它就会被塞进第一行，把整组折行拆开）。两头由 `test-mobile-layout.js` 的守卫钉住（上限必须写成 `calc(100% - Npx)` 且 `24 < N < 50`） |

### 5.2 需要注意的风险

| 编号 | 风险 | 会有什么后果 | 怎么防 |
|---|---|---|---|
| R-21 | 完成沉底与「完成时段视图键沉底」两处搬移不同步 | 时间视图顺序记忆里残留指向已不存在的旧位置键，或象限顺序和时段顺序对不上 | 沉底与 `sinkTimeKey` 在同一个函数里成对调用；`test-timeview-order.js` 专测「勾选后键沉到底、无残留」 |
| R-22 | 时间视图拖拽后 `tv` 键列表与真实条目集合漂移 | 排序出现「幽灵键」或漏排 | `getTimeView` 排序时忽略 `tv` 里不存在的键，扫描顺序补齐没列的条目；`moveTimeViewItem` 每次重建完整键列表，写回前清掉别的时段的同一键 |
| R-23 | Bonus 口径只在 `getProgress` 和 `store` 各写一份，两处漂移 | 象限数字和统计面板对不上 | `test-bonus.js` 同时断言 `getProgress` / `progressOfItem` / `getStats` / `store.blockDone` 四处对同一组数据给出同一结果 |
| R-24 | 触摸把手让任务行大部分区域「点一下没反应」 | 用户以为拖拽坏了 | 勾选框仍是可点目标（勾选）；点按不移动仍触发勾选；文档 / 验收里写清「按住勾选框拖、点按勾选」。真机再验手感 |
| R-25 | 折叠状态在推迟块 / 删除池条目后残留孤儿键（指向已删除条目） | 刷新后出现「展开 / 折叠名单里有不存在的 id」，下次碰到同 id 的新条目可能误折叠 / 误展开 | `doPostponeBlock` 推迟后清掉块及块内条目折叠记录；`doRemovePoolItem` 删块 / 删任务同步清折叠状态；`test-fold-state.js` 锁住 key 隔离，孤儿键清理由删除 / 推迟路径覆盖 |
| R-26 | `overwrite` 结果对象没接回 `state.data` | 「覆盖」后数据其实没生效（旧页面照旧），或渲染的是被丢弃的旧对象 | `onFileLoaded` 里 `state.data = result.data` 是硬性步骤，`test-import-merge.js` 断言 overwrite 返回的 `data` 是全新的空 + 导入内容、调用方接回后渲染一致 |
| R-27 | 搜索过滤误改原数据（比如把过滤后的列表写回去） | 用户搜一下，任务真的没了 | 过滤函数只返回新对象 / 块副本，绝不改传入的 `day`；`renderCurrent` 用的是 `viewDay` 局部变量，`state.data` 从头到尾不经过过滤器；`test-search.js` 专测「原块的子任务列表一个字不动」 |
| R-28 | 池内拖拽的落点算错容器（把「块内任务」的 index 用到顶层列表上） | 拖一下就跑到别的位置，甚至把任务搬进块 / 搬出块 | 按下那一刻就把 `poolContainer`（真正所属的 UL）记下来，`updateTarget` 只认 `=== poolContainer` 的落点；其余池列表一律 `return`。`test-pool-order.js` 专测「拖到别的池列表不改数据」「拖到自己的列表换顺序」。**v2.10 修订（D-74）**：这条缓解跟着 `poolContainer` 一起去掉了 —— 「只认自己那个列表」的判据和需求 3 的跨容器搬运**直接冲突**。现在的口径是「指针底下那个列表就是落点」（`poolDropTarget`），而 index 算错容器的老风险由**一条结构保证**替代：`index` 和 `blockId` 同出一处（同一个 `poolDropTarget` 的返回值），不再有「按下时记的容器」和「移动时算的 index」两个来源。`test-cross-drag.js` 的源码守卫钉住落点解析只有这一个入口 |
| R-29 | 自动导入把「整体推迟的块」拆散（块内任务各自到期） | 第二天池里只剩一个空块，块内任务一条条散进象限 | 自动导入只处理池顶层；块的到期日由块内最早的计划日期**推导**，回来时整块一起回来。`test-pool-order.js` 专测「块内任务不单独自动导入」「块整块回来」 |
| R-30 | 自动导入重复触发（启动 + 切日期各一次）导入出重复条目 | 同一条任务在象限里出现两份 | 导入是**移动**：条目导入后不在池里了，第二次跑扫不到它，天然幂等；测试里连跑两次断言只导入一次 |
| R-31 | 自动导入在保护模式下写数据 | 保护模式承诺「磁盘数据一个字节不动」被打破 | `autoImportDuePool()` 先判 `Store.isProtectionMode()` 直接返回，和其余所有写路径同一条规矩；`test-pool-order.js` 只测数据层（数据层不碰界面状态），保护模式的判断在 `app.js` 源码守卫里锁 |
| R-32 | 池内任务带着阶段、但池里不画阶段列表：勾一下勾选框，用户看不见的那些阶段被一起勾掉 | 用户以为只勾了一条没阶段的任务，实际上连带勾掉了 3 个看不见的阶段；导入象限后才发现 | 勾选走 `setUnitDone`（有阶段设全部阶段），和象限**同一条口径**，至少数据不会分岔；文档在 FS 边界情况里写明这条限制。真要做池内拆阶段，得先有「池里显示阶段」的设计（D-61 明确不在本版范围） |
| R-33 | 池内勾选框不是拖拽把手：`.pool__item` 的 `touch-action: none` 还在，手机端池列表不能用触摸滚动（按在条目上就是拖拽） | 池里条目一多，手机用户没法顺畅滚列表；看起来像「页面卡住了」 | 本版按 D-62 保留（既有行为，非本版引入）。测试 `test-drag-handle.js` 明确锁住「池条目仍整条可拖」，把这条限制留在纸面上；要改就得改拖拽手势本身（另开一条需求，改完 R-24 那套真机验收要一起做）。**v2.10 已解除（需求 2 / D-73）**：`touch-action: none` 搬到池内两个勾选框上，池条目本体和块头不再拦触摸，手机端池列表恢复触摸滚动。跟进：R-24 那套真机验收（按住勾选框拖 vs 轻点勾选、列表正常滚动）**要在池里再走一遍**，node 侧只锁得到 CSS 声明与把手名单 |
| R-34 | 多了一个勾选框，池内条目的拖拽更容易被误触成拖拽（鼠标按住勾选框挪一下就换位） | 想勾选却把顺序拖乱了 | `pool__check` / `pool__block-check` 登记进 `drag.js` 的 `isInteractive`，按它们不进入拖拽；`test-pool-align.js` 用「render 画了哪些池内控件，drag 就得认哪些」的跨文件守卫锁住，漏一个就红 |
| R-35 | 阅读栏的 `active` / `done` 两张表与 `doneAt` 漂移（条目在一张表里却带着另一张表的时间） | 渲染画错行、统计口径打架、导入合并结果自相矛盾 | 「在哪张表」是唯一判据：`normalizeReading` **强制**对齐（`active` 抹掉 `doneAt`，`done` 缺时刻补一个），`importer.validate` 同样对 `active` 强制 `doneAt = null`；`test-reading.js` 三处各断言一次（清洗 / 校验 / 数据层搬表） |
| R-36 | 板块收起状态写进本机时接受了脏 `data-panel` 值，往 localStorage 塞进无用 key | 本机存储里堆垃圾，极端情况撑爆配额导致折叠状态存不上（连带影响真的折叠记忆） | `togglePanel` 白名单校验 `CONFIG.PANEL_IDS`，不在名单里的直接 return；`test-fold-state.js` 源码守卫锁住那条判断 |
| R-37 | 阅读栏在保护模式下被写（需求承诺「磁盘数据一个字节不动」） | 保护模式失效 | 六个写控件进 `body.is-readonly` 的 `pointer-events: none` 名单（含 `.reading__text` 的点击改名），四个写函数进门判 `Store.isProtectionMode()`；`test-reading.js` 两条 CSS 守卫 + 一条源码守卫。**注意 `.panel__toggle` 是刻意排除的**：它不发写操作，保护模式下该照常能点（反向守卫见 `test-reading.js`） |
| R-38 | **`commitEdit` 的新增分支漏列一个 `add-*` 模式** | 这个新增入口**静默失效**：回车 / 失焦提交时掉进下面的「改文字」链，取 `editing.quadrantId` / `editing.blockId`（都是 `undefined`）去调 `editBlock`，报个 `BAD_DATE`，`persist()` 不执行 → 输入框消失、条目没进去，用户看到的就是「回车之后没有反应」。**v2.8 的 `add-reading` 正是踩了这个坑**（试用反馈第 1 条） | 收口成一个模式列表还不够（漏的正是列表本身），所以加一条**自动**守卫：`test-reading.js` 用 `mode: '(add(?:-[a-z-]+)?)'` 把 `app.js` 里所有新增模式扫出来，逐个要求出现在那条外层 `if` 的条件串里 —— 以后再加任何 `add-xxx` 而忘了登记，测试直接红。这条是**唯一**能在 Node 里守住这条回归的办法（没有 DOM，跑不了真实回车） |
| R-39 | 阅读栏的时间口径从时分改成日期，**把用户老文件里的 `'HH:MM'` 当脏数据抹掉**（清洗 / 导入任一处收紧都会这样） | 「每一个版本都要兼容前面版本导出的 JSON」这条硬约束被打破，而且是**静默**的：文件导得进来、不报错，但用户记的时间没了 | 读路径和写路径**分开**：写路径严格（`isValidDateStr`，新数据一律是日期），读路径宽松（`Util.isValidReadingStamp` = 日期 **或** 老 `'HH:MM'`，原样保留）。用它的只有 `Store.normalizeReadingItem` 和 `importer.readOptionalStamp` 两处，都是读。`test-reading.js` 三条钉死：清洗收老值、导入收老文件、写操作不收老值 |

| R-40 | **`commitEdit` 按 `mode` 逐个挑输入框，新加一种编辑框时漏登记** —— 提交时读到别的框（或者读不到，拿到空串） | 日期框这条最惨：读到 `null` → `value = ''` → `setReadingStart(…, '')` 把用户**刚选好的日期清成 `null`**，行上退回「未设定」。看起来像「日期设定坏了」，而输入框、校验、数据层全都是好的 —— 排查时最容易被带到错误的地方（和 R-38 是同一个形状：**分发骨架漏登记，功能静默失效**） | 换成一次列出所有编辑框的选择器字符串（依据「屏幕上同时只有一个编辑框」：`state.editing` 是单个对象）。再加一条**自动**守卫：`test-reading.js` 扫 `render.js` 里所有编辑框输入框的 class（`<input … class="x__input"` / `-input`），要求每一个都出现在 `commitEdit` 和 `focusEditor` 的选择器里 —— 以后再加第三种输入框而忘了登记，测试直接红。**顺带修掉同一条链上第二处**：点「清除」时 `doSetReadingStart` 没有先 `commitEdit()`，落回渲染后编辑框原地不动（池里的 `doSetPoolDate` 是对的，对齐它） |

| R-41 | **同一个「重建块」逻辑在导入器里写了两遍**，新加的字段漏在其中一处。`importer.merge` 和模板合并分支里各自内联了一份「把来的块重建成本地块」的代码，和 `copyBlock` 形状重复；加 `highlight` 时只改了 `copyBlock`，那两处照旧把字段**静默丢掉** | 导入含高亮的块（合并导入 / 模板套用）后，块头的高亮没了 —— 文件导得进来、不报错、数据也不缺，只是这一个标记凭空消失。这正是最难被发现的一类丢数据 | **修掉的办法不是补两行，而是去掉重复**：两处内联重建都改成调 `copyBlock(incomingItem)`（行为等价：同样的 `completed` 覆盖走 `Store.blockDone`、同样的 `createdAt` 兜底、同样的 `genId`），**`importer.js` 里 `type: 'block'` 的构造点从 4 处收到 2 处** —— 只剩 `checkBlock` 的形状和 `copyBlock` 本体，其余全是调用。`test-highlight.js` 的导入组锁住三种形状往返 + 块内任务（块内任务的复制走的是另一条路，单独断言） |
| R-42 | **拖拽结束那一下被吞掉的 click，会让 `state.clickHit` 停在上一行上**：`drag.js` 的 `suppressNextClick` 在 document 捕获阶段 `stopPropagation`，拖完紧跟的那一下点击走不到点击处理器、也就**不会刷新**记录。若紧接着来一次双击，第二下就会翻到**上一次记的那一条**上 —— 标错行 | 用户拖完一行，紧接着在另一行上双击，结果高亮落在**拖过的那一行**。因为不报错、颜色也出来了，看起来像「随机标了一行」，排查方向会被带偏（和 R-38 / R-40 是同一类「静默做错事」） | 落点记录带时间戳（`rememberHit` 里的 `hit.at`），第二下超过 `DOUBLE_CLICK_MAX_MS = 1500ms` 就**直接丢弃、什么都不做**。失败模式从「标错一行」降级成「什么都没发生」—— 后者用户再双击一次就好了。`test-highlight.js` 的源码守卫锁住「判陈旧」这一步在 `handleSecondClick` 里、且在 `doToggleHighlight` 之前 |
| R-43 | **新加一个能滚的面板，忘了登记进 `Render.SCROLL_SLOTS`** —— 那个容器的勾选仍然弹回顶部（其余容器正常，看起来像「只有这一处坏了」）。反向的另一种：分键属性（`data-quadrant` / `data-slot`）缺失时 `scrollKeyOf` 返回 `null`，几个容器**撞同一个键**，贴回位置贴到别人身上 | 前者是「修了一半」：用户报告的那处好了，下周新加的面板又坏一次。后者更隐蔽 —— 位置**贴到了别的容器上**，症状是「勾一下另一个象限跳了」，排查时很难想到是快照键撞了 | 键的推导硬性规定：**能用祖先属性分键的必须分**，返回 `null` 的容器**整条跳过**（宁可不贴，也不贴错）。再加一条**自动**守卫：`test-scroll-keep.js` 从 `style.css` 里把所有带 `overflow-y: auto` 的选择器扫出来，逐个要求在登记表里 —— 以后新加可滚面板而忘登记，测试直接红（同 R-38 / R-40 的「自动守卫」路子：靠人眼守清单必然会漏，就让测试来守清单本身） |
| R-44 | **贴回快照时那个容器是隐藏的**（切视图后另一侧的容器 `hidden`），量不到高度，浏览器把写进去的 `scrollTop` **夹成 0** | 象限视图 ↔ 时间视图来回切一次，滚动位置被静默吃掉 —— 没有报错、没有视觉异常，只是「位置没了」，看起来像快照压根没生效 | `renderCurrent` 里 `restoreScroll` **必须排在 `setViewMode` 之后**（`setViewMode` 负责把当前视图那一侧的 `hidden` 摘掉）。`test-scroll-keep.js` 用源码守卫锁住这个先后顺序（`captureScroll` 在最前、`restoreScroll` 在最后且晚于 `setViewMode`）—— 顺序在 Node 里跑不出来，只能锁形状 |
| R-45 | **拖象限 / 时间视图的条目时把指针划过计划池**，落点被判成池 → 松手就搬进池了 | 用户只是想在这几个象限之间挪一下，路过池上方一松手，任务从日期里消失、进了池（要翻到池才找得回来）。跨区落点（需求 3 要的能力）反过来就是这条误落 | 落点**每次移动都重算**，指针离开池立刻落回象限 / 时间视图的落点；`finish` 只报**松手那一刻**的落点。真实手感（拖到池上方时是不是太容易命中）**列进真机验收**（5.3）。真嫌灵敏的话退法很窄：给池落点加一个停留时间 / 位移阈值，不动数据层 |
| R-46 | **手机端折行规则被无意改回去**：有人把 `.task__text` 的 `flex: 1 1 auto` 改回 `flex: 1`（看着「更整齐」），按钮折行立刻失效 —— 而且**外表完全正常**（一切都还在，只是又挤在一行了，看起来像需求没做）；另外一种是规则写漏了媒体查询、**桌面端也折行** | 本条需求的失败模式是「静默复原」：代码在、声明在，只有折行这一条行为没了，用户看到的是「还是老样子」。桌面端多折行则是「本来好好的宽屏被弄松散了」 | `test-mobile-layout.js` 两条**反向**守卫：桌面端段的 `.task__row` 不许有 `flex-wrap`、`.task__text` 不许有 `flex: 1 1 auto`；正向再核对两处选择器名单齐全（四类行容器 / 五个文字格）。测试头注释里写明「basis 为 0 时永远折不出一行」这条机关，避免后来者「顺手改回 flex: 1」 |

| R-47 | **新增的 `.task__actions` 包裹盒在两个方向上都会静默出错**：① 某人删掉桌面端那条 `display: contents`（或把它挪进媒体查询），宽屏就真多出一层盒子，`gap` 被拆成两段 → **宽屏疏密变了**，看着像「顺手重构了一下」；② 拼行的地方漏包一处（比如后面新加一类行），那一处的按钮又散着折、被拆成两半，而**看起来只是「这一行的按钮排得有点怪」**。另外**七处拼行全是手写字符串拼接**，漏一个 `</span>` 会让后面整块 HTML 结构错位 | ①的症状最隐蔽：功能全在、只是间距肉眼可见地不再一致，很容易被当成「样式微调」放过。②是「新行没跟上」的老套路（同 R-38 / R-40：**清单靠人眼守必然漏**）。漏 `</span>` 更糟 —— 浏览器容错会把后面的兄弟节点吞进去，整行甚至整块的点击区域都可能错位，而**报错信息是零** | `test-mobile-layout.js` 三条：① **真实渲染**七类行（象限任务行 / 带阶段的任务行 / 阶段行 / 象限块头 / 计划池条目 / 池内块头 / 时间视图条目）各一条 HTML，断言都含 `<span class="task__actions">`、**`<span>` 开闭配平**、且删除键在组**内**（`del > open`）；② 桌面端段 `.task__actions` 必须是 `display: contents`、且**不许**是 `display: flex`（反向守卫，同 R-46 的路子）；③ 手机端 `.task__actions` 必须有 `display: flex` + `flex-wrap: wrap` + `margin-left: auto`，组内 gap 按行容器分（`.task__row > .task__actions` 8px / 其余 6px）。**配平那条是刻意的**：它不看源码文本，直接看拼出来的字符串，所以后面新加一类行忘了 `</span>` 会当场红 |

### 5.3 还没定下来的问题

- **触摸拖拽手感（R7）**：需求 7（移动端拖动把手）已按 D-48 实现——`drag.js` 的 `pointerType === 'touch' || 'pen'` 只在勾选框上发起拖拽 + CSS `touch-action` 收窄到勾选框。真机上的手感（按住勾选框拖 vs 轻点勾选、任务行正常滚动）仍待真机手工验收，node 测试只锁 CSS 声明（`test-drag-handle.js`）。
- **APK 打包**：v2.11 已执行 `npm run android:build`（`sync:web` → `cap sync android` → `gradlew assembleDebug`），产物 `android/app/build/outputs/apk/debug/app-debug.apk`（3.7 MB，versionCode 5 / versionName "1.4"），并**验过包内 `assets/public` 就是本版代码**（`render.js` 七处 `task__actions`、`style.css` 桌面端 `display: contents` + 手机端那一组规则都在）。**真机安装与手感仍未验**：R7 的触摸拖拽手感、v2.11 两条排版的真机观感，都以「已实现、待真机验收」记录 —— node 侧没有排版引擎，锁不到真实折行位置。
- **阅读栏的默认口径（v2.8）**：需求 2 的原文留下了几处可两解的地方，本次按下面各条实现；第 1、4、5 条**还没有经用户确认**，第 2 条**已经被用户确认并改正**（见修订二），第 6 条是需求没写、主动加的。预期不同的话改起来都不大（各自都收在 `CONFIG` 或一个函数里）：
  1. **「提示不超过 3 项」= 软提示不是硬闸**（D-64）。若用户要的是硬限制，改 `addReadingItem` 加一道 `getReadingStats().over` 判断即可。
  2. ~~**时间的精度是 `HH:MM`，不是完整日期时间**~~ —— **用户已明确否掉**（试用反馈第 3 条：「阅读板块的时间指的是日期」）。现在是 `'YYYY-MM-DD'`，见修订二 / D-67。这条留在纸上是为了记住：当时我按「阅读栏不按天组织，所以只记钟点」推的，推错了 —— 用户要的是「哪天开始读的、哪天读完的」。
  3. **完成日期在点击那一刻自动取**（`Util.todayStr()`），不能事后手改（`completeReadingItem` 的 `doneDate` 参数只有测试 / 补录调用）。需求只说了「自动显示完成时间」。
  4. **展示上限是滚动，不是截断**（D-66）。
  5. 附带一条需求没写、本次主动加的：**「取消完成」的回退路径**（D-65）。
  6. **已读完成那行现在会显示「未设定 → 2026-10-05」**（v2.8 补充修订三）：为了满足需求原文「下方可以自己修改起息时间」，那行必须留一个点得动的按钮，所以起始日期没设过时不再只画完成日期。这是**故意接受**的一点噪音，还没经用户确认。嫌吵的话退起来很小：`buildReadingItemHtml` 里改成「`item.start` 有值才画按钮、否则照旧只画完成日期」，代价是那一条的起始日期就再也补不上了（只能先「取消完成」再设）。
- **阅读栏的起始日期控件在安卓 WebView 上的形态**：`<input type="date">` 在桌面浏览器给原生日期选择器，在部分安卓 WebView 上可能退化成纯文本框。代码按 `YYYY-MM-DD` 文本校验兜底（非法值一律 `BAD_DATE` 拒绝），所以退化也不会有脏数据，但真机上的输入手感未验。另外**选完日期要按回车或点到别处才提交**（和计划池的完成时间同一个框、同一套提交方式，见 D-69）——这条在真机上是否顺手也待验收。

- **双击整条高亮的默认口径（v2.9）**：需求只说了「连续双击 / 浅橙色 / 覆盖字高」，下面几条是本次补的默认，**都还没经用户确认**；要改的话每条都收在一个地方，改动都不大：
  1. **「浅橙」的具体取值是 `#ffd8a8`，文字用固定深棕 `#3a2a12`**（`css/style.css` 的 `--hl-bg` / `--hl-text`）。需求没给色值；选它是因为它够浅（四种象限底色上都压得住）、和完成态的划线变淡区分得开，而且深棕压在上面对比度 > 4.5。**暗色主题刻意不覆盖**（FS 原话「暗色模式下高亮是纯色覆盖整个字高」，所以要的是同一个浅橙，不是「主题化的橙」）。嫌太浅 / 太深改这两个变量即可。
  2. **第 3 个默认：连击的第二下被吞掉**（D-71）。直接后果是「在 × 或「推迟」上快速点两下只触发一次」。这是刻意的可预测性取舍，不是漏做；用户觉得别扭的话，退法是让按钮 / 下拉类控件**也**走第二下的分流（`isControlNode` 里只保留输入框那一类），代价是「连按两次」这类操作的手感要重新验。
  3. **触摸端也是「两次连续轻点」**（`e.detail` 在 WebView 里同样计数）。需求原话「连续双击」直译成触摸端就是两次轻点，没有做成「长按」—— 长按在触摸端是拖拽的前置手势，冲突更大（对照 D-48 把手那套取舍）。
  4. **高亮的唯一入口是双击**，没有给「按钮 / 右键菜单 / 快捷键」这类第二条路（v1 的片段高亮有 `Ctrl+Q` 和右键两条）。需求只点了双击，多给入口等于多一套要维护的手势；真要在手机上加，一个按钮比一个手势更好发现。

- **v2.10 的真机验收清单（都还没验，全是触摸手感）**：本版四条需求里，第 2、3 条在手机上的行为**只有真机能验**，node 里连 DOM 都没有：
  1. **按住池内勾选框拖**能起拖、**轻点池内勾选框**仍然只是勾选（不误触成拖拽）—— 需求 2 把把手从「整条」收窄到「勾选框」，这一收一放都得摸一遍（对照 R-33 解除后池列表能不能顺畅滚）。
  2. **池列表触摸滚动**顺畅、不会被判成拖拽（R-33 解除的实际效果）。
  3. **拖象限条目路过池上方**时会不会太容易落进池（R-45 的误落风险），以及拖过池再拖回去是否跟手。
  4. **手机端折行后的按钮好不好按**（按钮按原宽排布、不拉伸 —— 行尾那几个小按钮在窄屏上会不会太挤）。
  5. 需求 1 在**真机触摸滚动**下的体验：列表滚到中段勾一下完成，位置是否真的守住（快照贴回在 WebView 里的 `scrollTop` 精度）。
  这几条里 1、2 是同一处手势的两面，可以一次验完；4 是纯版面，肉眼即可。
- ~~**v2.10 的一处口径改动需要用户确认**：需求 4 只说「一行放不下时按钮移到下一行」，没说折下来的按钮怎么排。本版按**各自原宽、左对齐、不拉伸**实现（D-75）—— 若用户想要的是「按钮铺满第二行、均分宽度」（v2.1 的 FS 曾这么写过），改 `.task__row` 折行后那一行的 `justify-content` 或给按钮加 `flex: 1` 即可，改动只有一两行 CSS。~~ **用户已答复（v2.11 需求 2）**：既不是均分宽度、也不是靠左 —— 是**整组折到下一行、靠右对齐、左侧留空**，顺带把 v2.10 没做成的「整组一起折」补上（D-76 / 2.46）。这条已关闭。
- **真机上的排版手感仍未验**：v2.11 两条都是纯排版，node 里没有排版引擎（无 puppeteer / playwright / jsdom），只能锁住「让行为成立的那些声明」。`max-width: calc(100% - 32px)` 里 32px 的两头余量、以及手机窄屏上「装得下 / 装不下」的临界点，**要在真机（或 DevTools 手机模拟）实际看一眼**。数字真不合适时改动很小：只动那一个 `32px`（守卫允许 24~50 之间任意值）。
- **`renderCurrent` 的 `keepScroll` 默认值还没定**：现在是「只有勾选类动作显式传 `true`，其余走老路（从顶部看）」。若以后想把「切日期 / 切视图」也做成保留位置（比如用户抱怨翻日期时列表回顶），那要单独设计 —— 那几类动作的列表**内容真的换了**，粘住旧位置可能指向完全不同的条目，不是加个 `true` 就行。

### 5.4 本文和 FS 的对应关系

| FS 里的要求 | 本文哪里讲 | 状态 |
|---|---|---|
| 日报自动统计（需求 1） | 2.15 + D-44 | 已实现 |
| Bonus 任务 / 阶段（需求 2） | 2.16 + D-42/D-43 + D-56（全完成口径，v2.5） | 已实现 |
| 时间视图拖拽 + 记忆（需求 3） | 2.17 + D-45 + D-57（新增排最前，v2.5） | 已实现 |
| 时间视图象限底色（需求 4） | 2.19 | 已实现（纯样式） |
| 面板最大高度（需求 5） | 2.19 | 已实现（纯样式） |
| 完成沉底（需求 6） | 2.18 + D-46/D-47 | 已实现 |
| 移动端拖动把手（需求 7） | 2.19 + D-48 | 已实现（真机手感待验） |
| 四象限高度互不牵制（需求 1） | 2.24 | 已实现（纯样式） |
| 导入自选合并 / 覆盖（需求 2） | 2.22 + D-52 | 已实现 |
| 象限任务默认加到开头（需求 3） | 2.21 + D-50 | 已实现 |
| 计划池任务块 / 整体推迟 / 按任务 DDL（需求 4） | 2.20 + D-51 | 已实现 |
| 折叠状态本机持久化（需求 5） | 2.23 + D-53 | 已实现 |
| 应用重命名 MyPal（需求 6） | 2.25 | 已实现 |
| 任务块推迟键低调化（v2.3 需求 1） | 2.26 | 已实现（纯样式） |
| 块内无阶段任务支持推迟（v2.3 需求 2） | 2.27 + D-54 | 已实现 |
| 象限 / 时间模式下搜索过滤（v2.4 需求 3） | 2.28 + D-55 | 已实现 |
| 池内拖拽改顺序（v2.6 需求 1） | 2.30 + D-58 | 已实现 |
| 池条目导入到第二象限（v2.6 需求 2） | 2.31 + D-59 | 已实现 |
| 计划日期到了自动导入（v2.6 需求 3） | 2.32 + D-60 | 已实现 |
| Markdown 日报只记当天（v2.6 需求 4） | 2.33 | 已实现 |
| 池内任务块与象限任务块同格式同功能（v2.7 需求 1） | 2.34 + 2.35 + D-61/D-62/D-63 | 已实现 |
| 时间视图下计划池排在下面（v2.8 需求 1） | 2.36 | 已实现（纯版面顺序） |
| 阅读栏（v2.8 需求 2） | 2.37 + D-64/D-65/D-66 | 已实现（余下几个默认口径待用户确认，见 5.3） |
| 三个板块可收起且刷新后保持（v2.8 需求 3） | 2.38 | 已实现 |
| 阅读栏回车提交（v2.8 补充需求 1） | 2.37（修订一）+ R-38 | 已修复 |
| 池内块外框对齐象限、蓝色边框（v2.8 补充需求 2） | 2.39 | 已实现（纯样式） |
| 阅读栏的时间是日期（v2.8 补充需求 3） | 2.37（修订二）+ D-67/D-68/D-69 + R-39 | 已实现（老文件的 `HH:MM` 照常导入） |
| 阅读栏的日期设定对齐计划池（v2.8 补充需求 4） | 2.37（修订三）+ D-70 + R-40 | 已实现（已完成那行也能改起始日期） |
| 连续双击整条高亮（v2.9 需求 1） | 2.40 + D-71 + R-41 / R-42 | 已实现（可选 `highlight` 字段；不进统计；随 JSON 导出导入，兼容老版本） |
| 勾选完成后不弹回顶部（v2.10 需求 1） | 2.41 + D-72 + R-43 / R-44 | 已实现（`renderCurrent({ keepScroll: true })`，只给勾选类动作开） |
| 手机端拖动把手统一成勾选框（v2.10 需求 2） | 2.42 + D-73（**反转 D-62**，解 R-33） | 已实现（真机手感待验，见 5.3） |
| 象限 ↔ 计划池双向拖拽（v2.10 需求 3） | 2.43 + D-74（**放开 D-58 的跨容器禁令**） + R-28（修订） / R-45 | 已实现（落点统一成 `{ region, quadrantId, blockId, toSlot, index }`；数据层 23 项真跑） |
| 手机端排版：按钮折行 + 文字占满整行（v2.10 需求 4） | 2.44 + D-75 + R-46 | 已实现（纯 CSS，`max-width: 600px`；按钮排布口径**已由 v2.11 定下**，见下两行） |
| 手机端折行时文字按回第一行（v2.11 需求 1） | 2.46 + D-77 | 已实现（纯 CSS：五个文字格夹 `max-width: calc(100% - 32px)`） |
| 手机端右侧按键整组折行 + 靠右对齐（v2.11 需求 2） | 2.46 + D-76 + R-47 | 已实现（渲染层七处包 `.task__actions`；桌面端 `display: contents`） |
