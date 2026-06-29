//! 文件系统监听模块：监听项目目录下 .md 文件的外部修改，通过 Tauri 事件
//! `file://changed` 广播给前端，实现实时刷新。
//!
//! 自身写入（write_note / restore_version 等）通过 `SuppressList` 短暂
//! 抑制，避免把应用内保存误报为外部修改。
//!
//! 平台差异：
//! - macOS (FSEvent)：事件合批投递，延迟约 300ms；保存可能同时产生 Modify + Create。
//! - Windows (ReadDirectoryChangesW)：事件更即时；原子保存（写临时文件→重命名）
//!   产生 Remove + Create，本模块已处理 Create 事件。
//! 去抖窗口 (500ms) 覆盖两种行为。

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::{AppHandle, Emitter};

/// 自身写入抑制表：path → 写入时刻。
/// watcher 回调检查此表，窗口内的条目视为自身写入并跳过。
pub type SuppressList = Arc<Mutex<HashMap<String, Instant>>>;

/// 抑制窗口：写入后 2 秒内的同名事件视为自身写入。
const SUPPRESS_WINDOW: std::time::Duration = std::time::Duration::from_secs(2);

/// 去抖窗口：同一文件 500ms 内只广播一次。
const DEBOUNCE_WINDOW: std::time::Duration = std::time::Duration::from_millis(500);

/// 创建一个新的共享抑制表（在 setup 时调用，注入 AppState）。
pub fn new_suppress_list() -> SuppressList {
    Arc::new(Mutex::new(HashMap::new()))
}

/// 在写盘 **之前** 把路径标记为"正在自身写入"，消除 TOCTOU 竞态。
pub fn mark_self_write(suppress: &SuppressList, path: &str) {
    let key = normalize_path(path);
    suppress
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(key, Instant::now());
}

/// 路径规范化：确保抑制表和 watcher 事件使用一致的路径格式。
fn normalize_path(path: &str) -> String {
    Path::new(path)
        .canonicalize()
        .unwrap_or_else(|_| PathBuf::from(path))
        .to_string_lossy()
        .to_string()
}

/// 检查某路径是否处于抑制窗口内，并顺便清理过期条目。
fn is_suppressed(suppress: &SuppressList, path: &str) -> bool {
    let mut map = suppress.lock().unwrap_or_else(|e| e.into_inner());
    map.retain(|_, t| t.elapsed() < SUPPRESS_WINDOW);
    map.contains_key(path)
}

/// 文件监听器：持有一个 notify watcher 和当前监听目录。
pub struct FileWatcher {
    watcher: RecommendedWatcher,
    watch_path: Option<PathBuf>,
}

impl FileWatcher {
    /// 创建一个空的 watcher，尚未监听任何目录。
    pub fn new(app: AppHandle, suppress: SuppressList) -> Result<Self, String> {
        let last_emit: Arc<Mutex<HashMap<String, Instant>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let last_emit_for_cb = last_emit.clone();

        let watcher = notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
            if let Ok(event) = res {
                // 只关心内容修改和创建（某些编辑器先删后建）。
                if !matches!(event.kind, EventKind::Modify(_) | EventKind::Create(_)) {
                    return;
                }
                for path in &event.paths {
                    handle_file_event(&app, &suppress, &last_emit_for_cb, path);
                }
            }
        })
        .map_err(|e| format!("创建文件监听器失败: {e}"))?;

        Ok(Self {
            watcher,
            watch_path: None,
        })
    }

    /// 切换到监听新目录；先取消旧目录，再监听新目录。
    pub fn watch_dir(&mut self, dir: &Path) -> Result<(), String> {
        if let Some(old) = self.watch_path.take() {
            let _ = self.watcher.unwatch(&old);
        }

        self.watcher
            .watch(dir, RecursiveMode::NonRecursive)
            .map_err(|e| format!("监听目录失败: {e}"))?;

        self.watch_path = Some(dir.to_path_buf());
        Ok(())
    }

    /// 取消当前目录监听。
    pub fn unwatch(&mut self) {
        if let Some(path) = self.watch_path.take() {
            let _ = self.watcher.unwatch(&path);
        }
    }
}

/// 处理单个文件事件：过滤 .md → 规范化路径 → 抑制自身写入 → 去抖 → 广播。
fn handle_file_event(
    app: &AppHandle,
    suppress: &SuppressList,
    last_emit: &Arc<Mutex<HashMap<String, Instant>>>,
    path: &Path,
) {
    // 只看 .md 文件。
    if path.extension().and_then(|e| e.to_str()) != Some("md") {
        return;
    }

    let path_str = normalize_path(&path.to_string_lossy());

    // 自身写入抑制。
    if is_suppressed(suppress, &path_str) {
        return;
    }

    // 去抖：500ms 内同文件只发一次；顺便清理过期条目。
    {
        let mut map = last_emit.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(prev) = map.get(&path_str) {
            if prev.elapsed() < DEBOUNCE_WINDOW {
                return;
            }
        }
        map.insert(path_str.clone(), Instant::now());
        // 懒清理：只保留最近 5 秒内的条目，防止长期运行后无限增长。
        map.retain(|_, t| t.elapsed() < DEBOUNCE_WINDOW * 10);
    }

    let _ = app.emit("file://changed", &path_str);
}
