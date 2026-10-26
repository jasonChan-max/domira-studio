# GitHub 与 Cloudflare 持续同步

源码以 `jasonChan-max/domira-studio` 的 `v2.0` 分支为准。GitHub网页编辑、合并PR或本地push到该分支，都会触发 `.github/workflows/cloudflare-sync.yml`。

## 发布流程

1. GitHub Actions 使用Node.js 24安装锁定依赖，运行全部测试、构建和工件校验。
2. 测试通过后发布 `domira-api`，再发布 `domira`，保留原有Secret、D1及AI绑定。
3. 自动比对前端与API的提交SHA，并校验所有前端文件的SHA-256。验证失败会让工作流失败，不标成同步成功。
4. `production` 环境与Actions日志保留每次发布记录。Actions页也可以手动运行该工作流。

`main`保留历史版本，默认和生产分支为`v2.0`。其他开发分支通过PR合并到`v2.0`后上线。PR只运行检查，不获取部署凭据。

## 一次性配置

- Repository Actions Secret：`CLOUDFLARE_API_TOKEN`。按Cloudflare官方“Edit Cloudflare Workers”模板创建，资源限制到本项目所在账户。当前Worker还有D1和Workers AI绑定，必要时加入对应权限。
- Repository Variable：`CLOUDFLARE_ACCOUNT_ID`，已写入本项目账户ID。
- 部署令牌只存GitHub加密Secret。`DEEPSEEK_API_KEY`和客户`RENDER_ACCESS_TOKEN`继续保留在Cloudflare Worker中，不复制进GitHub源码。

创建部署令牌并输入Secret需由账户拥有者亲自完成，不能把令牌发到聊天或提交Git。

## 如何确认两端一致

- 前端：https://domira.jiaxun-chen1218.workers.dev/deployment-info.json
- API：https://domira-api.jiaxun-chen1218.workers.dev/api/version
- 两处`sourceCommit`应与GitHub当前已成功发布的提交相同。
- 本地在同一提交构建后运行 `npm run verify:cloudflare`，检查完整资产清单。

Cloudflare是部署结果；直接在Cloudflare控制台修改代码不会反向生成Git提交。维护时从GitHub更新再发布，防止后续自动部署覆盖临时控制台修改。本地浏览器客户设计、图像、D1数据和运行时Secret不是Git源码，不纳入文件同步。

## 失败与恢复

测试失败则不部署。API与前端为两个Worker，发布期间可能短暂先后更新；最终校验只在两者版本一致时通过。若某一步失败，修复后重新运行同一提交的工作流，或从已推送的已知良好提交部署两端。不要仅回滚一端，也不要用改写Git历史的方式修复一次部署。

官方参考：[Cloudflare GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)、[创建API令牌](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/)。
