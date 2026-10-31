# WhatToEat 项目长期记忆

## 身份
「今天吃什么」小程序，AppID `wxc796aa4a0b4af49e`，云开发 `cloud1-d7gua1dxyb865738c`（个人版，ap-shanghai，2027-02 到期）。原生 JS + Skyline + glass-easel，全局自定义导航栏。**Skyline 的 CSS Grid 不完整，布局一律 Flex**。

## 目录硬约束
- **`custom-tab-bar/` 必须在项目根目录**（4 文件齐全）。`tabBar.custom:true` 时框架固定去根目录找，放 `components/` 报 `Component is not found`。本项目里它是 0 尺寸空壳，真悬浮条由各 tab 页用模板自渲染（Skyline 下组件宿主命中区 ≠ fixed，组件里的条子点不动）。
- tabBar 模板 `styles/tabbar.wxml`（4 个 tab 页 import）+ 样式 `styles/tabbar.wxss`（`@import`）。搬模板必须同步改 4 个 import，断链则条子消失。
- **`cli preview`/`upload` 不校验运行时引用**（wxml 断链、删 custom-tab-bar 都照样 `√`）。**上传成功 ≠ 功能正常**：改路径后 `test -f` 全部 import + 确认根目录 custom-tab-bar + `preview --qr-format image` 扫码验。
- `packOptions.ignore` 已排除 `.workbuddy`/`preview`/`docs`/`README.md`/`LICENSE`/`.editorconfig`/`.prettierrc`/`.prettierignore`。

## 数据层（`utils/store.js` 唯一入口）
- 本地先写、云端排队：`enqueueCloud` 串行补写，失败走 `onCloudError`（app.js 注册）。`await store.saveX()` 立刻返回，别等云端。
- 四件套顺序铁律：**补传 outbox（`wte_dirty_v1`）→ 清墓碑（`wte_tombstones_v1`，删除那一刻就记）→ 补记额度 → 增量拉取（`wte_sync_stamps_v1`，`gte(水位)`）**。反了会丢新数据/复活已删/额度被盖。
- ACL `PRIVATE`：`dishes`/`meal_records`/`user_settings`/`reminders`/`daily_checkins`/`error_logs`；`feedbacks` 是 ADMINONLY。
- **读缓存 `readCache`（2026-10-31 加）**：`getDishes()`/`getRecords()` 返回模块级缓存对象本身（不再每次 `getStorageSync` + 深拷贝）。失效收敛在 `set()`/`removeKey()`，**禁止绕过它们直接 `wx.setStorageSync` 写这两个键**；**测试里直接改内存 storage 必须调 `store.resetReadCache()`**（`store.test.js` 已加，`regression.test.js` 用 Proxy 自动失效）。副作用：返回共享数组，**就地 `.sort()` 前先 `.slice()`**。
- **记录按年分片** `wte_records_2026_v1` + 索引 `wte_records_years_v1`。单 key 1MB（约 2500 条满）。读写只走 `getRecords()`/`writeRecordShards()`，别碰分片键。迁移在 `bootstrap()`，先写分片后删旧键。
- `writeRecordShards(list, {touchedYears})`：默认全量重桶（跨年/整年删空只在这条路上安全）；`saveRecord`/`deleteRecord` 传 `touchedYears` 走快路径，只重写动到的那 1~2 片。**年份集合一变（跨年、某年删空）快路径自动作废**，回落到全量。
- 全量拉取用 `mergeLocalOnly()` 先补本地独有条目；错误提示用 `tagCollection` + `describeCloudError`，别硬编码集合名。`mergeLocalOnly` 与 `migrateLocalToCloud` 补传成功后都会 `clearDirty`。
- **菜品聚合（eatCount/score/lastEatDate）一律按 `meal_records` 重算**（`dishStatsFromRecords`/`recomputeDish`），禁用增量平均。`recomputeDish` 会 bump updatedAt + markDirty；`recomputeAllDishStats()`（拉完自愈）**不动 updatedAt、不反写云端**，防两机互覆盖。
- `saveRecord` 带 `id` 即编辑（留 createdAt，换菜前后两道都回算）；记录页点某餐=编辑，长按=删除。列表页按 id 取数据先建 `Map`。
- **`syncThen(cb)`**：页面 onShow 标准写法（11 处样板已收口），`synced` 为真才回调。`reminders.js` 要按失败 `checkCloud()`，仍用裸 `syncFromCloud`。
- **同步水位回退 10 分钟**（`SYNC_STAMP_SAFETY_MS`）：`updatedAt` 是各机自己的 `Date.now()`，时钟漂移时慢的那台会永远低于水位→静默丢数据。多拉几条幂等，`setSyncStamp` 仍取 max。
- **节日库 `utils/festival.js`**：节日要么 `food` 要么 `line`（≤15 字），**二选一不共存**（wxml `wx:if`/`wx:elif`），漏了那行就是空的。选中某天（`daysToShow({date})`）时显示农历；本周块（`{limit}`）只显示公历。

## 设置与提醒
- `normalizeSettings()` 以 `DEFAULT_SETTINGS` 键/类型为准，不写白名单；`updatedAt` 保留但「加额度」不 bump。
- **`pushQuota` 只有云函数扣、客户端只能加**：写云时 `delete data.pushQuota`，加额度走 `db.command.inc`（`flushQuotaPending`），离线增量攒 `wte_quota_pending_v1`，拉取取云端值。`user_settings` 每 openid 一份，取 `updatedAt` 最新并清多余（`readSettingsDoc`）。
- **额度无感自动补**：勾「总是保持以上选择」后，同模板再调 `requestSubscribeMessage` 不弹窗、直接 accept → +1。判据只有 `wx.getSetting({withSubscriptions:true})` 的 `itemSettings`（空=没勾，不能调），缓存 `wte_sub_state_v1`，`autoState()` 四态。`topUpIfNeeded()` 挂在首页 `handlePick`/`confirmDish`/`openCheckin`、记录页 `save`、签到页 `openToday`/`goForm`、签到表单 `save` 的 tap；水位 `HIGH_WATER=60`、每小时封顶 40 次。**必须 tap 里同步调**，await 过网络就报 `can only be invoked by user TAP gesture`（模拟器不暴露，真机才看得见）。`reject`/`off` 只能 `wx.openSetting` 引导。
- **云函数扣额度也必须 `_.inc(-n)`**（`spendQuota`）：绝对值覆盖会盖掉「读额度→推送→写回」期间用户新加的份额，只在下次推送报 43101 才暴露。43101 走 `clearQuota` 置 0。
- **索引**：各集合 `id` 与 `updatedAt` 必建；`error_logs` 建 `at`，`reminders` 另有 `nextTriggerDate`。**四个同步集合（dishes/meal_records/reminders/daily_checkins）另需 `_openid+updatedAt` 复合索引**——`querySince` 只写 `where({updatedAt:gte})`，`_openid` 是 ACL 服务端追加的，两个单字段索引只能命中一个（Console 会弹「快速创建索引链接」，2026-10-31 已补 `_openid_1_updatedAt_1`）。**`_openid` 不是每集合都自动建**（`reminders`/`daily_checkins` 实测为空）。建索引用 CloudBase MCP `writeNoSqlDatabaseStructure`，控制台「命中次数」是累计值，刚建必为 0。
- **普通提醒一律公历**（`calendar` 恒 `solar`）；**只有纪念日可选公历/农历**。
- 存量 `legacyLunar` 编辑时保留农历语义，否则 yearly 农历提醒被静默降级。`computeLunarState(seed, today, noRoll)` 的 **`noRoll` 必传**：顺延只适合新建，编辑时会平移一年（农历八月十五 `2026-09-25` → `2027-09-15`）。**2026-10-31 已修 `lunarDayChange` 漏传 + `regression.test.js` 加了静态断言**（凡带 `this.data.today` 的调用行必须同时出现 `this.data.noRoll`）。
- **教训**：任何「新建时的智能调整」都要绕开存量数据。引擎层 `lunarOccurrences`/`anniversaryHit`/`baseDate`/`eventText` 别删，云函数与存量数据靠它。
- **页面 `data` 里别调 `today()`**：页面模块常驻，值跨天失效（`record-form` 栽过——隔夜后保存被判「不能记录未来日期」）。时间一律 `onLoad`/`onShow` 现算。
- **跨月跟随（2026-10-31 加）**：`records.js` / `report.js` 的 `followCurrentMonth()` 在 onShow 里跑，判据是「当前看着的月 == 上次进来时今天所在的月」→ 才跳到本月；`prevMonth`/`nextMonth` 置 `followToday=false`，`backToMonth` 置回 true。可翻范围锚点每次 onShow 都重算，否则新月份卡在边界外。
- 记录页 `refresh()` = `buildMonthView()` + `paint(view, withCells)`；选中/取消走 `repaint()` 复用 `this.monthView`。**`paint` 里 `todayEmpty` 必须带 `&& !selected`**。
- 月份标题右两个胶囊：`今`（非本月才出现）、`月`（有 `selectedDate` 时）。
- 日历格：节日=数字亮蓝、纪念日=亮紫、**有提醒=右上角红点角标**（纪念日不算）。角标绝对定位、不占格高，**必须 2rpx 白描边**。格子带 `aria-label`（`cell.label`=「N 月 N 日，M 餐」）。
- **CSS 顺序坑**：「选中+今天+纪念日」撞一起时 `.day.selected .day-num.is-today` 与 `.anniversary` 特异性都是 (0,4,0)，**白字规则必须写在后面**（`regression.test.js` 有静态断言）。
- **卡片垂直间距统一 20rpx**（含空态卡）；`section-label` 另用 34/14。records 日历态空态卡**无条件带 `.month-empty`**（与 `record-head` 互斥）。
- 首页记住的菜存 `wte_home_pick_v1`（只本机不同步），只在抽签/改筛选/失效时换。

## 云函数与触发器
- 三个函数：`reminderPush`（Nodejs16.13/20s，定时推送）、`feedbackSubmit`（**Nodejs20.19**/20s，反馈入库+通知）、`syncBatch`（**Nodejs20.19**/20s，批量补传）。部署与排障见 `docs/deploy.md`。
- **运行时创建后不可改**（SCF 文档原文「创建时指定，目前不支持修改」），升级只能**删了重建**；**MCP 白名单只到 `Nodejs20.19`**（平台支持 22.21/24.11/26.x，MCP 枚举没跟上）。重建带环境变量的函数前必须先 `revealEnvValues:true` 读明文（默认只回 `***` + 长度）。**`reminderPush` 故意留在 16.13**：触发器只能 IDE 图形上传，删了重建＝推送静默死亡。CloudBase 文档里 16.13 状态仍是「可用」，EOL 的是上游 Node。
- **`feedbackSubmit`**：写入走云函数不直写（集合缺失时客户端报 `-502005`，云函数能自己建）；图片只收 `cloud://` 前缀，否则通知变钓鱼载体。集合 ACL **ADMINONLY**。通知支持企微+飞书（`FEEDBACK_WEBHOOK`/`_SECRET`/`_TYPE`，按 host 认渠道）；**飞书签名 `HMAC-SHA256(key="${timestamp}
${secret}", data="")`**，key 与 data 反着来；**成功判据必须看 body 的 `errcode`/`code`**，地址填错时 HTTP 也是 200。
- **`syncBatch`（2026-10-31 上线）**：待传 ≥20 条走它，100 条一片；服务端 `id in [...]` 一次查重、按 `updatedAt` 判新旧、**每条按 OPENID 圈定并显式写 `_openid`**（云函数 add 不自动补，漏了客户端读不到）。白名单只收四个业务集合。**没部署也能用**：客户端拿到 `-501000` 后本会话降级逐条。
- `reminderPush` 触发器**只能 IDE 图形上传**（右键 config.json），CLI/控制台建的没有小程序上下文（`send` 报 `-501001`）；**CloudBase 侧 `triggers:[]` 正常**。唯一判据 `tcb logs search --query 'function_name:"reminderPush"' -e <env>` 看周期性 `RetMsg: {"scanned":N}`（`ListTriggers` 返回 0、invoke 报 `-501001` 都不算证据）。详见 `docs/deploy.md`。
- 部署优先级：① 改代码 `manageFunctions(action="updateFunctionCode", functionRootPath="D:/Personal/WhatToEat/cloudfunctions")`（秒级、不动触发器、不丢 openapi 权限）；② 新建 `createFunction` 同路径，**`func` 里没有 `description` 字段**，传了 schema 报错；③ 超时**必须单独** `updateFunctionConfig` + 顶层 `timeout`（默认 3 秒）。`tcb fn deploy` 会卡死。
- cron `0 */5 * * * * *` + `WINDOW_MINUTES=15` 配合；改 cron 只能图形上传，窗口随之放大。**只有 43101/47003/40037 永久错误才写 lastPushed**，网络抖动故意不写等下个窗口。验证真发没发：临时挪云端 `time` + `pushQuota` 置 1，等一轮看 `pushed/failed`，**测完还原**。

## 订阅消息模板
- **`ACTIVE_TEMPLATE = 'compact'`**：3 关键词，ID `HcqoSxyPU44u5AItKZCKJVcBK9TWphDfbMmGwvh_oXM`（编号 571，2026-10-30 重建版）。回退 `legacy` 5 关键词 `HcqoSxyPU44u5AItKZCkJY_xnhIjZDPz_yHPeDBG2_c`（槽位语义错位）。
- 槽位：`thing5`←content、`date4`←eventDate、`thing2`←timeNote。**`date4` 是 date 类型，只认「2026年10月30日」**。**关键词一个不能漏**（`47003 ... is empty` 一次只报一个），**多余 key 被忽略**，排查直接填超集；`newtmpllist` 报 `-604100` 别试。
- `utils/notify.js` 是**模板结构唯一来源**（`TEMPLATE_ID` + `TEMPLATE_SLOTS`），`lib/notify.js` 是副本。**换模板只改这两处** + 复制 + `updateFunctionCode`；**换完必须让用户重新点「额度+1」**（旧额度绑旧模板 → 43101）。`40037` 是永久错误：10-29 那个 571 模板就栽在这，同编号新 ID 立刻通。
- **`lastPushed` 必须在「触发时刻」变化时清空**（`saveReminder` 用 `triggerSignature` 比对）；只改名/开关不清。

## 测试
- **12 套，改完必全跑**：`for t in store cloudpush engine pages checkin quotes festival pick report feedback regression syncbatch; do node .workbuddy/tests/$t.test.js; done`。`feedback.test.js` 守 feedbackSubmit；`syncbatch.test.js` 守批量补传（服务端校验 + 客户端降级）；`regression.test.js` 钉「改了不报错但行为变了」的分支（记一餐页跨天、logError 去重、记录页 repaint、noRoll、跨月跟随）。
- 测试在 `.workbuddy/tests/`，**不进 git**。**别加回追踪、别删文件**——clone 下来没测试是 lodge 主动选的。
- 云函数单测用 `Module._load` 拦 `wx-server-sdk` + 假 db。改查询条件时**假库要同步加操作符**（`in`/`gte`/`lt`/`inc`/`remove`），否则新条件匹配不上、测试假装通过。
- 加用例前先看前面有没有打桩；**`instantiate()` 同一页面只能用一次**，要先 `delete require.cache[...]`。wxml 结构改动用静态断言守。

## 微信开发者工具
- stable 2.02.2608070，路径 `C:\Program Files (x86)\Tencent\微信web开发者工具`。Nightly ≥ 2.02.2608312 才有虚拟支付 skill。
- 启动：`env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS "./微信开发者工具.exe"`（**必须非沙箱**）；`ELECTRON_RUN_AS_NODE=1` 会空跑无窗口。
- **CLI 在 Git Bash 里完全没输出**（`cli.bat`、`ELECTRON_RUN_AS_NODE=1 ./微信开发者工具.exe cli.js` 都一样；本版入口是根目录 `cli.js`，没有 `cli/` 目录）。**换到 Windows 原生终端跑 `& "...\cli.bat" preview --project ... --qr-format image --qr-output ...` 就正常**，会打印包体积表并落地二维码。
- 端口由 IDE 写进 `User Data/<hash>/Default/.ide`。**改 `packOptions.ignore` 必须 `cli.bat quit` 重启 IDE**（close+open 无效）。`preview` 放过未引用的坏 js，`upload` 不放过；上传成功还得去公众平台设体验版。

## 仓库与文档
- **版本号唯一来源 `utils/version.js`**（`APP_VERSION`）：profile 与 feedback 共用，发版跟 `cli upload -v` 一起改。
- 远程 `github.com/EchoHeim/WhatToEat` **公开**；`.workbuddy/memory/` 必须随仓库提交，`packOptions.ignore` 仍忽略整个 `.workbuddy`。仓库公开 → **记忆里不写凭据**。
- **代码风格（2026-10-31 统一）**：`.editorconfig` + `.prettierrc`（`semi:false`/`singleQuote`/`printWidth:120`/`arrowParens:"avoid"`/`trailingComma:"none"`/`endOfLine:"lf"`）。`records.js` 曾是双引号+分号的孤岛，已 `npx prettier@3.3.3 --write` 格式化（本机没装 prettier，走 npx 临时拉）。
- **文档拆到 `docs/`**：`sync.md` / `data-model.md` / `reminder-engine.md` / `deploy.md` / `privacy.md`。README 只留功能 + 选型 + 本地运行 + 索引。
- 图标脚本在 `.workbuddy/tools/`（源图 `mood-src/`），删了不可复现；本机 Python 有 Pillow 13，无 ImageMagick/ffmpeg。
- `utils/{reminder,lunar,notify}.js` ↔ `cloudfunctions/reminderPush/lib/` 是**手工副本**，改前端必须复制（`engine.test.js` 剔头注释后逐字节比对）。
- 评审报告：`.workbuddy/reviews/2026-10-31-code-review.md`（P0/P1 已全部落地；剩隐私指引需人工在公众平台核对）。
