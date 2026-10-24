# Checklist de funcionalidades

Listado de funcionalidades detectadas en `better-sr/README.md` (v2.0.0) y, donde aporta más detalle, en `better-sr/changelog.log`.

Leyenda de la columna de decisión:
- **Mantener**: funcionalidad que el nuevo proyecto debe cubrir.
- **Adaptar**: la idea se conserva, pero la implementación cambia porque hoy depende de Streamer.bot.
- **Opcional**: candidata a una fase posterior.

> Nota: el original depende de Streamer.bot para HTTP, WebSocket y chat. El nuevo proyecto será un servidor propio en Node.js o Python, así que cualquier punto marcado como **Adaptar** requiere reemplazar ese puente.

## 1. Reproducción y cola

- [ ] Cola de peticiones de viewers — **Mantener**
- [x] Reordenar la cola con arrastrar y soltar en tiempo real — **Mantener**
- [ ] Lista base (fallback) que se reproduce en modo aleatorio cuando la cola está vacía — **Mantener**
- [ ] Botones START / SHUFFLE para la lista base — **Mantener**
- [ ] Añadir playlists de YouTube como lista base — **Mantener**
- [x] Auto-skip de vídeos no disponibles, bloqueados o eliminados — **Mantener**
- [ ] Persistencia de la cola entre recargas — **Mantener** (changelog v1.2.3)
- [ ] Limpiar cola y guardar cola — **Mantener**
- [ ] Control de volumen del reproductor — **Mantener**
- [ ] Favoritos (estrella) en la lista base, la cola y la canción actual; aparecen arriba y entran en START/SHUFFLE — **Mantener** (changelog v1.2.3)

## 2. Spotify

- [ ] Añadir playlists de Spotify como lista base — **Opcional**
- [ ] Aceptar enlaces de pista de Spotify desde el chat con `!sr` — **Opcional**
- [ ] Reproducción nativa con OAuth + Spotify Web Playback SDK — **Opcional** (requiere Spotify Premium)
- [ ] Fallback a un resultado de YouTube cuando la reproducción nativa no está disponible — **Opcional**
- [ ] Badge de origen (YouTube / Spotify) en cada canción — **Mantener** si se incluye Spotify
- [ ] Configuración de Client ID y Redirect URI en Ajustes — **Opcional**

## 3. Comandos de chat

- [ ] `!sr [enlace/título]` para pedir canciones — **Adaptar** (hoy lo ejecuta Streamer.bot)
- [ ] `!when` para ver cuándo sonará la próxima canción del viewer — **Mantener**
- [ ] `!queue` para ver la canción actual y las 10 siguientes — **Mantener**
- [ ] `!voteskip` para votar saltar la canción — **Mantener**
- [ ] `!skip` para saltar la canción — **Mantener**
- [ ] `!wrongsong` para retirar una petición propia — **Mantener**
- [ ] `!volume` para ajustar el volumen — **Mantener**
- [ ] Respuestas del bot en el idioma configurado — **Mantener**
- [ ] Respuesta al mismo canal de origen (Twitch, Kick o YouTube) en multistream — **Adaptar**
- [ ] Recompensas de canal de Twitch y Kick que disparan `!sr` — **Adaptar**

## 4. Límites y moderación

- [ ] Límite de peticiones activas por usuario (por defecto 25) — **Mantener**
- [ ] Límite global de peticiones activas (por defecto 100) — **Mantener**
- [ ] Interruptores para activar o desactivar cada límite, con estado guardado — **Mantener**
- [ ] Avisos en el chat cuando se alcanza un límite — **Mantener**
- [ ] Lista negra / ban de canciones con un clic: se saltan y se eliminan de la cola — **Mantener**
- [ ] Mensajes del bot editables por idioma — **Mantener**
- [ ] Activar o desactivar cada mensaje del bot sin borrar su texto — **Mantener**

## 5. Historial de peticiones

- [ ] Guardar canciones únicas pedidas desde el chat — **Mantener**
- [ ] Búsqueda y filtros por usuario y por fecha — **Mantener**
- [ ] Marcar favoritos en el historial — **Mantener**
- [ ] Volver a añadir una canción del historial a la cola — **Mantener**

## 6. Biblioteca local (nueva)

- [ ] Elegir una carpeta local con música — **Mantener** (requerimiento nuevo)
- [ ] Escaneo recursivo de la carpeta y detección de cambios — **Mantener** (requerimiento nuevo)
- [ ] Reproducir archivos locales en el panel y en la lista base — **Mantener** (requerimiento nuevo)
- [ ] Buscar y añadir pistas locales a la cola por título o artista — **Mantener** (requerimiento nuevo)
- [ ] Usar la carpeta local como lista base de fallback — **Mantener** (requerimiento nuevo)

## 7. Panel de control de la lista de reproducción (nuevo)

- [ ] Ver cola, lista base e historial en un único panel — **Mantener** (requerimiento nuevo)
- [ ] Reordenar, eliminar y saltar pistas desde el panel — **Mantener** (requerimiento nuevo)
- [ ] Gestionar listas base (añadir, quitar, activar) — **Mantener** (requerimiento nuevo)
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
