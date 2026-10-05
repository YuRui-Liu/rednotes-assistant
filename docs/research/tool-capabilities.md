# 工具能力矩阵

2026-10-05；本轮没有调用真实账号，不存在真实发布或互动。

| 能力 | 状态 | 依据及缺口 |
| --- | --- | --- |
| 图文发布 | 静态支持 | xpzouying/xiaohongshu-mcp 注册 publish_content；未连接 |
| 商品挂载 | 静态支持 | products + bindProducts；首项匹配需改造，实际写入待具体授权验证 |
| 发布时间 | 静态支持 | schedule_at；本方案使用本地授权队列，避免双调度 |
| 点赞留言 | 静态支持 | LikeFeedArgs、PostCommentArgs；必须经过 RedNote 单动作批准 |
| 多账号隔离 | 缺少连接 | 可配置 cookie 路径，不代表多账号已验证 |
| 千帆店铺商品列表与详情 | 缺少连接 | 当前会话无千帆工具；需要明确项目或实现适配器 |
| 千帆经营分析 | 静态支持（文档级） | whhdbg/qianfan-mcp 声明 overview/note analytics/search terms；尚未读取完整实现 |
| 发布后核实商品和笔记链接 | 缺少连接 | 已读到的成功判断仅为页面跳转，仍需补充 |

新候选 https://github.com/whhdbg/qianfan-mcp 的 README 声明 list_tabs、connect_store、get_overview、get_note_analytics、get_search_terms、get_diagnosis。其 roadmap 仍列页面专用解析、多店切换和快照任务。没有证据证明它提供用户需要的完整商品查询；也不应在未检查授权许可前复制源码。

已向用户询问其所指千帆 MCP 的项目链接或连接名称。若未指定项目，可继续调查此候选，但不能预设它就是用户现有连接。
