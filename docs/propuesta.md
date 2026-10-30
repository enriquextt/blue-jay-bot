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
3. `fs.watch` recursivo mantiene el índice actualizado (decidido en la fase 4: sin `chokidar`; con un cambio se espera 1 s y se reescanea).
4. El índice vive en memoria y se reconstruye al arrancar. Cada pista tiene ruta relativa, título, artista, álbum, duración y notas (comentario, descripción, subtítulo). Salen de las etiquetas del archivo (fase 4.5) y, si faltan, del nombre del archivo y de la carpeta. Se decidió mantenerlo en memoria (ver el registro de decisiones, fase 5).
5. Se puede añadir a la cola o usar la carpeta como lista base.
6. La lista base es única: puede mezclar pistas de playlists de YouTube y de la carpeta local.

### 3.6 Panel de control

Dos columnas (decidido en la fase 5.5): a la izquierda, un tercio con **Sonando ahora**, **Añadir canción** y **Cola**; a la derecha, dos tercios con las pestañas **Lista base**, **Biblioteca local**, **Historial**, **Listas**, **Lista negra**, **Mensajes** y **Ajustes**. Por debajo de 900 px de ancho las columnas se apilan. El panel se comunica con el servidor por WebSocket; los cambios se reflejan en todos los paneles abiertos.

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
| 4.5. Etiquetas y chat local | Lectura de etiquetas (título, artista, álbum, duración, comentario, descripción y subtítulo) con `music-metadata`, búsqueda por relevancia que usa comentario y descripción como títulos alternativos, comando `!local`, prioridad de la biblioteca local en `!sr` (con una regla para que un texto corto no encuentre la pista equivocada: una etiqueta de menos de 10 caracteres exige que coincida también el artista o el álbum) y botón para añadir pistas sueltas a la lista base | Pistas locales identificables desde el chat y por sus etiquetas |
| 5. Límites, historial y persistencia | SQLite (`data/blue-jay.db`): límites por usuario y global, interruptor de peticiones del chat, historial de peticiones (con su resultado) y de reproducción con filtros y borrado, listas de reproducción propias, y persistencia entre reinicios de la cola, la canción actual, el volumen y el modo START/SHUFFLE | Control de peticiones y reinicios sin perder la cola |
| 5.5. Mensajes del bot | Mensajes del chat editables por idioma y activables o desactivables uno a uno, con vista previa; panel en dos columnas (1/3 y 2/3) | El streamer decide qué dice el bot y con qué palabras |
| 6. Widget OBS | Widget compacto, WebSocket en vivo, prueba | Widget en OBS (hecha) |
| 7. Operación | Diagnóstico, exportar e importar ajustes, y controles del panel (reordenar, eliminar y saltar pistas; play, pausa, siguiente, aleatorio) | Mantenimiento sencillo y panel completo |
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
| 2026-10-24 | Fase 2 implementada. Adaptador de Twitch con IRC sobre WebSocket usando `ws` (sin dependencias nuevas; evita añadir `tmi.js` o `@twurple/chat`). Credenciales y token OAuth en `data/twitch.json` (ignorado por git), con renovación automática mediante el refresh token. Respuestas del bot traducidas en el servidor con `i18next` y las mismas claves `chat.*` de `public/locales/`. `!skip` y `!volume` (para cambiar) solo moderadores y propietario; `!voteskip` con umbral configurable (`VOTE_SKIP_THRESHOLD`, por defecto 3). `!sr` acepta solo enlaces o ID: la búsqueda por título espera a la clave de YouTube Data API. |
| 2026-10-24 | `!sr` busca por título con `search.list` de YouTube Data API v3 (primer resultado incrustable, 100 unidades de cuota por búsqueda). La clave se guarda en `data/youtube.json`, separada de las credenciales de Twitch. Sin clave, `!sr` solo acepta enlaces. |
| 2026-10-24 | Fase 3 implementada. Lista base única en `data/baselist.json` y lista negra en `data/blacklist.json`, como JSON con escritura atómica (sin dependencias nuevas; SQLite se reevalúa en la fase 5 con el historial). La cola recibe un proveedor de fallback: la petición de un viewer espera a que acabe la canción actual, sea de la lista base o no. START reproduce en orden (favoritos primero) y SHUFFLE en aleatorio sin repetir hasta recorrer toda la lista; ambos quedan activos hasta pulsar Parar y no se guardan entre reinicios. Marcar favorita una canción de la cola o la actual la añade a la lista base. Las playlists se importan con `playlistItems.list` (1 unidad de cuota por 50 vídeos, tope de 1.000 por importación) y la lista base admite 2.000 pistas. Vetar una canción la quita de la cola, la lista base y las peticiones futuras. Una pista de la lista base que el reproductor marca como no disponible se retira de la lista para no reintentarla. El estado de la lista base viaja en un mensaje `baselist` aparte de `state`, para no reenviar miles de pistas en cada cambio. |
| 2026-10-24 | La persistencia de la cola, la canción actual, el volumen y el modo START/SHUFFLE queda asignada a la fase 5, junto con el historial, para decidir una sola vez entre SQLite y JSON. Hasta entonces solo persisten la lista base y la lista negra. |
| 2026-10-24 | Fase 4 implementada. La carpeta de música se indica en el panel con `library.setFolder`, que solo acepta clientes de loopback, y se guarda en `data/library.json`; el cliente nunca elige archivos, solo ids. Índice en memoria, sin dependencias nuevas: `fs.watch` recursivo con reescaneo completo (espera de 1 s) en lugar de `chokidar`, y título y artista a partir del nombre (`Artista - Título`, o la carpeta como artista; el número de pista no cuenta) en lugar de una biblioteca de etiquetas; leer ID3 queda como opcional. El id de pista es el SHA-256 de la ruta relativa recortado a 24 caracteres, estable entre reinicios y sin revelar la ruta. El servidor entrega `GET /media/:id` con soporte de `Range`: ignora enlaces simbólicos al escanear, no indexa archivos ocultos y comprueba con `realpath` que el archivo sigue dentro de la carpeta antes de servirlo. Una pista de la lista base se identifica con una clave (`youtube:<id>` o `local:<id>`); los datos guardados antes siguen siendo válidos. Las pistas locales ausentes de la biblioteca se saltan sin borrarlas de la lista base, y al no estar disponible una local no se retira (solo las de YouTube). La opción «incluir la biblioteca en la lista base» añade al fallback toda la biblioteca sin copiarla a la lista, que sigue limitada a 2.000 pistas. |
| 2026-10-24 | Fase 4.5 planificada e implementada. Se añade la dependencia `music-metadata` (MIT, licencia compatible con GPL-3.0), fijada en `^11.16.1` porque la 12 exige Node 22 y el proyecto declara Node 20 o superior; sin ella no hay forma fiable de leer ID3v2, Vorbis ni MP4. El índice se hace en dos fases: primero por nombre de archivo, con lo que ya se puede buscar, y después con las etiquetas, leídas 6 a la vez y con una caché en memoria por ruta, tamaño y fecha de modificación, de modo que los reescaneos solo releen archivos nuevos o cambiados. Los ids no dependen de las etiquetas, así que favoritos, lista base y lista negra no se rompen al editarlas. Un archivo sin etiquetas o ilegible conserva los datos de su nombre. Los comentarios, descripciones y subtítulos se leen también de las etiquetas nativas (por ejemplo `TXXX:description` de ID3, que `music-metadata` no pasa a sus campos comunes) y cuentan como títulos alternativos. La búsqueda exige que todas las palabras aparezcan, cada una en cualquier campo, y ordena por relevancia (título 3, artista 2, notas, álbum y nombre de archivo 1, más un extra si el título coincide entero o por el principio). `!sr` busca primero en la biblioteca y solo pregunta a YouTube si no hay coincidencia; los enlaces y los ID van siempre a YouTube. `!local` busca solo en la biblioteca y nunca consulta YouTube. Ambos descartan las pistas vetadas. La caché de etiquetas no se guarda en disco: se reconstruye al arrancar. |
| 2026-10-24 | Regla de etiquetas cortas en la búsqueda del chat (fase 4.5). Si una palabra de `!sr` o `!local` solo coincide con un texto de menos de 10 caracteres (título, nota o nombre de archivo), hace falta que otra palabra coincida con el artista o el álbum. Las etiquetas de artista y álbum no tienen restricción, las de 10 o más caracteres valen solas y el nombre de archivo, que no es una etiqueta, nunca cuenta como largo (si no, «Beatles - Love.mp3» esquivaría la regla). Se aplica por igual al título que sale de una etiqueta y al que se deduce del nombre del archivo. La búsqueda del panel no la usa (`strict` desactivado por defecto): quien maneja el panel quiere poder encontrar cualquier pista, y los falsos positivos solo importan cuando pide un viewer. Contrapartida: una nota corta usada como título alternativo (por ejemplo «rickroll») ya no encuentra la pista sola en el chat; hay que añadir el artista o el álbum, o escribir el título alternativo con 10 o más caracteres. |
| 2026-10-25 | Fase 5 implementada. **SQLite con `better-sqlite3`** (única dependencia nueva, fijada en `^12` porque la 13 exige Node 22 y el proyecto declara Node 20 o superior; trae binarios precompilados, así que no hace falta compilador). La base está en `data/blue-jay.db` (modo WAL), con migraciones numeradas en `PRAGMA user_version` (`server/db/database.js`); sin ruta vive en memoria, que es lo que usan las pruebas. Qué va a SQLite: ajustes (interruptor del chat y límites), estado que sobrevive a un reinicio (cola, canción actual, volumen y lista base activa/modo/biblioteca), historial de peticiones, historial de reproducción y listas de reproducción. Qué se queda en JSON: `baselist.json`, `blacklist.json` y `library.json`, que ya funcionan, son pequeños y se editan como datos de configuración; migrarlos no aporta nada ahora y se puede hacer más adelante con una migración. **Historial de peticiones:** cada `!sr` o `!local` con texto se anota con usuario, plataforma, el texto original (hasta 200 caracteres), el tipo (`link`, `search` o `local`) y el resultado (`accepted`, `invalid_url`, `not_found`, `search_failed`, `search_disabled`, `library_disabled`, `banned`, `disabled`, `limit_user`, `limit_global`); así se ve qué enlaces no eran válidos. Las altas hechas desde el panel no se anotan como petición, pero sí quedan en el historial de reproducción cuando suenan. **Historial de reproducción:** se anota cuando una pista empieza a sonar (gancho `onPlay` de la cola); recuperar la canción actual al arrancar no cuenta como una reproducción nueva. Cada historial guarda como máximo 10.000 filas (se borran las más antiguas) y se consulta con filtros y paginación en el servidor; el panel recibe un aviso `history.changed` y vuelve a pedir lo que está mirando en lugar de recibir el historial entero. **Límites:** por usuario (25) y global (100), activables por separado; cuentan las peticiones que suenan o esperan en la cola; las de la lista base no cuentan, y las añadidas desde el panel (sin usuario) solo cuentan en el límite global. Los moderadores no están exentos. **Interruptor del chat:** con las peticiones desactivadas solo se rechazan `!sr` y `!local` (con respuesta en el chat y anotación en el historial); `!queue`, `!skip`, `!volume` y el resto siguen disponibles. **Listas de reproducción:** hasta 100 listas de 2.000 pistas, sin repetir pistas dentro de una lista; se crean desde la pestaña Listas, desde el historial («Guardar en la lista elegida») o con «Guardar cola como lista», y se añaden a la cola pista a pista o enteras (se saltan las vetadas y las locales que ya no están en la biblioteca). **Persistencia:** el estado se guarda 300 ms después del último cambio y al cerrar. Al arrancar, la canción actual vuelve a sonar desde el principio cuando se abre un panel. Las pistas locales guardadas no se comprueban contra la biblioteca al recuperarlas (aún se está escaneando): si ya no existen, el reproductor las salta. No se hace «Marcar favoritos en el historial»: para guardar una canción del historial se usan las listas. No se hacen todavía los mensajes del bot editables ni activables (siguen en el checklist). |
| 2026-10-25 | Fase 5.5 implementada. **Mensajes del bot editables** (`server/i18n/messages.js`): son las claves `chat.*` de los archivos de idioma; el texto original sigue en `public/locales/` y lo personalizado se guarda aparte en SQLite (tabla `kv`, clave `messages`), así que actualizar el proyecto no pisa los cambios ni hay que copiar textos a la base. El traductor del servidor (`createTranslator`) carga el texto personalizado o, si no hay, el original, y se actualiza al instante con el evento `change`, sin reiniciar. Cada idioma (es y en) tiene sus propios textos, y el bot responde en el de la variable `LANGUAGE`. Un mensaje con plurales (`_one`, `_other`) es uno solo a efectos de activar o desactivar, pero cada forma se edita por separado. **Validación** (entrada no confiable, aunque la escribe el streamer): el texto se aplana a una línea, se recorta y admite hasta 400 caracteres (Twitch permite 500); solo se admiten variables `{{nombre}}` que ya tenga el mensaje original y se rechaza cualquier otra sintaxis de i18next (formatos como `{{x, uppercase}}`, `{{- x}}` y anidados `$t()`), para que un texto editado no pueda ejecutar nada ni romper la respuesta. Un texto vacío o igual al original vuelve al original. Lo guardado que ya no sea válido (por ejemplo, tras cambiar las variables de un mensaje en una actualización) se descarta al arrancar. **Desactivar** un mensaje hace que `t()` devuelva `null` y el bot no diga nada; la petición se anota igualmente en el historial. No se incluye una vista previa con el motor real: el panel sustituye las variables por valores de ejemplo. **Panel en dos columnas:** la cola pasa de pestaña a tarjeta fija en la columna de la izquierda, junto al reproductor, para tenerla siempre a la vista; «Sonando ahora» pone favorito, vetar y siguiente en una sola fila arriba. Sin dependencias nuevas. |
| 2026-10-25 | Sustitución local de vídeos que no se pueden reproducir. Interruptor `localFallback` en Ajustes (activado por defecto; se guarda en SQLite junto al resto de ajustes). **Al pedir un enlace por chat**, con la clave de YouTube, el servidor consulta `videos.list` (`snippet,status`, 1 unidad de cuota; oEmbed no sirve porque suele fallar justo con los vídeos que no se pueden incrustar) y, si el vídeo existe pero `status.embeddable` es `false`, busca su título en la biblioteca: con coincidencia encola la pista local (resultado `replaced` en el historial) y sin ella rechaza la petición (resultado `unavailable`) en lugar de dejar que falle en directo. Si la API falla, o el vídeo no existe o es privado, se sigue como antes. **Al fallar la reproducción** (`playback.unavailable` de una petición de YouTube, que cubre también los bloqueos por región que el servidor no puede conocer) se hace lo mismo: se sustituye la pista que suena por la local (`PlaybackQueue.replaceCurrent`, que conserva quién la pidió y su posición), se avisa en el panel y, si la pidió alguien del chat, se anuncia en el chat. Las pistas de la lista base no se sustituyen. **Coincidencia** (`server/library/title-match.js`): del título de YouTube se quitan los textos entre paréntesis o corchetes con palabras de ruido (official, video, lyrics, remastered, HD…), «| canal», «- Topic» y los sufijos «- Official/Lyrics/Audio…», se pasa a palabras sin signos y se busca con la **búsqueda estricta de `!sr`** (todas las palabras deben aparecer y un título corto necesita el artista o el álbum), primero con el título completo y luego sin «feat. …». Es deliberadamente conservadora: ante la duda no sustituye. No se compara la duración, para no descartar versiones remasterizadas. |
| 2026-10-28 | Los controles del panel pendientes (reordenar, eliminar y saltar pistas; play, pausa, siguiente y aleatorio) pasan a la fase 7, junto con el diagnóstico y la exportación de ajustes. «Marcar favoritos en el historial» queda descartado (se usan las listas de reproducción). Documentación al día: README con las fases 5 y 5.5 hechas. |
| 2026-10-28 | Fase 6 implementada. **Widget** en `public/widget.html` (con `css/widget.css` y `js/widget.js`), sin dependencias nuevas, con fondo transparente para la fuente de navegador de OBS. **Canal:** el widget usa el mismo WebSocket (`/ws?view=widget`) pero queda en un conjunto aparte: es de solo lectura (se ignoran sus mensajes) y solo recibe `state` con la canción actual reducida a `id`, `title`, `artist` y `requestedBy` (sin ids de vídeo ni rutas), `progress` y `widget.test`; no recibe la lista base, la biblioteca ni los historiales. **Progreso:** solo lo conoce el reproductor del panel (YouTube o `<audio>`), que lo envía cada segundo con `playback.progress` (`id`, `position`, `duration`, `paused`); el servidor lo valida (números finitos de 0 a 24 h), descarta el de una canción que ya no suena y lo reenvía a los widgets, y se guarda el último para el widget que se conecte después. El widget avanza la barra por su cuenta entre mensajes. Consecuencia aceptada: con el panel cerrado el widget no muestra progreso. **Prueba:** `widget.test` envía una tarjeta de 8 s solo a los widgets, sin tocar la cola ni el historial. **Dirección:** se genera en Ajustes a partir del origen del panel, con `?lang=` para el idioma (OBS tiene su propio almacenamiento, así que no hereda el del panel). Quedan como opcionales el audio del widget, el editor visual, los layouts y el badge `!SR`. |
| 2026-10-29 | Widget: se quita el título «Sonando ahora», se añade un disco SVG que gira a la izquierda (se detiene en pausa) y el widget pasa a ser invisible en reposo (`?idle=0..1` en la dirección fija otra opacidad). **Mensaje nuevo `widget.show`:** los comandos `!queue` y `!song` llaman a `onShowWidget` (`channel.showWidget`), que lo envía solo a los widgets y los hace visibles 10 s; la tarjeta de prueba también lo muestra. **`!song`:** responde con la canción actual (`chat.song.*`, editables desde el panel); en pistas locales añade artista, álbum y la primera nota (máx. 120 caracteres), leídos con el nuevo `Library.tags(id)`, que no sale del servidor salvo en ese mensaje del chat. Sin dependencias nuevas. **Cambio de pista:** el propio widget se muestra 10 s cuando el `state` trae una pista distinta de la anterior (no con el primer estado tras conectar). |
| 2026-10-29 | **Duración máxima de vídeo.** `fetchVideoInfo` pide también `contentDetails` (misma llamada de 1 unidad de cuota) y devuelve `duration` en segundos (`parseDuration`; los directos, `P0D`, quedan en `null`). Nuevo ajuste `maxDuration { enabled, minutes }` (7 por defecto, 1 a 600) en Ajustes. `checkPlayable` pasa a `checkVideo`: rechaza con `chat.sr.tooLong` y el resultado `too_long` si el vídeo dura más, tanto en enlaces como en resultados de búsqueda; la comprobación de «se puede incrustar» sigue limitada a enlaces. Sin clave de YouTube o con la API caída no se puede medir y la petición pasa. No se aplica a las peticiones hechas desde el panel ni a las pistas locales. |
| 2026-10-29 | **Directos.** `fetchVideoInfo` devuelve también `live` (`liveBroadcastContent` en `live` o `upcoming`). Con la duración máxima activada, `checkVideo` rechaza los directos con `chat.sr.live` y el resultado `live` del historial: no tienen fin y no caben en ningún máximo. Con el ajuste apagado se admiten. Sin clave de YouTube no se detectan. |
