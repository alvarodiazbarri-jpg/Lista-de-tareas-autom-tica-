#!/usr/bin/env python3
"""Genera dist/dilo-demo.html: una sola página con todo incrustado, para verla como demo."""
import pathlib, re
root = pathlib.Path(__file__).parent
html = (root / 'index.html').read_text()
body = re.search(r'<body>(.*)</body>', html, re.S).group(1)
body = re.sub(r'<script src="js/parser.js[^"]*"></script>', lambda m: '<script>window.DILO_DEMO = true;\n' + (root / 'js/parser.js').read_text() + '</script>', body)
body = re.sub(r'<script src="js/citas.js[^"]*"></script>', lambda m: '<script>' + (root / 'js/citas.js').read_text() + '</script>', body)
body = re.sub(r'<script src="js/app.js[^"]*"></script>', lambda m: '<script>' + (root / 'js/app.js').read_text() + '</script>', body)
out = ('<title>Dilo</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n'
       '<style>\n' + (root / 'styles.css').read_text() + '</style>\n' + body)
(root / 'dist').mkdir(exist_ok=True)
(root / 'dist/dilo-demo.html').write_text(out)
print('ok', len(out))
