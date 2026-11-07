# Dilo · Listas por voz

App web (PWA) para apuntar con la voz tareas, compras, ideas o cualquier cosa **en el momento en que se te ocurre**, sin perder la idea.

## Qué hace

- **Botón de micrófono grande**: pulsas, hablas, vuelves a pulsar.
- **Entiende lo que dices** y lo coloca en su sitio:
  - «Añade leche, pan y huevos a la compra» → 3 elementos en *Compra*
  - «Compra tomates» → empieza por el nombre de la lista
  - «Apunta llamar al dentista en tareas»
  - «Crea una lista de regalos de Navidad»
  - «Añade una bici a la lista de regalos» → si la lista no existe, la crea
  - Cualquier otra cosa → **Bandeja de entrada**, para organizarla después con el botón 📂
- **Sin conexión no se pierde nada**: si el reconocimiento de voz no está disponible, graba el audio y lo deja como nota de voz en la Bandeja de entrada.
- **Deshacer** tras cada acción, editar, borrar, mover entre listas y marcar como hecho.
- Se puede **instalar en el móvil** (Añadir a pantalla de inicio). El acceso directo «Hablar ahora» abre la app escuchando.
- Los datos se guardan en el propio dispositivo.

## Probarla

Necesita servirse por `https` o `localhost` (el micrófono no funciona abriendo el archivo directamente):

```bash
python3 -m http.server 8000
# abre http://localhost:8000
```

El reconocimiento de voz funciona mejor en **Chrome (Android/escritorio)** y **Safari (iPhone)**.

## Estructura

- `index.html`, `styles.css` — interfaz
- `js/parser.js` — interpreta las frases en español (crear lista, añadir a lista, bandeja)
- `js/app.js` — listas, voz, grabación de audio, almacenamiento
- `sw.js`, `manifest.webmanifest` — funcionamiento sin conexión e instalación
