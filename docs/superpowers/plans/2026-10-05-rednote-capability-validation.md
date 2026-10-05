# RedNote 能力验证与复用决策实施计划

> **面向 AI 代理的工作者：** 使用 executing-plans 逐任务执行；用户明确选择委派时可使用 subagent-driven-development。步骤使用复选框跟踪进度。

**目标：** 得到可复用源码清单及真实工具能力边界，为第一阶段业务代码计划提供可靠输入。

**架构：** 只读调查候选代码与已连接工具，分开记录静态支持、实际通过和阻塞。平台写操作保留至具体内容批准后的验收。

**技术栈：** Git、ripgrep、候选仓库原生依赖与测试命令、MCP 工具发现、官方服务文档。

## 文件与职责

仓库根目录为 `/Users/liuyuxiang05/Liu/RedNote`，以下路径均相对此根：

- 创建 `docs/research/repository-audit.md`：固定 commit、许可证、模块证据、复用代价。
- 创建 `docs/research/tool-capabilities.md`：工具准确身份、schema、字段、权限及验证状态。
- 创建 `docs/research/provider-contracts.md`：GRSai 与文案模型的官方请求响应契约和费用边界。
- 创建 `docs/decisions/0001-reuse-baseline.md`：复用底座、拒选理由、引入方式与升级边界。
- 创建 `docs/superpowers/plans/2026-10-05-rednote-foundation.md`：基于确定源码编写商品、账号、授权核心详细计划。

不创建业务服务、模拟 API 或数据库来绕过调查。文档和原型已在当前主目录，调查文档可在这里完成；源码变更执行前使用 using-git-worktrees 准备隔离工作区。

## 任务 1：建立候选版本与许可证清单

- [ ] 查看工作区状态并读取当前规格。

```sh
git -C /Users/liuyuxiang05/Liu/RedNote status --short
```

预期：区分用户改动与计划文件，不覆盖用户修改。

- [ ] 查询五个候选项目的默认 HEAD，每条命令独立运行；记录完整 SHA。

```sh
git ls-remote https://github.com/JameryW/XhsGrowthAgent.git HEAD
git ls-remote https://github.com/Amazinghorseli/RedNote-Insight.git HEAD
git ls-remote https://github.com/magicpsyche/RedNote-Agent.git HEAD
git ls-remote https://github.com/xpzouying/xiaohongshu-mcp.git HEAD
git ls-remote https://github.com/tian2-ai/xiaohongshu-publish.git HEAD
```

预期：每个结果为 SHA 与 HEAD；网络失败按工具沙箱规则申请执行权限，不把搜索缓存日期当 commit 日期。

- [ ] 使用 GitHub 文件读取或隔离的只读 checkout 查看上述 SHA 下 LICENSE、依赖清单、入口、测试配置及相关源码。写 checkout 前遵守目标路径 Weaver 策略，不能因调查而全量搬入产品目录。
- [ ] 写入 `repository-audit.md`，每个项目一行：URL、SHA、许可证实际文本结论、运行时、目标模块路径、现有测试、复用方式、风险。找不到许可证时标明未确认使用许可，不默认可商用。
- [ ] 提交本任务文档。

```sh
git add docs/research/repository-audit.md
git commit -m "docs: audit reusable repository versions and licenses"
```

## 任务 2：代码级能力核查

- [ ] 在固定版本源码内搜索账号、发布、审批、商品、模拟数据与图片调用入口。对每个仓库在其 checkout 根执行：

```sh
rg -n 'publish|approval|approve|account|product|goods|sku|mock|fixture|seedream|image' backend src tests frontend
```

不存在的目录从命令中移除，记录实际目录；命中字符串仅是定位入口，继续阅读调用链。

- [ ] 对 XhsGrowthAgent 追踪 UI/API 到发布工具的调用链，判断是否能强制统一版本审批、隔离账号及持久化恢复。记录准确路径和函数，不能只记录功能名称。
- [ ] 对 RedNote-Insight 追踪真实数据入口与演示数据入口，确认评论来源、导入契约、聚合字段与数字验证，记录是否实际采集商品销量。
- [ ] 对 RedNote-Agent 追踪商品输入、参考图、生图接口和排版输出，确认可抽取模块，不为生图引入第二套完整前端。
- [ ] 对小红书 MCP 读取工具注册和发布参数，明确是否支持商品 ID、账号隔离、可见浏览器操作及发布结果查询；不把笔记文本中的链接当商品挂载。
- [ ] 对千帆上架 Skill 记录它与“查询已有店铺商品”的差异，不能用其 README 证明存在完整千帆 MCP。
- [ ] 更新审计文档并提交，结论限定为静态代码支持，不宣称实际可用。

## 任务 3：确定真实连接与只读验证

- [ ] 发现当前会话工具，仅按名称和描述查找小红书、千帆、GRSai。没有工具时请求用户提供具体千帆 MCP 项目地址或已配置连接名称；不得扫描打印凭据文件来寻找密钥。
- [ ] 读取已确定 MCP 的工具清单/schema，记录准确工具名、输入、输出、认证方式。分别列出商品列表、商品详情、笔记搜索、评论、账号状态、发布、挂商品、互动和回查能力。
- [ ] 对已授权且已连接账号执行只读查询，验证店铺与商品 ID 能否对应；敏感结果只在本地数据目录保存，文档仅写脱敏证据。
- [ ] 验证两个账号会话对应正确身份。若只有一个实际账号，第二账号隔离记录为未实测，不伪造通过。
- [ ] 写入 `tool-capabilities.md`。状态只用 `静态支持 / 只读实测通过 / 写入待具体授权验证 / 不支持 / 缺少连接`，每项附日期和证据位置。商品挂载必须独立一行。
- [ ] 提交脱敏能力矩阵。

```sh
git add docs/research/tool-capabilities.md docs/research/repository-audit.md
git commit -m "docs: record connector capabilities and evidence"
```

## 任务 4：确定模型接口契约

- [ ] 从用户指定的 GRSai 服务官方文档验证 GPT Image 模型 ID、参考图传参、同步或异步机制、任务查询、失败响应、图片下载有效期与收费口径。不猜测 API 地址或模型名。
- [ ] 明确文字模型独立配置：服务 URL、模型、超时及结构化输出能力；有现有配置则复用，没有则仅向用户收集服务选择，不要求在聊天中粘贴密钥。
- [ ] 写入 `provider-contracts.md`：官方来源、核查日期、脱敏请求响应字段、费用预算判定、重试边界。配置存储引用密钥位置而非密钥本身。
- [ ] 只在出图预算及实际商品素材具备时安排一次单图验证；无预算或凭据时记录具体条件，继续独立的代码调查。Codex 仅保留协作导入契约。

## 任务 5：做底座决策并生成代码计划

- [ ] 比较“改造 XhsGrowthAgent”与“抽取模块形成轻量工作台”，以已有代码可复用程度、依赖复杂度、审批可强制性、账号隔离与本地部署成本做出选择，不以 star 数决策。
- [ ] 写 `0001-reuse-baseline.md`，列出选中仓库及 SHA、引入路径、必须保留的许可证、可复用模块、必须重写模块和拒选理由。不能删除当前规格与设计历史。
- [ ] 用已确定的实际文件路径编写 foundation 详细计划，覆盖商品事实、账号映射、不可变内容版本、内容审批、发布授权、重启持久化和跨账号拒绝。每个代码任务提供失败测试、运行命令、最小实现与通过条件。
- [ ] 测试最少覆盖：未批准拒绝、图文变化失效、仅改时间需重授权、目标账号变化拒绝、挂商品失败不降级、未知执行结果禁止直接重试。纯文档调查不创建形式化空测试。
- [ ] 对照总路线确认其余阶段仍有归属，检查计划无占位任务，提交决策和代码计划。

```sh
git add docs/research/provider-contracts.md docs/decisions/0001-reuse-baseline.md docs/superpowers/plans/2026-10-05-rednote-foundation.md
git commit -m "docs: select reuse baseline and plan foundation implementation"
```

## 阶段完成标准

仓库版本与具体代码证据已固定；工具和服务能力逐项有状态；底座选择有可审查理由；第一阶段代码计划使用真实路径。真实连接缺失时可以完成静态调查，但不得把未实测连接标为通过。全产品开发不因只完成本阶段而宣称完成。
