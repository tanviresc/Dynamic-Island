mod ws_server;
mod desktop_detector;
mod context_detector;

use serde::Deserialize;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use tauri::{Emitter, Manager, PhysicalPosition, PhysicalSize, Position, Size};
use ws_server::{WsServerStatus, WsState};

#[derive(Debug, Deserialize, Clone)]
struct ServerConfig {
    #[serde(default = "default_port")]
    port: u16,
    #[serde(default, rename = "allowedExtensionId")]
    allowed_extension_id: String,
}

fn default_port() -> u16 {
    34567
}

#[derive(Debug, Deserialize, Clone)]
struct FullscreenConfig {
    #[serde(rename = "checkIntervalSec")]
    check_interval_sec: Option<u64>,
}

#[derive(Debug, Deserialize, Clone)]
struct IslandConfig {
    #[serde(default = "default_gap")]
    window_gap: f64,
    #[serde(default = "default_width_pct")]
    width_percent: f64,
    #[serde(default = "default_height")]
    height: f64,
    #[serde(default)]
    dev_test_panel: bool,
    #[serde(default = "default_server")]
    server: ServerConfig,
    #[serde(default = "default_fs_check_sec")]
    fullscreen_check_sec: u64,
}

fn default_fs_check_sec() -> u64 {
    3
}

fn default_server() -> ServerConfig {
    ServerConfig {
        port: 34567,
        allowed_extension_id: String::new(),
    }
}

fn default_gap() -> f64 {
    12.0
}
fn default_width_pct() -> f64 {
    50.0
}
fn default_height() -> f64 {
    76.0
}

fn get_config_candidates() -> Vec<PathBuf> {
    let mut candidates = vec![
        PathBuf::from("config.json"),
        PathBuf::from("../config.json"),
        PathBuf::from("../../config.json"),
        PathBuf::from("../../../config.json"),
        PathBuf::from("src/config.json"),
    ];
    if let Ok(exe) = std::env::current_exe() {
        if let Some(p1) = exe.parent() {
            candidates.push(p1.join("config.json"));
            candidates.push(p1.join("../config.json"));
            candidates.push(p1.join("../../config.json"));
            candidates.push(p1.join("../../../config.json"));
            candidates.push(p1.join("src/config.json"));
            if let Some(p2) = p1.parent() {
                candidates.push(p2.join("config.json"));
                candidates.push(p2.join("../../config.json"));
                candidates.push(p2.join("src/config.json"));
                if let Some(p3) = p2.parent() {
                    candidates.push(p3.join("config.json"));
                    candidates.push(p3.join("src/config.json"));
                }
            }
        }
    }
    candidates
}

fn load_config() -> IslandConfig {
    for path in &get_config_candidates() {
        if let Ok(content) = fs::read_to_string(path) {
            #[derive(Deserialize)]
            struct RawConfig {
                #[serde(rename = "windowGap")]
                window_gap: Option<f64>,
                #[serde(rename = "widthPercent")]
                width_percent: Option<f64>,
                #[serde(rename = "height")]
                height: Option<f64>,
                #[serde(rename = "devTestPanel")]
                dev_test_panel: Option<bool>,
                server: Option<ServerConfig>,
                fullscreen: Option<FullscreenConfig>,
            }
            if let Ok(raw) = serde_json::from_str::<RawConfig>(&content) {
                return IslandConfig {
                    window_gap: raw.window_gap.unwrap_or(12.0),
                    width_percent: raw.width_percent.unwrap_or(50.0),
                    height: raw.height.unwrap_or(96.0),
                    dev_test_panel: raw.dev_test_panel.unwrap_or(true),
                    server: raw.server.unwrap_or_else(default_server),
                    fullscreen_check_sec: raw.fullscreen.and_then(|f| f.check_interval_sec).unwrap_or(3),
                };
            }
        }
    }

    IslandConfig {
        window_gap: 12.0,
        width_percent: 50.0,
        height: 96.0,
        dev_test_panel: true,
        server: default_server(),
        fullscreen_check_sec: 3,
    }
}

#[tauri::command]
fn get_config() -> serde_json::Value {
    for path in &get_config_candidates() {
        if let Ok(content) = fs::read_to_string(path) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                return json;
            }
        }
    }
    serde_json::json!({
        "islandScale": 0.8,
        "windowGap": 12,
        "widthPercent": 50,
        "height": 96,
        "dotsGap": 8,
        "server": {
            "port": 34567,
            "allowedExtensionId": ""
        },
        "doNotDisturb": false,
        "devTestPanel": true,
        "sites": {
            "claude": { "label": "Claude", "icon": "C", "color": "#ff7a00", "logo": "logos/claude.svg", "tint": "original" },
            "chatgpt": { "label": "ChatGPT", "icon": "G", "color": "#ff4081", "logo": "logos/chatgpt.svg", "tint": "white" },
            "gemini": { "label": "Gemini", "icon": "G", "color": "#9c27b0", "logo": "logos/gemini.svg", "tint": "original" },
            "antigravity": { "label": "Antigravity", "icon": "A", "color": "#00bcd4", "logo": "logos/antigravity.svg", "tint": "original" }
        }
    })
}

#[tauri::command]
fn emit_island_event(app: tauri::AppHandle, event: String, payload: serde_json::Value) {
    let _ = app.emit(&event, payload);
}

#[tauri::command]
fn set_island_height(app: tauri::AppHandle, height: u32) {
    if let Some(window) = app.get_webview_window("main") {
        if let Ok(scale) = window.scale_factor() {
            if let Ok(size) = window.inner_size() {
                let physical_height = (height as f64 * scale).round() as u32;
                let _ = window.set_size(Size::Physical(PhysicalSize {
                    width: size.width,
                    height: physical_height,
                }));
            }
        }
    }
}

// Task 6: Active Monitor Placement (runs strictly on-demand before showing a popup)
#[tauri::command]
fn ensure_active_monitor(app: tauri::AppHandle) {
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::Foundation::RECT;
        use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowRect};

        let fg_hwnd = unsafe { GetForegroundWindow() };
        if fg_hwnd.is_null() {
            return;
        }

        let mut rect = RECT { left: 0, top: 0, right: 0, bottom: 0 };
        let ok = unsafe { GetWindowRect(fg_hwnd, &mut rect) };
        if ok == 0 {
            return;
        }

        let center_x = (rect.left + rect.right) / 2;
        let center_y = (rect.top + rect.bottom) / 2;

        if let Some(main_window) = app.get_webview_window("main") {
            if let Ok(monitors) = main_window.available_monitors() {
                for mon in monitors {
                    let pos = mon.position();
                    let size = mon.size();
                    let inside_x = center_x >= pos.x && center_x < pos.x + size.width as i32;
                    let inside_y = center_y >= pos.y && center_y < pos.y + size.height as i32;
                    if inside_x && inside_y {
                        let config = load_config();
                        let scale_factor = mon.scale_factor();
                        let island_width = (size.width as f64 * (config.width_percent / 100.0)).round() as u32;
                        let default_height = (config.height * scale_factor).round() as u32;
                        let cur_h = main_window.inner_size().map(|s| s.height).unwrap_or(0);
                        // Preserve expanded height if history panel is currently open (> 150px)
                        let island_height = if cur_h > default_height + 50 { cur_h } else { default_height };
                        let island_x = pos.x + ((size.width as i32 - island_width as i32) / 2).max(0);
                        let island_y = pos.y + (config.window_gap * scale_factor).round() as i32;

                        let _ = main_window.set_size(Size::Physical(PhysicalSize { width: island_width, height: island_height }));
                        let _ = main_window.set_position(Position::Physical(PhysicalPosition { x: island_x, y: island_y }));
                        break;
                    }
                }
            }
        }
    }
}

// Task 8: WebSocket Server Status & Token Commands
#[tauri::command]
async fn get_ws_status(state: tauri::State<'_, WsState>) -> Result<WsServerStatus, String> {
    let st = state.status.lock().await;
    Ok(st.clone())
}

#[tauri::command]
fn get_ws_token(state: tauri::State<'_, WsState>) -> serde_json::Value {
    serde_json::json!({
        "token": state.token.as_str()
    })
}

// Task 12: Click-to-focus tab command
#[cfg(target_os = "windows")]
fn bring_browser_to_front() {
    use windows_sys::Win32::Foundation::{BOOL, HWND, LPARAM};
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        AllowSetForegroundWindow, EnumWindows, GetWindowLongW, GetWindowThreadProcessId,
        IsIconic, IsWindowVisible, SetForegroundWindow, ShowWindow, ASFW_ANY, GWL_STYLE,
        SW_RESTORE, WS_VISIBLE,
    };

    unsafe {
        // 1. Grant permission for any background process (including browser) to set foreground
        AllowSetForegroundWindow(ASFW_ANY);

        // 2. Find browser window HWND and bring it forward
        unsafe extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
            if IsWindowVisible(hwnd) == 0 {
                return 1;
            }

            let mut pid: u32 = 0;
            GetWindowThreadProcessId(hwnd, &mut pid);
            if pid == 0 {
                return 1;
            }

            let process_handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if !process_handle.is_null() {
                let mut buf = [0u16; 1024];
                let mut size = buf.len() as u32;
                if QueryFullProcessImageNameW(process_handle, 0, buf.as_mut_ptr(), &mut size) != 0 {
                    let exe_path = String::from_utf16_lossy(&buf[..size as usize]).to_lowercase();
                    if exe_path.ends_with("brave.exe") || exe_path.ends_with("chrome.exe") {
                        let style = GetWindowLongW(hwnd, GWL_STYLE) as u32;
                        if (style & WS_VISIBLE) != 0 {
                            let target = lparam as *mut HWND;
                            *target = hwnd;
                            windows_sys::Win32::Foundation::CloseHandle(process_handle);
                            return 0; // Found target, stop enumeration
                        }
                    }
                }
                windows_sys::Win32::Foundation::CloseHandle(process_handle);
            }
            1
        }

        let mut found_hwnd: HWND = std::ptr::null_mut();
        EnumWindows(Some(enum_proc), &mut found_hwnd as *mut _ as LPARAM);

        if !found_hwnd.is_null() {
            if IsIconic(found_hwnd) != 0 {
                ShowWindow(found_hwnd, SW_RESTORE);
            }
            SetForegroundWindow(found_hwnd);
        }
    }
}

#[tauri::command]
async fn focus_tab(
    state: tauri::State<'_, WsState>,
    site: String,
    tab_id: Option<i64>,
    window_id: Option<i64>,
) -> Result<(), String> {
    if let (Some(tab), Some(win)) = (tab_id, window_id) {
        let msg = serde_json::json!({
            "kind": "focus_tab",
            "site": site,
            "tabId": tab,
            "windowId": win
        });
        state.send_to_client(msg.to_string()).await;

        #[cfg(target_os = "windows")]
        {
            bring_browser_to_front();
        }
    }
    Ok(())
}

#[tauri::command]
fn set_fullscreen_active(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, Arc<AtomicBool>>,
    active: bool,
) -> Result<(), String> {
    state.store(active, Ordering::Relaxed);
    if let Some(window) = app_handle.get_webview_window("main") {
        if active {
            let _ = window.set_ignore_cursor_events(true);
        }
    }
    Ok(())
}

#[tauri::command]
fn focus_desktop_app(app_type: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        bring_app_to_front(&app_type);
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn bring_app_to_front(target_name: &str) {
    use windows_sys::Win32::Foundation::{BOOL, HWND, LPARAM};
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        AllowSetForegroundWindow, EnumWindows, GetWindowLongW, GetWindowTextW, GetWindowThreadProcessId,
        IsIconic, IsWindowVisible, SetForegroundWindow, ShowWindow, ASFW_ANY, GWL_STYLE, SW_RESTORE,
        WS_VISIBLE,
    };

    let target_lower = target_name.to_lowercase();

    unsafe {
        AllowSetForegroundWindow(ASFW_ANY);

        struct EnumCtx {
            target: String,
            found_hwnd: HWND,
        }

        unsafe extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
            if IsWindowVisible(hwnd) == 0 {
                return 1;
            }

            let ctx = &mut *(lparam as *mut EnumCtx);
            let mut pid: u32 = 0;
            GetWindowThreadProcessId(hwnd, &mut pid);
            if pid == 0 {
                return 1;
            }

            let process_handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if !process_handle.is_null() {
                let mut buf = [0u16; 1024];
                let mut size = buf.len() as u32;
                if QueryFullProcessImageNameW(process_handle, 0, buf.as_mut_ptr(), &mut size) != 0 {
                    let exe_path = String::from_utf16_lossy(&buf[..size as usize]).to_lowercase();
                    let matches = if ctx.target == "ide" || ctx.target == "antigravity" {
                        exe_path.contains("antigravity") || exe_path.contains("code.exe")
                    } else if ctx.target == "claude" {
                        exe_path.ends_with("claude.exe") || exe_path.contains("anthropicclaude")
                    } else if ctx.target == "chatgpt" {
                        exe_path.contains("chatgpt") || exe_path.contains("openai") || exe_path.contains("codex")
                    } else {
                        exe_path.ends_with(&ctx.target)
                    };

                    if matches {
                        let style = GetWindowLongW(hwnd, GWL_STYLE) as u32;
                        if (style & WS_VISIBLE) != 0 {
                            let mut title_buf = [0u16; 256];
                            let title_len = GetWindowTextW(hwnd, title_buf.as_mut_ptr(), 256);
                            if title_len > 0 {
                                let title = String::from_utf16_lossy(&title_buf[..title_len as usize]);
                                if !title.starts_with("Default IME") && !title.starts_with("MSCTFIME") {
                                    ctx.found_hwnd = hwnd;
                                    windows_sys::Win32::Foundation::CloseHandle(process_handle);
                                    return 0;
                                }
                            }
                        }
                    }
                }
                windows_sys::Win32::Foundation::CloseHandle(process_handle);
            }
            1
        }

        let mut ctx = EnumCtx {
            target: target_lower,
            found_hwnd: std::ptr::null_mut(),
        };

        EnumWindows(Some(enum_proc), &mut ctx as *mut _ as LPARAM);

        if !ctx.found_hwnd.is_null() {
            if IsIconic(ctx.found_hwnd) != 0 {
                ShowWindow(ctx.found_hwnd, SW_RESTORE);
            }
            SetForegroundWindow(ctx.found_hwnd);
        }
    }
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_config,
            emit_island_event,
            set_island_height,
            ensure_active_monitor,
            get_ws_status,
            get_ws_token,
            focus_tab,
            focus_desktop_app,
            set_fullscreen_active
        ])
        .setup(|app| {
            let config = load_config();

            // Task 8: Secret Token and WebSocket Server Initialization
            let token = ws_server::get_or_create_token(app.handle());
            let is_fullscreen_active = Arc::new(AtomicBool::new(false));
            app.manage(is_fullscreen_active.clone());

            let ws_state = WsState {
                status: Arc::new(tokio::sync::Mutex::new(WsServerStatus {
                    running: false,
                    port: config.server.port,
                    error: None,
                    client_connected: false,
                    client_origin: None,
                })),
                token: Arc::new(token),
                client_cancel: Arc::new(tokio::sync::Mutex::new(None)),
                outbound_tx: Arc::new(tokio::sync::Mutex::new(None)),
                web_presence: Arc::new(tokio::sync::Mutex::new("none".to_string())),
            };

            app.manage(ws_state.clone());

            let app_handle_for_ws = app.handle().clone();
            let server_port = config.server.port;
            let allowed_ext = config.server.allowed_extension_id.clone();
            let ws_state_clone = ws_state.clone();

            tauri::async_runtime::spawn(async move {
                ws_server::start_server(app_handle_for_ws, server_port, allowed_ext, ws_state_clone).await;
            });

            // Start desktop detectors (Claude & ChatGPT UIA)
            let app_handle_for_detectors = app.handle().clone();
            desktop_detector::start_desktop_detectors(app_handle_for_detectors);

            // Start context detector (OS event hook for foreground AI apps)
            let app_handle_for_context = app.handle().clone();
            context_detector::start_context_detector(app_handle_for_context, ws_state.web_presence.clone());

            // Main transparent island window
            if let Some(window) = app.get_webview_window("main") {
                if let Ok(Some(monitor)) = window.primary_monitor() {
                    let monitor_size = monitor.size();
                    let scale_factor = monitor.scale_factor();

                    let width = (monitor_size.width as f64 * (config.width_percent / 100.0)).round() as u32;
                    let height = (config.height * scale_factor).round() as u32;
                    let x = ((monitor_size.width as i32 - width as i32) / 2).max(0);
                    let y = (config.window_gap * scale_factor).round() as i32;

                    let _ = window.set_size(Size::Physical(PhysicalSize { width, height }));
                    let _ = window.set_position(Position::Physical(PhysicalPosition { x, y }));
                }

                let _ = window.set_ignore_cursor_events(true);

                // Prevent stealing focus and ensure excluded from taskbar / Alt+Tab
                #[cfg(target_os = "windows")]
                {
                    use windows_sys::Win32::UI::WindowsAndMessaging::{
                        GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
                    };
                    if let Ok(hwnd) = window.hwnd() {
                        unsafe {
                            let cur_style = GetWindowLongPtrW(hwnd.0 as _, GWL_EXSTYLE);
                            SetWindowLongPtrW(
                                hwnd.0 as _,
                                GWL_EXSTYLE,
                                cur_style | (WS_EX_NOACTIVATE as isize) | (WS_EX_TOOLWINDOW as isize),
                            );
                        }
                    }
                }

                let _ = window.show();

                // Dynamic Hover Click-Through & Fullscreen Detection thread
                #[cfg(target_os = "windows")]
                {
                    let window_clone = window.clone();
                    let app_handle = app.handle().clone();
                    let fs_interval_secs = config.fullscreen_check_sec.max(1);
                    let is_fs_state_clone = is_fullscreen_active.clone();

                    thread::spawn(move || {
                        use std::time::Instant;
                        use windows_sys::Win32::Foundation::{HWND, POINT, RECT};
                        use windows_sys::Win32::UI::Shell::{
                            SHQueryUserNotificationState, QUNS_BUSY, QUNS_PRESENTATION_MODE,
                            QUNS_RUNNING_D3D_FULL_SCREEN,
                        };
                        use windows_sys::Win32::UI::WindowsAndMessaging::{
                            GetCursorPos, GetWindowRect, SetWindowPos, HWND_TOPMOST,
                            SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW,
                            GetForegroundWindow, GetClassNameW, GetDesktopWindow, GetShellWindow,
                        };

                        let hwnd_raw = match window_clone.hwnd() {
                            Ok(h) => h.0 as HWND,
                            Err(_) => return,
                        };

                        let is_hovering = Arc::new(AtomicBool::new(false));
                        let was_fullscreen = Arc::new(AtomicBool::new(false));

                        let fs_check_duration = Duration::from_secs(fs_interval_secs);
                        let mut last_fs_check = Instant::now();

                        loop {
                            let sleep_ms = if is_hovering.load(Ordering::Relaxed) { 60 } else { 150 };
                            thread::sleep(Duration::from_millis(sleep_ms));

                            let is_fs_active = is_fs_state_clone.load(Ordering::Relaxed)
                                || was_fullscreen.load(Ordering::Relaxed);

                            if is_fs_active {
                                if is_hovering.swap(false, Ordering::Relaxed) {
                                    let _ = window_clone.set_ignore_cursor_events(true);
                                }
                            } else {
                                // 1. Dynamic Cursor Proximity Check (only active when NOT in fullscreen)
                                let mut cursor = POINT { x: 0, y: 0 };
                                let mut w_rect = RECT { left: 0, top: 0, right: 0, bottom: 0 };

                                unsafe {
                                    if GetCursorPos(&mut cursor) != 0 && GetWindowRect(hwnd_raw, &mut w_rect) != 0 {
                                        let center_x = (w_rect.left + w_rect.right) / 2;
                                        let island_half_w = (w_rect.right - w_rect.left) / 2;
                                        let inside_island = cursor.x >= (center_x - island_half_w)
                                            && cursor.x <= (center_x + island_half_w)
                                            && cursor.y >= w_rect.top
                                            && cursor.y <= w_rect.bottom;

                                        let prev_hover = is_hovering.load(Ordering::Relaxed);
                                        if inside_island != prev_hover {
                                            is_hovering.store(inside_island, Ordering::Relaxed);
                                            let _ = window_clone.set_ignore_cursor_events(!inside_island);
                                        }
                                    }
                                }
                            }

                            // 2. Fullscreen Detection check (slow interval from config, default 3s)
                            if last_fs_check.elapsed() >= fs_check_duration {
                                last_fs_check = Instant::now();
                                unsafe {
                                    let mut state = 0;
                                    let mut is_fs = false;
                                    if SHQueryUserNotificationState(&mut state) == 0 {
                                        is_fs = state == QUNS_RUNNING_D3D_FULL_SCREEN
                                            || state == QUNS_BUSY
                                            || state == QUNS_PRESENTATION_MODE;
                                    }

                                    // Robust check for modern borderless fullscreen games and fullscreen media
                                    if !is_fs {
                                        let fg = GetForegroundWindow();
                                        if !fg.is_null() && fg != hwnd_raw && fg != GetDesktopWindow() && fg != GetShellWindow() {
                                            let mut fg_rect = RECT { left: 0, top: 0, right: 0, bottom: 0 };
                                            if GetWindowRect(fg, &mut fg_rect) != 0 {
                                                if let Ok(monitors) = window_clone.available_monitors() {
                                                    for mon in monitors {
                                                        let pos = mon.position();
                                                        let size = mon.size();
                                                        let mon_left = pos.x;
                                                        let mon_top = pos.y;
                                                        let mon_right = pos.x + size.width as i32;
                                                        let mon_bottom = pos.y + size.height as i32;

                                                        if fg_rect.left <= mon_left
                                                            && fg_rect.top <= mon_top
                                                            && fg_rect.right >= mon_right
                                                            && fg_rect.bottom >= mon_bottom
                                                        {
                                                            let mut class_buf = [0u16; 64];
                                                            let class_len = GetClassNameW(fg, class_buf.as_mut_ptr(), 64);
                                                            let class_name = String::from_utf16_lossy(&class_buf[..class_len as usize]);
                                                            if class_name != "Progman" && class_name != "WorkerW" && class_name != "Shell_TrayWnd" {
                                                                is_fs = true;
                                                                break;
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }

                                    let prev_fs = was_fullscreen.load(Ordering::Relaxed);
                                    if is_fs != prev_fs {
                                        was_fullscreen.store(is_fs, Ordering::Relaxed);
                                        is_fs_state_clone.store(is_fs, Ordering::Relaxed);
                                        if is_fs {
                                            let _ = window_clone.set_ignore_cursor_events(true);
                                        }

                                        // Always-on-top: re-assert topmost layer so borderless fullscreen apps don't cover island
                                        SetWindowPos(
                                            hwnd_raw,
                                            HWND_TOPMOST,
                                            0,
                                            0,
                                            0,
                                            0,
                                            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW,
                                        );
                                        let _ = window_clone.set_always_on_top(true);

                                        let _ = app_handle.emit(
                                            "fullscreen-state-change",
                                            serde_json::json!({ "isFullscreen": is_fs }),
                                        );
                                    }
                                }
                            }
                        }
                    });

                    // Task 7: Global Shortcut Thread (Ctrl+Shift+N)
                    let app_handle_for_hotkey = app.handle().clone();
                    thread::spawn(move || {
                        use windows_sys::Win32::UI::Input::KeyboardAndMouse::{RegisterHotKey, MOD_CONTROL, MOD_SHIFT, MOD_NOREPEAT};
                        use windows_sys::Win32::UI::WindowsAndMessaging::{GetMessageW, MSG, WM_HOTKEY};

                        let registered = unsafe {
                            RegisterHotKey(0 as _, 1001, MOD_CONTROL | MOD_SHIFT | MOD_NOREPEAT, 0x4E)
                        };

                        if registered != 0 {
                            let mut msg: MSG = unsafe { std::mem::zeroed() };
                            unsafe {
                                while GetMessageW(&mut msg, 0 as _, 0, 0) > 0 {
                                    if msg.message == WM_HOTKEY && msg.wParam == 1001 {
                                        let _ = app_handle_for_hotkey.emit("island-toggle-history", serde_json::json!({}));
                                    }
                                }
                            }
                        }
                    });
                }
            }

            // Test panel window (only shown if devTestPanel == true in config)
            if config.dev_test_panel {
                if let Some(test_panel) = app.get_webview_window("test-panel") {
                    let _ = test_panel.show();
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running ai-island application");
}
