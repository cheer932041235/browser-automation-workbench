# Browser Engine 竞品调研报告

## 调研项目

### 1. chrome-devtools-mcp（Google 官方）
- **架构**：MCP Server → Puppeteer-core → CDP，Mutex 保证顺序执行
- **亮点**：
  - `PageCollector` 模式：跨导航保留 console/network 数据（默认保留 3 次导航）
  - Performance tracing：CPU 节流、网络条件模拟、内存快照
  - 浏览器扩展管理（安装/卸载/触发）
  - `McpPage` 稳定 pageId（不随 CDP sessionId 变化）
  - Token 优化设计（AI agent 友好）
- **不足**：无 stealth、无 Shadow DOM、依赖 Puppeteer

### 2. browser-use/browser-harness
- **架构**：Python CLI → daemon（持久进程）→ CDP WebSocket → Chrome
- **亮点**：
  - **坐标优先交互**：`click_at_xy(x,y)` 绕过 DOM 选择器，天然穿透 iframe/Shadow DOM/跨域
  - **自愈能力**：LLM 可在执行中修改 `agent_helpers.py` 或创建新 domain skill
  - **Domain Skills**：按域名自动加载站点特定 playbook（选择器/URL 模式/私有 API）
  - **事件排水**：`drain_events()` 批量取走事件 + 切 tab 时 `Network.disable` 防污染
  - **远程浏览器**：集成 Browser Use Cloud（带代理/隐身/无头）
- **不足**：~1k 行代码，功能较少

### 3. pasky/chrome-cdp-skill
- **架构**：CLI → 每 tab 一个持久 daemon 进程 → Unix Socket IPC → CDP
- **亮点**：
  - **per-tab daemon**：每个 tab 独立进程，避免重复 "Allow debugging" 弹窗
  - **100+ tab 可靠处理**：Puppeteer 在大量 tab 时 target 枚举超时，此方案不会
  - **`Input.insertText`**：比 `dispatchKeyEvent` 更可靠，跨域 iframe 也能用
  - **20 分钟空闲自动关闭**：daemon 资源管理
  - **`loadall` 命令**：自动点击 "加载更多" 直到消失
- **不足**：无批量操作、无 stealth、无 Shadow DOM

### 4. vercel-labs/agent-browser（Vercel）
- **架构**：Rust CLI + 原生 Rust daemon → 直连 CDP（零 Node.js 依赖）
- **亮点**：
  - **Accessibility Tree Snapshot + @eN 引用**：
    - 从 `Accessibility.getFullAXTree` 生成精简快照
    - 交互元素标记为 `@e1`、`@e2`... 用于后续操作
    - 双路径解析：快路径（backend_node_id → getBoxModel）+ 回退（语义 role/name 查找）
  - **自动 iframe 遍历**：跨域 iframe 也包含在快照中（自动创建独立 session）
  - **Domain Allowlist**：安全限制导航范围
  - **Dialog 自动处理**：alert/beforeunload 自动 accept
  - **稳定 tab ID**（t1, t2... 而非 hex targetId）
- **不足**：Rust 实现，不适合动态修改

### 5. lotreace/cdp-skill
- **架构**：纯 Node.js，JSON-in/JSON-out CLI
- **亮点**：
  - **1,150+ 单元测试**：测试覆盖率极高
  - **Site Profiles**：`~/.cdp-skill/sites/{domain}.md`，跨 session 共享站点知识
  - **Smart Actionability**：点击前自动检查 visible/enabled/stable/unobscured/pointer-events
  - **Action Hooks**：`readyWhen`（前置条件）、`settledWhen`（后置条件）、`observe`（观察返回值）
  - **Pipeline**：编译多步操作为单个 async JS 函数，零网络往返
  - **`pierceShadow`**：Accessibility 快照支持穿透 Shadow DOM
  - **每次可视操作自动截图**
- **不足**：需要启动新 Chrome 实例

---

## 我们可以借鉴的功能（优先级排序）

### 高优先级（显著提升 AI agent 可用性）

| 功能 | 来源 | 价值 |
|------|------|------|
| **Accessibility Tree Snapshot** | agent-browser, cdp-skill | 比 DOM 选择器更语义化、更稳定，LLM 可直接理解页面结构 |
| **Smart Actionability 检查** | cdp-skill | 点击前验证元素可见/可用/稳定/未被遮挡，减少幽灵点击 |
| **Dialog 自动处理** | agent-browser | alert/confirm/prompt/beforeunload 自动处理，防止 agent 卡死 |
| **Input.insertText 输入** | chrome-cdp-skill | 比逐字符 dispatchKeyEvent 更快、更可靠、跨域 iframe 兼容 |

### 中优先级（提升效率和健壮性）

| 功能 | 来源 | 价值 |
|------|------|------|
| **Pipeline 批量执行** | cdp-skill | 多步操作编译为一个 JS 函数，零网络往返 |
| **每次操作自动截图** | cdp-skill | 操作后自动截图供 AI 验证，debug 更快 |
| **跨导航数据保留** | chrome-devtools-mcp | console/network 数据跨页面导航保留 |
| **Site Profiles** | cdp-skill, browser-harness | 记录站点特定知识（选择器/反爬策略/URL 模式） |

### 低优先级（锦上添花）

| 功能 | 来源 | 价值 |
|------|------|------|
| **Device Emulation** | chrome-devtools-mcp | 模拟移动设备/不同网络条件 |
| **Performance Tracing** | chrome-devtools-mcp | CPU/内存/网络性能分析 |
| **稳定 Tab ID** | agent-browser | `t1`/`t2` 比 hex 更友好 |
| **Daemon 空闲自动清理** | chrome-cdp-skill | 20min 无操作自动释放资源 |
