//! W-04, W-05 : tests de configuration. Ils échouent si une capacité, une permission, un plugin ou une
//! dépendance non listée apparaît (spec §8 bis, GUARDRAILS 16).

use super::*;
use serde_json::Value;
use std::collections::BTreeSet;
use tauri::ipc::RuntimeCapability;

fn read(path: &str) -> String {
    std::fs::read_to_string(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(path))
        .expect(path)
}

#[test]
fn w04_navigation_only_to_paired_origin_and_local_screens() {
    let paired = Some("https://officine.local:8443");
    let ok = |u: &str| navigation_allowed(&Url::parse(u).unwrap(), paired);
    assert!(ok("https://officine.local:8443/caisse"));
    assert!(ok(
        "https://officine.local:8443/api/v1/devices/boot?token=x"
    ));
    assert!(ok("tauri://localhost/index.html"));
    assert!(ok("http://tauri.localhost/unrecognized.html"));
    for bad in [
        "https://evil.example/",
        "https://officine.local:9443/",
        "http://officine.local:8443/",
        "https://officine.local.evil.example:8443/",
        "file:///C:/Windows/",
        "javascript:alert(1)",
        "http://localhost:8443/",
        "https://user@officine.local:8444/",
    ] {
        assert!(!ok(bad), "{bad}");
    }
    assert!(!navigation_allowed(
        &Url::parse("https://officine.local:8443/").unwrap(),
        None
    ));
}

#[test]
fn w05_remote_bridge_is_exactly_three_commands() {
    assert_eq!(
        REMOTE_COMMANDS,
        [
            "allow-print-receipt",
            "allow-open-cash-drawer",
            "allow-device-info"
        ]
    );
    let tauri::utils::acl::capability::CapabilityFile::Capability(c) =
        remote_capability("https://officine.local:8443").build()
    else {
        panic!("une seule capacité attendue");
    };
    let cap = serde_json::to_value(c).unwrap();
    let perms: BTreeSet<String> = cap["permissions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p.as_str().unwrap().to_string())
        .collect();
    assert_eq!(
        perms,
        REMOTE_COMMANDS.iter().map(|s| s.to_string()).collect()
    );
    assert_eq!(cap["windows"], serde_json::json!(["main"]));
    assert_eq!(
        cap["local"], false,
        "le pont distant n'est pas accordé aux écrans embarqués"
    );
    assert_eq!(
        cap["remote"]["urls"],
        serde_json::json!(["https://officine.local:8443/*"])
    );
}

#[test]
fn w05_static_capabilities_are_local_only_and_listed() {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("capabilities");
    let files: Vec<_> = std::fs::read_dir(&dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().into_string().unwrap())
        .collect();
    assert_eq!(
        files,
        vec!["local-screens.json".to_string()],
        "capacité non listée"
    );
    let cap: Value = serde_json::from_str(&read("capabilities/local-screens.json")).unwrap();
    assert!(
        cap.get("remote").is_none(),
        "les écrans embarqués n'ont aucune origine distante"
    );
    let perms: BTreeSet<&str> = cap["permissions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p.as_str().unwrap())
        .collect();
    let expected: BTreeSet<&str> = [
        "allow-probe-server",
        "allow-pair-device",
        "allow-retry-connection",
        "allow-get-printer",
        "allow-set-printer",
        "allow-test-printer",
        "allow-pending-update",
        "allow-install-update",
    ]
    .into();
    assert_eq!(perms, expected);
    for p in &perms {
        assert!(
            !REMOTE_COMMANDS.contains(p),
            "{p} réservé à l'origine appairée"
        );
    }
}

#[test]
fn w05_no_forbidden_plugin_or_dependency() {
    let conf: Value = serde_json::from_str(&read("tauri.conf.json")).unwrap();
    let plugins: Vec<&String> = conf["plugins"].as_object().unwrap().keys().collect();
    assert_eq!(plugins, vec!["updater"]);
    assert_eq!(conf["app"]["withGlobalTauri"], false);
    assert_eq!(
        conf["app"]["security"]["capabilities"],
        serde_json::json!(["local-screens"])
    );
    let cargo = read("Cargo.toml");
    let deps = cargo
        .split("[dependencies]")
        .nth(1)
        .unwrap()
        .split("\n[")
        .next()
        .unwrap();
    let names: BTreeSet<&str> = deps
        .lines()
        .filter_map(|l| l.split_once('=').map(|(k, _)| k.trim()))
        .filter(|k| !k.is_empty() && !k.starts_with('#'))
        .collect();
    let allowed: BTreeSet<&str> = [
        "tauri",
        "tauri-plugin-updater",
        "tauri-plugin-single-instance",
        "tauri-plugin-window-state",
        "rustls",
        "serde",
        "serde_json",
    ]
    .into();
    assert_eq!(names, allowed);
    for forbidden in ["tauri-plugin-shell", "tauri-plugin-fs", "tauri-plugin-http"] {
        assert!(!cargo.contains(forbidden), "{forbidden} interdit");
    }
}
