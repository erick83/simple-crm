use serde::Serialize;
use sha2::{Digest, Sha256};
use std::process::Command;

#[derive(Serialize)]
pub struct HardwareIdentity {
    pub motherboard_uuid: String,
    pub cpu_serial: String,
    pub hwid: String,
}

#[cfg(target_os = "windows")]
fn query_powershell(expr: &str) -> String {
    Command::new("powershell")
        .args(["-NoProfile", "-Command", expr])
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_uppercase())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "UNKNOWN".to_string())
}

#[cfg(not(target_os = "windows"))]
fn query_powershell(_expr: &str) -> String {
    "NON-WINDOWS-HOST".to_string()
}

/// Extrae el Hardware ID inmutable en Windows:
/// HWID = SHA256(Motherboard_UUID:CPU_Serial) según AGENTS.md §4
#[tauri::command]
fn get_windows_hwid() -> HardwareIdentity {
    let motherboard_uuid = query_powershell("(Get-CimInstance Win32_ComputerSystemProduct).UUID");
    let cpu_serial = query_powershell("(Get-CimInstance Win32_Processor | Select-Object -First 1).ProcessorId");

    let raw = format!("{}:{}", motherboard_uuid, cpu_serial);
    let mut hasher = Sha256::new();
    hasher.update(raw.as_bytes());
    let hwid = format!("{:x}", hasher.finalize());

    HardwareIdentity {
        motherboard_uuid,
        cpu_serial,
        hwid,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![get_windows_hwid])
        .run(tauri::generate_context!())
        .expect("Error al iniciar Bisync POS en Windows");
}

