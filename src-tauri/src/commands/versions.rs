use crate::state::AppState;
use crate::{notes, versions};
use std::path::Path;
use tauri::State;

fn check_restore_mtime(path: &Path, expected_mtime: Option<u64>) -> Result<(), String> {
    if let Some(expected) = expected_mtime {
        if notes::mtime_millis(path) != Some(expected) {
            return Err("restore conflict: note changed on disk".to_string());
        }
    }
    Ok(())
}

#[tauri::command]
pub fn list_versions(dir: String, note_id: String) -> Vec<versions::VersionEntry> {
    versions::list(std::path::Path::new(&dir), &note_id)
}

#[tauri::command]
pub fn snapshot_note(
    dir: String,
    note_id: String,
    content: String,
    source: String,
) -> Result<u32, String> {
    versions::snapshot(std::path::Path::new(&dir), &note_id, &content, &source)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn read_version(dir: String, note_id: String, v: u32) -> Result<String, String> {
    versions::read_version(std::path::Path::new(&dir), &note_id, v)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn rename_version(dir: String, note_id: String, v: u32, name: String) -> Result<(), String> {
    versions::rename_version(std::path::Path::new(&dir), &note_id, v, &name)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn delete_version(dir: String, note_id: String, v: u32) -> Result<(), String> {
    versions::delete_version(std::path::Path::new(&dir), &note_id, v)
        .map_err(|error| error.to_string())
}

/// Restore `v` after preserving different current content as a named safety
/// backup. Reading/previewing versions uses `read_version` and never writes.
#[tauri::command]
pub fn restore_version(
    state: State<AppState>,
    dir: String,
    note_id: String,
    path: String,
    current_content: String,
    v: u32,
    expected_mtime: Option<u64>,
) -> Result<notes::NoteContent, String> {
    let note_path = std::path::Path::new(&path);
    check_restore_mtime(note_path, expected_mtime)?;
    let prepared =
        versions::prepare_restore(std::path::Path::new(&dir), &note_id, &current_content, v)
            .map_err(|error| error.to_string())?;
    crate::watcher::mark_self_write(&state.write_suppress, &path);
    if let Err(error) = notes::write_atomic(note_path, &prepared.content) {
        if let Some(backup_v) = prepared.backup_v {
            if let Err(cleanup_error) =
                versions::delete_version(std::path::Path::new(&dir), &note_id, backup_v)
            {
                return Err(format!(
                    "restore write failed: {error}; backup cleanup failed: {cleanup_error}"
                ));
            }
        }
        return Err(error.to_string());
    }
    Ok(notes::NoteContent {
        content: prepared.content,
        mtime: notes::mtime_millis(note_path),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn restore_mtime_guard_rejects_a_changed_file() {
        let dir = crate::testutil::tempdir();
        let path = dir.path().join("piece.md");
        std::fs::write(&path, "one").unwrap();
        let actual = notes::mtime_millis(&path).unwrap();

        assert!(check_restore_mtime(&path, Some(actual)).is_ok());
        assert!(check_restore_mtime(&path, Some(actual.saturating_sub(1))).is_err());
    }
}
