# PI-native 模型配置设计

**日期：** 2026-07-12  
**状态：** 已确认，待实施

## 目标

将 FloatNote 的模型设置改为 PI-native 配置：保留 PI 内置模型的协议和能力元数据，支持官方 OpenAI / Anthropic 连接以及完整的 OpenAI-compatible / Anthropic-compatible 自定义连接。模型配置不再将所有带端点的连接降级为 OpenAI Chat Completions。

## 非目标

- 本期不接入 Google Generative AI 或 OAuth 登录流程。
- 本期不实现任意 shell 命令取 Key、远程模型发现或模型价格管理。
- 不暴露 PI 所有低频兼容开关；仅保存运行所需的安全、可理解的子集。

## 现状与问题

当前设置将服务商、模型、API Key 和一个可选 base URL 平铺为四个字段。sidecar 只要收到 base URL，就手工生成 `openai-completions` 模型，固定 `reasoning: false` 和 Qwen thinking 格式。这带来以下问题：

1. 官方模型与其 PI 原生 API（例如 OpenAI Responses、Anthropic Messages）没有统一的配置表达。
2. 自定义 Anthropic-compatible 服务无法正确声明协议。
3. 自定义模型虽然在所有服务商下可选，但很多场景没有必填的端点、协议或能力元数据。
4. UI 未提供 PI thinking level，无法基于模型的 `thinkingLevelMap` 过滤和保存选择。
5. 内置模型列表由前端硬编码，容易与已安装 PI 的模型注册表漂移。

## 方案选择

采用“连接（Connection）与模型（Model）分离”的 PI-native 方案。

替代方案及取舍：

1. **继续扩展现有服务商下拉框。** 改动最小，但协议、端点与模型能力仍会耦合，无法正确表示 Anthropic-compatible 连接；不采用。
2. **完全照搬 PI `models.json` 文本编辑器。** 功能最完整，但对 FloatNote 用户过于技术化，且会模糊应用配置与用户全局 PI 配置的边界；不采用。
3. **结构化连接 + PI 注册表（采用）。** 常用设置保持清晰；高级项只在自定义连接中展示；sidecar 仍通过 PI 的 `ModelRegistry` 和模型对象运行。

## 配置模型

应用配置迁移为一个默认连接和一个选中模型。一个连接包含：

```ts
type ConnectionProtocol =
  | "openai-responses"
  | "anthropic-messages"
  | "openai-completions";

interface AiConnection {
  id: string;
  name: string;
  kind: "official-openai" | "official-anthropic" | "custom";
  provider: string;
  protocol: ConnectionProtocol;
  apiKey: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  models: CustomModelDefinition[];
}

interface CustomModelDefinition {
  id: string;
  name?: string;
  reasoning: boolean;
  thinkingLevelMap?: Partial<Record<ThinkingLevel, string | null>>;
  input: Array<"text" | "image">;
  contextWindow: number;
  maxTokens: number;
  compat?: CustomModelCompat;
}

interface AiModelSelection {
  connectionId: string;
  modelId: string;
  thinkingLevel: ThinkingLevel;
}
```

官方连接不重复存储 PI 内置模型元数据；只保存连接凭据和选中模型 ID。自定义连接必须至少有一个 `CustomModelDefinition`，并保存其运行所需的元数据。

初版的 `CustomModelCompat` 只支持 PI 的高价值 OpenAI compatibility 字段：`supportsDeveloperRole`、`supportsReasoningEffort`、`supportsUsageInStreaming`、`maxTokensField`、`thinkingFormat`、`requiresThinkingAsText`。默认值明确显示为“使用 PI 默认值”。Headers 采用名称/值列表，绝不在日志或错误内容中回显值。

## 设置 UI

AI 设置页按以下顺序呈现：

1. **连接**：连接选择器，显示“OpenAI”“Anthropic”及用户创建的连接；可以新建、重命名和删除未使用的自定义连接。
2. **连接类型**：新建连接时选择“OpenAI-compatible”或“Anthropic-compatible”。官方连接固定其 PI 原生协议；自定义连接显示协议、API endpoint、API Key 与可选 Headers。
3. **模型**：官方连接列出 PI 注册表中属于该 provider 的推荐模型和“输入模型 ID”；自定义连接列出该连接已定义的模型，并可新增/编辑模型能力。
4. **推理**：仅当当前模型为 `reasoning: true` 时显示；可选档位由 `thinkingLevelMap` 和 PI 的 `getAvailableThinkingLevels()` 共同决定。无推理能力时显示不可编辑的说明。
5. **高级兼容性**：仅对自定义 OpenAI-compatible 模型显示，默认折叠。Anthropic-compatible 的 endpoint 使用 `anthropic-messages`，不显示 OpenAI 专用兼容开关。

切换连接或模型时，当前 thinking level 必须自动收敛到该模型的可用档位；优先保留同名档位，否则选择 PI 返回的第一个有效档位。表单在完成必填项前不发送配置。

## Sidecar 与 PI 集成

Rust host 和 JSONL 协议将 `AiConnection`、选中模型和 thinking level 传给 sidecar，而不再传递分散的 `provider/model/apiKey/baseUrl` 四元组。

sidecar 行为：

1. 官方连接：从 PI `ModelRegistry` 取得内置模型；保留其 `api`、`thinkingLevelMap`、输入能力和所有 compat 设置。
2. 自定义连接：使用 `ModelRegistry.registerProvider()` 注册 provider、认证、协议、端点、headers 和模型定义；随后通过 registry 查找选中的模型。
3. 会话创建后调用 `session.setThinkingLevel()`；仅使用 `session.getAvailableThinkingLevels()` 返回的值。无效设置被收敛，不发给模型。
4. 配置变更只影响后续新建/重新打开的会话；正在流式输出的会话保持稳定，并向 UI 返回“下一次对话生效”的状态。

模型清单应由 sidecar 暴露为 DTO 给设置页，而非由前端维护版本化的硬编码数组。DTO 至少包含 ID、显示名、输入能力、是否 reasoning、可用 thinking levels、上下文窗口和最大输出。应用可在 UI 中标记推荐模型，但推荐只是一层展示元数据，不能改变 PI 的模型定义。

## 迁移与兼容性

启动时检测旧字段 `ai_provider`、`ai_model`、`ai_api_key`、`ai_base_url`：

- `anthropic` 和 `openai`（无自定义 endpoint）迁移为相应官方连接。
- 有 base URL 的现有配置迁移为 OpenAI-compatible 自定义连接，保留模型 ID 和 Key，并采用保守默认模型能力：text、128k context、8k output、无 reasoning。用户可在高级编辑中校正能力。
- 旧 DashScope 配置同样迁移为 OpenAI-compatible，并将 Qwen thinking 格式设为已有值，避免行为倒退。
- 无法识别或不完整的配置不删除；标记为“需要完成配置”，禁止启动会话并提供可读错误。

旧字段在成功迁移且保存一次后不再写回。已有对话历史继续以模型显示名存储，不依赖旧 provider 字段。

## 错误处理与安全

- endpoint 必须为 `https`，仅 `localhost`/回环地址允许 `http`。
- 自定义 OpenAI-compatible 连接拒绝明显的 Anthropic app endpoint，并提示选择 Anthropic-compatible 协议。
- API Key 与 header 值不进入日志、错误事件、会话标题或历史记录。
- 删除已被选中的连接前要求切换到其它连接；删除连接不删除既有对话历史。
- PI 注册失败、模型 ID 不存在或思考档位不支持时，给出字段级错误，不重置已保存配置。

## 验证

1. 升级 `@earendil-works/pi-ai` 与 `@earendil-works/pi-coding-agent` 至同一 `0.80.x` 版本，并验证类型与现有 sidecar API 兼容。
2. 为迁移、连接验证、模型注册、DTO 映射与 thinking level 收敛编写单元测试。
3. 测试官方 OpenAI 使用 PI 的 `openai-responses`，官方 Anthropic 使用 `anthropic-messages`。
4. 测试 OpenAI-compatible 与 Anthropic-compatible 自定义连接会分别注册正确协议、端点、模型和认证。
5. 测试无推理模型隐藏选择器、受限模型只显示 PI 允许档位、切换模型会收敛旧档位。
6. 运行 `npm test`、`npm run build` 和 sidecar JSONL smoke test；Rust DTO 或命令变更还运行 `cargo test --lib`、`cargo check` 与 `cargo check --release`。

## 文档影响

实施时更新 `docs/architecture/sidecar.md`、`docs/architecture/data-flow.md`，以及涉及配置字段的开发文档；明确配置支持的协议和本地凭据存储边界。
