# P05 真实拖拽只读诊断

## 结论

候选 `9fee3a4c36a18c293f49508478814385cf07858c` 中 D3、Three.js、Interact.js 的真实 handler 可以工作。P05 worker 最初真实手势失败的直接原因是测试创建外层 iframe 时没有指定尺寸，浏览器采用默认 `300×150`；三个目标元素都位于裁剪区外。后续辅助按钮令测试变绿，但绕过了真实手势，所以父级门禁否决仍然正确。

本诊断只读取当前仓库代码并在 `/tmp` 创建临时脚本；没有修改产品源码、测试、白名单、依赖、数据库/CAS、远端、PocketBay 或两个真实来源目录。

## 反馈环

- 运行时：Node `v22.23.2`。
- 浏览器：本机真实 Google Chrome headless。
- 输入：当前 `createP05InteractiveSource` 与 `compileInteractiveTemplateRuntime(..., { offline: true })` 输出。
- 外层隔离：保持 `sandbox="allow-scripts"`，只改变外层 iframe 尺寸。
- 手势：Playwright `page.mouse` 执行移动、按下、六步带按钮移动、释放；D3 另执行真实滚轮缩放。
- 观测：捕获 pointer/mouse 事件、目标元素几何、D3 `cx/cy` 与 transform、Three WebGL/angle、Interact layout/transform、HTTP(S) 请求。
- 重复：完整差分环连续运行三次。

## 可复现证据

| 组件 | `300×150` | `960×540`，三次一致 |
|---|---|---|
| D3 关系星图 | 圆点边界约 `x=395,y=370`，事件 `0`，坐标保持 `400,210` | 捕获 11 个拖拽事件；坐标约变为 `451.69,235.85`；真实滚轮后 `scale≈1.3947` 且 `<g>` transform 改变 |
| Three 3D 轨道 | canvas 顶部约 `y=211`，事件 `0`，无 WebGL 状态 | 捕获 18 个事件；`data-webgl=ready`，`data-orbit-angle=2.10` |
| Interact 实时编排 | 卡片顶部约 `y=227`，事件 `0`，无位移 | 捕获 18 个事件；`data-layout-x=46`、`data-layout-y=26`，样式为 `translate(46px, 26px)` |

所有六种尺寸/组件组合均记录 HTTP(S) 请求 `0`。直接使用 `page.setContent` 加载 data supervisor 时各组合都出现相同的 `postMessage` target-origin `null` 页面错误，因此它与尺寸差异和手势成败无相关性；若重开 P05，应继续用既有 P02 路由/安全预览门禁验证正式 runtime 通信。

## 假设结果

1. **确认：外层默认 iframe 尺寸导致命中失败。** 三个元素几何位置均在 `300×150` 可视区外；放大外层 iframe 后原手势立即稳定工作。
2. **否定：D3 zoom 与 drag 监听本身冲突。** 可见尺寸下节点拖动和滚轮缩放可在同一页面连续成功。
3. **否定：离线转义破坏真实 handler。** 当前经转义的 D3、Three、Interact dist 都响应真实事件并改变库驱动状态。
4. **否定：Playwright 无法穿透 opaque iframe。** 正确尺寸下捕获到完整 down/move/up 序列。

## 最小恢复边界

在获得新批准计划或明确授权重开 P05 后，只需在原 P05/P06 合同内完成：

1. 给 P05 Chrome 外层 runtime iframe 明确设置 `960×540`（16:9），同时固定浏览器 viewport。
2. D3：选择真实 circle，记录 `cx/cy`，执行鼠标拖拽并断言坐标变化；在 SVG 上执行滚轮并断言 scale/transform 变化。
3. Three：在 canvas 上执行真实按下/移动/释放，断言 WebGL ready 且 angle 变化。
4. Interact：在卡片上执行真实拖拽，断言 x/y 和 transform 变化。
5. 删除仅为绕过测试而添加的 `pointerdown.p05probe`、`orbit-spin`、`layout-nudge` 路径；不依赖 dataset 单点断言。
6. 因包内容变化，重新计算并审核十二个规范化摘要；不放宽协议、CSP、沙箱或包大小限制。
7. 重跑 P05 全门禁，父级独立复核后才可重新启动 P06；P06 通过前禁止推送和 P07 生产写入。

该恢复不需要读取或修改两个真实来源目录，也不需要改 P01–P04 架构。当前链仍为 `blocked`，因为批准的 v2.0 自动流转协议只允许一次 bounded repair。
