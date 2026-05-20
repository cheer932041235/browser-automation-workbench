# Developer Guide

## 项目分层

Browser Intelligence 不直接实现 CDP。它只做上层组织和编排。

```text
browser-engine/          底层 CDP 和 HTTP API
browser-intelligence/    上层文档、CLI、任务、Profile、Recorder
logs/browser-intelligence/ 运行输出
notes/                   长期知识沉淀
```

## 开发原则

### 1. 不重复造 Browser Engine

如果 Browser Engine 已经有 API，就通过 HTTP 调用它。

优先使用：

- `/health`
- `/help`
- `/tabs`
- `/page/text`
- `/network/requests`
- `/autoshot/*`
- `/nav/*`
- `/profiles/*`

不要在 Browser Intelligence 中重新实现：

- CDP WebSocket 连接
- Tab 生命周期
- 页面点击/输入
- 网络事件捕获
- iframe 穿透
- 截图底层逻辑

### 2. CLI 是上层入口

`bi.mjs` 的职责：

- 帮用户发现能力
- 统一文档入口
- 检查环境和输出目录
- 调用少量 Browser Engine 状态 API
- 为后续 record/task/profile 命令预留结构

`be.mjs` 的职责仍然是底层浏览器快捷操作。

### 3. 文档优先

新增功能时，先补：

- 使用入口
- 输出位置
- 风险边界
- 与现有工具关系

再写脚本。

### 4. 输出不进工具目录

任何运行产物必须进入：

```text
logs/browser-intelligence/
```

不应写入：

```text
packages/browser-intelligence/
```

## 目录职责

| 目录 | 职责 |
|---|---|
| `architecture/` | 架构边界和设计决策 |
| `docs/` | 开发和使用文档 |
| `integrations/` | 已有工具关系索引 |
| `profiles/` | 人类可读站点经验 |
| `recorder/` | 轨迹记录器设计和后续实现 |
| `scripts/` | CLI 与轻量编排脚本 |
| `tasks/` | 内容任务模板 |

## 新命令添加规范

新增 `bi.mjs` 命令时：

1. 命令应有明确边界
2. 默认只读，除非命令名明确表达写入
3. 写入必须进入 logs 或用户指定路径
4. 不保存 Cookie、Token、密码
5. 更新 `docs/cli.md`
6. 更新 `scripts/README.md`
7. 必要时更新根 `README.md`

## 错误处理规范

CLI 输出应该面向人类：

- Engine 未运行：提示启动方式
- API 连接失败：显示目标 URL 和错误原因
- 参数缺失：显示用法示例
- 输出目录不存在：可自动创建 logs 子目录

## 验证规范

日常开发先运行离线测试：

```bash
npm test
npm run check
```

当前离线测试覆盖 CLI 帮助、版本、文档定位、Recorder 无活动状态、参数缺失、安全失败、路径隔离和状态文件读写。

详细说明见：

```text
docs/testing.md
```

手动验证只运行只读命令：

```bash
node scripts/bi.mjs help
node scripts/bi.mjs version
node scripts/bi.mjs paths
node scripts/bi.mjs docs
node scripts/bi.mjs capabilities
node scripts/bi.mjs health
node scripts/bi.mjs engine help
```

不自动启动浏览器、不关闭浏览器、不访问外部网站。
