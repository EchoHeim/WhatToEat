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

## 云函数与触发器（踩过的坑）
- `reminderPush` 的定时触发器**只能由微信开发者工具图形界面上传**（右键 `config.json` → 上传触发器）。IDE 的 CLI（`cli cloud functions deploy`）**没有触发器能力**，`cloud functions` 子命令只有 list / info / deploy / inc-deploy / download，也没有任何触发器参数。
- `tcb` CLI / 腾讯云控制台 / CloudBase MCP 建的触发器照样会按时调用，但**没有小程序云调用上下文**，`cloud.openapi.subscribeMessage.send` 报 `-501001 invalid wx openapi access_token`。排查先 `tcb api scf ListTriggers` 看触发器在不在、怎么来的。腾讯云开发社区 issue #1445 官方工程师的解法就是：删掉网页控制台配的触发器，改成 config.json 声明 + 用 IDE 随函数上传。
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
