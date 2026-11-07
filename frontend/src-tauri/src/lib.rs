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

/// Abre el cuadro de diálogo nativo de Windows (SaveFileDialog) para guardar archivos
/// garantizando que el usuario pueda elegir la ubicación de destino.
#[tauri::command]
fn save_file_dialog(default_filename: String, content: String) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let temp_file = std::env::temp_dir().join(format!("bisync_dl_{}.tmp", timestamp));
        std::fs::write(&temp_file, content.as_bytes())
            .map_err(|e| format!("Error al preparar archivo temporal: {}", e))?;

        let temp_path = temp_file.to_string_lossy().to_string();
        let safe_filename = default_filename.replace('"', "").replace('\'', "");

        let ps_script = format!(
            concat!(
                "Add-Type -AssemblyName System.Windows.Forms; ",
                "$form = New-Object System.Windows.Forms.Form; ",
                "$form.TopMost = $true; ",
                "$dialog = New-Object System.Windows.Forms.SaveFileDialog; ",
                "$dialog.Title = 'Guardar Archivo - Bisync POS'; ",
                "$dialog.Filter = 'Archivos JSON (*.json)|*.json|Todos los archivos (*.*)|*.*'; ",
                "$dialog.FileName = '{filename}'; ",
                "$dialog.InitialDirectory = [Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile) + '\\Downloads'; ",
                "if ($dialog.ShowDialog($form) -eq [System.Windows.Forms.DialogResult]::OK) {{ ",
                "    Move-Item -Path '{temp}' -Destination $dialog.FileName -Force; ",
                "    Write-Output $dialog.FileName; ",
                "}} else {{ ",
                "    Remove-Item -Path '{temp}' -Force -ErrorAction SilentlyContinue; ",
                "    Write-Output 'CANCELLED'; ",
                "}}"
            ),
            filename = safe_filename,
            temp = temp_path.replace('\'', "''")
        );

        let output = Command::new("powershell")
            .args(["-NoProfile", "-Sta", "-WindowStyle", "Hidden", "-Command", &ps_script])
            .output()
            .map_err(|e| format!("Error ejecutando diálogo de Windows: {}", e))?;

        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if stdout == "CANCELLED" || stdout.is_empty() {
            Err("Guardado cancelado por el usuario".to_string())
        } else {
            Ok(stdout)
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("Diálogo nativo de guardado no disponible en esta plataforma".to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![get_windows_hwid, save_file_dialog])
        .run(tauri::generate_context!())
        .expect("Error al iniciar Bisync POS en Windows");
}

