# 图片支持设计（Image Support）

- 日期：2026-07-09
- 范围：FloatNote 笔记内插入、渲染、编辑图片；v1 聚焦项目空间内 piece / inbox / 散落文档的图片支持。
- 状态：已与用户 brainstorm 确认，待实现规划。

## 背景与现状

FloatNote 编辑器是 CodeMirror 6 的 markdown live-preview（类 Obsidian）：底层是 markdown 源码，`src/note/preview.ts` 的 ViewPlugin 把 image/link/hr/list/callout 等替换成 inline widget，光标行回退源码。

图片现状：
- `![alt](url)` 语法已能渲染（`preview.ts` 的 `ImgWidget`），http(s) 直通，本地路径走 Tauri `convertFileSrc`。
- 缺口：无粘贴图片、无拖放图片、无"插入图片"入口、无图片落盘的 Rust 命令、`tauri.conf.json` 未配 `security.assetProtocol.scope`（本地图片大概率加载不出来）、capabilities 未开 `fs`/`clipboard-manager`。
- 项目空间只认 `.md`，无 assets 目录约定；项目目录可散落在磁盘任意位置（`Config.working_dir` + MRU）。

## 目标

- 支持粘贴位图、拖放图片文件两种输入，落盘到本地并插入 markdown 链接。
- 支持可视化手柄 + 工具栏调整尺寸、对齐、caption，操作写回 markdown 源码。
- 项目自包含：图片随项目目录一起移动/备份/分享。
- 不新增 fs / clipboard-manager / http 权限，文件读写只走自定义 Rust 命令。

## 非目标（v1）

- 文件选择器插入图片（v1 不做，URL 现已能渲染）。
- 多图并排布局（v2）。
- 孤儿图片自动删除（v1 不删，保留文件，将来可加"清理未引用图片"命令）。
- raw HTML 图片（v1 不允许，避免 XSS）。

## 决策摘要

| 维度 | 决策 |
|---|---|
| 存储 | 图片落到"该 .md 所在目录下的 `_assets/`"子目录 |
| 引用 | markdown 相对路径 `./_assets/xxx.png` |
| 输入 | 粘贴位图 + 拖放文件 |
| 属性语法 | 方案 A：`![caption](url){width=400 .center}`，alt 兼 caption |
| 交互 | 图片上可视化手柄 + 工具栏，写回源码 |
| v1 进阶 | 拖手柄改尺寸 + 左/中/右对齐 + caption 图注 |
| 孤儿图片 | 删链接不删文件 |
| 本地图加载 | 自定义 URI 协议（替代失效的 `convertFileSrc`+asset scope） |
| 权限 | 不新增；粘贴走 webview paste 事件，拖放走 Tauri drag-drop |

## §1 存储与路径

**统一规则：图片落到"该 .md 文件所在目录下的 `_assets/` 子目录"，markdown 用相对路径 `./_assets/xxx.png` 引用。**

- 项目空间内的 piece.md / _inbox.md / _tasks.md → 都用该项目目录下的同一个 `_assets/`，同一张图可在项目内多个 piece 之间复用。
- working_dir 根目录下的散落 legacy .md → 在它所在目录建 `_assets/`；同目录多个散落 note 共享一个 `_assets/`。
- `_` 前缀与现有 `_inbox.md`/`_tasks.md` 系统文件约定一致；`list_pieces` / `list_markdown` 本就忽略非 `.md` 与 `_` 前缀，`_assets` 不会出现在 piece 切换菜单里，也不会被清理。

**文件命名**（前端生成建议名，Rust 落盘时去重）：
- 粘贴位图：`paste-{YYYYMMDD-HHMMSS}-{rand6}.png`
- 拖放文件：沿用原文件名 stem，空格等分隔符 slug 化（空格→`-`），保留扩展名；中文保留。如 `截图 1.png` → `截图-1.png`。
- 去重：`_assets/` 已有同名则追加 `-1`、`-2`。
- 落盘用现有 `write_atomic` 同款原子替换 + fsync。

**markdown 引用形式**：
```markdown
![图注文字](./_assets/arch.png){width=400 .center}
```

## §2 输入：粘贴位图 + 拖放文件

### 粘贴位图（无需 clipboard-manager 权限）

1. 监听编辑器根节点 `paste` 事件，读 `clipboardData.items`，取 `type.startsWith("image/")`。
2. 前端把 blob 读成 `ArrayBuffer` → base64（前端无 fs 权限，不能直接写盘）。
3. 调 Rust `save_pasted_image(project_dir, suggested_name, data_base64, mime)` → 落盘 `_assets/` + 去重 → 返回 `{ rel_path }`。
4. 前端在光标处插入 `![](./_assets/xxx.png)`。
5. 单图上限 20MB，超限 toast 提示不插入。

### 拖放图片文件（Tauri 原生 drag-drop，拿真实路径）

1. 不关 `dragDropEnabled`，监听 Tauri `tauri://drag-drop` 事件（payload 含文件路径数组 + 位置 rect）。
2. 调 Rust `import_image_files(source_paths, project_dir)` → Rust 直接 copy 文件到 `_assets/`（路径操作，不绕 base64）→ 去重 → 返回 `[{ rel_path }]`。
3. 插入位置：v1 插入当前光标处（不精确做 drop 坐标→文档位置映射）；多张图每张一行 `![]()`。
4. 只接受图片扩展名白名单：png/jpg/jpeg/gif/webp/svg/bmp/avif；非图片忽略。

**两种机制不同的原因**：webview 原生 drop 不暴露真实文件路径（安全限制），只有 Tauri drag-drop 事件能给路径；而粘贴只有 webview paste 事件能拿到位图数据。故粘贴走 base64、拖放走路径 copy。

## §3 渲染与属性语法解析

扩展现有 `src/note/preview.ts` 的 `ImgWidget`：

- 在 Image case 里，于 `)` 之后向后扫描 `{...}` 属性块文本（类似 preview 里 hr/callout 的自定义解析，不依赖 lang-markdown 原生解析 `{}`）。
- 解析出：`width`（v1 只用 width，保持比例）、`.left`/`.center`/`.right`（对齐 class）、alt 文本（兼 caption）。
- 渲染成：
  ```html
  <figure class="img-{align}">
    <img class="cm-preview-img" src="..." style="width:{width}px">
    <figcaption>{caption}</figcaption>
  </figure>
  ```
  - 无 caption 省略 figcaption；无属性退化为现在的单 `<img>`，向后兼容现有笔记。
- `src`：http(s) 直通；`./_assets/...` 相对路径走 §5 自定义协议加载。

**属性语法约定（写回时遵循）**：
- 尺寸：`{width=400}`（只存 width，浏览器按比例算高度）。
- 对齐：`{.center}` / `{.left}` / `{.right}`，默认（无 class）= 左对齐。
- caption：直接放 alt，即 `![图注](url)`，不引入新语法。
- 组合：`![图注](url){width=400 .center}`，属性顺序固定 width 在前、class 在后，便于工具栏稳定写回。

## §4 工具栏交互（尺寸/对齐/caption 写回源码）

点击已渲染图片 widget → 该图进入"激活"态 → 浮出小工具栏（图片上方/下方）。三操作全部写回 markdown 源码，不存外部状态。

**对齐**：左/中/右三按钮。点击 → 修改 `()` 后 `{...}` 里的 class；无 `{}` 则新建 `{.center}`；已是该对齐则移除 class。

**尺寸（拖右下手柄）**：
- 图片右下角拖拽手柄，拖动时实时改 `<img>` 的 `width`（视觉预览），`height:auto` 维持比例。
- 松手取整 → 写回 `{width=N}`（覆盖已有 width）。
- 最小 40px；最大 = 拖动时容器的像素宽度（即图片不会超出所在编辑器宽度，按像素值存入 `{width=}`）。

**caption**：
- 图片下方 inline 文本输入框，初值 = 当前 alt。
- 输入即改写 `![...]` 的 alt；清空则 alt 留空、figcaption 不渲染。
- 回车/失焦收起。

**写回定位**：用 CodeMirror 语法树定位 Image 节点的 `[]`、`()`、`)` 之后位置，原地替换 alt 与 `{}` 属性块；若用户删过 `{}` 则补回。光标行（live-preview 回退源码的那一行）不显示工具栏，避免与源码编辑冲突。

**收起**：点图片外区域 / Esc / 光标离开 → 收起工具栏。

## §5 后端命令与权限/安全

### Rust 命令（项目空间文件操作放 `notes.rs`，`commands.rs` 只做薄封装）

- `save_pasted_image(project_dir, suggested_name, data_base64, mime) -> { rel_path, filename }`
  解码 base64 → 写入 `{project_dir}/_assets/{filename}`（去重、`write_atomic`+fsync）→ 返回 `./_assets/{filename}`。
- `import_image_files(source_paths: Vec<String>, project_dir) -> Vec<{ rel_path, filename }>`
  每个源路径校验扩展名属图片白名单 → copy 到 `_assets/`（去重）→ 返回相对路径列表。
- `read_image_bytes(abs_path) -> Vec<u8>`（自定义协议按需调用）。

### 本地图片加载——自定义 URI 协议

现状缺口：`tauri.conf.json` 未配 `security.assetProtocol.scope`，`convertFileSrc` 生成的 `asset.localhost` URL 大概率加载失败；工作目录是运行时用户选的，asset scope 是构建期静态、无法含任意运行时目录。

方案：用 Tauri 2 `register_asynchronous_uri_scheme_protocol` 注册自定义协议（如 `floatnote-img://`）：
- Rust 侧按请求路径读 `_assets` 文件。
- 校验：规范化路径必须解析到某项目目录下的 `_assets/` 内，拒绝 `../` 逃逸与任意目录越界读。
- 返回 bytes + 正确 `Content-Type`。
- ImgWidget 的 `src` 对相对路径转成该协议 URL。

任意运行时项目目录的本地图都能加载，且不依赖静态 scope。

### capabilities（`src-tauri/capabilities/default.json`）

- 粘贴：webview 原生 paste 事件，**不需要** clipboard-manager 权限。
- 拖放：Tauri drag-drop 是 core 行为，**不需要**额外权限。
- 不开 `fs`、不开 `clipboard-manager`、不开 `http`。所有文件读写走自定义 Rust 命令，权限面最小。

### 安全

- v1 不允许 raw HTML 图片，`![]()` 不产生 `onerror` 等事件属性，img.src 注入不了脚本 → 无 XSS。
- 自定义协议做路径越界校验。
- 现状 CSP=null；若后续开 CSP，需 `img-src 'self' data: https: floatnote-img:`。

## §6 错误处理与测试

### 错误处理

- 落盘失败（磁盘满/权限/路径非法）→ toast 报错，不插入链接，编辑器内容不变。
- base64 解码失败/损坏 → 同上 toast 报错。
- 单图超 20MB → toast"图片过大"，不插入。
- 图片文件缺失/损坏（渲染时协议读不到）→ ImgWidget 渲染占位（broken 图标 + 文件名），不抛异常、不崩编辑器。
- 非图片扩展名拖放项 → 静默忽略（可 toast 提示已跳过 N 个非图片）。
- 拖放跨盘 copy 失败 → 单项失败不影响其他项，返回结果里标记失败项。

### 测试

前端 Vitest（`src/note/*.test.ts`，放代码旁）：
- 属性解析纯函数：`parseImageAttrs("![c](u){width=400 .center}")` → `{alt:"c", width:400, align:"center"}`；无 `{}` 退化默认；非法 `{}` 不崩。
- 属性写回纯函数：给定旧源码片段与新 width/align → 输出新源码片段（覆盖、新建、移除 class 三种情况）。
- 文件名 slug/去重纯函数（与 Rust 侧去重逻辑对齐）。

Rust（`notes.rs` 内 `#[cfg(test)]`）：
- `import_image_files` 去重（同名追加 `-1`）。
- `save_pasted_image` base64 解码 + 落盘 + 返回相对路径。
- 自定义协议路径越界校验（`../` 逃逸被拒）。

手动（`npm run tauri dev`，macOS + Windows 各验一遍）：
- 粘贴截图、拖放文件、改尺寸、三对齐、caption 输入/清空、项目内多 piece 共享同一图、散落根级 note 的 `_assets`。

### 跨平台注意

拖放在 Windows/macOS 的 `tauri://drag-drop` payload 一致；路径分隔符在 Rust 侧用 `Path` 统一；中文文件名两平台 webview 加载需验。

## 受影响文件（预估）

- 前端：`src/note/preview.ts`（属性解析 + figure 渲染 + 工具栏）、`src/note/paste.ts`（位图粘贴）、新增 `src/note/image-drop.ts`（拖放）、`src/note/main.ts`（接入）、新增 `src/note/image-attrs.test.ts`。
- Rust：`src-tauri/src/notes.rs`（落盘/导入/读图命令 + 协议）、`src-tauri/src/commands.rs`（薄封装）、`src-tauri/src/lib.rs`（注册命令 + 协议）。
- 配置：`src-tauri/capabilities/default.json`（无需新增权限，记录不变）、`tauri.conf.json`（注册自定义协议，视实现方式）。
