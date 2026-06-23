# 🚬 One Million Cigarettes (OMC)

[![Stack](https://img.shields.io/badge/Stack-Vite%20%2B%20React%20%2B%20TS%20%2B%20PWA-blue.svg)](#-technologies)
[![Database-less](https://img.shields.io/badge/Architecture-Database--less-green.svg)](#-architecture--flux-de-données)
[![Hosting](https://img.shields.io/badge/Hosting-Vercel-black.svg)](https://vercel.com)

**One Million Cigarettes** est une Progressive Web App (PWA) collaborative, ultra-rapide et anonyme de capture et de partage de photos en temps réel. 

L'originalité technique majeure du projet réside dans son architecture **"database-less"** (sans base de données traditionnelle) : le stockage global des images et des métadonnées (le feed) est entièrement délégué à un dépôt GitHub public ou privé, mis à jour de manière sécurisée via des fonctions Serverless hébergées sur Vercel.

---

## 📱 Fonctionnalités clés

- ⚡ **Onboarding Anonyme Instantané :** Pas de création de compte. Un pseudo est choisi au premier lancement et sauvegardé dans le `localStorage` (`omc_user_name`).
- 📸 **Capture Photo Instantanée :** Utilisation optimisée de l'appareil photo natif (via l'API HTML5 standard) pour une compatibilité maximale sur iOS et Android.
- 💬 **Flux Commun (Feed) :** Affichage chronologique inverse des clichés partagés par la communauté avec le pseudonyme de l'auteur et la date de prise de vue.
- 📊 **Dashboard de Statistiques :** Visualisation en temps réel d'indicateurs clés :
  - Compteur global de photos.
  - Compteur personnel (filtré localement).
  - Activité temporelle (jour, mois) et moyennes hebdomadaires/mensuelles.
- ⚡ **Expérience Offline & PWA :** Entièrement installable sur smartphone (iOS & Android) grâce à `vite-plugin-pwa`. Le Service Worker gère la mise en cache avec une stratégie *Stale-While-Revalidate* pour un accès instantané hors-connexion.

---

## 🛠 Technologies

L'application repose sur la stack technique suivante :

- **Frontend :**
  - **[Vite](https://vitejs.dev/)** — Outil de build ultra-rapide
  - **[React](https://react.dev/)** (v19) — Bibliothèque UI component-based
  - **[TypeScript](https://www.typescriptlang.org/)** — Typage statique pour un code robuste
  - **[vite-plugin-pwa](https://vite-pwa-org.netlify.app/)** — Configuration automatique du manifest et du Service Worker
  - **[browser-image-compression](https://github.com/Donaldcwl/browser-image-compression)** — Compression d'images côté client avant envoi (WebP/JPEG, ~150-200 Ko)
- **Backend (Serverless) :**
  - **[Vercel Serverless Functions](https://vercel.com/docs/functions/serverless-functions)** (Node.js) — Endpoints d'API sécurisés
  - **[Octokit](https://github.com/octokit/octokit.js)** — Client officiel de l'API GitHub pour committer et pousser les fichiers dans le dépôt

---

## 🏗 Architecture & Flux de Données

Pour éviter d'exposer des jetons secrets tout en s'affranchissant d'une base de données classique, le flux d'une capture se décompose ainsi :

```
[ PWA (Smartphone) ] 
       │ 
       │ 1. Envoi de l'image compressée (Base64) + Nom de l'auteur
       ▼ 
[ Vercel Serverless Function (/api/upload) ]  <--- Contient le GitHub Token (Secret env)
       │ 
       │ 2. Écrit le fichier image dans /public/photos/
       │ 3. Met à jour le fichier metadata data.json (Push/Commit via Octokit)
       ▼
[ Dépôt GitHub ]
       │
       │ 4. Déclenche un Re-déploiement automatique sur Vercel
       ▼
[ Vercel CDN ] (Mise à jour du Feed pour tous les utilisateurs)
```

> [!NOTE]
> Pour gérer les conflits de commits simultanés sur `data.json`, la fonction Serverless intègre une logique de tentative automatique (*Retry Loop*) en cas d'erreur de conflit (Code HTTP 409).

---

## 🚀 Démarrage Rapide

### Prérequis

Assurez-vous d'avoir installé :
- [Node.js](https://nodejs.org/) (version 18 ou supérieure recommandée)
- [npm](https://www.npmjs.com/) ou Yarn / pnpm

### Installation

1. **Cloner le dépôt :**
   ```bash
   git clone https://github.com/votre-compte/one-million-cigarettes.git
   cd one-million-cigarettes
   ```

2. **Installer les dépendances :**
   ```bash
   npm install
   ```

3. **Configurer les variables d'environnement :**
   Créez un fichier `.env` ou `.env.local` à la racine pour le développement local si nécessaire (utilisez `.env.example` s'il existe).

4. **Lancer le serveur de développement :**
   ```bash
   npm run dev
   ```
   L'application sera accessible par défaut à l'adresse [http://localhost:5173](http://localhost:5173).

### Commandes Disponibles

| Commande | Description |
| :--- | :--- |
| `npm run dev` | Lance le serveur de développement local avec HMR. |
| `npm run build` | Compile l'application TypeScript et produit le bundle optimisé pour la production dans `dist/`. |
| `npm run preview` | Lance un serveur local pour prévisualiser le build de production. |
| `npm run lint` | Exécute ESLint pour vérifier la qualité du code. |

---

## 📦 Déploiement

Le projet est conçu pour être déployé sur **Vercel** :
1. Créez un projet sur Vercel lié à votre dépôt GitHub.
2. Ajoutez la variable d'environnement de production :
   - `GITHUB_TOKEN` : Un Personal Access Token (PAT) GitHub ayant l'autorisation d'écrire (`repo`) sur le dépôt ciblé.
3. Déployez !
