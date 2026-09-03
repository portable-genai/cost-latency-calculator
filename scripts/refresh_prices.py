#!/usr/bin/env python3
"""Validate (and optionally refresh) calc/prices.json.

Run by hand. Nothing schedules it: the GitHub Actions cron that used to is gone, because
Actions were disabled organization-wide at the time and the workflow had never run. GitHub
Actions has been the fleet's live CI since 2026-09-02, but this cron has not been re-added. It:

  1. loads and structurally validates prices.json (fails CI on a malformed book), then
  2. if a live source is configured, refreshes the rates and stamps the dates.

There is no universally machine-readable GCP/Gemini list-price feed, so by default
this performs validation only and leaves the file unchanged (no commit churn). Wire a
real source into `fetch_live_prices()` (for example the Cloud Billing Catalog API,
https://cloud.google.com/billing/v1/how-tos/catalog-api, behind a GCP_BILLING_API_KEY
secret) to make the scheduled run update and commit prices. The workflow commits only
when the file actually changes.
"""
from __future__ import annotations
import datetime as dt
import json
import os
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PRICES = os.path.join(HERE, "calc", "prices.json")

REQUIRED_MODEL_KEYS = {"label", "inP", "outP", "dec", "ttft"}
REQUIRED_SERVICE_KEYS = {
    "docPageOcr", "docPageLayout", "docComplexShare", "docMsPerPage",
    "searchPerQuery", "searchMs", "groundPerCall", "groundMs",
    "dlpPerGB", "dlpMs", "armorPerCall", "armorMs",
    "logBytesPerTok", "logIngestGB", "logRetainMo", "logRetainGBmo",
    "instHr", "concPerInst", "dbNodeMo", "dbQpsNode", "dbMs",
    "ciPerMin", "ciMinScan", "assetPerCall", "complianceCall", "complianceMs",
    "bqPerReq", "ackMs",
}
REQUIRED_CONST_KEYS = {"DAYS", "TOKEN_BYTES", "HOURS", "VALIDATOR_MS", "EVAL_PARALLEL"}


def validate(p: dict) -> list[str]:
    errs: list[str] = []
    if not p.get("models"):
        errs.append("models is empty")
    for name, m in (p.get("models") or {}).items():
        missing = REQUIRED_MODEL_KEYS - set(m)
        if missing:
            errs.append(f"model {name} missing {sorted(missing)}")
        for k in ("inP", "outP", "dec", "ttft"):
            if k in m and not isinstance(m[k], (int, float)):
                errs.append(f"model {name}.{k} must be numeric")
    svc = p.get("services") or {}
    missing = REQUIRED_SERVICE_KEYS - set(svc)
    if missing:
        errs.append(f"services missing {sorted(missing)}")
    for k, v in svc.items():
        if not isinstance(v, (int, float)):
            errs.append(f"services.{k} must be numeric")
    missing = REQUIRED_CONST_KEYS - set(p.get("constants") or {})
    if missing:
        errs.append(f"constants missing {sorted(missing)}")
    return errs


def fetch_live_prices() -> dict | None:
    """Return a partial price book to merge, or None if no source is configured.

    Wire a real source here (e.g. the Cloud Billing Catalog API) and return a dict
    shaped like prices.json. Returning None means validation-only (no change)."""
    if not os.environ.get("GCP_BILLING_API_KEY"):
        return None
    # Placeholder for a real Billing Catalog integration. Intentionally a no-op
    # until SKU-to-rate mapping is implemented; returning None keeps the run green.
    print("GCP_BILLING_API_KEY is set but no SKU mapping is implemented; skipping live refresh.")
    return None


def deep_merge(dst: dict, src: dict) -> bool:
    changed = False
    for k, v in src.items():
        if isinstance(v, dict) and isinstance(dst.get(k), dict):
            changed = deep_merge(dst[k], v) or changed
        elif dst.get(k) != v:
            dst[k] = v
            changed = True
    return changed


def main() -> int:
    with open(PRICES, encoding="utf-8") as fh:
        p = json.load(fh)
    errs = validate(p)
    if errs:
        print("prices.json INVALID:")
        for e in errs:
            print("  -", e)
        return 1
    print(f"prices.json valid: {len(p['models'])} models, {len(p['services'])} service rates "
          f"(verified {p.get('verified')}).")

    live = fetch_live_prices()
    if live:
        changed = deep_merge(p, live)
        today = dt.date.today().isoformat()
        p["checked"] = today
        if changed:
            p["verified"] = today
            with open(PRICES, "w", encoding="utf-8") as fh:
                json.dump(p, fh, indent=2)
                fh.write("\n")
            print("prices refreshed from live source and rewritten.")
        else:
            print("live source returned no changes; file unchanged.")
    else:
        print("no live price source configured; validation only, file unchanged.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
