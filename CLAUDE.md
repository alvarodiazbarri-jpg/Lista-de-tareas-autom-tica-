# Dilo · notas para Claude

App web instalable (PWA) de Álvaro para apuntar con la voz tareas, compras, ideas y citas,
compartida con su familia. Publicada en https://alvarodiazbarri-jpg.github.io/Lista-de-tareas-autom-tica-/

**Qué falta por hacer: `PENDIENTES.md`** (en orden de prioridad). Actualízalo al terminar cada cosa.
Álvaro apunta sus ideas para Dilo en la lista **«Ideas DILO»** de la app: pídele que la copie (⋯ → «📋 Copiar o
compartir la lista») y la pegue en el chat, y pasa lo nuevo a `PENDIENTES.md`.

## Cómo trabajar con Álvaro
- Habla siempre en **español**, con explicaciones **sencillas y claras**, paso a paso. No es programador.
- Al guiarle por webs (GitHub, Firebase), da el nombre de cada botón **en español y en inglés**, porque
  el navegador a veces traduce. Avisa de que algunos botones quedan a la derecha o abajo y hay que desplazarse.
- Usa sobre todo el **móvil Android** (Chrome). Para pasos largos, mejor desde el ordenador.
- **Publicar es automático** (lo pidió Álvaro): al terminar y probar un cambio, commit en la rama de
  trabajo → **pull request** → **fusionarlo tú mismo** (merge) sin preguntarle → GitHub Actions
  (`.github/workflows/publicar.yml`) publica en GitHub Pages en 1-2 min. Dile qué ha cambiado, que ya
  está publicado y dale el enlace del PR por si quiere verlo.
- **Excepción:** si Álvaro dice que quiere verlo antes, enséñale un ejemplo (capturas o una muestra) y
  no publiques hasta que diga que sí.
- Después de fusionar, la rama queda «gastada»: el siguiente cambio empieza desde `main` actualizado
  (`git fetch origin main && git checkout -B <rama> origin/main`).
- Tras publicar: cerrar Dilo del todo y abrirla dos veces; en **?** se ve la versión (`VERSION` en `js/app.js`).
- **Nunca subas datos personales** (citas, nombres de la familia) al repositorio: es **público**.
  Si hace falta pasarle datos, mándale un archivo aparte.

## Cómo está hecha
- `index.html` + `styles.css` + `js/app.js`: listas, voz, notificaciones, nube de las listas, diseño.
- `js/parser.js`: entiende las frases en español («añade X a la compra», «crea una lista de viajes y apunta
  pasaporte», «apunta en tareas X»…). Probar con Node: `require('./js/parser.js').parse(frase, listas)`.
- `js/citas.js`: entiende citas dichas con la voz («cita con el dentista el martes a las 10 para Julia») y
  `app.js` las guarda en Mi agenda. Probar con Node: `require('./js/citas.js').parse(frase, {familia, tipos, hoy})`.
- `agenda.html`: «Mi agenda» (citas), copia de la versión que tenía como artifact de Claude, con su propio
  CSS y JS dentro. Datos en localStorage `agenda:v1` (sin nube) o `agenda:c2` (con nube).
- `js/nube.js` (módulo): Firebase (proyecto `dilo-2dfb7`): entrar con Google, «casa» compartida e
  invitaciones por correo. Expone `window.DiloNube` y el evento `dilonube`.
  - Firestore: `hogares/{id}` con `miembros` (correos en minúsculas) y dentro `listas`, `items`
    (un documento por cosa apuntada), `detalles` (quién/cuándo/etiqueta de cada cosa, mismo id),
    `perfiles`, `citas`, `familia`, `ajustes/general`.
  - Listas privadas («Solo para mí»): en `usuarios/{uid}` con las mismas `listas`, `items`, `detalles`.
    Solo las lee su dueño (lo protegen las reglas). En `js/app.js` son la fuente `'mia'`.
  - Google Tasks: `DiloNube.pedirTokenTasks()` pide permiso (scope tasks) con un popup; el token dura 1 h
    (`dilo:tasks`). `app.js` → `recogerDeGoogle()` trae «Mis tareas» y las marca como hechas.
  - Reglas en `firestore.rules` (copia; las publica Álvaro en la consola de Firebase).
  - Librería Firebase 10.12.2 copiada en `js/vendor/firebase` (no depende de gstatic).
- `sw.js`: funciona sin conexión; **sube `CACHE` y los `?v=` de `index.html` en cada versión** para que
  el móvil coja lo nuevo. Si añades un archivo, añádelo también a `ASSETS` y al `cp` del workflow.
- Android: el reconocimiento de voz en modo continuo repite frases; allí se usa `continuous = false`.

## Probar
- Servidor: `python3 -m http.server 8765` y Playwright con un móvil (`devices['Pixel 7']`).
- Desde el entorno de Claude no hay acceso a Google/Firebase: para probar la nube, simula `window.DiloNube`
  (bloquea `js/nube.js` con `route` y define una nube falsa) y prueba con dos «móviles».
- `build-demo.py` genera `dist/dilo-demo.html` (demo de una sola página, sin nube).
