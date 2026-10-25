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
- [ ] Persistencia de la cola entre recargas — **Mantener** (changelog v1.2.3). Planificada en la fase 5, junto con el volumen y el modo START/SHUFFLE; hoy solo se guardan la lista base y la lista negra
- [ ] Limpiar cola y guardar cola — **Mantener**
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
- [x] `!local [texto]` para pedir una pista solo de la biblioteca local — **Mantener** (requerimiento nuevo, fase 4.5). Busca por título, artista, álbum, comentario o descripción
- [x] `!when` para ver cuándo sonará la próxima canción del viewer — **Mantener**
- [x] `!queue` para ver la canción actual y las 10 siguientes — **Mantener**
- [x] `!voteskip` para votar saltar la canción — **Mantener**
- [x] `!skip` para saltar la canción — **Mantener**
- [x] `!wrongsong` para retirar una petición propia — **Mantener**
- [x] `!volume` para ajustar el volumen — **Mantener** (solo moderadores)
- [x] Respuestas del bot en el idioma configurado — **Mantener**
- [ ] Respuesta al mismo canal de origen (Twitch, Kick o YouTube) en multistream — **Adaptar**
- [ ] Recompensas de canal de Twitch y Kick que disparan `!sr` — **Adaptar**

## 4. Límites y moderación

- [ ] Límite de peticiones activas por usuario (por defecto 25) — **Mantener**
- [ ] Límite global de peticiones activas (por defecto 100) — **Mantener**
- [ ] Interruptores para activar o desactivar cada límite, con estado guardado — **Mantener**
- [ ] Avisos en el chat cuando se alcanza un límite — **Mantener**
- [x] Lista negra / ban de canciones con un clic: se saltan y se eliminan de la cola — **Mantener** (guardada en `data/blacklist.json`; también se retiran de la lista base y se rechazan en `!sr`)
- [ ] Mensajes del bot editables por idioma — **Mantener**
- [ ] Activar o desactivar cada mensaje del bot sin borrar su texto — **Mantener**

## 5. Historial de peticiones

- [ ] Guardar canciones únicas pedidas desde el chat — **Mantener**
- [ ] Búsqueda y filtros por usuario y por fecha — **Mantener**
- [ ] Marcar favoritos en el historial — **Mantener**
- [ ] Volver a añadir una canción del historial a la cola — **Mantener**

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

- [ ] Ver cola, lista base e historial en un único panel — **Mantener** (requerimiento nuevo)
- [ ] Reordenar, eliminar y saltar pistas desde el panel — **Mantener** (requerimiento nuevo)
- [x] Gestionar listas base (añadir, quitar, activar) — **Mantener** (requerimiento nuevo). La lista base es única (ver `docs/propuesta.md`, 3.5)
- [ ] Controles de reproducción: play, pausa, siguiente, aleatorio — **Mantener** (requerimiento nuevo)
- [x] Ver el estado en vivo de la cola y de la canción actual — **Mantener** (requerimiento nuevo)

## 8. Widget de OBS

- [ ] Widget compacto con título y progreso de la canción actual — **Adaptar** (hoy usa el WebSocket de Streamer.bot)
- [ ] Actualización en vivo mediante WebSocket — **Mantener**
- [ ] Audio opcional del widget (solo YouTube) — **Opcional**
- [ ] Editor visual: mover, redimensionar, rotar, ocultar, opacidad y fondo de cada elemento — **Opcional**
- [ ] Guardar y sincronizar layouts con las fuentes del widget — **Opcional**
- [ ] Badge de estado `!SR` editable — **Opcional**
- [ ] Botón de prueba que envía una tarjeta temporal sin tocar la cola real — **Mantener**
- [ ] URL del widget generada automáticamente desde Ajustes — **Mantener**

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
