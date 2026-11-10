# Tareas pendientes de Dilo

Lista de mejoras para la app. Marca con [x] lo que esté hecho.

## Próximas (en este orden)
1. [x] **Guardar las listas y la agenda en la nube** (Firebase, gratis, de Google). Hecho en la versión 0.6 y funcionando en el móvil.
   - Para ver lo mismo en varios móviles y no perder nada si se cambia de móvil o se borra el navegador.
   - Lo que tiene que hacer Álvaro: crear una cuenta gratuita de Firebase con su cuenta de Google (unos 10 minutos, con guía paso a paso).
   - Cada persona entra en Dilo con su cuenta de Google; solo la familia ve sus datos.
2. [ ] **Compartir con mi mujer** (y con la familia) *Hecho en la versión 0.6 (☁️ → Invitar), falta probarlo.*: que ella instale Dilo en su móvil, entre con su cuenta de Google y veamos las mismas citas y listas. Lo que apunte uno aparece en el móvil del otro en segundos. Necesita el punto 1.
   - Elegir qué se comparte: la agenda seguro; ¿también la compra? ¿Las tareas e ideas de cada uno quedan privadas?
3. [x] **Quién y cuándo** *Hecho en la versión 0.8, falta probarlo con dos móviles.*: en cada cosa apuntada (listas y agenda) que se vea **quién la apuntó** (Álvaro, Bea…, con su foto o inicial y su color) y **cuándo** («Hace 5 min», «Ayer 18:30»). También quién la marcó como hecha. Guardar el correo de quien apunta en la nube.
4. [ ] **Apuntar citas con la voz**: «cita con el dentista el martes a las 10 para Julia» → se guarda en Mi agenda con fecha, hora, lugar y persona, y llega la notificación de confirmación.
5. [ ] **Recetas dentro de Dilo**, igual que se ha hecho con la agenda (copiar «Recetas de Karlos Bernal» y «Comidas de la semana»).
6. [ ] **Leer citas desde fotos** (lo que hacía «Importar» en la Mi agenda de Claude): buscar otra forma, porque fuera de claude.ai no se puede usar a Claude así.
7. [ ] **Apuntar con el móvil bloqueado**: un atajo de Android (Tasker o rutina de Google) que dicte la idea y la envíe a la nube; Dilo la recoge en la Bandeja de entrada al abrirse. Necesita el punto 1.
8. [ ] **Avisos de citas con la app cerrada**: ahora solo saltan con Dilo abierta. Con la nube se pueden mandar notificaciones de verdad (o seguir usando «Añadir al calendario del móvil»).

## Por revisar
- [ ] Listas privadas: ahora todo lo de Dilo se comparte con la casa. ¿Queremos que algunas listas (ideas, tareas personales) sean solo de uno?
- [ ] Las notas de voz grabadas (audio) se quedan en el móvil donde se grabaron; en el otro móvil se ve el apunte pero no se puede escuchar.
- [ ] Probar la voz en el móvil real con la versión 0.5.1 (crear lista y apuntar en la misma frase, apuntar en una lista, notificación).
- [ ] Listas cuyo nombre lleva «con» (por ejemplo «Cena con amigos»): por voz se entiende como «lista Cena» + «amigos». De momento crearlas con el botón «+ Nueva lista».
- [ ] «Crea una lista de ferretería tornillos y tacos» (sin «y apunta» o «con») mete todo en el nombre. Pensar si la app puede preguntar en estos casos.
- [ ] Recuperar las fotos de las citas que se quedaron en la Mi agenda antigua (guardar copia de seguridad desde allí con las fotos y cargarla en Dilo).

## Hecho
- [x] Quién apuntó cada cosa y cuándo, y quién la marcó como hecha, en listas y agenda (versión 0.8). Solo se ve el nombre cuando hay más de una persona en la casa; lo apuntado antes no tiene autor.
- [x] Nuevo diseño de inicio y listas: tarjetas de colores, etiquetas «Apuntar en», micrófono grande (versión 0.7).
- [x] Crear una lista y apuntar en ella con una sola frase: «Crea una lista de viajes y apunta pasaporte» (versión 0.5.1).
- [x] «Mi agenda» dentro de Dilo, igual que la original, con las 18 citas y la familia copiadas (versión 0.5). Las fotos de las citas se quedaron en la app antigua.
- [x] Notificación en el móvil al apuntar algo; al tocarla se abre la lista para revisarlo (versión 0.4).
- [x] Las actualizaciones llegan al móvil al abrir la app (versión 0.3.1).
- [x] Voz en Android sin frases repetidas, y la lista se entiende delante o detrás (versión 0.3).

## Ideas para más adelante
- [ ] Recordatorios para las tareas con fecha.
- [ ] Ordenar automáticamente la Bandeja de entrada con ayuda de IA.
