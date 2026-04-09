use serde_json::json;
use tauri::WebviewWindowBuilder;

fn env_or_build_default(key: &str, build_default: Option<&'static str>) -> Option<String> {
  std::env::var(key)
    .ok()
    .or_else(|| build_default.map(str::to_owned))
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty())
}

fn build_init_script() -> String {
  let ws_url = env_or_build_default("T3_REMOTE_WS_URL", option_env!("T3_REMOTE_WS_URL"));
  let label = env_or_build_default("T3_REMOTE_LABEL", option_env!("T3_REMOTE_LABEL"))
    .unwrap_or_else(|| "Studio host".to_string());

  let bootstrap = json!({
    "wsUrl": ws_url,
    "label": label,
  });

  format!(
    r#"
(() => {{
  const storageKeys = {{
    wsUrl: "t3remote.air.wsUrl",
    label: "t3remote.air.label",
  }};
  const envBootstrap = {bootstrap};

  if (!localStorage.getItem(storageKeys.wsUrl) && typeof envBootstrap.wsUrl === "string" && envBootstrap.wsUrl.length > 0) {{
    localStorage.setItem(storageKeys.wsUrl, envBootstrap.wsUrl);
  }}
  if (!localStorage.getItem(storageKeys.label) && typeof envBootstrap.label === "string" && envBootstrap.label.length > 0) {{
    localStorage.setItem(storageKeys.label, envBootstrap.label);
  }}

  const wsUrl = localStorage.getItem(storageKeys.wsUrl);
  const label = localStorage.getItem(storageKeys.label) || envBootstrap.label || "Studio host";
  const bootstrapState = wsUrl ? {{ wsUrl, label }} : null;
  const disabledUpdateState = {{
    enabled: false,
    status: "disabled",
    currentVersion: "0.1.0",
    hostArch: "arm64",
    appArch: "arm64",
    runningUnderArm64Translation: false,
    availableVersion: null,
    downloadedVersion: null,
    downloadPercent: null,
    checkedAt: null,
    message: "Auto-update is not implemented in the Tauri shell yet.",
    errorContext: null,
    canRetry: false,
  }};

  window.desktopBridge = {{
    getWsUrl: () => bootstrapState?.wsUrl ?? null,
    getLocalEnvironmentBootstrap: () => bootstrapState,
    pickFolder: async () => null,
    confirm: async (message) => window.confirm(message),
    setTheme: async () => undefined,
    openExternal: async (url) => {{
      window.open(url, "_blank", "noopener,noreferrer");
      return true;
    }},
    onMenuAction: () => () => {{}},
    getUpdateState: async () => disabledUpdateState,
    checkForUpdate: async () => ({{ checked: false, state: disabledUpdateState }}),
    downloadUpdate: async () => ({{ accepted: false, completed: false, state: disabledUpdateState }}),
    installUpdate: async () => ({{ accepted: false, completed: false, state: disabledUpdateState }}),
    onUpdateState: () => () => {{}},
  }};
}})();
"#
  )
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      let window_config = app
        .config()
        .app
        .windows
        .first()
        .cloned()
        .expect("missing main window configuration");

      WebviewWindowBuilder::from_config(app.handle(), &window_config)?
        .initialization_script(&build_init_script())
        .build()?;

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
