# RedNote

以商品为中心的小红书运营工作台，在 Mac 本地保存商品、账号、研究证据、内容版本与审批记录。商品由用户手动上架，不接入千帆 MCP。

## 本地启动

需要 Node.js 22.13 或以上版本，核心服务使用内置 SQLite。无需安装运行时依赖。

```sh
npm start
```

服务默认监听 `http://127.0.0.1:4173`。数据库位于 `data/rednote.sqlite`，请备份整个 `data/` 目录。停止服务后再复制数据库及关联文件。服务关闭或电脑休眠时无法保证定时执行。

配置示例见 `.env.example`，启动时自动读取本目录 `.env`。真实密钥只保存在本地 `.env` 或环境变量，不要上传 Git。不要将本地服务暴露到公网。连接步骤见 [本地服务说明](docs/local-services.md)。

```sh
npm test
```

测试使用临时数据库和明确的测试适配器，不发布真实笔记。部分测试需要允许本机端口监听。

图片支持 PNG、JPEG、WebP，单张不超过 10MB。保存后采用内容哈希命名；请不要手工替换 `data/assets/` 内的文件。参考图和生成图都通过本地素材库进入审核流程。

研究导入格式见 [数据说明](docs/research-import.md) 和 [CSV 表头模板](examples/research-template.csv)。

## 审批规则

1. 确认商品事实与实拍素材，选择账号及内容选题。
2. 审核选题和逐张图片计划后制作图文。
3. 逐篇批准当前图文版本、发布模式及商品关联。
4. 确认账号和精确时间后授权排期。内容批准本身不允许发布。

内容变更会使旧批准失效。错过排期需要重新安排；发布结果不明确时先核对，不能直接重发。点赞和留言也分别需要批准。

## 实施与接入证据

- 产品规格：`docs/superpowers/specs/2026-10-05-rednote-design.md`
- 本地实施计划：`docs/superpowers/plans/2026-10-05-rednote-foundation.md`
- 复用决策：`docs/decisions/0001-reuse-baseline.md`
- 小红书服务能力：`docs/research/tool-capabilities.md`
- GRSai 契约：`docs/research/provider-contracts.md`

真实账号、付费生成、商品挂载和发布回查必须分别验收。测试通过或界面可用，不代表已完成这些外部验收。
