# Checklist de funcionalidades

Listado de funcionalidades detectadas en `better-sr/README.md` (v2.0.0) y, donde aporta más detalle, en `better-sr/changelog.log`.

Leyenda de la columna de decisión:
- **Mantener**: funcionalidad que el nuevo proyecto debe cubrir.
- **Adaptar**: la idea se conserva, pero la implementación cambia porque hoy depende de Streamer.bot.
- **Opcional**: candidata a una fase posterior.

> Nota: el original depende de Streamer.bot para HTTP, WebSocket y chat. El nuevo proyecto será un servidor propio en Node.js o Python, así que cualquier punto marcado como **Adaptar** requiere reemplazar ese puente.

## 1. Reproducción y cola

- [x] Cola de peticiones de viewers — **Mantener**
- [x] Reordenar la cola con arrastrar y soltar en tiempo real — **Mantener**
- [x] Lista base (fallback) que se reproduce en modo aleatorio cuando la cola está vacía — **Mantener** (guardada en `data/baselist.json`; START en orden o SHUFFLE en aleatorio)
- [x] Botones START / SHUFFLE para la lista base — **Mantener** (más un botón para parar)
- [x] Añadir playlists de YouTube como lista base — **Mantener** (requiere la clave de YouTube Data API; hasta 1.000 vídeos por importación)
- [x] Auto-skip de vídeos no disponibles, bloqueados o eliminados — **Mantener**
- [x] Persistencia de la cola entre recargas — **Mantener** (changelog v1.2.3). Fase 5: la cola, la canción actual, el volumen y el estado START/SHUFFLE se guardan en SQLite (`data/blue-jay.db`) y se recuperan al arrancar; la canción actual vuelve a sonar desde el principio
- [x] Limpiar cola y guardar cola — **Mantener**. Fase 5: «Limpiar cola» vacía las pendientes sin cortar la que suena; «Guardar cola como lista» guarda la canción actual y la cola en una lista de reproducción nueva
- [x] Control de volumen del reproductor — **Mantener** (slider en el panel y `!volume` en el chat)
- [x] Favoritos (estrella) en la lista base, la cola y la canción actual; aparecen arriba y entran en START/SHUFFLE — **Mantener** (changelog v1.2.3). Marcar una canción de la cola o la actual la añade a la lista base

## 2. Spotify

- [ ] Añadir playlists de Spotify como lista base — **Opcional**
- [ ] Aceptar enlaces de pista de Spotify desde el chat con `!sr` — **Opcional**
- [ ] Reproducción nativa con OAuth + Spotify Web Playback SDK — **Opcional** (requiere Spotify Premium)
- [ ] Fallback a un resultado de YouTube cuando la reproducción nativa no está disponible — **Opcional**
- [ ] Badge de origen (YouTube / Spotify) en cada canción — **Mantener** si se incluye Spotify
- [ ] Configuración de Client ID y Redirect URI en Ajustes — **Opcional**

## 3. Comandos de chat

- [x] `!sr [enlace/título]` para pedir canciones — **Adaptar** (enlace, ID o búsqueda por título con la clave de YouTube Data API). Fase 4.5: si el texto no es un enlace ni un ID, se busca primero en la biblioteca local y solo si no hay coincidencia se consulta YouTube. La búsqueda del chat es estricta: si la palabra solo coincide con una etiqueta de menos de 10 caracteres, hace falta que coincida también el artista o el álbum
- [x] Sustituir por la biblioteca local un vídeo de YouTube que existe pero no se puede reproducir — **Mantener** (requerimiento nuevo). Con la clave de YouTube, `!sr <enlace>` mira antes de encolar si el vídeo se puede incrustar; si no, busca su título en la biblioteca (búsqueda estricta, con el ruido del título quitado) y encola esa pista o, si no hay una coincidencia clara, rechaza la petición. Además, una petición que falla al reproducirse se sustituye al vuelo si hay coincidencia. Se activa y desactiva en Ajustes (activado por defecto)
- [x] `!local [texto]` para pedir una pista solo de la biblioteca local — **Mantener** (requerimiento nuevo, fase 4.5). Busca por título, artista, álbum, comentario o descripción
- [x] `!when` para ver cuándo sonará la próxima canción del viewer — **Mantener**
- [x] `!queue` para ver la canción actual y las 10 siguientes — **Mantener**
- [x] `!voteskip` para votar saltar la canción — **Mantener**
- [x] `!skip` para saltar la canción — **Mantener**
- [x] `!wrongsong` para retirar una petición propia — **Mantener**
- [x] `!volume` para ajustar el volumen — **Mantener** (solo moderadores, VIPs y suscriptores)
- [x] Respuestas del bot en el idioma configurado — **Mantener**
- [ ] Respuesta al mismo canal de origen (Twitch, Kick o YouTube) en multistream — **Adaptar**
- [ ] Recompensas de canal de Twitch y Kick que disparan `!sr` — **Adaptar**

## 4. Límites y moderación

- [x] Límite de peticiones activas por usuario (por defecto 25) — **Mantener**. Cuenta la canción que suena y las pendientes que pidió ese usuario; las de la lista base no cuentan
- [x] Límite global de peticiones activas (por defecto 100) — **Mantener**
- [x] Interruptores para activar o desactivar cada límite, con estado guardado — **Mantener** (pestaña Ajustes; se guarda en SQLite)
- [x] Avisos en el chat cuando se alcanza un límite — **Mantener**
- [x] Duración máxima de los vídeos de YouTube pedidos por el chat — **Añadir**. 7 minutos por defecto, configurable (1 a 600) y desactivable en Ajustes. Se comprueba con `videos.list` (necesita la clave de YouTube) en enlaces y en resultados de búsqueda; los directos (en vivo o programados) se rechazan siempre que el límite esté activo (resultado `live`). Las pistas locales no se limitan. Resultado `too_long` en el historial
- [x] Interruptor para aceptar o no peticiones del chat — **Mantener** (requerimiento nuevo, fase 5). Con las peticiones desactivadas, `!sr` y `!local` responden con un aviso y no añaden nada; el resto de comandos siguen funcionando. Está en la barra superior y en Ajustes, y se guarda entre reinicios
- [x] Lista negra / ban de canciones con un clic: se saltan y se eliminan de la cola — **Mantener** (guardada en `data/blacklist.json`; también se retiran de la lista base y se rechazan en `!sr`)
- [x] Mensajes del bot editables por idioma — **Mantener**. Fase 5.5: pestaña Mensajes; cada mensaje `chat.*` se reescribe por idioma (es y en), con vista previa y las variables que admite. Máximo 400 caracteres y solo las variables que ya tiene el mensaje
- [x] Activar o desactivar cada mensaje del bot sin borrar su texto — **Mantener**. Un mensaje desactivado deja al bot en silencio, pero la petición se sigue anotando en el historial. «Restaurar original» devuelve el texto y reactiva el mensaje

## 5. Historial de peticiones

- [x] Guardar las peticiones pedidas desde el chat — **Mantener**. Fase 5: se guarda cada petición de `!sr` y `!local` con su resultado, también las rechazadas (URL no válida, no encontrada, vetada, peticiones desactivadas, límite de usuario o global…)
- [x] Historial de reproducción — **Mantener** (requerimiento nuevo, fase 5). Cada canción que empieza a sonar, con su origen (petición o lista base) y quién la pidió
- [x] Búsqueda y filtros por usuario y por fecha — **Mantener**. También por resultado en el historial de peticiones
- [x] Borrar una entrada o limpiar todo el historial — **Mantener** (requerimiento nuevo, fase 5). Cada historial se limpia por separado; cada uno guarda como máximo 10.000 filas
- [ ] Marcar favoritos en el historial — **Mantener**. Descartado en la fase 5: para guardar una canción del historial se usan las listas de reproducción (ver `docs/propuesta.md`)
- [x] Volver a añadir una canción del historial a la cola — **Mantener**
- [x] Guardar una canción del historial en una lista de reproducción — **Mantener** (requerimiento nuevo, fase 5)

## 6. Biblioteca local (nueva)

- [x] Elegir una carpeta local con música — **Mantener** (requerimiento nuevo). Se indica en la pestaña Biblioteca local, solo desde el equipo del servidor, y se guarda en `data/library.json`
- [x] Escaneo recursivo de la carpeta y detección de cambios — **Mantener** (requerimiento nuevo). Formatos `.mp3`, `.flac`, `.ogg`, `.m4a` y `.wav`; los cambios se detectan con `fs.watch`
- [x] Reproducir archivos locales en el panel y en la lista base — **Mantener** (requerimiento nuevo)
- [x] Buscar y añadir pistas locales a la cola por título o artista — **Mantener** (requerimiento nuevo). Desde el panel y, desde la fase 4.5, por chat con `!local` y `!sr`
- [x] Usar la carpeta local como lista base de fallback — **Mantener** (requerimiento nuevo). Casilla «Incluir la biblioteca en la lista base»; también se pueden marcar pistas sueltas como favoritas
- [x] Leer etiquetas (ID3, Vorbis, MP4…): título, artista, álbum y duración reales — **Mantener** (fase 4.5). Con `music-metadata`; si un archivo no tiene etiquetas, título y artista salen del nombre del archivo y de la carpeta
- [x] Buscar también en comentario, descripción y subtítulo, que sirven de títulos alternativos — **Mantener** (fase 4.5). La búsqueda ordena por relevancia: título, luego artista y luego notas
- [x] Añadir una pista suelta de la biblioteca a la lista base sin marcarla como favorita — **Mantener** (fase 4.5)

## 7. Panel de control de la lista de reproducción (nuevo)

- [x] Ver cola, lista base e historial en un único panel — **Mantener** (requerimiento nuevo). Pestañas Cola, Lista base, Biblioteca local, Historial, Listas, Lista negra y Ajustes
- [ ] Reordenar, eliminar y saltar pistas desde el panel — **Mantener** (requerimiento nuevo). Asignado a la fase 7
- [x] Gestionar listas base (añadir, quitar, activar) — **Mantener** (requerimiento nuevo). La lista base es única (ver `docs/propuesta.md`, 3.5)
- [x] Listas de reproducción propias: crear, renombrar y eliminar — **Mantener** (requerimiento nuevo, fase 5). Hasta 100 listas de 2.000 pistas, sin repetir pistas dentro de una lista; se guardan en SQLite
- [x] Añadir a la cola una canción o toda una lista de reproducción — **Mantener** (requerimiento nuevo, fase 5). Se saltan las pistas vetadas o que ya no están en la biblioteca
- [ ] Controles de reproducción: play, pausa, siguiente, aleatorio — **Mantener** (requerimiento nuevo). Asignado a la fase 7
- [x] Ver el estado en vivo de la cola y de la canción actual — **Mantener** (requerimiento nuevo)
- [x] Panel en dos columnas — **Mantener** (requerimiento nuevo, fase 5.5). A la izquierda (1/3) «Sonando ahora», con favorito, vetar y siguiente en una sola fila arriba, «Añadir canción» y «Cola»; a la derecha (2/3) el resto de pestañas. En pantallas estrechas se apilan

## 8. Widget de OBS

- [x] Widget compacto con título y progreso de la canción actual — **Adaptar** (fase 6). `/widget.html`: fondo transparente, título en 2 líneas como máximo (en pistas locales con el subtítulo entre paréntesis, si lo tiene), artista, quién la pidió y barra con el tiempo. Se oculta cuando no suena nada
- [x] Widget invisible en reposo, con disco girando a la izquierda — **Adaptar**. Sin título «Sonando ahora». Solo se ve 10 s al recibir `!queue` o `!song`, o al cambiar de pista (y durante la tarjeta de prueba); con `?idle=0.3` en la dirección queda con esa opacidad en reposo
- [x] `!song`: información de la canción actual — **Adaptar**. En pistas locales añade artista, álbum y la primera nota de las etiquetas, y el título lleva entre paréntesis el subtítulo (`TIT3`) si lo tiene
- [x] Actualización en vivo mediante WebSocket — **Mantener** (fase 6). El widget se conecta a `/ws?view=widget`, de solo lectura, y solo recibe la canción actual y su progreso. El progreso lo envía el reproductor del panel cada segundo, así que con el panel cerrado el widget no avanza
- [ ] Audio opcional del widget (solo YouTube) — **Opcional**
- [ ] Editor visual: mover, redimensionar, rotar, ocultar, opacidad y fondo de cada elemento — **Opcional**
- [ ] Guardar y sincronizar layouts con las fuentes del widget — **Opcional**
- [ ] Badge de estado `!SR` editable — **Opcional**
- [x] Botón de prueba que envía una tarjeta temporal sin tocar la cola real — **Mantener** (fase 6). Pestaña Ajustes; la tarjeta dura 8 segundos
- [x] URL del widget generada automáticamente desde Ajustes — **Mantener** (fase 6). Con botón de copiar; incluye `?lang=` con el idioma del panel

## 9. Idioma e interfaz

- [x] Interfaz en varios idiomas — **Mantener** (el proyecto pide español y, como mínimo, inglés con sistema i18n)
- [ ] Idiomas del original: inglés, polaco, ucraniano, alemán, francés y turco — **Opcional** (la base será es + en)
- [ ] Tema día / noche con noche por defecto — **Mantener** (changelog v2.0.0)
- [ ] Tutorial interactivo integrado — **Opcional**
- [ ] Ayuda (HELP) con instrucciones de instalación — **Mantener**

## 10. Sistema, configuración y diagnóstico

- [ ] Servidor HTTP local que sirve la página — **Adaptar** (propio de Node o Python)
- [ ] Servidor WebSocket local para chat y widget — **Adaptar**
- [ ] Clave de API de YouTube Data API v3 guardada en Ajustes — **Mantener**
- [ ] Panel de diagnóstico: estado del WebSocket, versión del import, puente del widget y presencia de la clave de API — **Mantener**
- [ ] Verificación de la versión del import de Streamer.bot con aviso si falta algo — **Adaptar** (solo si se mantiene Streamer.bot)
- [ ] Exportar e importar ajustes, favoritos, historial, layouts y mensajes personalizados — **Mantener**
- [ ] Exportar ajustes sin incluir la clave de API ni los tokens de Spotify — **Mantener**
- [x] Notificaciones en la app en lugar de `alert` / `confirm` nativos — **Mantener** (changelog v1.2.3)
- [ ] Soporte de chat multistream: Twitch, Kick y YouTube — **Adaptar**
