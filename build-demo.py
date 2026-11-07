#!/usr/bin/env python3
"""Genera dist/dilo-demo.html: una sola página con todo incrustado, para verla como demo."""
import pathlib, re
root = pathlib.Path(__file__).parent
html = (root / 'index.html').read_text()
body = re.search(r'<body>(.*)</body>', html, re.S).group(1)
body = body.replace('<script src="js/parser.js"></script>', '<script>window.DILO_DEMO = true;\n' + (root / 'js/parser.js').read_text() + '</script>')
body = body.replace('<script src="js/app.js"></script>', '<script>' + (root / 'js/app.js').read_text() + '</script>')
out = ('<title>Dilo</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n'
       '<style>\n' + (root / 'styles.css').read_text() + '</style>\n' + body)
(root / 'dist').mkdir(exist_ok=True)
(root / 'dist/dilo-demo.html').write_text(out)
print('ok', len(out))
