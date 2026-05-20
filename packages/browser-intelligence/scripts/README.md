# Scripts：可执行脚本目录

## 定位

本目录用于后续放置 Browser Intelligence 自己的轻量脚本。

脚本只负责编排已有能力，优先调用 Browser Engine API，不重复实现浏览器控制能力。

## 已有脚本

```text
bi.mjs                 # Browser Intelligence 统一 CLI 入口
lib/engine-client.mjs  # Browser Engine HTTP client
lib/paths.mjs          # 项目路径与输出路径
lib/format.mjs         # CLI 输出格式工具
```

## CLI 快速开始

```bash
node scripts/bi.mjs help
node scripts/bi.mjs version
node scripts/bi.mjs paths
node scripts/bi.mjs docs
node scripts/bi.mjs capabilities
node scripts/bi.mjs health
node scripts/bi.mjs engine help
node scripts/bi.mjs engine tabs
node scripts/bi.mjs record help
node scripts/bi.mjs record status
npm test
npm run check
```

`bi.mjs` 是 Browser Intelligence 的上层入口；Browser Engine 的底层快捷操作仍由 `browser-engine/be.mjs` 承担。

## Recorder MVP

```text
record start          # 开始记录一次人类探索轨迹
record mark           # 给当前任务追加人工标记
record status         # 查看当前记录状态
record stop           # 停止记录并导出 trace/network/pages/summary
```

## 输出规则

脚本运行产生的文件不写入本目录。

统一输出到：

```text
logs/browser-intelligence/
```

## 脚本边界

脚本可以做：
- 调用 Browser Engine API
- 创建 trace 目录
- 写入 JSONL/JSON/Markdown 输出
- 生成复盘输入材料

脚本不应该做：
- 保存大量截图到 `tools/`
- 复制 Browser Engine 源码
- 直接大规模采集平台数据
- 绕过验证码或人类验证
