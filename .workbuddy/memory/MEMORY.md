# WhatToEat 项目长期记忆

「今天吃什么」小程序，AppID `wxc796aa4a0b4af49e`，云开发 `cloud1-d7gua1dxyb865738c`（个人版，ap-shanghai，2027-02 到期）。原生 JS + Skyline + glass-easel，全局自定义导航栏。**Skyline CSS Grid 不完整，布局一律 Flex**。

## 目录硬约束
- `custom-tab-bar/` 必须在项目根目录（4 文件齐全），`tabBar.custom:true` 时框架只去根目录找。本项目里它是 0 尺寸空壳，真悬浮条由 4 个 tab 页用 `styles/tabbar.wxml` 自渲染（Skyline 下组件宿主命中区 ≠ fixed，组件里的条子点不动）。搬模板必须同步改 4 个 import + `@import` 样式。**aria 要加在 `styles/tabbar.wxml`，改 `custom-tab-bar/` 里的空壳无效。**
- **`cli preview`/`upload` 不校验运行时引用**（wxml 断链照样 √）。上传成功 ≠ 功能正常：改路径后 `test -f` 全部 import + 确认根目录 custom-tab-bar + `preview --qr-format image` 扫码验。
- `packOptions.ignore` 已排除 `.workbuddy`/`preview`/`docs`/README/LICENSE/`.editorconfig`/`.prettierrc`/`.prettierignore`。

## 数据层（`utils/store.js` 唯一入口）
- 本地先写、云端排队：`enqueueCloud` 串行补写，失败走 `onCloudError`（app.js 注册）。**四件套顺序铁律**：补传 outbox(`wte_dirty_v1`) → 清墓碑(`wte_tombstones_v1`) → 补记额度 → 增量拉取(`wte_sync_stamps_v1`, `gte(水位)`)。反了会丢数据/复活已删/额度被盖。
- **读缓存 `readCache`**：`getDishes()`/`getRecords()` 返回模块级缓存对象本身；失效只收敛在 `set()`/`removeKey()`——**禁止绕过它们直接 `wx.setStorageSync` 写这两个键**；测试里直接改内存 storage 必须 `store.resetReadCache()`。返回共享数组，**就地 `.sort()` 前先 `.slice()`**。
- **记录按年分片** `wte_records_2026_v1` + 索引 `wte_records_years_v1`（单 key 1MB ≈ 2500 条）。只走 `getRecords()`/`writeRecordShards()`。`writeRecordShards(list,{touchedYears})`：默认全量重桶；`saveRecord`/`deleteRecord` 传 `touchedYears` 走快路径，**年份集合一变（跨年/某年删空）快路径自动作废**回落全量。迁移在 `bootstrap()`，先写分片后删旧键。
- 全量拉取用 `mergeLocalOnly()` 补本地独有条目；错误提示用 `tagCollection`+`describeCloudError`，别硬编码集合名。`mergeLocalOnly`/`migrateLocalToCloud` 补传成功后 `clearDirty`。
- **分页查询必须带 `orderedQuery`**（`orderBy('updatedAt','asc').orderBy('_id','asc')`）：skip 分页无序时跨页会漏条，而水位按 maxStamp 前进 → 漏掉的那条永久丢。`_id` 兜同毫秒并列（初始菜品没有 updatedAt）。`regression`/`store` 有断言。
- **首次上云走 `uploadLocalCollection` → 批量通道**（≥20 条），不再逐条 `upsertCloud`；服务端按 id 查重、一样新就跳过，所以 `flushDirtyUploads` 之后再跑一遍也只多几次调用。
- **菜品聚合一律按 `meal_records` 重算**（`dishStatsFromRecords`/`recomputeDish`），禁增量平均。`recomputeDish` bump updatedAt+markDirty；`recomputeAllDishStats()`（拉完自愈）**不动 updatedAt、不反写云端**，防两机互覆盖。
- `saveRecord` 带 `id` 即编辑（留 createdAt，换菜前后两道都回算）；记录页点某餐=编辑、长按=删除；列表页按 id 取数先建 `Map`。
- **`syncThen(cb)`** 是页面 onShow 标准写法（11 处已收口），`synced` 为真才回调；`reminders.js` 按失败走 `checkCloud()`，仍用裸 `syncFromCloud`。
- **同步水位回退 10 分钟**（`SYNC_STAMP_SAFETY_MS`）：`updatedAt` 用各机 `Date.now()`，慢机永远低于水位→静默丢数据。多拉幂等，`setSyncStamp` 取 max。
- ACL `PRIVATE`：dishes/meal_records/user_settings/reminders/daily_checkins/error_logs；feedbacks 是 ADMINONLY。
- 首页记住的菜 `wte_home_pick_v1`（只本机），只在抽签/改筛选/失效时换。
- **节日库 `utils/festival.js`**：节日 `food` 与 `line`（≤15 字）**二选一不共存**（wxml `wx:if`/`wx:elif`）；选中某天显示农历，本周块只显示公历。

## 设置与提醒
- `normalizeSettings()` 以 `DEFAULT_SETTINGS` 键/类型为准，不写白名单；`updatedAt` 保留但「加额度」不 bump。
- **`pushQuota` 只有云函数扣、客户端只能加**：写云时 `delete data.pushQuota`，加额度走 `db.command.inc`(`flushQuotaPending`)，离线增量攒 `wte_quota_pending_v1`，拉取取云端值。`user_settings` 每 openid 一份，取 `updatedAt` 最新并清多余（`readSettingsDoc`）。
- **额度无感自动补**：勾「总是保持以上选择」后同模板再调 `requestSubscribeMessage` 不弹窗直接 accept → +1。判据只有 `wx.getSetting({withSubscriptions:true})` 的 `itemSettings`，缓存 `wte_sub_state_v1`，`autoState()` 四态。`topUpIfNeeded()` 挂在首页 `handlePick`/`confirmDish`/`openCheckin`、记录页 `save`、签到页 `openToday`/`goForm`、签到表单 `save`；水位 `HIGH_WATER=60`、每小时封顶 40 次。**必须 tap 里同步调**，await 过网络报 `can only be invoked by user TAP gesture`（真机才见）。`reject`/`off` 只能 `wx.openSetting` 引导。
- 云函数扣额度也必须 `_.inc(-n)`（`spendQuota`），绝对值覆盖会盖掉期间用户新加的份额；43101 走 `clearQuota` 置 0。
- **索引**：各集合 `id`+`updatedAt` 必建；`error_logs` 建 `at`，`reminders` 另有 `nextTriggerDate`。**四个同步集合另需 `_openid+updatedAt` 复合索引**（querySince 只写 `updatedAt:gte`，`_openid` 服务端追加，单字段索引只命中一个）。**`_openid` 不是每集合自动建**（reminders/daily_checkins 实测为空）。建索引用 CloudBase MCP `writeNoSqlDatabaseStructure`；控制台「命中次数」是累计值。
- **普通提醒一律公历**（`calendar` 恒 solar），只有纪念日可选农历。存量 `legacyLunar` 编辑时保留农历语义。`computeLunarState(seed, today, noRoll)` 的 **noRoll 必传**（编辑不传会平移一年；农历八月十五 2026-09-25 → 2027-09-15），`regression.test.js` 有静态断言。教训：任何「新建时的智能调整」都要绕开存量数据。
- **页面 `data` 里别调 `today()`**（模块常驻、跨天失效；record-form 栽过）。时间一律 onLoad/onShow 现算。
- **跨月跟随**：`records.js`/`report.js` 的 `followCurrentMonth()` 在 onShow 跑，判据「当前看的月 == 上次进来时今天所在月」；`prevMonth`/`nextMonth` 置 `followToday=false`，`backToMonth` 置回 true；可翻范围锚点每次 onShow 重算。
- 记录页 `refresh()`=`buildMonthView()`+`paint(view,withCells)`；选中/取消走 `repaint()` 复用 `this.monthView`。**`paint` 里 `todayEmpty` 必须带 `&& !selected`**。
- 日历格：节日=亮蓝数字、纪念日=亮紫、有提醒=右上红点角标（纪念日不算；绝对定位不占格高，2rpx 白描边）。格子 `aria-label` 由 `labelBits` 拼：日期 + 今天 + 餐数 + 节日 + 纪念日 + 提醒（颜色/红点是纯视觉信息，只能靠它念出来）。月份标题右两个胶囊：`今`（非本月才出现）、`月`（有选中时）。
- **CSS 顺序坑**：「选中+今天+纪念日」撞一起时两规则特异性都是 (0,4,0)，**白字规则必须写在后面**（regression 有静态断言）。
- 卡片垂直间距统一 20rpx（含空态卡）；`section-label` 另用 34/14；records 日历态空态卡无条件带 `.month-empty`。

## 无障碍（aria）
- **状态写进 `aria-label` 文本，不依赖 `aria-selected`**（拼成「我的菜谱，已选中」）。`aria-role="tab"` 只担角色语义，Skyline 下支持度**未核实**，读不出也不丢信息；退路是改成 `button`。
- **`switch-wrap`（`catchtap="noop"`）不加 aria**：纯拦冒泡的壳，里面 `switch` 已有 label，加了反而多念一个空节点。
- `button`/`picker`/`switch`/`input`/`textarea`/`slider` 自带语义，不必加 `aria-role`。
- **无障碍不影响审核**（小程序不强制 aria，与 Web 的 WCAG 不同），纯体验项。现状：88 个 `aria-label`，78 个非原生可点元素全覆盖。

## 审核与合规
- **不得收集微信/QQ/手机号等 IM 账号**。2026-11-02 提审驳回（5.12），起因只是反馈页 placeholder 写了「微信号」——**文案出现这几个字就够判，标「选填」也没用**。现在只收 `email`，`regression.test.js` 第 ⑯ 组盯着三个文件。收集类字段必须写清目的，页脚补用途（5.12.1）。

## 云函数与触发器
- 三函数：`reminderPush`（Nodejs16.13/20s 定时推送）、`feedbackSubmit`（Nodejs20.19/20s）、`syncBatch`（Nodejs20.19/20s）。详见 `docs/deploy.md`。
- **运行时创建后不可改**，升级只能删了重建；**MCP 白名单只到 `Nodejs20.19`**。重建带环境变量的函数前先 `revealEnvValues:true` 读明文。**`reminderPush` 故意留 16.13**：触发器只能 IDE 图形上传，删了重建＝推送静默死亡。
- 部署优先级：① 改代码 `manageFunctions(action="updateFunctionCode", functionRootPath="D:/Personal/WhatToEat/cloudfunctions")`（秒级、不动触发器）；② 新建 `createFunction`（**无 `description` 字段**）；③ 超时**必须单独** `updateFunctionConfig`+顶层 `timeout`（默认 3 秒）。`tcb fn deploy` 会卡死。
- **`feedbackSubmit`**：写入走云函数不直写（集合缺失客户端报 -502005）；图片只收 `cloud://` 前缀。集合 ACL ADMINONLY。通知支持企微+飞书（`FEEDBACK_WEBHOOK`/`_SECRET`/`_TYPE` 按 host 认渠道）；**飞书签名 HMAC-SHA256(key="${timestamp}\n${secret}", data="")**，key 与 data 反着来；**成功判据看 body 的 errcode/code**，地址错时 HTTP 也 200。
- **`syncBatch`**：待传 ≥20 条走它，100 条一片；服务端 `id in [...]` 一次查重、按 `updatedAt` 判新旧、**每条按 OPENID 圈定并显式写 `_openid`**（云函数 add 不自动补）。白名单只收四个业务集合。**没部署也能用**：客户端拿 -501000 后本会话降级逐条。
- `reminderPush` 触发器**只能 IDE 图形上传**（右键 config.json）；CLI/控制台建的没有小程序上下文（send 报 -501001），CloudBase 侧 `triggers:[]` 正常。唯一判据 `tcb logs search -e <env>` 看周期性 `RetMsg: {"scanned":N}`。cron `0 */5 * * * * *` + `WINDOW_MINUTES=15`；**只有 43101/47003/40037 永久错误才写 lastPushed**。验证真发没发：临时挪云端 `time`+`pushQuota` 置 1，等一轮看 pushed/failed，**测完还原**。

## 订阅消息模板
- **`ACTIVE_TEMPLATE='compact'`**：3 关键词 `HcqoSxyPU44u5AItKZCKJVcBK9TWphDfbMmGwvh_oXM`（571，2026-10-30 重建版）；回退 `legacy` 5 关键词（槽位语义错位）。
- 槽位：`thing5`←content、`date4`←eventDate、`thing2`←timeNote。**`date4` 只认「2026年10月30日」**。关键词一不能漏（47003 一次只报一个），多余 key 被忽略；`newtmpllist` 报 -604100 别试。
- `utils/notify.js` 是模板结构唯一来源，`lib/notify.js` 是副本；换模板只改这两处 + 复制 + updateFunctionCode；**换完必须让用户重新点「额度+1」**（旧额度绑旧模板 → 43101）。40037 是永久错误。
- **`lastPushed` 必须在触发时刻变化时清空**（`saveReminder` 用 `triggerSignature` 比对），只改名/开关不清。

## 测试
- **12 套，改完必全跑**：`for t in store cloudpush engine pages checkin quotes festival pick report feedback regression syncbatch; do node .workbuddy/tests/$t.test.js; done`。`regression.test.js` 钉「改了不报错但行为变了」的分支。
- 测试在 `.workbuddy/tests/`，**不进 git、别删文件**（lodge 主动选的）。
- 云函数单测用 `Module._load` 拦 `wx-server-sdk`+假 db；改查询条件时**假库要同步加操作符**（in/gte/lt/inc/remove），否则测试假装通过。
- **`regression.test.js` 有断言对属性顺序过敏**：`/class="checkin-bar"[^>]*bindtap="openCheckin"/` 这类已改成 `[^>]*` 同标签内匹配（不跨标签）。**wxml 加属性前先想这几条**，否则测试红得莫名其妙。
- `instantiate()` 同一页面只能用一次，先 `delete require.cache[...]`；wxml 结构改动用静态断言守。

## 微信开发者工具
- stable 2.02.2608070，路径 `C:\Program Files (x86)\Tencent\微信web开发者工具`；Nightly ≥ 2.02.2608312 才有虚拟支付 skill。
- 启动：`env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS "./微信开发者工具.exe"`（必须非沙箱）；`ELECTRON_RUN_AS_NODE=1` 会空跑无窗口。
- **`cli.bat` 可以在 Git Bash 里直接调、有正常输出**（`"/c/Program Files (x86)/Tencent/微信web开发者工具/cli.bat" upload ...`）。2026-11-07 实测推翻旧结论「Git Bash 里完全没输出」——真正不能用的是**从 Bash 调 `cmd.exe`**，会被安全策略拦（bypasses command validation）。端口在 `User Data/2ca4252ffa87560ea1fd48b913e45179/Default/.ide`。**改 `packOptions.ignore` 必须 `cli.bat quit` 重启 IDE**（close+open 无效）。`preview` 放过未引用的坏 js，`upload` 不放过。**`cli upload` 只有 `-v`/`-d`/`-i` 三个参数，CLI 全表没有提审命令**（cloud/open/login/islogin/preview/auto-preview/upload/build-npm/auto/agent/reset-fileutils/close/quit/cache/engine/open-other/build-ipa/build-apk）——**设为体验版、提交审核只能人工在 mp 后台点**，个人主体也没有提审 API。上传前先 `cli.bat islogin` 要 `{"login":true}`；上传后包体积看 IDE 压缩值（本地源码口径约 1.7 倍）。

## 仓库与文档
- **版本号唯一来源 `utils/version.js`**（`APP_VERSION`），与 `cli upload -v` 一起改。**只有 lodge 明确说改版本号时才改**，不要每次改完代码顺手升一版——他 2026-11-06 明确要求过。
- 远程 `github.com/EchoHeim/WhatToEat` **公开**；`.workbuddy/memory/` 随仓库提交，`packOptions.ignore` 忽略整个 `.workbuddy`。仓库公开 → **记忆里不写凭据**。
- 代码风格：`.editorconfig` + `.prettierrc`（semi:false/singleQuote/printWidth:120/arrowParens:avoid/trailingComma:none/endOfLine:lf）；本机没装 prettier，走 `npx prettier@3.3.3`。**全项目尚有 45 个文件 `--check` 不通过**（store/reminder/各页 .json/sitemap…），历史遗留；要统一就单独做一次只改格式的提交，别混进功能 diff。
- 文档在 `docs/`：sync / data-model / reminder-engine / deploy / privacy。README 只留功能+选型+本地运行+索引。
- 图标脚本在 `.workbuddy/tools/`（源图 `mood-src/`），删了不可复现；本机 Python 有 Pillow，无 ImageMagick/ffmpeg。
- `utils/{reminder,lunar,notify}.js` ↔ `cloudfunctions/reminderPush/lib/` 是**手工副本**，改前端必须复制（`engine.test.js` 剔头注释逐字节比对）。
- 评审报告：`.workbuddy/reviews/2026-10-31-code-review.md`（P0/P1 已落地，剩隐私指引需人工核对）。
