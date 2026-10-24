# Propuesta: Blue Jay Bot

Documento vivo. Cada decisión importante se anota aquí con fecha.

## 1. Objetivo

Crear un servidor local de peticiones de canciones para directos, inspirado en Better Song Request (`better-sr/`), pero independiente de Streamer.bot. El servidor debe poder ejecutarse con **Node.js** o con **Python**, y ofrecer:

- Peticiones de canciones desde el chat (`!sr`, comandos y recompensas).
- Lista base de reproducción de respaldo.
- Panel de control para gestionar la cola y la lista de reproducción.
- Soporte de **carpeta local con música**.
- Interfaz en **español** con soporte de **inglés** mediante un sistema i18n.
- Widget compacto para OBS.

## 2. Alcance

| Dentro del alcance inicial | Fuera del alcance inicial |
|---|---|
| Servidor HTTP + WebSocket propio | Reproducción nativa de Spotify (fase posterior) |
| Cola de peticiones y lista base | Editor visual del widget (fase posterior) |
| YouTube como fuente de reproducción | Idiomas adicionales al español e inglés |
| Biblioteca de música local | Cuentas de usuario o servicio en la nube |
| Panel de control | |
| Comandos básicos de chat y límites | |
| Widget de OBS básico | |

Las funcionalidades y su estado están en `docs/checklist.md`.

## 3. Decisiones propuestas

### 3.1 Runtime y framework

**Recomendado: Node.js 20+** con los siguientes paquetes:

| Necesidad | Propuesta | Motivo |
|---|---|---|
| Servidor HTTP | Fastify + `@fastify/static` | Rápido, soporta peticiones `Range` para reproducir audio local |
| Tiempo real | `ws` | Ligero, sin dependencias pesadas, compatible con el widget de OBS |
| Persistencia | SQLite (`better-sqlite3`) | Un único archivo, sin servidor externo, consultas para historial |
| Metadatos de audio | `music-metadata` | Lee título, artista y duración de archivos locales |
| Vigilancia de carpetas | `chokidar` | Detecta cambios en la carpeta de música |
| i18n | `i18next` | Estándar, funciona en servidor y en navegador |
| Arrastrar y soltar | `SortableJS` | Reordenar la cola sin framework |
| Interfaz | JavaScript modular sin framework en el MVP | Menos complejidad; migrable a un framework si el panel crece |

**Alternativa: Python 3.11+**, con las mismas responsabilidades:

| Necesidad | Propuesta Python |
|---|---|
| Servidor | FastAPI + Uvicorn |
| Tiempo real | WebSocket nativo de FastAPI |
| Persistencia | `sqlite3` (biblioteca estándar) |
| Metadatos | `mutagen` |
| Vigilancia | `watchdog` |
| i18n | JSON compartido con el frontend |

Para evitar duplicar trabajo, el **contrato de la API REST y del WebSocket** se documenta en un único archivo (`docs/api.md`, versión 0.1). El frontend es el mismo con cualquiera de los dos backends.

### 3.2 Chat y Streamer.bot

**Decidido:** conexión directa mediante adaptadores (`server/chat/`). Streamer.bot no es dependencia del proyecto.

- **Primer adaptador: Twitch** (fase 2).
- Kick y YouTube quedan pendientes. Se añadirán después con el mismo contrato.
- Todos los adaptadores emiten comandos normalizados (`{ platform, user, text }`) al núcleo. Ver `docs/api.md`.

### 3.3 Estructura del proyecto

```
blue-jay-bot/
├── agents.md
├── package.json
├── server/
│   ├── index.js              Arranque del servidor
│   ├── config/               Carga de configuración y validación
│   ├── http/                 Rutas REST y servido de archivos estáticos
│   ├── ws/                   Canal WebSocket (panel, widget, chat)
│   ├── queue/                Cola de peticiones y lógica de orden
│   ├── playlist/             Listas base (YouTube y local)
│   ├── youtube/              Lectura de IDs y títulos de YouTube
│   ├── library/              Escaneo y metadatos de la carpeta local
│   ├── commands/             !sr, !when, !queue, !voteskip, !skip, !wrongsong, !volume
│   ├── chat/                 Adaptadores: Twitch (primero), Kick, YouTube
│   ├── limits/               Límites de peticiones por usuario y global
│   ├── history/              Historial de peticiones
│   └── db/                   Acceso a SQLite y migraciones
├── public/
│   ├── index.html            Panel de control
│   ├── widget.html           Widget de OBS
│   ├── js/                   Módulos del panel, reproductor y widget
│   ├── css/
│   └── locales/
│       ├── es.json
│       └── en.json
├── docs/
│   ├── checklist.md
│   ├── propuesta.md
│   └── api.md
├── data/                     Base de datos y ajustes locales (ignorado por git)
└── music/                    Carpeta de música de ejemplo (ignorada por git)
```

Esta estructura es la misma en Python, cambiando `server/*.js` por `server/*.py`.

### 3.4 Reproducción

- **YouTube**: se reproduce con la YouTube IFrame Player API dentro de la página del panel. Hay que respetar sus términos de uso.
- **Local**: el servidor entrega el archivo con soporte de `Range` y el navegador lo reproduce con `<audio>`. La ruta nunca viene del cliente: se identifica cada pista por un `id` generado en el escaneo.
- **Spotify**: fase posterior. Requiere Premium y Web Playback SDK.

### 3.5 Carpeta local de música

1. El usuario indica la carpeta en Ajustes. Se guarda en `data/config`.
2. Al arrancar se escanea de forma recursiva. Formatos iniciales: `.mp3`, `.flac`, `.ogg`, `.m4a`, `.wav`.
3. `chokidar` / `watchdog` mantiene el índice actualizado.
4. Cada pista se guarda en SQLite con su ruta relativa, título, artista y duración.
5. Se puede añadir a la cola o usar la carpeta como lista base.
6. La lista base es única: puede mezclar pistas de playlists de YouTube y de la carpeta local.

### 3.6 Panel de control

Secciones: **Cola**, **Lista base**, **Biblioteca local**, **Historial**, **Ajustes**. El panel se comunica con el servidor por WebSocket; los cambios se reflejan en todos los paneles abiertos.

### 3.7 Idioma (i18n)

- Idioma por defecto: `es`. Idioma secundario: `en`.
- Las claves se nombran por sección, por ejemplo `queue.empty` o `chat.sr.limitReached`.
- Los mensajes del bot en el chat usan las mismas claves, con plantillas para variables (`{user}`, `{position}`).
- El idioma se detecta por la configuración guardada y puede cambiarse desde el panel.
- Regla: ninguna cadena visible queda fuera de los archivos de locales (ver `agents.md`).

## 4. Fases

| Fase | Contenido | Resultado esperado |
|---|---|---|
| 0. Base | Proyecto Node, servidor HTTP + WebSocket, i18n es/en, panel vacío | Página que carga en español e inglés |
| 1. Cola y reproducción | Cola, arrastrar y soltar, reproducción de YouTube, auto-skip | Peticiones manuales funcionando |
| 2. Chat | Comandos `!sr`, `!queue`, `!when`, `!skip`, `!voteskip`, `!wrongsong`, `!volume` con el adaptador de Twitch | Peticiones desde el chat |
| 3. Lista base y favoritos | Playlists de YouTube, START/SHUFFLE, favoritos, lista negra | Fallback automático |
| 4. Biblioteca local | Escaneo, reproducción local, búsqueda, carpeta como lista base | Música local en el panel |
| 5. Límites e historial | Límites por usuario y global, historial con filtros | Control de peticiones |
| 6. Widget OBS | Widget compacto, WebSocket en vivo, prueba | Widget en OBS |
| 7. Operación | Diagnóstico, exportar e importar ajustes | Mantenimiento sencillo |
| 8. Opcional | Spotify, editor de widget, adaptadores de Kick y YouTube (chat) | Ampliaciones |

## 5. Requisitos no funcionales

- **Local primero**: los datos y las claves de API se quedan en la máquina del streamer.
- **Seguridad**: validar toda entrada del chat y de la carpeta local; no exponer rutas del sistema; no incluir secretos en exportaciones.
- **Rendimiento**: el escaneo de la biblioteca no debe bloquear el servidor; el WebSocket envía solo cambios de estado.
- **Compatibilidad**: navegador moderno y OBS (fuente de navegador).
- **Mantenibilidad**: cada funcionalidad en su módulo; sin lógica de negocio en las rutas HTTP.

## 6. Licencia

El código de `better-sr/` es **GPL-3.0**. **Decidido:** el proyecto nuevo usa la misma licencia, GPL-3.0 (ver `LICENSE`).

## 7. Preguntas abiertas

Todas las preguntas están respondidas. Las decisiones se reflejan en las secciones 3 y 6.

1. **¿Node.js o Python?** Node.js. Ver 3.1.
2. **¿Streamer.bot como puente o conexión directa?** Conexión directa a Twitch, Kick y YouTube. Streamer.bot no forma parte del proyecto nuevo. Ver 3.2.
3. **¿Spotify en el alcance inicial?** No. Queda para una fase posterior (ver 2 y 4, fase 8).
4. **¿Licencia del proyecto nuevo?** La misma que `better-sr/`: GPL-3.0. Ver 6.
5. **¿La lista base local se mezcla con las playlists de YouTube?** Sí. La lista base es única y puede contener pistas de YouTube y de la carpeta local. Ver 3.5.

## Registro de decisiones

| Fecha | Decisión |
|---|---|
| 2026-10-24 | Creación del documento. Propuesta inicial: Node.js, Fastify, ws, SQLite, i18next, widget OBS. Python como alternativa. |
| 2026-10-24 | Respuestas a preguntas abiertas: Node.js; conexión directa a Twitch, Kick y YouTube (sin Streamer.bot); Spotify en fase posterior; licencia GPL-3.0; lista base única que mezcla YouTube y carpeta local. |
| 2026-10-24 | Primer adaptador de chat: Twitch. Kick y YouTube pendientes, con el mismo contrato. Creado `docs/api.md` v0.1. |
| 2026-10-24 | Fases 0 y 1 implementadas: servidor Fastify + ws, panel con i18n (es/en), cola en memoria, reproducción de YouTube, reordenado y auto-skip. Sin persistencia de cola todavía. |
