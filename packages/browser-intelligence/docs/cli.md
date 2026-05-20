# CLI Manual

## 统一入口

Browser Intelligence 的统一 CLI 是：

```bash
node scripts/bi.mjs <command> [args...]
```

在项目目录中运行：

```powershell
node .\scripts\bi.mjs help
```

## CLI 分工

| CLI | 职责 |
|---|---|
| `bi.mjs` | Browser Intelligence 上层入口：文档、能力、健康检查、任务入口 |
| `browser-engine/be.mjs` | Browser Engine 底层快捷操作：打开、点击、输入、截图 |

`bi.mjs` 不替代 `be.mjs`，只在需要时代理少量安全命令。

## 基础命令

### help

```bash
node scripts/bi.mjs help
```

显示命令列表。

### version

```bash
node scripts/bi.mjs version
```

显示当前 CLI 版本和项目路径。

### paths

```bash
node scripts/bi.mjs paths
```

显示关键路径：

- Browser Intelligence 根目录
- Browser Engine 根目录
- logs 输出目录
- docs 目录

### docs

```bash
node scripts/bi.mjs docs
node scripts/bi.mjs docs cli
node scripts/bi.mjs docs capabilities
node scripts/bi.mjs docs api-map
node scripts/bi.mjs docs output-policy
```

输出对应文档路径。

### capabilities

```bash
node scripts/bi.mjs capabilities
```

按场景显示浏览器工具能力地图。

## 健康检查

```bash
node scripts/bi.mjs health
```

检查：

- Browser Intelligence 路径
- Browser Engine 路径
- logs 输出目录
- Browser Engine `/health`

Engine 未运行时，CLI 会提示启动方式，不会自动启动。

## Engine 代理命令

### engine health

```bash
node scripts/bi.mjs engine health
```

调用：

```text
GET http://127.0.0.1:3456/health
```

### engine help

```bash
node scripts/bi.mjs engine help
```

调用：

```text
GET http://127.0.0.1:3456/help
```

### engine tabs

```bash
node scripts/bi.mjs engine tabs
```

调用：

```text
GET http://127.0.0.1:3456/tabs
```

## Recorder 命令

Recorder MVP 用于记录一次人工浏览探索任务。它只做轻量编排，底层仍调用 Browser Engine。

### record start

打开新页面并开始记录：

```bash
node scripts/bi.mjs record start hangzhou-xhs --url https://www.xiaohongshu.com
```

接管已有 Browser Engine target：

```bash
node scripts/bi.mjs record start manual-flow --target TARGET_ID
```

启动后会创建：

```text
logs/browser-intelligence/traces/{task-id}/
├── trace.jsonl
├── notes.md
├── state.json
├── pages/
└── screenshots/
```

并尝试启用：

- 网络监控
- 导航追踪
- 自动截图
- 起始截图

### record mark

为当前记录追加人工标记：

```bash
node scripts/bi.mjs record mark "打开了搜索结果页"
```

标记会同时写入：

- `trace.jsonl`
- `notes.md`

### record status

查看当前是否存在活动记录：

```bash
node scripts/bi.mjs record status
```

### record stop

停止当前记录并导出总结材料：

```bash
node scripts/bi.mjs record stop
```

会尽力导出：

- 最终页面信息
- 页面文本
- 交互元素
- 网络请求摘要
- 导航历史
- 截图历史
- `summary.md`

## Review 命令

### review list

列出所有已记录的 trace：

```bash
node scripts/bi.mjs review list
```

### review \<taskId\>

对指定 trace 执行结构化分析，生成 `review.md`：

```bash
node scripts/bi.mjs review real-example-2
```

分析内容：

- 时间线与持续时间
- 网络请求分类（API / 静态 / 文档）
- API 候选端点提取
- 稳定选择器提取
- 自动化策略推荐（api-first / hybrid / ui-automation / needs-more-data）
- 建议下一步行动

## Extract 命令

### extract \<taskId\>

对指定 trace 的页面内容执行结构化提取，生成 `posts.json` + `extract.md`：

```bash
node scripts/bi.mjs extract xhs-browse-01
```

提取内容：

- 帖子结构（标题 / 正文 / 作者 / 标签 / 发布时间 / 互动数据）
- 内容分类（展览 / 活动 / 美食 / 社交 / 资源 / 游玩 / 生活）
- 时效性检测（截止日期 / 日期范围 / 相对时间 → urgency 分级）
- 杭州相关度评分（匹配杭州地标 / 区域 / 地点关键词）
- 平台自动识别（小红书 / 通用）
- **多帖子提取**：自动检测 Feed/搜索页，分割并独立解析每个帖子卡片
- API 端点标记（用于后续 API-first 策略）

输出文件：

- `posts.json` — 结构化提取结果，包含所有字段
- `extract.md` — 人类可读的提取报告

## 退出码

| 场景 | 退出码 |
|---|---:|
| 成功 | 0 |
| 参数错误 | 1 |
| Engine 不可访问 | 2 |

## 后续预留命令

未来可扩展：

```bash
node scripts/bi.mjs task list
node scripts/bi.mjs profile list
```

## 测试命令

```bash
npm test
npm run check
node scripts/bi.mjs docs testing
```
