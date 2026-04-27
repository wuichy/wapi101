# Mensaje para soporte de Kommo

Hola equipo de Kommo,

Estoy desarrollando una app propia llamada Reelance Hub para operar conversaciones de WhatsApp desde una interfaz personalizada conectada a Kommo.

Actualmente ya tengo funcionando:

- OAuth con mi cuenta de Kommo
- recepción de mensajes entrantes por webhook
- visualización de chats en mi app
- lanzamiento de Salesbot desde mi app
- widget de Salesbot que hace `widget_request` a mi backend

Mi objetivo es que, cuando un lead escriba por WhatsApp y yo responda desde mi app, Kommo envíe ese mensaje al lead por medio de WhatsApp Business API usando el canal ya conectado en Kommo.

Lo que sí estoy viendo en mi implementación es:

- Kommo recibe el webhook y el chat se actualiza correctamente
- mi app lanza el Salesbot sin error
- el flujo llega al bot y yo marco el mensaje como entregado al bot
- pero el mensaje no siempre termina saliendo al lead por WhatsApp

Ya probé un flujo basado en la documentación oficial de:

- `Private Chatbot integration`
- `Salesbot`
- `widget_request`
- `send_external_message`

En concreto:

1. Uso un widget privado cargado en `salesbot_designer`.
2. El widget genera un paso `widget_request` que llama a mi backend.
3. Mi backend devuelve datos al bot y continúo el flujo.
4. Ya probé tanto con `show` como con `send_external_message`.
5. En `send_external_message` estoy usando el contacto principal y probando el canal correspondiente.

Además, en mi implementación actual veo este comportamiento:

- los mensajes entrantes sí llegan a mi app por webhook general
- los `talk.add` y `talk.update` también llegan
- los mensajes enviados manualmente desde Kommo no siempre aparecen en mis webhooks
- por eso tampoco puedo reflejarlos correctamente en mi app externa en tiempo real

Mi duda es:

1. ¿Cuál es la forma correcta y soportada por Kommo para enviar un mensaje desde una app externa propia hacia un chat de WhatsApp ya conectado en Kommo?
2. ¿`send_external_message` dentro de Salesbot es el camino correcto para este caso?
3. ¿Necesito además configurar obligatoriamente un `channel id` o `source id` específico dentro de `send_external_message` para que el mensaje salga por el canal real de WhatsApp?
4. ¿Cuál es la forma correcta de identificar ese canal para un chat ya existente de WhatsApp Business API?
5. ¿Existe alguna restricción para enviar mensajes a conversaciones creadas desde chats/unsorted o a leads duplicados?
6. Si quiero reflejar en mi app externa todos los mensajes enviados desde la interfaz de Kommo, incluso mensajes manuales de usuarios y respuestas automáticas, ¿el webhook general de cuenta es suficiente o necesito un flujo de Chats API / custom chat channel / webhook adicional?
7. ¿Pueden darme una asesoría o un ejemplo oficial mínimo de implementación para este flujo exacto?

Si lo necesitan, puedo compartir:

- payloads del webhook entrante
- payload del `widget_request`
- respuesta de mi backend al Salesbot
- estructura del paso del bot que estoy usando
- ejemplos donde el mensaje sí se entrega al bot pero no sale por WhatsApp
- ejemplos donde el mensaje se manda desde Kommo pero no aparece en mis webhooks externos

Gracias. Quedo atento a su guía para completar correctamente el envío saliente desde mi app hacia WhatsApp a través de Kommo.
