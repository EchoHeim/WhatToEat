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

## 数据层约定
- `utils/store.js` 是唯一数据入口：本地 storage 先写、云数据库后同步，云失败一律降级本地并给可读错误。
- 集合与权限全部「仅创建者可读写」（ACL `PRIVATE`）：`dishes` / `meal_records` / `user_settings` / `reminders` / `daily_checkins`。
- `pullCloudData` 用 `mergeLocalOnly()` 合并：云端没有的本地条目先补传，避免「集合缺失期间存的数据被空云端覆盖」。
- 错误提示按实际集合名生成（`tagCollection` + `describeCloudError(error, collection)`），不要再硬编码集合名。
- **菜品聚合（eatCount / score / lastEatDate）一律按 `meal_records` 重算，禁止再用增量平均**（`dishStatsFromRecords` + `recomputeDish`）。增删改三条路径共用一套重算；`pullCloudData` 末尾还会 `recomputeAllDishStats()` 本地自愈一次，只纠本机不反写云端，避免同步抖动。
- `saveRecord` 带 `id` 即编辑（保留 `createdAt`，换菜时前后两道菜都回算），不带才是新增。记录编辑入口在 `pages/records` 点某一餐，长按仍是删除。
- 设置项不要写字段白名单：`normalizeSettings()` 以 `DEFAULT_SETTINGS` 的键与类型为准，新增设置项只改这一处，云端缺字段自动落回默认值。
- **页面首屏一律「先渲染本地缓存 → 后台 `syncFromCloud()` → 同步成功再 refresh」**，禁止把 `await store.syncFromCloud()` 放在首次 `setData` 之前——`wx.cloud` 一次全量拉取要 1~2 秒，挡在前面就是白屏。表单页同步回来后要用 `touched` 标记判断，别覆盖用户正在输入的内容。

## 云函数与触发器（踩过的坑）
- `reminderPush` 的定时触发器**只能由微信开发者工具图形界面上传**（右键 `config.json` → 上传触发器）。IDE 的 CLI（`cli cloud functions deploy`）**没有触发器能力**，`cloud functions` 子命令只有 list / info / deploy / inc-deploy / download，也没有任何触发器参数。
- `tcb` CLI / 腾讯云控制台 / CloudBase MCP 建的触发器照样会按时调用，但**没有小程序云调用上下文**，`cloud.openapi.subscribeMessage.send` 报 `-501001 invalid wx openapi access_token`。腾讯云开发社区 issue #1445 官方工程师的解法就是：删掉网页控制台配的触发器，改成 config.json 声明 + 用 IDE 随函数上传。
- **别用 `tcb api scf ListTriggers` 判断触发器在不在（2026-10-28 修正）**：云开发的定时触发器不挂在 SCF 触发器列表里，`ListTriggers` 返回 `TotalCount:0 / Triggers:[]` 时触发器照样在跑（实测 2026-10-28 13:40/13:45/13:50 每 5 分钟一次 `Call succeeded`）。唯一判据是 `tcb logs search --query 'function_name:"reminderPush"' -e <env>` 看有没有按周期出现 `RetMsg: {... "scanned":N ...}`。`tcb fn log` 已废弃，别用。
- **`-501001` 不能拿来当判据**：`tcb fn invoke`、控制台「云端测试」、任何 API 手动调用都不带小程序上下文，必然报这个错，哪怕配置全对。唯一有效验证是「触发器真跑一次后看日志」。
- 部署云函数通道优先级：
  1. CloudBase MCP `mcp__cloudbase__manageFunctions`（action=`updateFunctionCode` + `functionRootPath`）—— 秒级成功、包一定可用，但**不带 `permissions.openapi`、不建触发器**。
  2. IDE CLI `cli.bat cloud functions deploy --env <env> --names X --project <path> --remote-npm-install` —— 19 秒成功、按官方流程登记 openapi 权限，但**不创建 config.json 里的触发器**，且实测**打的包在云端解不出来**（`require('./lib/reminder')` 报 Cannot find module，`Duration:0 MemUsage:0`；同一份代码用 MCP 推就正常，问题在 IDE 打包）。
  3. 所以两者要**搭配**：IDE CLI 上传登记权限 → 再用 MCP 把代码补成能跑的版本。
- `tcb fn deploy` 会卡在依赖安装（实测 13 分钟无输出），别用。
- `config.json` 的 `triggers` cron 与云函数 `WINDOW_MINUTES` 必须对齐（当前 `0 */5 * * * * *` ↔ 5 分钟窗口）。
- **2026-10-24 22:40 已实跑验证通过**：IDE 上传触发器后，`pushed:1 / failed:0`、`pushQuota` 8→7。所以"IDE 上传的触发器带小程序上下文"这条是成立的。

## 订阅消息模板字段（血泪）
- **模板关键词一个都不能漏**。缺哪个微信就报 `47003 argument invalid! data.XXX.value is empty`，而且**一次只报一个**，很容易误判成"只差一个字段"。
- **多余 key 会被微信忽略**（早先发的 `date2` 从不报错），所以排查时直接一次性填超集，别一轮一轮试（每轮要等 5 分钟触发器）。
- 当前模板 `HcqoSxyPU44u5AItKZCKJY_xnhIjZDPz_yHPeDBG2_c` 是 5 关键词的「日程提醒」模板，**映射已真机确认**（2026-10-24 收窄、10-25 截图复核五槽全对）：`thing5`=日程标题←`content`、`thing2`=提醒内容←`note`、`time25`=时间←`time`、`thing10`=地点←`eventDate`、`short_thing19`=日程类别←固定「用餐提醒」(`CATEGORY_TEXT`)。日历模板套用餐提醒，「地点」槽只能放日期。
- **换模板/对不上位置时的通用打法**：先用候选超集打通投递（多余 key 被忽略、不报错），再让用户截服务通知的图，把「当前映射的取值多重集」与「每行实际显示值」配对，带类型前缀的关键词（`time25`）能直接定位到时间槽，据此收窄后跑一轮复核。
- `cloud.openapi.wxaapi.newtmpllist` 想自助拉模板关键词列表 → `-604100`（接口权限未登记），别试。

## 测试
- `node tests/engine.test.js`（农历 + 提醒计算）、`node tests/pages.test.js`（提醒页 + 错误提示）、`node tests/checkin.test.js`（签到统计）。改完代码一定跑这三套。

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
