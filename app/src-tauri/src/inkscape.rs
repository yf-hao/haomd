use crate::new_trace_id;
use std::path::PathBuf;
use std::process::Command;

#[tauri::command]
pub async fn is_inkscape_available() -> Result<bool, String> {
    Ok(find_inkscape_binary().is_some())
}

#[tauri::command]
pub async fn convert_svg_to_emf(svg_markup: String) -> Result<String, String> {
    let inkscape = find_inkscape_binary().ok_or_else(|| "未检测到 Inkscape".to_string())?;
    let work_dir = std::env::temp_dir().join(format!(
        "haomd-inkscape-{}",
        new_trace_id().replace("trace_", "")
    ));
    std::fs::create_dir_all(&work_dir).map_err(|e| format!("创建 Inkscape 临时目录失败: {e}"))?;

    let input_path = work_dir.join("diagram.svg");
    let output_path = work_dir.join("diagram.emf");

    let result = (|| -> Result<String, String> {
        std::fs::write(&input_path, svg_markup.as_bytes())
            .map_err(|e| format!("写入 SVG 临时文件失败: {e}"))?;

        let output = Command::new(&inkscape)
            .arg(&input_path)
            .arg("--export-type=emf")
            .arg(format!(
                "--export-filename={}",
                output_path.to_string_lossy()
            ))
            .output()
            .map_err(|e| format!("调用 Inkscape 失败: {e}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let detail = if !stderr.is_empty() {
                stderr
            } else if !stdout.is_empty() {
                stdout
            } else {
                format!("退出码: {:?}", output.status.code())
            };
            return Err(format!("Inkscape 转换 EMF 失败: {detail}"));
        }

        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if !stderr.is_empty() {
            log::warn!("[inkscape][emf] {}", stderr);
        }

        let emf_bytes =
            std::fs::read(&output_path).map_err(|e| format!("读取 EMF 输出失败: {e}"))?;
        Ok(base64::encode(emf_bytes))
    })();

    let _ = std::fs::remove_dir_all(&work_dir);
    result
}

#[tauri::command]
pub async fn convert_svg_to_plain_svg(svg_markup: String) -> Result<String, String> {
    let inkscape = find_inkscape_binary().ok_or_else(|| "未检测到 Inkscape".to_string())?;
    let work_dir = std::env::temp_dir().join(format!(
        "haomd-inkscape-{}",
        new_trace_id().replace("trace_", "")
    ));
    std::fs::create_dir_all(&work_dir).map_err(|e| format!("创建 Inkscape 临时目录失败: {e}"))?;

    let input_path = work_dir.join("diagram.svg");
    let output_path = work_dir.join("diagram-plain.svg");

    let result = (|| -> Result<String, String> {
        std::fs::write(&input_path, svg_markup.as_bytes())
            .map_err(|e| format!("写入 SVG 临时文件失败: {e}"))?;

        let output = Command::new(&inkscape)
            .arg(&input_path)
            .arg("--export-plain-svg")
            .arg(format!(
                "--export-filename={}",
                output_path.to_string_lossy()
            ))
            .output()
            .map_err(|e| format!("调用 Inkscape 失败: {e}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let detail = if !stderr.is_empty() {
                stderr
            } else if !stdout.is_empty() {
                stdout
            } else {
                format!("退出码: {:?}", output.status.code())
            };
            return Err(format!("Inkscape 导出 Plain SVG 失败: {detail}"));
        }

        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if !stderr.is_empty() {
            log::warn!("[inkscape][plain-svg] {}", stderr);
        }

        let svg_bytes =
            std::fs::read(&output_path).map_err(|e| format!("读取 Plain SVG 输出失败: {e}"))?;
        Ok(base64::encode(svg_bytes))
    })();

    let _ = std::fs::remove_dir_all(&work_dir);
    result
}

fn find_inkscape_binary() -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    let mut candidates = Vec::<PathBuf>::new();

    for dir in std::env::split_paths(&path_var) {
        #[cfg(target_os = "windows")]
        {
            candidates.push(dir.join("inkscape.exe"));
            candidates.push(dir.join("inkscape.com"));
        }
        #[cfg(not(target_os = "windows"))]
        {
            candidates.push(dir.join("inkscape"));
        }
    }

    #[cfg(target_os = "macos")]
    {
        candidates.push(PathBuf::from(
            "/Applications/Inkscape.app/Contents/MacOS/inkscape",
        ));
        candidates.push(PathBuf::from("/opt/homebrew/bin/inkscape"));
        candidates.push(PathBuf::from("/usr/local/bin/inkscape"));
    }

    #[cfg(target_os = "windows")]
    {
        candidates.push(PathBuf::from(r"C:\Program Files\Inkscape\bin\inkscape.exe"));
        candidates.push(PathBuf::from(r"C:\Program Files\Inkscape\inkscape.exe"));
        candidates.push(PathBuf::from(
            r"C:\Program Files (x86)\Inkscape\bin\inkscape.exe",
        ));
        candidates.push(PathBuf::from(
            r"C:\Program Files (x86)\Inkscape\inkscape.exe",
        ));
    }

    #[cfg(target_os = "linux")]
    {
        candidates.push(PathBuf::from("/usr/bin/inkscape"));
        candidates.push(PathBuf::from("/usr/local/bin/inkscape"));
        candidates.push(PathBuf::from("/snap/bin/inkscape"));
    }

    candidates.into_iter().find_map(|candidate| {
        if !candidate.is_file() {
            return None;
        }
        std::fs::canonicalize(&candidate).ok().or(Some(candidate))
    })
}
