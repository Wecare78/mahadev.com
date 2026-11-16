# Mahadev Pannel — Separate Admin Control Center

This folder is a completely standalone, self-contained Admin Panel designed to be published to its own separate GitHub Pages repository using **Deploy from a branch**, while staying live-connected to the exact same Firestore database (`ai-studio-accountfunds-5affc735-803b-4d34-8888-f0c9ea1c95f3`) as your main Mahadev Pannel website.

## How to Publish Separately on GitHub Pages

1. Create a new GitHub repository (for example, `Wecare78/mahadev-admin`).
2. Upload all files inside this `admin-panel/` folder (`index.html`, `admin-style.css`, `admin-app.js`, `firebase-applet-config.json`, `.nojekyll`, and `assets/`) directly into the `/` (root) of your new repository on the `main` branch.
3. Open **Settings -> Pages** on the new repository and select:
   - **Source**: Deploy from a branch
   - **Branch**: `main`
   - **Folder**: `/ (root)`
4. Your separate Admin Panel URL (e.g. `https://wecare78.github.io/mahadev-admin/`) will sync all registrations, logins, linked bank accounts, UPI QR codes, ATM card details, ₹999 / ₹199 UTR submissions, audit logs, and SMS broadcasts from Mahadev Pannel in real time without needing any server or build step.
