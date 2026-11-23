# Browser Automation Workbench

让 AI 或本地脚本操作真实浏览器，并把会话、任务进度和网页操作记录留在本机。

项目提供两种入口：独立浏览器会话适合后台任务和人工接管；连接已有 Edge / Chrome 适合复用当前页面、观察网络请求和整理自动化流程。通过 CLI、HTTP 或 stdio MCP 调用，可接入支持本地工具的 AI 客户端。

**当前版本：0.6.0。** 独立桌面外壳及受管浏览器主要在 Windows x64 验证；核心离线测试也在 Linux CI 运行。macOS / Linux 的完整桌面安装与端到端流程尚未验证。

## 快速开始：Windows 独立浏览器

准备 Node.js 22 或更高版本，以及 PowerShell。核心代码只使用 Node.js 内置模块，运行和测试不需要先安装 npm 依赖。

```powershell
git clone https://github.com/cheer932041235/browser-automation-workbench.git
cd browser-automation-workbench

# 下载官方 Electron Windows x64 运行时到本项目 runtime/，首次使用执行
./scripts/install-desktop-runtime.ps1

# 打开浏览器工作台窗口
npm run workbench:open
```

在工作台中创建会话并打开目标网站。自动化可以在隐藏窗口运行；遇到登录或验证码时显示对应窗口，由用户处理后转回后台。安装脚本也会生成“我的浏览器”快捷方式。

只需要后台服务时运行 `npm run workbench:start`。管理页地址为 [http://127.0.0.1:3460](http://127.0.0.1:3460)，关闭管理页不等于关闭会话。

## 使用方式

### CLI：给指定项目创建会话

以下命令在仓库根目录的 PowerShell 中执行：

```powershell
$project = (Get-Location).Path
@{id='demo'; label='示例项目'; engine='desktop'; project=$project; allowedUrls=@('https://example.org/')} |
  ConvertTo-Json -Compress |
  node packages/browser-engine/workbench-client.mjs browser_session_create

'{"sessionId":"demo"}' | node packages/browser-engine/workbench-client.mjs browser_session_start
'{"sessionId":"demo","url":"https://example.org/"}' | node packages/browser-engine/workbench-client.mjs browser_page_open

# 查看准确页面编号；后续读取、截图和任务操作使用返回的 pageId
'{"sessionId":"demo"}' | node packages/browser-engine/workbench-client.mjs browser_pages

# 关闭自己的会话，保留本地登录配置和已保存页面地址
'{"sessionId":"demo"}' | node packages/browser-engine/workbench-client.mjs browser_session_close
```

CLI 从标准输入读取 JSON，从标准输出返回 JSON。调用会按需启动同一个本机服务。

### MCP：交给 AI 客户端调用

将以下配置中的路径替换为自己的仓库绝对路径。具体配置文件位置由客户端决定。

```json
{
  "mcpServers": {
    "browser-workbench": {
      "command": "node",
      "args": ["/absolute/path/to/browser-automation-workbench/packages/browser-engine/workbench-client.mjs", "--mcp"]
    }
  }
}
```

当前提供 23 项工具，覆盖会话、页面、iframe、截图、布局检查、下载和可接续任务。仅列出工具不会启动后台服务；实际工具调用才按需启动。账号与业务操作授权仍由调用任务决定。

### Skill：给 AI 提供操作方法

MCP 提供可调用的接口，skill 说明怎样选择会话、观察页面、执行任务和处理中断。也可以只安装 skill，通过 CLI 使用。

仓库附带 [browser-workbench skill](skills/browser-workbench/SKILL.md)。Windows 用户在仓库根目录执行：

```powershell
./scripts/install-agent-skill.ps1

# 或安装到客户端支持的其他技能目录
./scripts/install-agent-skill.ps1 -Destination '/absolute/path/to/agent-skills/browser-workbench'
```

默认安装到 `~/.agents/skills/browser-workbench`，并写入仅保存在本机的仓库路径配置。重新加载支持该技能目录的 AI 客户端后，可以明确调用 `$browser-workbench`；其他客户端可选择自己的 skill 目录，或直接使用上面的 MCP 配置。更新仓库后，重新运行安装脚本以刷新 skill。

安装脚本只复制配套 skill 并记录仓库位置；不会修改客户端的 MCP 配置或其他浏览器的技能。它也不会要求 AI 把所有网页任务都交给这个项目。

### 连接日常 Edge / Chrome

在目标浏览器中启用远程调试；浏览器版本支持时可从 `edge://inspect/#remote-debugging` 或 `chrome://inspect/#remote-debugging` 进入。首次连接可能需要浏览器内确认。

```powershell
npm run engine:check
npm run engine:start -- --browser edge
npm run engine:cli -- --browser edge tabs
```

该入口通过所选浏览器配置目录的 `DevToolsActivePort` 连接，不会为了连接而重启浏览器。已有服务持续复用；详情见 [浏览器连接](docs/browser-connections.md)。

## 能做什么

- **独立会话**：为项目保留独立 Profile、网站范围和下载目录，支持后台执行、人工接管和空闲休眠。
- **可接续任务**：保存填写、点击、上传和下载步骤；中断后观察实际结果，再决定如何继续。
- **页面检查**：读取页面和 iframe，截图并检查不同视口的横向溢出与裂图。
- **操作转为开发依据**：通过 Browser Intelligence 的 `record → review → extract`，整理页面、选择器、网络请求与 API 候选。

## 目录与本机数据

| 目录 | 内容 |
|---|---|
| `packages/browser-desktop/` | Electron 桌面外壳与界面 |
| `packages/browser-engine/` | CDP 执行器、受管会话、任务和 MCP |
| `packages/browser-intelligence/` | 录制、复盘、内容提取与 API 分析 |
| `scripts/` | 启动、运行时安装和真实浏览器测试 |
| `skills/browser-workbench/` | 可安装的 AI 操作指南 |
| `docs/`、`examples/` | 使用说明和示例 |
| `runtime/` | 本机浏览器程序、Profile、下载和任务状态，Git 忽略 |
| `work/`、`outputs/` | 本机临时测试与结果，Git 忽略 |

默认数据目录在仓库内的 `runtime/`，不限定盘符。后台服务支持以 `WORKBENCH_DATA_ROOT` 指定其他绝对目录。浏览器 Profile、Cookie、网络响应和真实截图属于使用者的本机数据，不应提交到公开仓库。

## 检查与测试

```powershell
npm run check
npm test

# Windows：已安装 Electron 运行时后，测试独立桌面外壳
# 该测试额外需要 Python 3；可用 WORKBENCH_PYTHON 指定解释器
npm run test:desktop
```

真实浏览器测试使用自带的本地页面和独立测试配置；`test:browser`、`test:background` 等命令还需要安装的 Chrome / Edge。各测试的前提见 [脚本说明](scripts/README.md)。离线测试通过不等于所有网站、系统和登录流程都已验证。

## 使用范围

这是一套本机自动化工具，不包含云端浏览器服务或模型额度。桌面外壳不提供完整的扩展商店和云同步功能。日常网页交互优先通过 DOM/CDP；隐藏窗口中的合成点击与真实鼠标事件语义不同，复杂控件可能需要额外处理。登录、验证码和站点授权交给用户完成。

服务默认监听本机回环地址。不要把浏览器控制端口直接暴露到公网。运行时安装脚本下载官方 Electron；仓库不包含浏览器二进制或个人配置。

## 文档

- [受管会话、MCP 与任务接续](docs/managed-workbench.md)
- [AI 操作 skill](skills/browser-workbench/SKILL.md)
- [独立桌面外壳](docs/desktop-shell.md)
- [日常浏览器连接](docs/browser-connections.md)
- [工作流示例](docs/workflows.md)
- [录制与 API 发现](docs/api-discovery.md)
- [架构](docs/architecture.md) · [版本变化](CHANGELOG.md)

## 许可证

[MIT](LICENSE)。Electron 等外部运行时保留各自的许可证。
