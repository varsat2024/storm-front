"""Patch site/index.html Assistant tab + JS from frontend/ (when full rebuild is unavailable)."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "site" / "index.html"
TEMPLATE = ROOT / "frontend" / "template.html"
APP = ROOT / "frontend" / "app.js"
STYLES = ROOT / "frontend" / "styles.css"


def main():
    html = INDEX.read_text(encoding="utf-8")
    styles = STYLES.read_text(encoding="utf-8")
    app = APP.read_text(encoding="utf-8")

    m_ast = re.search(r'(<section id="t_ast" hidden>.*?</section>)', TEMPLATE.read_text(encoding="utf-8"), re.S)
    if not m_ast:
        raise SystemExit("t_ast section not found in template.html")
    new_ast = m_ast.group(1)
    html, n_ast = re.subn(r'<section id="t_ast" hidden>.*?</section>', new_ast, html, count=1, flags=re.S)
    if not n_ast:
        raise SystemExit("t_ast section not found in index.html")

    html = re.sub(r"<style>.*?</style>", f"<style>{styles}</style>", html, count=1, flags=re.S)

    tabs_new = re.search(r'const TABS = (\[\[.*?\]\]);', app, re.S)
    if tabs_new:
        html, _ = re.subn(r"const TABS = (\[\[.*?\]\]);", f"const TABS = {tabs_new.group(1)};", html, count=1, flags=re.S)

    ast_js = re.search(
        r"// ---------------------------------------------------------------- Assistant.*?(\nshowTab\(\"over\"\))",
        app,
        re.S,
    )
    if not ast_js:
        raise SystemExit("Assistant block not found in app.js")
    replacement = ast_js.group(0).rsplit("\nshowTab", 1)[0]
    html, n_js = re.subn(
        r"// ---------------------------------------------------------------- Assistant[\s\S]*?(?=\nshowTab\(\"over\"\))",
        replacement,
        html,
        count=1,
    )
    if not n_js:
        raise SystemExit("Assistant block not found in index.html")

    INDEX.write_text(html, encoding="utf-8")
    print(f"Patched {INDEX} (assistant section + styles + JS)")


if __name__ == "__main__":
    main()
