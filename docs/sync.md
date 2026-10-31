# 同步与数据流

## 数据流

`utils/store.js` 是唯一数据入口，页面不直接调 `wx.cloud`：

```
页面 → store（本地 storage 先写）→ 云数据库（异步补同步）
                                ↘ 失败：保留本地 + 可读错误提示
```

所有页面统一「先渲染本地缓存 → 后台 `syncFromCloud()` → 同步成功再 refresh」，不把网络请求挡在首屏之前。

## 纯函数引擎

- `utils/lunar.js` 农历换算，覆盖 1900–2100，含 2020–2035 全量公历↔农历往返校验
- `utils/reminder.js` 提醒触发计算：给定一条提醒与日期区间，算出全部事件日与触发日
- `utils/checkin.js` 连续天数、14 天条带、心情分布与概览模型
- `utils/festival.js` 节日库：农历 / 节气 / 公历 / 浮动节日、自定义纪念日命中，与「本周还剩哪些日子」
- `utils/reminder.js` 里还有 `isAnniversary` / `anniversaryNotify` / `anniversaryHit`：纪念日判定、要不要推送、落在哪一天（云函数用前两个决定推不推）

四者都不依赖小程序 API，可以直接在 Node 里回归。`festival.js` 只在客户端用，不用同步到云函数。`lunar.js` 与 `reminder.js` 在云函数里各有一份副本（`cloudfunctions/reminderPush/lib/`），**改完必须同步复制**，否则小程序端和云端对触发日的判断会不一致。
