//! Managed app state: the single `AppState` struct constructed at startup
//! and shared across Tauri commands, the sidecar reader thread, the popup,
//! and the selection monitor. Pulled out of `commands.rs` so the command file
//! is a thin handler layer and the state root has its own home.

use crate::agent::{ActiveNote, AgentHandle, MutationStore, SkillSummary};
use crate::config::Config;
use crate::popup::PopupCache;
use crate::watcher::{FileWatcher, SuppressList};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::AtomicU64;
use std::sync::Mutex;

/// Project roots that have been explicitly opened by this app instance.
/// Custom image URLs are constrained to these roots so another local
/// `_assets` directory cannot be used as an arbitrary-file reader.
#[derive(Default)]
pub struct AuthorizedRoots {
    roots: Mutex<Vec<PathBuf>>,
}

impl AuthorizedRoots {
    pub fn authorize(&self, root: &std::path::Path) {
        let Ok(root) = root.canonicalize() else {
            return;
        };
        let mut roots = self.roots.lock().unwrap();
        if !roots.iter().any(|known| known == &root) {
            roots.push(root);
        }
    }

    pub fn allows_image(&self, path: &std::path::Path) -> bool {
        let Ok(path) = path.canonicalize() else {
            return false;
        };
        self.roots
            .lock()
            .unwrap()
            .iter()
            .any(|root| path.starts_with(root))
    }
}

pub struct AppState {
    pub config: Mutex<Config>,
    /// Serializes provider snapshot → sidecar → disk → memory transactions.
    pub ai_settings_tx: tokio::sync::Mutex<()>,
    pub config_path: PathBuf,
    /// 活的 sidecar 句柄；None 表示尚未起或已断开。
    pub agent: Mutex<Option<AgentHandle>>,
    /// sidecar 是否已发 `ready`。
    pub agent_ready: Mutex<bool>,
    /// sidecar 启动失败时记录错误信息，供前端初始化时查询。
    pub agent_spawn_error: Mutex<Option<String>>,
    /// agent_send 记录的当前活动笔记，供 apply_write 定位文件。
    pub active_note: Mutex<Option<ActiveNote>>,
    /// 单调递增的 requestId 计数器。
    pub agent_seq: AtomicU64,
    /// 文件系统监听器；None 表示尚未初始化。
    pub watcher: Mutex<Option<FileWatcher>>,
    /// 自身写入抑制表，与 watcher 共享。
    pub write_suppress: SuppressList,
    /// 划词弹窗急切抓取的待提交文本。
    pub popup_cache: PopupCache,
    /// Structured mutation reviews and one-use approval leases.
    pub mutations: Mutex<MutationStore>,
    /// `agent_list_skills` 的 host 侧一次性等待表：call_id → oneshot sender。
    /// reader 线程收到 `SkillsList` 时取出 sender 解除等待。
    pub pending_skill_lists:
        Mutex<HashMap<String, tokio::sync::oneshot::Sender<Vec<SkillSummary>>>>,
    /// Correlated configure replies used by transactional provider changes.
    pub pending_agent_configs:
        Mutex<HashMap<String, tokio::sync::oneshot::Sender<Result<(), String>>>>,
    /// Correlated rewind replies; the frontend only truncates once this resolves successfully.
    pub pending_agent_rewinds:
        Mutex<HashMap<String, tokio::sync::oneshot::Sender<Result<(), String>>>>,
    /// Correlated new-session acknowledgements; prompt must not race installation.
    pub pending_agent_sessions:
        Mutex<HashMap<String, tokio::sync::oneshot::Sender<Result<(), String>>>>,
    /// Correlated no-session AI task replies.
    pub pending_one_shots:
        Mutex<HashMap<String, tokio::sync::oneshot::Sender<Result<String, String>>>>,
    /// Roots authorised by opening/watching a project in this app instance.
    pub authorized_roots: AuthorizedRoots,
}

#[cfg(test)]
mod tests {
    use super::AuthorizedRoots;
    use crate::testutil::tempdir;

    #[test]
    fn authorized_roots_only_allow_assets_in_registered_project() {
        let project = tempdir();
        let outside = tempdir();
        let allowed = project.path().join("_assets").join("photo.png");
        let denied = outside.path().join("_assets").join("photo.png");
        std::fs::create_dir_all(allowed.parent().unwrap()).unwrap();
        std::fs::create_dir_all(denied.parent().unwrap()).unwrap();
        std::fs::write(&allowed, b"image").unwrap();
        std::fs::write(&denied, b"image").unwrap();

        let roots = AuthorizedRoots::default();
        roots.authorize(project.path());

        assert!(roots.allows_image(&allowed));
        assert!(!roots.allows_image(&denied));
    }
}
