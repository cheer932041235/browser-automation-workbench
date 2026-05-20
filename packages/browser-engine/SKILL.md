---
name: browser-engine
description:
  增强版浏览器自动化引擎。通过 CDP 连接用户日常 Edge 浏览器，提供完整的自动化能力。
  替代旧版 web-access 中的 CDP Proxy，功能更强、更稳定。
  触发场景：需要操控浏览器完成任何任务——登录、搜索、数据下载、表单填写、页面截图、内容提取等。
metadata:
  author: 一泽Eze
  version: "2.0.0"
---

# Browser Engine

## 前置检查

```bash
node "packages/browser-engine/start.mjs"
```

脚本会检查 Node.js 版本、发现浏览器调试端口、启动 Engine（如未运行）。

如果 Edge 未以调试模式运行，需要先执行：
```powershell
powershell -ExecutionPolicy Bypass -File "packages/browser-engine/launch-edge.ps1" -Port 9223
```
这会关闭 Edge 并以调试模式重启（保留登录态和标签页）。

Engine 启动后持续运行，不绑定对话。对话中断不影响 Engine 进程。

## API 地址

`http://localhost:3456`

所有操作通过 HTTP 调用。以下用 `node -e` 或 `curl` 均可。

## 核心操作速查

### Tab 管理

```bash
# 列出所有 tab
curl -s http://localhost:3456/tabs

# 创建新 tab（自动等待加载）
curl -s "http://localhost:3456/tabs/new?url=https://example.com"
# 返回: { "targetId": "XXXX", ... }

# 获取页面信息
curl -s "http://localhost:3456/tabs/info?target=TARGET_ID"

# 导航（带 JSON body）
node -e "..." // POST /tabs/navigate?target=ID  body: {"url":"https://..."}

# 关闭 tab
curl -s "http://localhost:3456/tabs/close?target=TARGET_ID"

# 关闭所有托管 tab
curl -s http://localhost:3456/tabs/closeAll
```

### 交互操作

所有交互端点需要 `?target=TARGET_ID` 参数。

```bash
# JS 点击（CSS 选择器）
POST /click         body: CSS选择器字符串

# 按文本内容点击
POST /clickByText   body: {"text":"登录","tag":"button"}

# 真实鼠标点击（触发用户手势，能打开文件对话框）
POST /clickAt       body: CSS选择器字符串

# 快速填充输入框
POST /fill          body: {"selector":"#username","value":"myname"}

# 批量填表
POST /fillForm      body: {"fields":[{"selector":"#user","value":"a"},{"selector":"#pass","value":"b"}]}

# 逐字符键盘输入
POST /type          body: {"text":"hello world","delay":50}

# 按键
POST /pressKey      body: {"key":"Enter"}
POST /pressKey      body: {"key":"Tab","modifiers":{"ctrl":true}}

# 组合键
POST /hotkey        body: {"keys":["Control","a"]}

# 悬停
POST /hover         body: CSS选择器字符串

# 滚动
POST /scroll        body: {"direction":"bottom"}
POST /scroll        body: {"y":1000}
POST /scroll        body: {"selector":"#target-element"}

# 下拉框
POST /select        body: {"selector":"#country","value":"CN"}

# 复选框
POST /checkbox      body: {"selector":"#agree","checked":true}

# 文件上传
POST /upload        body: {"selector":"input[type=file]","files":["C:/path/to/file.pdf"]}

# 拖拽
POST /drag          body: {"from":"#source","to":"#target"}

# 执行任意 JS
POST /eval          body: document.title
```

### 页面分析

```bash
# 获取交互元素列表（类似 Playwright snapshot）
POST /page/elements     body: {"maxItems":50}

# 获取页面文本内容（结构化 Markdown）
POST /page/text         body: {"maxLength":3000}

# 获取表单字段
POST /page/forms        body: {"selector":"form"}

# 获取链接
POST /page/links        body: {"filter":"download"}

# 获取表格数据
POST /page/table        body: {"selector":"table.data"}

# 等待元素出现
POST /page/waitElement  body: {"selector":".result","timeout":15000}

# 等待文本出现
POST /page/waitText     body: {"text":"下载完成","timeout":30000}

# 等待网络空闲
POST /page/waitNetwork  body: {"timeout":15000}
```

### 截图与 PDF

```bash
# 截图保存到文件
POST /screenshot    body: {"file":"C:/tmp/shot.png"}

# 全页截图
POST /screenshot    body: {"file":"C:/tmp/full.png","fullPage":true}

# 元素截图
POST /screenshot    body: {"file":"C:/tmp/el.png","selector":"#chart"}

# 生成 PDF
POST /pdf           body: {"file":"C:/tmp/page.pdf"}
```

### 网络与 Cookie

```bash
# Cookie 管理
GET  /cookies?target=ID              # 获取 cookies
POST /cookies?target=ID  body:{...}  # 设置 cookie
DELETE /cookies?target=ID body:{...} # 删除 cookie

# localStorage/sessionStorage
GET  /storage?target=ID&type=local
POST /storage?target=ID  body:{"key":"k","value":"v"}

# 导出/导入 Session（断点恢复利器）
POST /session/export?target=ID  body:{"file":"C:/tmp/session.json"}
POST /session/import?target=ID  body:{"file":"C:/tmp/session.json"}

# 网络监控
GET  /network/monitor?target=ID
POST /network/requests  body:{"urlPattern":"api","limit":20}

# 下载管理
GET  /downloads?target=ID&enable=1   # 启用下载跟踪
GET  /downloads                      # 查看下载状态
```

### 任务持久化（对话中断后恢复）

```bash
# 创建任务
POST /tasks  body: {
  "id": "csmar-download",
  "name": "CSMAR数据下载",
  "steps": [
    {"id": "s1", "description": "下载资产负债表"},
    {"id": "s2", "description": "下载利润表"},
    {"id": "s3", "description": "下载现金流量表"}
  ],
  "context": {"loginUrl": "http://..."}
}

# 查看任务列表
GET /tasks

# 获取下一步
GET /tasks/next?id=csmar-download

# 标记步骤完成
POST /tasks/step/done  body: {"taskId":"csmar-download","stepId":"s1","result":{"file":"xxx.zip"}}

# 更新共享上下文
POST /tasks/context?id=csmar-download  body: {"currentTab":"TARGET_ID"}
```

## 使用模式

### 模式一：通过 run_command + node -e 调用

适合需要精细控制的场景。示例：

```bash
node -e "
const http=require('http');
const data=JSON.stringify({selector:'#sb_form_q',value:'test'});
const req=http.request({hostname:'127.0.0.1',port:3456,path:'/fill?target=TARGET_ID',method:'POST',
  headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}},
  r=>{let b='';r.on('data',c=>b+=c);r.on('end',()=>console.log(b));});
req.write(data);req.end();
"
```

### 模式二：通过 curl 调用

适合简单的 GET 请求：

```bash
curl -s "http://localhost:3456/tabs"
curl -s "http://localhost:3456/tabs/info?target=ID"
```

### 模式三：任务持久化 + 断点恢复

1. 对话开始时创建任务或读取已有任务
2. 每完成一步标记 step/done
3. 对话中断后，新对话读取任务获取下一步继续执行

### iframe 穿透

```bash
# 列出页面所有 frame（含嵌套层级）
GET /frames?target=ID

# 在指定 frame 中执行 JS（三种定位方式）
POST /frames/eval  body: {"frameIndex":1, "expression":"document.title"}
POST /frames/eval  body: {"frameId":"FRAME_ID", "expression":"..."}
POST /frames/eval  body: {"urlPattern":"csmar\\.com", "expression":"..."}

# 在 frame 中点击/填充
POST /frames/click     body: {"frameId":"FRAME_ID", "selector":"#btn"}
POST /frames/fill      body: {"frameId":"FRAME_ID", "selector":"#input", "value":"text"}

# 获取 frame 中的交互元素/文本
POST /frames/elements  body: {"frameId":"FRAME_ID"}
POST /frames/text      body: {"frameId":"FRAME_ID"}

# 跨所有 frame 搜索文本/元素
POST /frames/findText     body: {"text":"目标文字"}
POST /frames/findElement  body: {"selector":"#target"}
```

### 反检测（Stealth）

```bash
# 对 tab 注入反检测脚本（隐藏 webdriver 指纹等）
GET /stealth/inject?target=ID

# 对所有托管 tab 注入
GET /stealth/injectAll

# 检查当前反检测状态
GET /stealth/check?target=ID
# 返回: {"webdriver":false,"stealthActive":true,"webglVendor":"Google Inc. (NVIDIA)",...}
```

注入后隐藏的指纹：
- `navigator.webdriver` → false
- CDP 运行时变量清除
- `chrome.runtime` 伪装
- plugins/mimeTypes 长度伪装
- WebGL vendor/renderer — 动态检测真实 GPU，仅在 headless/虚拟环境时伪装
- languages 伪装
- Error.stack CDP 调用栈清除
- 防重复标记使用 Symbol（不可枚举，反爬脚本无法检测）

### 智能等待

```bash
# 等待页面完全加载（事件驱动，非轮询）
POST /wait/load         body: {"timeout":20000}

# 等待导航完成（URL变化 + 页面加载）
POST /wait/navigation   body: {"timeout":30000}

# 等待网络空闲（无pending请求持续2秒）
POST /wait/network      body: {"timeout":15000,"idleTime":2000,"ignore":["analytics"]}

# 等待元素出现（MutationObserver，比轮询快）
POST /wait/element      body: {"selector":".result","timeout":10000}

# 等待元素消失（如loading spinner）
POST /wait/elementGone  body: {"selector":".loading","timeout":10000}

# 等待文本出现
POST /wait/text         body: {"text":"下载完成","timeout":10000}

# 等待URL变化
POST /wait/url          body: {"pattern":"success","timeout":15000}

# 组合等待：页面加载 + 网络空闲
POST /wait/stable       body: {"timeout":20000}
```

### 页面检测

```bash
# 检测页面状态（登录墙、验证码、弹窗、Cookie banner、错误页）
GET /detect?target=ID
# 返回: {"hasLoginForm":true,"loginFields":[{...}],"hasCaptcha":false,...}

# 尝试关闭遮罩/弹窗/Cookie banner
GET /detect/dismiss?target=ID

# 智能打开：创建tab → 注入stealth → 等待 → 检测障碍 → 自动处理
POST /detect/smartOpen  body: {"url":"https://example.com"}
```

### Console 日志捕获

```bash
# 启用 console 捕获（捕获 console.log/warn/error + 未捕获异常）
GET /console/enable?target=ID

# 获取日志（支持按 level/filter/limit 筛选）
GET /console/logs?target=ID&level=error&limit=50

# 清空日志
GET /console/clear?target=ID

# 停止捕获
GET /console/stop?target=ID
```

### Shadow DOM 穿透

```bash
# 查询 Shadow DOM 内元素（递归穿透所有 shadowRoot）
POST /shadow/query?target=ID&selector=button

# 在 Shadow DOM 内点击元素
POST /shadow/click?target=ID  body: CSS选择器

# 在 Shadow DOM 内填充输入框
POST /shadow/fill?target=ID  body: {"selector":"#input","value":"text"}
```

适用场景：Angular Material、Salesforce Lightning、Chrome 内部页面等使用 Web Components 的站点。

### 批量操作

```bash
# 批量打开 URL（并发控制，自动注入stealth）
POST /batch/open  body: {
  "urls": ["https://a.com","https://b.com","https://c.com"],
  "concurrency": 3,
  "group": "batch-job",
  "delay": 1000
}

# 对多个 tab 并行执行 JS
POST /batch/eval  body: {"targetIds":["ID1","ID2"],"expression":"document.title"}

# 对多个 tab 并行提取文本
POST /batch/text  body: {"targetIds":["ID1","ID2"],"maxLength":3000}

# 对多个 tab 并行截图
POST /batch/screenshot  body: {"targetIds":["ID1","ID2"],"dir":"C:/tmp/shots"}

# 一键采集：打开 → 提取 → 关闭
POST /batch/scrape  body: {
  "urls": ["https://a.com","https://b.com"],
  "expression": "document.title",
  "autoClose": true
}

# 批量关闭
POST /batch/close  body: {"targetIds":["ID1","ID2"]}
```

### 快速文本输入（insertText）

```bash
# 一次性插入文本（比逐字符 /type 快得多，跨域 iframe 也能用）
POST /insertText  body: {"text":"Hello World","selector":"#search-input"}
```

与 `/type` 的区别：`/insertText` 使用 CDP `Input.insertText` 一次性插入全部文本，不触发 keydown/keyup 事件但触发 input/change 事件。适合需要快速填入大量文本的场景。`/type` 逐字符模拟键盘，适合需要触发键盘事件（如自动补全、快捷键）的场景。

### 元素可操作性检查（Actionability）

```bash
# 检查元素是否可安全交互（6项检查）
POST /actionability  body: {"selector":"#submit-btn"}
# 返回: {"visible":true,"inViewport":true,"enabled":true,"pointerEvents":true,"unobscured":true,"stable":true}

# 安全点击：先检查可操作性，通过后再点击
POST /safeClick  body: {"selector":"#submit-btn"}
```

6 项检查：可见性、是否在视口内、是否启用、pointer-events 是否允许、是否被遮挡、位置是否稳定。

### Dialog 自动处理

```bash
# 启用 dialog 自动处理（alert/confirm/prompt/beforeunload）
GET /dialog/enable?target=ID

# 禁用
GET /dialog/disable?target=ID

# 获取 dialog 历史
GET /dialog/history?target=ID
# 返回: [{"type":"alert","message":"...","accepted":true,"timestamp":"..."},...]

# 清空历史
GET /dialog/clear?target=ID

# 手动处理下一个 dialog
POST /dialog/handle  body: {"accept":true,"promptText":"my answer"}

# 设置处理策略
POST /dialog/policy  body: {"alert":"accept","confirm":"accept","prompt":"dismiss","beforeunload":"accept"}
```

启用后，alert/confirm/prompt/beforeunload 弹窗自动按策略处理，不会阻塞页面执行。

### Accessibility Tree Snapshot（@eN 引用系统）

```bash
# 获取页面无障碍树快照（精简版，适合 AI 理解页面结构）
POST /accessibility/snapshot  body: {"depth":5}
# 返回: {"tree":[...],"refs":{"@e1":{"role":"button","name":"Submit"},...}}

# 解析 @eN 引用的坐标位置
POST /accessibility/resolve  body: {"refId":"@e3"}
# 返回: {"resolved":true,"x":150,"y":300,"width":100,"height":40}

# 通过 @eN 引用直接点击元素
POST /accessibility/click  body: {"refId":"@e3"}
```

交互元素标记为 `@e1`、`@e2`...，可直接用于后续操作。比 CSS 选择器更稳定，适合动态页面。自动穿透 iframe。

### Pipeline 批量执行

```bash
# 将多步操作编译为单个 JS 函数执行（零网络往返）
POST /pipeline  body: {
  "steps": [
    {"action":"fill","selector":"#username","value":"admin"},
    {"action":"fill","selector":"#password","value":"example-password"},
    {"action":"click","selector":"#login-btn"},
    {"action":"wait","ms":2000},
    {"action":"extract","selector":".welcome","property":"textContent"}
  ]
}
# 返回: {"ok":true,"stepsRun":5,"results":[...]}
```

支持的 action：`click`、`fill`、`type`、`wait`、`eval`、`extract`、`select`、`check`、`assert`。任一步骤失败立即停止并返回错误。适合登录、表单提交等多步固定流程。

### 自动截图（AutoScreenshot）

```bash
# 启用自动截图（操作后自动截图供 AI 验证）
POST /autoshot/enable  body: {"format":"jpeg","quality":60,"maxHistory":20}

# 手动触发截图
POST /autoshot/capture  body: {"action":"clicked_submit"}

# 获取截图历史
GET /autoshot/history?target=ID&limit=5

# 获取最新截图（base64）
GET /autoshot/latest?target=ID

# 禁用
GET /autoshot/disable?target=ID

# 全局启用（所有新 tab 自动开启）
POST /autoshot/global  body: {"enabled":true}
```

### 跨导航数据保留（Navigation Tracker）

```bash
# 启用导航追踪（页面跳转后自动恢复 console/network 监控）
POST /nav/enable  body: {}

# 获取导航历史
GET /nav/history?target=ID
# 返回: [{"url":"https://a.com","timestamp":"..."},{"url":"https://b.com",...}]

# 获取当前 URL
GET /nav/current?target=ID

# 禁用
GET /nav/disable?target=ID
```

启用后，页面导航（如点击链接、表单提交）不会丢失 Runtime/Network 监控状态，自动在新页面重新启用。

### 站点 Profile（Site Profiles）

```bash
# 创建/更新站点 profile
POST /profiles  body: {"domain":"taobao.com","loginType":"qrcode","antiCrawl":"strict"}

# 查询站点 profile
GET /profiles/get?domain=taobao.com

# 按 URL 匹配 profile（自动提取域名）
GET /profiles/match?url=https://item.taobao.com/item.htm?id=123

# 添加常用选择器
POST /profiles/selector  body: {"domain":"taobao.com","name":"searchBox","selector":"#q","description":"搜索框"}

# 添加经验备注
POST /profiles/note  body: {"domain":"taobao.com","note":"需要登录才能看价格，IP频繁访问会触发滑块"}

# 列出所有 profile
GET /profiles

# 删除 profile
GET /profiles/delete?domain=taobao.com
```

按域名持久化存储站点特定知识（选择器、反爬策略、登录方式、经验备注），支持子域名模糊匹配。JSON 文件存储在 `.site-profiles/` 目录。

### CLI 快捷命令

```bash
# 直接用 be.mjs 代替冗长的 curl/node -e
node be.mjs health              # 检查状态
node be.mjs tabs                # 列 tab
node be.mjs new https://a.com   # 新建 tab
node be.mjs fill ID "#q" "test" # 填充
node be.mjs key ID Enter        # 按键
node be.mjs shot ID file.png    # 截图
node be.mjs stealth ID          # 注入反检测
node be.mjs frames ID           # 列 iframe
node be.mjs w ID                # 等待页面稳定
node be.mjs close ID            # 关闭 tab

# 支持短 ID（前4+字符自动匹配）
node be.mjs info 8D94           # 等同于完整 targetId
```

### v3 核心改进

- **事件系统重构**：`on()`/`off()`/`once()` + 按 session 隔离的 `onTarget()`，消除内存泄漏
- **WebSocket 自动重连**：指数退避，最多 5 次，浏览器重启后自动恢复
- **iframe 穿透修复**：`evalInFrame` 现在通过 `Page.createIsolatedWorld` 真正执行在目标 frame
- **Stealth 加固**：Symbol 隐藏标记、动态 GPU 检测（不再硬编码 Intel）
- **双击/右键**：`/doubleClick`、`/rightClick` 端点
- **Console 捕获**：实时捕获 console.log/warn/error + 未捕获异常
- **Shadow DOM**：递归穿透查询/点击/填充
- **Network 清理**：`/network/stop` 停止监控并清理事件

### v4 核心改进（竞品调研成果）

- **Dialog 自动处理**：alert/confirm/prompt/beforeunload 自动 accept，不阻塞页面
- **Accessibility Tree Snapshot**：无障碍树快照 + @eN 引用系统，AI 友好的页面理解方式
- **Input.insertText**：一次性插入文本，比逐字符 dispatchKeyEvent 快 10x+，跨域 iframe 可用
- **Smart Actionability**：点击前 6 项可操作性检查（visible/inViewport/enabled/pointerEvents/unobscured/stable）
- **Pipeline**：多步操作编译为单个 async IIFE，零网络往返执行
- **AutoScreenshot**：操作后自动截图，per-tab 历史管理，base64 获取
- **Navigation Tracker**：跨导航自动恢复 Runtime/Network 监控，记录导航历史
- **Site Profiles**：按域名持久化存储站点知识（选择器、反爬策略、备注），JSON 文件存储

## 与旧版 CDP Proxy 的区别

| 特性 | 旧版 CDP Proxy | Browser Engine v2 |
|------|---------------|-------------------|
| 连接目标 | Chrome | Edge（也支持 Chrome） |
| Session 恢复 | 无 | 自动重试 + reattach |
| iframe 操作 | 无 | /frames/* 完整穿透 |
| 反检测 | 无 | 10项指纹隐藏 + 动态 GPU |
| 智能等待 | 无 | 事件驱动 + MutationObserver |
| 页面检测 | 无 | 登录墙/验证码/弹窗自动识别 |
| 批量操作 | 无 | /batch/* 并发采集 |
| 页面分析 | 仅 /eval | /page/elements, /page/text 等 |
| 键盘输入 | 无 | /type, /pressKey, /hotkey |
| 表单填写 | 无 | /fill, /fillForm |
| 任务持久化 | 无 | /tasks/* 完整生命周期 |
| Session 导出 | 无 | /session/export, /session/import |
| 下载管理 | 无 | /downloads |
| CLI 工具 | 无 | be.mjs 快捷命令 |
| Console 捕获 | 无 | /console/* 实时日志 |
| Shadow DOM | 无 | /shadow/* 递归穿透 |
| 自动重连 | 无 | 指数退避重连 |
| 事件清理 | 无 | on/off/once + target 隔离 |
| Dialog 处理 | 无 | /dialog/* 自动 accept/dismiss |
| 无障碍快照 | 无 | /accessibility/* @eN 引用系统 |
| 快速输入 | 无 | /insertText（Input.insertText） |
| 可操作性检查 | 无 | /actionability 6项检查 + /safeClick |
| Pipeline | 无 | /pipeline 多步编译零往返 |
| 自动截图 | 无 | /autoshot/* 操作后自动截图 |
| 跨导航保留 | 无 | /nav/* 导航后自动恢复监控 |
| 站点知识库 | 无 | /profiles/* 域名级知识持久化 |
| API 端点总数 | ~10 | **107+** |
