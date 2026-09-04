#!/usr/bin/env python3
"""Source of truth for the per-system configs.

  python scripts/build.py systems   # write calc/systems.json
  python scripts/build.py pages      # emit each catalog repo's thin loader page
  python scripts/build.py all        # both

The 16 systems below are the catalog. `flags` drive which inputs appear and which
cost/latency contributions apply (see calc/engine.js). Each repo's thin page loads
the shared engine + prices from jsDelivr and passes its system id.
"""
import json, os, sys

HOME = os.path.expanduser("~")
#: Sibling repositories live beside this one, whatever the checkout is called.
WORKSPACE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CDN = "https://cdn.jsdelivr.net/gh/portable-genai/cost-latency-calculator"
ENGINE_REF = "v1"      # engine + app + styles + systems pinned to a release tag
PRICES_REF = "main"    # prices.json tracks main so refreshes propagate

def S(slug, repo, name, unit, short, tag, flags, defaults):
    # `slug` is the identity: the repository name, plus a scope suffix where one repository
    # carries two costing models. It is the ?system= parameter and the localStorage key.
    return {"slug": slug, "repo": repo, "name": name, "unitLabel": unit, "unitShort": short,
            "tagline": tag, "flags": flags, "defaults": defaults}

SYSTEMS = [
 S("agent-guardrail-gateway","agent-guardrail-gateway","Agent Guardrail Gateway","Guardrail screens","screen",
   "Runtime policy proxy: PII redaction, prompt-injection and jailbreak defense.",
   {"redact":1,"guardrail":1,"generate":1},
   {"volumePerDay":200000,"burst":4,"activeHoursPerWeek":120,"model":"gemini-3.1-flash-lite","tokensIn":800,"tokensOut":5}),
 S("enterprise-knowledge-base","enterprise-knowledge-base","Enterprise Knowledge Base","KB searches","search",
   "ACL-aware governed RAG, the shared knowledge base.",
   {"redact":1,"guardrail":1,"retrieval":1,"generate":1},
   {"volumePerDay":50000,"burst":3,"activeHoursPerWeek":90,"model":"gemini-3.5-flash","tokensIn":1500,"tokensOut":400,"retrievalQueries":1}),
 S("agent-registry","agent-registry","Agent Registry & Governance","Registry ops","op",
   "Agent registry, identity, scoped entitlements, discovery.",
   {"dbOnly":1},
   {"volumePerDay":100000,"burst":4,"activeHoursPerWeek":120}),
 S("model-quality-gate","model-quality-gate","AI Quality & Model-Risk","Eval runs","run",
   "Eval and red-team promotion gate, model cards, MRM evidence.",
   {"generate":1,"evalRun":1,"retrieval":1},
   {"volumePerDay":200,"burst":2,"activeHoursPerWeek":60,"model":"gemini-3.5-flash","tokensIn":2000,"tokensOut":300,"examplesPerRun":50,"metrics":4,"retrievalQueries":1}),
 S("agent-observability","agent-observability","Observability, Audit & FinOps","Audited events","event",
   "OpenTelemetry tracing, token FinOps, immutable WORM audit.",
   {"ingestHeavy":1,"bigQuery":1},
   {"volumePerDay":5000000,"burst":5,"activeHoursPerWeek":168,"bytesPerEvent":3000}),
 S("cdd-sow-research","cdd-sow-research","CDD + Source of Wealth Agent","CDD cases","case",
   "KYC, registries and adverse media into a cited CDD dossier.",
   {"redact":1,"guardrail":1,"docAI":1,"retrieval":1,"grounding":1,"generate":1,"thinking":1,"multiStep":1,"complianceCheck":1},
   {"volumePerDay":500,"burst":3,"activeHoursPerWeek":50,"model":"gemini-3.5-flash","tokensIn":6000,"tokensOut":1800,"thinkingTokens":1500,"docPages":30,"retrievalQueries":4,"groundingCalls":2,"agents":4,"iterations":3}),
 S("credit-memo-drafting","credit-memo-drafting","Credit-Memo / Underwriting Assistant","Credit memos","memo",
   "Financials and filings into a cited credit memo.",
   {"redact":1,"guardrail":1,"docAI":1,"retrieval":1,"generate":1,"thinking":1,"bigQuery":1},
   {"volumePerDay":300,"burst":3,"activeHoursPerWeek":50,"model":"gemini-3.5-flash","tokensIn":8000,"tokensOut":2000,"thinkingTokens":1500,"docPages":40,"retrievalQueries":3}),
 S("cio-advisory","cio-advisory","Personalised CIO Advisory Assistant","Advisory briefings","briefing",
   "Suitability-checked RM talking points (decision-support, not advice).",
   {"redact":1,"guardrail":1,"retrieval":1,"generate":1,"thinking":1,"bigQuery":1},
   {"volumePerDay":1000,"burst":3,"activeHoursPerWeek":55,"model":"gemini-3.5-flash","tokensIn":4000,"tokensOut":1200,"thinkingTokens":1000,"retrievalQueries":3}),
 S("trade-finance-checker","trade-finance-checker","Trade-Finance Document Checker (UCP600)","LC presentations","presentation",
   "Letter-of-credit discrepancy detection against UCP600.",
   {"redact":1,"guardrail":1,"docAI":1,"retrieval":1,"generate":1},
   {"volumePerDay":400,"burst":3,"activeHoursPerWeek":55,"model":"gemini-3.5-flash","tokensIn":5000,"tokensOut":1000,"docPages":12,"retrievalQueries":2}),
 S("loan-document-intelligence","loan-document-intelligence","Loan / Mortgage Document Intelligence","Loan applications","application",
   "Income and bank-statement extraction with deterministic cross-validation.",
   {"redact":1,"guardrail":1,"docAI":1,"generate":1},
   {"volumePerDay":800,"burst":3,"activeHoursPerWeek":55,"model":"gemini-3.5-flash","tokensIn":4000,"tokensOut":800,"docPages":15}),
 S("complaints-review","complaints-review","Complaints & Conduct File Review","Complaint files","file",
   "Summarise, categorise and draft regulator-ready responses.",
   {"redact":1,"guardrail":1,"docAI":1,"retrieval":1,"generate":1},
   {"volumePerDay":600,"burst":3,"activeHoursPerWeek":50,"model":"gemini-3.5-flash","tokensIn":5000,"tokensOut":1500,"docPages":10,"retrievalQueries":3}),
 S("compliance-advisory","compliance-advisory","Compliance Assistant","Compliance questions","question",
   "Grounded Q&A over MAS / HKMA / APRA / FSA guidance.",
   {"redact":1,"guardrail":1,"retrieval":1,"grounding":1,"generate":1,"thinking":1},
   {"volumePerDay":2000,"burst":3,"activeHoursPerWeek":55,"model":"gemini-3.5-flash","tokensIn":4000,"tokensOut":1200,"thinkingTokens":1500,"retrievalQueries":4,"groundingCalls":1}),
 S("compliance-advisory-control-mapping","compliance-advisory","Cloud Control-Mapping Toolkit","Evidence packs","pack",
   "Map GCP controls to each regulator requirement, evidence pack.",
   {"retrieval":1,"generate":1,"thinking":1,"complianceCheck":1,"assetInventory":1},
   {"volumePerDay":50,"burst":2,"activeHoursPerWeek":45,"model":"gemini-3.5-flash","tokensIn":6000,"tokensOut":2500,"thinkingTokens":1500,"retrievalQueries":3}),
 S("architecture-validator","architecture-validator","Architecture & Requirements Validator","Project validations","validation",
   "Policy-as-code intake gate for the twelve General Principles.",
   {"retrieval":1,"generate":1,"thinking":1,"complianceCheck":1},
   {"volumePerDay":100,"burst":2,"activeHoursPerWeek":45,"model":"gemini-3.5-flash","tokensIn":5000,"tokensOut":2000,"thinkingTokens":1500,"retrievalQueries":3}),
 S("architecture-validator-residency","architecture-validator","Data Residency / Sovereignty Validator","IaC scans","scan",
   "Scan IaC for region and residency violations (CI gate).",
   {"generate":1,"cloudBuild":1},
   {"volumePerDay":500,"burst":3,"activeHoursPerWeek":90,"model":"gemini-3.1-flash-lite","tokensIn":1500,"tokensOut":500}),
 S("operational-resilience-mapping-exit-planning","operational-resilience-mapping","Exit & Portability Planner","Exit plans","plan",
   "Concentration-risk and exit plan (APRA CPS 230, MAS and HKMA outsourcing).",
   {"retrieval":1,"generate":1,"thinking":1,"complianceCheck":1,"assetInventory":1},
   {"volumePerDay":20,"burst":2,"activeHoursPerWeek":45,"model":"gemini-3-pro","tokensIn":8000,"tokensOut":3000,"thinkingTokens":2000,"retrievalQueries":3}),
]

PAGE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>%(name)s - cost & latency calculator</title>
<script>(function(){try{var t=localStorage.getItem('calc-theme')||(matchMedia('(prefers-color-scheme: light)').matches?'light':'dark');document.documentElement.setAttribute('data-theme',t);}catch(e){}})();</script>
<script>
  // Shared engine + pricing live once, in github.com/portable-genai/cost-latency-calculator.
  // engine/app/styles/systems are pinned to the %(eref)s release; prices.json tracks %(pref)s so refreshes propagate.
  window.CALC_SYSTEM = '%(id)s';
  window.CALC_BASE = '%(cdn)s';
  window.CALC_REF = '%(eref)s';
  window.CALC_PRICES_REF = '%(pref)s';
</script>
<link rel="stylesheet" href="%(cdn)s@%(eref)s/calc/styles.css">
</head>
<body>
<div id="calc-root" style="padding:24px;font:15px system-ui;color:#888">Loading the cost &amp; latency calculator (from the shared engine)...</div>
<script src="%(cdn)s@%(eref)s/calc/engine.js"></script>
<script src="%(cdn)s@%(eref)s/calc/app.js"></script>
</body>
</html>
"""

def write_systems():
    out = os.path.join(HERE, "calc", "systems.json")
    with open(out, "w") as fh:
        json.dump(SYSTEMS, fh, indent=1)
    print("wrote", out, "(%d systems)" % len(SYSTEMS))

def emit_pages():
    n = 0
    for s in SYSTEMS:
        # A repository with two costing models gets one page, for the model named after it.
        if s["slug"] != s["repo"]:
            continue
        repo_dir = os.path.join(WORKSPACE, s["repo"])
        if not os.path.isdir(repo_dir):
            print("  MISSING repo:", s["repo"]); continue
        html = PAGE % {"name": s["name"], "id": s["slug"], "cdn": CDN, "eref": ENGINE_REF, "pref": PRICES_REF}
        with open(os.path.join(repo_dir, "cost-latency-calculator.html"), "w") as fh:
            fh.write(html)
        n += 1; print("  page ->", s["repo"])
    print("emitted %d thin pages" % n)

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "all"
    if cmd in ("systems", "all"): write_systems()
    if cmd in ("pages", "all"): emit_pages()
