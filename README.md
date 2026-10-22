# FreeTier Radar

A searchable index of AI providers that give away API access — recurring free tiers,
zero-cost model routes, one-off trial credits, and runtimes you host yourself.

No build step. No dependencies. No backend. One JSON file drives everything.

![status](https://img.shields.io/badge/providers-25-5ef2a8) ![license](https://img.shields.io/badge/license-MIT-blue)

---

## What this is

Most "free API key" lists are link dumps that go stale within weeks, or worse, they
circulate leaked credentials. This project takes the opposite approach:

- **It indexes offers, not keys.** Every entry links to the provider's own signup page.
  You register yourself and bring your own key.
- **It records the actual numbers.** Rate limits, daily caps and reset behaviour are
  transcribed from official documentation, with a `verified` date and a `confidence`
  level on every entry.
- **It distinguishes free from nearly-free.** A recurring allowance is not the same
  as $5 of credits that expire in 30 days, and the UI treats them differently.

There is no scraping of third-party credentials, no key pooling, and no proxying.

## Features

| Feature | Detail |
| --- | --- |
| Instant search | Ranked matching across provider name, vendor, models, capabilities and notes. Press `/` to focus. |
| Four access classes | Always free · Free models · Trial credits · Local |
| Attribute filters | OpenAI-compatible, no credit card, saved providers |
| Two views | Card grid for browsing, dense table for comparing quotas side by side |
| Detail panel | Full limits, model list, copy-ready cURL / Python / Node snippets, provider notes |
| Key tester | Paste **your own** key to verify it against the provider's `/models` endpoint from your browser |
| CSV export | Downloads the current filtered result set |
| Deep links | `#groq` opens a provider directly; `?view=table` opens the comparison table |
| Theme | Dark by default, light available, both respect `prefers-reduced-motion` |

## Run it locally

The dataset is fetched over HTTP, so opening `index.html` from the filesystem will not
work. Serve the folder:

```bash
python -m http.server 8080
# then open http://localhost:8080
```

Any static server works — `npx serve`, `caddy file-server`, nginx, or GitHub Pages.

## Deploy to GitHub Pages

This is a static site with no build step, so Pages serves the repository root directly.

1. Push the repository to GitHub.
2. Go to **Settings → Pages → Build and deployment**.
3. Set **Source** to *Deploy from a branch*, branch `main`, folder `/ (root)`.
4. Save. The site is published at `https://<user>.github.io/<repo>/` within about a minute.

Every push to `main` redeploys automatically. No CI, no build artefacts, no secrets.

## Dataset schema

`data/providers.json` is the single source of truth. Each entry:

```jsonc
{
  "id": "groq",                       // stable slug, used in deep links
  "name": "Groq",
  "vendor": "Groq, Inc.",
  "kind": "inference",                // inference | gateway | lab | cloud | local
  "access": "always-free",            // always-free | free-models | trial-credits | local
  "summary": "One or two sentences on what it is and why it matters.",
  "models": ["openai/gpt-oss-120b"],  // representative, not exhaustive
  "limits": {
    "rpm": 30, "rpd": 1000,           // omit any figure you cannot verify
    "tpm": 8000, "tpd": 200000,
    "text": "Caveats numbers alone cannot express."  // reset windows, credit thresholds
  },
  "openaiCompatible": true,
  "apiBase": "https://api.groq.com/openai/v1",
  "creditCard": false,
  "regions": "Global",
  "tags": ["low-latency", "open-models"],
  "signup": "https://console.groq.com/keys",
  "docs": "https://console.groq.com/docs/rate-limits",
  "pricing": "https://groq.com/pricing",
  "notes": "The practical gotcha, in one or two sentences.",
  "verified": "2026-10-22",
  "confidence": "high"                // high | medium | low
}
```

### On confidence levels

- **high** — the figure was read directly off the provider's current documentation.
- **medium** — the tier is documented, but specific numbers vary by model, plan or region.
- **low** — the offer exists but terms shift often; treat the entry as a lead, not a fact.

Where a number could not be verified, the field is omitted rather than guessed. The UI
then falls back to the prose note instead of inventing precision.

## Contributing

Corrections are the most valuable contribution. If a limit changed:

1. Edit the relevant object in `data/providers.json`.
2. Update its `verified` date and adjust `confidence`.
3. Open a pull request with a link to the page that shows the new figure.

Guidelines: one entry per provider, no affiliate or referral links, and no entries whose
"free" access depends on credentials you did not obtain yourself.

## Project layout

```
index.html              markup and templates
assets/styles.css       design system, dark and light themes
assets/app.js           search, filtering, panel, key tester (vanilla ES modules)
data/providers.json     the dataset
```

## Licence

MIT — see [LICENSE](LICENSE).

FreeTier Radar is an independent directory. It is not affiliated with any listed
provider, and it does not host, resell or distribute API credentials.
