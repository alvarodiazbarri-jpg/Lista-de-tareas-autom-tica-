# Tareas pendientes de Dilo

Lista de mejoras para la app. Marca con [x] lo que esté hecho.

**Ideas de Álvaro:** las va apuntando en su lista **«Ideas DILO»** de la app. En cada sesión, pedirle que la
mande (en la lista: ⋯ → «📋 Copiar o compartir la lista») y pasar aquí lo nuevo.

## Próximas (en este orden)
1. [x] **Guardar las listas y la agenda en la nube** (Firebase, gratis, de Google). Hecho en la versión 0.6 y funcionando en el móvil.
   - Para ver lo mismo en varios móviles y no perder nada si se cambia de móvil o se borra el navegador.
   - Lo que tiene que hacer Álvaro: crear una cuenta gratuita de Firebase con su cuenta de Google (unos 10 minutos, con guía paso a paso).
   - Cada persona entra en Dilo con su cuenta de Google; solo la familia ve sus datos.
2. [x] **Compartir con mi mujer** (y con la familia) *Hecho en la versión 0.6 (☁️ → Invitar) y probado: funciona.*: que ella instale Dilo en su móvil, entre con su cuenta de Google y veamos las mismas citas y listas. Lo que apunte uno aparece en el móvil del otro en segundos. Necesita el punto 1.
   - De momento se comparte todo; las listas privadas van en el punto 6.
3. [x] **Quién y cuándo**: hecho y comprobado en los dos móviles (versión 0.10). Quién, cuándo y la etiqueta se guardan en `detalles`, aparte de `items`, para que una Dilo antigua abierta en otro sitio no los borre.
4. [x] **Las listas se ajustan a la pantalla** *Hecho en la versión 0.9.*: que la pantalla de inicio quepa siempre sin desplazarse; cuantas más listas haya, más pequeñas se hacen las tarjetas (y si no caben, quitar primero las cosas de vista previa y luego pasar a 3 columnas o a filas compactas).
5. [x] **Borrar por voz** *Hecho en la versión 0.12.*: «quita la leche de la compra», «borra pan», «elimina tomates y tarta de queso» (borra, con «Deshacer»); «tacha el pan», «marca la leche como hecha» (lo marca como hecho). Encuentra la cosa aunque no se diga igual. Si no encuentra nada, pregunta si se quiere apuntar como algo nuevo (por si era «quitar el polvo»).
6. [ ] **Listas privadas** *(en curso: la sincronización con el sitio privado `usuarios/{uid}` ya está hecha en la rama; faltan los botones, el candado, las reglas de Firebase y probarlo)*: al crear o editar una lista, poder marcarla como «Solo para mí»: solo la ve quien la creó, en su móvil y con su cuenta (no la ve el resto de la casa). Las demás siguen compartidas. Hay que cambiar también las reglas de Firebase.
7. [x] **Nuevo icono de la app** *Hecho en la versión 0.12*: «Lista con micro» en azul noche con DILOBARRI (opción D). Puede tardar en cambiar en la pantalla del móvil; si no, desinstalar e instalar Dilo otra vez.
8. [ ] **Apuntar citas con la voz**: «cita con el dentista el martes a las 10 para Julia» → se guarda en Mi agenda con fecha, hora, lugar y persona, y llega la notificación de confirmación.
9. [ ] **Recetas dentro de Dilo**, igual que se ha hecho con la agenda (copiar «Recetas de Karlos Bernal» y «Comidas de la semana»).
10. [ ] **Leer citas desde fotos** (lo que hacía «Importar» en la Mi agenda de Claude): buscar otra forma, porque fuera de claude.ai no se puede usar a Claude así.
11. [ ] **Apuntar con el móvil bloqueado**: un atajo de Android (Tasker o rutina de Google) que dicte la idea y la envíe a la nube; Dilo la recoge en la Bandeja de entrada al abrirse. Necesita el punto 1.
12. [ ] **Avisos de citas con la app cerrada**: ahora solo saltan con Dilo abierta. Con la nube se pueden mandar notificaciones de verdad (o seguir usando «Añadir al calendario del móvil»).

## Por revisar
- [ ] Decidir cómo se ven las listas: **Tarjetas** o **Filas**, y qué colores (Vivos, Pastel, Profundos, Degradados). De momento se puede elegir en «?» para probar.
- [ ] Probar la voz en el móvil real con la versión 0.5.1 (crear lista y apuntar en la misma frase, apuntar en una lista, notificación).
- [ ] Listas cuyo nombre lleva «con» (por ejemplo «Cena con amigos»): por voz se entiende como «lista Cena» + «amigos». De momento crearlas con el botón «+ Nueva lista».
- [ ] «Crea una lista de ferretería tornillos y tacos» (sin «y apunta» o «con») mete todo en el nombre. Pensar si la app puede preguntar en estos casos.
- [ ] Recuperar las fotos de las citas que se quedaron en la Mi agenda antigua (guardar copia de seguridad desde allí con las fotos y cargarla en Dilo).

## Hecho
- [x] Versión 0.13: en «?» → «Cómo se ven las listas» se elige entre **Tarjetas** y **Filas** (filas anchas de color como las citas de Mi agenda, con el icono en un recuadro blanco, «N pendientes» y el número a la derecha). Con más de unas 10 listas, las filas necesitan desplazarse un poco. Se guarda en cada móvil.
- [x] Versión 0.11: cada lista con un color distinto (según su puesto, igual en todos los móviles); 4 juegos de colores para elegir en «?» (Vivos, Pastel, Profundos, Degradados); tarjetas con el icono grande en el centro, el nombre debajo y el número en la esquina; firma «APP by BARRI» en la cabecera de Dilo y de Mi agenda y en «?».
- [x] Versión 0.10: tarjetas de las listas de color entero (solo icono, nombre y número); la tarjeta de la agenda enseña todas las citas del próximo día, cada una con el color de su persona; etiquetas en cada cosa apuntada (Normal, Urgente, Informativa, Curiosidad; las urgentes arriba; se añaden más en `ETIQUETAS` de `js/app.js`); el aviso «Apuntado» de las listas ya no sale con Dilo abierta (en la agenda sí).
- [x] Las tarjetas de las listas ocupan el hueco de la pantalla: grandes con pocas listas (con más cosas de vista previa), más pequeñas con muchas, 3 columnas y luego filas. «+ Nueva lista» pasa a un botón junto a «Tus listas». Opción «📋 Copiar o compartir la lista» en ⋯ (versión 0.9).
- [x] El autor de cada cosa ya no se borra si otro móvil tiene una versión antigua; en ☁️ se ve qué versión de Dilo tiene cada persona (versión 0.8.2).
- [x] Diseño más compacto y claro (versión 0.8.1): cabecera de una línea, barra de escribir más pequeña, sin la fila «Apuntar en», modo oscuro más claro y tarjetas de listas con su color.
- [x] Quién apuntó cada cosa y cuándo, y quién la marcó como hecha, en listas y agenda (versión 0.8; en 0.8.1 el nombre sale siempre, en pequeño junto a la hora). Lo apuntado antes no tiene autor.
- [x] Nuevo diseño de inicio y listas: tarjetas de colores, etiquetas «Apuntar en», micrófono grande (versión 0.7).
- [x] Crear una lista y apuntar en ella con una sola frase: «Crea una lista de viajes y apunta pasaporte» (versión 0.5.1).
- [x] «Mi agenda» dentro de Dilo, igual que la original, con las 18 citas y la familia copiadas (versión 0.5). Las fotos de las citas se quedaron en la app antigua.
- [x] Notificación en el móvil al apuntar algo; al tocarla se abre la lista para revisarlo (versión 0.4).
- [x] Las actualizaciones llegan al móvil al abrir la app (versión 0.3.1).
- [x] Voz en Android sin frases repetidas, y la lista se entiende delante o detrás (versión 0.3).

## Ideas para más adelante
- [ ] Recordatorios para las tareas con fecha.
- [ ] Ordenar automáticamente la Bandeja de entrada con ayuda de IA.
