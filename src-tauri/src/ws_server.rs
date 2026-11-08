use futures_util::{SinkExt, StreamExt};
use rand::distributions::Alphanumeric;
use rand::Rng;
use serde::{Deserialize, Serialize};
use std::fs;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};
use subtle::ConstantTimeEq;
use tauri::{Emitter, Manager};
use tokio::net::TcpListener;
use tokio::sync::{oneshot, Mutex};
use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tokio_tungstenite::tungstenite::http::{Response as HttpResponse, StatusCode};
use tokio_tungstenite::tungstenite::Message;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WsServerStatus {
    pub running: bool,
    pub port: u16,
    pub error: Option<String>,
    pub client_connected: bool,
    pub client_origin: Option<String>,
}

#[derive(Clone)]
pub struct WsState {
    pub status: Arc<Mutex<WsServerStatus>>,
    pub token: Arc<String>,
    pub client_cancel: Arc<Mutex<Option<oneshot::Sender<()>>>>,
    pub outbound_tx: Arc<Mutex<Option<tokio::sync::mpsc::UnboundedSender<String>>>>,
    pub web_presence: Arc<tokio::sync::Mutex<String>>,
}

impl WsState {
    pub async fn send_to_client(&self, message: String) -> bool {
        let tx = self.outbound_tx.lock().await;
        if let Some(ref sender) = *tx {
            sender.send(message).is_ok()
        } else {
            false
        }
    }
}

pub fn get_or_create_token(app: &tauri::AppHandle) -> String {
    let token_path = app
        .path()
        .app_data_dir()
        .map(|mut p| {
            let _ = fs::create_dir_all(&p);
            p.push("token.secret");
            p
        })
        .unwrap_or_else(|_| PathBuf::from("token.secret"));

    if let Ok(content) = fs::read_to_string(&token_path) {
        let trimmed = content.trim().to_string();
        if trimmed.len() >= 32 {
            return trimmed;
        }
    }

    // Generate a 48-character cryptographically secure random token
    let new_token: String = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(48)
        .map(char::from)
        .collect();

    if let Some(parent) = token_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(&token_path, &new_token);
    println!("[WS SERVER] Generated new token in: {:?}", token_path);
    new_token
}

pub async fn start_server(
    app: tauri::AppHandle,
    port: u16,
    allowed_extension_id: String,
    state: WsState,
) {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = match TcpListener::bind(addr).await {
        Ok(l) => {
            println!("[WS SERVER] Listening on ws://{}", addr);
            let mut st = state.status.lock().await;
            st.running = true;
            st.port = port;
            st.error = None;
            let _ = app.emit("ws-status-changed", st.clone());
            l
        }
        Err(e) => {
            let err_msg = format!("Failed to bind 127.0.0.1:{}: {}", port, e);
            eprintln!("[WS SERVER ERROR] {}", err_msg);
            let mut st = state.status.lock().await;
            st.running = false;
            st.port = port;
            st.error = Some(err_msg);
            let _ = app.emit("ws-status-changed", st.clone());
            return;
        }
    };

    let allowed_ext = allowed_extension_id.trim().to_string();

    while let Ok((stream, peer_addr)) = listener.accept().await {
        let app_handle = app.clone();
        let state_clone = state.clone();
        let allowed_ext_clone = allowed_ext.clone();

        tokio::spawn(async move {
            let origin_captured = Arc::new(std::sync::Mutex::new(None::<String>));
            let origin_writer = origin_captured.clone();

            // Handshake header callback to validate Origin
            let callback = move |req: &Request, resp: Response| -> Result<Response, ErrorResponse> {
                let origin_header = req
                    .headers()
                    .get("origin")
                    .or_else(|| req.headers().get("Origin"));

                if let Some(val) = origin_header {
                    if let Ok(origin_str) = val.to_str() {
                        let trimmed = origin_str.trim().to_lowercase();
                        // Reject normal web page origins
                        if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
                            eprintln!("[WS SERVER] Rejected forbidden web Origin: {}", origin_str);
                            let err_resp = HttpResponse::builder()
                                .status(StatusCode::FORBIDDEN)
                                .body(Some("Forbidden Origin".to_string()))
                                .unwrap();
                            return Err(err_resp);
                        }

                        // Check chrome-extension://
                        if trimmed.starts_with("chrome-extension://") {
                            if !allowed_ext_clone.is_empty() {
                                let expected = format!("chrome-extension://{}", allowed_ext_clone.to_lowercase());
                                if trimmed != expected {
                                    eprintln!(
                                        "[WS SERVER] Rejected extension Origin {}, expected {}",
                                        trimmed, expected
                                    );
                                    let err_resp = HttpResponse::builder()
                                        .status(StatusCode::FORBIDDEN)
                                        .body(Some("Unauthorized extension ID".to_string()))
                                        .unwrap();
                                    return Err(err_resp);
                                }
                            }
                            *origin_writer.lock().unwrap() = Some(origin_str.to_string());
                        } else {
                            // Any other unknown scheme is rejected
                            eprintln!("[WS SERVER] Rejected non-extension Origin: {}", origin_str);
                            let err_resp = HttpResponse::builder()
                                .status(StatusCode::FORBIDDEN)
                                .body(Some("Forbidden Origin".to_string()))
                                .unwrap();
                            return Err(err_resp);
                        }
                    }
                } else {
                    // No Origin header is accepted (local CLI / dev tools)
                    *origin_writer.lock().unwrap() = Some("local/no-origin".to_string());
                }

                Ok(resp)
            };

            let ws_stream = match tokio_tungstenite::accept_hdr_async(stream, callback).await {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("[WS SERVER] Upgrade failed from {}: {}", peer_addr, e);
                    return;
                }
            };

            let origin_final = origin_captured
                .lock()
                .unwrap()
                .clone()
                .unwrap_or_else(|| "unknown".to_string());

            handle_client(ws_stream, app_handle, state_clone, origin_final).await;
        });
    }
}

async fn handle_client<S>(
    mut ws_stream: tokio_tungstenite::WebSocketStream<S>,
    app: tauri::AppHandle,
    state: WsState,
    client_origin: String,
) where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
{
    // Step 1: 3-Second Auth Handshake
    let auth_result = tokio::time::timeout(Duration::from_secs(3), ws_stream.next()).await;
    let auth_msg = match auth_result {
        Ok(Some(Ok(Message::Text(text)))) => text,
        _ => {
            eprintln!("[WS SERVER] Client handshake timed out or sent non-text frame");
            let _ = ws_stream
                .send(Message::Text(r#"{"kind":"auth_fail"}"#.into()))
                .await;
            let _ = ws_stream.close(None).await;
            return;
        }
    };

    #[derive(Deserialize)]
    struct AuthMsg {
        kind: String,
        token: Option<String>,
    }

    let parsed_auth: Result<AuthMsg, _> = serde_json::from_str(&auth_msg);
    let is_authorized = match parsed_auth {
        Ok(auth) if auth.kind == "auth" => {
            if let Some(token_received) = auth.token {
                let expected = state.token.as_bytes();
                let actual = token_received.as_bytes();
                if actual.len() == expected.len() {
                    bool::from(actual.ct_eq(expected))
                } else {
                    false
                }
            } else {
                false
            }
        }
        _ => false,
    };

    if !is_authorized {
        eprintln!("[WS SERVER] Client authentication failed: invalid token");
        let _ = ws_stream
            .send(Message::Text(r#"{"kind":"auth_fail"}"#.into()))
            .await;
        let _ = ws_stream.close(None).await;
        return;
    }

    // Auth OK
    if let Err(_) = ws_stream
        .send(Message::Text(r#"{"kind":"auth_ok"}"#.into()))
        .await
    {
        return;
    }

    println!("[WS SERVER] Client authenticated from {}", client_origin);

    let is_extension = client_origin.starts_with("chrome-extension://");

    let (cancel_tx, mut cancel_rx) = oneshot::channel::<()>();
    let (out_tx, mut out_rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    if is_extension {
        let mut prev = state.client_cancel.lock().await;
        if let Some(old_cancel) = prev.take() {
            let _ = old_cancel.send(());
        }
        *prev = Some(cancel_tx);

        let mut tx_lock = state.outbound_tx.lock().await;
        *tx_lock = Some(out_tx);

        let mut st = state.status.lock().await;
        st.client_connected = true;
        st.client_origin = Some(client_origin.clone());
        let _ = app.emit("ws-status-changed", st.clone());
    }

    let (mut ws_sender, mut ws_receiver) = ws_stream.split();

    let mut rate_window_start = Instant::now();
    let mut rate_event_count: u32 = 0;
    let mut last_event_key: Option<(String, String, Option<String>, String)> = None;
    let mut last_event_time = Instant::now();

    // Loop processing incoming frames
    loop {
        tokio::select! {
            _ = &mut cancel_rx => {
                println!("[WS SERVER] Client replaced by a new incoming connection");
                let _ = ws_sender.close().await;
                break;
            }
            Some(out_text) = out_rx.recv() => {
                let _ = ws_sender.send(Message::Text(out_text.into())).await;
            }
            frame = ws_receiver.next() => {
                let msg = match frame {
                    Some(Ok(m)) => m,
                    _ => break,
                };

                match msg {
                    Message::Text(text) => {
                        // Max message size 4 KB
                        if text.len() > 4096 {
                            eprintln!("[WS SERVER] Dropping oversized message ({} bytes)", text.len());
                            continue;
                        }

                        #[derive(Deserialize)]
                        struct IncomingMsg {
                            kind: String,
                            #[serde(rename = "type")]
                            msg_type: Option<String>,
                            site: Option<String>,
                            source: Option<String>,
                            message: Option<String>,
                            #[serde(rename = "tabId")]
                            tab_id: Option<i64>,
                            #[serde(rename = "windowId")]
                            window_id: Option<i64>,
                            #[serde(rename = "taskId")]
                            task_id: Option<String>,
                            #[serde(rename = "taskKind")]
                            task_kind: Option<String>,
                        }

                        let parsed: IncomingMsg = match serde_json::from_str(&text) {
                            Ok(p) => p,
                            Err(e) => {
                                eprintln!("[WS SERVER] Invalid JSON frame dropped: {}", e);
                                continue;
                            }
                        };

                        if parsed.kind == "ping" {
                            let _ = ws_sender.send(Message::Text(r#"{"kind":"pong"}"#.into())).await;
                            continue;
                        }

                        if parsed.kind == "presence" {
                            let site = parsed.site.unwrap_or_else(|| "none".to_string()).to_lowercase();
                            let valid_site = match site.as_str() {
                                "claude" | "chatgpt" | "gemini" => site,
                                _ => "none".to_string(),
                            };
                            {
                                let mut wp = state.web_presence.lock().await;
                                *wp = valid_site;
                            }
                            crate::context_detector::trigger_context_evaluation();
                            continue;
                        }

                        if parsed.kind == "event" {
                            // Rate limit: max 25 events per second per client
                            if rate_window_start.elapsed() >= Duration::from_secs(1) {
                                rate_window_start = Instant::now();
                                rate_event_count = 0;
                            }
                            rate_event_count += 1;
                            if rate_event_count > 25 {
                                if rate_event_count == 26 {
                                    eprintln!("[WS SERVER] Rate limit exceeded (>25 events/sec) from {}", client_origin);
                                }
                                continue;
                            }

                            let event_type = parsed.msg_type.unwrap_or_default().to_lowercase();
                            let event_site = parsed.site.unwrap_or_default().to_lowercase();

                            if event_type == "resolve_needs_input" {
                                println!("[WS SERVER] Received resolve_needs_input event, emitting island-resolve-needs-input");
                                let resolve_payload = serde_json::json!({
                                    "site": if event_site.is_empty() { None } else { Some(event_site) },
                                    "taskId": parsed.task_id.as_deref().map(|t| t.trim().chars().take(64).collect::<String>()).filter(|t| !t.is_empty())
                                });
                                let _ = app.emit("island-resolve-needs-input", resolve_payload);
                                continue;
                            }

                            // Validate notification types
                            let valid_types = ["working", "finished", "stopped", "needs_input", "limit_reached", "step"];
                            if !valid_types.contains(&event_type.as_str()) {
                                eprintln!("[WS SERVER] Dropping event with invalid type: {}", event_type);
                                continue;
                            }

                            // Validate AI site
                            let valid_sites = ["claude", "chatgpt", "gemini", "antigravity"];
                            if !valid_sites.contains(&event_site.as_str()) {
                                eprintln!("[WS SERVER] Dropping event with invalid site: {}", event_site);
                                continue;
                            }

                            // Validate source ("web" | "desktop" | "ide", default "web")
                            let raw_source = parsed.source.unwrap_or_else(|| "web".to_string()).to_lowercase();
                            let source = if raw_source == "desktop" || raw_source == "ide" {
                                raw_source
                            } else {
                                "web".to_string()
                            };

                            // Message preview capped to 120 characters
                            let raw_msg = parsed.message.unwrap_or_default();
                            let message: String = raw_msg.chars().take(120).collect();

                            // taskId validated as string up to 64 characters
                            let task_id = parsed.task_id.as_deref().map(|t| t.trim().chars().take(64).collect::<String>()).filter(|t| !t.is_empty());

                            // Validate taskKind against allowed kinds (defaults to "question")
                            let allowed_kinds = [
                                "image", "pdf", "document", "spreadsheet", "slides", "code",
                                "research", "translation", "summary", "rewrite", "question",
                            ];
                            let raw_kind = parsed
                                .task_kind
                                .as_deref()
                                .unwrap_or("question")
                                .trim()
                                .to_lowercase();
                            let task_kind = if allowed_kinds.contains(&raw_kind.as_str()) {
                                raw_kind
                            } else {
                                "question".to_string()
                            };

                            let payload = serde_json::json!({
                                "type": event_type,
                                "site": event_site,
                                "source": source,
                                "message": message,
                                "taskId": task_id,
                                "taskKind": task_kind,
                                "tabId": parsed.tab_id,
                                "windowId": parsed.window_id
                            });

                            // Deduplication: drop identical events arriving within 150ms
                            let current_key = (event_type.clone(), event_site.clone(), task_id.clone(), task_kind.clone());
                            if let Some(ref prev_key) = last_event_key {
                                if prev_key == &current_key && last_event_time.elapsed() < Duration::from_millis(150) {
                                    continue;
                                }
                            }
                            last_event_key = Some(current_key);
                            last_event_time = Instant::now();

                            let _ = app.emit("island-notification-event", payload);
                        } else {
                            eprintln!("[WS SERVER] Unknown message kind dropped: {}", parsed.kind);
                        }
                    }
                    Message::Ping(payload) => {
                        let _ = ws_sender.send(Message::Pong(payload)).await;
                    }
                    Message::Close(_) => {
                        break;
                    }
                    _ => {}
                }
            }
        }
    }

    // Clean up on disconnect
    if is_extension {
        let mut tx_lock = state.outbound_tx.lock().await;
        *tx_lock = None;

        let mut st = state.status.lock().await;
        st.client_connected = false;
        st.client_origin = None;
        let _ = app.emit("ws-status-changed", st.clone());

        {
            let mut wp = state.web_presence.lock().await;
            *wp = "none".to_string();
        }
        crate::context_detector::trigger_context_evaluation();
    }
    println!("[WS SERVER] Client disconnected ({})", client_origin);
}

