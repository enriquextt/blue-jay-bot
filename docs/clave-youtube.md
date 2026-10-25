# Cómo obtener la clave de la API de YouTube

Guía para conseguir una clave de la **YouTube Data API v3** y activarla en Blue Jay Bot. Al terminar tendrás el archivo `data/youtube.json` con tu clave.

La clave es **opcional**. Sin ella el bot sigue funcionando, pero solo acepta enlaces e ID de YouTube.

## Para qué sirve en Blue Jay Bot

| Función | Con clave | Sin clave |
|---|---|---|
| `!sr <título>` en el chat busca la canción en YouTube | Sí | No: solo `!sr <enlace>` o `!sr <ID>` |
| Importar una **playlist** de YouTube a la lista base | Sí | No |
| Añadir un vídeo suelto por enlace o ID | Sí | Sí |
| Reproducir música de tu carpeta local y `!local` | Sí | Sí |

La clave solo da acceso a **datos públicos** (buscar vídeos, leer playlists públicas). No sirve para acceder a tu cuenta ni a vídeos privados, y no hace falta tener un canal de YouTube.

## Antes de empezar

- Una **cuenta de Google** (la de siempre sirve).
- Un navegador. No hace falta tarjeta ni activar la facturación: la cuota gratuita basta para este uso.

## Paso 1. Crear un proyecto en Google Cloud

1. Abre la [consola de Google Cloud](https://console.cloud.google.com/) e inicia sesión.
2. Pulsa el selector de proyectos (arriba, junto al logotipo) y elige **Proyecto nuevo**.
3. Ponle un nombre, por ejemplo `BlueJayBot`, y pulsa **Crear**.
4. Comprueba que el proyecto nuevo queda seleccionado en el selector.

## Paso 2. Activar la YouTube Data API v3

1. Abre la [página de YouTube Data API v3](https://console.cloud.google.com/apis/library/youtube.googleapis.com).
2. Con tu proyecto seleccionado, pulsa **Habilitar** (*Enable*).

Si te saltas este paso, la clave se crea igualmente, pero las peticiones fallan con un error de API no habilitada.

## Paso 3. Crear la clave

1. Abre [APIs y servicios → Credenciales](https://console.cloud.google.com/apis/credentials).
2. Pulsa **Crear credenciales** → **Clave de API**.
3. Google genera la clave y la muestra. Cópiala.

## Paso 4. Restringir la clave

En el mismo cuadro, pulsa **Editar clave de API** (o abre la clave desde la lista de credenciales) y ajusta dos cosas:

| Ajuste | Qué elegir | Por qué |
|---|---|---|
| **Restricciones de API** | **Restringir clave** → marca solo **YouTube Data API v3** | Si alguien consigue la clave, no puede usarla con otros servicios de Google |
| **Restricciones de la aplicación** | **Ninguna** (o **Direcciones IP**, solo si tu conexión tiene una IP fija) | Las peticiones salen de tu equipo, sin navegador |

> **No uses «Sitios web» (referentes HTTP).** Esa restricción exige que la petición lleve la cabecera de un sitio web, y el servidor de Blue Jay Bot no la envía: todas las peticiones fallarían con un error 403.

Pulsa **Guardar**. Los cambios pueden tardar unos minutos en aplicarse.

## Paso 5. Guardar la clave en `data/youtube.json`

Crea el archivo `data/youtube.json` en la carpeta del proyecto (si la carpeta `data/` no existe, créala):

```json
{ "apiKey": "TU_CLAVE" }
```

`data/` está en `.gitignore`, así que el archivo no se sube a git. Aun así, no lo compartas ni lo publiques.

## Paso 6. Comprobar que funciona

**Opción A. Probar la clave directamente.** Esta petición cuesta 1 unidad de cuota. Sustituye `TU_CLAVE`:

```bash
curl "https://www.googleapis.com/youtube/v3/videos?part=snippet&id=dQw4w9WgXcQ&key=TU_CLAVE"
```

En PowerShell usa `curl.exe` en lugar de `curl`. Si la clave es correcta, la respuesta es un JSON con el título del vídeo. Si no, trae un bloque `error` que explica el motivo (mira la tabla de abajo).

**Opción B. Probarla en el bot.**

1. Arranca el servidor con `npm start`. Si en la terminal **no** aparece `[youtube.searchDisabled]`, el servidor ha encontrado la clave.
2. En el panel, abre la pestaña **Lista base** y pega la URL de una playlist pública de YouTube. Debe importarse y avisar de cuántas canciones se añadieron.
3. En el chat, escribe `!sr` seguido del título de una canción que **no** tengas en tu biblioteca local. El bot debe añadirla a la cola.

## Cuota

La clave tiene una cuota gratuita de **10.000 unidades al día** por proyecto. Cada acción consume:

| Acción | Coste |
|---|---|
| Búsqueda por título (`!sr <título>`) | **100 unidades** (unas 100 búsquedas al día) |
| Importar una playlist | 1 unidad por cada 50 vídeos |
| Comprobar si el vídeo de un enlace se puede reproducir (`!sr <enlace>`, si *Sustituir los vídeos que no se pueden reproducir* está activado en Ajustes) | 1 unidad |
| Leer el título de un vídeo suelto | No usa la API: se obtiene sin clave |

La cuota se reinicia cada día a medianoche, hora del Pacífico. Puedes ver cuánto llevas gastado en la [página de cuotas de tu proyecto](https://console.cloud.google.com/apis/api/youtube.googleapis.com/quotas).

Las cuotas y los costes los fija Google y pueden cambiar. Si se agota la cuota, `!sr <título>` y la importación de playlists dejan de funcionar hasta el siguiente reinicio, pero las peticiones por enlace o ID siguen funcionando.

> **Consejo.** `!sr` busca primero en tu biblioteca local y solo consulta YouTube si no encuentra nada. Cuanta más música tengas en la carpeta local, menos cuota gastas.

## Si algo falla

| Síntoma | Causa probable y solución |
|---|---|
| `[youtube.searchDisabled]` al arrancar | No hay clave: falta `data/youtube.json` o no tiene el campo `apiKey` |
| `!sr <título>` responde que la búsqueda no está activada | El servidor no encontró la clave. Revisa `data/youtube.json` y reinicia el servidor |
| `!sr <título>` responde que no pudo buscar ahora mismo | La API falló: cuota agotada, clave inválida o problema de red. Prueba la clave con la opción A del paso 6 |
| La importación de una playlist da error | Comprueba que la playlist sea **pública o no listada** (una privada no se puede leer) y que la clave funcione |
| Error `API key not valid` (400) | La clave está mal copiada o la borraste. Copia otra desde la página de credenciales |
| Error `accessNotConfigured` o «API has not been used in project» (403) | No habilitaste la API en el paso 2, o elegiste otro proyecto |
| Error `quotaExceeded` (403) | Se agotó la cuota diaria. Espera al reinicio o revisa el consumo en la página de cuotas |
| Error `API_KEY_HTTP_REFERRER_BLOCKED` (403) | La clave tiene la restricción de «Sitios web». Cámbiala a **Ninguna** (paso 4) |
| Error `API_KEY_SERVICE_BLOCKED` o similar (403) | La restricción de API no incluye YouTube Data API v3. Márcala en el paso 4 |
| Error `API_KEY_IP_ADDRESS_BLOCKED` (403) | La restricción por IP no incluye la de tu equipo, o tu IP cambió. Cámbiala a **Ninguna** |

## Seguridad

- Trata la clave como una contraseña: sirve para gastar la cuota de tu proyecto.
- No la pegues en el código, en el chat, en capturas ni en issues. No subas `data/` a git.
- Si crees que se ha filtrado, ve a [Credenciales](https://console.cloud.google.com/apis/credentials), elimina la clave o regenérala, y actualiza `data/youtube.json`.
