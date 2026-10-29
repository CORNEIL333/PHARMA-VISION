<!-- VisionPharma · documentation projet · v3.1 · 2026-10-26 -->

# Annexe C — Catalogue d'événements et vecteurs de test du journal

## 1. Enveloppe

Dans la base du nœud, un événement est une ligne de `events` (document 06, section 3.2). À l'export et à l'envoi vers le cloud (L1), il est transformé en **CloudEvents 1.0.2** (mode structuré, JSON) sans perte :

| Champ CloudEvents | Valeur |
|---|---|
| `specversion` | `"1.0"` |
| `id` | `events.id` |
| `source` | `"urn:visionpharma:node:" + node_id` |
| `type` | `"cm.visionpharma." + events.type` (par exemple `cm.visionpharma.sale.completed`) |
| `time` | `events.at` |
| `datacontenttype` | `"application/json"` |
| `dataschema` | `"urn:visionpharma:schema:" + events.type + ":v1"` |
| `subject` | identifiant de l'entité principale (vente, lot, produit) |
| `data` | `events.payload` |
| extensions | `vpseq` (= `seq`), `vpprevhash` (= `prev_hash`), `vphash` (= `hash`), `vpactor` (= `actor`) |

## 2. Règles de contenu

- Le contenu suffit à **recalculer les projections** : chaque événement qui touche au stock liste les mouvements (`lot_id`, `qty` signée, `kind`).
- Jamais de secret, de mot de passe, d'image ni de jeton.
- Les données patient se limitent à la référence pseudonyme de l'ordonnance.
- Les montants sont des entiers XAF.

## 3. Types d'événements du MVP

| Type | Émis quand | Contenu minimal |
|---|---|---|
| `system.initialized` | Premier démarrage | `node_id`, `schema`, `pharmacy_name` |
| `system.key_rotated` | Rotation de la clé du nœud | ancien et nouveau `kid`, clés publiques, double signature |
| `system.settings_changed` | Paramètre modifié | clé, ancienne et nouvelle valeur |
| `system.profile_updated` | Rubrique du dossier de l'officine enregistrée | rubrique, noms des champs modifiés, SHA-256 du contenu (jamais les valeurs) |
| `payer.created` / `payer.updated` | Organisme de tiers payant | `payer_id`, nom, type, actif |
| `system.backup_created` | Sauvegarde | fichier, taille, `last_seq`, empreinte de l'archive |
| `system.restored` | Restauration | archive, `last_seq` restauré |
| `system.support_access` | Ouverture ou fermeture de l'accès de support | durée, motif |
| `security.login_succeeded` / `security.login_failed` | Connexion | utilisateur (ou identifiant tenté), adresse IP |
| `security.account_locked` | Verrouillage | utilisateur, durée |
| `security.access_denied` | Action refusée par la matrice des droits (RC-18) | utilisateur, rôle, action, méthode, route (jamais le corps) |
| `security.reauth` | Ré-authentification | utilisateur, action visée |
| `user.created` / `user.updated` / `user.disabled` / `user.enabled` / `user.password_reset` / `user.sessions_revoked` | Gestion des comptes | utilisateur cible, champs modifiés (jamais le mot de passe) |
| `catalog.imported` | Import du catalogue | `import_id`, `filename`, lignes totales, insérées, mises à jour, rejetées, colonnes inconnues, `truncated`, empreinte SHA-256 du fichier |
| `catalog.item_activated` | Activation d'une fiche | `product_id`, cause (`reception`, `inventory`, `order`, `regul_sale`) |
| `catalog.item_sleeping` | Mise en sommeil | `product_id` (acteur nul : tâche automatique) |
| `catalog.barcode_linked` | Association d'un code-barres | `code`, `product_id`, `kind` (`gtin`, `interne`, `autre`) |
| `catalog.local_item_created` | Fiche locale | `product_id`, `name`, `category`, `barcode`, `local_only` |
| `catalog.price_changed` | Changement de prix | `product_id`, `old_price`, `new_price` |
| `catalog.thresholds_changed` | Seuils modifiés | `product_id`, min, max |
| `supplier.created` / `supplier.updated` | Fournisseurs | fiche |
| `order.created` / `order.sent` / `order.cancelled` | Bons de commande | `po_id`, lignes |
| `reception.recorded` | Réception | `po_id` éventuel, lignes (`product_id`, `lot_id`, `lot_number`, `expiry`, `qty`, `unit_cost`) |
| `stock.adjusted` | Ajustement | mouvements, motif |
| `stock.destroyed` | Destruction | mouvements, motif, numéro de procès-verbal |
| `stock.returned_to_supplier` | Retour | mouvements, fournisseur, motif |
| `inventory.opened` / `inventory.counted` / `inventory.validated` | Inventaire | session, comptages, mouvements de correction |
| `cash.opened` / `cash.closed` | Caisse | session, fond, compté, attendu, écart |
| `prescription.validated` | Ordonnance | `prescription_id`, prescripteur, date, référence patient, empreinte de l'image chiffrée |
| `sale.completed` | Vente | `sale_id`, numéro, lignes (`product_id`, `lot_id`, `qty`, `unit_price`), remise, paiements, `prescription_id`, `has_regul` |
| `sale.voided` | Annulation | `sale_id`, motif, mouvements inverses |
| `recall.published` / `recall.closed` | Rappel | `recall_id`, produit, lot, motif, source |
| `demand.unmet` | Demande non satisfaite | `product_id` ou texte, quantité, criticité, source |
| `demand.resolved` | Résolution | `demand_id`, cause |
| `duty.declared` | Garde | début, fin |
| `ledger.exported` | Export de la file d'envoi | intervalle de `seq`, empreinte du fichier |
| `device.paired` / `device.revoked` | Appairage ou révocation d'un poste | identifiant et nom du poste, plateforme, auteur |
| `device.update_published` | Nouvelle version de l'application de bureau publiée sur le serveur | version, empreinte des paquets |

Types prévus pour L1 et plus tard (ne pas émettre au MVP) : `demand.alert_sent`, `demand.answered`, `reservation.*`, `payment.confirmed`, `report.generated`, `coldchain.breach`, `adverse_event.reported`.

## 4. Vecteurs de test du journal (obligatoires)

L'implémentation doit reproduire ces valeurs **octet pour octet**. Elles ont été calculées avec SHA-256 sur la forme canonique RFC 8785.

### 4.1 Événement 1

Objet haché (champ `hash` exclu) :

```json
{"actor":null,"at":"2026-10-26T08:00:00.000Z","id":"0b8f8a4e-3f5c-4c1e-9a43-6a0d1f6e2b11","payload":{"node_id":"7d2c1c7e-91f4-4d0b-8f3a-2a6b5f0c9e01","schema":1},"prev_hash":"0000000000000000000000000000000000000000000000000000000000000000","seq":1,"type":"system.initialized"}
```

`hash` attendu :

```
6d46c2ac7215c5609c4bc96c9e9453e041025608e72e32ef436b573a0b8d0e88
```

### 4.2 Événement 2

```json
{"actor":"u-3f9a","at":"2026-10-26T09:15:42.120Z","id":"5a1e2f90-6b7d-4c3a-8e21-9f0b7c6d5e43","payload":{"lines":[{"lot_id":"l-A12","product_id":"p-amox500","qty":2,"unit_price":1500},{"lot_id":"l-B07","product_id":"p-para500","qty":1,"unit_price":1500}],"sale_id":"s-0001","total":4500},"prev_hash":"6d46c2ac7215c5609c4bc96c9e9453e041025608e72e32ef436b573a0b8d0e88","seq":2,"type":"sale.completed"}
```

`hash` attendu :

```
ae767017e9e28a32b73188bc229a424929093808846548769d567670d0c19c53
```

### 4.3 Point de contrôle sur l'événement 2

Clé de test : la clé privée Ed25519 du vecteur de test 1 de la RFC 8032.

```
clé privée (graine, hex) : 9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60
clé publique (hex)       : d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a
message                  : VPCKPT1|7d2c1c7e-91f4-4d0b-8f3a-2a6b5f0c9e01|2|ae767017e9e28a32b73188bc229a424929093808846548769d567670d0c19c53
signature (base64url)    : eJl5AhBwsWpq1c_03hZcI9CKllizLvSNPaNGHAX22GpJrE_h-m2CNxAE5PsGiBCzzVYJkbAUF-I1s2FjS37pAw
```

Ed25519 est déterministe : la signature doit être identique.

### 4.4 Implémentation de référence de la forme canonique

Suffisante pour les données du projet (objets, tableaux, chaînes, entiers, booléens, `null`) :

```ts
export function jcs(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(jcs).join(',') + ']';
  const o = v as Record<string, unknown>;
  return '{' + Object.keys(o).sort().map(k => JSON.stringify(k) + ':' + jcs(o[k])).join(',') + '}';
}
```

Les clés `undefined` sont interdites dans les contenus (un test doit le vérifier), et aucun nombre à virgule n'est utilisé.
