# Browser Engine — 执行引擎与受管工作台核心

通过 Chrome DevTools Protocol (CDP) 同时支撑两套本地入口：
- **受管浏览器工作台（`:3460` + stdio MCP）**：`workbench.mjs` + `sessions.mjs` + `workflows.mjs` + `packages/browser-desktop`，提供 项目内独立 Profile 隔离、空闲自动休眠、进程/页面自愈、人工登录交接与断点任务恢复。
- **日常浏览器执行引擎（`:3456` + `be.mjs`）**：通过 `DevToolsActivePort` 连接日常 Edge / Chrome，提供稳定的 REST API 与 CLI 供单次探索、`Browser Intelligence` 录制分析及 `DemoRecorder` 网页视口录屏使用。

> 详细使用指南见仓库根目录 [README.md](../../README.md)、[受管工作台说明](../../docs/managed-workbench.md) 与 [执行引擎文档](../../docs/browser-engine.md)。

## 快速开始

### 1. 受管工作台（`:3460` + MCP）

```powershell
# 启动或复用 :3460 后台工作台（从仓库根目录运行）
npm run workbench:start

# 或在独立桌面外壳（「我的浏览器」）打开工作台页面
npm run workbench:open

# CLI / stdio MCP 调用
'{"includeMetrics":true}' | node packages/browser-engine/workbench-client.mjs browser_sessions
```

### 2. 日常浏览器引擎（`:3456`）

```powershell
# 前置：Chrome/Edge 开启远程调试（edge://inspect/#remote-debugging）
# 从 packages/browser-engine 或仓库根目录运行：
node packages/browser-engine/be.mjs preflight     # 预检本机调试端口与 :3456 状态
node packages/browser-engine/start.mjs           # 后台启动（传 --foreground 前台运行）
node packages/browser-engine/be.mjs reconnect    # 日常浏览器重启后按最新端口重连
```

## 核心模块分布

```text
packages/browser-engine/
├── workbench.mjs            # :3460 工作台服务、SSE 事件流与 MCP 工具实现
├── workbench-client.mjs     # stdio MCP 桥 & 命令行调用客户端
├── sessions.mjs             # 受管/附着会话生命周期、空闲休眠与内存指标采样
├── workflows.mjs            # 可恢复多步任务执行、后置校验与敏感字段脱敏
├── browsers.mjs             # DevToolsActivePort 发现、预检与受管实例拉起
├── desktop-control.mjs      # Electron 桌面外壳控制接口客户端
├── managed-appearance.mjs   # 受管 Chrome 名称/深绿主题配置与禁用账号同步
├── web/                     # :3460 管理界面静态资源
│
├── start.mjs · server.mjs · be.mjs  # :3456 引擎启动器、HTTP 服务与 CLI
├── core.mjs                 # CDP WebSocket（自动重连、onTarget/offTarget 事件隔离）
├── tabs.mjs · frames.mjs · wait.mjs # 标签生命周期、跨站 iframe 与精确等待
├── interact.mjs · page.mjs · pipeline.mjs  # 交互/脱敏表单/页面提取/页内 JS 编译
├── network.mjs · navigation.mjs · dialog.mjs  # 网络监控、导航留痕与非破坏弹窗处理
├── detect.mjs · accessibility.mjs · autoshot.mjs  # 障碍检测、无障碍树与操作截图
├── batch.mjs · stealth.mjs · profiles.mjs · tasks.mjs  # 并发/反检测/档案/持久化（目录锚定 runtime/）
└── demo-recorder.mjs        # CDP Screencast + FFmpeg 恒定帧率网页视口录像器
```

## `:3456` 主要 HTTP 端点

- **系统与连接**：`GET /health`（含 `endpoint` 预检信息）、`GET /help`、`POST /reconnect`
- **标签管理**：`GET /tabs`、`GET|POST /tabs/new`、`GET|POST /tabs/open`、`GET /tabs/close`、`GET /tabs/closeAll`、`GET /tabs/closeGroup`、`POST /tabs/navigate`、`GET /tabs/back|forward|reload|info`
- **交互**：`POST /eval`、`/click`、`/clickByText`、`/clickAt`、`/clickXY`、`/doubleClick`、`/rightClick`、`/hover`、`/safeClick`、`/type`、`/insertText`、`/fill`、`/fillForm`、`/pressKey`、`/hotkey`、`/scroll`、`/select`、`/checkbox`、`/upload`、`/drag`、`/actionability`
- **页面分析**：`POST /page/elements`、`/page/text`、`/page/forms`、`/page/links`、`/page/table`、`/screenshot`（`be.mjs shot` 默认写入 `work/screenshots/`）、`/pdf`
- **等待与状态**：`POST /page/waitElement`、`/page/waitText`、`/page/waitNetwork`、`/wait/*`、`/detect/*`
- **网络与存储**：`GET /network/monitor`、`/network/stop`、`POST /network/requests`（支持 `?target=`）、`GET /network/response`、`POST /network/intercept`、`GET|POST|DELETE /cookies`、`/storage`、`/session/export|import`、`GET /downloads`
- **高级能力**：`/frames/*`、`/shadow/*`、`/console/*`（按 `targetId` 隔离）、`/dialog/*`、`/accessibility/*`、`/autoshot/*`、`/nav/*`、`/profiles/*`、`/tasks/*`、`/batch/*`、`/pipeline`

## `:3460` MCP 工具概览

- **会话管理**：`browser_sessions`（支持 `includeMetrics: true`）、`browser_session_create`（支持 `idleTimeoutMinutes`）、`browser_session_attach`、`browser_session_start`、`browser_session_close`、`browser_session_request_human`、`browser_session_show_human`、`browser_session_resume_background`
- **页面与巡检**：`browser_pages`、`browser_page_open`、`browser_page_read`、`browser_page_focus`、`browser_page_screenshot`（支持桌面隐藏窗口离屏截屏与长页截图）、`browser_page_check`（默认 `1440px`/`390px` 横向溢出与裂图检测）、`browser_frames`、`browser_frame_read`、`browser_downloads`
- **可恢复任务**：`browser_tasks`、`browser_task_create`、`browser_task_get`、`browser_task_run`（支持内存 `values` 填入脱敏字段）、`browser_task_rebind`

## 离线测试

从仓库根目录运行：

```powershell
npm run check:engine
npm run test:engine
```
