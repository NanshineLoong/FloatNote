//! sidecar JSONL 协议类型：Host ↔ sidecar 的消息枚举与附属数据结构。
//!
//! 所有类型经 `serde` 序列化为 camelCase JSON，字段命名与 sidecar 的
//! `protocol.ts` 对齐。纯数据类型，不含进程/IO 逻辑。

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
        provider: String,
        model: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        api_key: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        base_url: Option<String>,
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
    Cancel {
        request_id: String,
    },
    /// 下发 skill 目录给 sidecar（启动时解析 bundled + 用户全局路径）。
    /// sidecar 收到后调 `skills.reload()`，把描述与全文读入内存。
    SetSkillPaths {
        skill_paths: Vec<String>,
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
    SessionOpened {
        conversation_id: String,
        session_file: String,
        messages: Vec<ChatDisplayMessage>,
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
        phase: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        args: Option<serde_json::Value>,
        #[serde(skip_serializing_if = "Option::is_none")]
        result: Option<serde_json::Value>,
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

#[derive(Deserialize, Serialize, Debug, Clone, PartialEq)]
#[serde(
    tag = "role",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum ChatDisplayMessage {
    User { text: String, timestamp: u64 },
    Assistant { text: String, timestamp: u64 },
    Tool { label: String, timestamp: u64 },
    Error { text: String, timestamp: u64 },
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

/// apply_edit 的预览细节（判别联合，`kind` 区分）。
///
/// 变体名用 `rename_all = "snake_case"` 序列化为 `diff`/`tag_assign`/
/// `tag_create`/`tag_delete`（与 TS 线格式一致）；字段名用
/// `rename_all_fields = "camelCase"` 序列化为 `hunks`/`blockPreview`/
/// `tagName`/`tagColor`/`markerCount`。
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
        block_preview: String,
        tag_name: String,
        tag_color: String,
    },
    TagCreate {
        tag_name: String,
        tag_color: String,
    },
    TagDelete {
        tag_name: String,
        marker_count: u32,
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
    fn prompt_serializes_to_camel_case_json() {
        let msg = HostToSidecar::Prompt {
            request_id: "r1".into(),
            conversation_id: "c1".into(),
            user_text: "你好".into(),
        };
        let value: serde_json::Value =
            serde_json::from_str(&serde_json::to_string(&msg).unwrap()).unwrap();
        assert_eq!(value["type"], "prompt");
        assert_eq!(value["requestId"], "r1");
        assert_eq!(value["conversationId"], "c1");
        assert_eq!(value["userText"], "你好");
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
            provider: "anthropic".into(),
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
        let line = r##"{"type":"apply_edit","callId":"w1","conversationId":"c1","target":{"kind":"inbox"},"toolName":"set_tag","oldContent":"a","newContent":"b","preview":{"tool":"set_tag","summary":"s","detail":{"kind":"tag_assign","blockPreview":"块","tagName":"review","tagColor":"#e5484d"}}}"##;
        let msg: SidecarToHost = serde_json::from_str(line).unwrap();
        match msg {
            SidecarToHost::ApplyEdit {
                ref tool_name,
                ref target,
                ..
            } => {
                assert_eq!(tool_name, "set_tag");
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
        assert!(json.contains("\"toolName\":\"set_tag\""), "{json}");
        assert!(json.contains("\"oldContent\":\"a\""), "{json}");
        assert!(json.contains("\"newContent\":\"b\""), "{json}");
        assert!(json.contains("\"blockPreview\":\"块\""), "{json}");
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
            marker_count: 3,
        };
        let v: serde_json::Value =
            serde_json::from_str(&serde_json::to_string(&td).unwrap()).unwrap();
        assert_eq!(v["kind"], "tag_delete");
        assert_eq!(v["tagName"], "review");
        assert_eq!(v["markerCount"], 3);
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
