# Browser Engine - 增强版浏览器自动化引擎

通过 Chrome DevTools Protocol (CDP) 连接用户日常 Edge/Chrome 浏览器，提供完整的自动化 HTTP API。

## 特性

- **连接用户日常浏览器**：天然携带登录态，无需启动独立浏览器
- **丰富的交互能力**：点击、输入、键盘快捷键、表单填写、文件上传、拖拽
- **页面结构化分析**：交互元素发现、文本提取、表单字段、链接列表、表格数据
- **网络管理**：请求监控、Cookie/Storage 管理、请求拦截、下载跟踪
- **任务持久化**：断点恢复、步骤状态保存，对话中断后可继续
- **智能等待**：等待元素/文本/网络空闲
- **Session 导入导出**：保存和恢复完整的浏览器会话状态
- **进程持久化**：不绑定对话，不会因对话中断而丢失

## 快速开始

```bash
# 前置条件：
# 1. Node.js 22+
# 2. Edge 已开启远程调试：edge://inspect/#remote-debugging

# 启动
node start.mjs

# 或直接指定端口
node server.mjs --browser-port 59888
```

## API 文档

### 系统
| 端点 | 方法 | 说明 |
|------|------|------|
| `/health` | GET | 健康检查，返回连接状态 |

### Tab 管理
| 端点 | 方法 | 说明 |
|------|------|------|
| `/tabs` | GET | 列出所有标签页 |
| `/tabs/new?url=` | POST | 创建新后台标签页 |
| `/tabs/close?target=` | GET | 关闭标签页 |
| `/tabs/closeAll` | GET | 关闭所有托管的标签页 |
| `/tabs/closeGroup?group=` | GET | 关闭指定分组的标签页 |
| `/tabs/navigate?target=&url=` | POST | 导航到 URL |
| `/tabs/back?target=` | GET | 后退 |
| `/tabs/forward?target=` | GET | 前进 |
| `/tabs/reload?target=` | GET | 刷新 |
| `/tabs/info?target=` | GET | 获取页面信息 |

### 交互
| 端点 | 方法 | 说明 |
|------|------|------|
| `/eval?target=` | POST | 执行 JS（body=表达式） |
| `/click?target=` | POST | JS 点击（body=CSS 选择器） |
| `/clickByText?target=` | POST | 通过文本内容点击 `{text, tag?}` |
| `/clickAt?target=` | POST | 真实鼠标点击（触发用户手势） |
| `/clickXY?target=` | POST | 坐标点击 `{x, y}` |
| `/type?target=` | POST | 逐字符键盘输入 `{text, delay?}` |
| `/fill?target=` | POST | 快速填充输入框 `{selector, value}` |
| `/fillForm?target=` | POST | 批量填写表单 `{fields: [{selector, value}]}` |
| `/pressKey?target=` | POST | 按键 `{key, modifiers?}` |
| `/hotkey?target=` | POST | 组合键 `{keys: ['Control','a']}` |
| `/hover?target=` | POST | 悬停（body=选择器） |
| `/scroll?target=` | POST | 滚动 `{direction?, y?, selector?}` |
| `/select?target=` | POST | 下拉框选择 `{selector, value}` |
| `/checkbox?target=` | POST | 复选框 `{selector, checked?}` |
| `/upload?target=` | POST | 文件上传 `{selector, files:[]}` |
| `/drag?target=` | POST | 拖拽 `{from, to}` |

### 页面分析
| 端点 | 方法 | 说明 |
|------|------|------|
| `/page/elements?target=` | POST | 获取交互元素列表 |
| `/page/text?target=` | POST | 获取页面文本内容 |
| `/page/forms?target=` | POST | 获取表单字段 |
| `/page/links?target=` | POST | 获取链接列表 `{filter?}` |
| `/page/table?target=` | POST | 获取表格数据 `{selector?}` |
| `/page/waitElement?target=` | POST | 等待元素出现 `{selector, timeout?}` |
| `/page/waitText?target=` | POST | 等待文本出现 `{text, timeout?}` |
| `/page/waitNetwork?target=` | POST | 等待网络空闲 |
| `/screenshot?target=` | POST | 截图 `{file?, fullPage?, selector?}` |
| `/pdf?target=` | POST | 生成 PDF `{file}` |

### 网络
| 端点 | 方法 | 说明 |
|------|------|------|
| `/network/monitor?target=` | GET | 启用网络监控 |
| `/network/requests` | POST | 获取最近请求 `{type?, urlPattern?, limit?}` |
| `/network/response?target=&requestId=` | GET | 获取响应内容 |
| `/network/intercept?target=` | POST | 设置请求拦截 `{rules}` |
| `/cookies?target=` | GET/POST/DELETE | Cookie 管理 |
| `/storage?target=&type=` | GET/POST | localStorage/sessionStorage |
| `/session/export?target=` | POST | 导出 Session `{file}` |
| `/session/import?target=` | POST | 导入 Session `{file}` |
| `/downloads?target=&enable=1` | GET | 下载管理 |

### 任务持久化
| 端点 | 方法 | 说明 |
|------|------|------|
| `/tasks` | GET | 列出所有任务 |
| `/tasks` | POST | 创建任务 `{id, name, steps:[{id, description}]}` |
| `/tasks/get?id=` | GET | 获取任务详情 |
| `/tasks/next?id=` | GET | 获取下一个待执行步骤 |
| `/tasks/step/start` | POST | 标记步骤开始 `{taskId, stepId}` |
| `/tasks/step/done` | POST | 标记步骤完成 `{taskId, stepId, result?}` |
| `/tasks/step/fail` | POST | 标记步骤失败 `{taskId, stepId, error}` |
| `/tasks/context?id=` | POST | 更新共享上下文 |
| `/tasks/pause?id=` | GET | 暂停任务 |
| `/tasks/delete?id=` | GET | 删除任务 |

## 架构

```
server.mjs          HTTP API 路由层
├── core.mjs        CDP 连接引擎（WebSocket 管理、命令发送、事件分发）
├── tabs.mjs        Tab 生命周期管理（创建/关闭/导航/分组）
├── interact.mjs    交互层（点击/输入/键盘/鼠标/表单/文件）
├── page.mjs        页面分析（元素发现/文本提取/等待策略/截图）
├── network.mjs     网络层（监控/拦截/Cookie/Storage/下载）
└── tasks.mjs       任务持久化（断点恢复/步骤状态/上下文保存）
```

## 与 Windsurf/Cascade 集成

Browser Engine 通过 `curl` 命令调用，不依赖 MCP 协议，对话中断不影响进程。

```bash
# 创建新 tab
curl -s "http://localhost:3456/tabs/new?url=https://example.com"

# 获取页面交互元素
curl -s -X POST "http://localhost:3456/page/elements?target=TARGET_ID"

# 点击按钮
curl -s -X POST "http://localhost:3456/clickByText?target=TARGET_ID" -d '{"text":"登录"}'

# 截图
curl -s -X POST "http://localhost:3456/screenshot?target=TARGET_ID" -d '{"file":"C:/tmp/shot.png"}'
```
