<!-- VisionPharma · documentation projet · v3.1 · 2026-10-26 -->

# Annexe I — Format d'import du catalogue

Fichier CSV, UTF-8 (avec ou sans BOM), séparateur `;`, première ligne = en-têtes, guillemets doubles autour des champs qui contiennent `;`. Les colonnes inconnues sont ignorées et signalées dans le rapport d'import.

| Colonne | Obligatoire | Format | Exemple |
|---|---|---|---|
| `ref_code` | oui | Identifiant stable du référentiel (sert de clé de mise à jour) | `VP-000123` |
| `name` | oui | Texte, 200 caractères au plus | `Amoxicilline 500 mg gélule B/12` |
| `dci` | non | Dénomination commune internationale | `amoxicilline` |
| `strength` | non | Dosage | `500 mg` |
| `form` | non | Forme | `gélule` |
| `presentation` | non | Conditionnement | `boîte de 12` |
| `category` | oui | `medicament`, `dispositif`, `parapharmacie` ou `autre` | `medicament` |
| `rx_required` | non | `0` ou `1` (par défaut : `1` pour un médicament) | `1` |
| `sensitive` | non | `0` ou `1` | `0` |
| `criticity` | non | `1` vital, `2` important, `3` courant (par défaut `3`) | `2` |
| `storage` | non | `ambiant`, `2-8C`, `moins_25C`, `congelé` | `ambiant` |
| `suggested_price` | non | Entier XAF | `1500` |
| `gtin` | non | 8, 12, 13 ou 14 chiffres, clé de contrôle GS1 vérifiée ; plusieurs codes séparés par `|` | `03400000000001` |

## Règles

- Une ligne avec un `ref_code` déjà connu **met à jour** la fiche (sans toucher au stock, au prix de vente de l'officine, ni aux seuils).
- Une ligne invalide est rejetée avec son numéro et sa raison ; elle n'arrête pas l'import.
- Un GTIN dont la clé de contrôle est fausse est rejeté.
- Un GTIN déjà associé à une autre fiche est signalé en conflit et non associé.
- L'import produit l'événement `catalog.imported` avec l'empreinte SHA-256 du fichier.

## Échantillon de démarrage

L'échantillon de 147 présentations (127 médicaments construits à partir de la liste modèle des médicaments essentiels de l'OMS et 20 dispositifs médicaux) est fourni dans l'[annexe I2](I2-catalogue-echantillon.md). L'agent le copie dans `apps/officine/data/catalogue-echantillon.csv`.

**Il ne contient aucun GTIN ni prix** : les codes sont associés au premier scan (exigence C-03) et les prix sont saisis par l'officine. C'est un échantillon de démarrage, pas le catalogue officiel. Le catalogue réel est à obtenir auprès d'un grossiste-répartiteur ou de la DPML, puis à convertir dans ce format.
