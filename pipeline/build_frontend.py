"""Inline frontend/{template.html,styles.css,app.js} + artifacts/model.json + site/data.json
into one self-contained site/index.html (what gets published)."""
import config as C


def main():
    F = C.FRONTEND
    html = (F / "template.html").read_text()
    html = html.replace("/*__STYLES__*/", (F / "styles.css").read_text(encoding="utf-8"))
    html = html.replace("/*__MODEL__*/null", (C.ARTIFACTS / "model.json").read_text(encoding="utf-8"))
    html = html.replace("/*__DATA__*/null", (C.SITE / "data.json").read_text(encoding="utf-8"))
    html = html.replace("/*__APP__*/", (F / "app.js").read_text(encoding="utf-8"))
    (C.SITE / "index.html").write_text(html, encoding="utf-8")
    # Variant for hosts that wrap the page in their own document skeleton (no doctype/html/head/body tags).
    import re
    art = re.sub(r"<!DOCTYPE html>\s*<html[^>]*><head>\s*<meta charset[^>]*>\s*<meta name=\"viewport\"[^>]*>", "", html)
    art = art.replace("</head><body>", "").replace("</body></html>", "")
    art = art.replace("<title>", '<meta name="claude:viewport-fit-sides" content="cover">\n<title>', 1)
    (C.SITE / "artifact.html").write_text(art, encoding="utf-8")
    print(f"wrote {C.SITE / 'index.html'} and artifact.html ({len(art) / 1e6:.2f} MB)")


if __name__ == "__main__":
    main()
