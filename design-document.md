Voici un document de conception technique complet, structuré et professionnel pour votre projet. Vous pouvez l'utiliser comme cahier des charges ou base de référence pour le développement.
# 📄 Document de Conception Technique (Architecture & Spécifications)
**Nom du Projet :** One Million Cigarettes (OMC)
**Type d'Application :** Progressive Web App (PWA)
**Architecture :** Jamstack / Serverless (Architecture sans Base de Données)
**Hébergement :** Vercel
## 1. Résumé du Projet
**One Million Cigarettes** est une application web mobile (PWA) collaborative et ultra-rapide. L'objectif est de permettre à n'importe quel utilisateur, de manière totalement anonyme (sans création de compte), de capturer instantanément une photo à l'ouverture de l'application.
L'originalité technique réside dans son architecture *databass-less* (sans base de données traditionnelle) : le stockage global des médias et des métadonnées est entièrement délégué à un dépôt GitHub public ou privé, mis à jour de manière sécurisée via des fonctions Serverless hébergées sur Vercel.
## 2. Parcours Utilisateur & Spécifications Fonctionnelles
### 2.1. Premier Lancement (Onboarding)
 * L'application vérifie si une clé omc_user_name existe dans le localStorage.
 * Si elle est absente, un écran épuré demande à l'utilisateur de saisir son nom ou un pseudonyme.
 * Le nom est sauvegardé localement. L'utilisateur n'aura plus jamais à se connecter.
### 2.2. Écran Principal : L'Appareil Photo (Instantané)
 * Dès l'ouverture, l'application sollicite l'accès à l'appareil photo arrière.
 * L'interface affiche le flux vidéo en plein écran avec un bouton de capture central.
 * Une fois le cliché pris, un aperçu rapide s'affiche avec un bouton **"Valider et Ajouter"**.
### 2.3. Le Feed (Flux Commun)
 * Un onglet ou défilement permet d'accéder au flux de toutes les photos prises par la communauté.
 * Les photos sont affichées de la plus récente à la plus ancienne.
 * Chaque élément affiche : l'image, le nom de l'auteur (récupéré via les métadonnées globales) et la date/heure de capture.
### 2.4. Le Dashboard de Statistiques
Un écran analytique calcule en temps réel des indicateurs basés sur le fichier global des métadonnées :
 * **Compteur Global :** Nombre total de photos sur l'application (tous utilisateurs confondus).
 * **Compteur Personnel :** Nombre de photos prises par l'utilisateur actif (filtré via son nom du localStorage).
 * **Analyse Temporelle :** Photos du jour, photos du mois en cours.
 * **Moyennes :** Moyenne de photos par semaine et par mois.
## 3. Architecture Technique & Flux de Données
Pour contourner l'absence de base de données sans exposer les clés secrètes de l'application, le flux de données est scindé en deux parties.
### Schema du flux d'une capture (Upload)
```
[ PWA (Smartphone) ] 
       │ 
       │ 1. Envoie l'image compressée (Base64) + Nom du LocalStorage
       ▼ 
[ Vercel Serverless Function (/api/upload) ]  <--- Contient le GitHub Token (Secret)
       │ 
       │ 2. Écrit le fichier image dans /public/photos/
       │ 3. Met à jour le fichier data.json (Push/Commit via Octokit)
       ▼
[ Dépôt GitHub ]
       │
       │ 4. Déclenche un Re-deploiement automatique (Optionnel) 
       ▼
[ Vercel CDN ] (Mise à jour du Feed pour tous les utilisateurs)
```
### 3.1. Structure du stockage GitHub (data.json)
Les métadonnées du feed et du dashboard sont centralisées dans un unique fichier JSON plat structuré comme suit :
```json
[
  {
    "id": "1682347200000_julien",
    "timestamp": 1682347200000,
    "date": "2026-06-23T12:00:00.000Z",
    "author": "Julien",
    "imageUrl": "/photos/1682347200000_julien.jpg"
  }
]
```
## 4. Spécifications Techniques & Contraintes
### 4.1. Le Frontend (PWA)
 * **Framework :** Vite.js + React.js (ou Svelte pour un bundle ultra-léger).
 * **PWA Capability :** Utilisation de vite-plugin-pwa pour configurer le manifest.json et un *Service Worker* en mode StaleWhileRevalidate. L'application doit être installable sur iOS (via le menu Partager > Sur l'écran d'accueil) et Android.
 * **Gestion Caméra :** Utilisation de l'API HTML5 standard :
   ```html
   <input type="file" accept="image/*" capture="environment" />
   
   ```
```
  *Note : C'est la méthode la plus stable sur iOS pour forcer l'ouverture de l'appareil photo natif sans gérer les problèmes complexes de permissions de flux vidéo dans Safari.*
### 4.2. Le Backend (Vercel Serverless)
* **Sécurité :** Un jeton d'accès GitHub (Personal Access Token - PAT) avec les droits `repo` est stocké dans les variables d'environnement de Vercel (`process.env.GITHUB_TOKEN`). Il n'est jamais exposé au client.
* **Optimisation des Images (Crucial) :** Pour éviter de saturer le dépôt GitHub (limite conseillée de 1 Go à 5 Go), les images doivent être compressées en JavaScript côté client (par exemple avec `browser-image-compression`) au format WebP ou JPEG, avec une résolution maximale de 1080px, avant l'envoi. Un poids cible de **150 Ko à 200 Ko par photo** est requis.
### 4.3. Gestion de la Concurrence (Conflits de Commits)
Si deux utilisateurs soumettent une photo en même temps, le fichier `data.json` entrera en conflit. 
* **Solution :** La fonction Serverless implémentera une boucle de tentative (*Retry Logic*). Si l'API GitHub renvoie une erreur de conflit (409 Conflict), la fonction récupère la version la plus récente du `data.json`, ré-applique la modification, et retente le commit (jusqu'à 3 essais).
---
## 5. Matrice des Risques & Solutions

| Risque | Impact | Solution |
| :--- | :--- | :--- |
| **Soudaine popularité / Poids du dépôt** | Élevé | Limiter drastiquement la taille des images côté client. Si le projet explose, la fonction Serverless pourra être redirigée vers un CDN gratuit comme Cloudflare Images sans changer le front. |
| **Temps de rafraîchissement du Feed** | Moyen | Comme Vercel reconstruit le site à chaque commit sur GitHub, il peut y avoir un léger décalage (quelques secondes) avant que le flux soit visible par les autres. *Solution : Ajouter la photo instantanément dans le feed local de l'utilisateur pour une sensation d'immédiateté.* |
| **Abus / Spam de photos inappropriées** | Élevé | Puisqu'il n'y a pas de compte, implémenter une validation simple côté Serverless (ex: maximum 5 uploads par minute par IP) et ajouter un système de signalement. |

---
## 6. Prochaines Étapes du Développement (Feuille de route)
1. **Phase 1 :** Initialisation du dépôt GitHub et configuration du projet Vite + PWA.
2. **Phase 2 :** Création de l'interface de capture et stockage du nom dans le `localStorage`.
3. **Phase 3 :** Code de la fonction Serverless Vercel (`/api/upload`) et connexion réussie avec l'API GitHub (Octokit).
4. **Phase 4 :** Développement des algorithmes du Dashboard de statistiques à partir du fichier JSON.
5. **Phase 5 :** Recette (Tests intensifs sur iOS et Android pour l'installation PWA).
```