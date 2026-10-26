# Prompt ChatGPT — pitch deck investisseurs VisionPharma

**Mode d'emploi**
1. Ouvrir ChatGPT avec un modèle qui sait générer des images et exécuter du code (pour fabriquer le fichier .pptx).
2. Coller le prompt ci-dessous en entier, dans un seul message.
3. ChatGPT travaille en 4 étapes et s'arrête après chacune. Répondre « continue » pour passer à la suivante. Les images sont générées par lots de 4 : un seul message ne peut pas toutes les produire.
4. À la fin, télécharger le fichier `VisionPharma_Pitch.pptx`, l'ouvrir dans PowerPoint et remplacer les champs entre crochets (équipe, contact).

---

```text
Tu es à la fois un directeur artistique de présentations (niveau keynote Apple / TED), un analyste en capital-risque spécialisé en santé en Afrique, et un rédacteur scientifique habitué aux dossiers MIT Solve. Tu vas créer le pitch deck investisseurs de VisionPharma : au moins 22 diapositives, en français, au format PowerPoint 16:9 (.pptx), avec une image générée ou un schéma spectaculaire sur CHAQUE diapositive.

# 1. Le projet (source unique : n'invente aucun fait en dehors de cette section)

VisionPharma est une plateforme numérique de traçabilité et d'accès aux médicaments, née d'un projet tutoré universitaire au Cameroun.
- Cœur du produit : un gestionnaire de pharmacie multi-poste qui fonctionne SANS Internet (serveur local dans l'officine, application de bureau sur chaque caisse). Il trace chaque boîte par lot et date de péremption, bloque en caisse la vente d'un lot rappelé ou périmé, exige une ordonnance validée par un pharmacien pour les produits concernés, et inscrit chaque opération dans un journal infalsifiable (chaîne d'empreintes SHA-256 et signatures Ed25519, le principe d'une blockchain, sans cryptomonnaie ni coût par transaction).
- Catalogue dormant : chaque officine reçoit à l'installation des dizaines de milliers de références qui s'activent à la première vente ou réception.
- Demande non satisfaite : quand un médicament critique est souvent introuvable, le système alerte les pharmacies et fournisseurs selon le niveau de criticité.
- Ensuite, le cloud : synchronisation des officines, rappels de lots diffusés en quelques minutes à tout le réseau, stock consolidé du pays, registre de transparence vérifiable par un tiers (régulateur, Ordre des pharmaciens), back-office.
- Plus tard : application patient, WhatsApp et USSD (trouver le médicament dans la pharmacie la plus proche, réserver), portail entreprise pour les ONG, l'État, les assureurs et les livreurs, Observatoire des ruptures et des prix, IA (lecture d'ordonnances, prévision des ruptures).
- Normes visées : OWASP ASVS 5.0, ISO/IEC 27001, HL7 FHIR R4, GS1 DataMatrix, WCAG 2.2, loi camerounaise n° 2024/017 sur les données personnelles.
- Avancement réel (à dire tel quel) : documentation complète et cahier des charges aux normes internationales ; le socle du gestionnaire est codé et testé (166 tests automatisés : journal infalsifiable, authentification à double facteur, droits par rôle) ; le reste est en construction ; objectif : un pilote dans 10 officines à Yaoundé.
- Modèle économique : le patient ne paie jamais. Revenus : abonnement des officines (version de base gratuite), commission des grossistes sur les commandes électroniques, tiers payant (assureurs, mutuelles, Couverture santé universelle), gestion de programmes pour les ONG, frais de livraison, ordonnances électroniques, abonnements aux données agrégées de l'Observatoire.
- Concurrents et références : mPharma (Ghana, Afrique de l'Ouest et de l'Est), Maisha Meds (Afrique de l'Est), Zipline (livraison par drone), Waspito, UrPharm et ACRAMED (Cameroun, localisation de pharmacies ou téléconsultation, pas de logiciel de caisse). Modèles venus des pays développés : Dossier Pharmaceutique (France), système européen de vérification des médicaments (2019), GoodRx (États-Unis).
- Positionnement : aucun acteur camerounais identifié ne fournit le logiciel de caisse des officines ; c'est la porte d'entrée de VisionPharma.

# 2. Chiffres autorisés (utilise-les avec leur source en petit en bas de la diapositive ; n'en invente AUCUN autre)

Situation mondiale et africaine :
- Environ 1 produit médical sur 10 est sous-standard ou falsifié dans les pays à revenu faible et intermédiaire (OMS, 2017).
- 42 % des signalements reçus par l'OMS viennent d'Afrique subsaharienne (OMS, 2017).
- Jusqu'à 267 000 décès par an en Afrique subsaharienne liés aux antipaludiques falsifiés ou sous-standard (ONUDC, 2023).
- Jusqu'à 169 271 décès d'enfants par an liés aux antibiotiques falsifiés ou sous-standard contre la pneumonie (ONUDC, 2023).
- L'ONUDC souligne que des produits illicites finissent dans des pharmacies agréées.
Cameroun :
- Un peu plus de 25 % du marché passe par les « médicaments de la rue », dont 40 % issus de la contrebande (Ordre national des pharmaciens du Cameroun).
- Près de 3 milliards FCFA de faux médicaments détruits en 2021, 206 saisies (ministère de la Santé publique).
- Plus de 90 % des médicaments sont importés ; marché de plus de 125 milliards FCFA, dont environ 8 milliards pour les producteurs locaux (Financial Afrik, 2023).
- Impayés de la centrale publique d'achat CENAME fin 2021 : 14,6 milliards FCFA, livraisons étrangères suspendues (EcoMatin).
- Couverture santé universelle : 318 milliards FCFA mobilisés en 3 ans, résultats jugés mitigés (EcoMatin, 2026).
- Plan stratégique national de santé numérique 2026-2030, lancé le 4 mars 2026, budget de 29 milliards FCFA.
- Loi n° 2024/017 sur les données personnelles en vigueur depuis le 23 juin 2026.
- Ordonnance obligatoire pour toute délivrance depuis juillet 2024.
- Environ 95 % de la population a un téléphone, 40 % un smartphone (estimation ancienne, Stop TB Partnership).
Économie de VisionPharma (HYPOTHÈSES DE TRAVAIL, à présenter comme telles) :
- Parc estimé : environ 650 officines au Cameroun (à confirmer auprès de l'Ordre).
- Scénario à 3 ans : 200 officines équipées (30 % du parc) → environ 200 M FCFA de revenus par an (≈ 300 000 €) : abonnements 60 M (25 000 FCFA par mois et par officine), commissions grossistes 43 M (0,5 % sur 30 % des achats), programmes ONG 45 M, données de l'Observatoire 30 M, tiers payant 20 M.
- Coûts : environ 137 M FCFA par an (équipe de 10 à Yaoundé, hébergement, terrain, juridique, marketing). Seuil de rentabilité : environ 150 officines.
- Impact du même scénario : environ 11 millions de passages patients par an dans des pharmacies traçables (200 × 150 clients par jour) ; environ 1,6 milliard FCFA économisés par an par les patients si 10 % acceptent un générique qui leur fait gagner 1 500 FCFA ; rappels de lots bloqués en caisse en quelques minutes ; moins de pertes par péremption.
- Coût du pilote (10 officines) : environ 6,5 M FCFA (≈ 10 000 €).
- Revenu moyen par officine dans le scénario : environ 1 M FCFA par an.
Projections d'expansion (SPÉCULATIVES : chaque chiffre affiché avec la mention « projection illustrative, pas une prévision » et sa formule) :
- Calcule-les toi-même uniquement avec la formule « nombre d'officines × 1 M FCFA par an » pour 3 paliers : Cameroun 200 officines ; Cameroun + CEMAC 1 000 officines ; Afrique francophone 3 000 officines. Montre aussi le montant en euros (1 € = 655,957 FCFA). Ne donne pas de nombre d'officines par pays : tu ne l'as pas.
- Présente 3 scénarios (prudent, central, ambitieux) sous forme de graphique, avec les hypothèses écrites sous le graphique.
Règles sur les chiffres : les décès cités concernent l'Afrique subsaharienne, pas le seul Cameroun ; dis-le. Ne dis jamais « VisionPharma sauvera X vies » : dis « s'attaque à un problème qui tue jusqu'à … par an » ou « peut contribuer à réduire ». Un investisseur vérifie chaque chiffre : un seul chiffre inventé détruit la crédibilité du dossier.

# 3. Ton et récit

Style « MIT » : rigueur scientifique, sobriété, données d'abord, puis l'émotion. Récit en 5 actes :
1. Le choc (une mère, un médicament, une boîte dont personne ne sait d'où elle vient).
2. Le système invisible (pourquoi personne ne voit rien : pas de traçabilité, pas de données, la rue).
3. La solution (VisionPharma, d'abord dans l'officine, puis le réseau).
4. La preuve et le marché (technologie, normes, modèle économique, scénarios).
5. L'appel (ce que nous demandons, ce que l'investisseur obtient, le jalon suivant).
Phrases courtes. Un titre-affirmation par diapositive (le titre dit la conclusion, pas le sujet : « 1 médicament sur 10 est faux ou défectueux », pas « Contexte »). Au plus 25 mots de texte visible par diapositive hors chiffres et sources ; le reste dans les notes de l'orateur.

# 4. Direction artistique

- Palette : fond bleu nuit #0B1320 ; accent principal vert médical lumineux #19D3A2 ; accent d'alerte rouge corail #FF5A5F, réservé au danger (mort, faux, rupture) ; texte #F5F7FA ; gris secondaire #8A94A6. Diapositives « solution » plus claires et lumineuses que les diapositives « problème » : le spectateur doit sentir le passage de l'ombre à la lumière.
- Typographie : titres en Inter ou Montserrat Bold, très grands (40 à 54 pt) ; chiffres héros en 96 pt et plus ; texte en Inter Regular 18 à 24 pt. Pas plus de 2 polices.
- Mise en page : grille à 12 colonnes, marges généreuses, alignements stricts, beaucoup de vide. Pas de puces en cascade, pas de clip-art, pas de dégradés criards, pas d'ombres portées lourdes.
- Images générées : style photographique cinématographique ou rendu 3D réaliste, lumière dramatique et douce, profondeur de champ, palette fidèle à celle ci-dessus, cohérence d'une image à l'autre (même grain, même lumière). Personnes : Africains et Africaines, contexte camerounais crédible (Yaoundé, Douala, marché, officine, dispensaire rural), dignes, jamais misérabilistes.
- Interdits dans les images : aucun texte ni chiffre dans l'image (le texte est ajouté par-dessus dans PowerPoint), aucun logo réel (ni MIT, ni OMS, ni marque de médicament, ni opérateur), aucune personne réelle identifiable, aucun cadavre, sang ni scène choquante : la mort se suggère (chaise vide, lit d'hôpital vide, boîte posée à côté d'une photo de famille floue). Chaque image est une illustration ; ne la présente jamais comme une photo réelle d'un événement.
- Schémas et graphiques : construis-les en natif dans PowerPoint (formes et graphiques modifiables) ou en image vectorielle propre, avec la même palette ; sur fond sombre, les lignes et les chiffres doivent rester lisibles. Chaque graphique a un titre qui dit la conclusion et une source.
- Animation : propose dans les notes de l'orateur la transition conseillée (Morph de préférence entre diapositives qui se suivent) et l'ordre d'apparition des éléments.

# 5. Plan imposé (au moins 22 diapositives ; tu peux en ajouter si le récit l'exige)

1. Titre — « VisionPharma : chaque boîte de médicament a une histoire. Nous la rendons vérifiable. » Image : une boîte de médicament suspendue dans la pénombre, traversée par un fin réseau lumineux vert.
2. Le choc — « Jusqu'à 267 000 morts par an. » (antipaludiques falsifiés ou sous-standard, Afrique subsaharienne, ONUDC 2023). Image : chambre d'enfant au crépuscule, moustiquaire, lit vide.
3. Les enfants — « Jusqu'à 169 271 enfants par an. » (antibiotiques contre la pneumonie, ONUDC 2023). Image : deux mains, celle d'un parent et celle d'un enfant, autour d'une boîte sans marquage.
4. L'ampleur — « 1 médicament sur 10 est faux ou défectueux. » Infographie : 10 boîtes, une en rouge corail ; 42 % des signalements à l'OMS viennent d'Afrique subsaharienne.
5. Le Cameroun — « Plus d'un quart des médicaments passent par la rue. » Image : étal de marché de médicaments au soleil, plaquettes vrac, ambiance réaliste. Chiffres : 25 %, dont 40 % de contrebande ; 3 milliards FCFA de faux détruits en 2021.
6. Le trou noir — « Personne ne sait où se trouve un lot dangereux. » Schéma : chaîne fabricant → importateur → grossiste → officine → patient, avec les maillons non tracés en pointillés rouges et un point d'interrogation à chaque étape.
7. La dépendance — « 90 % importés, 125 milliards FCFA, une centrale publique à 14,6 milliards d'impayés. » Graphique : barre importé contre local (≈ 8 Md FCFA) ; carte stylisée des flux d'importation vers Douala.
8. Pourquoi les solutions actuelles échouent — tableau visuel : registres papier, Excel, logiciels sans traçabilité par lot, aucune connexion Internet fiable, aucune donnée nationale des ruptures.
9. Pourquoi maintenant — frise : ordonnance obligatoire (juillet 2024), plan de santé numérique 2026-2030 (29 milliards FCFA), loi sur les données personnelles (juin 2026), CSU (318 milliards FCFA en 3 ans), 95 % de téléphones.
10. La solution en une phrase — « La traçabilité de l'Europe, pensée pour une officine sans Internet. » Image : officine camerounaise moderne et lumineuse, pharmacienne souriante, écran de caisse élégant.
11. Comment ça marche dans l'officine — schéma : serveur local + 3 caisses, scan GS1 → lot → contrôle (rappelé ? périmé ? ordonnance ?) → vente ou blocage, en vert et rouge.
12. Le moment qui sauve — « Un lot rappelé ne peut plus être vendu. » Mise en scène : écran de caisse avec une alerte rouge élégante, la main du pharmacien qui s'arrête.
13. Le journal infalsifiable — « La rigueur d'une blockchain, sans son coût. » Schéma : blocs chaînés (empreinte précédente → empreinte), points de contrôle signés, vérification par un tiers ; comparaison sobre avec une blockchain publique (coût, données de santé exposées, dépendance réseau).
14. Le catalogue dormant et la demande non satisfaite — schéma : des milliers de références en veille qui s'allument à la première vente ; carte de chaleur des médicaments critiques introuvables qui déclenche des alertes.
15. Du point au réseau — carte du Cameroun stylisée (sans frontières précises inventées) : 10 officines pilotes à Yaoundé, puis un maillage lumineux, rappels diffusés à tout le réseau en quelques minutes.
16. L'écosystème — schéma en orbite autour de la plateforme : officines, patients (app, WhatsApp, USSD), grossistes, État et régulateur, ONG, assureurs, livreurs, Observatoire.
17. Les normes — « Construit aux standards internationaux dès le premier jour. » Mur de badges sobres en texte (pas de logos) : OWASP ASVS 5.0, ISO 27001, FHIR R4, GS1, WCAG 2.2, loi 2024/017.
18. Ce qui existe déjà — « Pas une idée : un produit en construction. » Captures stylisées ou mockups : architecture, cahier des charges, 166 tests automatisés verts, plan en 14 jours vers le pilote.
19. Le modèle économique — « Le patient ne paie jamais. » Schéma des 7 sources de revenus, avec le moment où chacune démarre (pilote, phase 1, phase 2, phase 3).
20. Les chiffres du scénario à 3 ans — graphique en cascade : revenus 200 M FCFA (détail par source), coûts 137 M, marge ; seuil de rentabilité à 150 officines. Mention « hypothèses de travail ».
21. L'impact — 4 chiffres héros : 11 millions de passages patients traçables par an ; 1,6 milliard FCFA économisés par les patients ; rappels bloqués en minutes ; moins de pertes par péremption. Image : file d'attente apaisée devant une officine au matin.
22. La vision économique — « Et si chaque pharmacie d'Afrique francophone était traçable ? » Graphique des 3 paliers (200, 1 000, 3 000 officines × 1 M FCFA) et des 3 scénarios, avec la mention « projection illustrative, pas une prévision » bien visible et les hypothèses en dessous.
23. La concurrence — matrice 2 × 2 : axe « fonctionne sans Internet » × axe « traçabilité par lot et rappels » ; mPharma, Maisha Meds, UrPharm, ACRAMED, Waspito placés honnêtement ; VisionPharma dans le quadrant libre ; une phrase sur ce qui nous distingue et une sur la menace réelle (mPharma avance en Afrique francophone).
24. Les risques et nos réponses — tableau visuel : adoption par les pharmaciens (pilote co-conçu, base gratuite, indicateur unique : 70 % des ventes saisies chaque jour) ; marché camerounais étroit (CEMAC) ; concurrence ; réglementation (DPO, analyse d'impact, validation de l'Ordre et de la DPML).
25. La feuille de route — frise lumineuse : pilote 10 officines (mois 0-6, jalon 70 % des ventes saisies) → réseau 50-100 officines (mois 6-12) → plateforme et partenaires → CEMAC.
26. L'équipe — [À COMPLÉTER : noms, rôles, parcours] ; laisse des cadres photo vides élégants, n'invente aucune personne.
27. L'appel — « Ce que nous demandons » : financement du pilote (≈ 6,5 M FCFA / 10 000 €), partenaires (officines pilotes, grossiste, ONG paludisme), accompagnement ; ce que l'investisseur obtient (premier entrant sur le logiciel de caisse traçable, données de rupture uniques, impact mesurable). Image finale : lever de soleil sur Yaoundé, réseau lumineux vert qui relie les toits.
28. Contact — [nom, e-mail, téléphone, site] et la phrase de clôture : « Rendre chaque médicament vérifiable, pour que plus personne ne meure d'une boîte dont on ne connaissait pas l'histoire. »
Annexe (après la diapositive 28, facultatif) : sources complètes, hypothèses détaillées du modèle, glossaire.

# 6. Notes de l'orateur

Pour chaque diapositive : 60 à 120 mots à dire à l'oral, en français parlé, avec un enchaînement vers la diapositive suivante, la transition conseillée et la source complète des chiffres affichés.

# 7. Méthode de travail (respecte ces étapes et arrête-toi après chacune)

Étape 1 — Storyboard : un tableau avec, pour chaque diapositive : numéro, titre-affirmation, texte visible, visuel prévu (image générée, schéma ou graphique), prompt de génération d'image en anglais (détaillé : sujet, cadrage, lumière, palette, style, « no text, no logos »), source des chiffres. Vérifie que chaque chiffre vient de la section 2. Arrête-toi et attends « continue ».
Étape 2 — Images : génère les images par lots de 4 diapositives, au format 16:9, cohérentes entre elles. Après chaque lot, arrête-toi et attends « continue ». Si une image contient du texte, un logo ou une personne identifiable, régénère-la.
Étape 3 — Fichier PowerPoint : avec python-pptx, construis VisionPharma_Pitch.pptx en 16:9 (13,333 × 7,5 pouces). Images en plein cadre ou en demi-cadre avec un voile sombre pour la lisibilité du texte ; schémas et graphiques en formes et graphiques natifs modifiables ; titres, chiffres et sources en zones de texte modifiables ; notes de l'orateur remplies ; numéros de diapositive discrets. Respecte la palette et les tailles de police de la section 4. Donne-moi le lien de téléchargement.
Étape 4 — Contrôle qualité : relis toi-même le fichier et donne-moi une liste courte : diapositives où le texte déborde ou est illisible, chiffres sans source, images à régénérer, puis corrige-les et redonne le fichier.

Commence par l'étape 1.
```

---

## À vérifier avant de présenter

- Les chiffres viennent de la documentation du projet, avec leurs sources (annexe F). Ils datent de 2017 à 2026 : un investisseur peut demander la source exacte, il faut l'avoir sous la main.
- Les montants économiques sont des **hypothèses de travail**. Les projections d'expansion sont des **illustrations**. Le prompt oblige ChatGPT à l'écrire sur les diapositives : ne pas retirer ces mentions.
- La diapositive « équipe » et la diapositive « contact » sont à compléter à la main.
- Aucun logo du MIT ni d'une autre institution ne doit apparaître : « type MIT » désigne seulement le style.
