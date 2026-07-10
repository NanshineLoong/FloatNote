use crate::chat_history::{
    ChatConversationIndexEntry, ChatHistoryStore, ChatScopeType, ChatTitleState,
};

fn chat_store() -> Result<ChatHistoryStore, String> {
    ChatHistoryStore::default_for_user().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn chat_get_for_scope(
    scope_type: ChatScopeType,
    scope_path: String,
) -> Result<Option<ChatConversationIndexEntry>, String> {
    chat_store()?
        .get_for_scope(scope_type, &scope_path)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn chat_create(
    app: tauri::AppHandle,
    scope_type: ChatScopeType,
    scope_path: String,
    scope_label: String,
) -> Result<ChatConversationIndexEntry, String> {
    let entry = chat_store()?
        .create(scope_type, &scope_path, &scope_label)
        .map_err(|error| error.to_string())?;
    let _ = crate::tray::refresh_menu(&app);
    Ok(entry)
}

#[tauri::command]
pub fn chat_list_for_scope(
    scope_type: ChatScopeType,
    scope_path: String,
) -> Result<Vec<ChatConversationIndexEntry>, String> {
    chat_store()?
        .list_for_scope(scope_type, &scope_path)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn chat_list_all(
    cursor: usize,
    limit: usize,
) -> Result<Vec<ChatConversationIndexEntry>, String> {
    chat_store()?
        .list_all(cursor, limit)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn chat_open(
    app: tauri::AppHandle,
    conversation_id: String,
) -> Result<Option<ChatConversationIndexEntry>, String> {
    let entry = chat_store()?
        .open(&conversation_id)
        .map_err(|error| error.to_string())?;
    let _ = crate::tray::refresh_menu(&app);
    Ok(entry)
}

#[tauri::command]
pub fn chat_update_title(
    app: tauri::AppHandle,
    conversation_id: String,
    title: String,
    title_state: ChatTitleState,
) -> Result<Option<ChatConversationIndexEntry>, String> {
    let entry = chat_store()?
        .update_title(&conversation_id, &title, title_state)
        .map_err(|error| error.to_string())?;
    let _ = crate::tray::refresh_menu(&app);
    Ok(entry)
}

#[tauri::command]
pub fn chat_delete(
    app: tauri::AppHandle,
    conversation_id: String,
) -> Result<Option<ChatConversationIndexEntry>, String> {
    let entry = chat_store()?
        .delete(&conversation_id)
        .map_err(|error| error.to_string())?;
    let _ = crate::tray::refresh_menu(&app);
    Ok(entry)
}

#[tauri::command]
pub fn chat_clear_before(app: tauri::AppHandle, timestamp: u64) -> Result<usize, String> {
    let removed = chat_store()?
        .clear_before(timestamp)
        .map_err(|error| error.to_string())?;
    let _ = crate::tray::refresh_menu(&app);
    Ok(removed)
}
