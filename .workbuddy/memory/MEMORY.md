# WhatToEat 项目长期记忆

## 项目身份
- 「今天吃什么」小程序，AppID `wxc796aa4a0b4af49e`，云开发环境 `cloud1-d7gua1dxyb865738c`（个人版，ap-shanghai，2027-02 到期）。
- 原生 JS + Skyline + glass-easel，全局自定义导航栏。**Skyline 的 CSS Grid 不完整，布局一律 Flex**。

## 目录硬约束（2026-10-29 立规矩）
- **`custom-tab-bar/` 必须在项目根目录**（4 个文件齐全）。`tabBar.custom: true` 时框架固定去代码根目录找，放进 `components/` 报 `Component is not found`，**无配置项可改**。本项目里它是 0 尺寸空壳，真悬浮条由各 tab 页用模板自渲染（Skyline 下组件宿主的命中区与 fixed 不一致，组件里的条子点不动）。
- **tabBar 模板/样式分开放**：`styles/tabbar.wxml`（4 个 tab 页 `<import src="/styles/tabbar.wxml" />`）+ `styles/tabbar.wxss`（`@import "../../styles/tabbar.wxss"`）。搬模板必须同步改 4 个 import，断链后悬浮条直接消失。
- **`cli preview`/`upload` 不校验运行时引用**（wxml 断链、删 custom-tab-bar 都照样 `√`）。**上传成功 ≠ 功能正常**：改路径后要 `test -f` 全部 import + 确认根目录 custom-tab-bar + `preview --qr-format image` 扫码验。

## 数据层（`utils/store.js` 是唯一入口）
- 本地先写、云端排队：`enqueueCloud` 串行补写，失败走 `onCloudError`（app.js 注册）提示「已存本机」。页面 `await store.saveX()` 立刻返回，**别再等云端**。
- 四件套顺序是铁律：**补传 outbox（`wte_dirty_v1`）→ 清墓碑（`wte_tombstones_v1`，删除那一刻就记）→ 补记额度 → 增量拉取（`wte_sync_stamps_v1`，`gte(水位)`）**。反了会丢新数据/复活已删/额度被盖。
- 集合全部 ACL `PRIVATE`：`dishes`/`meal_records`/`user_settings`/`reminders`/`daily_checkins`/`error_logs`。
- **记录按年分片**：`wte_records_2026_v1` + 索引 `wte_records_years_v1`。单 key 1MB 上限，2500 条就满。读写一律走 `getRecords()` / `writeRecordShards()`，别直接碰分片键；`writeRecordShards` 全量重新分桶（改日期会跨年）。迁移在 `bootstrap()`，先写分片后删旧键。
- 全量拉取用 `mergeLocalOnly()` 先补本地独有条目。错误提示用 `tagCollection` + `describeCloudError`，别硬编码集合名。
- **菜品聚合（eatCount/score/lastEatDate）一律按 `meal_records` 重算**（`dishStatsFromRecords`/`recomputeDish`），禁用增量平均。`recomputeDish` 会 bump 菜的 updatedAt + markDirty；`recomputeAllDishStats()`（拉完自愈）**不动 updatedAt、不反写云端**，防两机互覆盖。
- `saveRecord` 带 `id` 即编辑（留 createdAt，换菜时前后两道都回算）；记录页点某一餐=编辑，长按=删除。
- 列表页按 id 取数据先建 `Map` 索引，别在循环里调 `store.getDish()`。
- **节日库 `utils/festival.js` 的数据约定**：每个节日要么有 `food`（页面显示「吃点：XX」），要么有 `line`（15 字以内一句话），**二选一不共存**（wxml 用 `wx:if`/`wx:elif`）。新增节日漏了这两个，卡片那行就是空的。右侧日期按**视图模式**分：选中某天（`daysToShow({date})`）时节日/提醒/纪念日**都显示农历**；本周块（`{limit}`）只显示公历。

## 设置与提醒规则
- 设置项不写字段白名单，`normalizeSettings()` 以 `DEFAULT_SETTINGS` 键/类型为准；`updatedAt` 保留但「加额度」不 bump。
- **`pushQuota` 只有云函数扣、客户端只能加**：写云时 `delete data.pushQuota`，加额度走 `db.command.inc`（`flushQuotaPending`），离线增量攒 `wte_quota_pending_v1`，拉取一律取云端值。云端 `user_settings` 每 openid 一份，取 `updatedAt` 最新并清多余（`readSettingsDoc`）。
- **云函数扣额度也必须 `_.inc(-n)`**（`spendQuota`），不能整份写回：客户端 `addPushQuota` 也在 inc，绝对值覆盖会把「读额度→推送→写回」这几秒里用户新加的份额静默盖掉（用户点了订阅却没额度，只在下次推送报 43101 才暴露）。43101 走 `clearQuota` 绝对值置 0——那说明云端记账和实际授权已经对不上。`readQuota` 读出来先 `Math.max(0, ...)` 夹平脏数据，`spendQuota` 在余额不够扣时直接置 0，不让 inc 扣出负数。
- **云数据库索引（2026-10-30 已全部落地）**：各集合的 `id` 与 `updatedAt` 都必须建（增量拉取 `gte(updatedAt)` + upsert 按业务 id 查重），否则每次同步全表扫；`error_logs` 建 `at`，`reminders` 另有 `nextTriggerDate`。**`_openid` 索引不是每个集合都自动建**——后建的 `reminders`/`daily_checkins` 实测是空的，缺了等于 ACL 过滤全表扫，要手动补。
- **建索引不用手点**：CloudBase MCP `writeNoSqlDatabaseStructure`（`action=updateCollection` + `updateOptions.CreateIndexes`，一次可传多个索引）直接建，`readNoSqlDatabaseStructure` 的 `listIndexes` 核对。控制台的「命中次数」是累计值，刚建必为 0，跑一次真实查询才涨。
- **普通提醒一律公历**（表单不显示日历段，`calendar` 恒 `solar`）；**只有纪念日可选公历/农历**，农历由农历 picker 独立控制，改公历日期不动农历字段。
- 存量 `legacyLunar` 编辑时保留农历语义，否则 yearly 农历提醒被静默降级成公历。`computeLunarState(seed, today, noRoll)` 的 `noRoll` 必传（`onLoad` 按是否编辑农历数据置真，四个 change 处都传）：顺延逻辑只适合新建，编辑时会把触发日平移一年。
- **教训**：任何「新建时的智能调整」都要绕开存量数据——存量字段是权威值。
- 引擎层 `lunarOccurrences`/`anniversaryHit`/`baseDate`/`eventText` 别删，云函数推送和存量数据靠它。
- 页面首屏一律「先渲染本地缓存 → 后台 `syncFromCloud()` → 成功后 refresh」；表单页用 `touched` 防覆盖输入。
- **页面 `data` 里别调 `today()` 这类时间函数**：页面模块常驻内存，值会跨天失效（`record-form` 栽过——隔夜后保存被误判「不能记录未来日期」）。时间一律在 `onLoad`/`onShow` 现算；跨天时还要把「新增态且没手动改过」的默认日期一起推进，编辑态只修 today 不动用户选的日期。
- **月份标题右边有两个小胶囊**：`今`（`showBackToMonth`，不是本月时才出现，跳回今天所在月）、`月`（`selectedDate` 有值时出现，取消选中回整月）。原来「查看整月」在日卡列表上方的 `record-head` 里，2026-10-30 挪到月份头并缩成一个字；`record-head` 现在只在有日卡时显示「N 餐」。
- 记录页 `refresh()` = `buildMonthView()`（重建整月模型）+ `paint(view, withCells)`（按选中态渲染）；选中/取消某天走 `repaint()` 复用 `this.monthView`，不重读 storage、不重传 cells。**`paint` 里 `todayEmpty` 必须带 `&& !selected`**，否则选中某天时会冒出「今天还是空白」卡片。**空态卡（`.today-hint`）有两个来源**：整月视图且今天空白，或选中某天且那天空白（未来日除外），统一走 `emptyHint` 对象 + `hintTargetDate`；算的时候是 `(!selected && view.todayEmpty) || selectedEmpty`，漏了 `!selected` 会让「选中有记录的日子」也冒出这张卡。日历格三种标记：节日=数字亮蓝、纪念日=数字亮紫、**有提醒=数字右上角红点角标**（`hasReminderOn`，纪念日不算）。角标绝对定位在 `.day-num` 上、不占格子高度，**必须带 2rpx 白描边**——否则和「今天」那个 `#E85D3F` 边框糊成一块。
- **日历数字的 CSS 顺序坑**：「选中 + 今天 + 纪念日」三个条件撞一起时，白字规则 `.day.selected .day-num.is-today` 和 `.day.selected .day-num.anniversary` 特异性都是 (0,4,0)，**必须写在后面**，否则被改回 `#C9482D`，深橙红压在橙底上几乎看不见（2026-10-30 就是这个组合）。`regression.test.js` 有静态断言守这个先后。
- **卡片之间的垂直间距统一 20rpx**（records 的 festival/today-hint/空态、reminders 的空态）。空态卡也是卡片，别漏 —— 漏了就直接贴在日历下沿。`section-label` 是段落标题，另有 34/14 的节奏，别跟卡片间距混用。records 的日历态空态卡**无条件带 `.month-empty`**（`record-head` 只在有日卡时渲染，和它互斥）；搜索态那张别带，前面 `search-bar` 已有 20rpx。
- 首页记住的菜存 `wte_home_pick_v1`（`getHomePick`/`saveHomePick`，只存本机不参与同步），只在抽签/改筛选/失效时换。

## 云函数与触发器
- `reminderPush` 定时触发器**只能微信开发者工具图形界面上传**（右键 config.json → 上传触发器）。IDE CLI 无触发器能力；`tcb`/控制台建的触发器没有小程序上下文，`subscribeMessage.send` 报 `-501001`（issue #1445）。
- **别用 `tcb api scf ListTriggers` 判断**（云开发触发器不挂在 SCF 列表，返回 0 也照样在跑）。唯一判据：`tcb logs search --query 'function_name:"reminderPush"' -e <env>` 看有没有周期性 `RetMsg: {"scanned":N}`。`tcb fn log` 已废弃。
- **`-501001` 不能当判据**：`tcb fn invoke`/控制台测试都不带小程序上下文，必然报错。只能等触发器真跑一轮看日志。
- 部署优先级：① **改代码走 CloudBase MCP `manageFunctions(action="updateFunctionCode", functionRootPath="D:/Personal/WhatToEat/cloudfunctions")`**（秒级、包必可用；纯改代码不动触发器也不丢 openapi 权限，实测 02:15 `pushed:1`）；② 超时**必须单独** `updateFunctionConfig` + 顶层 `timeout`（原 3 秒 → 20 秒）；③ IDE CLI `cloud functions deploy` 只在新建函数登记 openapi 权限时用（它不建触发器，打的包还解不开 `require('./lib/reminder')`）。`tcb fn deploy` 会卡死，别用。
- cron `0 */5 * * * * *` + `WINDOW_MINUTES=15` 配合；推成功写 lastPushed 挡重复。改 cron 只能图形界面上传，窗口要随之放大。
- **推送失败分两类**：只有 43101/47003 这类永久错误才写 lastPushed，网络抖动**故意不写**等下个窗口重试。
- 验证真发没发：临时挪云端 `time` 到几分钟后 + `pushQuota` 置 1，等一轮看 `pushed/failed`，**测完还原 time 和 lastPushed**。2026-10-24 已实跑通过（`pushed:1 failed:0`，额度 8→7）。

## 订阅消息模板
- **当前生效 `ACTIVE_TEMPLATE = 'compact'`**（`utils/notify.js`）：3 关键词，ID `HcqoSxyPU44u5AItKZCKJVcBK9TWphDfbMmGwvh_oXM`（编号仍是 571，2026-10-30 重建的版本）。2026-10-30 08:34 真机收到，三行全对。
- 槽位：`thing5`←content（日程标题）、`date4`←eventDate（日程时间）、`thing2`←timeNote（提醒内容，钟点拼进去）。**`date4` 是 date 类型，只认「2026年10月30日」这种写法**，传 `2026-10-30` 会被判参数非法。
- 回退用 `legacy`：5 关键词 `HcqoSxyPU44u5AItKZCkJY_xnhIjZDPz_yHPeDBG2_c`，槽位语义错位（`thing10`「地点」槽放日期、`short_thing19`「类别」固定「用餐提醒」），多两行。
- **关键词一个不能漏**（缺一个报 `47003 data.XXX.value is empty`，一次只报一个）；**多余 key 被忽略**，排查直接填超集。`newtmpllist` 报 `-604100`，别试。
- 文案生成在 `utils/notify.js`（云端副本 `lib/notify.js`），它同时是**模板结构的唯一来源**（`TEMPLATE_ID` + `TEMPLATE_SLOTS`），云函数与编辑页预览共用同一份。**换模板只改这两处** + 复制副本 + `updateFunctionCode`。
- **换完必须让用户重新点「额度+1」**——一次性订阅授权绑模板，旧额度对新模板无效（会 43101）。
- `40037 invalid template_id` 是永久错误（模板不属于该小程序 / 已删 / ID 抄错）。**10-29 那个 571 模板就栽在这，10-30 重建同编号的新 ID 立刻通了** → 先怀疑模板本身，别急着怀疑代码或后台操作。
- **`lastPushed` 必须在「触发时刻」变化时清空**：`store.saveReminder` 用 `triggerSignature`（date/calendar/repeat/time/advanceDays/lunar）比对，改了就清。否则当天推过一次后改时间，那轮被跳过、当天收不到。只改名/开关不清。

## 测试
- **10 套，改完必全跑**：`for t in store cloudpush engine pages checkin quotes festival pick report regression; do node .workbuddy/tests/$t.test.js; done`（第 10 套 `regression.test.js` 是 2026-10-30 加的，钉三处「改了不报错但行为变了」的分支：记一餐页跨天、logError 云端去重、记录页 repaint 不重建月模型）
- 测试在 `.workbuddy/tests/`（从根目录挪来，根目录清爽），**不进 git**（`.gitignore` 只有 `.workbuddy/*` + `!.workbuddy/memory/`；`git rm -r --cached -f` 已执行，`-f` 只清索引不删文件）。**别加回追踪、别删文件**——clone 下来没有测试是 lodge 主动选的。
- 云函数单测用 `Module._load` 拦 `wx-server-sdk` + 假 db（where/doc/update/remove + `command.inc/gt/lte/exists`）。改查询条件时**假库要同步加操作符**，否则新条件一条都匹配不上、测试假装通过。
- **加用例前先看前面有没有打桩**（pages.test.js 的桩会污染后续用例）。**`instantiate()` 同一页面只能用一次**，要先 `delete require.cache[...]`。
- wxml 结构改动用静态断言守（读 wxml 查关键标记），逻辑测试跑不出布局问题。

## 微信开发者工具
- stable 2.02.2608070，路径 `C:\Program Files (x86)\Tencent\微信web开发者工具`。Nightly 要求 ≥ 2.02.2608312 才有虚拟支付 skill。
- 启动：`env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS "./微信开发者工具.exe"`（**必须非沙箱**）。环境里的 `ELECTRON_RUN_AS_NODE=1` 会让它空跑无窗口；沙箱下 GPU 崩 (`-1073741819`)。
- CLI 调用一律 `env -u NODE_OPTIONS ./cli.bat ...`；端口由 IDE 写进 `User Data/<hash>/Default/.ide`，不必手改 localstorage。
- `cli.bat upload` 在 Git Bash 报 `'C:\Program' 不是内部命令`，绕过：直接 `ELECTRON_RUN_AS_NODE=1 ./微信开发者工具.exe -e '...' cli/index.js upload --project ... -v ...`。
- **改 `packOptions.ignore` 必须 `cli.bat quit` 重启 IDE**（close+open 无效，配置缓存在主进程）。`preview` 放过未引用的坏 js，`upload` 不放过。上传成功还得去公众平台设体验版。

## 仓库与其他
- 远程 `github.com/EchoHeim/WhatToEat` **公开**，但 `.workbuddy/memory/` 必须随仓库提交（lodge 明确要求），`packOptions.ignore` 里仍忽略整个 `.workbuddy`。
- 仓库公开 → **记忆里不写凭据**（AppSecret、支付密钥、access_token、手机号）。
- 图标脚本在 `.workbuddy/tools/`（`gen_tabbar_icons.py`、`gen_mood_icons.py`，源图 `mood-src/`），删了不可复现，不进仓库。本机 Python 有 Pillow 13，无 ImageMagick/ffmpeg。
