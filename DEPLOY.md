# Domira v2.0 部署

## 从源码构建

```sh
npm ci
npm run build
npm test
npm run validate
node scripts/build-cloudflare.mjs --api-url https://domira-api.jiaxun-chen1218.workers.dev --web-origin https://domira.jiaxun-chen1218.workers.dev
```

部署到其他地址时替换这两个确切HTTPS origin。构建会将API来源写入前端，后端CORS只接受对应前端。

## Cloudflare

1. 由项目拥有者登录Wrangler；此仓库不包含登录凭据。
2. 在 `cloudflare/api.wrangler.jsonc` 和 `web.wrangler.jsonc` 核对账户、Worker名称与D1数据库ID。部署到新账户需先创建自己的D1数据库。
3. 为API Worker配置 `DEEPSEEK_API_KEY` 和 `RENDER_ACCESS_TOKEN` Secret，以及 `AI` / `RENDER_DB` 绑定。可选联系和重建服务使用 `.env.example` 中的变量名。
4. 使用本机安装的Wrangler分别发布：

```sh
wrangler deploy --config cloudflare/api.wrangler.jsonc --keep-vars
wrangler deploy --config cloudflare/web.wrangler.jsonc --keep-vars
```

`--keep-vars` 保留已有服务变量；不要提交任何实际密钥。此步骤会更新配置中指定的线上Worker，由维护者按需要执行。

## 使用部署包

解压 `domira-studio-v2.0-deploy.zip`，进入其中的 `domira-studio-v2.0` 文件夹；包内保留 `dist/` 与 `cloudflare/` 的相对目录结构，可按上面的Wrangler命令部署。部署包的前端/API origin沿用当前线上地址，若需改地址请从源码重新构建。

`dist/server/index.js` 和 `dist/.openai/hosting.json` 为原Sites Worker工件。Sites发布仍需平台上的项目授权和源版本管理，单独下载文件不会授予原项目访问权限。

运行时密钥、客户设计、浏览器存储、图片和认证缓存均不在发布包中。
