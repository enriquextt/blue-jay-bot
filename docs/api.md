# API de Blue Jay Bot

Contrato entre el servidor, el panel de control, el widget de OBS y los adaptadores de chat. Es el mismo para el backend en Node.js y en Python (ver `docs/propuesta.md`, sección 3.1).

Estado: **versión 0.3** (fases 0, 1, 2 y 3).

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
  "fallback": { "active": true, "mode": "shuffle" }
}
```

- `current` es `null` si no hay ninguna canción sonando.
- `queue` son las canciones pendientes, en orden de reproducción.
- `volume` es el volumen del reproductor, entero de 0 a 100. El panel lo aplica al reproductor de YouTube.
- `fallback` indica si la lista base está activa (`active`) y en qué `mode` (`sequential` o `shuffle`). No se guarda entre reinicios.
- `favorite` es `true` si el vídeo es un favorito de la lista base.

### `GET /api/baselist`

Devuelve la lista base (favoritos primero) y la lista negra. Es el mismo contenido que el mensaje WebSocket `baselist`.

```json
{
  "items": [{ "id": "c0de…", "source": "youtube", "videoId": "dQw4w9WgXcQ", "title": "Título", "favorite": true }],
  "banned": [{ "videoId": "aqz-KE-bpKQ", "title": "Otro título" }]
}
```

## 3. WebSocket

Ruta: `ws://<host>/ws`. Todos los cambios de estado se difunden a todos los clientes conectados.

### 3.1 Servidor → cliente

| `type` | Campos | Cuándo |
|---|---|---|
| `state` | `data`: `{ current, queue, volume, fallback }` | Al conectar y después de cada cambio de reproducción |
| `baselist` | `data`: `{ items, banned }` | Al conectar y después de cada cambio en la lista base o en la lista negra |
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
| `ban.remove` | `videoId` | Quita un vídeo de la lista negra |

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
| `errors.serverError` | Error interno inesperado |

## 4. Modelo de datos de una canción

```
Track {
  id:       string   UUID generado por el servidor
  source:   "youtube" (fase 1). "local" llegará en la fase 4
  origin:   "request" (cola de peticiones) | "base" (la eligió la lista base)
  videoId:  string   11 caracteres [A-Za-z0-9_-]
  title:    string   máximo 200 caracteres. Si no se puede obtener, es el videoId
  requestedBy: string | null   "<plataforma>:<usuario en minúsculas>", por ejemplo "twitch:ana". null si la añadió el panel o la lista base
  favorite: boolean  true si el vídeo es favorito en la lista base (solo en `state`)
}

BaseItem {
  id:       string   UUID generado al cargar o añadir; no se conserva entre reinicios
  source, videoId, title, favorite   como en Track
}
```

La lista base y la lista negra se guardan en `data/baselist.json` y `data/blacklist.json` (ignorados por git). Son listas de `{ videoId, title, favorite }` y `{ videoId, title }`. Las entradas con un `videoId` no válido se ignoran al cargar.

## 5. Validación y seguridad

- Los enlaces solo se aceptan de `youtube.com`, `m.youtube.com`, `music.youtube.com` y `youtu.be`. Se extrae el ID; nunca se usa la URL tal cual.
- El título se obtiene del endpoint público oEmbed de YouTube, sin clave de API. Si falla, se usa el ID.
- Los textos del panel se insertan siempre con `textContent`, nunca con `innerHTML`.
- El servidor solo sirve `public/` y los módulos de `node_modules` indicados. No hay listado de directorios.

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
| `!sr <enlace, ID o título>` | Todos | Añade la canción y responde con su posición. Si no es un enlace ni un ID, busca el título en YouTube (primer resultado incrustable). Rechaza las canciones de la lista negra |
| `!queue` | Todos | Canción actual y las 10 siguientes |
| `!when` | Todos | Cuántas canciones suenan antes de la última petición del usuario |
| `!voteskip` | Todos | Un voto por usuario y canción. Salta al llegar a `VOTE_SKIP_THRESHOLD` (por defecto 3) |
| `!wrongsong` | Todos | Retira la última petición del propio usuario |
| `!skip` | Moderadores | Salta la canción actual |
| `!volume [0-100]` | Todos para consultar, moderadores para cambiar | Consulta o ajusta el volumen |

### 6.3 Twitch

- Conexión IRC sobre WebSocket (`wss://irc-ws.chat.twitch.tv`) con los permisos `chat:read` y `chat:edit`.
- Configuración en `data/twitch.json` (ignorado por git): `channel`, `login`, `clientId`, `clientSecret` y `token`. Si el archivo no existe, el chat queda desactivado.
- Si Twitch rechaza el token, el servidor lo renueva con el `refresh_token` y reescribe el archivo.

### 6.4 Búsqueda en YouTube

- Usa `search.list` de YouTube Data API v3 con `type=video`, `videoEmbeddable=true` y `maxResults=1`. Cada búsqueda cuesta 100 unidades de cuota (el límite diario por defecto es 10.000, unas 100 búsquedas al día).
- La clave está en `data/youtube.json` (`{ "apiKey": "…" }`, ignorado por git). Sin clave, `!sr` solo acepta enlaces e IDs.
- Si la API falla (cuota agotada, clave inválida o red), el bot responde con un aviso y no toca la cola.

## 7. Pendiente

- *(fase 4)* Pistas de la carpeta local: `source: "local"`, con `id` generado en el escaneo. La ruta nunca sale del servidor. Se mezclan con las pistas de YouTube en la misma lista base.
- *(fase 5)* Persistencia entre reinicios de la cola, la canción actual, el volumen y `fallback` (hoy solo se guardan la lista base y la lista negra).
- Adaptadores de Kick y YouTube con el mismo contrato.
