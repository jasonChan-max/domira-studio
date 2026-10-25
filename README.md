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

所有 API 同源、JSON；`/api/health` 为 GET，其余为 POST。无任意 Origin 的 CORS。请求体上限 80,000 字符；通过本地缩略帧减小重建请求，正式大图上传应改为私有对象存储和任务队列。

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
3. 宽深范围 3.5–15m、高 2–6m，错误数据不能提交；新建尺寸会改变房间模型及面积，创建新项目而不覆盖旧项目。
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
