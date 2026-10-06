# 本地服务连接

## 文案与图片

将 `.env.example` 复制为 `.env`，填入文案服务的 `LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`。兼容接口使用 Chat Completions；`LLM_BASE_URL` 应包含服务的 API 基路径，如 `/v1`。

GRSai 使用 `GRSAI_BASE_URL`、`GRSAI_API_KEY`、`GRSAI_MODEL`。模型名和账户权限以供应商控制台为准；示例值不是可用性保证。提交生成可能计费，没有报价时不显示虚构的费用估计。不要通过生成图片的方式自动测试连接。

Codex 协作出图采用导入生成图片的方式，不把当前聊天会话当作无人值守 API。

## 小红书服务

RedNote 通过 [xiaohongshu-mcp](https://github.com/xpzouying/xiaohongshu-mcp) 提供的 HTTP API 复用浏览器能力。按上游说明安装对应 Mac 架构的服务。当前实现与上游源码契约核对过，但尚未完成真实账号验收。

每个账号使用独立服务实例、端口和 cookie 文件。不要让两个 RedNote 账号指向同一已登录实例。建议在 Mac 本机直接运行服务，确保发布进程可以读取 RedNote 本地素材的绝对路径；如果使用容器，必须正确映射素材路径。

上游可用 `COOKIES_PATH` 指定会话文件，用 `AUTH_TOKEN` 配置鉴权，启动参数 `-port=127.0.0.1:18060 -headless=false` 可限制监听并显示浏览器。账号二应使用另一个端口和会话文件。具体登录流程以所安装版本为准。

在 RedNote 的账号设置填写服务地址，例如 `http://127.0.0.1:18060`；`XHS_AUTH_TOKEN` 对应服务的鉴权值。读取登录状态并核对平台账号 ID 后再绑定。服务没有返回可确认身份时，不允许执行发布或互动。

`-headless=false` 只说明窗口可见，不代表已实现指定时长的浏览任务，也不保证平台将自动化视为真人。

## 发布回查边界

已核对的上游发布响应未提供笔记 ID 或链接。因此“请求返回成功”仍需要回查，不能自动当作业务完成。结果未知的任务不得直接重发。

上游挂商品按搜索结果首项绑定，尚不能满足本项目的精确商品验证。此路径在完成验证前必须明确阻止自动执行，可导出已审核图文供人工发布，不能悄悄改成普通种草。

以上依据分别见上游 [入口参数](https://github.com/xpzouying/xiaohongshu-mcp/blob/main/main.go)、[服务请求与响应](https://github.com/xpzouying/xiaohongshu-mcp/blob/main/service.go) 和本项目 `docs/research/tool-capabilities.md`。
