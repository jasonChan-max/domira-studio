# Changelog

## v2.0 / 2.0.0 — 2026-10-26

这一版整理当前已上线的 Domira 网站源码，可在独立分支中继续开发。

- 单层全屋平面图AI识别、尺寸校准、多房间模型与逐房家具编辑。
- 真正的AI家具布局，以及统一旋转约定、座椅与桌子关系、床头/柜背靠墙、已知门口净空和旋转占地校正。
- 12类家具、36款概念模型、23款品牌备选；港币价格、预算估算、分类报价和家具特点比较。
- WebXR hit-test测量/AR编辑；iOS原生RoomPlan参考桥接与导入。实际扫描兼容性须在真机验收。
- 五视角1K AI图像渲染、顺序提交、本地恢复、访问码认证和持久化幂等；已移除网站每日张数上限，费用仍由上游账户产生。
- 保留JSON/SVG/PNG/OBJ导出、浏览器本地项目、联系接口和Cloudflare部署配置。
- 保留GitHub main已有的装修工程报价、工期、规则、供应商匹配、多角色编排及独立面板。构建使用esbuild，避免遗漏新增后端模块。
- 完整93项测试通过：网站67项、原仓库报价24项、新增路由整合2项。未把模拟扫描、比例示意模型或AI生成效果当作实测精度。

### 开发

需要Node.js 22+，推荐24。无外部运行时依赖。

```sh
npm ci
npm run build
npm test
npm run validate
npm run dev
```

打开 http://localhost:3000/。更改 `src/domain.js` 后先构建以同步 `public/domain.js`。云服务密钥只在服务器配置，不提交到Git。

### 发布文件

- `domira-studio-v2.0-source.zip`：带目录结构的可编辑源码，排除Git元数据、凭据缓存、真实.env及本地测试数据。
- `domira-studio-v2.0-deploy.zip`：Sites Worker与Cloudflare前端/API构建产物；生产所需Secret不包含在内。
- `SHA256SUMS.txt`：压缩包校验值。

当前公开源码不等于把运行时API密钥公开；渲染服务仍由现有访问码与服务器端配置控制。
