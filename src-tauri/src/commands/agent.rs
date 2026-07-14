use crate::agent::{ActiveNote, HostToSidecar, NoteUpdated, PromptRef, PromptSkill, SkillSummary};
use crate::{
    config::{AiProviderConfig, AiProviderId},
    state::AppState,
};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::Ordering,
};
use tauri::{Emitter, Manager, State};

pub(crate) async fn configure_agent(
    state: &AppState,
    provider: AiProviderId,
    config: &AiProviderConfig,
) -> Result<(), String> {
    let seq = state.agent_seq.fetch_add(1, Ordering::Relaxed) + 1;
    let call_id = format!("cfg{seq}");
    let (tx, rx) = tokio::sync::oneshot::channel();
    state
        .pending_agent_configs
        .lock()
        .unwrap()
        .insert(call_id.clone(), tx);
    let send_result = {
        let mut guard = state.agent.lock().unwrap();
        match guard.as_mut() {
            Some(agent) => agent.send(&HostToSidecar::Configure {
                call_id: call_id.clone(),
                provider,
                model: config.model.clone(),
                api_key: Some(config.api_key.clone()),
                base_url: config.base_url.clone(),
            }),
            None => {
                state.pending_agent_configs.lock().unwrap().remove(&call_id);
                return Err("助手未连接".into());
            }
        }
    };
    if let Err(error) = send_result {
        state.pending_agent_configs.lock().unwrap().remove(&call_id);
        return Err(error.to_string());
    }
    match tokio::time::timeout(std::time::Duration::from_secs(5), rx).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => Err("AI 提供商配置响应已丢弃".into()),
        Err(_) => {
            state.pending_agent_configs.lock().unwrap().remove(&call_id);
            Err("AI 提供商配置超时，请重试".into())
        }
    }
}

pub(crate) async fn clear_agent_configuration(state: &AppState) -> Result<(), String> {
    let seq = state.agent_seq.fetch_add(1, Ordering::Relaxed) + 1;
    let call_id = format!("cfg{seq}");
    let (tx, rx) = tokio::sync::oneshot::channel();
    state
        .pending_agent_configs
        .lock()
        .unwrap()
        .insert(call_id.clone(), tx);
    let send_result = state
        .agent
        .lock()
        .unwrap()
        .as_mut()
        .ok_or("助手未连接")?
        .send(&HostToSidecar::ClearConfiguration {
            call_id: call_id.clone(),
        });
    if let Err(error) = send_result {
        state.pending_agent_configs.lock().unwrap().remove(&call_id);
        return Err(error.to_string());
    }
    match tokio::time::timeout(std::time::Duration::from_secs(5), rx).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => Err("AI 提供商清理响应已丢弃".into()),
        Err(_) => {
            state.pending_agent_configs.lock().unwrap().remove(&call_id);
            Err("AI 提供商清理超时，请重试".into())
        }
    }
}

#[tauri::command]
pub fn agent_send(
    state: State<AppState>,
    conversation_id: String,
    user_text: String,
    references: Option<Vec<PromptRef>>,
    skill: Option<PromptSkill>,
) -> Result<String, String> {
    if state
        .config
        .lock()
        .unwrap()
        .ai_settings
        .active_provider_id
        .is_none()
    {
        return Err("尚未启用 AI 提供商，请先前往设置完成配置并启用。".into());
    }
    let seq = state.agent_seq.fetch_add(1, Ordering::Relaxed) + 1;
    let request_id = format!("r{seq}");
    let mut guard = state.agent.lock().unwrap();
    let agent = guard.as_mut().ok_or("助手未连接")?;
    agent
        .send(&HostToSidecar::Prompt {
            request_id: request_id.clone(),
            conversation_id,
            user_text,
            references,
            skill,
        })
        .map_err(|error| error.to_string())?;
    Ok(request_id)
}

#[tauri::command]
pub fn agent_new_session(
    state: State<AppState>,
    conversation_id: String,
    cwd: String,
    session_dir: String,
) -> Result<(), String> {
    let mut guard = state.agent.lock().unwrap();
    let agent = guard.as_mut().ok_or("助手未连接")?;
    agent
        .send(&HostToSidecar::NewSession {
            conversation_id,
            cwd,
            session_dir,
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn agent_open_session(
    state: State<AppState>,
    conversation_id: String,
    session_file: String,
) -> Result<(), String> {
    let mut guard = state.agent.lock().unwrap();
    let agent = guard.as_mut().ok_or("助手未连接")?;
    agent
        .send(&HostToSidecar::OpenSession {
            conversation_id,
            session_file,
        })
        .map_err(|error| error.to_string())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantState {
    pub open: bool,
}

#[tauri::command]
pub fn get_assistant_state(state: State<AppState>) -> AssistantState {
    let config = state.config.lock().unwrap();
    AssistantState {
        open: config.assistant_open,
    }
}

#[tauri::command]
pub async fn toggle_assistant(state: State<'_, AppState>) -> Result<AssistantState, String> {
    let _transaction = state.ai_settings_tx.lock().await;
    let mut candidate = state.config.lock().unwrap().clone();
    candidate.assistant_open = !candidate.assistant_open;
    crate::config::save(&state.config_path, &candidate).map_err(|error| error.to_string())?;
    let open = candidate.assistant_open;
    *state.config.lock().unwrap() = candidate;
    Ok(AssistantState { open })
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatus {
    pub ready: bool,
    pub error: Option<String>,
}

#[tauri::command]
pub fn get_agent_status(state: State<AppState>) -> AgentStatus {
    let ready = *state.agent_ready.lock().unwrap();
    let error = state.agent_spawn_error.lock().unwrap().clone();
    AgentStatus { ready, error }
}

#[tauri::command]
pub fn set_active_note(
    state: State<AppState>,
    dir: String,
    note_id: String,
    path: String,
    kind: String,
) {
    *state.active_note.lock().unwrap() = Some(ActiveNote {
        dir,
        note_id,
        path,
        kind,
    });
}

#[tauri::command]
pub fn get_active_note(state: State<AppState>) -> Option<ActiveNote> {
    state.active_note.lock().unwrap().clone()
}

#[tauri::command]
pub fn agent_cancel(state: State<AppState>, request_id: String) -> Result<(), String> {
    let mut guard = state.agent.lock().unwrap();
    let agent = guard.as_mut().ok_or("助手未连接")?;
    agent
        .send(&HostToSidecar::Cancel { request_id })
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn agent_list_skills(app: tauri::AppHandle) -> Result<Vec<SkillSummary>, String> {
    let state = app.state::<AppState>();
    let seq = state.agent_seq.fetch_add(1, Ordering::Relaxed) + 1;
    let call_id = format!("sl{seq}");
    let (tx, rx) = tokio::sync::oneshot::channel::<Vec<SkillSummary>>();
    state
        .pending_skill_lists
        .lock()
        .unwrap()
        .insert(call_id.clone(), tx);
    {
        let mut guard = state.agent.lock().unwrap();
        let agent = guard.as_mut().ok_or("助手未连接")?;
        agent
            .send(&HostToSidecar::ListSkills {
                call_id: call_id.clone(),
            })
            .map_err(|error| error.to_string())?;
    }
    match tokio::time::timeout(std::time::Duration::from_secs(5), rx).await {
        Ok(Ok(skills)) => Ok(skills),
        Ok(Err(_)) => Err("skill 列表响应已丢弃".into()),
        Err(_) => {
            state.pending_skill_lists.lock().unwrap().remove(&call_id);
            Err("skill 列表超时".into())
        }
    }
}

#[tauri::command]
pub fn agent_reload_skills(app: tauri::AppHandle, state: State<AppState>) -> Result<(), String> {
    let paths = crate::agent::skill_paths_for_app(&app);
    let disabled_skill_names = state.config.lock().unwrap().disabled_skills.clone();
    let mut guard = state.agent.lock().unwrap();
    let agent = guard.as_mut().ok_or("助手未连接")?;
    agent
        .send(&HostToSidecar::SetSkillPaths {
            skill_paths: paths,
            disabled_skill_names,
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn agent_import_skill(app: tauri::AppHandle, source_path: String) -> Result<(), String> {
    let source = PathBuf::from(source_path);
    let skill_file = if source.is_dir() {
        source.join("SKILL.md")
    } else {
        source.clone()
    };
    if skill_file.file_name().and_then(|n| n.to_str()) != Some("SKILL.md") || !skill_file.is_file()
    {
        return Err("请选择包含 SKILL.md 的目录或 SKILL.md 文件".into());
    }
    let text = fs::read_to_string(&skill_file).map_err(|e| e.to_string())?;
    let name = text
        .lines()
        .find_map(|line| line.strip_prefix("name:").map(str::trim))
        .filter(|n| !n.is_empty())
        .ok_or("Skill 缺少 name")?;
    if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("Skill name 只能包含字母、数字、-、_".into());
    }
    if !text
        .lines()
        .any(|line| line.starts_with("description:") && !line[12..].trim().is_empty())
    {
        return Err("Skill 缺少 description".into());
    }
    let root = crate::paths::floatnote_home()
        .ok_or("无法确定应用数据目录")?
        .join("skills");
    let destination = root.join(name);
    if destination.exists() {
        return Err("同名 Skill 已存在".into());
    }
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    copy_skill_dir(skill_file.parent().unwrap_or(Path::new(".")), &destination)?;
    let app_for_state = app.clone();
    let state = app_for_state.state::<AppState>();
    agent_reload_skills(app, state)
}

fn copy_skill_dir(from: &Path, to: &Path) -> Result<(), String> {
    fs::create_dir_all(to).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(from).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let target = to.join(entry.file_name());
        if entry.file_type().map_err(|e| e.to_string())?.is_dir() {
            copy_skill_dir(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), target).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn resolve_permission(
    app: tauri::AppHandle,
    state: State<AppState>,
    request_id: String,
    decision: String,
    write_mode: String,
) -> Result<(), String> {
    let pending = state.pending_edits.lock().unwrap().remove(&request_id);
    let Some(p) = pending else {
        return Ok(());
    };
    if decision != "allow" {
        let _ = state.agent.lock().unwrap().as_mut().map(|agent| {
            if p.create_only {
                agent.send(&HostToSidecar::CreateNoteResult {
                    call_id: p.call_id,
                    ok: false,
                    denied: Some(true),
                    name: None,
                    error: None,
                })
            } else {
                agent.send(&HostToSidecar::ApplyEditResult {
                    call_id: p.call_id,
                    ok: false,
                    denied: Some(true),
                    version: None,
                    error: None,
                })
            }
        });
        return Ok(());
    }
    if p.create_only && std::path::Path::new(&p.path).exists() {
        let _ = state.agent.lock().unwrap().as_mut().map(|agent| {
            agent.send(&HostToSidecar::CreateNoteResult {
                call_id: p.call_id,
                ok: false,
                denied: Some(false),
                name: None,
                error: Some("同名文档已存在".into()),
            })
        });
        return Ok(());
    }
    crate::watcher::mark_self_write(&state.write_suppress, &p.path);
    let outcome = crate::agent::handle_apply_edit_at(
        &p.dir,
        &p.note_id,
        std::path::Path::new(&p.path),
        &p.old_content,
        &p.new_content,
        &write_mode,
        p.can_snapshot,
    );
    if outcome.ok {
        let _ = app.emit(
            "note://updated",
            &NoteUpdated {
                note_id: p.note_id.clone(),
                path: p.path.clone(),
                version: outcome.version.unwrap_or(0),
            },
        );
    }
    let _ = state.agent.lock().unwrap().as_mut().map(|agent| {
        if p.create_only {
            agent.send(&HostToSidecar::CreateNoteResult {
                call_id: p.call_id,
                ok: outcome.ok,
                denied: Some(false),
                name: outcome.ok.then(|| format!("{}.md", p.note_id)),
                error: outcome.error,
            })
        } else {
            agent.send(&HostToSidecar::ApplyEditResult {
                call_id: p.call_id,
                ok: outcome.ok,
                denied: Some(false),
                version: outcome.version,
                error: outcome.error,
            })
        }
    });
    Ok(())
}
