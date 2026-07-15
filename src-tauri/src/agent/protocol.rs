//! sidecar JSONL 协议类型：Host ↔ sidecar 的消息枚举与附属数据结构。
//!
//! 所有类型经 `serde` 序列化为 camelCase JSON，字段命名与 sidecar 的
//! `protocol.ts` 对齐。纯数据类型，不含进程/IO 逻辑。

use crate::config::AiProviderId;
use serde::{Deserialize, Serialize};

/// Host → sidecar 消息。JSON 字段为 camelCase，与 Sprint 2 的 protocol.ts 对齐。
#[derive(Deserialize, Serialize, Debug, Clone, PartialEq)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum HostToSidecar {
    Configure {
        call_id: String,
        provider: AiProviderId,
        model: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        api_key: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        base_url: Option<String>,
    },
    ClearConfiguration {
        call_id: String,
    },
    OpenSession {
        conversation_id: String,
        session_file: String,
    },
    NewSession {
        conversation_id: String,
        cwd: String,
        session_dir: String,
    },
    Prompt {
        request_id: String,
        conversation_id: String,
        user_text: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        references: Option<Vec<PromptRef>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        skill: Option<PromptSkill>,
    },
    Rewind {
        call_id: String,
        conversation_id: String,
        user_entry_id: String,
    },
    ApplyEditResult {
        call_id: String,
        ok: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        denied: Option<bool>,
        #[serde(skip_serializing_if = "Option::is_none")]
        version: Option<u32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
    NoteText {
        call_id: String,
        content: String,
        found: bool,
    },
    NotesList {
        call_id: String,
        notes: Vec<AgentNoteEntry>,
    },
    CreateNoteResult {
        call_id: String,
        ok: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        denied: Option<bool>,
        #[serde(skip_serializing_if = "Option::is_none")]
        name: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
    Cancel {
        request_id: String,
    },
    /// 下发 skill 目录给 sidecar（启动时解析 bundled + 用户全局路径）。
    /// sidecar 收到后调 `skills.reload()`，把描述与全文读入内存。
    SetSkillPaths {
        skill_paths: Vec<String>,
        #[serde(default)]
        disabled_skill_names: Vec<String>,
    },
    /// 请求 sidecar 的已加载 skill 列表（同步一次性请求-响应）。
    /// sidecar 回 `SkillsList` 解除 host 侧 oneshot 等待。
    ListSkills {
        call_id: String,
    },
}

/// Sidecar → host 消息。
#[derive(Deserialize, Serialize, Debug, Clone, PartialEq)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum SidecarToHost {
    Ready,
    ConfigureResult {
        call_id: String,
        ok: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
    SessionOpened {
        conversation_id: String,
        session_file: String,
        messages: Vec<ChatDisplayMessage>,
    },
    SessionSynced {
        conversation_id: String,
        session_file: String,
        messages: Vec<ChatDisplayMessage>,
    },
    RewindResult {
        call_id: String,
        ok: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
    Delta {
        request_id: String,
        conversation_id: String,
        text: String,
    },
    ThinkingStart {
        request_id: String,
        conversation_id: String,
        block_id: String,
    },
    ThinkingDelta {
        request_id: String,
        conversation_id: String,
        text: String,
    },
    ThinkingEnd {
        request_id: String,
        conversation_id: String,
    },
    Tool {
        request_id: String,
        conversation_id: String,
        call_id: String,
        name: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        label: Option<String>,
        phase: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        is_error: Option<bool>,
    },
    ApplyEdit {
        call_id: String,
        conversation_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        tool_call_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        target: Option<NoteTarget>,
        tool_name: String,
        old_content: String,
        new_content: String,
        preview: EditPreview,
    },
    GetNoteText {
        call_id: String,
        conversation_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        target: Option<NoteTarget>,
    },
    ListNotes {
        call_id: String,
        conversation_id: String,
    },
    CreateNote {
        call_id: String,
        conversation_id: String,
        tool_call_id: String,
        title: String,
        content: String,
        preview: EditPreview,
    },
    Done {
        request_id: String,
        conversation_id: String,
    },
    Title {
        conversation_id: String,
        title: String,
    },
    Error {
        request_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        conversation_id: Option<String>,
        message: String,
    },
    /// 回复 `ListSkills`：已加载 skill 的 name + description。
    SkillsList {
        call_id: String,
        skills: Vec<SkillSummary>,
    },
}

/// skill 摘要：name + description。与 sidecar `skills_list` 的元素同形。
#[derive(Deserialize, Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SkillSummary {
    pub name: String,
    pub description: String,
}

/// prompt 携带的结构化引用：显示名(display) 与内部标识(id) 分离。
/// `kind` 取值 `file`/`skill`；`note_kind` 仅文件引用携带（与 NoteTarget.kind 同语义）。
#[derive(Deserialize, Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PromptRef {
    pub kind: String,
    pub id: String,
    pub display: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note_kind: Option<String>,
}

/// prompt 携带的 Skill 引用：稳定 name，sidecar 以 /skill:<name> 前缀原生展开。
#[derive(Deserialize, Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PromptSkill {
    pub name: String,
}

#[derive(Deserialize, Serialize, Debug, Clone, PartialEq)]
#[serde(
    tag = "role",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum ChatDisplayMessage {
    User {
        text: String,
        timestamp: u64,
        #[serde(skip_serializing_if = "Option::is_none")]
        entry_id: Option<String>,
    },
    Assistant {
        blocks: Vec<ChatDisplayBlock>,
        timestamp: u64,
        #[serde(skip_serializing_if = "Option::is_none")]
        entry_id: Option<String>,
    },
    Error {
        text: String,
        timestamp: u64,
        #[serde(skip_serializing_if = "Option::is_none")]
        entry_id: Option<String>,
    },
}

#[derive(Deserialize, Serialize, Debug, Clone, PartialEq)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum ChatDisplayBlock {
    Text {
        text: String,
    },
    Thinking {
        text: String,
    },
    Tool {
        call_id: String,
        name: String,
        label: String,
        status: ToolDisplayStatus,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
}

#[derive(Deserialize, Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ToolDisplayStatus {
    Succeeded,
    Failed,
    Incomplete,
}

/// 当前活动笔记：由笔记窗 `set_active_note` 发布、`agent_send` 也会更新，
/// 供 apply_edit / get_note_text 定位 dir / path，并供独立助手窗 `get_active_note` 查询。
/// `kind` 与 `NoteTarget.kind` 同语义（inbox/tasks/piece/doc），用于缺省 target 时
/// 决定 `can_snapshot`（仅 piece 可快照）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveNote {
    pub dir: String,
    pub note_id: String,
    pub path: String,
    pub kind: String,
}

/// apply_edit / get_note_text 的目标笔记定位。
///
/// `kind` 取值与 sidecar `protocol.ts` 的 `NoteTarget` 一致：
/// `inbox`/`tasks`/`piece`/`doc`；`name` 仅在 `piece`/`doc` 时给出文件名。
#[derive(Deserialize, Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NoteTarget {
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

#[derive(Deserialize, Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentNoteEntry {
    pub kind: String,
    pub name: String,
}

/// apply_edit 的预览细节（判别联合，`kind` 区分）。
///
/// 变体名用 `rename_all = "snake_case"` 序列化为 `diff`/`tag_assign`/
/// `tag_create`/`tag_delete`（与 TS 线格式一致）；字段名用
/// `rename_all_fields = "camelCase"` 序列化为 `hunks`/`textExcerpt`/
/// `tagName`/`tagColor`/`annotationCount`。
#[derive(Deserialize, Serialize, Debug, Clone, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum EditPreviewDetail {
    Diff {
        hunks: String,
    },
    TagAssign {
        text_excerpt: String,
        annotation_count: u32,
        action: String,
        tag_name: String,
        tag_color: String,
    },
    TagCreate {
        tag_name: String,
        tag_color: String,
    },
    TagUpdate {
        tag_id: String,
        old_name: String,
        old_color: String,
        new_name: String,
        new_color: String,
    },
    NoteCreate {
        filename: String,
        content_preview: String,
    },
    TagDelete {
        tag_name: String,
        annotation_count: u32,
    },
}

/// apply_edit 携带的编辑预览：工具名 + 摘要 + 详情。
#[derive(Deserialize, Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EditPreview {
    pub tool: String,
    pub summary: String,
    pub detail: EditPreviewDetail,
}

/// note://updated 事件载荷。
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NoteUpdated {
    pub note_id: String,
    pub path: String,
    pub version: u32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn structured_assistant_history_round_trips() {
        let message = ChatDisplayMessage::Assistant {
            blocks: vec![
                ChatDisplayBlock::Thinking {
                    text: "分析".into(),
                },
                ChatDisplayBlock::Tool {
                    call_id: "c1".into(),
                    name: "read_note".into(),
                    label: "读取 行动清单".into(),
                    status: ToolDisplayStatus::Succeeded,
                    error: None,
                },
                ChatDisplayBlock::Text {
                    text: "结论".into(),
                },
            ],
            timestamp: 1,
            entry_id: Some("a1".into()),
        };
        let json = serde_json::to_string(&message).unwrap();
        assert!(!json.contains("result"));
        assert_eq!(
            serde_json::from_str::<ChatDisplayMessage>(&json).unwrap(),
            message
        );
    }

    #[test]
    fn prompt_serializes_to_camel_case_json() {
        let msg = HostToSidecar::Prompt {
            request_id: "r1".into(),
            conversation_id: "c1".into(),
            user_text: "你好".into(),
            references: None,
            skill: None,
        };
        let value: serde_json::Value =
            serde_json::from_str(&serde_json::to_string(&msg).unwrap()).unwrap();
        assert_eq!(value["type"], "prompt");
        assert_eq!(value["requestId"], "r1");
        assert_eq!(value["conversationId"], "c1");
        assert_eq!(value["userText"], "你好");
        // None 字段被 skip_serializing_if 省略
        assert!(value.get("references").is_none());
        assert!(value.get("skill").is_none());
    }

    #[test]
    fn prompt_round_trips_references_and_skill() {
        let msg = HostToSidecar::Prompt {
            request_id: "r1".into(),
            conversation_id: "c1".into(),
            user_text: "看看".into(),
            references: Some(vec![PromptRef {
                kind: "file".into(),
                id: "p/piece.md".into(),
                display: "piece.md".into(),
                note_kind: Some("piece".into()),
            }]),
            skill: Some(PromptSkill {
                name: "summarize".into(),
            }),
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("\"references\""), "{json}");
        assert!(
            json.contains("\"skill\":{\"name\":\"summarize\"}"),
            "{json}"
        );
        assert!(json.contains("\"noteKind\":\"piece\""), "{json}");
        let back: HostToSidecar = serde_json::from_str(&json).unwrap();
        assert_eq!(back, msg);
    }

    #[test]
    fn session_commands_serialize_to_camel_case_json() {
        let open = HostToSidecar::OpenSession {
            conversation_id: "c1".into(),
            session_file: "/tmp/c1.jsonl".into(),
        };
        let value: serde_json::Value =
            serde_json::from_str(&serde_json::to_string(&open).unwrap()).unwrap();
        assert_eq!(value["type"], "open_session");
        assert_eq!(value["conversationId"], "c1");
        assert_eq!(value["sessionFile"], "/tmp/c1.jsonl");

        let new_session = HostToSidecar::NewSession {
            conversation_id: "c2".into(),
            cwd: "/tmp/project".into(),
            session_dir: "/tmp/sessions".into(),
        };
        let value: serde_json::Value =
            serde_json::from_str(&serde_json::to_string(&new_session).unwrap()).unwrap();
        assert_eq!(value["type"], "new_session");
        assert_eq!(value["conversationId"], "c2");
        assert_eq!(value["sessionDir"], "/tmp/sessions");
    }

    #[test]
    fn configure_omits_absent_api_key() {
        let msg = HostToSidecar::Configure {
            call_id: "cfg1".into(),
            provider: crate::config::AiProviderId::Anthropic,
            model: "claude".into(),
            api_key: None,
            base_url: None,
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(
            !json.contains("apiKey"),
            "absent api key should be skipped: {json}"
        );
        assert!(
            !json.contains("baseUrl"),
            "absent base url should be skipped: {json}"
        );
        assert!(json.contains("\"callId\":\"cfg1\""), "{json}");
    }

    #[test]
    fn parses_configure_result_line() {
        let line = r#"{"type":"configure_result","callId":"cfg1","ok":false,"error":"模型无效"}"#;
        let msg: SidecarToHost = serde_json::from_str(line).unwrap();
        assert_eq!(
            msg,
            SidecarToHost::ConfigureResult {
                call_id: "cfg1".into(),
                ok: false,
                error: Some("模型无效".into()),
            }
        );
    }

    #[test]
    fn serializes_clear_configuration_with_call_id() {
        let value = serde_json::to_value(HostToSidecar::ClearConfiguration {
            call_id: "cfg2".into(),
        })
        .unwrap();
        assert_eq!(
            value,
            serde_json::json!({"type":"clear_configuration","callId":"cfg2"})
        );
    }

    #[test]
    fn parses_delta_line() {
        let line = r#"{"type":"delta","requestId":"r1","conversationId":"c1","text":"hi"}"#;
        let msg: SidecarToHost = serde_json::from_str(line).unwrap();
        assert_eq!(
            msg,
            SidecarToHost::Delta {
                request_id: "r1".into(),
                conversation_id: "c1".into(),
                text: "hi".into(),
            }
        );
    }

    #[test]
    fn parses_error_with_null_request_id() {
        let line = r#"{"type":"error","requestId":null,"conversationId":"c1","message":"boom"}"#;
        let msg: SidecarToHost = serde_json::from_str(line).unwrap();
        assert_eq!(
            msg,
            SidecarToHost::Error {
                request_id: None,
                conversation_id: Some("c1".into()),
                message: "boom".into(),
            }
        );
    }

    #[test]
    fn parses_apply_edit_line() {
        let line = r##"{"type":"apply_edit","callId":"w1","conversationId":"c1","target":{"kind":"inbox"},"toolName":"tag_text","oldContent":"a","newContent":"b","preview":{"tool":"tag_text","summary":"s","detail":{"kind":"tag_assign","textExcerpt":"文本","annotationCount":1,"action":"add","tagName":"review","tagColor":"#e5484d"}}}"##;
        let msg: SidecarToHost = serde_json::from_str(line).unwrap();
        match msg {
            SidecarToHost::ApplyEdit {
                ref tool_name,
                ref target,
                ..
            } => {
                assert_eq!(tool_name, "tag_text");
                let t = target.as_ref().expect("target present");
                assert_eq!(t.kind, "inbox");
                assert!(t.name.is_none());
            }
            _ => panic!("not ApplyEdit"),
        }

        // Round-trip back to JSON and verify camelCase field names + snake_case type.
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("\"type\":\"apply_edit\""), "{json}");
        assert!(json.contains("\"callId\":\"w1\""), "{json}");
        assert!(json.contains("\"conversationId\":\"c1\""), "{json}");
        assert!(json.contains("\"toolName\":\"tag_text\""), "{json}");
        assert!(json.contains("\"oldContent\":\"a\""), "{json}");
        assert!(json.contains("\"newContent\":\"b\""), "{json}");
        assert!(json.contains("\"textExcerpt\":\"文本\""), "{json}");
        assert!(json.contains("\"annotationCount\":1"), "{json}");
        assert!(json.contains("\"tagName\":\"review\""), "{json}");
        assert!(json.contains("\"tagColor\":\"#e5484d\""), "{json}");
    }

    #[test]
    fn apply_edit_omits_absent_target() {
        // target 缺省时序列化结果不应包含 target 字段。
        let msg = SidecarToHost::ApplyEdit {
            call_id: "w1".into(),
            conversation_id: "c1".into(),
            tool_call_id: None,
            target: None,
            tool_name: "write_note".into(),
            old_content: "a".into(),
            new_content: "b".into(),
            preview: EditPreview {
                tool: "write_note".into(),
                summary: "s".into(),
                detail: EditPreviewDetail::Diff { hunks: "@@".into() },
            },
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(
            !json.contains("\"target\""),
            "absent target should be skipped: {json}"
        );
        // 反序列化回来仍是 None。
        let back: SidecarToHost = serde_json::from_str(&json).unwrap();
        assert_eq!(back, msg);
    }

    #[test]
    fn serializes_apply_edit_result_denied() {
        let msg = HostToSidecar::ApplyEditResult {
            call_id: "w1".into(),
            ok: false,
            denied: Some(true),
            version: None,
            error: None,
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("\"type\":\"apply_edit_result\""), "{json}");
        assert!(json.contains("\"callId\":\"w1\""), "{json}");
        assert!(json.contains("\"denied\":true"), "{json}");
    }

    #[test]
    fn parses_note_text_line() {
        let line = r#"{"type":"note_text","callId":"g1","content":"doc","found":true}"#;
        let msg: HostToSidecar = serde_json::from_str(line).unwrap();
        match msg {
            HostToSidecar::NoteText {
                call_id,
                found,
                content,
                ..
            } => {
                assert_eq!(call_id, "g1");
                assert!(found);
                assert_eq!(content, "doc");
            }
            _ => panic!("not NoteText"),
        }
    }

    #[test]
    fn set_skill_paths_serializes_camel_case() {
        let msg = HostToSidecar::SetSkillPaths {
            skill_paths: vec!["/a/skills".into(), "/b/skills".into()],
            disabled_skill_names: vec!["disabled".into()],
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("\"type\":\"set_skill_paths\""), "{json}");
        assert!(json.contains("\"skillPaths\""), "{json}");
        let back: HostToSidecar = serde_json::from_str(&json).unwrap();
        assert_eq!(back, msg);
    }

    #[test]
    fn list_skills_serializes_camel_case() {
        let msg = HostToSidecar::ListSkills {
            call_id: "sl1".into(),
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("\"type\":\"list_skills\""), "{json}");
        assert!(json.contains("\"callId\":\"sl1\""), "{json}");
    }

    #[test]
    fn parses_skills_list_line() {
        let line = r#"{"type":"skills_list","callId":"sl1","skills":[{"name":"socratic-review","description":"追问"}]}"#;
        let msg: SidecarToHost = serde_json::from_str(line).unwrap();
        match msg {
            SidecarToHost::SkillsList { call_id, skills } => {
                assert_eq!(call_id, "sl1");
                assert_eq!(skills.len(), 1);
                assert_eq!(skills[0].name, "socratic-review");
                assert_eq!(skills[0].description, "追问");
            }
            _ => panic!("not SkillsList"),
        }
    }

    #[test]
    fn skills_list_round_trips() {
        let msg = SidecarToHost::SkillsList {
            call_id: "sl2".into(),
            skills: vec![
                SkillSummary {
                    name: "a".into(),
                    description: "desc a".into(),
                },
                SkillSummary {
                    name: "b".into(),
                    description: "desc b".into(),
                },
            ],
        };
        let json = serde_json::to_string(&msg).unwrap();
        let back: SidecarToHost = serde_json::from_str(&json).unwrap();
        assert_eq!(back, msg);
    }

    #[test]
    fn round_trips_edit_preview_detail_variants() {
        // diff
        let diff = EditPreviewDetail::Diff { hunks: "@@".into() };
        let v: serde_json::Value =
            serde_json::from_str(&serde_json::to_string(&diff).unwrap()).unwrap();
        assert_eq!(v["kind"], "diff");
        assert_eq!(v["hunks"], "@@");
        let back: EditPreviewDetail =
            serde_json::from_str(&serde_json::to_string(&diff).unwrap()).unwrap();
        assert_eq!(back, diff);

        // tag_create
        let tc = EditPreviewDetail::TagCreate {
            tag_name: "review".into(),
            tag_color: "#e5484d".into(),
        };
        let v: serde_json::Value =
            serde_json::from_str(&serde_json::to_string(&tc).unwrap()).unwrap();
        assert_eq!(v["kind"], "tag_create");
        assert_eq!(v["tagName"], "review");
        assert_eq!(v["tagColor"], "#e5484d");

        // tag_delete
        let td = EditPreviewDetail::TagDelete {
            tag_name: "review".into(),
            annotation_count: 3,
        };
        let v: serde_json::Value =
            serde_json::from_str(&serde_json::to_string(&td).unwrap()).unwrap();
        assert_eq!(v["kind"], "tag_delete");
        assert_eq!(v["tagName"], "review");
        assert_eq!(v["annotationCount"], 3);

        let create: SidecarToHost = serde_json::from_str(r#"{"type":"create_note","callId":"c1","conversationId":"cv","toolCallId":"t1","title":"Ideas","content":"body","preview":{"tool":"create_note","summary":"create","detail":{"kind":"note_create","filename":"Ideas.md","contentPreview":"body"}}}"#).unwrap();
        assert!(matches!(create, SidecarToHost::CreateNote { .. }));
        let list: SidecarToHost =
            serde_json::from_str(r#"{"type":"list_notes","callId":"l1","conversationId":"cv"}"#)
                .unwrap();
        assert!(matches!(list, SidecarToHost::ListNotes { .. }));
    }

    #[test]
    fn round_trips_get_note_text_line() {
        let req = SidecarToHost::GetNoteText {
            call_id: "g1".into(),
            conversation_id: "c1".into(),
            target: Some(NoteTarget {
                kind: "piece".into(),
                name: Some("piece.md".into()),
            }),
        };
        let json = serde_json::to_string(&req).unwrap();
        assert!(json.contains("\"type\":\"get_note_text\""), "{json}");
        assert!(json.contains("\"callId\":\"g1\""), "{json}");
        assert!(json.contains("\"conversationId\":\"c1\""), "{json}");
        assert!(
            json.contains("\"target\":{\"kind\":\"piece\",\"name\":\"piece.md\"}"),
            "{json}"
        );
        let back: SidecarToHost = serde_json::from_str(&json).unwrap();
        assert_eq!(back, req);

        // target 缺省时序列化应省略 target 字段，反序列化回 None。
        let req_no_target = SidecarToHost::GetNoteText {
            call_id: "g2".into(),
            conversation_id: "c1".into(),
            target: None,
        };
        let json2 = serde_json::to_string(&req_no_target).unwrap();
        assert!(
            !json2.contains("\"target\""),
            "absent target should be skipped: {json2}"
        );
        let back2: SidecarToHost = serde_json::from_str(&json2).unwrap();
        assert_eq!(back2, req_no_target);
    }
}
