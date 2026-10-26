# Domira Apple RoomPlan 原生采集工程

这是实际调用苹果 RoomPlan/ARKit 的 iOS 原生工程，包含 WKWebView 测量回填桥接与 JSON 分享。Safari 不直接执行 Swift API：Safari 用户先在此原生 App 中采集并分享 JSON，然后在网站的“Apple RoomPlan”栏目导入。

## 构建与安装

1. 在 Mac 上使用含 iOS 16 或更新 SDK 的 Xcode 打开 `DomiraRoomPlan.xcodeproj`。工程无第三方依赖。
2. 在 Signing & Capabilities 选择自己的 Apple Development Team，并按需更换唯一 Bundle Identifier。这里没有预设签名账户或凭据。
3. 连接支持 LiDAR 的 iPhone/iPad；模拟器不能验证 RoomPlan 扫描。运行 DomiraRoomPlan target，按系统提示允许摄像头。
4. App 打开已上线 Domira 网站；点击“扫描新空间 → 启动原生 RoomPlan”。缓慢扫描墙角、墙面和门窗，点击“完成扫描”。
5. 选择“回填网页”在 App 内确认尺寸；或“分享 JSON”存到 Files，再在 Safari 同一网站点“匯入原生測量 JSON”。不需要把测量数据发到聊天。

## 边界与验证状态

- 使用 `RoomCaptureSession.isSupported` 检查 LiDAR 支持；没有 LiDAR 或拒绝权限时显示明确错误。
- 数据格式 `domira.roomplan.v1`：公尺单位、墙面尺寸、列主序 4×4 世界矩阵、置信度、采集时间。前端重新计算以最长墙为轴的包络矩形和中位墙高，并保留墙面数据。矩形地板是编辑器的近似，不是完整扫描网格；门窗开洞与识别出的原有家具尚不导入。
- 采集影像不会上传。桥接仅允许生产网站的 HTTPS 主 frame 调用，按 requestId 对应结果。外部链接转到系统浏览器，不会获得 RoomPlan 桥接。
- JSON 分享文件保存在 App 临时目录；卸载 App 或系统清理可移除。网页项目仍由当前浏览器本地保存。
- 当前开发环境为 Windows，已核对 Xcode 工程/权限文件和网页导入协议，未在 Xcode 编译、签名或 LiDAR 真机测试。该源码工程不是已上架 App，也没有 TestFlight 安装包。生产分发需要开发者在 Mac 真机验证后自行签名发布。

## 真机验收

在受支持 iPhone/iPad 验证：不支持硬件提示、摄像头拒绝、扫描取消、扫描完成、回填网页、JSON 分享及 Safari 导入。用卷尺复核长宽高，对低置信度、不规则房间及镜面区域重新测量。确认导入的墙体位置与原生预览一致，家具在米制空间中可编辑并能导出。

官方参考：[RoomPlan](https://developer.apple.com/augmented-reality/roomplan/)、[RoomCaptureViewDelegate](https://developer.apple.com/documentation/roomplan/roomcaptureviewdelegate)、[isSupported](https://developer.apple.com/documentation/roomplan/roomcapturesession/issupported)。
