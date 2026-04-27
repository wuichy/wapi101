define(['jquery'], function () {
  return function ReelanceHubWidget() {
    const createStep = (items) => ({
      question: items,
      require: []
    });

    this.callbacks = {
      settings: () => {},
      init: () => true,
      bind_actions: () => true,
      render: () => true,

      onSalesbotDesignerSave: (_handlerCode, params) => {
        const hookUrl = (params && params.webhook_url) || '';

        // Paso 0: pedir el reply_text al webhook externo
        const requestStep = createStep([
          {
            handler: 'widget_request',
            params: {
              url: hookUrl,
              data: {
                source: 'reelance_hub',
                lead_id: '{{lead.id}}',
                contact_id: '{{contact.id}}',
                source_id: '{{lead.source_id}}',
                message_text: '{{message_text}}'
              }
            }
          },
          {
            handler: 'goto',
            params: { type: 'question', step: 1 }
          }
        ]);

        // Paso 1: si hay reply_text, enviarlo y parar.
        // El widget mismo envía el mensaje — NO debe haber ningún bloque adicional
        // de send_message después del widget en el salesbot.
        const deliveryStep = createStep([
          {
            handler: 'condition',
            params: {
              term1: '{{json.has_reply}}',
              term2: '1',
              operation: '=',
              result: [
                {
                  handler: 'send_external_message',
                  params: {
                    message: {
                      type: 'external',
                      text: '{{json.reply_text}}'
                    },
                    recipient: {
                      type: 'main_contact',
                      way_of_communication: 'last_active'
                    },
                    channels: [
                      { id: '{{json.reply_channel_id}}' }
                    ],
                    on_error: {
                      handler: 'show',
                      params: {
                        type: 'text',
                        value: 'No pude enviar el mensaje al canal externo configurado.'
                      }
                    }
                  }
                }
              ]
            }
          },
          { handler: 'stop', params: {} }
        ]);

        return JSON.stringify([requestStep, deliveryStep]);
      },

      destroy: () => {},
      onSave: () => true
    };

    return this;
  };
});
