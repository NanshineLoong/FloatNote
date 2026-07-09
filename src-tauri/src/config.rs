use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(default)]
pub struct WindowShortcuts {
    pub assistant: String,
    pub assistant_bubble: String,
    pub action_panel: String,
    pub add_action: String,
    pub new_conversation: String,
    pub view_inbox: String,
    pub view_piece: String,
    pub view_split: String,
}

impl Default for WindowShortcuts {
    fn default() -> Self {
        WindowShortcuts {
            assistant: "Cmd+J".to_string(),
            assistant_bubble: "Cmd+B".to_string(),
            action_panel: "Cmd+T".to_string(),
            add_action: "Cmd+G".to_string(),
            new_conversation: "Cmd+K".to_string(),
            view_inbox: "Cmd+1".to_string(),
            view_piece: "Cmd+2".to_string(),
            view_split: "Cmd+3".to_string(),
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(default)]
pub struct Config {
    pub working_dir: Option<String>,
    pub shortcut_capture: String,
    pub shortcut_toggle: String,
    /// 划词悬浮窗快捷键（弹窗式抓取），默认 ⌥⌘P。与 shortcut_capture（直接抓取）独立。
    pub shortcut_popup: String,
    /// 划词悬浮窗自动触发模式："off"（关闭）/ "every"（每次选中即弹）/ "modifier"（按住 ⌥ 选中时弹）。
    pub auto_popup_mode: String,
    /// 笔记窗内快捷键（窗口聚焦时生效，纯前端分派）。默认值见 WindowShortcuts::default。
    pub window_shortcuts: WindowShortcuts,
    /// 写作区默认是否以大纲模式打开。窗口内手动切换只影响当前会话。
    pub piece_outline_default: bool,
    pub font_size: u32,
    pub launch_at_login: bool,
    /// 助手是否展开显示（折叠则隐藏）。助手始终活在笔记窗内，按窗宽自动 inline/floating。
    pub assistant_open: bool,
    /// 最近打开过的项目空间绝对路径，最近的在前（MRU）。上限由前端维护（8 条）。
    /// 项目可散落在磁盘任意位置，此列表是项目切换菜单的唯一数据来源。
    pub recent_projects: Vec<String>,
    /// 最近打开过的独立文档（loose `.md`，不在任何项目空间内）绝对路径，最近的在前。
    /// 与 `recent_projects` 平行，是文档切换菜单的数据来源。
    pub recent_documents: Vec<String>,
    // ── AI 助手持久化配置 ──
    /// AI 服务商标识："anthropic" | "openai" | "google" | "custom"，空串表示未配置。
    pub ai_provider: String,
    /// 模型名称，如 "claude-sonnet-4-20250514"、"gpt-4o"。
    pub ai_model: String,
    /// API 密钥，本地明文存储（桌面应用惯例）。
    pub ai_api_key: String,
    /// 自定义 API 地址，仅 provider="custom" 时使用。
    pub ai_base_url: String,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            working_dir: None,
            shortcut_capture: "Alt+Cmd+C".to_string(),
            shortcut_toggle: "Alt+Cmd+N".to_string(),
            shortcut_popup: "Alt+Cmd+P".to_string(),
            auto_popup_mode: "off".to_string(),
            window_shortcuts: WindowShortcuts::default(),
            piece_outline_default: false,
            font_size: 15,
            launch_at_login: false,
            assistant_open: false,
            recent_projects: Vec::new(),
            recent_documents: Vec::new(),
            ai_provider: String::new(),
            ai_model: String::new(),
            ai_api_key: String::new(),
            ai_base_url: String::new(),
        }
    }
}

pub fn load(path: &Path) -> Config {
    match std::fs::read_to_string(path) {
        Ok(contents) => serde_json::from_str(&contents).unwrap_or_default(),
        Err(_) => Config::default(),
    }
}

pub fn save(path: &Path, config: &Config) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, serde_json::to_string_pretty(config).unwrap())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_json_yields_defaults() {
        let config: Config = serde_json::from_str("{}").unwrap();
        assert_eq!(config, Config::default());
    }

    #[test]
    fn partial_json_keeps_other_defaults() {
        let config: Config = serde_json::from_str(r#"{"font_size":20}"#).unwrap();
        assert_eq!(config.font_size, 20);
        assert_eq!(config.shortcut_capture, "Alt+Cmd+C");
    }

    #[test]
    fn roundtrip() {
        let mut config = Config::default();
        config.working_dir = Some("/tmp/x".to_string());
        let serialized = serde_json::to_string(&config).unwrap();
        assert_eq!(serde_json::from_str::<Config>(&serialized).unwrap(), config);
    }

    #[test]
    fn popup_shortcut_has_default() {
        let config = Config::default();
        assert_eq!(config.shortcut_popup, "Alt+Cmd+P");
    }

    #[test]
    fn partial_json_keeps_popup_default() {
        let config: Config = serde_json::from_str(r#"{"font_size":20}"#).unwrap();
        assert_eq!(config.shortcut_popup, "Alt+Cmd+P");
    }

    #[test]
    fn auto_popup_mode_defaults_off() {
        let config = Config::default();
        assert_eq!(config.auto_popup_mode, "off");
    }

    #[test]
    fn piece_outline_default_starts_false() {
        let config = Config::default();
        assert!(!config.piece_outline_default);
    }

    #[test]
    fn window_shortcuts_default() {
        let c = Config::default();
        assert_eq!(c.window_shortcuts.assistant, "Cmd+J");
        assert_eq!(c.window_shortcuts.view_split, "Cmd+3");
    }

    #[test]
    fn partial_json_keeps_window_shortcuts_default() {
        let config: Config = serde_json::from_str(r#"{"font_size":20}"#).unwrap();
        assert_eq!(config.window_shortcuts.assistant, "Cmd+J");
    }
}
