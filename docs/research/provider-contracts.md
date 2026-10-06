# 模型服务接口调查

2026-10-05。状态：已读取供应商公告所链接集成项目的实际客户端代码，可实现新版契约适配；尚未使用真实凭据验证。

默认图像供应商为用户指定的 GRSai，配置可切换。官方页面可读到旧版 GPT Image 的 `/v1/draw/completions` 和 `/v1/draw/result`；公告又介绍统一 `/v1/api/generate`。因此必须确定所用接口版本和模型，不能混用旧版参数与新版任务查询。

来源：
- https://kb.grsai.ai/dashboard/documents/gpt-image
- https://grsai.ai/zh/dashboard/announcements

公开页面的主机、请求字段与价格未完整读取。仍需核对模型 ID、参考图格式、请求身份、异步任务 ID、查询频次、结果有效期、错误码与当前计费。没有调用付费生成，也没有存储凭据。文案模型未指定，不以当前 Codex 聊天隐式充当后台 API。

适配器契约必须隔离供应商细节：单张生成提交、状态查询、结果下载及失败分类；提交超时不能直接重发计费请求，应先确定供应商是否支持幂等或任务回查。报价缺失时显示无法估算，预算由用户明确设置。

## 新版客户端源码证据

来源：[API 客户端](https://github.com/31702160136/ComfyUI-GrsAI/blob/main/api_client.py)、[配置](https://github.com/31702160136/ComfyUI-GrsAI/blob/main/config.py)。未复制实现代码。

- Bearer 身份验证，POST `/v1/api/generate`，异步参数 `replyType: async`。
- GPT Image 请求包括 `model`、`prompt`、`images`、`aspectRatio`、`quality`；主机和模型必须可配置。
- 保存返回的 `id`，通过 GET `/v1/api/result?id=...` 查询；读取 `status`、`progress`、`results[].url`。
- 已知成功状态 `succeeded`；失败包括 `failed`、`violation`、`cancelled`；未知状态明确报错。
- 示例客户端使用 `gpt-image-2`；不保证用户账户有权限，不内置未经验证的价格。

仍需实测参考图 data URL 支持、结果保存、服务限额。不得把客户端的连接测试照搬为付费试生成。
