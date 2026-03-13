# 数竞智脑 Web Demo（静态原型）

本目录是根据 `UI设计/页面UI设计（完善版）.md` 搭建的 **三栏式 Web Demo 原型**，用于答辩/评审演示：

- 分步提示（禁止直出）
- A/B 用户画像切换（同题不同提示）
- GeoGebra 动态画图（可执行命令）
- 右侧画像雷达图动态更新
- 工具调用日志抽屉（OCR/检索/画图/画像写入）

## 运行方式（推荐）

在项目根目录执行：

```bat
:: 方式 A：在项目根目录直接启动（推荐，最不容易跑错路径）
node web-demo\server.js 5173

:: 方式 B：先进入目录再启动
cd web-demo
node server.js 5173
```

然后浏览器打开：

```
http://localhost:5173
```

> 说明：本 Demo 使用 CDN 加载 Chart.js / KaTeX / GeoGebra 部署脚本。若离线环境无法访问 CDN，页面会自动降级（仍可演示布局与分步交互，但图表/公式/GeoGebra 可能不可用）。
