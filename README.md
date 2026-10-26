# Domira Studio v2.0

支持AI空间布局、多房间模型、AR编辑、家具比较、港币报价与五视角渲染的室内设计网页应用。当前发布版本：**2.0.0**，日期：2026-10-26。

- 开发分支：`v2.0`
- 固定版本标签：`v2.0.0`
- 发布说明：[CHANGELOG.md](CHANGELOG.md)
- 已上线网站：https://domira.jiaxun-chen1218.workers.dev/

## 本地开始修改

需要 Node.js 22+，推荐24。运行时依赖已随仓库提供；构建使用 esbuild，首次运行 `npm ci` 安装开发依赖。

```sh
git clone --branch v2.0 https://github.com/jasonChan-max/domira-studio.git
cd domira-studio
npm ci
npm run build
npm test
npm run validate
npm run dev
```

打开 http://localhost:3000/。没有AI密钥时使用明确标注的本地布局引擎；图像渲染和图纸AI分析需要后端服务。完整测试共 **93项通过**：网站67项、保留的装修报价24项、v2路由整合2项。

## 在哪里修改

|目录/文件|职责|
|---|---|
|`public/index.html`、`style.css`、各功能CSS|工作台页面、视觉和响应式布局|
|`public/app.js`|项目状态、编辑、历史记录、保存与功能编排|
|`public/scene.js`、`furniture.js`|Three.js模型、材质、相机、选择/拖动、WebXR显示|
|`src/domain.js`|家具目录、房间校验、生成布局、家具朝向/碰撞/门前空间校正|
|`public/products.js`、`hong-kong-catalog.js`、`product-insights.js`|款式、品牌、港币价格来源、比较与建议|
|`public/home-*.js`|图纸上传/校准、多房间模型与逐房编辑|
|`public/scan-*.js`、`xr-*.js`|扫描流程、测量数据、兼容性与WebXR|
|`public/quote-*.js`|分类报价、估价和总预算|
|`public/render-*.js`、`src/render-domain.js`|五视角、渲染状态、本地恢复、快照与压缩包导出|
|`worker/quote/`、`worker/agents/`、`worker/orchestrator.js`|保留原仓库装修报价、工期、规则与多角色编排模块|
|`worker/`|AI布局、图纸分析、渲染、数据校验和联系接口|
|`scripts/`|本地服务器、构建和工件校验|
|`tests/`|93项回归与整合测试|
|`native/DomiraRoomPlan/`|iOS原生RoomPlan桥接参考工程|
|`cloudflare/`|现有Cloudflare部署配置，不包含密钥|

`public/domain.js`、`public/render-domain.js` 是构建生成文件；修改对应 `src/` 文件后运行 `npm run build`。不需要直接修改生成的 `dist/`。

## v2.0 已包含

- 单层全屋平面图AI分析、人工尺寸核对、最多12个矩形空间与逐房布局。
- 12类家具、36款概念模型和23款品牌备选；价格、评分、材质、优缺点和港币分类预算。
- 真正的AI布局及生成后的朝向校正：座位面向桌几/交流区，工作椅在书桌可使用侧，床头/柜背优先沿墙，旋转后检查占地与已知门口净空。只影响新生成方案，不自动改写手动编辑。
- WebXR hit-test室内测量及AR家具编辑；支持原生RoomPlan数据导入。
- 五个不同角度的1K AI图像渲染、访问码、顺序提交、持久化幂等及浏览器恢复；网站每日张数限制已移除，上游费用照常计算。
- JSON/SVG/PNG/OBJ导出、本地项目和联系接口。
- 保留原仓库独立的装修工程报价面板和 `/api/plan`、`/api/agents`、`/api/knowledge` 接口；规则与价格来自原有数据，应由维护者核实更新。

## 后端与部署

详见 [DEPLOY.md](DEPLOY.md)。保留的Cloudflare配置对应当前项目；在其他账户部署时替换账户/数据库ID、Worker名称与前端/API来源。`.openai/hosting.json` 是原Sites项目标识，只有其授权所有者才能发布到该项目。

本地环境示例在 `.env.example`。真实密钥只放本地 `.env` 或服务器Secret，不能写到 `public/`。主要绑定/Secret：

|名称|用途|
|---|---|
|`LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL`|装修报价后端可选模型配置；未设置时保留原有规则/模拟降级|
|`DEEPSEEK_API_KEY`|服务器AI布局、图纸分析和提示词处理|
|`RENDER_ACCESS_TOKEN`|客户渲染访问码|
|`AI`|Cloudflare Workers AI绑定|
|`RENDER_DB`|D1渲染状态及幂等数据|
|`CONTACT_WEBHOOK_URL` / `CONTACT_WEBHOOK_TOKEN`|可选联系邮件服务|
|`RECONSTRUCTION_ENDPOINT` / `RECONSTRUCTION_API_KEY`|可选独立重建服务|

本地编辑不会自动覆盖生产站，仓库也没有自动部署工作流。

## 数据和实际边界

项目默认存于浏览器，网站与localhost不自动同步，使用JSON导出/导入迁移。图纸AI、几何重建和图像渲染是不同流程：参数化房间/品牌比例模型不是测量级扫描结果。复杂异形、多楼层、楼梯与施工CAD不在当前模型范围内。WebXR需兼容设备与HTTPS；普通iOS Safari不能直接调用原生RoomPlan，需原生桥接或导入。AI图像可能偏离几何，应对照原模型核验。

接口、坐标与历次实现细节保留在 [工程说明及历史记录](docs/architecture-and-history.md)。其中历史段落记录当时的功能及限制，当前状态以本README、CHANGELOG和测试为准。Three.js第三方许可见 `public/vendor/THREE-LICENSE.txt`。
