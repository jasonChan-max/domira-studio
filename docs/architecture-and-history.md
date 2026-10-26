# Domira Spatial Studio

深黑、薄边框、玻璃质感与薄荷绿／紫色 Ambient Glow 的 AR 室内设计 MVP。前端为原生 ES modules + Three.js，后端为可部署的 Cloudflare Worker。无需安装 npm 依赖，Three.js 0.170.0 已随项目提供（MIT）。

## 本地运行

需要 Node.js 22 或更新版本。在本目录运行：

```powershell
node scripts/build.mjs
node scripts/dev.mjs
```

打开 http://localhost:3000。构建会同步前后端 domain.js；修改领域逻辑后需重新构建并重启开发服务器。

```powershell
node --test tests/*.test.mjs
node scripts/validate-artifact.mjs
```

配置服务时，将 .env.example 复制为 .env 填写自己的服务地址及密钥，再运行 `node --env-file=.env scripts/dev.mjs`。生产环境通过 Sites 的运行时环境变量配置；不要把密钥写入 public/ 或 hosting.json。

## 能力与实际边界

- 已实现：真实 getUserMedia 摄像头捕捉、多个角度的缩略影像、尺寸校验、矩形参数化房间、6 类程序化 3D 家具、本地布局、拖动／旋转／数值编辑／复制／删除、撤销重做、俯视平面图、自动保存、多项目与 JSON 重新导入。
- 扫描默认是**摄像头引导 + 用户实测尺寸**，不是单目 SLAM、LiDAR 或摄影测量。不能把拍摄数量或示例房间当作重建成功。可在未授权摄像头时使用手动尺寸继续。当前范围限定为矩形房间，无门窗语义重建；示例窗与挂画仅为场景示意。
- 自动重建通过 RECONSTRUCTION_ENDPOINT 接入；配置后用户须明确勾选上传影像。MVP 使用服务返回的矩形尺寸重建房间，不消费任意三角网格。真实重建质量、尺度校准与服务提供方由集成方负责。
- AI 通过 LAYOUT_ENDPOINT 接入；未配置时明确显示“本地空间规划引擎”。本地引擎依尺寸、风格、用途及偏好规划位置，并用保守 AABB 检查碰撞；不宣称是远程 AI 模型。动线偏好不是建筑规范级通行宽度保证。
- WebXR：支持设备可请求 immersive-ar + hit-test，在实际地面放置整套家具；再次选择家具并点击地面移动，工具栏旋转。需要 HTTPS 和兼容设备，尚须在实际 AR 手机验收。设备兼容性参见 https://developer.mozilla.org/en-US/docs/Web/API/WebXR_Device_API 。
- 非 WebXR：真实摄像头画面 + 3D 家具叠加，需手动对齐。没有世界锁定、真实比例校准或真实遮挡。不会将此模式标示为空间追踪。
- JSON 保存全部场景数据；PNG 为当前 3D 透明背景效果图，不包含摄像头照片；SVG 为家具平面图；OBJ 包含房间与家具的当前变换网格（公尺单位、不含材质、灯光或纹理）。
- 联系接口已保留并校验输入；未配置邮件 webhook 时返回 503 和直邮入口，不显示虚假的发送成功。

## 可运行项目结构与职责

```text
public/
  index.html       工作台、流程导航、编辑面板与弹窗宿主
  style.css        深黑玻璃视觉、响应式、Hover、键盘焦点、减少动态偏好
  app.js           单一项目状态、流程编排、摄像头生命周期、编辑命令、持久化、导出
  scene.js         Three.js 几何、渲染、射线选取、拖动、相机、WebXR、OBJ 导出
  domain.js        构建生成，不要直接编辑
  vendor/          固定版本 Three.js 及 MIT 授权
src/
  domain.js        领域契约、家具目录、尺寸校验、布局、边界裁切、碰撞检查
worker/
  index.js         health / layout / reconstruct / contact API，密钥仅在服务器
scripts/
  dev.mjs          无依赖本地 HTTP + Worker API 适配服务器
  build.mjs        将本地资源与领域代码打包为单个 Worker ES module
  validate-artifact.mjs  校验部署工件
 tests/
  domain.test.mjs  房间范围、碰撞、朝向与用途／偏好测试
  api.test.mjs     API 成功、无服务、错误方法、错误输入与大小限制测试
.openai/hosting.json    Site 身份与部署配置
.env.example           服务接入变量示例（不含密钥）
dist/server/index.js   可部署 Worker（构建生成）
```

## 数据流与职责边界

```text
摄像头帧（仅记忆体） + 实测尺寸
        │             │
        │ 用户勾选上传 │ 本地引导路径
        ▼             │
POST /api/reconstruct │
        └──────┬──────┘
               ▼
 Room {width, depth, height, source, units, coordinateSystem}
               │
               ▼
 Project {schemaVersion:1, id, name, room, style, purpose, preferences, items}
               │ 尺寸与偏好；不传摄像头原图
               ▼
 POST /api/layout → {items, engine, description}
               │
               ▼
 编辑命令 → 边界裁切 → 碰撞提示 → 更新 items[x,z,rotation]
               ├── Three.js / 平面图 / WebXR 使用同一个场景状态
               ├── 历史快照（最多 40 次）/ localStorage（最多 20 个项目）
               └── JSON / PNG / SVG / OBJ 导出
```

坐标契约：右手坐标、Y 向上、公尺，房间原点为地板中心。家具 x/z 为地面位置，rotation 为从平面图向下看的顺时针角度（度）；Three.js 中转为 Y 轴负弧度。模型的 w/d/h 为宽深高。编辑只修改家具实例，不回写原始捕捉帧，也不变更房间几何。更换扫描创建新项目，保留旧项目。AR 世界坐标锚点仅存在于渲染层，不写进导出项目。

localStorage 属于当前 origin，同一浏览器的 localhost 与线上版本不会自动共享项目；需要 JSON 导出／导入迁移。尚无账户、多端同步或后端项目数据库。关闭扫描、切换预览、隐藏页面与离开页面会清理相应摄像头流；扫描帧不会永久保存。

## 后端接口契约

原 Sites 部署 API 同源；独立 Cloudflare 前端通过 `api-config.js` 连接专用 Worker，CORS 只允许该前端 Origin。`/api/health` 与 `/api/render/capabilities` 为 GET，其余为 POST。普通请求体上限 80,000 字符；渲染为 7.5 MB。通过本地缩略帧减小重建请求，正式大图上传应改为私有对象存储和任务队列。

| 路由 | 请求 | 成功／未配置行为 |
| --- | --- | --- |
| /api/health | 无 | `{ok,layout,reconstruction,contact}`，供前端能力检测 |
| /api/layout | `{room,style,purpose,preferences,variant}` | `{items,engine,description}`；未配置远程服务时使用 local-rules |
| /api/reconstruct | `{frames:[{id,capturedAt,image}],room}` | 服务返回 `{room:{width,depth,height,...}}`；未配置返回 501，前端保留引导模式 |
| /api/contact | `{name,email,message,website,projectId}` | 配置 webhook 并收到 2xx 才返回 `{ok:true}`；未配置返回 503，参数错误 400，频率限制 429 |

布局服务返回的每个家具至少包含 `{id,type,name,w,d,h,color,x,z,rotation}`，type 为 sofa/chair/table/plant/lamp/rug，所有数值须有限。前端会裁切越界坐标。接口适配器支持 `LAYOUT_API_KEY` 与 `RECONSTRUCTION_API_KEY` Bearer 认证；服务端必须将自然语言模型输出转成此场景契约。

联系 webhook 接收 `{to:'info@duomo.ltd',name,replyTo,message,projectId}`。收件人为服务器固定值，不接受前端改写；可配置 CONTACT_WEBHOOK_TOKEN Bearer 认证。字段限制：姓名 1–100 字、有效 Email（最多 254 字）、消息 10–5000 字；website 为蜜罐，单 isolate 内同 IP 30 秒限流。正式公开运营需在网关补持久化限流、反垃圾与邮件重试，并配置发信域验证。当前无配置时不会发送任何邮件。

## 验收标准

1. 首屏显示深黑工作台、Ambient Glow、玻璃卡片、完整四步流程与可交互 3D 客厅；窄屏排成单列，家具库可添加，顶部保留项目／联系入口。
2. 点击扫描可请求真实摄像头；允许后能显示视频并捕捉最多 8 帧；拒绝后显示说明且仍可输入实测尺寸。无重建服务时不出现假的自动重建进度。
3. 宽深范围 2–15m、高 2–6m，错误数据不能提交；新建尺寸会改变房间模型及面积，创建新项目而不覆盖旧项目。
4. 点击生成返回真实家具实例，风格切换改变材质颜色，用途／植栽偏好改变布局；未接 AI 时界面明确展示本地引擎。默认各支持尺寸样本无家具碰撞且不越界。
5. 家具选取显示名称和坐标，拖动改变 x/z，旋转改变朝向；越界被限制、相交被提示；撤销／重做恢复场景；刷新后恢复最终状态。
6. 切换平面图能俯视房间与家具；重置、缩放、相机旋转可用。实际支持 WebXR 的手机可找到地面、点选放置、移动和旋转家具并结束会话；不支持时明确为手动摄像头叠加。
7. 四种导出可下载并包含当前调整；导出 JSON 重新导入后重建相同的尺寸、家具位置与朝向。无 WebGL 时显示明确错误，不承诺渲染成功。
8. 联系表单拒绝缺少字段或过短消息；未配置服务显示可理解错误与 info@duomo.ltd 入口；配置后仅 webhook 接受成功才提示已交付。
9. `node --test tests/*.test.mjs` 与构建工件校验通过。摄像头权限、实机 WebXR 和真实 AI／重建／邮件服务须由相应设备与服务完成联调验收。

## 验证记录

2026-10-25：Node 领域／API 9 项自动测试通过；浏览器已确认 3D 渲染、平面图、家具拖动、角度更新。其余浏览器核对及部署结果由交付信息记录。未使用实际用户影像、未发送邮件、未调用未配置的模型服务。

## 2026-10-25 家具库与 WebXR 更新

- 新增 18 款概念家具：6 类、每类 3 种轮廓。另收录 10 个可加入／替换场景的品牌选项，涵盖 IKEA、MUJI、NITORI 与 YIGO。
- `public/products.js` 维护型号、类型、尺寸、材质说明、参考价格、来源、查询日期、编辑优缺点、分项评分及有证据的买家评分快照。`price=null` 的原创概念不会生成虚构报价或品牌评分。YIGO 的尺寸及 NITORI 的厚度明确标示为示意值。
- `public/library.js` 提供品牌／概念切换、6 类筛选、品牌筛选、搜索、价格／评分排序、单件分析、最多 3 件横向比较、添加与替换。替换保留原家具实例 ID、位置与朝向，重新检查房间边界。相交会提示。不同类别一起比较会显示不可直接判定优劣的说明。
- 价格均为台湾 TWD 静态快照，查询日 2026-10-25。MUJI 2025 AW 型录明确另标年份；不将型录价称为当前售价。页面附官方／品牌直营来源，缺货／售罄状态同样为查询快照，不自动实时更新。品牌模型均为自制比例示意，非官方 CAD。
- 编辑评分：价格竞争力 25%、材质配置 20%、维护便利 20%、使用弹性 20%、房间适配 15%。前四项为依据规格的编辑估分；房间适配按 `9.8 − 占地比例 × 12` 限制到 3–9.6，尺寸无法放入时为 0。综合分为加权和，保留一位小数；星级为综合分 ÷ 2，保留一位小数。用户可在“评分怎么算”查看方法。编辑星级不混同买家星级；买家星级包含样本数与独立来源链接。
- `public/furniture.js` 将建模独立成模块：布料微纹理与 bump、木纹、石材纹理、绗缝与滚边、弯木框架、渐细桌腿、灯罩／金属材质、编织地毯／流苏、弯曲叶片与枝条。材质由确定性程序生成，不依赖远程纹理下载。实际模型的宽深以保存尺寸归一化；桌面小物不计入桌子本体高度。
- `public/scene.js` 按家具实例缓存网格，仅在款式／材质／尺寸改变时重建；拖动仅更新 transform，改善精细模型的移动性能。
- JSON 新增并保留 `productId`、`modelStyle`、`brand`、`material`、`priceSnapshot{amount,currency,checkedAt,kind,source}`；旧 schemaVersion 1 项目继续可用，缺少款式时使用默认造型。导入保留家具名称与型号资料。
- `public/xr-support.js` 独立处理安全上下文、WebXR API、immersive-ar 能力检测、错误说明与跟踪提示。XR 请求 `requiredFeatures:['hit-test']`、可选 DOM overlay 和 local-floor；沿用公尺坐标，筛选法线朝上的地面，按真实 1:1 比例放置。编辑 HUD 提供家具列表、左右 15° 旋转、重放整套设计与退出。DOM overlay 的 beforexrselect 防止控件点击误触地面，未支持时保留系统退出与场景点选。会话失败／结束会清理 hit-test source 和 reticle 并恢复 3D。

新增验收：搜索品牌与类别能交叉筛选；2–3 件家具可开启比较；编辑得分和买家得分不混用；单件家具能替换而不改变原摆放；JSON 导出／导入保留型号与参考价来源；所有 28 个模型的顶点有限且宽深匹配保存尺寸；不支持 WebXR 的设备明确显示实际检测结果，摄像头叠加不称为空间追踪。

自动化验证为 17 项：原有 9 项，新增产品数据／评分公式／JSON 资料／所有模型几何以及 XR 能力检测、失败清理、地面筛选与原尺度放置。浏览器已检查品牌比较、单件分项分析、加入、替换与 WebXR 不支持路径。当前测试电脑没有 immersive-ar 装置，真实手机 hit-test、DOM overlay、跟踪中断与 1:1 放置仍需实机验收。

## 五角度 AI 渲染与消费限制

- `public/furniture.js` 提高曲面细分、512px 程序纹理；`scene.js` 使用 Three.js RoomEnvironment/PMREM 环境反射、接触阴影和高分辨率截图。模型仍为可编辑的比例示意，并非品牌官方 CAD 或扫描重建网格。共享材质及可见缩略图延迟生成控制 GPU 消耗。
- `src/render-domain.js` 定义唯一场景快照、五个不同相机、固定 1K（1280×720）输出和校验规则。`scene.captureFrame` 用同一场景生成参考图，最后恢复工作台视口及辅助元素。编辑坐标不受截图影响。
- `public/render-studio.js` 负责五视角选择、水平/俯仰/距离调整、使用当前工作台相机、统一灯光与材质偏好。点击开始后冻结项目及相机并计算 SHA-256 指纹；编辑原项目后不混用旧批次。先生成一张确认，再手动继续剩余四张；顺序调用，无自动重试。
- `public/render-client.js` 读取 NDJSON 心跳及真实结果；`render-store.js` 将快照、状态和完成图片存到当前浏览器 IndexedDB。刷新恢复已完成图片，将在途任务标为中断，不自行再次调用 AI。关闭页面会停止客户端连接；已提交的云端推理可能继续。
- `worker/render.js` 校验访问码、场景指纹、五个不同角度与图片头；`worker/render-quota.js` 使用 D1 单条原子 SQL 在推理前登记幂等请求。每日张数限制已解除；D1 保留提交记录和幂等缓存。记录服务失败时关闭生图，避免重复提交。相同批次/视角/尝试编号+相同请求哈希可返回已保存结果，不重复推理；内容变更返回 409。结果过大无法保存到 D1 时不会自动重生，客户应立即下载。
- DeepSeek `deepseek-flash` 只负责每批最多一次材质文字整理，关闭 thinking、最多 240 输出 tokens，输入为家具材质与灯光数据；不将摄像头帧发送给 DeepSeek。失败时保留模板提示词，无自动重试。实际生图使用 Cloudflare Workers AI `@cf/black-forest-labs/flux-2-klein-4b`，以当前角度及鸟瞰两张 512×288 参考图执行图生图。结果可能偏离几何细节，需客户对照确认。
- `/api/render/capabilities` 返回配置状态、模型、固定尺寸及 `{usage:{day,timeZone,limit,used,remaining}}`；`POST /api/render/shot` 接收 `{batchId,shotId,attempt,project,fingerprint,views,slotIndex,settings,reference,contextReference}`，以 Bearer 渲染访问码认证，返回 started/heartbeat/completed/failed。API 密钥只存 Cloudflare Secret，不打包到前端。
- `render-archive.js` 导出原生 ZIP：五张 3D 参考/已完成 AI 图及 `design-manifest.json`（快照、相机、模型、实际尺寸、时间）；支持 PNG/JPEG/WebP 扩展名。没有真实 AI 结果时不会标成渲染完成。

Cloudflare 配置：独立 API Worker 绑定 `AI` 和专用 D1 `RENDER_DB`，设置 Secret `RENDER_ACCESS_TOKEN`，可选 `DEEPSEEK_API_KEY`；运行 `node scripts/build-cloudflare.mjs --api-url https://<api-origin> --web-origin https://<frontend-origin>`，上传 `dist/cloudflare/assets/` 为静态前端，`domira-api.js` 为 API Worker。原 Sites 可设置 `RENDER_PROXY_ORIGIN` 指向该 API，共用同一配额。数据库首次请求自动建表。不需要 R2；当前没有跨设备渲染项目同步。Workers AI 的免费额度由 Cloudflare 账户共享，移除站点张数限制不代表上游服务免费或无限额度；本流程不升级付费套餐。

新增验收：五个不同视角可以逐个调整，重复角度禁止提交；输出仅为 1K；首张完成后停止并等待客户继续；可建立不限数量的批次；已完成图可独立或整套下载，刷新恢复；3D 参考与 AI 图明确区分；无访问码/错误访问码均不能调用服务；第六个及更多新请求允许提交；相同请求重复返回缓存，变更内容拒绝；失败记录状态且没有自动重试；数据库不可用时禁止推理；每日用量按 Asia/Taipei 统计，不设置名额上限。自动检查共 26 项通过，包括所有家具几何、渲染请求、流式解码、ZIP CRC、恢复策略与真实 SQLite 上的配额 SQL。真实生图、摄像头及 WebXR 实机结果以现场验收记录为准。


## 当前版本：尺寸跟随、真实 AI 风格布局、香港家具库

2026-10-25 更新（本节覆盖此前版本的台币、数量与每日 5 张规则）：

- 预览长宽标注使用 `public/dimensions.js`，从房间实际边缘经 Three.js 世界/相机矩阵投影到画布；同时显示长与阔，旋转、缩放、平面图、窗口尺寸变化同步更新。14px 高对比深色底标签与端点尺寸线提高可读性，AR 中隐藏普通房间标注。
- `worker/layout.js` 调用已有 DeepSeek Secret 对应的 `deepseek-flash`，关闭 thinking、JSON 输出、最多 2200 输出 tokens，单次生成无自动重试。输入仅房间尺寸、风格、用途、偏好与 12 类可用家具；AI 决定款式、组合、坐标、朝向与颜色。服务端按真实家具尺寸校验边界与碰撞，必要时作最小安全位移；不合法或上游失败会保留原设计，不伪装成本地 AI 成功。前端生成期间设计条件改变则拒绝套用过期结果，导出保存模型名称与设计说明。
- 原 Sites 的 `RENDER_PROXY_ORIGIN` 同时转发 layout、health 与 render 路由，复用 Cloudflare API 中的 DeepSeek 配置。独立 Cloudflare 前端使用限定 Origin 的 CORS；没有把 API 密钥发给浏览器。
- 扩充为 12 类、36 款原创概念，以及 23 个品牌/系列选项，总计 59 个可加入场景的选项。新增睡床、书桌、收纳柜、书架、餐桌与凳子；三种主要轮廓分别建模。品牌示意继续明确标注非官方 CAD，不把未核实尺寸当作商品实测。
- `public/hong-kong-catalog.js` 维护香港查询价；界面、比较与新导出价格统一 HKD/HK$。保留原有台湾资料供规格参考，未核实的香港售价显示“HK$ 报价待核实”并暂不计算品牌评分，不把原台币数值直接改币种。香港可核实价以 IKEA 香港、MUJI 香港和 Pricerite 官方页面为来源；每项附来源与查询日。价格是静态查询快照，最终组合、库存、配件、组装与运输以商户为准。
- 家具库按类别 → 品牌分组，支持类别和品牌交叉筛选、同类横向比较；原创概念和品牌选项分开展示。新 JSON 导出保留港币价格来源，旧项目的商品价格快照从已更新目录迁移；未知香港报价不生成虚构金额。
- 渲染取消每日张数上限，仍保留访问码、固定五角度批次、首张确认、同一请求幂等保护和逐张保存。每日统计返回 `limit:null,unlimited:true,remaining:null`。上游服务额度、计费与频率限制仍适用，不升级套餐。

本地运行：`node scripts/build.mjs` 后 `node scripts/dev.mjs`；需要本地复用已部署 AI 时，在启动进程环境中设置 `RENDER_PROXY_ORIGIN` 指向 API Worker。开发服务器处理 Node fetch 自动解压的代理响应，移除旧 content-encoding/content-length，避免浏览器解码失败。

新增验收：长宽两个标签在视角旋转与缩放后屏幕坐标变化且数值保持公尺；三种风格请求都携带独立风格描述；真实 AI 方案返回 `engine:remote-ai,model:deepseek-flash`；两种风格的家具组合与摆放有差异；新增六类可加入、编辑、渲染并导出；同类不同品牌清楚分组；香港价为 HK$、来源可查，未核实报价不显示数字；超过五个渲染提交不受站点每日上限拦截，同一已完成请求不重复调用。


## AR 测量与家具建议更新

- `public/xr-scan.js` 独立执行 WebXR `immersive-ar` / `hit-test`。仅接受朝上地面，定位稳定至少 400ms、误差范围 2.5cm 后才允许标记；三个相邻地面角点用于估计矩形长宽。共面、角度、重复点和尺寸均验证，失去跟踪会禁用标记。层高由用户实测确认。这是米制地面测量与参数建模，不是完整深度网格重建。
- `public/scan-studio.js` 负责采集 UI、权限、结果复核、取消和相机清理。`scan-domain.js` 校验角点与 RoomPlan 墙面矩阵，重新计算包络尺寸，不信任输入文件声称的房间尺寸。扫描确认后创建新 Project；`room.measurement` 保存测量方法、原始角点或墙面、置信度与归一化信息，编辑只修改家具。JSON 项目导入时再次校验测量资料。
- `scene.js` 根据 RoomPlan 的原始墙面矩阵重建透明墙体，地板仍为包络矩形；WebXR 为矩形参数房间。手动改动已测尺寸后，明确标为测量后调整，并使用参数墙体。不会向测量房间添加虚构窗户或装饰；门窗开洞、原有家具识别导入尚未实现。
- Safari 没有直接调用 Swift RoomPlan 的通路。`native/DomiraRoomPlan/` 提供 iOS 16+ 原生 RoomPlan + WKWebView 工程：检测 LiDAR、请求相机、扫描、JSON 分享及同源请求 ID 桥接。Safari 可导入该工程输出的 `domira.roomplan.v1` JSON。仅检测到真实原生消息桥接时才显示直接启动按钮。当前 Windows 环境不能完成 Xcode 编译签名与 LiDAR 真机验收，详细步骤见该目录 README。
- `worker/layout.js` 在一次 DeepSeek 请求中生成布局、逐件选择理由和已收录产品 ID；`product-insights.js` 过滤不存在、不同类别和尺寸放不下的选项。价格和规格始终取本地有来源目录。模型未选产品时明确显示“目录匹配备选”，不伪装成 AI 选择。仅向布局 API 传房间长宽高和偏好，不传原始墙面矩阵、角点或相机影像。
- `library.js` 显示 AI 选择理由、品牌备选、港币参考价、优点与留意事项；支持定位到相应实例并替换。家具选择栏勾选 2–3 件可直接比较造型、材质、保养、用途、占地和房间适配，完整对比保留价格、优缺点和评分。未知规格不生成虚构结论。

新增验收：支持 WebXR 的实机完成 A→B→C 标记与取消，卷尺核对尺度；跟踪中断不能提交过期位置；不支持时显示检测结果。导入四墙测试数据得到 6×4×2.7m 房间及实际墙体，JSON 导出再导入保持测量信息。真实 AI 返回逐件理由和有效同类产品；建议按钮可查看及替换。选中两件同类商品在选择栏直接看到特点差异，HK$ 和未知报价标识正确。所有新软件路径有自动测试；实际 WebXR 手机、iOS Safari、原生 Xcode 编译和 LiDAR 精度仍需对应设备验收。


## 分类报价与整套采购预算

`public/budget-domain.js` 独立计算港币参考价、估价和当前设计预算；`quote-studio.js` 提供侧栏和编辑区两个“查看报价”入口。当前设计按类别分组，同型号合并数量，逐项显示单价区间、数量、小计、价格依据与日期。全部家具标签展示 12 类 59 款选项，未加入设计的选项不计入总额；类别筛选只影响明细显示，不改变整套总额。

有香港价格快照的型号保留原价及来源。无核实售价的品牌型号和原创概念采用 Domira 的编辑选购预留，按类别基准、造型系数或型号预留区间推估，不从台湾售价换算，不标为商户正式报价。所有估价在家具卡片以“约”和估价标识显示；不写入 `price` 或 `priceSnapshot`，不参与编辑价格评分。尺寸经调整或导入的未知型号也使用同类估价，不信任导入的价格快照。

预算下限／上限 =（家具对应下限／上限 + 用户送货预留 + 用户安装预留）×（1 + 备用金比例），按港币分四舍五入；预期开销是两端中位数，非有统计置信度的预测。默认备用金 10%，送货安装为 0 表示未预留，不承诺免费。支持填写目标预算并提示覆盖区间、区间内或最低已超预算。费用设置保存于当前项目的 `quoteSettings`，JSON 导出导入保留；CSV 导出包括分类、数量、估价依据、费用和总额，防止文本成为电子表格公式。未包含装修、床褥及其他未列配件，用户自行确认。

新增验收：59 款全部有真实参考价或标明性质的正值估价区间；重复家具数量及类别小计准确；增减和替换后预算变化；空设计显示引导；费用、备用金、预算区间判断准确；全部家具报价不混入当前项目总额；CSV 可下载并保留港币明细。手机窄屏允许横向滚动明细表，其余表单和汇总单列显示。


## 平面图 AI 识别与全屋模型

`worker/floorplan.js` 提供 GET `/api/floorplan/capabilities` 与 POST `/api/floorplan/analyze`。调用现有服务器端 DeepSeek Flash 视觉接口，真正发送图片内容，单次一张、最长 1600px、压缩后最大 1.4MB、4500 输出 tokens、55 秒超时，无自动重试。浏览器只允许 JPG/PNG/WebP，PDF 需先转图片。服务端限制请求流大小、校验图片类型，按 IP 做 30 秒 isolate 内限流（不是全局持久配额）。原始图片不保存到项目或后端数据库；浏览器需用户确认后才发送图纸。不得把密钥写到前端。

`public/home-domain.js` 定义 AI 归一化图纸结构和 `domira.home.v1` 米制单层模型：最多 12 个空间，外框 2–40m，单间 0.6–20m，层高 2–6m。房间包括名称、用途、相对中心、长宽、置信度、门窗位置及独立家具数组。首版采用互不重叠的轴对齐矩形近似；复杂异形房间需拆分并核对，不支持多楼层、楼梯关系、曲墙或施工级 CAD。

`home-studio.js` 负责上传、压缩、同意传图、AI 结果预览和尺寸确认。结果与原图对照，可修正房间名称、用途、坐标、尺寸、增删空间；无有效比例时不声称已有真实尺度，用户必须填入全屋长宽并确认。`home-scene.js` 合并共享墙，按门窗位置开洞，生成 Three.js 建筑模型；空间标签随相机投影，点击后进入该房间编辑。厨房、浴室、走廊等先提供建筑模型和通用家具试搭，尚无专用厨卫设施自动设计。

项目仍兼容原 schemaVersion 1，新增 `home`、`activeRoomId` 与 `homeView`。单房编辑使用米制局部坐标；保存/切换房间前回写对应 `home.rooms[].items`，总览按房间中心转换为全屋坐标。全屋总览可旋转缩放，平面图可查看全层，逐房 AI 布局不会自动连发付费请求。全屋最多 120 件家具、单间最多 50 件。报价汇总所有房间，渲染和 AR 默认作用于当前房间，避免把整屋建筑误当成单房尺寸渲染。JSON 保存完整整屋及家具，SVG 导出全层建筑平面，OBJ/PNG 反映当前总览或房间视图。

新增验收：真实视觉请求能从合成测试图返回对应空间；原图与识别图对照后核对比例，模型在工作台显示所有房间和门窗；跨房间编辑后总览、刷新、JSON 导入导出均保留；报价按全屋家具合并数量；无服务、无效图片、超大请求、无房间结果和重叠空间均不伪造成功。AI 识别存在误差，实际用户图纸仍需逐间核对。

官方视觉接口参考：https://api-docs.deepseek.com/guides/vision/


Cloudflare 可复现发布配置：`cloudflare/api.wrangler.jsonc` 保留既有 AI、RENDER_DB 绑定及必需 Secret 名称；`cloudflare/web.wrangler.jsonc` 仅上传 `dist/cloudflare/assets`。配置中没有密钥值，使用本机已有 Wrangler 登录。先运行两个构建脚本，再分别以 `wrangler deploy --config ... --keep-vars` 发布；私有 Sites 版本仍使用 Sites 的源码与工件发布流程。


## 生成布局的家具朝向校正（2026-10-26）

新生成的 AI 与本地方案使用 `src/domain.js` 的 `refineLayoutOrientation`；不在加载旧项目、手动移动/旋转或选择品牌时自动改动用户设计。旋转与家具模型、SVG、AR一致：0°朝+Z、90°朝−X、180°朝−Z、270°朝+X，朝向目标的角度为 atan2(−dx,dz)。

沙发/休闲椅朝向茶几或交流座位；工作椅须在书桌正面并面向桌子；餐椅面向餐桌。床头是本地−Z，床/书桌/收纳柜/书架优先平行靠墙且正面朝室内。保留合理的小角度交流布局，改变角度时同时检查实际旋转占地；必要时小幅平移以解决碰撞，不静默删掉家具。无法得到安全朝向/边界/门前空间时明确失败，浏览器保留原设计。

单房生成请求携带经筛选的 `room.planRoom.openings`，不会将全屋所有门窗混入当前房间。已知门口保留约0.8m深的矩形净空，高家具避免覆盖已知窗侧区域；没有门窗数据时不虚构入口或窗户。不包含门扇真实开启方向、建筑规范合规或轮椅可达性认证。前方使用区是近似检查，用户仍需按实物核对。

AI家具建议新增“朝向与使用空间”说明，并与AI商品推荐理由分别展示；描述反映生成时的方案，之后手动调整不会被规则引擎重置。没有增加额外AI调用，沿用一次有界DeepSeek请求，无自动重试。

验证：新增12项朝向回归（含渲染变换符号、座位/书桌/餐桌关系、床头和柜背、门窗、边界及失败保护），完整67项测试通过。Cloudflare真实一次AI请求生成8件家具、校正3件、识别1个已知门口；没有调用图片渲染。
