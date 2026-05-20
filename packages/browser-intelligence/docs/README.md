# Browser Intelligence Docs

## 定位

本目录是 Browser Intelligence 的开发与使用文档入口。

Browser Intelligence 是 Browser Engine 之上的上层工具项目：

```text
Browser Engine      底层浏览器控制 API
Browser Intelligence 文档体系、统一 CLI、任务模板、站点经验、后续 Recorder
Content Tasks       小红书情报、网站调研、流程复盘等具体应用
```

## 文档导航

| 文档 | 用途 |
|---|---|
| `developer-guide.md` | 开发者如何扩展 Browser Intelligence |
| `capabilities.md` | 浏览器能力地图，按使用场景组织 |
| `cli.md` | `bi.mjs` 统一 CLI 使用说明 |
| `api-map.md` | Browser Engine API 到 Browser Intelligence 能力的映射 |
| `output-policy.md` | 工具、输出、笔记分离规则 |
| `testing.md` | 离线测试策略、覆盖范围和运行命令 |

## 第一阶段范围

第一阶段只做两件事：

- 建立可维护的文档体系
- 提供统一 CLI 入口

暂不做：

- 小红书大规模采集
- 完整轨迹记录器
- 迁移 Browser Engine 源码
- 替代 Browser Engine 自带 `be.mjs`

## 关键路径

```text
工具目录：packages/browser-intelligence/
运行输出：logs/browser-intelligence/
底层引擎：packages/browser-engine/
```
