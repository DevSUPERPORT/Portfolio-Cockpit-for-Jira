# Marketplace package: SUPERPORT Portfolio Cockpit for Jira

Everything needed to list the app. Start with [LISTING.md](LISTING.md).

| File | Use |
|---|---|
| [LISTING.md](LISTING.md) | Listing texts, highlights, gallery captions, pricing proposal, scope justification, portal checklist |
| [DATA_SECURITY_PRIVACY.md](DATA_SECURITY_PRIVACY.md) | Answers for the *Privacy & Security* tab |
| [../READINESS.md](../READINESS.md) | Review readiness: security requirements, platform checks, what is still open |
| `app-logo-144.png` | App logo for the listing (144×144) |
| `app-logo-256.png`, `app-logo-512.png`, `app-logo-1024.png` | The same logo, larger (README, social, print) |
| `banner-1120x548.png` | Listing banner (UPM): app name, partner name, what it does |
| `hero-960x600.png` | Hero image |
| `screenshots/*.png` | 11 screenshots, 1840×900 (3 highlights + gallery) |

Screenshots, hero and banner are generated from the app's built-in demo portfolio (fictional people and projects):
start the local UI (`npm --prefix static/cockpit run dev -- --port 5179`) and run `node scripts/capture-marketplace.mjs`
(or name single shots, e.g. `portfolio banner`). It drives local headless Chrome.

Search for **⟦CONFIRM⟧** (decisions) and **⟦OPEN⟧** (gaps) before submitting.
