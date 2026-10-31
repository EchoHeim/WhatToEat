# 数据模型

## 目录

```text
WhatToEat/
├── app.js / app.json / app.wxss
├── components/
│   └── navigation-bar/        自定义导航栏
├── images/moods/              16 个心情贴纸（96×96 透明 PNG8，共 58KB）
├── custom-tab-bar/            仅占位：Skyline 下组件宿主的命中区与 fixed 不一致
│                              （框架硬性要求在根目录，不能挪进 components/）
├── styles/tabbar.wxml         悬浮玻璃 tabBar 模板（各 tab 页 import）
├── styles/tabbar.wxss         悬浮条样式（各 tab 页 @import）
├── pages/
│   ├── index/                 首页：筛选 + 随机
│   ├── dishes/                菜品库
│   ├── dish-form/             新建 / 编辑菜品
│   ├── dish-detail/           菜品详情
│   ├── records/               吃饭日历（一天一卡）
│   ├── record-form/           记录 / 修改一餐
│   ├── checkins/              心情统计与历史
│   ├── checkin-form/          写心情
│   ├── reminders/             提醒列表
│   ├── reminder-form/         新建 / 编辑提醒
│   ├── report/                月度饮食报告
│   └── profile/               个人资料与统计
├── cloudfunctions/
│   └── reminderPush/
│       ├── index.js           扫描待推送提醒并下发订阅消息
│       ├── config.json        openapi 权限 + 定时触发器
│       └── lib/               农历 / 提醒引擎副本、模板配置
├── utils/
│   ├── store.js               唯一数据入口：本地缓存 + 云端 CRUD
│   ├── lunar.js               农历换算
│   ├── reminder.js            提醒触发计算
│   ├── checkin.js             连续天数与心情统计
│   ├── pick.js                加权抽签（评分 / 间隔 / 频次）
│   ├── report.js              月度报告统计（最常吃 / 走势 / 口味）
│   ├── quotes.js              签到页顶部随机古诗词（400 句）
│   ├── tabbar.js              悬浮 tabBar 的数据与跳转
│   └── subscribe.js           订阅消息封装
└── .workbuddy/tests/        10 套回归测试（仅本地，不进仓库；node .workbuddy/tests/<name>.test.js）
    ├── engine.test.js         农历 + 提醒计算
    ├── checkin.test.js        签到与心情统计
    ├── store.test.js          记录增删改与菜品聚合、时间字段
    ├── quotes.test.js         句子库数量 / 长度 / 随机不连重
    ├── pages.test.js          记录页 / 提醒页逻辑
    ├── festival.test.js       节日库命中与「本周还剩哪些日子」
    ├── pick.test.js           加权抽签：因子方向与分布偏移
    ├── report.test.js         月度报告：统计口径与被删菜品
    ├── cloudpush.test.js      云函数推送：额度结算、失败分类、索引扫描
    └── regression.test.js     易碎行为：表单跨天、异常上报去重、记录页月模型复用
```

## 云开发集合

| 集合             | 用途                                        |
| ---------------- | ------------------------------------------- |
| `dishes`         | 菜品                                        |
| `meal_records`   | 饮食记录（`date` + 具体时间 `time`，`HH:mm`） |
| `user_settings`  | 偏好设置、昵称、头像地址、推送额度          |
| `reminders`      | 日期提醒                                    |
| `daily_checkins` | 每日心情与随笔（`diet` 为旧版兼容字段，不再写入、也不再展示） |
| `error_logs`     | 未捕获异常与 Promise 拒绝（客户端每 7 天惰性清理 30 天前的记录；不建这个集合也不影响主流程） |
| `feedbacks`      | 意见反馈（只由云函数 `feedbackSubmit` 写入，客户端不直接写） |

每条数据由云开发自动附加 `_openid`，权限一律「仅创建者可读写」。

## 建议手动建的索引

云开发只给 `_id` 建索引，`where` 里用到的其他字段默认都是全表扫。集合还是几十条时感觉不到，攒到几千条就是同步变慢、甚至超时的来源。控制台 → 数据库 → 选中集合 → 索引管理 → 添加索引：

| 集合             | 索引字段（按顺序）              | 谁在用                                     |
| ---------------- | ------------------------------- | ------------------------------------------ |
| `dishes`         | `id` 升序                       | `upsertCloud` 按业务 id 查重               |
| `dishes`         | `updatedAt` 升序                | 增量拉取的 `where({ updatedAt: gte })`     |
| `dishes`         | **`_openid` 升序 + `updatedAt` 升序** | 同上。ACL 会在查询里追加 `_openid`，见下条 |
| `meal_records`   | `id` 升序、`updatedAt` 升序     | 同上（记录量最大，这几个最值得先建）       |
| `meal_records`   | **`_openid` 升序 + `updatedAt` 升序** | 增量拉取                               |
| `reminders`      | `id` 升序、`updatedAt` 升序     | 同上                                       |
| `reminders`      | **`_openid` 升序 + `updatedAt` 升序** | 增量拉取                             |
| `reminders`      | `enabled` 升序 + `nextTriggerDate` 升序 | 云函数每 5 分钟筛「今天该响的」     |
| `daily_checkins` | `id` 升序、`updatedAt` 升序     | 同 dishes                                  |
| `daily_checkins` | **`_openid` 升序 + `updatedAt` 升序** | 增量拉取                             |
| `user_settings`  | `updatedAt` 降序                | 取最新那份（历史上有过重复文档）           |
| `error_logs`     | `at` 降序                       | 惰性清理 `where({ at: lt })`               |
| `feedbacks`      | `at` 降序                       | 控制台按时间倒序翻反馈                     |

几点注意：

- 建索引前先 `count()` 看一眼规模。几十条的话收益为零，还不如不折腾。
- 索引是异步构建的，点完等几十秒再测。
- 建议先都用**普通索引**。`id` 想设唯一索引的话，先确认历史数据里没有同 id 的两份（早年两端各 `add` 过一次就会重复），否则会建失败。
- 复合索引的字段顺序要跟查询条件一致：`where({ enabled: true, nextTriggerDate: _.lte(今天) })` 对应 `enabled` 在前、`nextTriggerDate` 在后。**不过 `nextTriggerDate` 已经有单字段索引了，这条是可选项**——剩下那点 `enabled` 过滤在内存里做，几十条数据感觉不出来。
- `_openid` 索引多数集合由云开发自动建，但**后建的集合实测没带上**（`reminders`、`daily_checkins` 都是空的），缺了就手动补一个。它是 ACL「仅创建者可读写」的过滤字段，少了等于每次查询都全表扫。
- **`_openid` + `updatedAt` 必须建成复合索引，两个单字段索引顶不住。** 客户端查询只写了 `where({ updatedAt: gte })`，但 ACL 是服务端追加 `_openid` 条件的，MongoDB 一次只能用一条索引——只有单字段索引时它选一个、另一个字段靠遍历过滤。开发者工具 Console 会直接弹「快速创建索引链接」提醒，看到就照建。
- 这套不用手点：CloudBase MCP 的 `writeNoSqlDatabaseStructure`（`action=updateCollection` + `updateOptions.CreateIndexes`）能一次建多个，`readNoSqlDatabaseStructure` 的 `listIndexes` 用来核对。2026-10-30 已按上表落地单字段索引，2026-10-31 补齐四个集合的 `_openid_1_updatedAt_1` 复合索引。
