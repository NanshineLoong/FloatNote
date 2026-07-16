# 内置 Skills 更新设计

## 目标

移除现有三个内置 Skill，以四个简洁的交互式 Skill 取代，并让助手输入框与设置页显示中文名称和中文简介，同时保持英文目录名和稳定 Skill ID。

## Skill 集合

| ID | 中文名 | 核心流程 |
| --- | --- | --- |
| `organize` | 整理材料 | 识别主题、选择主题、确认框架、扩充大纲、尽量无损成文 |
| `tutor` | 拷问学习 | 围绕指定内容追问、反馈与引导；默认五轮后询问继续或总结 |
| `plan-actions` | 行动规划 | 从方向选择逐步收敛为简单行动项，先成方案文档，再确认是否加入任务清单 |
| `write` | 文章写作 | 只使用用户提供的实质内容，依次确认框架、梗概与表达，确认成熟后成文，不限制轮数 |

## 元数据与展示

每个 Skill 仍以 `SKILL.md` 为唯一必需文件。`name` 和 `description` 使用英文，供目录、协议、启停配置和模型发现使用。中文 UI 信息放在 Agent Skills 标准允许的 `metadata` 映射中：

```yaml
metadata:
  floatnote-display-name: 整理材料
  floatnote-short-description: 按主题整理采集内容，尽量保留原始信息
```

Rust host 的目录清单解析这两个可选字段，向 UI 返回 `displayName` 和 `displayDescription`。缺失字段时分别回退到 `name` 和 `description`，因此已有外部 Skill 无需迁移。发送给 sidecar 和写入提示词的稳定标识及触发描述不变。

## 行为边界

- 四个 Skill 首版只包含 `SKILL.md`，不增加脚本、参考资料或资源文件。
- 所有写笔记操作继续遵守现有确认气泡；Skill 在发起写操作前说明准备写入的内容。
- `organize`、`plan-actions` 和 `write` 在用户确认中间产物前不得直接完成最终文档。
- `tutor` 不轻易直接公布答案；默认五轮只是一次继续/结束检查点，不是硬上限。

