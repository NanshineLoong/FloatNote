# README 展示素材

这个目录用于存放根目录 `README.md` 的 Hero 图片、产品演示视频，以及 `posters/` 下用于 GitHub 展示的视频封面。Hero 图片直接引用仓库文件；演示视频使用 GitHub 附件地址内嵌播放器，仓库中的 MP4 保留为可维护的源素材。

| 文件名 | 展示内容 |
| --- | --- |
| `readme-icon.png` | README 标题旁使用的透明圆角 FloatNote 图标 |
| `01-hero.png` | FloatNote 悬浮在真实工作场景中的完整产品印象图 |
| `02-capture.mp4` | 同一画面中展示悬浮笔记窗与划词后的采集、翻译、提问操作 |
| `03-dual-panel.mp4` | 采集区与写作区并排的双栏工作区 |
| `04-socratic-ai.mp4` | AI 追问过程，以及修改内容前的变更确认 |
| `05-local-files.mp4` | FloatNote 项目空间与本地 Markdown 文件 |
| `06-tags.mp4` | 为采集内容添加和查看标签 |
| `07-action-menu.mp4` | 行动菜单与下一步行动 |
| `08-versions.mp4` | 文章版本列表或版本预览 |

## 视频规范

- 使用同一套虚构演示内容，保持窗口尺寸、缩放比例和视觉主题一致。
- 分辨率建议 1920×1080 或更高；标签、行动菜单和版本管理三段局部视频保持相同纵横比。
- 裁掉与功能无关的桌面区域，但为悬浮窗和菜单保留足够的使用场景。
- 不要出现真实姓名、私人笔记、文件路径、API Key、访问令牌或其他敏感信息。
- 使用 MP4（H.264 编码），并通过 GitHub 的 Markdown 网页编辑器上传，取得 `github.com/user-attachments/assets/...` 附件地址。
- 每个视频在 `posters/` 下提供同名 JPEG 封面，例如 `02-capture.mp4` 对应 `posters/02-capture.jpg`。
- README 中以 `<video>` 引用附件地址，并设置 `controls`、`playsinline`、`preload="metadata"` 和对应的 `poster`；不要引用仓库 MP4 的 `blob` 或 `raw` 地址。
