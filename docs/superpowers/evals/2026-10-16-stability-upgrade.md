# 基础稳定性升级验证记录

日期：2026-10-16

上游基线：`635f7b437ad2972051c34e53b394c4b36593203f`。

验证代码版本：`f5aa58e097063d1f23779eab8a7b2a7fc6226428`。后续交付记录只修改文档。

## 规则回归

- `npm test`：16 项通过，使用仓库自带 Matter.js 0.19.0 和真实游戏代码，替代浏览器 DOM/Canvas 等宿主接口。
- 初始 13 项检查在未修改游戏上有 3 项按预期失败，分别覆盖冷却期接触、休眠接触与动画帧循环。
- 补充暂缓的多接触和复合体检查后，将同一套 15 项检查用于原版游戏，5 项关键检查按预期失败；修复版本 15 项全部通过。
- 独立审阅发现 `Query.collides` 的查询体使用复合父凸包，会把凹口空隙误判为接触。新增第 16 项检查，在修复前确实失败（角色数 1，预期 2）；改为查询实际子部件后通过。
- 独立复核再次运行 16 项规则检查，确认该问题已解决，没有剩余阻塞发现。

覆盖：500 ms 冷却、休眠、动画帧与调试推进、接触分离/重接触、移除、重复使用与计分、复合父凸包空隙、不同阶、顶级、正常投放、重开与存储不可用。

## 素材预览

- `npm run test:preview`：4 项通过，包括外部工作目录调用、缺输入目录、缺第八张素材、图片损坏。
- 原预览脚本在新增集成检查中有 3 项按预期失败；修复后 4 项全部通过。
- 使用 sharp 0.33.5 单独安装到忽略跟踪的 `qa/preview-tools/`，未安装或下载 AI 抠图模型。
- 实际生成 `preview_magenta.png`、`preview_checker.png`、`preview_dark.png` 三张 1740×876 图片，逐张检查：均为 4×2 布局，八阶角色齐全，没有角色被画布裁切；素材和原有透明效果未修改。
- 集成检查核对八个单元格与各自源图的可见像素，并检查棋盘格交替及两种纯色背景。

## 本地运行与持续检查

- `node serve.js 5187`：本地静态资源检查 13/13 正常，包括 HTML、样式、物理库、碰撞数据、游戏脚本和八张图片。检查后停止本次启动的服务器。
- `git diff --check`：通过。
- [GitHub Actions 验证运行](https://github.com/han-yi-1212/nailong-merge/actions/runs/38856465928)：三个作业全部成功，分别为 Ubuntu 规则检查、Windows 规则检查、Ubuntu 八阶预览检查，均使用 Node.js 24。

## 交付

- Fork：`han-yi-1212/nailong-merge`。
- 分支：`feat/stability-upgrade`。
- [上游 PR #1](https://github.com/LVEG16/nailong-merge/pull/1)：目标为 `LVEG16:main`，来源为 `han-yi-1212:feat/stability-upgrade`，已创建为可审阅 PR，等待维护者决定合并。

## 尚未验证

Tabbit 创建页面失败，错误为 `browserContext.newPage: Protocol error (Target.createTarget): Task-scoped CDP command could not be dispatched`。诊断确认没有创建测试页，任务正常结束。因此没有声称通过浏览器实际拖放、音效、手机布局或真机手感验收；规则检查不代替这些交互验收。

本次没有重新运行完整 AI 抠图流程，也没有更换角色图片或调整投放权重、分数、判负线、碰撞体尺寸及美术风格。
