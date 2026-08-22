# GenAI cost & latency calculator

**Industries:** All GenAI (cross-industry)

A version-controlled **cost and latency model** for GenAI / agentic systems on Google
Cloud: token-priced cost, decode-rate latency plus TTFT, classify-blended Document AI,
per-query Agent Search, bytes-per-token WORM logging, Little's-law serving concurrency and
damped ReAct fan-out. The engine is **domain-agnostic**, point it at any GenAI workload.

It ships with the 16-system
[GRC GenAI reference catalog](https://github.com/portable-genai) as worked examples: each of
those repositories references this one engine rather than copying it, so the calculation and
the pricing live here once and a price change is made in one place.

**Live app:** https://portable-genai.github.io/cost-latency-calculator/ (choose a system with `?system=ID`, e.g. `?system=Doc1`).

## What is here

```
calc/
  engine.js        compute model (pure, no DOM): computeAll(system, inputs, prices)
  app.js           DOM layer + bootstrap (fetch data, build inputs, render, switch systems)
  styles.css       styling (light / dark)
  prices.json      the one pricing book (models + service rates + constants)   <- edit this
  systems.json     the 16 per-system configs (generated from scripts/build.py)
  calculator.html  the hosted app: open it, pick a system with ?system=ID
scripts/
  build.py         source of truth for the 16 system configs; writes systems.json and
                   emits each catalog repo's thin loader page
  refresh_prices.py validates (and optionally refreshes) prices.json
  test.cjs         runs every system through the engine and checks the invariants
.github/workflows/refresh-prices.yaml  validates on push; on a schedule refreshes + commits prices
```

## How the catalog repos use it

Each catalog repo ships a tiny `cost-latency-calculator.html` that loads this engine from
jsDelivr and passes its own system id:

```html
<script>
  window.CALC_SYSTEM = 'Doc1';
  window.CALC_BASE = 'https://cdn.jsdelivr.net/gh/portable-genai/cost-latency-calculator';
  window.CALC_REF = 'v1';          // engine + app + styles + systems pinned to a release tag
  window.CALC_PRICES_REF = 'main'; // prices.json tracks main so refreshes propagate
</script>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/portable-genai/cost-latency-calculator@v1/calc/styles.css">
<div id="calc-root"></div>
<script src="https://cdn.jsdelivr.net/gh/portable-genai/cost-latency-calculator@v1/calc/engine.js"></script>
<script src="https://cdn.jsdelivr.net/gh/portable-genai/cost-latency-calculator@v1/calc/app.js"></script>
```

The **engine and configs are pinned to the `v1` tag** (stable); **`prices.json` is loaded
from `main`** so a committed price update reaches all 16 repos on the next load (the refresh
workflow purges the jsDelivr cache so it propagates within minutes). Regenerate all 16 thin
pages after changing a system: `python scripts/build.py pages`.

## Updating prices

Prices are illustrative GCP / Gemini list prices for sizing, **not a quote**. Edit
`calc/prices.json` (one place), commit, and every repo reflects it. The
`refresh-prices` workflow validates the book on every push and, on a monthly schedule,
runs `scripts/refresh_prices.py` to refresh and commit it; wire a live source (for example
the Cloud Billing Catalog API) into `fetch_live_prices()` to automate the rates.

## The model

30.4-day months; average QPS spreads daily volume across the active window, peak applies the
burst; GenAI cost is token-priced with a damped ReAct fan-out for agentic teams; latency is
TTFT + output / decode-rate plus the critical-path stages; Document AI is a classify-first
blend; Agent Search bills per query; Cloud Logging is bytes-per-token WORM; serving uses
Little's law. The method follows the system-design reference tool; see the "Assumptions and
method" panel in the app. Validate locally with `node scripts/test.cjs`.

## License

Apache-2.0. Independent reference build, not affiliated with, endorsed by, or sponsored by
Google LLC. Product names are trademarks of their owners, used descriptively.
