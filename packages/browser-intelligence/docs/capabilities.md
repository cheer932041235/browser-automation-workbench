# Capabilities

## 能力总览

Browser Intelligence 的能力来自 Browser Engine，并通过文档、CLI、任务模板和站点经验组织起来。

## 场景能力地图

### 1. 打开和管理网页

底层能力：

- `/tabs`
- `/tabs/new`
- `/tabs/info`
- `/tabs/navigate`
- `/tabs/close`

CLI 入口：

```bash
node scripts/bi.mjs engine tabs
```

### 2. 页面理解

底层能力：

- `/page/text`
- `/page/elements`
- `/page/forms`
- `/page/links`
- `/accessibility/snapshot`

用途：

- 让 AI 理解当前页面
- 找出可点击元素
- 获取结构化文本
- 生成后续操作建议

### 3. 交互操作

底层能力：

- `/click`
- `/clickByText`
- `/clickAt`
- `/safeClick`
- `/fill`
- `/fillForm`
- `/type`
- `/insertText`
- `/pressKey`
- `/scroll`

说明：

- 简单选择器可用 `/click`
- 需要用户手势时用 `/clickAt`
- 动态页面优先考虑 `/accessibility/*` 和 `/safeClick`

### 4. 网络观察

底层能力：

- `/network/monitor`
- `/network/requests`
- `/network/response`
- `/network/stop`

用途：

- 找 API 候选
- 判断 UI 操作背后的真实请求
- 为后续 API 优先方案提供证据

### 5. 截图和证据保留

底层能力：

- `/screenshot`
- `/autoshot/enable`
- `/autoshot/capture`
- `/autoshot/history`
- `/autoshot/latest`

输出原则：

截图应写入：

```text
logs/browser-intelligence/
```

### 6. iframe 与 Shadow DOM

底层能力：

- `/frames`
- `/frames/eval`
- `/frames/click`
- `/frames/text`
- `/frames/findText`
- `/shadow/query`
- `/shadow/click`
- `/shadow/fill`

适用场景：

- 登录嵌套页
- 支付/授权页面
- Web Components
- 后台系统复杂表单

### 7. 等待和页面检测

底层能力：

- `/wait/load`
- `/wait/network`
- `/wait/element`
- `/wait/text`
- `/wait/stable`
- `/detect`
- `/detect/dismiss`
- `/detect/smartOpen`

用途：

- 减少固定 sleep
- 检测登录墙、验证码、弹窗、错误页
- 提高自动化稳定性

### 8. 任务持久化

底层能力：

- `/tasks`
- `/tasks/get`
- `/tasks/next`
- `/tasks/step/start`
- `/tasks/step/done`
- `/tasks/step/fail`
- `/tasks/context`

用途：

- 对话中断后恢复任务
- 管理多步骤流程
- 保存上下文和中间结果

### 9. Site Profile

底层能力：

- `/profiles`
- `/profiles/get`
- `/profiles/match`
- `/profiles/selector`
- `/profiles/note`

Browser Intelligence 的 `profiles/` 目录做人类可读经验，Browser Engine 的 `.site-profiles/` 做机器可读数据。

### 10. 后续 Recorder

Recorder 未来将组合：

- `/network/monitor`
- `/nav/enable`
- `/autoshot/enable`
- `/page/text`
- `/page/elements`
- `/network/requests`

输出为 trace、页面快照、截图和复盘材料。
