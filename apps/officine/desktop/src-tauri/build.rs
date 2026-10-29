// Les commandes de l'application sont déclarées ici : Tauri génère une permission `allow-<commande>`
// par commande, et seules les capacités (capabilities/*.json et la capacité « remote » ajoutée à
// l'exécution pour l'origine appairée) les accordent. Aucune commande n'est accessible par défaut.
fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            // W-05 : pont natif de l'origine appairée (trois commandes, pas une de plus).
            "print_receipt",
            "open_cash_drawer",
            "device_info",
            // Écrans embarqués (appairage, serveur non reconnu, imprimante, mise à jour).
            "probe_server",
            "pair_device",
            "retry_connection",
            "get_printer",
            "set_printer",
            "test_printer",
            "pending_update",
            "install_update",
        ]),
    ))
    .expect("échec de la génération Tauri");
}
