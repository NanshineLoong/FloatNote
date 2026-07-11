use crate::agent::{ActiveNote, HostToSidecar, NoteUpdated, PromptRef, PromptSkill, SkillSummary};
use crate::state::AppState;
use std::sync::atomic::Ordering;
use tauri::{Emitter, Manager, State};

/// Configure the sidecar provider/model connection.
#[tauri::command]
pub fn agent_configure(
    state: State<AppState>,
    provider: String,
    model: String,
    api_key: Option<String>,
    base_url: Option<String>,
) -> Result<(), String> {
    let mut guard = state.agent.lock().unwrap();
    let agent = guard.as_mut().ok_or("助手未连接")?;
    agent
        .send(&HostToSidecar::Configure {
            provider,
            model,
            api_key,
            base_url,
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn agent_send(
    state: State<AppState>,
    conversation_id: String,
    user_text: String,
    references: Option<Vec<PromptRef>>,
    skill: Option<PromptSkill>,
) -> Result<String, String> {
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
pub fn toggle_assistant(state: State<AppState>) -> Result<AssistantState, String> {
    let mut config = state.config.lock().unwrap();
    config.assistant_open = !config.assistant_open;
    crate::config::save(&state.config_path, &config).map_err(|error| error.to_string())?;
    Ok(AssistantState {
        open: config.assistant_open,
    })
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
            agent.send(&HostToSidecar::ApplyEditResult {
                call_id: p.call_id,
                ok: false,
                denied: Some(true),
                version: None,
                error: None,
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
        agent.send(&HostToSidecar::ApplyEditResult {
            call_id: p.call_id,
            ok: outcome.ok,
            denied: Some(false),
            version: outcome.version,
            error: outcome.error,
        })
    });
    Ok(())
}
