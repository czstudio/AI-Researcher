#!/usr/bin/env python3
"""Export a LaTeX source to PDF using tectonic (matches online export_pdf.py semantics).

Usage: export_pdf.py <input.tex> <output.pdf>
Prints a JSON result: {ok, engine, pdf, log, pages}
"""
import json, os, shutil, subprocess, sys

def main():
    if len(sys.argv) != 3:
        print(json.dumps({"ok": False, "error": "usage: export_pdf.py <input.tex> <output.pdf>"}))
        sys.exit(1)
    src, dst = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
    if not os.path.exists(src):
        print(json.dumps({"ok": False, "error": f"source not found: {src}"}))
        sys.exit(1)

    tectonic = shutil.which("tectonic")
    if not tectonic:
        print(json.dumps({"ok": False, "error": "tectonic not found; brew install tectonic"}))
        sys.exit(1)

    r = subprocess.run([tectonic, "-o", os.path.dirname(dst), src],
                       capture_output=True, text=True, timeout=300)
    pdf_out = src.replace(".tex", ".pdf")
    if os.path.exists(src.replace(".tex", ".pdf")):
        # tectonic outputs alongside source; move to dst if different
        if pdf_out != dst:
            shutil.move(pdf_out, dst)

    if os.path.exists(dst):
        info = subprocess.run(["pdfinfo", dst], capture_output=True, text=True)
        pages = next((l.split(":")[1].strip() for l in info.stdout.splitlines() if l.startswith("Pages")), "?")
        print(json.dumps({"ok": True, "engine": "tectonic", "pdf": dst, "pages": int(pages) if pages != "?" else pages, "log": r.stderr[-500:]}))
    else:
        print(json.dumps({"ok": False, "engine": "tectonic", "error": r.stderr[-500:], "log": r.stdout[-500:]}))
        sys.exit(1)

if __name__ == "__main__":
    main()
