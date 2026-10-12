# 奶龙合成所

合成类小游戏（合成大西瓜玩法）Web 版。八阶奶龙等级链，matter-js 物理，纯前端、零后端、可离线运行。

## 运行

```bash
node serve.js 5173        # 零依赖静态服务器（Node 自带 http，无需 npm install）
# 浏览器打开 http://localhost:5173/
```

`www/` 是纯静态站点，整个目录丢到任意静态托管（含 GitHub Pages / Netlify）即可上线。

## 玩法

按住画面左右拖动瞄准、松手投放；两个**同阶**奶龙相碰进化一级；奶龙堆过虚线并停住即判负。
顶级（挥手奶龙）为终端阶：不再合成，留在场上形成堵堆压力（合成大西瓜的经典设计）。最高分存 localStorage。

等级链：便便漩涡 → 生气圆球 → 刀盾奶龙 → 站立胖墩 → 摸肚侧身 → 狮身人面 → 发光天使 → 挥手奶龙

## 目录

```
www/          游戏本体：index.html / style.css / game.js / vendor/matter.min.js / assets/（八阶贴图）
scripts/      build.js 素材抠图管线；preview.js 验收拼图
assets_raw/   微信原图（抠图输入）
assets_out/   抠图产物（已 git 忽略，由 scripts/build.js 重新生成）
serve.js      零依赖静态服务器
```

## 素材管线

```bash
npm install --ignore-scripts     # sharp + @imgly/background-removal-node + matter-js
node scripts/build.js            # 只加 alpha 通道，RGB 与原图逐字节一致（不重绘、不修型、不去色边）
```

- 1–6、8 阶用 AI 前景遮罩（模型离线随包）；第 7 阶天使本身是半透明发光体，翅膀/光环与画面光束同色，
  无法做硬边切割，故用「实体硬边 + 光晕柔和衰减」的混合遮罩保留原有光感。
- 01 原图左右有黑色 pillarbox 边条，管线会自动裁掉。

## 手感旋钮（均在 www/game.js 顶部）

| 常量 | 作用 |
| --- | --- |
| `SIM_SPEED` | 每帧物理子步数 = 速度倍率（现 2，即整体快一倍） |
| `MAX_TILT` | 倾角软上限（~30°），范围内纯物理、超出恢复力矩拽回，防躺平/倒立 |
| `COL_K` | 碰撞体 = 立绘包围盒 × 该值（0.95），调小更紧贴、立绘轻微交叠 |
| `DROP_LINE` | 判负虚线高度 |
| `SPAWN_W` | 投放阶权重（现只投前三阶） |
| `TIERS[].r / f / ar / com / pts` | 每阶基准半径 / 视觉大小 / 主体宽高比 / 重心下移比例 / 合成得分 |

碰撞体为**圆角矩形**（贴合立绘包围盒、平边相贴无空隙），配合低重心与倾角上限：
站得稳、受撞会歪、能自己立正，堆叠紧密。

## 自测

浏览器控制台有调试钩子（发布可整段删除）：

```js
NAIWA.dropAt(210, 4)   // 在 x=210 定点投放第 5 阶
NAIWA.stat()           // { score, best, pieces, tiers, over, angles, ... }
NAIWA.reset()
```

## 依赖与许可

- [matter-js](https://github.com/liabru/matter-js)（MIT）已本地化为 `www/vendor/matter.min.js`，不依赖 CDN。
- 素材抠图用 [@imgly/background-removal-node](https://github.com/imgly/background-removal-js)（模型离线随包）。
- 角色立绘为用户自有素材。
