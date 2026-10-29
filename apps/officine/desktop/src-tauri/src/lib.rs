//! VisionPharma Officine — application de bureau des postes (spec §8 bis, ADR-011).
//!
//! La fenêtre affiche l'interface servie par le serveur appairé. Le cœur Rust :
//! - appaire le poste (W-02) et épingle l'autorité locale (W-03) avant d'ouvrir l'interface ;
//! - n'autorise la navigation que vers l'origine appairée et les écrans embarqués (W-04) ;
//! - n'expose à l'origine appairée que print_receipt, open_cash_drawer et device_info (W-05) ;
//! - imprime en ESC/POS direct (W-06), installe les mises à jour signées du serveur local (W-07),
//!   impose une seule instance, mémorise la fenêtre et applique le mode caisse plein écran (W-08).

pub mod config;
pub mod escpos;
pub mod tls;

use std::io::Write;
use std::net::{TcpStream, ToSocketAddrs};
use std::sync::{Mutex, RwLock};
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use tauri::ipc::CapabilityBuilder;
use tauri::menu::{Menu, MenuItem, Submenu};
use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Manager, State, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_updater::UpdaterExt;

use config::{unhex, Pairing, Printer, Store};
use escpos::ReceiptPayload;
use tls::Origin;

/// W-05 : les trois seules commandes accordées à l'origine appairée.
pub const REMOTE_COMMANDS: [&str; 3] = [
    "allow-print-receipt",
    "allow-open-cash-drawer",
    "allow-device-info",
];
const WATCH_EVERY: Duration = Duration::from_secs(60);

pub struct AppState {
    store: Store,
    /// Origine dont la navigation est autorisée (W-04) ; None tant que le poste n'est pas vérifié.
    allowed: RwLock<Option<String>>,
    /// Autorité vue à la sonde, en attente de confirmation par le code d'appairage.
    probed: Mutex<Option<(Origin, Vec<u8>)>>,
    remote_granted: Mutex<Option<String>>,
    update: Mutex<Option<tauri_plugin_updater::Update>>,
}

fn platform() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    }
}

/// Adresse d'un écran embarqué (protocole de Tauri selon la plateforme).
fn local_url(page: &str) -> Url {
    let base = if cfg!(windows) {
        "http://tauri.localhost/"
    } else {
        "tauri://localhost/"
    };
    Url::parse(base)
        .and_then(|b| b.join(page))
        .expect("adresse locale valide")
}

fn is_local(url: &Url) -> bool {
    url.scheme() == "tauri" || (url.scheme() == "http" && url.host_str() == Some("tauri.localhost"))
}

fn origin_of(url: &Url) -> Option<String> {
    Some(format!(
        "{}://{}:{}",
        url.scheme(),
        url.host_str()?,
        url.port_or_known_default()?
    ))
}

/// W-04 : règle de navigation, testée unitairement.
pub fn navigation_allowed(url: &Url, allowed: Option<&str>) -> bool {
    if is_local(url) {
        return true;
    }
    match (allowed, origin_of(url)) {
        (Some(a), Some(o)) => {
            url.scheme() == "https"
                && Url::parse(a).ok().and_then(|u| origin_of(&u)).as_deref() == Some(o.as_str())
        }
        _ => false,
    }
}

fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window("main")
}

fn show_local(app: &AppHandle, page: &str) {
    if let Some(w) = main_window(app) {
        let _ = w.set_fullscreen(false);
        let _ = w.navigate(local_url(page));
    }
}

fn encode(s: &str) -> String {
    s.bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() {
                (b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect()
}

fn json(body: &[u8]) -> Result<Value, String> {
    serde_json::from_slice(body).map_err(|_| "réponse du serveur illisible".to_string())
}

/// Résultat du contrôle d'un poste appairé.
enum Check {
    Unpaired,
    Unrecognized(String),
    Revoked,
    Ready {
        origin: Origin,
        ca: Vec<u8>,
        secret: String,
        kiosk: bool,
    },
}

fn check(store: &Store) -> Check {
    let (Some(p), Some(secret)) = (store.pairing(), store.secret()) else {
        return Check::Unpaired;
    };
    let origin = Origin {
        host: p.host.clone(),
        port: p.port,
    };
    let Ok(ca) = unhex(&p.ca_der_hex) else {
        return Check::Unpaired;
    };
    if let Err(e) = tls::check_pinned(&origin, &ca) {
        return Check::Unrecognized(e);
    }
    let status = tls::request(
        &origin,
        &ca,
        "GET",
        &format!("/api/v1/devices/{}/status", encode(&p.device_id)),
        &[],
        None,
    )
    .and_then(|r| json(&r.body));
    match status {
        Ok(v) if v["status"] == "revoked" => return Check::Revoked,
        Ok(_) => {}
        Err(e) => return Check::Unrecognized(e),
    }
    let kiosk = tls::request(
        &origin,
        &ca,
        "GET",
        "/api/v1/devices/self",
        &[("X-VP-Device", &secret)],
        None,
    )
    .ok()
    .and_then(|r| json(&r.body).ok())
    .and_then(|v| v["kiosk"].as_bool())
    .unwrap_or(false);
    Check::Ready {
        origin,
        ca,
        secret,
        kiosk,
    }
}

/// W-05 : capacité accordée à l'exécution, pour l'origine appairée exacte et la seule fenêtre principale.
pub fn remote_capability(origin_url: &str) -> CapabilityBuilder {
    REMOTE_COMMANDS.iter().fold(
        CapabilityBuilder::new("remote-paired-origin")
            .local(false)
            .remote(format!("{origin_url}/*"))
            .window("main"),
        |c, p| c.permission(*p),
    )
}

fn open_app(
    app: &AppHandle,
    origin: &Origin,
    ca: &[u8],
    secret: &str,
    kiosk: bool,
) -> Result<(), String> {
    let state = app.state::<AppState>();
    let url = origin.url();
    {
        let mut granted = state.remote_granted.lock().map_err(|_| "verrou")?;
        if granted.as_deref() != Some(url.as_str()) {
            app.add_capability(remote_capability(&url))
                .map_err(|e| e.to_string())?;
            *granted = Some(url.clone());
        }
    }
    let r = tls::request(
        origin,
        ca,
        "POST",
        "/api/v1/devices/session",
        &[("X-VP-Device", secret)],
        Some(b"{}"),
    )?;
    let token = json(&r.body)?["token"]
        .as_str()
        .ok_or("jeton de démarrage absent")?
        .to_string();
    *state.allowed.write().map_err(|_| "verrou")? = Some(url.clone());
    let w = main_window(app).ok_or("fenêtre absente")?;
    w.set_fullscreen(kiosk).ok();
    w.navigate(
        Url::parse(&format!(
            "{url}/api/v1/devices/boot?token={}",
            encode(&token)
        ))
        .map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

/// Démarrage et reconnexion : épinglage, statut du poste, puis ouverture de l'interface.
fn boot(app: &AppHandle) {
    let state = app.state::<AppState>();
    match check(&state.store) {
        Check::Unpaired => show_local(app, "index.html"),
        Check::Unrecognized(reason) => {
            if let Ok(mut a) = state.allowed.write() {
                *a = None;
            }
            show_local(
                app,
                &format!("unrecognized.html?reason={}", encode(&reason)),
            );
        }
        Check::Revoked => {
            state.store.forget();
            show_local(app, "index.html?revoked=1");
        }
        Check::Ready {
            origin,
            ca,
            secret,
            kiosk,
        } => match open_app(app, &origin, &ca, &secret, kiosk) {
            Ok(()) => spawn_update_check(app.clone(), origin.url()),
            Err(e) => show_local(app, &format!("unrecognized.html?reason={}", encode(&e))),
        },
    }
}

/// W-03, W-09 : contrôle périodique (épinglage et révocation) tant que l'application tourne.
fn spawn_watchdog(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(WATCH_EVERY);
        let state = app.state::<AppState>();
        if state.allowed.read().map(|a| a.is_none()).unwrap_or(true) {
            continue;
        }
        match check(&state.store) {
            Check::Ready { .. } => {}
            Check::Revoked => {
                state.store.forget();
                if let Ok(mut a) = state.allowed.write() {
                    *a = None;
                }
                show_local(&app, "index.html?revoked=1");
            }
            Check::Unrecognized(reason) => {
                if let Ok(mut a) = state.allowed.write() {
                    *a = None;
                }
                show_local(
                    &app,
                    &format!("unrecognized.html?reason={}", encode(&reason)),
                );
            }
            Check::Unpaired => show_local(&app, "index.html"),
        }
    });
}

/// W-07 : manifeste du serveur local ; signature vérifiée par le plugin avec la clé publique compilée.
fn spawn_update_check(app: AppHandle, origin: String) {
    tauri::async_runtime::spawn(async move {
        let Ok(endpoint) = Url::parse(&format!("{origin}/api/v1/desktop/update")) else {
            return;
        };
        let Ok(builder) = app.updater_builder().endpoints(vec![endpoint]) else {
            return;
        };
        let Ok(updater) = builder.build() else { return };
        if let Ok(Some(update)) = updater.check().await {
            if let Ok(mut u) = app.state::<AppState>().update.lock() {
                *u = Some(update);
            }
            let _ =
                WebviewWindowBuilder::new(&app, "update", WebviewUrl::App("update.html".into()))
                    .title("Mise à jour de VisionPharma")
                    .inner_size(460.0, 320.0)
                    .resizable(false)
                    .on_navigation(is_local)
                    .on_new_window(|_, _| NewWindowResponse::Deny)
                    .build();
        }
    });
}

// ---------------------------------------------------------------- commandes de l'origine appairée (W-05)

#[derive(Serialize)]
pub struct DeviceInfo {
    device_id: String,
    name: String,
    platform: &'static str,
    app_version: String,
    printer: Option<String>,
}

#[tauri::command]
fn device_info(app: AppHandle, state: State<'_, AppState>) -> Result<DeviceInfo, String> {
    let p = state.store.pairing().ok_or("poste non appairé")?;
    let printer = state.store.printer().address;
    Ok(DeviceInfo {
        device_id: p.device_id,
        name: p.device_name,
        platform: platform(),
        app_version: app.package_info().version.to_string(),
        printer: (!printer.is_empty()).then_some(printer),
    })
}

fn send_to_printer(address: &str, bytes: &[u8]) -> Result<(), String> {
    if address.is_empty() {
        return Err("aucune imprimante ESC/POS configurée sur ce poste".into());
    }
    let addr = address
        .to_socket_addrs()
        .map_err(|e| e.to_string())?
        .next()
        .ok_or("adresse d'imprimante invalide")?;
    let mut s = TcpStream::connect_timeout(&addr, Duration::from_secs(4))
        .map_err(|e| format!("imprimante injoignable : {e}"))?;
    s.set_write_timeout(Some(Duration::from_secs(4))).ok();
    s.write_all(bytes)
        .and_then(|_| s.flush())
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn print_receipt(state: State<'_, AppState>, receipt: ReceiptPayload) -> Result<(), String> {
    let bytes = escpos::render(&receipt)?;
    let address = state.store.printer().address;
    tauri::async_runtime::spawn_blocking(move || send_to_printer(&address, &bytes))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn open_cash_drawer(state: State<'_, AppState>) -> Result<(), String> {
    let address = state.store.printer().address;
    tauri::async_runtime::spawn_blocking(move || send_to_printer(&address, &escpos::drawer_pulse()))
        .await
        .map_err(|e| e.to_string())?
}

// ---------------------------------------------------------------- commandes des écrans embarqués

#[derive(Serialize)]
pub struct Probe {
    origin: String,
    fingerprint: String,
}

#[tauri::command]
async fn probe_server(state: State<'_, AppState>, address: String) -> Result<Probe, String> {
    let origin = Origin::parse(&address)?;
    let o = origin.clone();
    let ca = tauri::async_runtime::spawn_blocking(move || tls::probe(&o))
        .await
        .map_err(|e| e.to_string())??;
    let fingerprint = tls::fingerprint(&ca);
    *state.probed.lock().map_err(|_| "verrou")? = Some((origin.clone(), ca));
    Ok(Probe {
        origin: origin.url(),
        fingerprint,
    })
}

#[tauri::command]
async fn pair_device(
    app: AppHandle,
    state: State<'_, AppState>,
    code: String,
    name: String,
) -> Result<(), String> {
    let (origin, ca) = state
        .probed
        .lock()
        .map_err(|_| "verrou")?
        .clone()
        .ok_or("vérifiez d'abord l'adresse du serveur")?;
    let body = serde_json::json!({ "name": name.trim(), "platform": platform(), "app_version": app.package_info().version.to_string(), "code": code.trim() });
    let (o, c) = (origin.clone(), ca.clone());
    let r = tauri::async_runtime::spawn_blocking(move || {
        tls::request(
            &o,
            &c,
            "POST",
            "/api/v1/devices/pair",
            &[],
            Some(body.to_string().as_bytes()),
        )
    })
    .await
    .map_err(|e| e.to_string())??;
    let v = json(&r.body)?;
    if r.status != 201 {
        return Err(v["detail"]
            .as_str()
            .or(v["title"].as_str())
            .unwrap_or("appairage refusé")
            .to_string());
    }
    let id = v["id"].as_str().ok_or("réponse sans identifiant")?;
    let secret = v["secret"].as_str().ok_or("réponse sans secret")?;
    let pairing = Pairing {
        host: origin.host,
        port: origin.port,
        ca_der_hex: String::new(),
        device_id: id.into(),
        device_name: name.trim().into(),
    };
    state.store.save_pairing(&pairing, &ca, secret)?;
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || boot(&handle));
    Ok(())
}

#[tauri::command]
async fn retry_connection(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || boot(&app))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_printer(state: State<'_, AppState>) -> Printer {
    state.store.printer()
}

#[tauri::command]
fn set_printer(state: State<'_, AppState>, address: String) -> Result<(), String> {
    let address = address.trim().to_string();
    if !address.is_empty()
        && address.parse::<std::net::SocketAddr>().is_err()
        && !address.contains(':')
    {
        return Err("adresse attendue : IP:port (port 9100 en général)".into());
    }
    state.store.save_printer(&Printer { address })
}

#[tauri::command]
async fn test_printer(state: State<'_, AppState>) -> Result<(), String> {
    let address = state.store.printer().address;
    let bytes = escpos::render(&ReceiptPayload {
        lines: vec![
            "VisionPharma".into(),
            "Test d'impression ESC/POS".into(),
            "éèàçôû €".into(),
        ],
        open_drawer: false,
    })?;
    tauri::async_runtime::spawn_blocking(move || send_to_printer(&address, &bytes))
        .await
        .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
pub struct PendingUpdate {
    version: String,
    notes: Option<String>,
}

#[tauri::command]
fn pending_update(state: State<'_, AppState>) -> Option<PendingUpdate> {
    let u = state.update.lock().ok()?;
    u.as_ref().map(|u| PendingUpdate {
        version: u.version.clone(),
        notes: u.body.clone(),
    })
}

#[tauri::command]
async fn install_update(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let update = state
        .update
        .lock()
        .map_err(|_| "verrou")?
        .take()
        .ok_or("aucune mise à jour en attente")?;
    // Une signature absente ou invalide fait échouer ici : le paquet n'est jamais installé.
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| e.to_string())?;
    app.restart();
}

// ---------------------------------------------------------------- démarrage

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let printer = MenuItem::with_id(app, "printer", "Imprimante…", true, None::<&str>)?;
    let reload = MenuItem::with_id(app, "reload", "Reconnecter", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quitter", true, None::<&str>)?;
    let poste = Submenu::with_items(app, "Poste", true, &[&printer, &reload, &quit])?;
    Menu::with_items(app, &[&poste])
}

fn open_printer_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("printer") {
        let _ = w.set_focus();
        return;
    }
    let _ = WebviewWindowBuilder::new(app, "printer", WebviewUrl::App("printer.html".into()))
        .title("Imprimante du poste")
        .inner_size(460.0, 300.0)
        .resizable(false)
        .on_navigation(is_local)
        .on_new_window(|_, _| NewWindowResponse::Deny)
        .build();
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = main_window(app) {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            device_info,
            print_receipt,
            open_cash_drawer,
            probe_server,
            pair_device,
            retry_connection,
            get_printer,
            set_printer,
            test_printer,
            pending_update,
            install_update
        ])
        .setup(|app| {
            let store = Store::new(app.path().app_config_dir()?).map_err(std::io::Error::other)?;
            app.manage(AppState {
                store,
                allowed: RwLock::new(None),
                probed: Mutex::new(None),
                remote_granted: Mutex::new(None),
                update: Mutex::new(None),
            });
            let handle = app.handle().clone();
            app.set_menu(build_menu(&handle)?)?;
            app.on_menu_event(|app, e| match e.id().as_ref() {
                "printer" => open_printer_window(app),
                "reload" => {
                    let h = app.clone();
                    tauri::async_runtime::spawn_blocking(move || boot(&h));
                }
                "quit" => app.exit(0),
                _ => {}
            });
            let nav = handle.clone();
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("VisionPharma Officine")
                .inner_size(1366.0, 820.0)
                .min_inner_size(1024.0, 680.0)
                .on_navigation(move |url| {
                    let state = nav.state::<AppState>();
                    let allowed = state.allowed.read().ok().and_then(|a| a.clone());
                    navigation_allowed(url, allowed.as_deref())
                })
                // W-04 : aucun lien n'ouvre de fenêtre, ni dans l'application ni dans un navigateur.
                .on_new_window(|_, _| NewWindowResponse::Deny)
                .build()?;
            let h = handle.clone();
            tauri::async_runtime::spawn_blocking(move || boot(&h));
            spawn_watchdog(handle);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("échec du démarrage de l'application");
}

#[cfg(test)]
mod tests;
