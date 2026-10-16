# 奶龙合成所

合成类小游戏（合成大西瓜玩法）Web 版。八阶奶龙等级链，Matter.js 物理，纯前端、零后端。

## 运行游戏

安装 Node.js 后直接运行，**无需 npm install**：

```bash
node serve.js 5173
# 浏览器打开 http://localhost:5173/
```

也可以使用 `npm start -- 5173`。`www/` 是完整的静态站点，可部署到 GitHub Pages、Netlify 等静态托管服务。

物理库、图片和样式都在本地，不依赖 CDN。本地资源齐全时，可断网启动本地服务器运行；项目未提供 Service Worker 或 PWA 安装功能，不保证托管页面断网后刷新可用。

## 玩法

按住画面左右拖动瞄准、松手投放；两个**同阶**奶龙相碰进化一级；奶龙堆过虚线并停住即判负。

每只角色出生后有 500 ms 合成冷却。冷却期间已经接触的同阶角色，在冷却结束后仍接触时会合成，休眠也不会漏检；已分离的角色不会隔空合成。

顶级（挥手奶龙）为终端阶，不再合成，留在场上形成堵堆压力。最高分保存在 localStorage；存储不可用时仍可正常游玩。

等级链：便便漩涡 → 生气圆球 → 刀盾奶龙 → 站立胖墩 → 摸肚侧身 → 狮身人面 → 发光天使 → 挥手奶龙。

## 目录

```text
www/          游戏、八阶贴图、colliders.js 和本地 Matter.js
scripts/      build.js 抠图；gen_colliders.js 碰撞体；preview.js 素材验收
tests/       规则回归与素材预览集成检查
assets_raw/   抠图输入原图
assets_out/   抠图产物（忽略跟踪，由 build.js 生成）
serve.js      零依赖静态服务器
```

## 规则检查

使用 Node.js 24，无需安装依赖或下载模型：

```bash
npm test
```

检查会加载仓库自带的真实物理引擎、碰撞体和游戏代码，仅替代 DOM、Canvas 等浏览器接口。覆盖冷却、休眠、分离、复合碰撞体、重复计分、顶级角色、重开与最高分存储。

这些检查验证规则，不代替浏览器中的拖放、音效和手机布局验收。推送分支和提交 PR 时，GitHub Actions 会在 Windows、Linux 上运行规则检查，并单独检查素材预览；不会自动部署或合并。

## 八阶素材预览

可以直接验收已提交的 `www/assets`，不必先运行 AI 抠图。预览只需要 sharp 0.33.5；如果尚未安装完整项目依赖，可单独准备工具目录：

```bash
npm install --prefix qa/preview-tools --ignore-scripts --no-audit --no-fund sharp@0.33.5
```

PowerShell：

```powershell
$env:NODE_PATH = Join-Path (Get-Location) 'qa/preview-tools/node_modules'
npm run preview -- www/assets qa/previews
npm run test:preview
```

macOS / Linux：

```bash
export NODE_PATH="$PWD/qa/preview-tools/node_modules"
npm run preview -- www/assets qa/previews
npm run test:preview
```

已经在项目根目录安装 sharp 时，无需设置 `NODE_PATH`。

接口为 `node scripts/preview.js [输入目录] [输出目录]`：输入默认 `www/assets`，输出默认项目根目录；相对路径以项目根目录为准，也接受绝对路径。输出三张 4×2 八阶验收图：

- `preview_magenta.png`：检查彩边和漏抠。
- `preview_checker.png`：检查透明区域与半透明光晕。
- `preview_dark.png`：检查暗底边缘。

工具会先检查并解码全部八张素材；输入缺失或图片损坏时，显示具体路径并失败退出，不生成不完整的验收图。`qa/` 和 `preview_*.png` 已忽略跟踪。

## 可选：重新构建素材

只有重新抠图才需要安装 `package.json` 中的全套依赖，例如 `npm ci`；这包含图像处理与推理运行时，首次构建可能需要联网准备模型或原生组件。这不是运行游戏、规则测试或现有素材预览的前置步骤，也不在轻量 CI 中执行。

```bash
node scripts/build.js
node scripts/gen_colliders.js
node -e "require('node:fs').cpSync('assets_out/square_512', 'www/assets', { recursive: true })"
node scripts/preview.js assets_out/square_1024 qa/rebuilt-previews
```

`build.js` 输出 `orig/`、`tight/`、`square_1024/`、`square_512/` 到 `assets_out/`；不会自动复制到游戏目录。`gen_colliders.js` 从 `tight/` 生成 `www/colliders.js`。

1–6、8 阶使用 AI 前景遮罩；第 7 阶使用实体遮罩与亮度光晕的混合处理。原尺寸透明图保留源 RGB，归一化图片会裁剪和缩放。换素材后应同步核对 `TIERS` 的宽高比、视觉大小和碰撞叠图。

## 手感参数

参数位于 `www/game.js`：

| 常量 | 当前作用 |
| --- | --- |
| `PHYSICS_SUBSTEPS` | 每帧四个物理子步，总时间仍为 `dt`；不是速度倍率 |
| `MAX_TILT` | 倾角软上限约 30°，接触其他物体且未休眠时施加恢复角速度 |
| `COL_K` | 碰撞几何相对立绘尺寸系数，当前 1.0 |
| `DROP_LINE` | 判负虚线高度，逻辑坐标 y=200 |
| `SPAWN_W` | 前五阶投放权重：0.30、0.26、0.20、0.14、0.10 |
| `MERGE_CD` | 出生后 500 ms 才能参与合成 |
| `TIERS[].r / f / ar / com / pts` | 基准尺寸 / 视觉大小 / 主体宽高比 / 重心偏移比例 / 合成得分 |

碰撞体由贴图 alpha 轮廓生成，默认使用混合方案：凹口明显的阶使用竖条凸包复合体，其余使用单凸包；配合低重心与倾角软限制稳定堆叠。

## 浏览器调试

```js
NAIWA.dropAt(180, 4)  // 在 x=180 投放第 5 阶
NAIWA.stat()         // 分数、角色数量、阶数、倾角等
NAIWA.step(60)       // 通过调试接口推进约一秒，便于后台检查
NAIWA.reset()
```

游戏正常运行时会自动推进物理，调试 `step()` 适用于受控检查，不要将其与前台自动循环叠加来衡量实际速度。

## 依赖与许可

- [matter-js](https://github.com/liabru/matter-js)（MIT）已本地化为 `www/vendor/matter.min.js`。
- 素材抠图使用 [@imgly/background-removal-node](https://github.com/imgly/background-removal-js)，图片处理使用 [sharp](https://sharp.pixelplumbing.com/)。
- 角色立绘为原作者提供素材；代码和角色素材的使用范围应分别向原作者确认。