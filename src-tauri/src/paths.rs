//! User-home and app-data path resolution. Cross-platform (`HOME` on POSIX,
//! `USERPROFILE` on Windows). Shared by chat history and the agent skill
//! resolver so neither owns a helper that belongs to neither.

use std::path::PathBuf;

pub(crate) fn user_home_dir() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        std::env::var_os("USERPROFILE").map(PathBuf::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var_os("HOME").map(PathBuf::from)
    }
}

/// `~/.floatnote` — the app's per-user data dir. None when the home dir is
/// unset. Callers create the dir (and hide it on Windows) themselves so this
/// stays a pure path resolver.
pub(crate) fn floatnote_home() -> Option<PathBuf> {
    user_home_dir().map(|home| home.join(".floatnote"))
}
