# Browser Automation Workbench

Browser Automation Workbench 是一个本地优先的浏览器自动化工具集，用于把真实浏览器能力沉淀成可复用的操作、分析和内容提取流程。

它不是单一爬虫，也不是无人值守监控系统，而是一个面向人机协同的浏览器自动化工作台：用户在场时完成登录、判断和决策，工具负责执行、记录、复盘和结构化输出。

## 核心定位

```text
Browser Engine        = 执行层 / 手脚
Browser Intelligence  = 分析层 / 大脑
```

- **Browser Engine**：通过 Chrome DevTools Protocol 连接用户日常 Edge/Chrome，提供点击、输入、截图、网络、Cookie、Storage、任务持久化等 HTTP API。
- **Browser Intelligence**：基于 Engine 录制一次浏览过程，并把 trace、网络请求、页面结构和文本内容转成可复盘、可提取、可复用的任务资产。

## 当前能力

### Browser Engine

- 连接用户日常浏览器，天然携带登录态
- Tab 创建、关闭、导航、分组管理
- 点击、输入、快捷键、滚动、拖拽、上传、表单填写
- 页面文本、链接、表单、表格、元素、截图、PDF
- 网络请求监控、响应体读取、Cookie/Storage、下载跟踪
- iframe / Shadow DOM / dialog / accessibility snapshot
- 智能等待、自动截图、任务持久化、站点 profile

### Browser Intelligence

- `record`：录制人类浏览过程，输出 trace、页面文本、网络请求、截图和摘要
- `review`：分析 trace，识别 API 候选、稳定选择器、导航路径和自动化策略
- `extract`：从 trace 提取结构化内容，当前已验证小红书与通用页面
- 输出目录隔离，适合长期积累浏览任务资产

## 目录结构

```text
browser-automation-workbench/
├── README.md
├── package.json
├── docs/
│   ├── architecture.md
│   ├── getting-started.md
│   ├── browser-engine.md
│   ├── browser-intelligence.md
│   ├── workflows.md
│   ├── safety.md
│   └── roadmap.md
├── packages/
│   ├── browser-engine/
│   └── browser-intelligence/
├── examples/
└── scripts/
```

## 快速开始

前置条件：

- Node.js 22+
- Edge 或 Chrome 已开启远程调试

在 Edge 地址栏打开：

```text
edge://inspect/#remote-debugging
```

勾选：

```text
Allow remote debugging for this browser instance
```

启动 Engine：

```bash
npm run engine:start
```

检查上层工具：

```bash
npm run bi -- health
npm run bi -- paths
npm run bi -- record help
```

录制一次浏览：

```bash
npm run bi -- record start demo --url https://example.com
npm run bi -- record mark "页面加载完成"
npm run bi -- record stop
npm run bi -- review demo
npm run bi -- extract demo
```

## 设计原则

- **本地优先**：默认连接本机浏览器，输出写本地 `logs/`
- **人在回路**：不把账号登录、验证码、风控绕过做成无人值守自动化
- **最小侵入**：新建托管 tab，尽量不干扰用户已有页面
- **可复盘**：每次重要浏览都能生成 trace、review、extract
- **可扩展**：后续新增站点 profile、任务模板、extractor、pipeline，而不是重写底层 CDP

## 文档入口

- [架构说明](docs/architecture.md)
- [快速上手](docs/getting-started.md)
- [Browser Engine 说明](docs/browser-engine.md)
- [Browser Intelligence 说明](docs/browser-intelligence.md)
- [常见工作流](docs/workflows.md)
- [安全边界](docs/safety.md)
- [路线图](docs/roadmap.md)

## 当前状态

- Browser Engine：可用执行层，已有 HTTP API 与 CLI 快捷入口
- Browser Intelligence：v0.3.0，Recorder / Reviewer / Extractor 完成
- 测试：Browser Intelligence 76 pass / 0 fail

## GitHub 准备

推荐仓库名：`browser-automation-workbench`

推荐描述：

```text
Local-first browser automation workbench powered by CDP: execution engine, workflow recorder, trace reviewer, and content extractor.
```
