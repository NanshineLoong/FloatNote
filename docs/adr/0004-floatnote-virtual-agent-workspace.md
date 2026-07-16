# ADR 0004：为 Agent 提供 FloatNote 虚拟工作区

状态：接受。

Pi 的标准文件工具与 Skill 机制适合模型调用，但直接启用本地文件系统实现会扩大 Agent 能力边界，也无法保持 Inbox 的语义 metadata、用户审批和 Rust 独占写入。

## Decision

Expose Pi-compatible file-tool contracts through a FloatNote virtual workspace instead of enabling Pi's local filesystem implementations. Use Pi ResourceLoader for Skills and a Pi tool_call hook for pre-execution review; keep structured review state, leases, stale checks, snapshots, and atomic writes in the Rust host.

## Consequences

- Skills and tools follow Pi's model-facing conventions.
- Project and Skill paths remain capability-scoped.
- Inbox metadata stays semantic rather than becoming editable storage syntax.
- Standard tool execution requires FloatNote adapters and transaction tests.

旧工具名与旧 Agent session 不做兼容迁移。网络工具实现与 SSRF 策略不受此决定影响。
