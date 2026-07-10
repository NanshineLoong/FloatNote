use serde::{Deserialize, Serialize};
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

const INDEX_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChatScopeType {
    Project,
    Document,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChatTitleState {
    Final,
    Temporary,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatConversationIndexEntry {
    pub id: String,
    pub session_file: String,
    pub scope_type: ChatScopeType,
    pub scope_path: String,
    pub scope_label: String,
    pub title: String,
    pub title_state: ChatTitleState,
    pub created_at: u64,
    pub updated_at: u64,
    pub last_opened_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatHistoryIndex {
    version: u32,
    conversations: Vec<ChatConversationIndexEntry>,
}

impl Default for ChatHistoryIndex {
    fn default() -> Self {
        Self {
            version: INDEX_VERSION,
            conversations: Vec::new(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct ChatHistoryStore {
    root: PathBuf,
}

impl ChatHistoryStore {
    pub fn default_for_user() -> io::Result<Self> {
        let floatnote = crate::paths::floatnote_home().ok_or_else(|| {
            io::Error::new(io::ErrorKind::NotFound, "user home directory not found")
        })?;
        try_hide_on_windows(&floatnote);
        Ok(Self::new_at(floatnote.join("chat-history")))
    }

    pub fn new_at(root: PathBuf) -> Self {
        Self { root }
    }

    pub fn session_dir(&self) -> PathBuf {
        self.root.join("sessions")
    }

    pub fn create(
        &self,
        scope_type: ChatScopeType,
        scope_path: &str,
        scope_label: &str,
    ) -> io::Result<ChatConversationIndexEntry> {
        self.ensure_dirs()?;
        let mut index = self.load_index()?;
        let now = now_millis();
        let id = next_conversation_id(now);
        let session_file = self.session_dir().join(format!("{id}.jsonl"));
        let entry = ChatConversationIndexEntry {
            id,
            session_file: session_file.to_string_lossy().into_owned(),
            scope_type,
            scope_path: scope_path.to_string(),
            scope_label: scope_label.to_string(),
            title: "新对话".to_string(),
            title_state: ChatTitleState::Temporary,
            created_at: now,
            updated_at: now,
            last_opened_at: now,
        };
        index.conversations.push(entry.clone());
        self.save_index(&index)?;
        Ok(entry)
    }

    pub fn get_for_scope(
        &self,
        scope_type: ChatScopeType,
        scope_path: &str,
    ) -> io::Result<Option<ChatConversationIndexEntry>> {
        let mut entries = self
            .load_index()?
            .conversations
            .into_iter()
            .filter(|entry| entry.scope_type == scope_type && entry.scope_path == scope_path)
            .collect::<Vec<_>>();
        sort_by_recent(&mut entries);
        Ok(entries.into_iter().next())
    }

    pub fn list_for_scope(
        &self,
        scope_type: ChatScopeType,
        scope_path: &str,
    ) -> io::Result<Vec<ChatConversationIndexEntry>> {
        let mut entries = self
            .load_index()?
            .conversations
            .into_iter()
            .filter(|entry| entry.scope_type == scope_type && entry.scope_path == scope_path)
            .collect::<Vec<_>>();
        sort_by_recent(&mut entries);
        Ok(entries)
    }

    pub fn list_recent(&self, limit: usize) -> io::Result<Vec<ChatConversationIndexEntry>> {
        let mut entries = self.load_index()?.conversations;
        sort_by_recent(&mut entries);
        entries.truncate(limit);
        Ok(entries)
    }

    pub fn list_all(
        &self,
        cursor: usize,
        limit: usize,
    ) -> io::Result<Vec<ChatConversationIndexEntry>> {
        let mut entries = self.load_index()?.conversations;
        sort_by_recent(&mut entries);
        Ok(entries.into_iter().skip(cursor).take(limit).collect())
    }

    pub fn open(&self, conversation_id: &str) -> io::Result<Option<ChatConversationIndexEntry>> {
        let mut index = self.load_index()?;
        let now = now_millis();
        let Some(entry) = index
            .conversations
            .iter_mut()
            .find(|entry| entry.id == conversation_id)
        else {
            return Ok(None);
        };
        entry.last_opened_at = now;
        entry.updated_at = entry.updated_at.max(now);
        let opened = entry.clone();
        self.save_index(&index)?;
        Ok(Some(opened))
    }

    pub fn update_title(
        &self,
        conversation_id: &str,
        title: &str,
        title_state: ChatTitleState,
    ) -> io::Result<Option<ChatConversationIndexEntry>> {
        let mut index = self.load_index()?;
        let Some(entry) = index
            .conversations
            .iter_mut()
            .find(|entry| entry.id == conversation_id)
        else {
            return Ok(None);
        };
        entry.title = title.to_string();
        entry.title_state = title_state;
        entry.updated_at = now_millis();
        let updated = entry.clone();
        self.save_index(&index)?;
        Ok(Some(updated))
    }

    pub fn delete(&self, conversation_id: &str) -> io::Result<Option<ChatConversationIndexEntry>> {
        let mut index = self.load_index()?;
        let Some(pos) = index
            .conversations
            .iter()
            .position(|entry| entry.id == conversation_id)
        else {
            return Ok(None);
        };
        let removed = index.conversations.remove(pos);
        match std::fs::remove_file(&removed.session_file) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
        self.save_index(&index)?;
        Ok(Some(removed))
    }

    pub fn clear_before(&self, timestamp: u64) -> io::Result<usize> {
        let mut index = self.load_index()?;
        let original_len = index.conversations.len();
        let mut keep = Vec::new();
        for entry in index.conversations {
            if entry.updated_at < timestamp {
                match std::fs::remove_file(&entry.session_file) {
                    Ok(()) => {}
                    Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                    Err(error) => return Err(error),
                }
            } else {
                keep.push(entry);
            }
        }
        let removed = original_len - keep.len();
        index.conversations = keep;
        self.save_index(&index)?;
        Ok(removed)
    }

    fn ensure_dirs(&self) -> io::Result<()> {
        std::fs::create_dir_all(self.session_dir())
    }

    fn index_path(&self) -> PathBuf {
        self.root.join("index.json")
    }

    fn load_index(&self) -> io::Result<ChatHistoryIndex> {
        self.ensure_dirs()?;
        let path = self.index_path();
        if !path.exists() {
            return Ok(ChatHistoryIndex::default());
        }
        let raw = std::fs::read_to_string(&path)?;
        match serde_json::from_str::<ChatHistoryIndex>(&raw) {
            Ok(mut index) => {
                if index.version != INDEX_VERSION {
                    index.version = INDEX_VERSION;
                }
                Ok(index)
            }
            Err(error) => {
                let backup = path.with_extension("json.bak");
                let _ = std::fs::copy(&path, backup);
                eprintln!("chat history index is corrupt; starting fresh: {error}");
                Ok(ChatHistoryIndex::default())
            }
        }
    }

    fn save_index(&self, index: &ChatHistoryIndex) -> io::Result<()> {
        self.ensure_dirs()?;
        let bytes = serde_json::to_vec_pretty(index)?;
        std::fs::write(self.index_path(), bytes)
    }
}

fn sort_by_recent(entries: &mut [ChatConversationIndexEntry]) {
    entries.sort_by(|a, b| {
        b.last_opened_at
            .cmp(&a.last_opened_at)
            .then_with(|| b.updated_at.cmp(&a.updated_at))
            .then_with(|| b.created_at.cmp(&a.created_at))
    });
}

fn now_millis() -> u64 {
    static LAST_NOW: AtomicU64 = AtomicU64::new(0);
    let current = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    loop {
        let last = LAST_NOW.load(Ordering::Relaxed);
        let next = current.max(last + 1);
        if LAST_NOW
            .compare_exchange(last, next, Ordering::Relaxed, Ordering::Relaxed)
            .is_ok()
        {
            return next;
        }
    }
}

fn next_conversation_id(now: u64) -> String {
    static NEXT_ID: AtomicU64 = AtomicU64::new(0);
    format!(
        "c{now}-{}-{}",
        std::process::id(),
        NEXT_ID.fetch_add(1, Ordering::Relaxed)
    )
}

fn try_hide_on_windows(path: &Path) {
    #[cfg(target_os = "windows")]
    {
        let _ = std::fs::create_dir_all(path);
        let _ = std::process::Command::new("attrib")
            .arg("+H")
            .arg(path)
            .status();
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = path;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_and_reopens_scope_conversation() {
        let dir = tempdir();
        let store = ChatHistoryStore::new_at(dir.path().join("chat-history"));

        let entry = store
            .create(ChatScopeType::Project, "/tmp/project", "Project")
            .unwrap();

        assert_eq!(entry.scope_type, ChatScopeType::Project);
        assert_eq!(entry.scope_path, "/tmp/project");
        assert_eq!(entry.scope_label, "Project");
        assert!(std::path::Path::new(&entry.session_file).starts_with(dir.path()));
        assert!(entry.title_state == ChatTitleState::Temporary);

        let last = store
            .get_for_scope(ChatScopeType::Project, "/tmp/project")
            .unwrap()
            .unwrap();
        assert_eq!(last.id, entry.id);
    }

    #[test]
    fn lists_recent_conversations_by_last_opened() {
        let dir = tempdir();
        let store = ChatHistoryStore::new_at(dir.path().join("chat-history"));
        let first = store
            .create(ChatScopeType::Project, "/tmp/project-a", "Project A")
            .unwrap();
        let second = store
            .create(ChatScopeType::Document, "/tmp/doc.md", "doc")
            .unwrap();

        store.open(&first.id).unwrap();

        let recent = store.list_recent(2).unwrap();
        assert_eq!(
            recent
                .iter()
                .map(|entry| entry.id.as_str())
                .collect::<Vec<_>>(),
            [first.id.as_str(), second.id.as_str(),]
        );
    }

    #[test]
    fn delete_removes_index_entry_and_session_file() {
        let dir = tempdir();
        let store = ChatHistoryStore::new_at(dir.path().join("chat-history"));
        let entry = store
            .create(ChatScopeType::Project, "/tmp/project", "Project")
            .unwrap();
        std::fs::write(&entry.session_file, "session\n").unwrap();

        store.delete(&entry.id).unwrap();

        assert!(!std::path::Path::new(&entry.session_file).exists());
        assert!(store.open(&entry.id).unwrap().is_none());
    }

    use crate::testutil::{tempdir, TempDir};
}
