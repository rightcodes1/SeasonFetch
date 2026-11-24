use serde::Serialize;
use tauri::{AppHandle, Emitter};

const DESKTOP_STATUS_EVENT: &str = "desktop-status";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopStatus {
    app_name: &'static str,
    platform: &'static str,
    message: &'static str,
}

#[tauri::command]
fn desktop_status(app: AppHandle) -> Result<DesktopStatus, String> {
    let status = DesktopStatus {
        app_name: "SeasonFetch",
        platform: std::env::consts::OS,
        message: "Typed Rust command and event bridge connected.",
    };

    app.emit(DESKTOP_STATUS_EVENT, status.clone())
        .map_err(|error| error.to_string())?;

    Ok(status)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![desktop_status])
        .run(tauri::generate_context!())
        .expect("error while running SeasonFetch desktop shell");
}
