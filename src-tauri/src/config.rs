use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct AiConnection {
    pub id: String, pub name: String, pub kind: String, pub provider: String,
    pub protocol: String, pub api_key: String, pub base_url: Option<String>,
    pub headers: std::collections::BTreeMap<String, String>,
    pub models: Vec<AiCustomModel>,
}
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct AiCustomModel { pub id: String, pub name: Option<String>, pub reasoning: bool, pub input: Vec<String>, pub context_window: u32, pub max_tokens: u32, pub thinking_level_map: std::collections::BTreeMap<String, Option<String>> }
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct AiModelSelection { pub connection_id: String, pub model_id: String, pub thinking_level: String }

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
    /// 划词悬浮窗模式："auto"（鼠标选区自动弹）/ "shortcut"（仅快捷键）/ "off"（关闭自动监听）。
    pub auto_popup_mode: String,
    /// 笔记窗内快捷键（窗口聚焦时生效，纯前端分派）。默认值见 WindowShortcuts::default。
    pub window_shortcuts: WindowShortcuts,
    pub font_size: u32,
    /// "system" | "light" | "dark". Frontend resolves `system` per window.
    pub theme: String,
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
    pub ai_connections: Vec<AiConnection>,
    pub ai_model_selection: Option<AiModelSelection>,
    /// Names of installed Skills intentionally excluded from the AI tutor.
    pub disabled_skills: Vec<String>,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            working_dir: None,
            shortcut_capture: "Alt+Cmd+C".to_string(),
            shortcut_toggle: "Alt+Cmd+N".to_string(),
            shortcut_popup: "Alt+Cmd+P".to_string(),
            auto_popup_mode: "auto".to_string(),
            window_shortcuts: WindowShortcuts::default(),
            font_size: 15,
            theme: "system".to_string(),
            launch_at_login: false,
            assistant_open: false,
            recent_projects: Vec::new(),
            recent_documents: Vec::new(),
            ai_provider: String::new(),
            ai_model: String::new(),
            ai_api_key: String::new(),
            ai_base_url: String::new(),
            ai_connections: Vec::new(),
            ai_model_selection: None,
            disabled_skills: Vec::new(),
        }
    }
}

impl Config {
    pub fn effective_ai_connections(&self) -> Vec<AiConnection> {
        if !self.ai_connections.is_empty() { return self.ai_connections.clone(); }
        if self.ai_provider.is_empty() { return Vec::new(); }
        let official = self.ai_provider == "openai" || self.ai_provider == "anthropic";
        vec![AiConnection { id: "migrated-default".into(), name: self.ai_provider.clone(), kind: if official { format!("official-{}", self.ai_provider) } else { "custom".into() }, provider: self.ai_provider.clone(), protocol: if self.ai_provider == "anthropic" { "anthropic-messages".into() } else { "openai-completions".into() }, api_key: self.ai_api_key.clone(), base_url: (!self.ai_base_url.is_empty()).then(|| self.ai_base_url.clone()), headers: Default::default(), models: (!self.ai_model.is_empty()).then(|| AiCustomModel { id: self.ai_model.clone(), name: None, reasoning: false, input: vec!["text".into()], context_window: 128000, max_tokens: 8192, thinking_level_map: Default::default() }).into_iter().collect() }]
    }
    pub fn effective_ai_selection(&self) -> AiModelSelection { self.ai_model_selection.clone().unwrap_or(AiModelSelection { connection_id: "migrated-default".into(), model_id: self.ai_model.clone(), thinking_level: "off".into() }) }
}

pub fn load(path: &Path) -> Config {
    match std::fs::read_to_string(path) {
        Ok(contents) => {
            let mut config: Config = serde_json::from_str(&contents).unwrap_or_default();
            config.auto_popup_mode = normalize_auto_popup_mode(&config.auto_popup_mode);
            config
        }
        Err(_) => Config::default(),
    }
}

pub fn normalize_auto_popup_mode(mode: &str) -> String {
    match mode {
        "every" | "auto" => "auto",
        "modifier" | "shortcut" => "shortcut",
        "off" => "off",
        _ => "auto",
    }
    .to_string()
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
    fn auto_popup_mode_defaults_auto() {
        let config = Config::default();
        assert_eq!(config.auto_popup_mode, "auto");
    }

    #[test]
    fn legacy_auto_popup_modes_are_migrated() {
        assert_eq!(normalize_auto_popup_mode("every"), "auto");
        assert_eq!(normalize_auto_popup_mode("modifier"), "shortcut");
        assert_eq!(normalize_auto_popup_mode("off"), "off");
    }

    #[test]
    fn theme_defaults_to_system() {
        assert_eq!(Config::default().theme, "system");
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

    #[test]
    fn legacy_ai_fields_migrate_to_a_connection() {
        let config: Config = serde_json::from_str(r#"{"ai_provider":"anthropic","ai_model":"claude-sonnet-4-5","ai_api_key":"k"}"#).unwrap();
        let connections = config.effective_ai_connections();
        assert_eq!(connections[0].protocol, "anthropic-messages");
        assert_eq!(connections[0].provider, "anthropic");
        assert_eq!(config.effective_ai_selection().model_id, "claude-sonnet-4-5");
    }
}
