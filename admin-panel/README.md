# Mahadev Admin — Separate Standalone Control Center

This `admin-panel/` folder is 100% standalone and independent of AI Studio or any build server. Upload only the files inside this folder directly to your separate GitHub repository and deploy via **GitHub Pages (Deploy from a branch -> `main` -> `/ (root)`)**.

It connects directly to your live shared Firestore database (`ai-studio-accountfunds-5affc735-803b-4d34-8888-f0c9ea1c95f3`) for:
- **Date-wise Customers & Logins** (defaults to Today, step Prev/Next or pick any date)
- **Date-wise ₹999 & ₹199 UTR Metrics** (Accepted, Rejected, and Total Shown per selected date)
- **Cross-Date Global Search** (search username, mobile, UTR, bank, IFSC, or account number across all dates)
- **UTRs & Payout Details** (Verify ₹199 payout UTRs / Approve ₹999 deposits / Reject UTRs / Delete members)

## Files Included for Separate GitHub Publish
- `index.html`
- `admin-style.css`
- `admin-app.js`
- `firebase-applet-config.json`
- `.nojekyll`
- `assets/`
