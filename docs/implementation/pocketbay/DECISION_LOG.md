# PocketBay 生产化决策记录

| ID | 状态 | 决策 | 理由/证据 | 阶段 | 确认时间 |
|---|---|---|---|---|---|
| PB-D01 | confirmed | 使用现有 PocketBay 子域名作为正式入口 | 当前线上已可用；自定义域名延后 | PB01–PB04 | 2026-08-14 |
| PB-D02 | confirmed | 关闭公开注册 | 初期仅管理员使用 | PB01 | 2026-08-14 |
| PB-D03 | confirmed | 真实模板仅由管理员显式上传 `html-template/v1` ZIP | 不扫描 sibling；复用现有契约 | PB03–PB04 | 2026-08-14 |
| PB-D04 | confirmed | 使用管理员下载的加密异地备份 | PocketBay `/data` 与版本快照不构成异地备份 | PB02 | 2026-08-14 |
| PB-D05 | confirmed | 新建独立 PB00–PB04 链，旧 P17 保持 blocked | PocketBay 与腾讯生产通道是不同发布边界 | 全部 | 2026-08-14 |

## 批准记录

- 计划版本：1.0
- 批准语句：`Implement the proposed plan.`
- 批准时间：2026-08-14T06:42:08+08:00
