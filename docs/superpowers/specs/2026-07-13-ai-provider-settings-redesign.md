# AI 提供商设置简化设计

日期：2026-07-13

## 目标

将 FloatNote 的 AI 设置从通用“连接 + 模型”编辑器改为固定提供商列表。用户可以分别填写六家提供商的凭据和模型，一次最多启用一家，也可以全部关闭。

设置页面向普通用户，只展示完成连接所需的字段。协议、模型能力、thinking 参数和兼容性选项由运行层根据提供商和模型自动决定。

## 范围

固定支持以下六个选项，并使用这些显示名称与顺序：

1. OpenAI API
2. DeepSeek API
3. Anthropic API
4. 阿里云百炼 API
5. Kimi API
6. 智谱 API

本期不支持：

- 新建、重命名或删除连接；
- 同一提供商配置多个连接；
- 自定义提供商；
- 模型推荐、模型发现或模型下拉列表；
- 推理档位选择；
- 协议、Headers、上下文窗口、最大输出或高级兼容设置；
- “测试连接”操作；
- 旧 AI 配置迁移。

本设计取代 `2026-07-12-pi-native-model-configuration-design.md` 中面向用户的通用连接、模型下拉、推理选择和高级兼容设置。运行层仍使用 PI 的原生 provider、模型元数据和兼容能力。

## 方案选择

### 采用：固定提供商档案

六家提供商永久显示，每家只有一份配置。固定档案消除了“新建兼容连接”、连接命名、协议选择和重复连接管理，同时让用户一眼看清配置与启用状态。

### 未采用：CodePilot 式通用连接列表

CodePilot 的卡片列表适合多运行时、多连接和独立模型管理。FloatNote 只需要选择一个 AI 后端；完整照搬会重新引入添加、删除、连接分类、协议和模型管理等复杂度。本设计只借鉴其“服务商可扫视、状态明确”的原则。

### 未采用：单表单切换提供商

单表单改动较少，但无法同时显示六家的配置状态，也容易让用户误以为切换提供商会覆盖上一家的凭据。

## 配置模型

前端、Rust host 和 sidecar 共享等价的固定配置结构：

```ts
type AiProviderId =
  | "openai"
  | "deepseek"
  | "anthropic"
  | "bailian"
  | "kimi"
  | "zhipu";

interface AiProviderConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
}

interface AiSettings {
  providers: Record<AiProviderId, AiProviderConfig>;
  activeProviderId: AiProviderId | null;
}
```

约束：

- `activeProviderId` 为 `null` 时，AI 全部关闭。
- 非空时只能指向一份已保存且 `apiKey`、`model` 均非空的配置。
- 所有提供商初始模型均为空；应用不得写入默认模型或替用户选择模型。
- `baseUrl` 仅对 OpenAI、Anthropic、阿里云百炼有效。
- DeepSeek、Kimi、智谱使用运行层内置的官方地址。
- Base URL 为空时，OpenAI、Anthropic、百炼也使用内置官方地址。
- 不读取或迁移旧的 `ai_provider`、`ai_model`、`ai_api_key`、`ai_base_url`、`ai_connections` 或 `ai_model_selection`。新配置缺失时创建六份空配置并保持全部关闭。

## 设置页交互

### 列表

AI 设置区域标题为“AI 提供商”。六家以单列行列表常驻显示。每行包含：

- 提供商图标；
- 固定显示名称；
- `已启用`、`已配置` 或 `未配置` 状态文字；
- 行末启用开关。

状态不只依赖颜色表达。开关使用原生 checkbox 语义，并提供明确的可访问名称。

### 行内展开

点击一行在原位置展开编辑区，一次只展开一家。展开与启用相互独立：用户可以编辑未启用项，也可以展开非当前提供商而不改变运行状态。

展开区包含：

1. `API Key` 密码输入框；
2. `模型` 文本输入框；
3. 可选 `Base URL` 输入框，仅对 OpenAI、Anthropic、百炼显示；
4. `保存`按钮。

不显示模型默认值、推荐值、下拉选项、推理、协议或高级区域。API Key 已存在时显示为已保存的密码状态，用户不修改即可保留原值。

### 草稿与保存

编辑区维护草稿。输入变化不会立即写配置，也不会重配 sidecar。`保存`按钮只在草稿有变化且字段合法时可用。

保存前执行：

- API Key 去除首尾空白后必须非空；
- 模型去除首尾空白后必须非空；
- 可选 Base URL 非空时必须为 `http` 或 `https` URL；
- Base URL 保存时去除末尾多余 `/`，但保留路径。

错误显示在对应字段下方。保存未启用项时直接持久化。保存当前启用项时，Rust host 先让 sidecar 验证并应用候选运行配置，再持久化 profile；任一步失败都恢复旧 sidecar 配置和旧持久化配置。保存失败时保留草稿。

### 启用与关闭

启用开关遵循“至多一个”：

- 打开一项时，只有在该项已有合法的已保存配置后才尝试启用；
- 启用成功后再关闭原启用项，避免失败时意外失去可用配置；
- 启用失败时保持原启用项不变，并在目标行显示可操作错误；
- 关闭当前项后将 `activeProviderId` 设为 `null`，允许全部关闭；
- 未配置项的开关不可用，并提供“请先保存 API Key 和模型”的说明。

当前启用项不能直接保存为空 Key 或空模型；用户必须先关闭该项。

## Provider 与协议解析

UI 不展示协议。运行层按固定档案解析：

| UI 提供商 | PI provider / 注册方式 | 默认传输 |
| --- | --- | --- |
| OpenAI API | PI `openai` | 官方地址使用 OpenAI Responses；自定义 Base URL 使用 OpenAI Chat Completions |
| DeepSeek API | PI `deepseek` | OpenAI Chat Completions |
| Anthropic API | PI `anthropic` | Anthropic Messages |
| 阿里云百炼 API | FloatNote 注册 `bailian` provider | OpenAI Chat Completions |
| Kimi API | PI `moonshotai-cn` | OpenAI Chat Completions |
| 智谱 API | FloatNote 注册 `zhipu` provider，并复用可匹配的 PI Z.AI 模型元数据 | OpenAI Chat Completions |

“原生 provider”表示使用 PI 为厂商定义的地址、认证、模型目录和兼容元数据；其底层仍可复用 OpenAI 或 Anthropic 的协议适配器。不得将 DeepSeek、Kimi、智谱无差别地降级为同一个通用自定义连接。

用户输入模型 ID 后：

1. PI 注册表认识该 provider/model 时，直接使用完整 PI 模型对象；智谱可从 PI 的 Z.AI 模型目录复用匹配模型的兼容元数据，但请求仍发送至智谱通用中国区官方地址。
2. PI 暂未收录时，创建该厂商专属的后备模型定义，不把它加入 UI 模型列表。
3. 后备模型使用 128K 上下文、16K 最大输出、文本输入和零价格元数据；实际服务端限制仍以厂商响应为准。

OpenAI 自定义 Base URL 默认使用 Chat Completions，因为代理和兼容服务通常不完整支持 Responses。Anthropic 自定义 Base URL 保持 Anthropic Messages。百炼 Base URL 用于不同地域、业务空间或套餐入口，协议仍固定为其 OpenAI-compatible Chat Completions。

## 自动 Thinking 与运行默认值

设置页不显示推理开关或推理档位。运行层采用模型感知的自动策略：

- PI 模型元数据标记 `reasoning: true` 时，自动启用 thinking。
- 存在可用 thinking levels 时，默认选择 `high`；不默认选择 `max` 或 `xhigh`。
- 模型标记为不支持 thinking 时，不发送推理参数。
- PI 未收录模型只在厂商和模型 ID 能可靠识别其推理能力时开启；无法确认时不猜测。
- DeepSeek 使用 PI 的 `deepseek` thinking 格式和 `reasoning_effort: high`，并启用厂商 thinking 参数。
- 百炼对已知支持的 Qwen、DeepSeek、Kimi、GLM 混合思考模型发送 `enable_thinking: true`；thinking-only 模型保持原生行为。
- Kimi 对已知支持的模型发送 `thinking: { type: "enabled" }`，并按 PI 的 Moonshot 兼容元数据解析 `reasoning_content`。
- 智谱使用 PI 的 Z.AI thinking 格式；仅在模型能力已知时启用。
- OpenAI 与 Anthropic 使用 PI 原生模型对象提供的 thinking/reasoning 映射。

其他运行默认值：

- 始终使用流式输出；
- 工具选择为 `auto`；
- 不主动发送 `temperature`、`top_p`、`presence_penalty` 或 `frequency_penalty`，使用厂商默认值；
- 上下文窗口、最大输出、输入模态和 thinking 格式优先来自 PI 模型元数据；
- API Key 不写入日志、遥测或用户可见错误文本。

## 错误处理

- 保存只做本地字段校验，不发送试探性模型请求，也不产生 API 费用。
- sidecar 配置失败时，错误归属到对应提供商行，不清空已保存字段。
- 错误信息包含提供商、模型和恢复建议，但必须清除 API Key、认证头和带凭据 URL。
- AI 全部关闭时，设置页正常工作。用户发起 AI 操作时显示“尚未启用 AI 提供商”，并提供进入设置的入口。
- 模型不存在、Base URL 不可达、认证失败和模型不支持工具调用由实际请求返回；应用保留配置并允许用户编辑后重试。

## 数据流

1. 设置页读取六个固定 profile 与 `activeProviderId`。
2. 用户展开一行并编辑本地草稿。
3. 用户点击保存，前端校验后将草稿交给 Tauri 命令。
4. 未启用 profile 直接持久化；当前启用 profile 先应用候选 sidecar 配置，再持久化，失败时恢复旧 sidecar 与旧配置。
5. 用户打开另一家的开关时，Rust host 先验证并配置目标 provider；成功后原子更新 `activeProviderId`。
6. sidecar 根据固定 provider 映射取得 PI 原生模型或创建厂商后备模型，并应用自动 thinking 默认值。

## 测试

### 前端

- 六个固定提供商的名称、顺序和状态；
- 一次只展开一行，展开不改变启用项；
- API Key、模型为文本输入，模型无默认值且没有下拉选项；
- Base URL 只出现在 OpenAI、Anthropic、百炼；
- 草稿、脏状态、字段级校验和明确保存；
- 未配置项不可启用；
- 互斥启用与允许全部关闭；
- 启用失败时原状态不变。

### Rust

- 新配置默认生成六份空 profile 与 `activeProviderId: null`；
- 不读取或迁移旧 AI 配置；
- 固定 provider ID、Base URL 约束与序列化；
- 保存当前项和切换启用项的原子性；
- 全部关闭时不发送 sidecar configure。

### Sidecar

- 六家 provider 到 PI provider/API 的解析；
- 已收录模型复用 PI 元数据；
- 未收录模型使用正确的厂商后备定义；
- OpenAI 自定义 Base URL 切换到 Chat Completions；
- Anthropic 自定义 Base URL 保持 Messages；
- 百炼自定义 Base URL 保持 OpenAI Chat Completions；
- DeepSeek、百炼、Kimi、智谱及 OpenAI/Anthropic 的自动 thinking 参数；
- 不支持或未知模型不收到未经确认的 thinking 参数；
- API Key 不出现在日志和错误中。

### 集成与平台

- 从全新配置启动，保存六家配置并逐一切换；
- 关闭最后一家后，AI 操作显示未启用提示；
- macOS 与 Windows 使用相同配置和 URL 处理逻辑；
- UI 变更通过设置窗口截图或录屏检查窄窗口布局、键盘导航、焦点与明暗主题。

## 文档影响

实现时同步更新：

- `docs/architecture/frontend.md`：固定提供商列表与草稿/保存交互；
- `docs/architecture/backend.md`：新配置结构和原子启用流程；
- `docs/architecture/sidecar.md`：provider 解析、后备模型和自动 thinking；
- `docs/architecture/data-flow.md`：保存、启用和关闭数据流；
- 与 AI 配置结构相关的 `AGENTS.md` 或开发文档说明。
