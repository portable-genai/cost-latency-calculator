#!/usr/bin/env python3
"""Insert a 'Cost and latency' link section into each catalog repo's README.

Idempotent: skips a repo whose README already links the shared calculator. Inserts
before the '## License' heading when present, else appends. Run after GitHub Pages is
live so the linked URL resolves.
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build import SYSTEMS  # noqa: E402

HOME = os.path.expanduser("~")
PAGES = "https://portable-genai.github.io/cost-latency-calculator/calc/calculator.html"
SHARED = "https://github.com/portable-genai/cost-latency-calculator"
MARK = "cost-latency-calculator/calc/calculator.html"

def section(sid):
    return (
        "## Cost and latency\n\n"
        f"Size this system's cost and latency with the shared interactive calculator: "
        f"[**live**]({PAGES}?system={sid}) or the [in-repo page](cost-latency-calculator.html). "
        f"The engine and the pricing book are maintained once in "
        f"[cost-latency-calculator]({SHARED}).\n"
    )

def main():
    changed = []
    for s in SYSTEMS:
        path = os.path.join(HOME, "git", s["repo"], "README.md")
        if not os.path.isfile(path):
            print("  MISSING README:", s["repo"]); continue
        txt = open(path, encoding="utf-8").read()
        if MARK in txt:
            print("  skip (already linked):", s["repo"]); continue
        sec = section(s["id"])
        if "\n## License" in txt:
            txt = txt.replace("\n## License", "\n" + sec + "\n## License", 1)
        else:
            txt = txt.rstrip() + "\n\n" + sec
        open(path, "w", encoding="utf-8").write(txt)
        changed.append(s["repo"]); print("  linked:", s["repo"])
    print(f"updated {len(changed)} READMEs")

if __name__ == "__main__":
    main()
