# 自营店铺商品同步

商品页及空状态新增「同步我的店铺商品」。选择账号后先检测预览，再一键导入。首次导入待核对，重复导入只更新店铺来源快照和状态，不覆盖本地手工编辑的商品资料，不更改平台商品。

## 当前可用性

界面、服务端预览与事务导入已实现。**真实店铺读取适配器尚未接通，因此默认运行环境暂不能自动读取真实店铺商品。** 内容账号的登录状态不能当成店铺授权。需要确认用户现有店铺访问方式，再实现对应的 reader 并真实验收。

当前无 reader 时接口返回 `SHOP_CONNECTION_REQUIRED`。不存在可配置后立即可用的隐含店铺接口；未将不存在的接口写进小红书连接器。

## 内部读取契约

`Services` 接受 `shopReader(account)`，返回 `{shopId, shopName, complete:true, fetchedAt, products}`。每件商品包含字符串 `productId`、`name`，可选 `url`、`images`、`facts`、`status`。读取器必须先核对店铺身份、读取完整分页，再返回明确的完成标记。未登录、无权限、非自营店铺、分页中断均应报错。

- `POST /api/accounts/:id/shop-preview`：读取并校验结果，返回预览 token 和已导入标记；不新增商品。
- `POST /api/accounts/:id/shop-import`：仅接受预览 token，使用服务端快照导入，忽略客户端伪造商品数据。
- token 有效期 10 分钟、单次使用、绑定账号与内容服务连接，重新检测后旧 token 失效。
- 店铺 ID + 商品 ID 去重；未返回商品不自动删除。写入失败事务整体回滚。
- 远端状态：在售、已下架、售罄、审核中、未知。未知状态不猜测。

验证：`npm test`。`tests/shop-*.test.mjs` 覆盖导入、服务、HTTP 与 UI 渲染；测试 reader 为测试夹具，不是生产连接器。
