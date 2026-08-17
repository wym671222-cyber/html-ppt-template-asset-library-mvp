# 决策记录

| ID | 状态 | 决策 | 理由/证据 | 阶段 | 确认时间 |
|---|---|---|---|---|---|
| ITV2R-D01 | confirmed | 保留当前 v788，不先回滚 v710 | 历史版本无数据库副本；镜像回滚不能修复备份漂移 | P03A | 2026-08-15 |
| ITV2R-D02 | confirmed | 新备份写为单一密封 ZIP，内部继续使用既有 manifest v1 | 复用已审核 ZIP/恢复合同，避免裸 SQLite 被平台特殊处理 | P01 | 2026-08-15 |
| ITV2R-D03 | confirmed | 无效旧备份可见但不可使用，不删除、不覆盖 | 保持 fail-closed 和取证边界，同时恢复新备份能力 | P01 | 2026-08-15 |
| ITV2R-D04 | confirmed | 使用两个运行时代码一致候选完成真实平台同步证明 | 本地模拟不足以证明 PocketBay `/data` 边界 | P02/P03A | 2026-08-15 |
| ITV2R-D05 | confirmed | 任一业务迁移失败即用迁移前密封备份恢复 DB，CAS 只追加 | 防止部分晋升或退役状态长期留在生产 | P03B | 2026-08-15 |
| ITV2R-D06 | confirmed | v3.0 以 `bdd9acf35174fefe7953aa59c5d7bb670d4cf901` 为新实施基线 | 用户明确批准 PocketBay 形态统一与云服务器资产同步方案 | P03R | 2026-08-17 |
| ITV2R-D07 | confirmed | 活动链改为 P03R、P04、P05A、P05B、P06；P00–P02 passed 证据不变 | 计划变更由 P03R 先文档化，后继仍由父级串行监督 | P03R | 2026-08-17 |
| ITV2R-D08 | confirmed | 旧 P03A 未通过、旧 P03B 未启动，二者被 v3.0 取代但保留历史原状态 | 禁止把未完成生产门禁改写为 passed | P03R | 2026-08-17 |
| ITV2R-D09 | confirmed | PocketBay 完成后才向固定云端 `119.29.241.146` / `ppt.ajjy-ai.site` 同步同一 SHA 和目录包 | PocketBay 最终 manifest 是资产目录唯一事实源 | P05B/P06 | 2026-08-17 |
| ITV2R-D10 | confirmed | 目录包只含模板资产，不含任何认证、汇报或恢复数据 | 云端账号、Session、汇报和历史引用必须保持 | P04/P06 | 2026-08-17 |
| ITV2R-D11 | confirmed | v1 使用无脚本 opaque sandbox，v2 使用 `allow-scripts` 双层运行时；列表继续只显示 PNG 缩略图 | 同时满足真实页面、交互能力、性能和隔离边界 | P04 | 2026-08-17 |
| ITV2R-D12 | confirmed | 用户手工完成登录、备份口令和特权认证；worker 不读取或记录凭据 | 生产授权不扩大秘密访问权限 | P05A/P05B/P06 | 2026-08-17 |

## 审批记录

- 旧批准计划版本：2.1；旧 P03A/P03B 的事实保留，不作为 v3.0 passed 证据。
- 当前计划版本与批准版本：3.0。
- 当前审批原文：用户本轮原文 `PLEASE IMPLEMENT THIS PLAN:` 后附完整《PocketBay 形态统一与云服务器资产同步方案 v3.0》，并随后明确指派本 P03R worker。
- 当前批准时间：2026-08-17T12:37:50+08:00。

## 被取代阶段历史

- 旧 P03A：原状态 `in_progress`，原线程 `/root/p03a_pocketbay_sync`，未形成提交、未通过门禁；由 v3.0 取代。
- 旧 P03B：原状态 `pending`，无线程、无提交、未启动；由 v3.0 取代。
- 以上记录只描述历史，不更改 P00–P02 的既有 passed 证据，也不表示 P04/P05A/P05B/P06 已启动。
