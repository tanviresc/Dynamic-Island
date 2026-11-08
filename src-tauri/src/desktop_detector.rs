use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum TaskKind {
    Image,
    Pdf,
    Spreadsheet,
    Slides,
    Document,
    Code,
    Research,
    Translation,
    Summary,
    Rewrite,
    Question,
}

impl TaskKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            TaskKind::Image => "image",
            TaskKind::Pdf => "pdf",
            TaskKind::Spreadsheet => "spreadsheet",
            TaskKind::Slides => "slides",
            TaskKind::Document => "document",
            TaskKind::Code => "code",
            TaskKind::Research => "research",
            TaskKind::Translation => "translation",
            TaskKind::Summary => "summary",
            TaskKind::Rewrite => "rewrite",
            TaskKind::Question => "question",
        }
    }
}

pub fn classify_prompt_keywords(text: &str) -> Option<TaskKind> {
    let lower = text.to_lowercase();

    // 1. image
    if lower.contains("picture")
        || lower.contains("image")
        || lower.contains("photo")
        || lower.contains("draw")
        || lower.contains("drawing")
        || lower.contains("logo")
        || lower.contains("illustration")
        || lower.contains("sketch")
        || lower.contains("portrait")
        || lower.contains("wallpaper")
        || lower.contains("diagram")
        || lower.contains("graphic")
        || lower.contains("artwork")
        || lower.contains("dall-e")
        || lower.contains("midjourney")
        || lower.contains("imagen")
        || lower.contains("banner")
        || lower.contains("thumbnail")
        || lower.contains("ছবি")
        || lower.contains("ইমেজ")
        || lower.contains("আঁকো")
        || lower.contains("চিত্র")
        || lower.contains("ড্রয়িং")
        || lower.contains("লোগো")
    {
        return Some(TaskKind::Image);
    }

    // 2. pdf
    if lower.contains("pdf")
        || lower.contains(".pdf")
        || lower.contains("export to pdf")
        || lower.contains("save as pdf")
        || lower.contains("make a pdf")
        || lower.contains("download as pdf")
        || lower.contains("convert to pdf")
        || lower.contains("পিডিএফ")
    {
        return Some(TaskKind::Pdf);
    }

    // 3. spreadsheet
    if lower.contains("excel")
        || lower.contains("spreadsheet")
        || lower.contains("csv")
        || lower.contains("xlsx")
        || lower.contains(".csv")
        || lower.contains(".xlsx")
        || lower.contains("sheet")
        || lower.contains("dataframe")
        || lower.contains("table data")
        || lower.contains("এক্সেল")
        || lower.contains("স্প্রেডশিট")
    {
        return Some(TaskKind::Spreadsheet);
    }

    // 4. slides
    if lower.contains("slides")
        || lower.contains("presentation")
        || lower.contains("powerpoint")
        || lower.contains("ppt")
        || lower.contains("pptx")
        || lower.contains(".ppt")
        || lower.contains(".pptx")
        || lower.contains("pitch deck")
        || lower.contains("slide deck")
        || lower.contains("ডেক")
        || lower.contains("প্রেজেন্টেশন")
        || lower.contains("স্লাইড")
    {
        return Some(TaskKind::Slides);
    }

    // 5. document
    if lower.contains("word")
        || lower.contains("docx")
        || lower.contains(".docx")
        || lower.contains("doc")
        || lower.contains("report")
        || lower.contains("essay")
        || lower.contains("article")
        || lower.contains("write a doc")
        || lower.contains("document")
        || lower.contains("ডকুমেন্ট")
        || lower.contains("প্রতিবেদন")
        || lower.contains("রিপোর্ট")
        || lower.contains("প্রবন্ধ")
    {
        return Some(TaskKind::Document);
    }

    // 6. code
    if lower.contains("code")
        || lower.contains("script")
        || lower.contains("function")
        || lower.contains("bug")
        || lower.contains("fix")
        || lower.contains("debug")
        || lower.contains("algorithm")
        || lower.contains("component")
        || lower.contains("class")
        || lower.contains("endpoint")
        || lower.contains("api")
        || lower.contains("query")
        || lower.contains("sql")
        || lower.contains("program")
        || lower.contains("python")
        || lower.contains("javascript")
        || lower.contains("typescript")
        || lower.contains("rust")
        || lower.contains("html")
        || lower.contains("css")
        || lower.contains("কোড")
        || lower.contains("স্ক্রিপ্ট")
        || lower.contains("ফাংশন")
        || lower.contains("বাগ")
        || lower.contains("ফিক্স")
    {
        return Some(TaskKind::Code);
    }

    // 7. research
    if lower.contains("research")
        || lower.contains("search")
        || lower.contains("find sources")
        || lower.contains("citations")
        || lower.contains("literature review")
        || lower.contains("investigate")
        || lower.contains("deep dive")
        || lower.contains("গবেষণা")
        || lower.contains("অনুসন্ধান")
        || lower.contains("উৎস")
    {
        return Some(TaskKind::Research);
    }

    // 8. translation
    if lower.contains("translate")
        || lower.contains("translation")
        || lower.contains("english to")
        || lower.contains("bengali to")
        || lower.contains("spanish to")
        || lower.contains("in french")
        || lower.contains("in german")
        || lower.contains("অনুবাদ")
        || lower.contains("বাংলায় অনুবাদ")
        || lower.contains("ট্রান্সলেট")
    {
        return Some(TaskKind::Translation);
    }

    // 9. summary
    if lower.contains("summarize")
        || lower.contains("summary")
        || lower.contains("tldr")
        || lower.contains("tl;dr")
        || lower.contains("brief")
        || lower.contains("digest")
        || lower.contains("recap")
        || lower.contains("key takeaways")
        || lower.contains("সারসংক্ষেপ")
        || lower.contains("সংক্ষেপ")
        || lower.contains("সারাংশ")
    {
        return Some(TaskKind::Summary);
    }

    // 10. rewrite
    if lower.contains("rewrite")
        || lower.contains("rephrase")
        || lower.contains("paraphrase")
        || lower.contains("reword")
        || lower.contains("polish this")
        || lower.contains("improve writing")
        || lower.contains("পুনরায় লিখুন")
        || lower.contains("রিরাইট")
        || lower.contains("প্যারাফ্রেজ")
    {
        return Some(TaskKind::Rewrite);
    }

    None
}

pub fn check_needs_input(name_lower: &str) -> bool {
    name_lower.contains("allow")
        || name_lower.contains("approve")
        || name_lower.contains("grant permission")
        || name_lower.contains("grant access")
        || name_lower.contains("confirm")
        || name_lower.contains("review changes")
        || name_lower.contains("permission needed")
        || name_lower.contains("permission requested")
        || name_lower.contains("requesting permission")
        || name_lower.contains("run tool")
        || name_lower.contains("run command")
        || name_lower.contains("do you want to run")
}

pub fn check_limit_reached(name_lower: &str) -> bool {
    name_lower.contains("usage limit")
        || name_lower.contains("out of messages")
        || name_lower.contains("free message limit")
        || name_lower.contains("rate limit")
        || name_lower.contains("usage cap")
        || name_lower.contains("limit reached")
        || name_lower.contains("free plan limit")
        || name_lower.contains("too many requests")
        || (name_lower.contains("try again at")
            && (name_lower.contains("limit") || name_lower.contains("reached")))
        || (name_lower.contains("resets at")
            && (name_lower.contains("limit") || name_lower.contains("reached")))
}

pub fn check_response_structure(name: &str, name_lower: &str) -> Option<TaskKind> {
    if name_lower.contains(".pdf") {
        return Some(TaskKind::Pdf);
    }
    if name_lower.contains(".xlsx") || name_lower.contains(".csv") {
        return Some(TaskKind::Spreadsheet);
    }
    if name_lower.contains(".pptx") || name_lower.contains(".ppt") {
        return Some(TaskKind::Slides);
    }
    if name_lower.contains(".docx") || name_lower.contains(".doc") {
        return Some(TaskKind::Document);
    }
    if name_lower.contains("copy code")
        || name == "Copy"
        || name_lower.contains("code block")
        || name_lower.contains("language-")
    {
        return Some(TaskKind::Code);
    }
    if (name_lower.contains("generated image")
        || name_lower.contains("dall·e")
        || name_lower.contains("artwork")
        || name_lower.contains("illustration")
        || name_lower.contains("canvas"))
        && !name_lower.contains("avatar")
        && !name_lower.contains("profile")
        && !name_lower.contains("user")
    {
        return Some(TaskKind::Image);
    }

    None
}

#[derive(Debug, Clone, Copy)]
pub struct DesktopProbeResult {
    pub is_generating: bool,
    pub is_finished: bool,
    pub needs_input: bool,
    pub limit_reached: bool,
    pub task_kind: TaskKind,
}

pub fn start_desktop_detectors(app: AppHandle) {
    #[cfg(target_os = "windows")]
    {
        thread::spawn(move || {
            run_detector_loop(app);
        });
    }
}

#[cfg(target_os = "windows")]
fn run_detector_loop(app: AppHandle) {
    use windows::Win32::Foundation::{BOOL, HWND, LPARAM};
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowTextW, GetWindowThreadProcessId, IsWindowVisible,
    };

    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
    }

    let mut claude_generating = false;
    let mut claude_needs_input_active = false;
    let mut claude_limit_active = false;
    let mut claude_task_kind = TaskKind::Question;
    let mut last_claude_state_change = Instant::now();

    let mut chatgpt_generating = false;
    let mut chatgpt_needs_input_active = false;
    let mut chatgpt_limit_active = false;
    let mut chatgpt_task_kind = TaskKind::Question;
    let mut last_chatgpt_state_change = Instant::now();

    loop {
        // 1. Find Claude and ChatGPT top-level window HWNDs
        struct WindowTargets {
            claude_hwnd: isize,
            claude_title: String,
            chatgpt_hwnd: isize,
            chatgpt_title: String,
        }

        let mut targets = WindowTargets {
            claude_hwnd: 0,
            claude_title: String::new(),
            chatgpt_hwnd: 0,
            chatgpt_title: String::new(),
        };

        unsafe extern "system" fn enum_windows_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
            unsafe {
                if !IsWindowVisible(hwnd).as_bool() {
                    return BOOL(1);
                }

                let targets = &mut *(lparam.0 as *mut WindowTargets);
                let mut pid: u32 = 0;
                GetWindowThreadProcessId(hwnd, Some(&mut pid));
                if pid == 0 {
                    return BOOL(1);
                }

                if let Ok(process_handle) =
                    OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
                {
                    let mut buf = [0u16; 1024];
                    let mut size = buf.len() as u32;
                    if QueryFullProcessImageNameW(
                        process_handle,
                        windows::Win32::System::Threading::PROCESS_NAME_FORMAT(0),
                        windows::core::PWSTR(buf.as_mut_ptr()),
                        &mut size,
                    )
                    .is_ok()
                    {
                        let exe_path =
                            String::from_utf16_lossy(&buf[..size as usize]).to_lowercase();
                        if (exe_path.ends_with("claude.exe")
                            || exe_path.contains("anthropicclaude"))
                            && targets.claude_hwnd == 0
                        {
                            let mut title_buf = [0u16; 256];
                            let len = GetWindowTextW(hwnd, &mut title_buf);
                            if len > 0 {
                                let title = String::from_utf16_lossy(&title_buf[..len as usize]);
                                if !title.is_empty()
                                    && !title.starts_with("Default IME")
                                    && !title.starts_with("MSCTFIME")
                                {
                                    targets.claude_hwnd = hwnd.0 as isize;
                                    targets.claude_title = title;
                                }
                            }
                        } else if (exe_path.contains("chatgpt")
                            || exe_path.contains("openai")
                            || exe_path.contains("codex"))
                            && targets.chatgpt_hwnd == 0
                        {
                            let mut title_buf = [0u16; 256];
                            let len = GetWindowTextW(hwnd, &mut title_buf);
                            if len > 0 {
                                let title = String::from_utf16_lossy(&title_buf[..len as usize]);
                                if !title.is_empty()
                                    && !title.starts_with("Default IME")
                                    && !title.starts_with("MSCTFIME")
                                {
                                    targets.chatgpt_hwnd = hwnd.0 as isize;
                                    targets.chatgpt_title = title;
                                }
                            }
                        }
                    }
                    let _ = windows::Win32::Foundation::CloseHandle(process_handle);
                }
                BOOL(1)
            }
        }

        unsafe {
            let _ = EnumWindows(
                Some(enum_windows_proc),
                LPARAM(&mut targets as *mut _ as isize),
            );
        }

        let claude_running = targets.claude_hwnd != 0;
        let chatgpt_running = targets.chatgpt_hwnd != 0;

        if !claude_running && !chatgpt_running {
            // Neither app running: zero CPU, sleep 10 seconds
            claude_generating = false;
            claude_needs_input_active = false;
            claude_limit_active = false;
            chatgpt_generating = false;
            chatgpt_needs_input_active = false;
            chatgpt_limit_active = false;
            thread::sleep(Duration::from_secs(10));
            continue;
        }

        // 2. Probe Claude Desktop
        if claude_running {
            let probe = probe_claude_uia(HWND(targets.claude_hwnd as _), &targets.claude_title);

            // A. Needs Input handling with resolution tracking
            if probe.needs_input {
                if !claude_needs_input_active {
                    claude_needs_input_active = true;
                    if probe.task_kind != TaskKind::Question {
                        claude_task_kind = probe.task_kind;
                    }
                    let _ = app.emit(
                        "island-notification-event",
                        serde_json::json!({
                            "type": "needs_input",
                            "site": "claude",
                            "source": "desktop",
                            "taskId": "desktop",
                            "taskKind": claude_task_kind.as_str(),
                            "message": format!("Claude desktop: Permission needed for {}", claude_task_kind.as_str())
                        }),
                    );
                }
            } else if claude_needs_input_active {
                // Approval was granted, dismissed, or generation started
                claude_needs_input_active = false;
                let _ = app.emit(
                    "island-resolve-needs-input",
                    serde_json::json!({
                        "site": "claude",
                        "taskId": "desktop"
                    }),
                );
            }

            // B. Limit Reached handling
            if probe.limit_reached {
                if !claude_limit_active {
                    claude_limit_active = true;
                    if probe.task_kind != TaskKind::Question {
                        claude_task_kind = probe.task_kind;
                    }
                    let _ = app.emit(
                        "island-notification-event",
                        serde_json::json!({
                            "type": "limit_reached",
                            "site": "claude",
                            "source": "desktop",
                            "taskId": "desktop",
                            "taskKind": claude_task_kind.as_str(),
                            "message": format!("Claude desktop: {} limit reached", claude_task_kind.as_str())
                        }),
                    );
                }
            } else {
                claude_limit_active = false;
            }

            // C. Working / Generating handling
            if probe.is_generating && !claude_generating {
                if last_claude_state_change.elapsed() >= Duration::from_millis(500) {
                    claude_generating = true;
                    claude_task_kind = probe.task_kind;
                    last_claude_state_change = Instant::now();

                    // Resolve needs_input if pending since generation started
                    if claude_needs_input_active {
                        claude_needs_input_active = false;
                        let _ = app.emit(
                            "island-resolve-needs-input",
                            serde_json::json!({
                                "site": "claude",
                                "taskId": "desktop"
                            }),
                        );
                    }

                    let _ = app.emit(
                        "island-notification-event",
                        serde_json::json!({
                            "type": "working",
                            "site": "claude",
                            "source": "desktop",
                            "taskId": "desktop",
                            "taskKind": claude_task_kind.as_str(),
                            "message": format!("Claude desktop: working on {}...", claude_task_kind.as_str())
                        }),
                    );
                }
            } else if (!probe.is_generating && claude_generating) || (probe.is_finished && claude_generating) {
                if claude_generating
                    && last_claude_state_change.elapsed() >= Duration::from_millis(1000)
                {
                    claude_generating = false;
                    last_claude_state_change = Instant::now();
                    if probe.task_kind != TaskKind::Question {
                        claude_task_kind = probe.task_kind;
                    }

                    let _ = app.emit(
                        "island-notification-event",
                        serde_json::json!({
                            "type": "finished",
                            "site": "claude",
                            "source": "desktop",
                            "taskId": "desktop",
                            "taskKind": claude_task_kind.as_str()
                        }),
                    );
                }
            }
        } else {
            claude_generating = false;
            claude_needs_input_active = false;
            claude_limit_active = false;
        }

        // 3. Probe ChatGPT Desktop
        if chatgpt_running {
            let probe = probe_chatgpt_uia(HWND(targets.chatgpt_hwnd as _), &targets.chatgpt_title);

            // A. Needs Input handling with resolution tracking
            if probe.needs_input {
                if !chatgpt_needs_input_active {
                    chatgpt_needs_input_active = true;
                    if probe.task_kind != TaskKind::Question {
                        chatgpt_task_kind = probe.task_kind;
                    }
                    let _ = app.emit(
                        "island-notification-event",
                        serde_json::json!({
                            "type": "needs_input",
                            "site": "chatgpt",
                            "source": "desktop",
                            "taskId": "desktop",
                            "taskKind": chatgpt_task_kind.as_str(),
                            "message": format!("ChatGPT desktop: Permission needed for {}", chatgpt_task_kind.as_str())
                        }),
                    );
                }
            } else if chatgpt_needs_input_active {
                // Approval was granted, dismissed, or generation started
                chatgpt_needs_input_active = false;
                let _ = app.emit(
                    "island-resolve-needs-input",
                    serde_json::json!({
                        "site": "chatgpt",
                        "taskId": "desktop"
                    }),
                );
            }

            // B. Limit Reached handling
            if probe.limit_reached {
                if !chatgpt_limit_active {
                    chatgpt_limit_active = true;
                    if probe.task_kind != TaskKind::Question {
                        chatgpt_task_kind = probe.task_kind;
                    }
                    let _ = app.emit(
                        "island-notification-event",
                        serde_json::json!({
                            "type": "limit_reached",
                            "site": "chatgpt",
                            "source": "desktop",
                            "taskId": "desktop",
                            "taskKind": chatgpt_task_kind.as_str(),
                            "message": format!("ChatGPT desktop: {} limit reached", chatgpt_task_kind.as_str())
                        }),
                    );
                }
            } else {
                chatgpt_limit_active = false;
            }

            // C. Working / Generating handling
            if probe.is_generating && !chatgpt_generating {
                if last_chatgpt_state_change.elapsed() >= Duration::from_millis(500) {
                    chatgpt_generating = true;
                    chatgpt_task_kind = probe.task_kind;
                    last_chatgpt_state_change = Instant::now();

                    // Resolve needs_input if pending since generation started
                    if chatgpt_needs_input_active {
                        chatgpt_needs_input_active = false;
                        let _ = app.emit(
                            "island-resolve-needs-input",
                            serde_json::json!({
                                "site": "chatgpt",
                                "taskId": "desktop"
                            }),
                        );
                    }

                    let _ = app.emit(
                        "island-notification-event",
                        serde_json::json!({
                            "type": "working",
                            "site": "chatgpt",
                            "source": "desktop",
                            "taskId": "desktop",
                            "taskKind": chatgpt_task_kind.as_str(),
                            "message": format!("ChatGPT desktop: working on {}...", chatgpt_task_kind.as_str())
                        }),
                    );
                }
            } else if (!probe.is_generating && chatgpt_generating) || (probe.is_finished && chatgpt_generating) {
                if chatgpt_generating
                    && last_chatgpt_state_change.elapsed() >= Duration::from_millis(1000)
                {
                    chatgpt_generating = false;
                    last_chatgpt_state_change = Instant::now();
                    if probe.task_kind != TaskKind::Question {
                        chatgpt_task_kind = probe.task_kind;
                    }

                    let _ = app.emit(
                        "island-notification-event",
                        serde_json::json!({
                            "type": "finished",
                            "site": "chatgpt",
                            "source": "desktop",
                            "taskId": "desktop",
                            "taskKind": chatgpt_task_kind.as_str()
                        }),
                    );
                }
            }
        } else {
            chatgpt_generating = false;
            chatgpt_needs_input_active = false;
            chatgpt_limit_active = false;
        }

        let is_actively_generating = claude_generating || chatgpt_generating;
        if is_actively_generating {
            thread::sleep(Duration::from_millis(800));
        } else {
            thread::sleep(Duration::from_millis(1500));
        }
    }
}

#[cfg(target_os = "windows")]
fn probe_claude_uia(
    hwnd: windows::Win32::Foundation::HWND,
    window_title: &str,
) -> DesktopProbeResult {
    use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER};
    use windows::Win32::UI::Accessibility::{CUIAutomation, IUIAutomation, TreeScope_Descendants};

    let fallback = DesktopProbeResult {
        is_generating: false,
        is_finished: false,
        needs_input: false,
        limit_reached: false,
        task_kind: classify_prompt_keywords(window_title).unwrap_or(TaskKind::Question),
    };

    unsafe {
        let uia: IUIAutomation = match CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER) {
            Ok(u) => u,
            Err(_) => return fallback,
        };

        let root_el = match uia.ElementFromHandle(hwnd) {
            Ok(el) => el,
            Err(_) => return fallback,
        };

        let true_cond = match uia.CreateTrueCondition() {
            Ok(c) => c,
            Err(_) => return fallback,
        };

        let mut is_generating = false;
        let mut is_finished = false;
        let mut needs_input = false;
        let mut limit_reached = false;

        let mut struct_kind: Option<TaskKind> = None;
        let mut prompt_kind: Option<TaskKind> = None;

        if let Ok(elements) = root_el.FindAll(TreeScope_Descendants, &true_cond) {
            if let Ok(length) = elements.Length() {
                for i in 0..length.min(600) {
                    if let Ok(item) = elements.GetElement(i) {
                        if let Ok(name_bstr) = item.CurrentName() {
                            let name = name_bstr.to_string();
                            let name_lower = name.to_lowercase();

                            // 1. Generation state
                            if name_lower.contains("stop response")
                                || name_lower.contains("stop generating")
                                || name_lower.contains("stop streaming")
                                || name == "Stop"
                            {
                                is_generating = true;
                            } else if name_lower.contains("finished the response")
                                || name == "Send message"
                                || name == "Send"
                            {
                                is_finished = true;
                            }

                            // 2. Needs Input (Approval)
                            if check_needs_input(&name_lower) {
                                needs_input = true;
                            }

                            // 3. Limit Reached
                            if check_limit_reached(&name_lower) {
                                limit_reached = true;
                            }

                            // 4. Response structure signal (highest priority)
                            if struct_kind.is_none() {
                                if let Some(sk) = check_response_structure(&name, &name_lower) {
                                    struct_kind = Some(sk);
                                }
                            }

                            // 5. Prompt keyword signal (search input area or message controls)
                            if prompt_kind.is_none() && name.len() >= 3 && name.len() <= 400 {
                                if let Some(pk) = classify_prompt_keywords(&name) {
                                    prompt_kind = Some(pk);
                                }
                            }
                        }
                    }
                }
            }
        }

        // Decision Order: Response structure -> Prompt keywords -> Window title -> Question
        let final_kind = struct_kind
            .or(prompt_kind)
            .or_else(|| classify_prompt_keywords(window_title))
            .unwrap_or(TaskKind::Question);

        DesktopProbeResult {
            is_generating,
            is_finished,
            needs_input,
            limit_reached,
            task_kind: final_kind,
        }
    }
}

#[cfg(target_os = "windows")]
fn probe_chatgpt_uia(
    hwnd: windows::Win32::Foundation::HWND,
    window_title: &str,
) -> DesktopProbeResult {
    use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER};
    use windows::Win32::UI::Accessibility::{CUIAutomation, IUIAutomation, TreeScope_Descendants};

    let fallback = DesktopProbeResult {
        is_generating: false,
        is_finished: false,
        needs_input: false,
        limit_reached: false,
        task_kind: classify_prompt_keywords(window_title).unwrap_or(TaskKind::Question),
    };

    unsafe {
        let uia: IUIAutomation = match CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER) {
            Ok(u) => u,
            Err(_) => return fallback,
        };

        let root_el = match uia.ElementFromHandle(hwnd) {
            Ok(el) => el,
            Err(_) => return fallback,
        };

        let true_cond = match uia.CreateTrueCondition() {
            Ok(c) => c,
            Err(_) => return fallback,
        };

        let mut is_generating = false;
        let mut is_finished = false;
        let mut needs_input = false;
        let mut limit_reached = false;

        let mut struct_kind: Option<TaskKind> = None;
        let mut prompt_kind: Option<TaskKind> = None;

        if let Ok(elements) = root_el.FindAll(TreeScope_Descendants, &true_cond) {
            if let Ok(length) = elements.Length() {
                for i in 0..length.min(600) {
                    if let Ok(item) = elements.GetElement(i) {
                        if let Ok(name_bstr) = item.CurrentName() {
                            let name = name_bstr.to_string();
                            let name_lower = name.to_lowercase();

                            // 1. Generation state
                            if name_lower.contains("stop generating")
                                || name_lower.contains("stop streaming")
                                || name_lower.contains("stop response")
                                || name == "Stop"
                            {
                                is_generating = true;
                            } else if name == "Send prompt"
                                || name == "Send message"
                                || name == "Send"
                            {
                                is_finished = true;
                            }

                            // 2. Needs Input (Approval)
                            if check_needs_input(&name_lower) {
                                needs_input = true;
                            }

                            // 3. Limit Reached
                            if check_limit_reached(&name_lower) {
                                limit_reached = true;
                            }

                            // 4. Response structure signal (highest priority)
                            if struct_kind.is_none() {
                                if let Some(sk) = check_response_structure(&name, &name_lower) {
                                    struct_kind = Some(sk);
                                }
                            }

                            // 5. Prompt keyword signal (search input area or message controls)
                            if prompt_kind.is_none() && name.len() >= 3 && name.len() <= 400 {
                                if let Some(pk) = classify_prompt_keywords(&name) {
                                    prompt_kind = Some(pk);
                                }
                            }
                        }
                    }
                }
            }
        }

        // Decision Order: Response structure -> Prompt keywords -> Window title -> Question
        let final_kind = struct_kind
            .or(prompt_kind)
            .or_else(|| classify_prompt_keywords(window_title))
            .unwrap_or(TaskKind::Question);

        DesktopProbeResult {
            is_generating,
            is_finished,
            needs_input,
            limit_reached,
            task_kind: final_kind,
        }
    }
}
