# API de Blue Jay Bot

Contrato entre el servidor, el panel de control, el widget de OBS y los adaptadores de chat. Es el mismo para el backend en Node.js y en Python (ver `docs/propuesta.md`, sección 3.1).

Estado: **versión 0.5** (fases 0 a 4.5).

## 1. Convenciones

- Dirección por defecto: `http://127.0.0.1:3000`. Configurable con las variables de entorno `HOST` y `PORT`.
- Formato: JSON en UTF-8.
- **El servidor nunca envía texto visible en español o inglés.** Los mensajes de error y de aviso llevan una `key` de i18n (por ejemplo `errors.invalidUrl`) y `params` opcionales. El cliente la traduce con `public/locales/`.
- Los identificadores son UUID generados por el servidor. El cliente nunca envía rutas de archivo.

## 2. REST

### `GET /api/state`

Devuelve la foto actual de la reproducción.

```json
{
  "current": { "id": "3f2a…", "source": "youtube", "origin": "base", "videoId": "dQw4w9WgXcQ", "title": "Título", "requestedBy": null, "favorite": true },
  "queue": [
    { "id": "9b1c…", "source": "youtube", "origin": "request", "videoId": "aqz-KE-bpKQ", "title": "Otro título", "requestedBy": "twitch:ana", "favorite": false }
  ],
  "volume": 50,
  "fallback": { "active": true, "mode": "shuffle", "includeLibrary": false }
}
```

- `current` es `null` si no hay ninguna canción sonando.
- `queue` son las canciones pendientes, en orden de reproducción.
- `volume` es el volumen del reproductor, entero de 0 a 100. El panel lo aplica al reproductor de YouTube.
- `fallback` indica si la lista base está activa (`active`), en qué `mode` (`sequential` o `shuffle`) y si incluye toda la biblioteca local (`includeLibrary`). No se guarda entre reinicios.
- `favorite` es `true` si la pista es un favorito de la lista base.
- Una pista local lleva `source: "local"`, `localId` y `artist` en lugar de `videoId` (ver sección 4).

### `GET /api/baselist`

Devuelve la lista base (favoritos primero) y la lista negra. Es el mismo contenido que el mensaje WebSocket `baselist`.

```json
{
  "items": [{ "id": "c0de…", "source": "youtube", "videoId": "dQw4w9WgXcQ", "title": "Título", "favorite": true }],
  "banned": [{ "key": "youtube:aqz-KE-bpKQ", "source": "youtube", "videoId": "aqz-KE-bpKQ", "title": "Otro título" }]
}
```

### `GET /media/:id`

Entrega el archivo de una pista de la biblioteca local. `:id` es el `localId` de la pista; el servidor busca la ruta en su índice, así que nunca interpreta una ruta del cliente.

- Responde `200` con el tipo de audio del archivo, o `206` si la petición lleva `Range` (el navegador lo usa para saltar a un punto de la pista).
- Responde `404` si el id no existe, si no hay carpeta configurada o si el archivo ya no está dentro de la carpeta.

## 3. WebSocket

Ruta: `ws://<host>/ws`. Todos los cambios de estado se difunden a todos los clientes conectados.

### 3.1 Servidor → cliente

| `type` | Campos | Cuándo |
|---|---|---|
| `state` | `data`: `{ current, queue, volume, fallback }` | Al conectar y después de cada cambio de reproducción |
| `baselist` | `data`: `{ items, banned }` | Al conectar y después de cada cambio en la lista base o en la lista negra |
| `library` | `data`: `{ configured, folderName, status, count }` | Al conectar y cuando cambia la carpeta o el escaneo. `status` es `none`, `scanning`, `ready` o `error`. `folderName` es solo el nombre de la carpeta, nunca la ruta |
| `library.results` | `query`, `items`, `total` | Respuesta a `library.search`. Solo llega al cliente que preguntó. Cada ítem es `{ id, source, localId, title, artist, duration, favorite }` con `id` igual a `localId` y `duration` en segundos (`null` si se desconoce) |
| `notice` | `key`, `params?` | Aviso informativo (por ejemplo, saltada una canción no disponible) |
| `error` | `key`, `params?` | El comando recibido no se pudo aplicar. Solo llega al cliente que lo envió |

Ejemplo de aviso:

```json
{ "type": "notice", "key": "notices.skippedUnavailable", "params": { "title": "Título" } }
```

### 3.2 Cliente → servidor

| `type` | Campos | Efecto |
|---|---|---|
| `queue.add` | `url` (string, máximo 500 caracteres) | Añade una canción de YouTube al final de la cola. Acepta URL o ID de 11 caracteres. Si no hay nada sonando, empieza a sonar |
| `queue.remove` | `id` | Quita la canción de la cola. Si es la que suena, pasa a la siguiente |
| `queue.move` | `id`, `toIndex` (entero) | Mueve una canción de la cola a esa posición (0 = primera pendiente) |
| `playback.next` | — | Salta la canción que suena |
| `playback.volume` | `volume` (entero 0–100) | Ajusta el volumen global y lo difunde en `state`. Fuera de rango o no entero: `errors.invalidMessage` |
| `playback.ended` | `id` | El reproductor avisa de que la canción terminó. Si `id` no es la que suena, se ignora |
| `playback.unavailable` | `id` | El reproductor no puede reproducir la canción. Se salta y se envía un `notice`. Si `id` no es la que suena, se ignora |
| `baselist.add` | `url` (string, máximo 500 caracteres) | Añade a la lista base un vídeo (URL o ID) o una playlist de YouTube (URL de `/playlist` o con `list` sin `v`, o ID que empiece por `PL`, `UU`, `FL` u `OL`). Una URL de vídeo con `list` cuenta como vídeo. Las playlists exigen la clave de API, importan hasta 1.000 vídeos, omiten duplicados y vetados, y devuelven al cliente un `notice` `notices.playlistImported` con `added` y `total` |
| `baselist.remove` | `id` | Quita una pista de la lista base |
| `baselist.clear` | — | Vacía la lista base |
| `baselist.start` | `mode`: `sequential` o `shuffle` | Activa la lista base. Si no suena nada, empieza a sonar. `sequential` sigue el orden de la lista (favoritos primero); `shuffle` recorre todas en aleatorio sin repetir hasta acabar |
| `baselist.stop` | — | Desactiva la lista base. La canción que suena no se interrumpe |
| `favorite.set` | `id`, `favorite` (booleano) | Marca o desmarca un favorito. `id` puede ser la canción actual, una de la cola o una de la lista base. Si se marca una canción que no está en la lista base, entra en ella |
| `ban.add` | `id` | Veta el vídeo de una canción actual, de la cola o de la lista base: lo quita de la cola (si suena, pasa a la siguiente) y de la lista base, y lanza `notices.banned` |
| `ban.remove` | `key` | Quita una pista de la lista negra. `key` es la que lleva cada entrada de `banned` (`youtube:<videoId>` o `local:<localId>`) |
| `baselist.includeLibrary` | `enabled` (booleano) | Incluye o no toda la biblioteca local en la lista base, sin copiarla a ella. Las pistas vetadas quedan fuera |
| `library.setFolder` | `path` (string, ruta absoluta, máximo 1.024 caracteres) | Cambia la carpeta de música, la guarda y la escanea. Solo la acepta un cliente conectado desde el propio equipo (loopback); si no, `errors.localOnly`. Si no existe, no es absoluta o no es una carpeta: `errors.folderInvalid` |
| `library.rescan` | — | Vuelve a escanear la carpeta |
| `library.search` | `query` (string, máximo 100 caracteres) | Busca por título, artista, álbum, comentario, descripción, subtítulo y nombre de archivo, sin distinguir mayúsculas ni acentos. Todos los términos deben aparecer, cada uno en cualquier campo. Ordena por relevancia (título, luego artista, luego el resto) y devuelve `library.results` con hasta 50 pistas (las vetadas no salen). Una consulta vacía lista las primeras por orden alfabético. Esta búsqueda del panel no es estricta: un título corto basta (ver `!sr` en la sección 6.2) |
| `library.queue` | `id` (`localId`) | Añade la pista local al final de la cola. Si está vetada, `errors.trackBanned` |
| `library.addToBaseList` | `id` (`localId`) | Añade la pista local a la lista base sin marcarla como favorita (si ya está, no hace nada). Si está vetada, `errors.trackBanned`; si la lista está llena, `errors.baseListFull` |

Los comandos `playback.ended` y `playback.unavailable` son idempotentes: enviar dos veces el mismo `id` no salta dos canciones.

Reglas de la lista base:

- Una petición de la cola no interrumpe la canción de la lista base que suena; sigue después de que acabe.
- Si `playback.unavailable` llega para una pista con `origin: "base"`, esa pista se retira de la lista base.
- La lista base admite un máximo de 2.000 pistas.

### 3.3 Errores

| `key` | Cuándo |
|---|---|
| `errors.invalidMessage` | El mensaje no es JSON válido o no tiene un `type` conocido |
| `errors.invalidUrl` | El enlace no es de YouTube o no contiene un ID válido |
| `errors.trackNotFound` | El `id` o el `videoId` no existe (quizá ya se reprodujo o se quitó) |
| `errors.trackBanned` | El vídeo está en la lista negra |
| `errors.baseListFull` | La lista base ya tiene 2.000 pistas |
| `errors.apiKeyMissing` | Se pidió importar una playlist y no hay clave de YouTube Data API |
| `errors.playlistFailed` | La API de YouTube falló al leer la playlist (privada, inexistente, cuota o red) |
| `errors.playlistEmpty` | La playlist no tiene vídeos disponibles |
| `errors.localOnly` | Se intentó cambiar la carpeta de música desde otro equipo |
| `errors.folderInvalid` | La carpeta no existe, no es una ruta absoluta o no se puede leer |
| `errors.serverError` | Error interno inesperado |

## 4. Modelo de datos de una canción

```
Track {
  id:       string   UUID generado por el servidor
  source:   "youtube" | "local"
  origin:   "request" (cola de peticiones) | "base" (la eligió la lista base)
  videoId:  string   solo YouTube: 11 caracteres [A-Za-z0-9_-]
  localId:  string   solo local: 24 caracteres hexadecimales (SHA-256 de la ruta relativa, recortado)
  artist:   string | null   solo local: de las etiquetas del archivo o, si faltan, del nombre del archivo o de la carpeta
  duration: number | null   solo en los resultados de `library.search`: segundos, null si se desconoce
  title:    string   máximo 200 caracteres. En YouTube, si no se puede obtener, es el videoId
  requestedBy: string | null   "<plataforma>:<usuario en minúsculas>", por ejemplo "twitch:ana". null si la añadió el panel o la lista base
  favorite: boolean  true si la pista es favorita en la lista base (solo en `state`)
}

BaseItem {
  id:       string   UUID generado al cargar o añadir; no se conserva entre reinicios
  source, videoId | localId, artist, title, favorite   como en Track
}

Clave de pista (`key`)  identifica una pista aunque cambie su `id`: `youtube:<videoId>` o `local:<localId>`.
                        La usan la lista base, la cola y la lista negra.
```

La lista base y la lista negra se guardan en `data/baselist.json` y `data/blacklist.json` (ignorados por git). Son listas de `{ source?, videoId | localId, artist?, title, favorite }` y `{ source?, videoId | localId, artist?, title }`. Sin `source` se asume YouTube, así que los archivos guardados en la fase 3 siguen siendo válidos. Las entradas con un `videoId` o `localId` no válido se ignoran al cargar.

La carpeta de música se guarda en `data/library.json` (`{ "folder": "…" }`, ignorado por git). El índice de pistas vive en memoria y se reconstruye al arrancar.

## 5. Validación y seguridad

- Los enlaces solo se aceptan de `youtube.com`, `m.youtube.com`, `music.youtube.com` y `youtu.be`. Se extrae el ID; nunca se usa la URL tal cual.
- El título se obtiene del endpoint público oEmbed de YouTube, sin clave de API. Si falla, se usa el ID.
- Los textos del panel se insertan siempre con `textContent`, nunca con `innerHTML`.
- El servidor solo sirve `public/`, los módulos de `node_modules` indicados y los archivos de la biblioteca por su `localId`. No hay listado de directorios.
- Biblioteca local (entrada no confiable):
  - Ninguna ruta del sistema sale del servidor: `library` solo envía el nombre de la carpeta y las pistas solo llevan su id.
  - La carpeta solo se puede cambiar desde el propio equipo (loopback), aunque el servidor escuche en otra dirección.
  - El escaneo ignora enlaces simbólicos y archivos o carpetas ocultos (los que empiezan por `.`), y se limita a 12 niveles y 50.000 pistas.
  - Antes de servir un archivo se comprueba con `realpath` que sigue dentro de la carpeta, por si lo sustituyeron por un enlace.
  - Formatos aceptados: `.mp3`, `.flac`, `.ogg`, `.m4a` y `.wav`.
  - Las etiquetas son entrada no confiable: se recortan (título y artista a 200 caracteres, cada nota a 500, hasta 10 notas) y el panel las muestra siempre con `textContent`. Un archivo ilegible o sin etiquetas se indexa con los datos de su nombre.

## 6. Chat

### 6.1 Mensaje normalizado

Cada adaptador (`server/chat/`) entrega al núcleo:

```json
{ "platform": "twitch", "user": "ana", "text": "!sr dQw4w9WgXcQ", "isMod": false }
```

- `user` es el nombre de usuario en minúsculas.
- `isMod` es `true` para moderadores y para el propietario del canal.
- El adaptador envía de vuelta el texto de respuesta; el núcleo ya lo entrega traducido (claves `chat.*` de `public/locales/`, idioma de la variable `LANGUAGE`, por defecto `es`).

### 6.2 Comandos

| Comando | Quién | Efecto |
|---|---|---|
| `!sr <enlace, ID o texto>` | Todos | Añade la canción y responde con su posición. Si no es un enlace ni un ID, **busca primero en la biblioteca local** (mejor coincidencia) y, solo si no hay ninguna, busca el texto en YouTube (primer resultado incrustable). Los enlaces y los ID van siempre a YouTube. Rechaza las canciones de la lista negra. La búsqueda local es estricta (ver debajo) |
| `!local <texto>` | Todos | Añade la mejor coincidencia de la biblioteca local, buscando por título, artista, álbum, comentario o descripción. Nunca consulta YouTube. Si no hay biblioteca o está vacía, avisa de que no está disponible. La búsqueda local es estricta (ver debajo) |
| `!queue` | Todos | Canción actual y las 10 siguientes |
| `!when` | Todos | Cuántas canciones suenan antes de la última petición del usuario |
| `!voteskip` | Todos | Un voto por usuario y canción. Salta al llegar a `VOTE_SKIP_THRESHOLD` (por defecto 3) |
| `!wrongsong` | Todos | Retira la última petición del propio usuario |
| `!skip` | Moderadores | Salta la canción actual |
| `!volume [0-100]` | Todos para consultar, moderadores para cambiar | Consulta o ajusta el volumen |

**Búsqueda estricta (`!sr` y `!local`).** Para que un texto corto del chat no acabe en la pista equivocada, una palabra que solo aparece en textos de **menos de 10 caracteres** (un título corto, una nota —comentario, descripción o subtítulo— corta o el nombre del archivo) no vale por sí sola: hace falta que otra palabra de la búsqueda coincida con el **artista o el álbum**. Las coincidencias en el artista o el álbum no tienen restricción, y un título o una nota de 10 o más caracteres valen solos. El nombre del archivo nunca cuenta como largo. Por ejemplo, con dos pistas llamadas «Love», `!sr love` no encuentra ninguna, y `!sr love beatles` encuentra la de Beatles. Si no hay coincidencia, `!sr` pregunta a YouTube y `!local` sugiere añadir el artista o el álbum.

### 6.3 Twitch

- Conexión IRC sobre WebSocket (`wss://irc-ws.chat.twitch.tv`) con los permisos `chat:read` y `chat:edit`.
- Configuración en `data/twitch.json` (ignorado por git): `channel`, `login`, `clientId`, `clientSecret` y `token`. Si el archivo no existe, el chat queda desactivado.
- Si Twitch rechaza el token, el servidor lo renueva con el `refresh_token` y reescribe el archivo.

### 6.4 Búsqueda en YouTube

- Usa `search.list` de YouTube Data API v3 con `type=video`, `videoEmbeddable=true` y `maxResults=1`. Cada búsqueda cuesta 100 unidades de cuota (el límite diario por defecto es 10.000, unas 100 búsquedas al día).
- La clave está en `data/youtube.json` (`{ "apiKey": "…" }`, ignorado por git). Sin clave, `!sr` solo acepta enlaces e IDs.
- Si la API falla (cuota agotada, clave inválida o red), el bot responde con un aviso y no toca la cola.

## 7. Pendiente

- *(fase 5)* Persistencia entre reinicios de la cola, la canción actual, el volumen y `fallback` (hoy solo se guardan la lista base y la lista negra).
- Adaptadores de Kick y YouTube con el mismo contrato.
