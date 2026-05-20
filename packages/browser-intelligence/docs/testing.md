# Testing

## 定位

本文件记录 Browser Intelligence 的离线测试策略。

测试目标不是验证真实浏览器自动化效果，而是先锁住 CLI 和 Recorder 的安全边界：

- 不误开浏览器
- 不误写真实 logs
- 不留下错误状态文件
- 参数缺失时安全失败
- 无活动记录时安全失败
- 文档与命令入口保持一致

## 运行命令

```bash
npm test
npm run check
```

等价命令：

```bash
node --test ./tests/*.test.mjs
node --check ./scripts/bi.mjs
node --check ./scripts/lib/engine-client.mjs
node --check ./scripts/lib/format.mjs
node --check ./scripts/lib/paths.mjs
node --check ./scripts/lib/recorder.mjs
```

## 当前测试文件

```text
tests/
├── cli.test.mjs        # CLI 黑盒测试
├── recorder.test.mjs   # Recorder 模块边界测试
├── reviewer.test.mjs   # Reviewer 分析逻辑测试
└── extractor.test.mjs  # Extractor 内容提取测试
```

## 当前覆盖范围

### CLI 黑盒测试

覆盖：

- `help` 输出包含 core、engine、recorder 命令
- `version` 输出 `0.3.0`
- `docs cli` 能定位 CLI 文档
- `record status` 在无活动记录时安全返回
- `record start <id>` 缺少 `--url/--target` 时安全失败
- `record mark` 无活动记录时安全失败
- `record stop` 无活动记录时安全失败
- 未知命令返回清晰错误

### Recorder 模块测试

覆盖：

- `BI_LOGS_DIR` 测试环境变量生效
- `safeTaskId()` 清洗 task id
- `parseFlags()` 解析位置参数、值参数、布尔参数
- `taskPaths()` 输出路径落在 traces 目录
- active state 保存、读取、清理
- `markRecording()` 无 active state 时失败
- `stopRecording()` 无 active state 时失败

### Reviewer 模块测试

覆盖：

- `classifyRequest()` 正确区分 static / api / document
- `computeTimeline()` 从 trace 事件计算时间线
- `extractSelectors()` 从 pages.json 提取可见交互元素
- `generateRecommendation()` 四种策略（api-first / hybrid / ui-automation / needs-more-data）
- `reviewTrace()` 端到端生成 review.md
- `listTraces()` 列出已有 trace 目录
- 不存在的 taskId 正确抛错

### Extractor 模块测试

覆盖：

- `detectPlatform()` 识别小红书 / xhslink / 通用平台
- `extractXhsNoteId()` 从 /explore/ 和 /discovery/item/ URL 提取 noteId
- `parseEngagementNumber()` 解析纯数字、含逗号数字、空值
- `parseXhsText()` 提取标签、互动数据、发布时间、noteId、标题、正文
- `parseXhsNetwork()` 识别 XHS API 端点 vs 静态资源
- `scorePost()` 完整帖子高分 / 空帖子零分
- `categorizePost()` 7 类分类（展览/活动/美食/社交/资源/游玩/生活）+ 未分类 + 多分类优先级
- `detectTimeliness()` 截止日期、日期范围、即日起至、相对时间、无时间信号
- `scoreHangzhouRelevance()` 杭州关键词加权、非杭州零分
- `collectUrls()` 从 trace + pages 收集 URL
- `isXhsFeedPage()` 搜索页 / 探索页 / 首页 / 多互动模式检测 / 单帖子页排除
- `parseXhsFeedText()` 按互动分割多帖子 / 按作者 fallback 分割 / 空文本
- `extractContent()` 端到端 XHS 单帖 + XHS Feed 多帖 + Generic 提取、不存在 task 抛错

## 测试隔离策略

测试通过环境变量隔离输出目录：

```text
BI_LOGS_DIR=<system temp dir>
```

因此测试不会写入真实目录：

```text
logs/browser-intelligence/
```

## 当前测试结果

最近一次运行结果：

```text
tests 76
suites 19
pass 76
fail 0
```

## 真实浏览集成测试

经用户明确同意后，已执行一次最小真实浏览集成测试。

测试环境：

```text
Edge isolated profile + remote-debugging-port=9222
Browser Engine: http://127.0.0.1:3456
Test URL: https://example.com
Task ID: real-example-2
```

测试链路：

```bash
node scripts/bi.mjs record start real-example-2 --url https://example.com
node scripts/bi.mjs record mark "opened example.com for integration test"
node scripts/bi.mjs record stop
```

结果：

```text
record start: OK
record mark: OK
record stop: OK
Final URL: https://example.com/
Network requests: 1
Screenshots: 2
```

输出目录：

```text
logs/browser-intelligence/traces\real-example-2\
```

已确认生成：

- `trace.jsonl`
- `notes.md`
- `state.json`
- `pages.json`
- `network.json`
- `summary.md`
- `screenshots/`

## 仍未覆盖范围

以下内容需要更复杂的真实网站流程，当前最小集成测试不覆盖：

- `record stop` 在真实页面下导出的 `pages.json`、`network.json`、`summary.md` 质量
- 多页跳转、登录态页面、表单提交、懒加载内容
- 需要人工验证或反自动化风控的网站
- 将 trace 转换为 API-first 或 UI automation 方案的 AI 复盘质量

这些应放到后续真实场景测试中执行，执行前需要用户明确确认。
