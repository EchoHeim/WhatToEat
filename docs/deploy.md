# 部署与排障

## 部署推送链路

1. 微信公众平台申请模板（服务类目要先配好，公共模板库按类目展示），记下模板 ID 与关键词列表
2. 模板只改一处：`utils/notify.js` 里的 `TEMPLATES` 与 `ACTIVE_TEMPLATE`，改完**复制到 `cloudfunctions/reminderPush/lib/notify.js`** 再部署。模板 ID、槽位、槽位文案都由这一份派生，`config.js` 与小程序端不再各抄一遍
3. 开发者工具里上传部署云函数，再右键 `config.json` → **上传触发器**

两个容易踩的坑：

- **模板关键词一个都不能漏**。缺哪个微信就报 `47003 argument invalid! data.XXX.value is empty`，而且一次只报一个，容易误判成只差一个字段。多余 key 会被忽略，排查时可以直接填超集
- **触发器只能用微信开发者工具上传**。`tcb` CLI、腾讯云控制台、CloudBase 等方式建的触发器虽然同样按时调用，但缺少小程序云调用上下文，`cloud.openapi` 一律返回 `-501001 invalid wx openapi access_token`

当前生效的是 3 关键词的「日程提醒」模板（`thing5` 标题 / `date4` 日程时间 / `thing2` 提醒内容），在 `utils/notify.js` 的 `TEMPLATES.compact` 里。`TEMPLATES.legacy` 保留了之前那套 5 关键词模板作对照，注释里记着 2026-10-29 换模板踩到的 `40037 invalid template_id`。

两个备份细节：

- **换模板后必须让用户重新点「额度+1」**。一次性订阅的授权绑模板 ID，旧额度对新模板无效，不重新授权会直接 `43101`
- **`engine.test.js` 会比对 `utils/` 与云端 `lib/` 的 reminder / lunar / notify 三份副本**。改了本地忘了复制，测试会红——这是唯一能拦住「本地对、线上错」的地方

## 定时触发器：仓库和云端都看不见它

`reminderPush` 的 timer 触发器**只存在于微信开发者工具里**，它既不在本仓库、也不在 CloudBase 控制台的函数详情里（`getFunctionDetail` 返回的 `Triggers` 是 `[]`，这是正常的，不是故障）。

后果很实在：**换环境、重装环境、换一台电脑导入项目之后，这一项没法从代码重建，只能靠人记得去 IDE 里右键上传。**

重建步骤：

1. 开发者工具里选中 `cloudfunctions/reminderPush`
2. 右键目录 → 上传并部署（云端安装依赖）
3. 右键 `config.json` → **上传触发器**

cron 是 `0 */5 * * * * *`（每 5 分钟），和 `WINDOW_MINUTES=15` 的窗口配合。**改 cron 也只能走这一步**，改完记得把窗口一起放大。

验证它真的在跑（唯一的可靠判据）：

```bash
tcb logs search --query 'function_name:"reminderPush"' -e <envId>
```

看有没有周期性出现的 `RetMsg: {"scanned":N}`。两个「看着能查、其实什么都说明不了」的坑：

- `tcb api scf ListTriggers` 返回 0 条**也照样可能在跑**，不能当判据
- `invokeFunction` / 控制台手动测试**必然**报 `-501001`，因为调用不带小程序上下文，与触发器无关

## 三个云函数

| 函数 | 运行时 | 超时 | 干什么 |
| --- | --- | --- | --- |
| `reminderPush` | Nodejs16.13 | 20s | 5 分钟定时扫一遍提醒并推送 |
| `feedbackSubmit` | Nodejs20.19 | 20s | 反馈入库 + 群机器人通知 |
| `syncBatch` | Nodejs20.19 | 20s | 批量补传，一次最多 200 条 |

`syncBatch` 是客户端补传的加速通道：**没部署也能正常用**，`utils/store.js` 会在第一次调用失败后判定它不可用，整轮退回逐条的旧通道（慢，但结果一样）。想在 CloudBase 连接器里重建它，用 `manageFunctions(action="createFunction")` 配 `functionRootPath` 指向本仓库的 `cloudfunctions/`，**超时单独设 20 秒**（默认 3 秒，200 条写不完）。

## 运行时升级：只能删了重建

**运行时是创建时锁死的，改不了。** 腾讯云 SCF `UpdateFunctionConfiguration` 接口文档原文：

> Runtime：函数运行环境，**创建时指定，目前不支持修改**。

所以没有「改个配置项」这种便宜事，升级 = **删除函数 + 用新运行时重建**。重建前先算清会丢什么：

| 函数 | 会丢 | 重建代价 |
| --- | --- | --- |
| `syncBatch` | 无 | 最低，直接删了重建 |
| `feedbackSubmit` | 环境变量 `FEEDBACK_WEBHOOK` | 中，重建前必须先读回明文（见下） |
| `reminderPush` | **定时触发器** | 最高，触发器只能 IDE 图形上传，忘了传＝推送静默死亡 |

### 重建带环境变量的函数

脱敏接口只返回 `***` 和字符长度，拿不到值。先读明文再删：

```text
queryFunctions(action="getFunctionDetail", functionName="feedbackSubmit", revealEnvValues=true)
```

当前只有 `FEEDBACK_WEBHOOK` 一项（飞书群机器人地址，81 字符），没有 `FEEDBACK_WEBHOOK_SECRET`（那个机器人没开签名校验）。重建后核对 `ValueLength` 仍是 81 即为无损；**值不要写进仓库，这个 repo 是公开的**。

### 运行时版本与 MCP 的限制

- CloudBase 官方《运行环境支持》里，Nodejs16.13 的状态仍然是「**可用**」，没下线。过期的是**上游**：Node.js 16.x 于 2023-09-11 EOL、18.x 于 2025-04-30 EOL、20.x 也已 EOL，只有 22.x / 24.x / 26.x 还在维护。所以还留在 16.13 不是「平台不给用」，是「拿不到安全补丁」。
- **CloudBase MCP（v2.36.2）的运行时白名单只到 `Nodejs20.19`**，传 `Nodejs24.11` 会直接报「不支持的运行时」。想要更高版本得走控制台或 CLI，别在 MCP 上反复试。

### `reminderPush` 为什么还没升

它带定时触发器，而触发器只能用微信开发者工具右键 `config.json` 图形上传（见上一节）。删了重建拿不到触发器，推送会**无声无息地停掉**——没有任何报错，等发现时是用户说「我没收到提醒」。

所以它留在 16.13，等下一次本来就要打开 IDE 发版时一起做，做完必须用日志确认 `scanned` 还在周期性出现。

