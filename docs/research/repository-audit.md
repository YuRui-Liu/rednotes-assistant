# 候选仓库审计记录

核查日期：2026-10-05。状态：初步静态调查，尚未完成固定 SHA 的完整代码审计。

本地 RedNote 为 main，状态显示与 origin/main 同步，HEAD 为 67805e6；这是本地远端跟踪引用，未再次联网读取远端。执行环境的 git ls-remote 在沙箱及获准联网重试后均报 github.com DNS 解析失败。网页工具能读取部分源码，但 main 内容可能更新，下面不能作为已固定版本的供应链记录。

## 已读到的代码与判断

| 项目 | 实际证据 | 复用判断 |
| --- | --- | --- |
| xpzouying/xiaohongshu-mcp | mcp_server.go 的 PublishContentArgs；xiaohongshu/publish.go 的 submitPublish、bindProducts、waitPublishSuccess；cookies/cookies.go 的 GetCookiesFilePath | 有图文、定时、挂商品执行基础，但需要加强商品匹配、结果回查和账号隔离 |
| JameryW/XhsGrowthAgent | pyproject.toml：Python 3.11、FastAPI、LangGraph、PostgreSQL、Redis，浏览器可选依赖；backend 目录有 agents/api/core/db/graph 等 | 全量接入有较多依赖，不能仅凭功能面板决定作为底座；审批调用链尚未完整读取 |
| Amazinghorseli/RedNote-Insight | 此前 README 的评论报告与演示数据启动说明；本轮 api.py、generate_data.py 和 src 页面读取失败 | 仍仅作为分析模块候选，不能证明已接通真实商品数据 |
| magicpsyche/RedNote-Agent | 此前 README 给出 src/app/actions/generate.ts、画布组件及 Seedream 流程 | 尚未审计源代码与许可证，不直接复制代码 |
| tian2-ai/xiaohongshu-publish | README 定位千帆商品上架 Skill | 不能替代现有商品列表查询 MCP |
| whhdbg/qianfan-mcp | README 的六个工具与 roadmap；src/qianfan_mcp 目录可见 server.py、browser.py、extractors | 新发现候选，偏经营分析；未见商品查询工具声明，代码和许可证未完成核查 |

## 小红书 MCP 必须处理的差异

1. 发布参数 `products` 接收关键词或 ID，但 schema 明确写选择首个搜索结果。不能仅传名称后认为挂载正确，必须核对批准的商品 ID 及店铺。
2. `submitPublish` 先调用 `bindProducts`，错误时中止，再点击发布。这部分符合挂载失败不降级的方向，但不证明选中了正确商品。
3. `waitPublishSuccess` 以 URL 离开发布表单为成功条件，无法单凭此证明笔记链接、账号、正文和购买入口均正确；RedNote 需独立结果回查。
4. `GetCookiesFilePath` 支持显式 `COOKIES_PATH`，也存在本地及旧临时文件回退。每个执行实例应显式配置独立会话文件，不依赖默认回退。多账号仍未实测。
5. 工具 schema 暴露 `schedule_at`，RedNote 初期应坚持已批准的本地队列到点执行，避免同时创建平台定时任务与本地任务造成重复；若未来改为平台托管，必须重新设计取消与回查语义。

## 原始来源

- https://raw.githubusercontent.com/xpzouying/xiaohongshu-mcp/main/mcp_server.go
- https://raw.githubusercontent.com/xpzouying/xiaohongshu-mcp/main/xiaohongshu/publish.go
- https://raw.githubusercontent.com/xpzouying/xiaohongshu-mcp/main/cookies/cookies.go
- https://raw.githubusercontent.com/JameryW/XhsGrowthAgent/main/pyproject.toml
- https://github.com/whhdbg/qianfan-mcp

## 尚未完成的计划项

五个候选 HEAD 固定、许可证全文验证、完整审批调用链审计、真实 MCP 连接和底座决策均未完成。网页读取成功不代替 checkout 或可运行性验证。
