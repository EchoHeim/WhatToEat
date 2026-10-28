# durable-memory 记忆插件 · 可安装源码包 (v2)

DSH 动态 Cordis 记忆插件，跨设备可重建版本。
- 10 个模型工具：memory_save / memory_update / memory_forget / memory_search /
  memory_recall_core / memory_list / memory_stats / memory_store_path /
  memory_export / memory_import
- 附带浏览器“记忆管理器”面板（注册在 cordis_run 卡片交互区）
- 存储：工作区根目录 `.dsh-memory.json`（可切换到云同步目录，见下文）

## 文件
- durable-memory-host.js —— code.host 的函数体（原样粘贴）
- durable-memory-client.js —— code.client 的函数体（原样粘贴）

## 在任意设备的 DSH 会话中安装（约 1 分钟）
1. 让该设备的 DSH 助手执行 cordis_define：
   - plugin.kind = "new"，idPrefix = "mem"（Host 会补唯一后缀）
   - code.host  = durable-memory-host.js 的完整内容
   - code.client = durable-memory-client.js 的完整内容
2. 用返回的 pluginId + packageId 执行 cordis_run（mode = "run"）。
   首次运行 Client 半边会在界面弹批准，点允许。
3. 完成。下次 DSH 重启后插件消失属正常（动态插件机制），
   重新执行步骤 1-2 即可；记忆数据文件保留并自动加载。

## 跨设备同步记忆
- 方案 A（共用一份）：把记忆库迁到云同步目录。
  对助手说：`memory_store_path {path: "D:/Sync/memory.json"}`，
  或在该插件 Run 卡片的记忆管理器里输入路径点“设为存储”。
  - 目标不存在 = 迁移过去并写本地指针自动跟随；
  - 目标已存在（另一台设备已用）= 采用远端那份。
  第二台设备装好本插件后做同样指向，即可共用一份记忆。
- 方案 B（搬运/备份）：`memory_export {path}` 导出 → 拷贝 →
  目标机 `memory_import {path, mode:"merge"}` 合入，或直接 store_path 采用。

## 说明与边界
- 动态 Cordis 插件为进程级实验机制：会话/进程内随时可改、可停（cordis_stop）、
  可删（cordis_undefine），不随 DSH 升级保留。
- 若要“开机常驻 + 升级保留”，需把它改写成产品级静态 cordis npm 包并用
  `dsh plugin add` 注册（要重启部署）——此为进阶路线，非本包范围。
- 分类：fact / preference / identity / project / task / decision / other
- 重要度 1-5（≥4 进入核心召回）；同 scope 同 topic 自动覆盖（历史保留 5 版）。
