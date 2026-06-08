use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(default)]
pub struct Config {
    pub working_dir: Option<String>,
    pub shortcut_capture: String,
    pub shortcut_toggle: String,
    pub font_size: u32,
    pub launch_at_login: bool,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            working_dir: None,
            shortcut_capture: "Alt+Cmd+C".to_string(),
            shortcut_toggle: "Alt+Cmd+N".to_string(),
            font_size: 15,
            launch_at_login: false,
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
}

