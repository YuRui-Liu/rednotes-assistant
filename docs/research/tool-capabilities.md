# 工具能力矩阵

范围修订：用户于 2026-10-05 取消千帆 MCP，以下千帆调查仅为历史记录，不再是接入任务或阻塞条件。商品改为链接导入与人工建档；停止请求千帆项目链接。

2026-10-05；本轮没有调用真实账号，不存在真实发布或互动。

| 能力 | 状态 | 依据及缺口 |
| --- | --- | --- |
| 图文发布 | 静态支持 | xpzouying/xiaohongshu-mcp 注册 publish_content；未连接 |
| 商品挂载 | 静态支持 | products + bindProducts；首项匹配需改造，实际写入待具体授权验证 |
| 发布时间 | 静态支持 | schedule_at；本方案使用本地授权队列，避免双调度 |
| 点赞留言 | 静态支持 | LikeFeedArgs、PostCommentArgs；必须经过 RedNote 单动作批准 |
| 多账号隔离 | 缺少连接 | 可配置 cookie 路径，不代表多账号已验证 |
| 千帆店铺商品列表与详情 | 已取消 | 改为链接与人工商品档案 |
| 千帆经营分析 | 不在接入范围 | 不再依赖千帆 MCP |
| 发布后核实商品和笔记链接 | 缺少连接 | 已读到的成功判断仅为页面跳转，仍需补充 |

新候选 https://github.com/whhdbg/qianfan-mcp 的 README 声明 list_tabs、connect_store、get_overview、get_note_analytics、get_search_terms、get_diagnosis。其 roadmap 仍列页面专用解析、多店切换和快照任务。没有证据证明它提供用户需要的完整商品查询；也不应在未检查授权许可前复制源码。

上述千帆调查已结束，不再要求用户提供其项目或连接。

## 小红书服务接入契约

已读取 [routes.go](https://github.com/xpzouying/xiaohongshu-mcp/blob/main/routes.go)、[handlers_api.go](https://github.com/xpzouying/xiaohongshu-mcp/blob/main/handlers_api.go)、[service.go](https://github.com/xpzouying/xiaohongshu-mcp/blob/main/service.go)。复用其 HTTP 接口，免去在本应用复制浏览器操作实现：

- 登录状态：GET `/api/v1/login/status`；二维码：GET `/api/v1/login/qrcode`。
- 研究：POST `/api/v1/feeds/search`，`keyword`；详情 `/api/v1/feeds/detail`，`feed_id`、`xsec_token`。
- 发布：POST `/api/v1/publish`，标题、正文、图片数组。队列到点执行，不再传上游排期。
- 互动：POST `/api/v1/feeds/like`、`/api/v1/feeds/comment`，逐条批准后执行。

响应包裹为 `success/data/message`。登录身份有 `is_logged_in` 和 `user_id`，执行写操作前必须匹配绑定账号。发布响应缺少笔记 ID 或 URL，不能据此宣称可回查成功。产品绑定仍需精确匹配验证；未完成前提供人工发布材料，不静默降级为普通笔记。
