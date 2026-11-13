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
6. [x] **Listas privadas** *Hecho en la versión 0.14 y probado.* En ⋯ de cada lista → «🔒 Hacerla privada» / «👥 Compartirla con la casa», o por voz «crea una lista privada de regalos». Van en `usuarios/{uid}`. Desde la 0.15 cada lista guarda su puesto y vuelve a su sitio al dejar de ser privada.
7. [x] **Nuevo icono de la app** *Hecho en la versión 0.12*: «Lista con micro» en azul noche con DILOBARRI (opción D). Puede tardar en cambiar en la pantalla del móvil; si no, desinstalar e instalar Dilo otra vez.
8. [x] **Apuntar citas con la voz** *Hecho en la versión 0.15, falta probarlo hablando.*: «cita con el dentista el martes a las 10 para Julia», «apunta en la agenda reunión del colegio el jueves a las 5 de la tarde», «consulta del pediatra el 15 de diciembre a las 9 y media en el centro de salud». Entiende hoy/mañana/pasado mañana, días de la semana, «el 15», «15 de diciembre», «3/12», «dentro de 2 días», horas («y media», «menos cuarto», «de la tarde», «a mediodía»), lugar («en …»), de quién es («para Julia», «para toda la familia») y adivina el tipo (médica, trámite, trabajo). Se guarda en Mi agenda con aviso «Deshacer» y llega la notificación. Si falta el día, lo pide. Lo hace `js/citas.js`.
9. [ ] *(Aplazado: Álvaro prefiere dejarlo para más adelante.)* **Recetas dentro de Dilo**, igual que se ha hecho con la agenda (copiar «Recetas de Karlos Bernal» y «Comidas de la semana»).
10. [ ] **Leer citas desde fotos** (lo que hacía «Importar» en la Mi agenda de Claude): buscar otra forma, porque fuera de claude.ai no se puede usar a Claude así.
11. [x] **Apuntar sin tocar el móvil (bloqueado, conduciendo, en la ducha)** *Hecho en la versión 0.17 y probado: Dilo recoge lo dictado y Google Tasks lo da por hecho.*
   - **«Hey Google, recuérdame comprar pilas»** con el móvil bloqueado: el asistente lo guarda en Google Tasks («Mis tareas»), en la misma cuenta que Dilo (Álvaro ya lo configuró y funciona). Al abrir Dilo se traen esas tareas, se apuntan como si se dijeran (a su lista, a la Bandeja o, si es una cita, a Mi agenda) y en Google Tasks quedan como hechas.
   - **Frase recomendada: «Hey Google, añade … a Tasks»** (o «apunta en Tasks …»). Con «recuérdame…» el asistente a veces pregunta qué app usar u ofrece otras, y hay que tocar el móvil. Para que no pregunte: en Gemini → foto → «Aplicaciones/Extensiones» desactivar Keep y otras de notas; desactivar la app de recordatorios del fabricante; y en Gemini → «Información guardada» pedir que use siempre Google Tasks. Desde la 0.17.1, «leche a la compra» que llega de Tasks va a la Compra (no a la Bandeja). Desde la 0.17.2 también «En compra, sal» (con coma), y se leen además las listas de Google Tasks que se llamen como una de Dilo (lo de la lista «Compra» de Tasks va a la Compra); las demás listas de Tasks no se tocan.
   - Se activa en «?» → «🎙️ Recoger lo que dicte a Hey Google». El permiso de Google dura 1 hora; cuando caduca sale un aviso en el inicio para tocar y recoger.
   - Hay que activar «Google Tasks API» en console.cloud.google.com (proyecto dilo-2dfb7) y, si la app está «en prueba», añadir los correos como usuarios de prueba.
   - **Abrir el asistente sin decir «Hey Google»** (en curso): el Samsung de Álvaro solo ofrece «Activar Bixby» o «Menú Apagado» al mantener pulsado el botón lateral, aunque se ponga Google/Gemini como asistente predeterminado. Va a probar **Good Lock → RegiStar**: «mantener pulsada la tecla lateral» → Asistente de Google/Gemini, y «doble toque en la parte trasera» → asistente. Apaño mientras: botón lateral «Pulsar dos veces» → «Abrir aplicación» → Gemini/Google. Para apagar: lateral + bajar volumen.
   - Además (versión 0.16): botón fijo «Toca para apuntar» en las notificaciones, «Compartir → Dilo» desde otras apps y el atajo «Hablar ahora».
12. [ ] **Avisos de citas con la app cerrada**: ahora solo saltan con Dilo abierta. Con la nube se pueden mandar notificaciones de verdad (o seguir usando «Añadir al calendario del móvil»).
13. [ ] **Que Dilo conteste por voz**: al apuntar, borrar o guardar una cita, que lo diga en voz alta («Apuntado leche en la compra», «Cita guardada: dentista, martes a las diez»), sobre todo cuando se usa sin mirar la pantalla. Con un interruptor para activarlo o no. Más adelante, preguntas: «¿qué hay en la compra?», «¿qué citas tengo mañana?».

## Por revisar
- [ ] Decidir cómo se ven las listas: **Tarjetas** o **Filas**, y qué colores (Vivos, Pastel, Profundos, Degradados). De momento se puede elegir en «?» para probar.
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
- [ ] **Dispositivo con botón y micro ya hecho** (buscado en noviembre de 2026). El mejor candidato es el anillo **Pebble Index 01** (75 $ en reserva, 99 $ después; a Europa unos 110 $ con envío e impuestos): botón + micrófono, Bluetooth, Android, transcribe en el móvil, sin suscripción y puede mandar el texto a un **webhook** propio → se puede llevar a Google Tasks/Dilo con un Google Apps Script. Pegas: batería no recargable (unos 2 años) y plazos de envío variables. Otras: auriculares con botón del asistente (Pixel Buds A desde ~83 €, Honor Choice), Galaxy Watch8 (~269-379 €, sin confirmar que guarde en Tasks). Descartados: Amazon Bee (solo EE. UU., escucha siempre, suscripción) y Sandbar Stream (solo iPhone).
- [ ] **Botón Bluetooth sin micro** que abra el asistente (se habla al móvil): Flic 2 (35 $, agotado y sin confirmar con el móvil bloqueado), mando Bluetooth barato (lotería: muchos solo mandan play/pausa) o **la placa XIAO de Álvaro como teclado Bluetooth con la tecla del asistente** (recomendado; falta saber el modelo exacto). Para cualquier opción Bluetooth: app Google → Ajustes → Voz → «Permitir solicitudes Bluetooth con el dispositivo bloqueado».
- [ ] **Botón en la muñeca para hablar a Dilo** (sin «Hey Google»). Álvaro tiene una placa Seeed Studio XIAO (falta saber el modelo exacto). Opciones: (1) la placa como teclado Bluetooth con la tecla del asistente, para hablar al móvil; (2) pulsera con micrófono que mande la voz por Wi-Fi (zona Wi-Fi del móvil) a un Google Apps Script que la pase a texto con Groq y la guarde en Google Tasks, de donde Dilo la recoge. Otras: auriculares con botón del asistente; reloj Wear OS con Gemini.
- [ ] Recordatorios para las tareas con fecha.
- [ ] Ordenar automáticamente la Bandeja de entrada con ayuda de IA.
