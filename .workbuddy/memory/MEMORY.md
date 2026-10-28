# WhatToEat 项目长期记忆

## 项目身份
- 「今天吃什么」小程序，AppID `wxc796aa4a0b4af49e`，云开发环境 `cloud1-d7gua1dxyb865738c`（个人版，ap-shanghai，2027-02 到期）。
- 原生 JS + Skyline 渲染 + glass-easel，全局自定义导航栏。**Skyline 对 CSS Grid 支持不完整，布局一律用 Flex**（日历、签到条带都是七等分 flex）。

## 云端管理方式（重要）
- 本机有 CloudBase CLI（`tcb`，3.8.9，位于 `~/.workbuddy/binaries/node/cli-connector-packages/`）**已登录**，可以直接管理云环境，不必让用户去控制台点鼠标。
- 常用：
  - 列集合 `tcb db nosql execute -e <envId> --command '[{"TableName":"_","CommandType":"COMMAND","Command":"{\"listCollections\":1,\"nameOnly\":true}"}]'`
  - 建集合 `"{\"create\":\"X\"}"`
  - 设权限 `tcb api tcb ModifyDatabaseACL --body '{"EnvId":"...","CollectionName":"X","AclTag":"PRIVATE"}'`（PRIVATE = 仅创建者可读写）
  - 核对 `tcb api tcb DescribeDatabaseACL`
- `tcb db nosql execute` **必须带 `-e <envId>`**，项目没有 `.cloudbase/project.json`，CLI 不会自动识别环境。

## 数据层约定（2026-10-29 重构后）
- `utils/store.js` 是唯一数据入口：**本地先写、云端排队补**，云失败不丢数据、不阻塞界面。
- 集合与权限全部「仅创建者可读写」（ACL `PRIVATE`）：`dishes` / `meal_records` / `user_settings` / `reminders` / `daily_checkins` / `error_logs`（异常上报用，2026-10-29 新建）。
- 四件套缺一不可，**顺序也是铁律**：
  1. **云写队列** `enqueueCloud(ctx, task)`——本地写完立刻返回，云端写串行排队；任务永远传「最新的本地版本」；失败走 `onCloudError` 回调（app.js 注册）提示「已存本机，云同步待重试」。页面里的 `await store.saveX()` 现在立刻返回，**别再 await 云端结果**。
  2. **待上云清单 outbox**（`wte_dirty_v1`）——本地写入先 `markDirty`，云写成功才 `clearDirty`；增量拉取看不见「本机独有数据」，靠它在同步开头补传。断网/杀进程都不怕。
  3. **删除墓碑**（`wte_tombstones_v1`）——本地删除那一刻就记（不是云写失败时），同步开头 `applyTombstones` 先清云端，防止「删掉的记录复活」。
  4. **增量同步**（`wte_sync_stamps_v1`）——每集合一个 `updatedAt` 水位，首次全量、之后 `gte(水位)` 增量；`mergeIncremental` 只处理变过的，本地没被提到的条目原样留着。
- **同步顺序**：补传 outbox → 清墓碑 → 补记额度 → 拉数据。反了就会丢本机新数据 / 复活已删记录 / 额度被盖。
- `pullCloudData` 全量时用 `mergeLocalOnly()`：云端没有的本地条目先补传，避免「集合缺失期间存的数据被空云端覆盖」。
- 错误提示按实际集合名生成（`tagCollection` + `describeCloudError(error, collection)`），不要再硬编码集合名。
- **菜品聚合（eatCount / score / lastEatDate）一律按 `meal_records` 重算，禁止再用增量平均**（`dishStatsFromRecords` + `recomputeDish`）。增删改三条路径共用一套重算。
  - `recomputeDish`（用户主动保存/删除时）会**顺带 bump 菜的 updatedAt + markDirty** → 云端那份过时会被增量同步带回来。
  - `recomputeAllDishStats()`（每次拉完的自愈）**刻意不动 updatedAt、不反写云端**，只纠本机，避免两台设备互相覆盖的抖动。
- `saveRecord` 带 `id` 即编辑（保留 `createdAt`，换菜时前后两道菜都回算），不带才是新增。记录编辑入口在 `pages/records` 点某一餐，长按仍是删除。
- 设置项不要写字段白名单：`normalizeSettings()` 以 `DEFAULT_SETTINGS` 的键与类型为准。**`updatedAt` 要保留**（设置冲突比新旧用），但「加推送额度」不能 bump 它。
- **`pushQuota` 只有云函数扣、客户端只能加**：客户端 `saveSettings` 写云时必须 `delete data.pushQuota`，加额度走 `db.command.inc` 原子自增（`flushQuotaPending`）；离线时把增量攒在 `wte_quota_pending_v1`，下次同步先补记再拉。拉取时额度一律取云端值（服务端才是记账方）。
- 云端 `user_settings` **每个 openid 一份**（不是重复文档）；客户端统一取 `updatedAt` 最新的那份并清掉多余的（`readSettingsDoc`），防同一账号出现两份导致额度记到不同文档。
- **页面首屏一律「先渲染本地缓存 → 后台 `syncFromCloud()` → 同步成功再 refresh」**，禁止把 `await store.syncFromCloud()` 放在首次 `setData` 之前。表单页同步回来后要用 `touched` 标记判断，别覆盖用户正在输入的内容。
- **首页显示哪道菜要记住**：`wte_home_pick_v1`（`store.getHomePick` / `saveHomePick`）只存本机、不参与云同步，属于界面状态不是业务数据。只有点「帮我选一个」、改筛选、或记住的那道被删/停用/不符合筛选时才换；「避开最近吃过」只约束抽签，不约束记住的那道。
- 列表页要按 id 取数据时**先建索引**（`new Map(dishes.map(d => [d.id, d]))`），别在循环里调 `store.getDish()`——那是整份菜库反序列化 + 线性查，记录页一次刷新能打上百次。

## 云函数与触发器（踩过的坑）
- `reminderPush` 的定时触发器**只能由微信开发者工具图形界面上传**（右键 `config.json` → 上传触发器）。IDE 的 CLI（`cli cloud functions deploy`）**没有触发器能力**，`cloud functions` 子命令只有 list / info / deploy / inc-deploy / download，也没有任何触发器参数。
- `tcb` CLI / 腾讯云控制台 / CloudBase MCP 建的触发器照样会按时调用，但**没有小程序云调用上下文**，`cloud.openapi.subscribeMessage.send` 报 `-501001 invalid wx openapi access_token`。腾讯云开发社区 issue #1445 官方工程师的解法就是：删掉网页控制台配的触发器，改成 config.json 声明 + 用 IDE 随函数上传。
- **别用 `tcb api scf ListTriggers` 判断触发器在不在（2026-10-28 修正）**：云开发的定时触发器不挂在 SCF 触发器列表里，`ListTriggers` 返回 `TotalCount:0 / Triggers:[]` 时触发器照样在跑（实测 2026-10-28 13:40/13:45/13:50 每 5 分钟一次 `Call succeeded`）。唯一判据是 `tcb logs search --query 'function_name:"reminderPush"' -e <env>` 看有没有按周期出现 `RetMsg: {... "scanned":N ...}`。`tcb fn log` 已废弃，别用。
- **`-501001` 不能拿来当判据**：`tcb fn invoke`、控制台「云端测试」、任何 API 手动调用都不带小程序上下文，必然报这个错，哪怕配置全对。唯一有效验证是「触发器真跑一次后看日志」。
- 部署云函数通道优先级（**2026-10-29 修正**）：
  1. **改代码直接走 CloudBase MCP**：`mcp__cloudbase__manageFunctions(action="updateFunctionCode", functionName="reminderPush", functionRootPath="D:/Personal/WhatToEat/cloudfunctions")` —— 秒级成功、包一定可用。**实测：纯改代码不会动触发器、也不会丢已登记的 openapi 权限**（2026-10-29 02:15 触发轮次 `pushed:1 failed:0`，真发出订阅消息）。所以「MCP 部署必须搭配 IDE CLI 登记权限」只在**从零创建函数**时成立，函数已存在时别碰 IDE CLI（它打的包在云端解不开：`require('./lib/reminder')` 报 Cannot find module）。
  2. 超时**必须单独改**：`updateFunctionCode` 不认 `func.timeout`，要用 `action="updateFunctionConfig"` + 顶层 `timeout`。**这个函数原来超时只有 3 秒**（`tcb fn detail` 才看得到），并发推送后调到 20 秒。
  3. IDE CLI `cli.bat cloud functions deploy --env <env> --names X --project <path> --remote-npm-install` —— 只在「新建函数、要把 openapi 权限登记上去」时用；它不建触发器，打的包也解不开。
- `tcb fn deploy` 会卡在依赖安装（实测 13 分钟无输出），别用。
- `config.json` 的 `triggers` cron 与云函数 `WINDOW_MINUTES` 要配合看：cron `0 */5 * * * * *`（5 分钟一轮）+ `WINDOW_MINUTES=15`（2026-10-29 起）= 临时失败当天还能再试两次；推成功写 lastPushed 挡住重复。**要改 cron 只能微信开发者工具图形界面上传触发器**（右键 config.json → 上传触发器），改 cron 时窗口要跟着放大（15 分钟 cron → 45 分钟窗口）。
- **推送失败分两类**（2026-10-29 改）：只有 43101（额度用完）/ 47003（模板参数错）这类永久错误才写 lastPushed；网络抖动等临时失败**故意不写**，等下一个窗口重试。以前一律写 lastPushed，网络抖一次当天就收不到。
- **验证推送有没有真的发出去**：把云端提醒的 `time` 临时挪到几分钟后 + 给对应 user_settings 文档 `pushQuota` 置 1，等一轮触发看日志 `pushed/failed`；**测完必须还原 `time` 和 `lastPushed`**（否则当天那次的推送会被 lastPushed 挡掉）。
- **2026-10-24 22:40 已实跑验证通过**：IDE 上传触发器后，`pushed:1 / failed:0`、`pushQuota` 8→7。所以"IDE 上传的触发器带小程序上下文"这条是成立的。

## 订阅消息模板字段（血泪）
- **模板关键词一个都不能漏**。缺哪个微信就报 `47003 argument invalid! data.XXX.value is empty`，而且**一次只报一个**，很容易误判成"只差一个字段"。
- **多余 key 会被微信忽略**（早先发的 `date2` 从不报错），所以排查时直接一次性填超集，别一轮一轮试（每轮要等 5 分钟触发器）。
- 当前模板 `HcqoSxyPU44u5AItKZCKJY_xnhIjZDPz_yHPeDBG2_c` 是 5 关键词的「日程提醒」模板，**映射已真机确认**（2026-10-24 收窄、10-25 截图复核五槽全对）：`thing5`=日程标题←`content`、`thing2`=提醒内容←`note`、`time25`=时间←`time`、`thing10`=地点←`eventDate`、`short_thing19`=日程类别←固定「用餐提醒」(`CATEGORY_TEXT`)。日历模板套用餐提醒，「地点」槽只能放日期。
- **换模板/对不上位置时的通用打法**：先用候选超集打通投递（多余 key 被忽略、不报错），再让用户截服务通知的图，把「当前映射的取值多重集」与「每行实际显示值」配对，带类型前缀的关键词（`time25`）能直接定位到时间槽，据此收窄后跑一轮复核。
- `cloud.openapi.wxaapi.newtmpllist` 想自助拉模板关键词列表 → `-604100`（接口权限未登记），别试。

## 测试
- **共 6 套，改完代码一定全跑**：
  - `node tests/store.test.js` —— 数据层回归（聚合增删改、离线场景、墓碑、增量同步、outbox、重复设置文档）
  - `node tests/cloudpush.test.js` —— 云函数推送（`Module._load` 打桩 wx-server-sdk + 固定时钟；覆盖临时失败不写 lastPushed、永久失败写标记、并发额度只结算一次）
  - `node tests/engine.test.js`（农历 + 提醒计算）、`node tests/pages.test.js`（提醒页 + 错误提示）、`node tests/checkin.test.js`（签到统计）、`node tests/quotes.test.js`（文案随机）
- 云函数逻辑要单测就用 `Module._load` 拦掉 `wx-server-sdk`，配一个假 db（支持 where/doc/update/remove + `command.inc/gt`），别真连云。

## 微信开发者工具怎么从命令行拉起（2026-10-24 打通）

装的是 **stable 2.02.2608070**，路径 `C:\Program Files (x86)\Tencent\微信web开发者工具`。

```bash
# 1) 启动 IDE（必须在非沙箱环境；且必须清掉这两个变量）
env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS "./微信开发者工具.exe"
# 2) 等 20~30 秒，看服务端口是否起来
netstat -ano | grep 15905            # 端口号由 IDE 自己写进 User Data/<hash>/Default/.ide
# 3) 调 CLI（每次都要 env -u NODE_OPTIONS）
env -u NODE_OPTIONS ./cli.bat islogin      # → {"login":true}
```

- **踩坑 1（致命）**：WorkBuddy 会话环境里有 `ELECTRON_RUN_AS_NODE=1`，任何 Electron 程序被这样拉起都会以 Node 模式运行 —— 进程活着但无窗口、无日志、无子进程。之前所有"IDE 卡住/起不来"都是它。
- **踩坑 2**：沙箱下 GPU 进程反复 `exit_code=-1073741819` → `GPU process isn't usable. Goodbye.` 直接带走主进程；`--disable-gpu` 拦不住，必须非沙箱启动。
- **不再需要**改 `WeappLocalData/localstorage_*.json` 里的 `enableServicePort`：端口开了 IDE 自己会在 `Default/.ide` 写端口号，CLI 自动发现。
- IDE 版本对得上角色设定里的 Nightly 要求还差一档（stable 2608070 < 2608312），虚拟支付相关 skill 要靠 Nightly。

## 上传代码包（2026-10-28 打过一遍）

```bash
# Git Bash 里 cli.bat upload 会报 "'C:\Program' 不是内部或外部命令"（内部子进程没加引号），
# 绕过：直接拿 Electron 跑 cli/index.js，效果等价
cd "/c/Program Files (x86)/Tencent/微信web开发者工具"
env -u NODE_OPTIONS ELECTRON_RUN_AS_NODE=1 "./微信开发者工具.exe" -e 'const e=process.argv[1],a=process.argv.slice(2).filter(x=>x!=="--electron");if(!process.env.cwd)process.env.cwd=process.cwd();process.argv=[process.execPath,"--ms-enable-electron-run-as-node",e,"--electron"].concat(a);require(e)' "./resources/app.asar.unpacked/js/common/cli/index.js" upload --project "D:/Personal/WhatToEat" -v 0.0.2 -d "描述" --info-output "C:/.../up.json"
# 成功标志是最后一行 "√ upload" + 体积表；exit=0
```

- **`packOptions.ignore` 改了必须 `cli.bat quit` 重启 IDE 才生效**，`close` + `open` 不管用（配置缓存在 IDE 主进程里）。
- **`preview` 会放过未引用的坏 js，`upload` 不会**：`memory-plugin/` 里那两个 DSH 插件源码是顶层 `return {...}`（非法模块），preview 能过、upload 直接 `× compile_start` 报 `Return statement is not allowed here`。已把它连同 README/LICENSE 一起写进 `packOptions.ignore`。
- 上传成功不会自动设为体验版，要去公众平台「版本管理 → 开发版本」手动设为体验版并扫码。
- 安全策略会拦 IDE 内部的 `reg.exe`，只影响收尾步骤，上传本身照样成功。

## 仓库与版本控制（2026-10-28 定）
- 远程 `github.com/EchoHeim/WhatToEat` 是**公开**仓库，但 lodge 明确要求 **`.workbuddy/memory/` 必须随仓库提交**——记忆文件当项目资料对待，不要自作主张再把它移出版本库。
- `.gitignore` 用 `.workbuddy/*` + `!.workbuddy/memory/`：只放行记忆，`preview/`、`tools/`、截图这类本地产物仍忽略。
- `packOptions.ignore` 里仍保留整个 `.workbuddy`，记忆不会被打进小程序代码包。
- 图标生成脚本都在 `.workbuddy/tools/`：`gen_tabbar_icons.py`（8 个 tabbar 图标，零依赖手工编码 PNG）、`gen_mood_icons.py`（16 个心情贴纸，源图在 `mood-src/`）。**删了不可复现**，目前不进仓库。
- **本机 Python 有 Pillow 13.0.0**（装在 `~/AppData/Roaming/Python/Python313/site-packages`，2026-10-29 实测可用），图像处理直接用 PIL，不用再手搓 PNG 字节。没有 ImageMagick / ffmpeg。
- 因为仓库公开，记忆里**不写凭据**（AppSecret、支付密钥、access_token、手机号等），只写做法与坑。
