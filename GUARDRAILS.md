# GUARDRAILS.md — règles non négociables

Ces règles s'appliquent à toute personne et à tout agent IA qui modifie le projet. Elles sont peu nombreuses exprès. Tout ce qui n'est pas interdit ici est permis : décidez, notez votre hypothèse dans la demande de fusion, et avancez.

## 1. Sûreté du patient

1. Ne jamais permettre la vente d'un lot **rappelé** ou **périmé**.
2. Ne jamais permettre la délivrance d'un produit soumis à ordonnance **sans ordonnance validée par un pharmacien**.
3. Aucune fonction ne **diagnostique**, ne **prescrit** ou ne donne de **conseil médical**.
4. Les tests de ces trois règles ne sont jamais désactivés, ignorés ou affaiblis.

## 2. Intégrité des données

5. `events`, `stock_movements` et `checkpoints` sont en **ajout seul**. Ne jamais ajouter d'`UPDATE` ou de `DELETE` sur ces tables, ni retirer leurs déclencheurs.
6. Toute écriture métier se fait dans **une transaction** qui modifie les tables **et** ajoute l'événement du journal.
7. Ne jamais modifier une **migration déjà publiée** : en écrire une nouvelle.
8. Ne jamais changer le calcul des empreintes, le format des points de contrôle ou le format des sauvegardes sans **ADR** validée par un humain. Les vecteurs de test de l'annexe C doivent toujours passer.
9. Montants en entiers XAF ; jamais de nombres à virgule pour de l'argent.

## 3. Sécurité

10. Aucun secret, aucune clé, aucun mot de passe dans le code, les tests, les journaux ou le dépôt.
11. Cryptographie : seulement `node:crypto` et les primitives de `docs/06-architecture-securite.md`. Pas d'algorithme maison, pas de `Math.random` pour quoi que ce soit de sensible.
12. Pas d'affaiblissement : ne pas baisser les paramètres scrypt, ne pas désactiver TLS, CSRF, les en-têtes de sécurité ou la limitation de débit (sauf dans `test/`, via la configuration de test).
13. Toute route a une **permission** de la matrice ; le contrôle se fait **côté serveur**. Ne jamais faire confiance à un rôle envoyé par le client.
14. Requêtes SQL **toujours paramétrées**.
15. Aucune donnée de santé ni aucun secret dans les journaux techniques.
16. Application de bureau : elle ne charge **que** l'origine du serveur appairé, épingle son autorité de certification, n'expose que les trois commandes natives de W-05, et refuse toute mise à jour non signée. Ne jamais activer les plugins Tauri `shell`, `fs` ou `http`, ni désactiver la vérification du certificat ou de la signature.

## 4. Périmètre et réalité

17. **Pas d'émulation en production** : aucun bouchon, faux service ou fausse donnée hors de `test/`. Une fonction pas prête est absente de l'interface.
18. **Aucun appel réseau sortant** et aucune télémétrie dans le MVP. Seule exception (phase B, ADR-012) : la synchronisation du nœud vers l'adresse du cloud configurée par le titulaire, désactivée par défaut, certificat épinglé.
19. Pas de nouvelle dépendance de production sans accord humain (liste autorisée dans `AGENTS.md`).
20. Ne pas construire ce qui n'est pas dans `docs/05-mvp-officine-spec.md` sans demande explicite. Phase B : `docs/10-cloud-spec.md` et ADR-012 ; canaux patient, paiements, Connect, Observatoire et IA restent hors périmètre.

## 5. S'arrêter et demander à un humain

Arrêtez-vous et demandez avant de :
- toucher à une règle des sections 1 à 3 ;
- changer la pile technique ou ajouter une dépendance de production ;
- modifier le schéma d'une manière qui casse les données existantes ;
- faire une action irréversible hors du dépôt (pousser sur la branche principale, publier une image, supprimer des données) ;
- trancher une question réglementaire (ordonnance, produits sensibles, conservation des données).

Pour tout le reste, avancez.

## 5 bis. Mode autonome

Quand l'agent travaille avec `PROMPT-AUTONOME-QODER.md`, personne ne répond aux questions. Dans les cas de la section 5 :
- l'agent ne fait **jamais** l'action irréversible hors du dépôt (pousser sur la branche principale, publier, supprimer des données) ;
- pour le reste, il choisit l'option la plus sûre pour le patient et les données, l'applique, la note dans `docs/QUESTIONS.md` et continue ;
- les règles des sections 1 à 4 ne sont **jamais** assouplies, même pour débloquer le travail.

## 6. En cas de doute

Choisissez l'option la plus sûre pour le patient et pour les données, notez-la sous « Hypothèses » dans la demande de fusion, et continuez.
