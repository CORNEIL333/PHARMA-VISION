<!-- VisionPharma · documentation projet · v3.1 · 2026-10-26 -->

# Annexe A — Glossaire

| Terme | Définition |
|---|---|
| **ADR** | Architecture Decision Record : note courte qui consigne une décision technique (annexe H) |
| **AIPD** | Analyse d'impact relative à la protection des données (annexe G) |
| **ASVS** | Application Security Verification Standard de l'OWASP ; version 5.0 utilisée |
| **Catalogue dormant** | Référentiel préchargé dont les fiches ne deviennent du stock qu'au premier événement réel |
| **CENAME** | Centrale nationale d'approvisionnement en médicaments et consommables médicaux essentiels |
| **CloudEvents** | Spécification de la CNCF pour décrire des événements de façon standard |
| **CSU** | Couverture santé universelle |
| **DCI** | Dénomination commune internationale d'une molécule |
| **DPML** | Direction de la pharmacie, du médicament et des laboratoires (ministère de la Santé publique) |
| **DPO** | Délégué à la protection des données |
| **Événement** | Fait métier immuable inscrit dans le journal (vente, réception, rappel…) |
| **FEFO** | First Expired, First Out : on sort d'abord le lot qui périme le plus tôt |
| **FHIR** | Fast Healthcare Interoperability Resources, standard HL7 d'échange de données de santé |
| **GS1 DataMatrix** | Code-barres 2D qui contient le GTIN, le lot, la péremption et éventuellement un numéro de série |
| **GTIN** | Global Trade Item Number, identifiant GS1 d'un produit |
| **JCS** | JSON Canonicalization Scheme (RFC 8785) : forme unique d'un JSON avant hachage |
| **Journal chaîné** | Suite d'événements où chacun contient l'empreinte du précédent |
| **Journal de transparence** | Registre en arbre de Merkle (RFC 9162) où un tiers peut vérifier qu'aucune entrée n'a été retirée ou modifiée |
| **LANACOME** | Laboratoire national de contrôle de qualité des médicaments et d'expertise |
| **Lot de régularisation** | Lot technique d'un produit, utilisé quand on vend un produit dont le stock n'a pas encore été saisi |
| **MVP / L0** | Premier livrable : VisionPharma Officine autonome |
| **Nœud** | Serveur VisionPharma installé dans une officine |
| **Point de contrôle** | Empreinte d'un état du journal signée par la clé du nœud |
| **Projection** | État calculé à partir des événements (stock par lot, totaux de caisse) |
| **Ré-authentification** | Nouvelle saisie du mot de passe (et du TOTP) avant une action sensible |
| **RPO / RTO** | Perte de données maximale admise / délai de reprise maximal après un incident |
| **SBOM** | Software Bill of Materials : inventaire des composants logiciels |
| **Session de caisse** | Période entre l'ouverture et la clôture d'une caisse, sur un poste |
| **TOTP** | Time-based One-Time Password (RFC 6238) : code à 6 chiffres d'une application d'authentification |
| **XAF** | Code ISO 4217 du franc CFA de la CEMAC |
