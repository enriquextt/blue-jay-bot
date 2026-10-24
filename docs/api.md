# API de Blue Jay Bot

Contrato entre el servidor, el panel de control, el widget de OBS y los adaptadores de chat. Es el mismo para el backend en Node.js y en Python (ver `docs/propuesta.md`, sección 3.1).

Estado: **versión 0.1** (fases 0 y 1). Las secciones marcadas como *(fase 2)* están definidas pero aún no implementadas.

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
  "current": { "id": "3f2a…", "source": "youtube", "videoId": "dQw4w9WgXcQ", "title": "Título" },
  "queue": [
    { "id": "9b1c…", "source": "youtube", "videoId": "aqz-KE-bpKQ", "title": "Otro título" }
  ]
}
```

- `current` es `null` si no hay ninguna canción sonando.
- `queue` son las canciones pendientes, en orden de reproducción.

## 3. WebSocket

Ruta: `ws://<host>/ws`. Todos los cambios de estado se difunden a todos los clientes conectados.

### 3.1 Servidor → cliente

| `type` | Campos | Cuándo |
|---|---|---|
| `state` | `data`: `{ current, queue }` | Al conectar y después de cada cambio |
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
| `playback.ended` | `id` | El reproductor avisa de que la canción terminó. Si `id` no es la que suena, se ignora |
| `playback.unavailable` | `id` | El reproductor no puede reproducir la canción. Se salta y se envía un `notice`. Si `id` no es la que suena, se ignora |

Los comandos `playback.ended` y `playback.unavailable` son idempotentes: enviar dos veces el mismo `id` no salta dos canciones.

### 3.3 Errores

| `key` | Cuándo |
|---|---|
| `errors.invalidMessage` | El mensaje no es JSON válido o no tiene un `type` conocido |
| `errors.invalidUrl` | El enlace no es de YouTube o no contiene un ID válido |
| `errors.trackNotFound` | El `id` no existe en la cola (quizá ya se reprodujo) |
| `errors.serverError` | Error interno inesperado |

## 4. Modelo de datos de una canción

```
Track {
  id:       string   UUID generado por el servidor
  source:   "youtube" (fase 1). "local" llegará en la fase 4
  videoId:  string   11 caracteres [A-Za-z0-9_-]
  title:    string   máximo 200 caracteres. Si no se puede obtener, es el videoId
}
```

## 5. Validación y seguridad

- Los enlaces solo se aceptan de `youtube.com`, `m.youtube.com`, `music.youtube.com` y `youtu.be`. Se extrae el ID; nunca se usa la URL tal cual.
- El título se obtiene del endpoint público oEmbed de YouTube, sin clave de API. Si falla, se usa el ID.
- Los textos del panel se insertan siempre con `textContent`, nunca con `innerHTML`.
- El servidor solo sirve `public/` y los módulos de `node_modules` indicados. No hay listado de directorios.

## 6. Pendiente

- *(fase 2)* Mensajes de chat normalizados desde los adaptadores: `{ platform, user, text }`. Primer adaptador: **Twitch**. Kick y YouTube quedan para después, con el mismo contrato.
- *(fase 2)* Comandos `!sr`, `!queue`, `!when`, `!skip`, `!voteskip`, `!wrongsong`, `!volume`.
- *(fase 3)* Listas base con playlists de YouTube. Se mezclan con las pistas locales en una sola lista base.
- *(fase 4)* Pistas de la carpeta local: `source: "local"`, con `id` generado en el escaneo. La ruta nunca sale del servidor.
- Persistencia de la cola entre reinicios del servidor (fase 5 o posterior).
