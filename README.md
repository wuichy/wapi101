# Reelance Hub

MVP de una app estilo inbox para leer mensajes que llegan a Kommo y preparar respuestas desde una interfaz propia.

## Qué resuelve esta versión

- Conexión con Kommo por `OAuth 2.0`
- Recepción de mensajes entrantes con webhook general de Kommo
- Vista tipo chat para leer conversaciones
- Cola de respuestas desde la app
- Puente preparado para que Kommo envíe la respuesta por WhatsApp usando `Salesbot` + `widget_request`

## Importante sobre el envío de respuestas

Kommo documenta que **Chats API no permite mandar mensajes a canales de chat de otras integraciones existentes**. Para responder a tus chats de WhatsApp conectados en Kommo, la ruta soportada es usar `Salesbot` y/o `widget_request`.

Eso significa que esta app ya queda lista para:

1. Recibir los mensajes desde Kommo.
2. Mostrar los chats en esta interfaz.
3. Guardar una respuesta desde la app.
4. Pedirle a un Salesbot que la saque al canal correcto.

## Configuración local

1. Crea tu archivo `.env` usando `.env.example`.
2. Llena:

- `KOMMO_SUBDOMAIN`
- `KOMMO_CLIENT_ID`
- `KOMMO_CLIENT_SECRET`
- `KOMMO_REDIRECT_URI`
- `APP_BASE_URL`
- `KOMMO_SALESBOT_ID` cuando ya tengas el bot de salida

3. Inicia la app:

```bash
npm start
```

## Flujo con ngrok

1. Corre la app en `http://localhost:3000`
2. Expón el puerto:

```bash
./ngrok http 3000
```

3. Usa la URL pública de ngrok para:

- `APP_BASE_URL`
- `KOMMO_REDIRECT_URI`
- Webhook general de Kommo: `https://TU-URL.ngrok-free.app/webhooks/kommo`
- `widget_request` del Salesbot: `https://TU-URL.ngrok-free.app/api/kommo/salesbot/handoff`

## Configuración del webhook general en Kommo

En Kommo activa al menos:

- `Incoming message received`
- `Talk added`
- `Talk edited`

Webhook URL:

```text
https://TU-URL.ngrok-free.app/webhooks/kommo
```

## Widget para Salesbot

El widget minimo para Kommo ya esta en:

```text
kommo-widget/
```

Archivos clave:

- `kommo-widget/manifest.json`
- `kommo-widget/script.js`
- `kommo-widget/i18n/es.json`
- `kommo-widget/images/logo.svg`

Este widget crea un paso de `widget_request` en Salesbot y apunta por defecto a:

```text
https://unvalued-headband-persuader.ngrok-free.dev/api/kommo/salesbot/handoff
```

Cuando Salesbot llama a ese endpoint, Reelance Hub responde a Kommo con `execute_handlers` para que Kommo envie el mensaje al ultimo chat activo usando `send_external_message`.

### Como subir el widget a Kommo

1. Comprime el contenido de `kommo-widget/` en un `.zip`.
2. En Kommo ve a `Configuracion -> Integraciones`.
3. Abre tu integracion privada.
4. Usa el boton `Upload` para subir el `.zip` del widget.
5. Guarda los cambios.

### Como usar el widget en Salesbot

1. En Kommo ve a `Configuracion -> Communication tools -> Salesbot`.
2. Crea un bot nuevo o edita uno.
3. Agrega un paso de tipo `Widget`.
4. Elige `Reelance Hub Bridge`.
5. Deja la URL por defecto o pega:

```text
https://unvalued-headband-persuader.ngrok-free.dev/api/kommo/salesbot/handoff
```

6. Guarda el bot.

### Como obtener el Salesbot ID

1. Abre el bot en Kommo.
2. Mira la URL del navegador.
3. El numero del bot suele aparecer en la URL o en las llamadas de Kommo al abrirlo.
4. Ese numero va en:

```text
KOMMO_SALESBOT_ID=
```

Si no aparece facil, tambien puedes abrir el bot y usar `View Source`; normalmente el identificador queda visible en la estructura del bot o en la URL del editor.

## Siguiente paso recomendado

Después de que confirmemos que:

- OAuth conecta bien
- El webhook recibe mensajes
- La lista de chats se llena

el siguiente paso es pulir el Salesbot exacto de tu cuenta Kommo para que la respuesta salga por tu canal real de WhatsApp.
