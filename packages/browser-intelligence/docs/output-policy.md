# Output Policy

## 核心原则

工具、输出、笔记必须分离。

```text
tools/  工具代码、文档、模板
logs/   运行输出、截图、trace、网络摘要
notes/  长期知识沉淀
```

## Browser Intelligence 路径

工具目录：

```text
packages/browser-intelligence/
```

运行输出：

```text
logs/browser-intelligence/
```

长期笔记：

```text
notes/
```

## 可以放进工具目录的内容

- README
- 开发文档
- CLI 脚本
- 任务模板
- 站点经验模板
- 非敏感示例

## 不应该放进工具目录的内容

- 运行截图
- trace.jsonl
- network.json
- 原始 HTML 大文件
- Cookie/Token/密码
- 小红书帖子原始合集
- 临时 debug 输出

## 推荐输出结构

```text
logs/browser-intelligence/
├── traces/
│   └── {task-id}/
│       ├── trace.jsonl
│       ├── network.json
│       ├── pages.json
│       ├── screenshots/
│       ├── notes.md
│       └── summary.md
├── screenshots/
├── temp/
└── reports/
```

## Git 规则

`logs/browser-intelligence/` 已加入知识库 `.gitignore`。

含义：

- 原始运行输出默认不提交
- 可以手动挑选有价值内容整理进 `notes/`
- 可以将通用经验提炼到 `profiles/` 或 `tasks/`

## 从输出到知识的链路

```text
CLI / Browser Engine 运行
        ↓
logs 保存原始材料
        ↓
AI 复盘和清洗
        ↓
notes 沉淀长期知识
        ↓
profiles/tasks 反哺工具经验
```

## 安全边界

任何脚本都不应自动保存：

- 登录密码
- Cookie
- Authorization header
- 个人隐私信息
- 绕过验证码的方法
