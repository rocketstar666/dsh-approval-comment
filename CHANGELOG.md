# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2025-XX-XX

### Added

- **拒绝并附言（reject but say some）**：审批窗口新增自由文本附言框，支持四种组合——无附言允许→继续；无附言拒绝→中断任务；有附言允许→附言一并生效并继续；有附言拒绝→据附言调整并自动继续（不停止）。
- **无感替代审批窗口**：以 `conversation.composer` 链 `priority: 0` 顶替内置审批面板，外观保持一致（警示条 + 工具名 + 允许一次/拒绝）。
- **拒绝即停止**：`approval/request` 前置监听观察拒绝结果，`agent/pre-step` 守卫对「纯拒绝」以 `{ kind: 'reject' }` 终止续步，杜绝"继续猜测并换方案"；附言以「插话（steer）」注入当前回合。
- **策略兼容**：`approval/policy = 'never'` 的自动拒绝不经应答链，不受停止守卫影响（无人值守/CI 场景行为不变）。
- **零依赖、纯 JS**：host 与 client 半区均无第三方依赖，`npm run build` 仅做契约校验，`npm pack` 产出分发包。
