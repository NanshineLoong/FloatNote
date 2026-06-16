# AI Tutor 笔记 — Sprint 路线图（索引）

关联设计：[../specs/2026-06-16-ai-tutor-notes-design.md](../specs/2026-06-16-ai-tutor-notes-design.md)

把整体实现拆成 6 个 sprint，每个 sprint 自身可交付、可测试、可演示。后一个 sprint 依赖前一个的产出。

| Sprint | 主题 | 交付物（可演示） | 文档 |
|---|---|---|---|
| 1 | 版本快照库 | 笔记底部"版本条"，可手动打快照、列出版本、切换/回退；纯 Rust 测试覆盖 | [sprint-1-version-store.md](2026-06-16-sprint-1-version-store.md) |
| 2 | Node agent-sidecar + Pi 接入 | 独立 Node 程序：stdin 喂 prompt+笔记全文，stdout 流式吐 tutor 回复，可请求 write_note；CLI 跑通 | [sprint-2-agent-sidecar.md](2026-06-16-sprint-2-agent-sidecar.md) |
| 3 | Rust 中枢 + 协议接线 | Rust 拉起 sidecar、转发 prompt、广播事件；AI 覆盖笔记自动留版本；devtools 可调通全链路 | [sprint-3-rust-bridge.md](2026-06-16-sprint-3-rust-bridge.md) |
| 4 | 助手 UI + 双窗口模式 | 参考图样式的助手；分离/嵌入双模式、吸附、折叠胶囊、全屏自动切换 | [sprint-4-assistant-ui.md](2026-06-16-sprint-4-assistant-ui.md) |
| 5 | 设置页多 provider | 设置页选 Anthropic/OpenAI、填 key、选 model；改配置热应用到 sidecar | [sprint-5-provider-settings.md](2026-06-16-sprint-5-provider-settings.md) |
| 6 | 打包 / 跨平台 | sidecar 打成单可执行文件随 Tauri 分发；macOS + Windows 验证 | [sprint-6-packaging.md](2026-06-16-sprint-6-packaging.md) |

## 深度说明

- **Sprint 1** 已展开为 bite-sized TDD 步骤（含完整代码），可直接执行。
- **Sprint 2–6** 为具体任务计划（文件清单、有序任务、关键签名、测试/验收命令）。其逐行代码在**该 sprint 开始执行前**最终确定——因为它们依赖前一个 sprint 的真实产出（协议字段、模块签名、Pi SDK 实际事件结构等），现在写死全部代码会与实际漂移。每个 sprint 执行前会按 writing-plans 标准补全为可直接照做的步骤。

## 执行约定

- 每个 sprint 独立一条分支或独立 worktree，完成后跑通验收清单再合并。
- TDD：先写失败测试，再实现，频繁提交。
- 平台敏感项（全屏/Space、窗口吸附、sidecar 打包）按 AGENTS.md 在 macOS + Windows 两端验证。
