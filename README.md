# Mahadev Pannel

Multi-page banking & gaming panel with OTP verification, instant UTR settlement, live commission payouts, and real-time Firebase Firestore admin control.

## GitHub Pages Branch Deployment (No Build or Server Required)

This repository runs directly from the root `/` on GitHub Pages without GitHub Actions or a backend server:
- **Source**: Deploy from a branch
- **Branch**: `main`
- **Folder**: `/ (root)`
- **Static Compatibility**: Uses root `index.html`, relative `./` asset and CSS/JS paths (`./style.css`, `./script.js`, `./src/assets/images/...`), `.nojekyll`, and automatic Firebase CDN ES-module hydration directly in the browser.

### Enable GitHub Pages
1. Open **Settings → Pages** in `Wecare78/mahadev.com`.
2. Under **Build and deployment → Source**, choose **Deploy from a branch**.
3. Select **Branch: `main`** and **Folder: `/ (root)`**, then click **Save**.

## Pages & Entry Points
- **Member Portal (`index.html` & `dashboard.html`)**: Mobile OTP verification, registration/login, IFSC bank auto-lookup, ATM card mandate, ₹599 activation UTR submission, live credit engine, and verified payment receipts.
- **Backend Admin Control (`mahadev-admin.html`, `mahadev-control.html`, `admin.html`)**: Real-time Firestore dashboard, member profile inspector, activity & SMS logs, and live UTR approval/rejection controls.

## Local Development (Optional Full-Stack Server)
```bash
npm install
npm run dev
```
Runs on `http://localhost:3000`.
