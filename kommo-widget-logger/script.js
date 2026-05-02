define(['jquery'], function () {
  return function ReelanceLoggerWidget() {
    const LOG_URL = 'https://lucho101.com/webhooks/kommo/log-outgoing';

    // Defaults del manifest — los detectamos para no enviarlos como si fueran
    // texto del usuario.
    const PLACEHOLDER_MSG = 'Pega aquí el texto de la plantilla';
    const PLACEHOLDER_TAG = 'Plantilla';

    const createStep = (items) => ({
      question: items,
      require: []
    });

    // Devuelve el texto real escrito por el usuario.
    // Kommo guarda el contenido del UI de "3 puntos / entrada manual" en
    // `value_manual` además del campo con su nombre. Preferimos value_manual
    // cuando difiere del placeholder; si no, caemos al campo nombrado.
    const pickRealText = (p, fieldName, placeholder) => {
      const vm = p && typeof p.value_manual === 'string' ? p.value_manual.trim() : '';
      const fv = p && typeof p[fieldName] === 'string' ? p[fieldName].trim() : '';
      if (vm && vm !== placeholder) return vm;
      if (fv && fv !== placeholder) return fv;
      return '';
    };

    this.callbacks = {
      settings: () => {},
      init: () => true,
      bind_actions: () => true,
      render: () => true,

      onSalesbotDesignerSave: (handlerCode, params) => {
        if (handlerCode === 'log_template_sent') {
          const p = params || {};

          const messageText = pickRealText(p, 'message_text', PLACEHOLDER_MSG);
          // tag: solo si es distinto del texto del mensaje (evita duplicar lo
          // mismo cuando el usuario escribe su plantilla en el campo tag)
          const rawTag = pickRealText(p, 'tag', PLACEHOLDER_TAG);
          const tag = rawTag && rawTag !== messageText ? rawTag : '';

          const requestStep = createStep([
            {
              handler: 'widget_request',
              params: {
                url: LOG_URL,
                data: {
                  source:          'reelance_hub_log',
                  lead_id:         '{{lead.id}}',
                  contact_id:      '{{contact.id}}',
                  text:            messageText,
                  tag:             tag,
                  _widget_version: '1.0.3'   // marcador de versión para debug
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
