use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

static RUNNING: AtomicBool = AtomicBool::new(true);

#[derive(Clone)]
pub struct ContextDetectorState {
    pub active_context: Arc<Mutex<String>>,
    pub web_presence: Arc<Mutex<String>>,
}

static mut DETECTOR_STATE: Option<ContextDetectorState> = None;
static mut APP_HANDLE: Option<AppHandle> = None;

pub fn start_context_detector(app: AppHandle, web_presence_arc: Arc<tokio::sync::Mutex<String>>) {
    #[cfg(target_os = "windows")]
    {
        let active_context = Arc::new(Mutex::new("none".to_string()));
        let web_presence_cache = Arc::new(Mutex::new("none".to_string()));

        let state = ContextDetectorState {
            active_context: active_context.clone(),
            web_presence: web_presence_cache.clone(),
        };

        unsafe {
            DETECTOR_STATE = Some(state);
            APP_HANDLE = Some(app.clone());
        }

        // Bridge tokio web presence changes to our sync cache
        let web_presence_tokio = web_presence_arc.clone();
        let web_cache_clone = web_presence_cache.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_millis(200)).await;
                let wp = web_presence_tokio.lock().await.clone();
                let mut cache = web_cache_clone.lock().unwrap();
                if *cache != wp {
                    *cache = wp.clone();
                    drop(cache);
                    // trigger re-evaluation of current foreground context
                    trigger_context_evaluation();
                }
            }
        });

        thread::spawn(move || {
            run_win_event_hook_thread();
        });
    }
}

pub fn trigger_context_evaluation() {
    #[cfg(target_os = "windows")]
    unsafe {
        use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
        let hwnd = GetForegroundWindow();
        if !hwnd.0.is_null() {
            evaluate_foreground_hwnd(hwnd);
        }
    }
}

#[cfg(target_os = "windows")]
fn evaluate_foreground_hwnd(hwnd: windows::Win32::Foundation::HWND) {
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId;

    let mut pid: u32 = 0;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    if pid == 0 {
        return;
    }

    let mut exe_name = String::new();
    if let Ok(handle) = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) } {
        let mut buf = [0u16; 1024];
        let mut size = buf.len() as u32;
        if unsafe {
            QueryFullProcessImageNameW(
                handle,
                PROCESS_NAME_FORMAT(0),
                windows::core::PWSTR(buf.as_mut_ptr()),
                &mut size,
            )
        }
        .is_ok()
        {
            let full_path = String::from_utf16_lossy(&buf[..size as usize]).to_lowercase();
            let norm = full_path.replace('\\', "/");
            if let Some(name) = norm.split('/').last() {
                exe_name = name.to_string();
            }
        }
        let _ = unsafe { windows::Win32::Foundation::CloseHandle(handle) };
    }

    if exe_name.is_empty() {
        return;
    }

    // Determine target context
    let raw_context = match exe_name.as_str() {
        "antigravity.exe" | "code.exe" => "antigravity",
        "claude.exe" | "anthropicclaude.exe" => "claude_desktop",
        "chatgpt.exe" => "chatgpt_desktop",
        "brave.exe" | "chrome.exe" | "msedge.exe" => "browser",
        _ => "none",
    };

    let resolved_context = if raw_context == "browser" {
        unsafe {
            if let Some(ref st) = DETECTOR_STATE {
                let wp = st.web_presence.lock().unwrap().clone();
                match wp.as_str() {
                    "claude" => "claude_web",
                    "chatgpt" => "chatgpt_web",
                    "gemini" => "gemini_web",
                    _ => "none",
                }
            } else {
                "none"
            }
        }
    } else {
        raw_context
    };

    // Dwell handling (1000ms) to avoid flicker when Alt-Tabbing
    static mut DWELL_GENERATION: u64 = 0;
    static mut PENDING_CONTEXT: Option<String> = None;

        let gen = unsafe {
            DWELL_GENERATION += 1;
            PENDING_CONTEXT = Some(resolved_context.to_string());
            DWELL_GENERATION
        };

        thread::spawn(move || {
            thread::sleep(Duration::from_millis(1000));
            unsafe {
                if DWELL_GENERATION == gen {
                    if let Some(ref target) = PENDING_CONTEXT {
                        if let Some(ref st) = DETECTOR_STATE {
                            let mut curr = st.active_context.lock().unwrap();
                            if *curr != *target {
                                *curr = target.clone();
                                drop(curr);
                                if let Some(ref app) = APP_HANDLE {
                                    let _ = app.emit(
                                        "context-changed",
                                        serde_json::json!({ "context": target }),
                                    );
                                }
                            }
                        }
                    }
                }
            }
        });
}

#[cfg(target_os = "windows")]
fn run_win_event_hook_thread() {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::Accessibility::{SetWinEventHook, UnhookWinEvent, HWINEVENTHOOK};
    use windows::Win32::UI::WindowsAndMessaging::{
        DispatchMessageW, GetMessageW, MSG, EVENT_SYSTEM_FOREGROUND,
        WINEVENT_OUTOFCONTEXT, WINEVENT_SKIPOWNPROCESS,
    };

    unsafe extern "system" fn win_event_proc(
        _hook: HWINEVENTHOOK,
        _event: u32,
        hwnd: HWND,
        _id_object: i32,
        _id_child: i32,
        _id_event_thread: u32,
        _dwms_event_time: u32,
    ) {
        if !hwnd.0.is_null() {
            evaluate_foreground_hwnd(hwnd);
        }
    }

    unsafe {
        let hook = SetWinEventHook(
            EVENT_SYSTEM_FOREGROUND,
            EVENT_SYSTEM_FOREGROUND,
            None,
            Some(win_event_proc),
            0,
            0,
            WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
        );

        if hook.0.is_null() {
            eprintln!("[CONTEXT DETECTOR] Failed to install SetWinEventHook");
            return;
        }

        // Trigger initial foreground evaluation
        trigger_context_evaluation();

        let mut msg = MSG::default();
        while RUNNING.load(Ordering::Relaxed) && GetMessageW(&mut msg, None, 0, 0).into() {
            let _ = DispatchMessageW(&msg);
        }

        let _ = UnhookWinEvent(hook);
    }
}
