<!-- VisionPharma · documentation projet · v1.0 · 2026-10-28 -->

# Dossier d'installation de l'officine — données à fournir au gestionnaire

Ce document résume la recherche sur le cadre des officines au Cameroun (MINSANTE, DPML, Ordre national des pharmaciens, fiscalité, protection des données) et en déduit les données qu'une officine fournit à l'installation de VisionPharma Officine. Il décrit l'écran qui les collecte.

**Statut juridique de ce document :** synthèse de sources publiques, pas un avis juridique. Les points marqués *à confirmer* doivent être validés par l'ONPC, la DPML ou un conseil fiscal avant le pilote. Le texte intégral de la loi n° 90/035 n'a pas pu être lu : le PDF de l'OMS est un scan de plus de 10 Mo et la copie de l'ONUDC renvoie une erreur 403. Les numéros d'articles ne sont donc pas cités.

## 1. Ce que dit le cadre (résumé)

| Domaine | Constat | Conséquence pour le gestionnaire |
|---|---|---|
| Exercice de la profession | Loi n° 90/035 du 10 août 1990 relative à l'exercice et à l'organisation de la profession de pharmacien. Le décret n° 92/261/PM fixe l'inscription au tableau de l'Ordre et les autorisations d'exercice en clientèle privée. La vente de médicaments est réservée aux pharmaciens. Le titulaire est seul propriétaire d'une seule officine. | Le titulaire, son numéro d'inscription à l'Ordre (ONPC) et ceux des pharmaciens assistants sont des données obligatoires du dossier. |
| Ouverture | L'ouverture est autorisée par un acte signé du Ministre de la Santé publique (dossier instruit par la DPML). Le dossier comprend : demande timbrée, patente et carte de contribuable valides, attestation et plan de localisation, relevé d'identité bancaire, ainsi que des justificatifs du pharmacien (diplôme, casier judiciaire, nationalité, expérience). | Numéro et date de l'acte d'autorisation, autorité signataire, référence de l'attestation de localisation. Le RIB et les pièces personnelles du pharmacien **ne sont pas** collectés : le logiciel n'en a pas besoin (minimisation). |
| Ordonnances (2024) | Résolutions des Ordres de santé du 13 juin 2024, en vigueur à partir du 1er juillet 2024. Pas de médicament sans ordonnance d'un praticien inscrit à son Ordre. L'ordonnance porte l'en-tête de la formation sanitaire, le cachet nominatif et le numéro d'inscription. Les ordonnanciers sont paraphés. | Déjà couvert par O-01 à O-06 (politique `all_medicines` par défaut). Le dossier n'ajoute rien ici. |
| Garde | Le tour de garde est organisé localement (Ordre, délégations régionales de la santé). *Organisation exacte à confirmer.* | Secteur ou zone de garde de l'officine, en plus des périodes déclarées (G-01). |
| Carte sanitaire | 10 régions et environ 205 districts de santé. | Région (liste fermée), département, arrondissement, district et aire de santé, coordonnées GPS facultatives. |
| Fiscalité | Les médicaments (positions tarifaires 30.03 et 30.04) sont exonérés de TVA. La parapharmacie est soumise à la TVA à 19,25 %, ce qui fait de l'officine un assujetti partiel. Le NIU du fournisseur doit figurer sur les factures. Les prix des médicaments sont homologués par le Ministère. | NIU, RCCM, régime d'imposition, centre des impôts, assujettissement à la TVA. Le NIU et le RCCM sont imprimés sur le ticket. **Écart repéré :** le ticket ne détaille pas encore la TVA de la parapharmacie (voir §5). |
| Social | Toute officine employeur est immatriculée à la CNPS. | Numéro employeur CNPS (facultatif). |
| Approvisionnement | Les grossistes-répartiteurs privés (dont Laborex Cameroun et Ubipharm Cameroun) approvisionnent environ 1 950 structures. Le circuit public passe par la CENAME, les FRPS (3 régions) et les CAPR (7 régions). | Liste des grossistes habituels, créée en un clic dans l'écran (fournisseurs R-01). |
| Tiers payant | Assureurs, mutuelles et employeurs conventionnés. | Organismes conventionnés : nom, type, code, référence de convention, taux de prise en charge. Ils sont proposés au paiement `tiers_payant` (V-03). |
| Données personnelles | Loi n° 2024/017 du 23 décembre 2024, applicable depuis le **23 juin 2026**. Autorisation préalable de l'Autorité de protection des données (APDP) pour les traitements. Exigences particulières pour les établissements de santé. Délégué à la protection des données (DPO). Encadrement strict des transferts hors du Cameroun. | Responsable des traitements, DPO désigné ou non, numéro et date de l'autorisation APDP. Le journal ne reçoit jamais les valeurs saisies (§4). |

## 2. Données collectées (rubriques)

`*` = obligatoire pour que la rubrique soit « complète ». Validation côté serveur : `server/src/domain/profile.ts`.

| Rubrique | Champs |
|---|---|
| Identité | enseigne*, raison sociale, forme juridique* (entreprise individuelle, SARL, SELARL, autre — *formes admises à confirmer*), date d'ouverture |
| Autorisation d'ouverture | numéro de l'acte*, date*, autorité signataire*, référence de l'attestation de localisation |
| Pharmacien titulaire | nom*, numéro ONPC*, section du tableau, date d'inscription, téléphone, courriel |
| Localisation | région* (10), département*, arrondissement*, ville*, quartier*, repère, boîte postale, district de santé*, aire de santé, latitude et longitude (contrôlées dans les limites du Cameroun) |
| Contacts | téléphone* (format camerounais à 9 chiffres), mobile, WhatsApp, courriel |
| Fiscalité et administration | NIU* (10 à 20 caractères alphanumériques — *format exact à confirmer avec la DGI*), RCCM, régime d'imposition*, centre des impôts*, assujetti à la TVA, numéro CNPS |
| Horaires et garde | horaires par jour (au moins un jour ouvert), secteur du tour de garde |
| Personnel | nom, fonction, numéro ONPC (obligatoire pour un pharmacien assistant) |
| Protection des données | responsable des traitements*, contact*, DPO désigné, numéro et date de l'autorisation APDP |
| Organismes de tiers payant | table `payers` (hors calcul d'avancement) |
| Grossistes habituels | fournisseurs (R-01), raccourcis : Laborex Cameroun, Ubipharm Cameroun, CENAME, FRPS/CAPR |

Volontairement **non collectés** : RIB, acte de naissance, casier judiciaire, diplôme, nationalité. Ces pièces servent à l'administration pour autoriser l'ouverture ; le logiciel n'en a pas besoin. L'écran les rappelle seulement dans la liste « Pièces à avoir sous la main ».

## 3. Écran « Dossier de l'officine »

- Route `/dossier`, réservée au titulaire (`settings.edit`, ré-authentification de moins de 5 minutes).
- Colonne de gauche : les rubriques avec leur état (complète ou à compléter). Au centre : le formulaire. À droite : la liste des pièces à préparer.
- Tant que le dossier est incomplet, un bandeau « Dossier de l'officine incomplet (n/9) » s'affiche sur tous les écrans du titulaire, avec un lien « Compléter ». L'avancement vient de `GET /profile/status`, qui ne renvoie aucune donnée.
- L'enseigne, l'adresse (quartier, repère, ville) et le téléphone alimentent le ticket (V-06). Le NIU et le RCCM y sont ajoutés.
- Les organismes de tiers payant sont proposés dans le champ « Organisme » du paiement.

## 4. API et journal

| Route | Permission | Rôle |
|---|---|---|
| `GET /profile/status` | toute session | Avancement par rubrique, sans données |
| `GET /profile` | Paramètres (R) | Contenu du dossier |
| `PUT /profile/:section` | Paramètres (R) | Enregistre une rubrique (validation complète, champ inconnu refusé) |
| `GET /payers` | Vendre | Organismes actifs (`?all=true` : tous) |
| `POST /payers` · `PUT /payers/:id` | Paramètres (R) | Création, modification, désactivation |

Événements : `system.profile_updated` (rubrique, **noms** des champs modifiés, SHA-256 du contenu), `payer.created`, `payer.updated`. Le journal est en ajout seul : y écrire le nom ou le téléphone du titulaire rendrait impossible l'exercice du droit d'effacement. Seule l'empreinte est donc conservée. Migration : `008_profile.sql`. Tests : `server/test/profile.test.ts`, e2e `Dossier de l'officine`.

## 5. Écarts et suites proposées (non construits)

1. **TVA de la parapharmacie sur le ticket** : les catégories `parapharmacie`, `dispositif` et `autre` devraient faire apparaître la TVA à 19,25 % (prix TTC, base et montant). Cela change le calcul des ventes et des rapports : décision et validation fiscale nécessaires avant de le construire.
2. **Prix homologués** : si le Ministère publie un barème, l'import du référentiel (I-04) pourrait refuser un prix de vente supérieur au prix homologué. À confirmer.
3. **Ordonnancier** : vérifier avec l'ONPC si le registre P-06 imprimé remplace l'ordonnancier paraphé ou s'il le complète.
4. **Rapports à l'administration** (DHIS2, pharmacovigilance) : hors MVP ; le district de santé saisi ici les rendra possibles.

## Sources

- [Loi n° 90/035 du 10 août 1990 (OMS, base de législation sanitaire)](https://extranet.who.int/cpcd/health-legislation/loi-ndeg90-035-du-10-aout-1990-relative-lexercice-et-lorganisation-de-la) · [Décret n° 92/261/PM](https://extranet.who.int/cpcd/health-legislation/decret-92-261-pm-fixant-les-modalites-dapplication-de-certaines-dispositions-de)
- [Dossier d'ouverture d'officine MINSANTE/DPML (Scribd)](https://www.scribd.com/document/522642095/Dossier-Ouverture-officine-de-pharmacie-MINSANTE-DPML-Cameroun) · [Ouvrir une pharmacie au Cameroun](https://www.creerentreprise.fr/ouvrir-une-pharmacie-au-cameroun/)
- [Ordonnance obligatoire dès le 1er juillet 2024 (camer.be)](https://www.camer.be/85576/11:1/cameroun-obligatoire-des-le-1er-juillet-de-presenter-en-pharmacie-une-ordonnance-signee-dun-medecin-agree-cameroon.html) · [Résolutions des Ordres de santé, juin 2024](https://www.camer.be/85671/11:1/cameroun-sante-les-medicaments-desormais-prescrits-et-delivres-en-officine-de-pharmacie-par-ordonnance-cameroon.html) · [Cameroon Tribune — Ordre des pharmaciens](https://cameroon-tribune.cm/article.html/76257/fr.html/details_2)
- [Loi n° 2024/017 — analyse (CIO Mag)](https://cio-mag.com/?p=59861) · [Entrée en vigueur au 23 juin 2026](https://droitmediasfinance.com/index.php/actualites/droit-tech-fintech/1297-cameroun-la-loi-sur-la-protection-des-donnees-a-caractere-personnel-entre-en-vigueur-ce-23-juin-2026)
- [Fiscalité de l'officine : TVA, prorata (Lefisk)](https://lefisk.cm/blog/comptabilite-pharmacie-officine-cameroun-tva-medicaments-parapharmacie-stock-prorata) · [Fiche TVA (DGI)](https://impots.cm/sites/default/files/documents/FICHE%20TVA.pdf) · [Circulaire LF 2012 (NIU sur factures)](https://yaounde.eregulations.org/media/Circulaire_LF_2012_d%C3%A9finitive.pdf)
- [Circuit d'approvisionnement : CENAME, FRPS, CAPR, grossistes (DG Trésor)](https://www.tresor.economie.gouv.fr/Articles/8e8dac66-d1b2-4db6-b8f9-f22d38d9ca03/files/5b51e7aa-a8bc-43d0-8881-be065b322813) · [Laborex Cameroun](https://maligah.com/entreprises/details/Laborex-Cameroun-(Direction-G%C3%A9n%C3%A9rale)?id=150943)
- [Régions du Cameroun](https://en.wikipedia.org/wiki/Subdivisions_of_Cameroon)
