# Blue Jay Bot

<img src="public/favicon.svg" alt="Logo de Blue Jay Bot" width="96" align="right">

Servidor local de **peticiones de canciones para directos**. Los viewers piden música desde el chat, el streamer la gestiona desde un panel de control y el bot reproduce canciones de **YouTube** o de una **carpeta local**, con una lista base que suena cuando nadie ha pedido nada.

Funciona en tu propio equipo: los datos, las claves de API y la música no salen de él. Está escrito en Node.js, con interfaz en español e inglés.

> **Estado: en desarrollo.** Las fases 0 a 6 están terminadas (cola, chat de Twitch, lista base, biblioteca local, etiquetas, límites, historial, persistencia de la cola, mensajes del bot editables y widget de OBS). Faltan las herramientas de operación. Mira [Estado y hoja de ruta](#estado-y-hoja-de-ruta).

## Qué hace hoy

- **Cola de peticiones** con arrastrar y soltar, saltar canción, volumen y salto automático de vídeos no disponibles.
- **Chat de Twitch** con `!sr`, `!local`, `!queue`, `!song`, `!when`, `!voteskip`, `!wrongsong`, `!skip` y `!volume`. Las respuestas salen en el idioma configurado.
- **Lista base** que suena cuando la cola se queda vacía: botones START (en orden) y SHUFFLE (aleatorio), playlists de YouTube, favoritos que van primero y lista negra con un clic.
- **Biblioteca local**: eliges una carpeta de música, se escanea y se mantiene al día. Se busca por título, artista, álbum, comentario o descripción, y se reproduce desde el propio panel.
- **Etiquetas de audio** (ID3, Vorbis, MP4…): título, artista, álbum, duración y notas. Un comentario o una descripción pueden servir de título alternativo.
- **Vídeos que no se pueden reproducir**: si alguien pide un enlace de YouTube que existe pero no se puede incrustar o reproducir, el bot busca su título en tu biblioteca local y pone esa pista (o rechaza la petición si no hay una coincidencia clara). Se puede desactivar en Ajustes.
- **Historial** de las peticiones del chat (con su resultado: aceptada, URL no válida, vetada, límite…) y de las canciones reproducidas, con filtros por usuario y fecha y opción de borrar o limpiar.
- **Listas de reproducción propias**: se crean, se llenan desde el historial o con la cola actual y se añaden a la cola, canción a canción o enteras.
- **Límites y control del chat**: máximo de peticiones activas por usuario y en total, duración máxima de los vídeos de YouTube (7 minutos por defecto, con la clave de YouTube) y un interruptor para dejar de aceptar `!sr` y `!local`.
- **Persistencia**: la cola, la canción actual, el volumen y el estado START/SHUFFLE sobreviven a un reinicio (SQLite).
- **Mensajes del bot editables**: reescribe lo que responde el bot en cada idioma, con vista previa, y activa o desactiva cada mensaje sin perder su texto.
- **Panel en dos columnas**: a la izquierda lo que suena, añadir canción y la cola; a la derecha las pestañas (Lista base, Biblioteca local, Historial, Listas, Lista negra, Mensajes, Ajustes). Iconos propios y cambio de idioma al vuelo.

## Requisitos

- **Node.js 20 o superior** y npm.
- Un navegador moderno para el panel. **La música suena en la pestaña del panel**, así que debe quedar abierta durante el directo.
- Para el chat, una cuenta de Twitch para el bot y una aplicación registrada en el [portal de desarrolladores de Twitch](https://dev.twitch.tv/console). La guía [Cómo obtener las credenciales de Twitch](docs/credenciales-twitch.md) explica el proceso paso a paso.
- Para buscar por título en YouTube e importar playlists, una clave de la **YouTube Data API v3** (opcional; sin ella solo funcionan enlaces e ID). La guía [Cómo obtener la clave de la API de YouTube](docs/clave-youtube.md) explica cómo conseguirla.

## Instalación

```bash
git clone https://github.com/enriquextt/blue-jay-bot.git
cd blue-jay-bot
npm install
npm start
```

El panel queda en <http://127.0.0.1:3000>. No hay paso de compilación: el panel se sirve tal cual desde `public/`.

Sin ninguna configuración más ya puedes usar el panel, añadir canciones de YouTube y reproducir tu biblioteca local. El chat y la búsqueda por título se activan con los archivos de la sección siguiente.

## Configuración

### Variables de entorno

| Variable | Por defecto | Qué hace |
|---|---|---|
| `HOST` | `127.0.0.1` | Dirección en la que escucha el servidor |
| `PORT` | `3000` | Puerto |
| `LANGUAGE` | `es` | Idioma de las respuestas del bot en el chat (`es` o `en`) |
| `VOTE_SKIP_THRESHOLD` | `3` | Votos necesarios para saltar con `!voteskip` |

Ejemplo en PowerShell: `$env:PORT = 3100; npm start`. En Bash: `PORT=3100 npm start`.

### Archivos de `data/`

Los datos locales viven en `data/`, que **git ignora**. Nunca subas esa carpeta: contiene tus credenciales.

| Archivo | Quién lo crea | Contenido |
|---|---|---|
| `twitch.json` | Tú | Credenciales del chat de Twitch |
| `youtube.json` | Tú | Clave de la YouTube Data API |
| `library.json` | El panel | Carpeta de música elegida |
| `baselist.json` | El panel | Lista base y favoritos |
| `blacklist.json` | El panel | Canciones vetadas |
| `blue-jay.db` | El servidor | Base de datos SQLite: ajustes, cola guardada, historiales y listas de reproducción (junto a ella pueden aparecer `blue-jay.db-wal` y `blue-jay.db-shm`) |

**Chat de Twitch.** Crea `data/twitch.json` con las credenciales de una aplicación de Twitch. Si no existe, el chat queda desactivado y el resto funciona igual. La guía [docs/credenciales-twitch.md](docs/credenciales-twitch.md) explica cómo conseguir cada valor.

```json
{
  "channel": "tu_canal",
  "login": "cuenta_del_bot",
  "clientId": "…",
  "clientSecret": "…",
  "token": { "access_token": "…", "refresh_token": "…" }
}
```

El token de usuario necesita los permisos `chat:read` y `chat:edit`. El servidor renueva el token solo con el `refresh_token` y reescribe el archivo, así que la guía solo hay que seguirla una vez. El proyecto no incluye un asistente que genere el token: se obtiene a mano con unos pocos pasos.

**Clave de YouTube.** Crea `data/youtube.json` con tu clave (la guía [docs/clave-youtube.md](docs/clave-youtube.md) explica cómo obtenerla):

```json
{ "apiKey": "…" }
```

Cada búsqueda por título cuesta 100 unidades de la cuota diaria (10.000 por defecto, unas 100 búsquedas al día). Importar una playlist cuesta 1 unidad por cada 50 vídeos.

## Uso

### Panel de control

El panel tiene dos columnas. La izquierda (un tercio) es fija: **Sonando ahora**, **Añadir canción** y **Cola**. La derecha (dos tercios) tiene las pestañas. En pantallas estrechas se apilan.

1. **Sonando ahora**: arriba, en una sola fila, favorito (★), vetar (⊘) y siguiente; debajo, el reproductor y el volumen.
2. **Añadir canción**: pega una URL o un ID de YouTube.
3. **Cola** (en la columna izquierda): arrastra para reordenar. Cada canción se puede marcar como favorita, vetar o quitar. *Limpiar cola* quita las pendientes sin cortar la que suena (pide una segunda pulsación) y *Guardar cola como lista* crea una lista de reproducción con lo que suena y lo que espera.
4. **Lista base**: pega un vídeo o una playlist de YouTube. **START** reproduce en orden (favoritos primero) y **SHUFFLE** en aleatorio, sin repetir hasta recorrerla toda. **Parar** la desactiva y **Vaciar** la borra (pide una segunda pulsación). Admite hasta 2.000 pistas.
5. **Biblioteca local**: escribe la ruta absoluta de tu carpeta de música (por ejemplo `C:\Music`) y pulsa *Guardar carpeta*. La casilla *Incluir la biblioteca en la lista base* añade toda la carpeta al fallback sin copiarla. Cada resultado se puede añadir a la cola, a la lista base, marcar como favorito o vetar.
6. **Historial**: *Peticiones* muestra cada `!sr` y `!local` del chat con su resultado, también los rechazados (por ejemplo, **URL no válida**); *Reproducción* muestra lo que ha ido sonando. Se filtra por usuario, resultado y fechas; cada fila se puede borrar, añadir a la cola o guardar en la lista elegida arriba, y *Limpiar historial* vacía el que estás viendo (pide una segunda pulsación).
7. **Listas**: crea listas de reproducción, ábrelas para ver sus canciones, añade una a la cola o la lista entera, renómbralas o elimínalas.
8. **Lista negra**: las canciones vetadas no se pueden pedir y salen de la cola y de la lista base. Desde aquí se les quita el veto.
9. **Mensajes**: cada respuesta del bot se puede reescribir en español o en inglés (el bot usa el idioma de `LANGUAGE`). Las variables, como `{{user}}` o `{{title}}`, se escriben entre dos llaves y solo se admiten las que ya tiene el mensaje; debajo del cuadro se ve una vista previa con valores de ejemplo. La casilla *Activado* hace que el bot se calle en ese mensaje sin borrar su texto, y *Restaurar original* lo devuelve a como venía.
10. **Ajustes**: la sustitución de vídeos que no se pueden reproducir por su versión local (activada por defecto; con la clave de YouTube avisa antes de encolar, y sin ella actúa cuando el reproductor falla), los límites de peticiones activas (por defecto 25 por usuario y 100 en total) y el interruptor *Aceptar peticiones*, que también está en la barra superior. Con las peticiones desactivadas, `!sr` y `!local` responden con un aviso y no añaden nada; los demás comandos siguen funcionando.

La petición de un viewer no interrumpe la canción de la lista base que está sonando: entra cuando esta termina.

### Comandos del chat

| Comando | Quién | Qué hace |
|---|---|---|
| `!sr <enlace, ID o texto>` | Todos | Pide una canción. Con texto, **busca primero en tu biblioteca local** y solo si no hay coincidencia consulta YouTube |
| `!local <texto>` | Todos | Pide una pista solo de la biblioteca local; nunca consulta YouTube |
| `!queue` | Todos | Canción actual y las 10 siguientes. Muestra el widget de OBS 10 s |
| `!song` | Todos | Información de la canción actual; en pistas locales añade artista, álbum y nota de las etiquetas, y el subtítulo entre paréntesis junto al título si lo tiene. Muestra el widget de OBS 10 s |
| `!when` | Todos | Cuántas canciones suenan antes de tu última petición |
| `!voteskip` | Todos | Un voto por usuario y canción; salta al llegar al umbral |
| `!wrongsong` | Todos | Retira tu última petición |
| `!skip` | Moderadores | Salta la canción actual |
| `!volume [0-100]` | Todos consultan, moderadores/VIPs/suscriptores cambian | Consulta o ajusta el volumen |

**Búsqueda en la biblioteca desde el chat.** Para que un texto corto no acabe en la pista equivocada, si una palabra solo coincide con una etiqueta de **menos de 10 caracteres** (un título corto, una nota o el nombre del archivo), hace falta que otra palabra coincida con el **artista o el álbum**. Con dos pistas llamadas «Love», `!sr love` no encuentra ninguna y `!sr love beatles` encuentra la de Beatles. El panel no aplica esta regla.

### Consejos para tu música local

- Formatos: `.mp3`, `.flac`, `.ogg`, `.m4a` y `.wav`. Se ignoran los archivos y carpetas ocultos y los enlaces simbólicos.
- Si los archivos tienen etiquetas, se usan. Si no, el título y el artista salen del nombre (`Artista - Título.mp3`) o de la carpeta.
- Para que una pista se encuentre con otro nombre (otro idioma, apodo, versión), escríbelo en el **comentario** o la **descripción** del archivo.
- Los cambios en la carpeta se detectan solos en un par de segundos.
- Ajustar la carpeta solo se permite desde el propio equipo donde corre el servidor.

## Pruebas

```bash
npm test
```

Usan `node:test` y están en `test/`. Cubren la cola, la lista base, el chat, el adaptador de Twitch, YouTube, la biblioteca local, el canal WebSocket, la base de datos (ajustes, historiales, listas y estado guardado) y los reinicios.

## Estructura del proyecto

```
server/     Backend: HTTP, WebSocket, cola, comandos, chat, biblioteca local y base de datos SQLite
public/     Panel de control (HTML, CSS, JS, iconos y archivos de idioma)
docs/       Checklist, propuesta de arquitectura y contrato de la API
test/       Pruebas
data/       Datos locales y credenciales (ignorado por git)
```

## Estado y hoja de ruta

| Fase | Contenido | Estado |
|---|---|---|
| 0 | Base: servidor, i18n es/en, panel | Hecha |
| 1 | Cola y reproducción de YouTube | Hecha |
| 2 | Chat de Twitch y comandos | Hecha |
| 3 | Lista base, favoritos y lista negra | Hecha |
| 4 | Biblioteca local | Hecha |
| 4.5 | Etiquetas, `!local` y búsqueda por comentario y descripción | Hecha |
| 5 | Límites por usuario y global, historial, listas de reproducción y persistencia de la cola | Hecha |
| 5.5 | Mensajes del bot editables y panel en dos columnas | Hecha |
| 6 | Widget de OBS | Hecha |
| 7 | Diagnóstico y controles de reproducción en el panel | Pendiente |
| 8 | Editor visual de layouts del widget | Pendiente |
| 9 | Exportar e importar ajustes, layouts y mensajes personalizados | Pendiente |
| 10 | Opcionales: Spotify, chat de Kick y YouTube | Pendiente |

**Limitaciones actuales**

- Al reiniciar, la canción que sonaba vuelve a empezar desde el principio cuando abres el panel.
- Solo hay adaptador de chat para Twitch.
- El widget de OBS muestra título y progreso, pero no reproduce audio: para capturarlo hay que usar la pestaña del panel, que además debe estar abierta para que avance la barra.
- El título y el artista no se pueden editar desde el panel; salen de las etiquetas del archivo.

## Documentación

- [`docs/checklist.md`](docs/checklist.md): funcionalidades y su estado.
- [`docs/propuesta.md`](docs/propuesta.md): arquitectura, fases y registro de decisiones.
- [`docs/api.md`](docs/api.md): contrato de la API REST y WebSocket.
- [`docs/credenciales-twitch.md`](docs/credenciales-twitch.md): cómo obtener las credenciales de Twitch con una aplicación.
- [`docs/clave-youtube.md`](docs/clave-youtube.md): cómo obtener la clave de la API de YouTube.

## Seguridad y privacidad

- Todo se queda en tu equipo. Por defecto el servidor solo escucha en `127.0.0.1`.
- Las claves, los tokens y las rutas privadas no se suben a git (`data/` está en `.gitignore`).
- La carpeta de música se trata como entrada no confiable: el navegador solo conoce el id de cada pista, nunca su ruta, y antes de servir un archivo se comprueba que sigue dentro de la carpeta configurada.
- Si cambias `HOST` para que el servidor escuche en la red, cualquiera que llegue al panel podrá gestionar la cola. No hay autenticación todavía.

## Licencia

[GPL-3.0](LICENSE).
