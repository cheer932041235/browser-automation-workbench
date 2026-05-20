# API Map

## 定位

本文件不是完整 API 文档的复制版，而是 Browser Intelligence 使用 Browser Engine 的能力映射。

完整底层 API 查看：

```bash
curl -s http://127.0.0.1:3456/help
```

或阅读：

```text
packages/browser-engine/SKILL.md
```

## 能力映射

| Browser Intelligence 能力 | Browser Engine API | 用途 |
|---|---|---|
| 健康检查 | `/health` | 判断引擎是否运行、浏览器是否连接 |
| API 发现 | `/help` | 获取端点分类 |
| Tab 列表 | `/tabs` | 查看当前可操作页面 |
| 新建页面 | `/tabs/new` | 打开任务入口页 |
| 页面信息 | `/tabs/info` | 获取 title/url 状态 |
| 页面文本 | `/page/text` | 生成页面快照和 AI 上下文 |
| 交互元素 | `/page/elements` | 找按钮、输入框、链接 |
| 无障碍快照 | `/accessibility/snapshot` | 更稳定的页面结构理解 |
| 点击 | `/click`、`/clickByText`、`/clickAt`、`/safeClick` | 页面操作 |
| 输入 | `/fill`、`/type`、`/insertText` | 表单填写 |
| 等待 | `/wait/*`、`/page/wait*` | 提升稳定性 |
| 网络监控 | `/network/monitor`、`/network/requests` | 分析 API 候选 |
| 响应读取 | `/network/response` | 检查关键响应 |
| 截图 | `/screenshot`、`/autoshot/*` | 保存证据 |
| 导航追踪 | `/nav/*` | 记录页面跳转 |
| Console 日志 | `/console/*` | 调试页面错误 |
| iframe | `/frames/*` | 穿透嵌套页面 |
| Shadow DOM | `/shadow/*` | 处理 Web Components |
| 弹窗 | `/dialog/*` | 避免 alert/prompt 阻塞 |
| 页面检测 | `/detect/*` | 检查登录墙、验证码、弹窗 |
| 批量 | `/batch/*` | 低频并发采集或批处理 |
| Pipeline | `/pipeline` | 固定多步流程压缩执行 |
| 任务 | `/tasks/*` | 长任务断点恢复 |
| Site Profile | `/profiles/*` | 机器可读站点知识 |

## 第一阶段 CLI 使用的 API

`bi.mjs` 第一版只使用只读或低风险 API：

```text
GET /health
GET /help
GET /tabs
```

目的：

- 避免过早引入副作用
- 先把文档和统一入口打稳
- 为后续 Recorder 和任务系统留接口

## 后续 Recorder 可能使用的 API

```text
GET  /network/monitor?target=ID
POST /nav/enable?target=ID
POST /autoshot/enable?target=ID
POST /page/text?target=ID
POST /page/elements?target=ID
POST /network/requests
GET  /nav/history?target=ID
GET  /autoshot/history?target=ID
```

Recorder 输出仍然写入：

```text
logs/browser-intelligence/
```
