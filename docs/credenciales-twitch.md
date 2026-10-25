# Cómo obtener las credenciales de Twitch

Guía para conectar Blue Jay Bot al chat de Twitch. Al terminar tendrás el archivo `data/twitch.json` con todo lo que el servidor necesita para leer el chat y responder.

Hace falta hacerlo una sola vez. Después el servidor renueva el token por su cuenta.

## Qué vas a obtener

| Dato | Qué es | Dónde se consigue |
|---|---|---|
| **Client ID** | Identifica tu aplicación ante Twitch | Consola de desarrolladores (paso 2) |
| **Client Secret** | Contraseña de la aplicación. **Es privado** | Consola de desarrolladores (paso 2) |
| **Access Token** | Autoriza al bot a leer y escribir en el chat con una cuenta concreta | Intercambio del código OAuth (paso 4) |
| **Refresh Token** | Permite pedir un access token nuevo cuando caduca | Mismo intercambio (paso 4) |

El bot usa un **token de usuario** con los permisos `chat:read` (leer el chat) y `chat:edit` (escribir en él). No sirve un token de aplicación.

## Antes de empezar

- **Una cuenta de Twitch para el bot.** Puede ser tu propia cuenta, pero es más claro usar una cuenta aparte: los mensajes del bot saldrán con su nombre. Esa será la cuenta que autorices en el paso 3.
- **Verificación en dos pasos (2FA)** activada en la cuenta con la que registres la aplicación. Twitch la exige para el registro; si no la tienes, se configura en *Ajustes → Seguridad y privacidad*.
- Un navegador y una terminal (PowerShell, CMD o Bash).

## Paso 1. Registrar una aplicación

1. Abre la [consola de desarrolladores de Twitch](https://dev.twitch.tv/console) e inicia sesión.
2. En **Applications**, pulsa **Register Your Application**.
3. Rellena el formulario:

   | Campo | Valor |
   |---|---|
   | **Name** | Un nombre único, por ejemplo `BlueJayBot-TuCanal` |
   | **OAuth Redirect URLs** | `http://localhost:3000` |
   | **Category** | `Chat Bot` |
   | **Client Type** | `Confidential` (así Twitch te da un Client Secret) |

4. Completa la verificación y pulsa **Create**.

> La URL de redirección debe ser **exactamente** la misma en el paso 1, el paso 3 y el paso 4. `http://localhost:3000` es la dirección por defecto de Blue Jay Bot, pero no hace falta que el servidor esté en marcha: solo necesitas leer la dirección a la que te redirige el navegador.

## Paso 2. Copiar el Client ID y el Client Secret

1. Vuelve a **Applications**, busca tu aplicación y pulsa **Manage**.
2. Copia el **Client ID**.
3. Pulsa **New Secret** para generar el **Client Secret** y cópialo. Twitch solo lo muestra una vez.

Guarda ambos en un lugar seguro. El Client Secret no debe aparecer en capturas, mensajes ni repositorios.

## Paso 3. Autorizar la cuenta del bot

Abre esta dirección en el navegador, sustituyendo `TU_CLIENT_ID` por el tuyo:

```
https://id.twitch.tv/oauth2/authorize?response_type=code&client_id=TU_CLIENT_ID&redirect_uri=http%3A%2F%2Flocalhost%3A3000&scope=chat%3Aread%20chat%3Aedit
```

1. **Inicia sesión con la cuenta del bot.** Si tu navegador ya tiene abierta otra cuenta (por ejemplo, la del streamer), usa una ventana privada. El token pertenecerá a la cuenta con la que autorices.
2. Revisa los permisos (`chat:read` y `chat:edit`) y pulsa **Authorize**.
3. Twitch te redirige a `http://localhost:3000` con un parámetro `code` en la dirección:

   ```
   http://localhost:3000/?code=CODIGO_TEMPORAL&scope=chat%3Aread+chat%3Aedit
   ```

Copia el valor de `code` de la barra de direcciones. Si la página muestra un error de conexión porque el servidor no está en marcha, no importa: el código está en la dirección.

> El código es **temporal y de un solo uso**. Todavía no es el token. Úsalo enseguida en el paso 4; si caduca o ya lo usaste, repite este paso.

## Paso 4. Cambiar el código por los tokens

Envía el código a Twitch junto con tu Client ID y tu Client Secret. Sustituye los cuatro valores de ejemplo.

**PowerShell (Windows):**

```powershell
curl.exe -X POST "https://id.twitch.tv/oauth2/token" `
  -H "Content-Type: application/x-www-form-urlencoded" `
  --data-urlencode "client_id=TU_CLIENT_ID" `
  --data-urlencode "client_secret=TU_CLIENT_SECRET" `
  --data-urlencode "code=CODIGO_TEMPORAL" `
  --data-urlencode "grant_type=authorization_code" `
  --data-urlencode "redirect_uri=http://localhost:3000"
```

**Bash (Linux, macOS o Git Bash):**

```bash
curl -X POST "https://id.twitch.tv/oauth2/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "client_id=TU_CLIENT_ID" \
  --data-urlencode "client_secret=TU_CLIENT_SECRET" \
  --data-urlencode "code=CODIGO_TEMPORAL" \
  --data-urlencode "grant_type=authorization_code" \
  --data-urlencode "redirect_uri=http://localhost:3000"
```

Si todo va bien, Twitch responde con un JSON como este (los valores son ilustrativos):

```json
{
  "access_token": "TOKEN_DE_ACCESO",
  "refresh_token": "TOKEN_DE_RENOVACION",
  "expires_in": 14400,
  "scope": ["chat:read", "chat:edit"],
  "token_type": "bearer"
}
```

- `access_token`: el token con el que el bot entra al chat.
- `refresh_token`: sirve para obtener un access token nuevo.
- `expires_in`: segundos que dura el access token (14400 son unas 4 horas).
- `scope`: los permisos concedidos. Comprueba que aparecen `chat:read` y `chat:edit`.

## Paso 5. Crear `data/twitch.json`

Crea el archivo `data/twitch.json` en la carpeta del proyecto (si la carpeta `data/` no existe, créala):

```json
{
  "channel": "tu_canal",
  "login": "cuenta_del_bot",
  "clientId": "TU_CLIENT_ID",
  "clientSecret": "TU_CLIENT_SECRET",
  "token": {
    "access_token": "TOKEN_DE_ACCESO",
    "refresh_token": "TOKEN_DE_RENOVACION"
  }
}
```

| Campo | Qué poner |
|---|---|
| `channel` | El canal de Twitch donde el bot escuchará y responderá, sin `#` |
| `login` | El nombre de usuario de la cuenta del bot, la que autorizaste en el paso 3 |
| `clientId` y `clientSecret` | Los del paso 2 |
| `token` | Puedes pegar la respuesta completa del paso 4; el servidor solo necesita `access_token` y `refresh_token` |

`data/` está en `.gitignore`, así que este archivo no se sube a git. Aun así, **no lo compartas ni lo publiques**: da acceso a la cuenta del bot.

## Paso 6. Comprobar que funciona

1. Arranca el servidor con `npm start`.
2. En la terminal debe aparecer `[twitch.connected]`.
3. Escribe `!queue` en el chat del canal. El bot debe responder, por ejemplo con «No hay nada sonando ni en la cola.».

Cuando el access token caduca, Twitch rechaza la conexión y el servidor lo renueva solo con el `refresh_token`, el Client ID y el Client Secret, y reescribe `data/twitch.json` con los tokens nuevos. Lo verás como `[twitch.authFailed]` seguido de `[twitch.tokenRefreshed]`. No tienes que repetir esta guía.

## Si algo falla

| Síntoma | Causa probable y solución |
|---|---|
| Al abrir la URL de autorización, Twitch muestra un error de `redirect_uri` | La URL de redirección no coincide con la registrada en el paso 1. Debe ser idéntica, incluido el puerto y sin barra final distinta |
| El paso 4 responde `Invalid authorization code` | El código ya se usó o caducó. Repite el paso 3 y cámbialo enseguida |
| El paso 4 responde `invalid client secret` | El Client Secret está mal copiado o lo regeneraste. Genera uno nuevo con **New Secret** y úsalo también en `twitch.json` |
| En la terminal aparece `[twitch.disabled]` | Falta `channel`, `login` o `token.access_token` en `data/twitch.json`, o el archivo no existe |
| Aparece `[twitch.authFailed]` y luego `[twitch.refreshFailed]` | El `refresh_token` ya no es válido (por ejemplo, revocaste la autorización o cambiaste la contraseña de la cuenta) o el Client Secret es incorrecto. Repite los pasos 3 y 4 |
| El bot conecta pero no responde | Revisa que `channel` sea el canal correcto, que el token incluya `chat:edit` y que el comando empiece por `!` |
| El bot responde con otro nombre de usuario | Autorizaste el paso 3 con otra cuenta. Repite el paso 3 con la cuenta del bot, mejor en una ventana privada, y actualiza `login` |

## Seguridad

- Trata el **Client Secret**, el **access token** y el **refresh token** como contraseñas.
- No los pegues en el código, en mensajes del chat, en capturas ni en issues. No subas `data/` a git.
- Si crees que se ha filtrado alguno, genera un secreto nuevo con **New Secret** en la consola de desarrolladores y revoca la conexión de la aplicación desde la configuración de la cuenta de Twitch (*Ajustes → Conexiones*). Después repite los pasos 3 a 5.
