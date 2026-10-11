#!/usr/bin/env python3
"""Deterministic PDF quality gate (matches online report_acceptance.py semantics).

Usage: report_acceptance.py <report.pdf>
Checks: file exists, %PDF magic, page count, fonts embedded, optional PNG export for review.
Prints JSON: {pass, checks: [...], pngs: [...]}
"""
import json, os, shutil, subprocess, sys, glob

def check(name, ok, detail=""):
    return {"name": name, "pass": bool(ok), "detail": detail}

def main():
    if len(sys.argv) != 2:
        print(json.dumps({"pass": False, "error": "usage: report_acceptance.py <report.pdf>"}))
        sys.exit(1)
    pdf = os.path.abspath(sys.argv[1])
    checks = []

    checks.append(check("file_exists", os.path.exists(pdf), pdf))
    if not os.path.exists(pdf):
        print(json.dumps({"pass": False, "checks": checks}))
        sys.exit(1)

    with open(pdf, "rb") as f:
        magic = f.read(5)
    checks.append(check("pdf_magic", magic == b"%PDF-", magic.hex()))

    info = subprocess.run(["pdfinfo", pdf], capture_output=True, text=True)
    checks.append(check("pdfinfo_ok", info.returncode == 0, info.stderr[:100]))
    pages = next((l.split(":")[1].strip() for l in info.stdout.splitlines() if l.startswith("Pages")), "0")
    checks.append(check("pages_positive", int(pages) > 0, f"pages={pages}"))

    fonts = subprocess.run(["pdffonts", pdf], capture_output=True, text=True)
    checks.append(check("pdffonts_ok", fonts.returncode == 0, fonts.stderr[:100]))

    # PNG export for page-level self-review
    pngs = []
    pdftoppm = shutil.which("pdftoppm")
    if pdftoppm:
        out_prefix = pdf.replace(".pdf", "-page")
        r = subprocess.run([pdftoppm, "-png", "-r", "100", pdf, out_prefix], capture_output=True, timeout=60)
        pngs = sorted(glob.glob(out_prefix + "*.png"))
        checks.append(check("png_export", len(pngs) == int(pages), f"pngs={len(pngs)}/pages={pages}"))

    overall = all(c["pass"] for c in checks)
    print(json.dumps({"pass": overall, "checks": checks, "pngs": pngs, "pages": int(pages)}))
    sys.exit(0 if overall else 1)

if __name__ == "__main__":
    main()
