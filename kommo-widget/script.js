define(['jquery'], function () {
  return function ReelanceHubWidget() {
    // URLs hardcodeadas — no dependen de params para evitar validación vacía en Kommo
    const HANDOFF_URL    = 'https://lucho101.com/api/kommo/salesbot/handoff';
    const LOG_URL        = 'https://lucho101.com/webhooks/kommo/log-outgoing';

    const createStep = (items) => ({
      question: items,
      require: []
    });

    this.callbacks = {
      settings: () => {},
      init: () => true,
      bind_actions: () => true,
      render: () => true,

      onSalesbotDesignerSave: (handlerCode, params) => {
        // ─── Handler 1: Bridge — llama al servidor para obtener el mensaje del
        // agente y lo entrega al cliente via handler "show" nativo de Kommo.
        if (handlerCode === 'reelance_reply_bridge') {
          const requestStep = createStep([
            {
              handler: 'widget_request',
              params: {
                url: HANDOFF_URL,
                data: {
                  source:    'reelance_hub',
                  lead_id:   '{{lead.id}}',
                  contact_id:'{{contact.id}}',
                  source_id: '{{lead.source_id}}'
                }
              }
            },
            { handler: 'goto', params: { type: 'question', step: 1 } }
          ]);

          const deliveryStep = createStep([
            // Texto plano
            {
              handler: 'condition',
              params: {
                term1: '{{json.reply_type}}', term2: 'text', operation: '=',
                result: [{ handler: 'show', params: { type: 'text',  value: '{{json.reply_text}}' } }]
              }
            },
            // Imagen
            {
              handler: 'condition',
              params: {
                term1: '{{json.reply_type}}', term2: 'image', operation: '=',
                result: [{ handler: 'show', params: { type: 'image', value: '{{json.reply_url}}' } }]
              }
            },
            // Archivo / documento
            {
              handler: 'condition',
              params: {
                term1: '{{json.reply_type}}', term2: 'file', operation: '=',
                result: [{ handler: 'show', params: { type: 'file',  value: '{{json.reply_url}}' } }]
              }
            },
            { handler: 'stop', params: {} }
          ]);

          return JSON.stringify([requestStep, deliveryStep]);
        }

        // ─── Handler 2: Log — registra en Reelance Hub los mensajes salientes
        // que el salesbot envió por plantillas de WhatsApp.
        if (handlerCode === 'reelance_log_outgoing') {
          const messageText = (params && params.message_text) || '';

          const requestStep = createStep([
            {
              handler: 'widget_request',
              params: {
                url: LOG_URL,
                data: {
                  source:     'reelance_hub_log',
                  lead_id:    '{{lead.id}}',
                  contact_id: '{{contact.id}}',
                  text:       messageText
                }
              }
            }
          ]);

          return JSON.stringify([requestStep]);
        }

        return JSON.stringify([]);
      },

      destroy: () => {},
      onSave: () => true
    };

    return this;
  };
});
