'use strict';

const { getSettings, getKnowledgeContext, callAI } = require('./service');
const { getEnabledTools, executeTool } = require('./tools');

const MAX_ROUNDS = 4;

const SYSTEM_PROMPT = `Eres Copiloto, el asistente de inteligencia artificial integrado en Wapi101 CRM.
Tu misión es ayudar al equipo de ventas a consultar y gestionar su CRM de forma ágil.

REGLAS ESTRICTAS — nunca las rompas:
- Solo operas sobre datos del CRM (contactos, leads, pipelines, asesores, estadísticas).
- NUNCA envíes mensajes a contactos externos.
- NUNCA modifiques la configuración del sistema (integraciones, bots, plantillas, billing, asesores).
- NUNCA elimines datos de ningún tipo.
- NUNCA ejecutes código ni consultas SQL arbitrarias.
- Si te piden algo fuera de tu alcance, explica brevemente por qué no puedes hacerlo.
- Responde siempre en el mismo idioma que usa el usuario (español por defecto).
- Sé conciso. Si la respuesta es larga, usa listas.
- Cuando uses herramientas, NO expliques cada llamada — solo reporta el resultado final.
{{context}}`;

async function chat(db, tenantId, history, userMessage, config = {}) {
  const settings = getSettings(db, tenantId);
  if (!settings.apiKey && settings.provider !== 'ollama') {
    return { reply: '⚠️ Configura el API Key de IA en **Ajustes → IA** para usar el Copiloto.', history };
  }

  const tools     = getEnabledTools(config);
  const knowledge = getKnowledgeContext(db, tenantId);
  const context   = knowledge ? `\n\nContexto del negocio (Fuentes de conocimiento):\n${knowledge}` : '';
  const sysPrompt = SYSTEM_PROMPT.replace('{{context}}', context);

  // Max 20 mensajes de historial para controlar tokens
  const trimmedHistory = history.slice(-20);
  const messages = [...trimmedHistory, { role: 'user', content: userMessage }];

  // Usar modelo configurado o Haiku por defecto (más barato para herramientas)
  const effectiveSettings = {
    ...settings,
    model: config.model || settings.model || 'claude-haiku-4-5-20251001',
  };

  let rounds = 0;
  let currentMessages = messages;

  while (rounds < MAX_ROUNDS) {
    const response = await callAIWithTools(effectiveSettings, sysPrompt, currentMessages, tools);

    if (response.stopReason === 'end_turn' || response.stopReason === 'stop') {
      const updatedHistory = [
        ...currentMessages,
        { role: 'assistant', content: response.text },
      ];
      return { reply: response.text, history: updatedHistory.slice(-20) };
    }

    if (response.stopReason === 'tool_use' && response.toolCalls?.length) {
      // Ejecutar todas las tool calls en paralelo
      const toolResults = await Promise.all(
        response.toolCalls.map(async tc => {
          try {
            const result = await executeTool(db, tenantId, tc.name, tc.input, config);
            return { type: 'tool_result', tool_use_id: tc.id, content: JSON.stringify(result) };
          } catch (err) {
            return { type: 'tool_result', tool_use_id: tc.id, content: JSON.stringify({ error: err.message }), is_error: true };
          }
        })
      );

      currentMessages = [
        ...currentMessages,
        { role: 'assistant', content: response.rawContent },
        { role: 'user',      content: toolResults },
      ];
      rounds++;
      continue;
    }

    // Fallback: si no hay tool_use ni end_turn
    break;
  }

  return { reply: response?.text || 'Sin respuesta', history: [...currentMessages].slice(-20) };
}

async function callAIWithTools(settings, systemPrompt, messages, tools) {
  const provider = settings.provider || 'anthropic';

  if (provider === 'anthropic') {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         settings.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model:      settings.model || 'claude-haiku-4-5-20251001',
        max_tokens: Math.min(Number(settings.maxTokens) || 1024, 2048),
        system:     systemPrompt,
        tools:      tools.map(t => ({ name: t.name, description: t.description, input_schema: t.input_schema })),
        messages,
      }),
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new Error(e.error?.message || `Anthropic HTTP ${r.status}`);
    }
    const d = await r.json();
    const textBlock = d.content?.find(b => b.type === 'text');
    const toolBlocks = d.content?.filter(b => b.type === 'tool_use') || [];
    return {
      stopReason: d.stop_reason,
      text:       textBlock?.text || '',
      rawContent: d.content,
      toolCalls:  toolBlocks.map(b => ({ id: b.id, name: b.name, input: b.input })),
    };
  }

  if (provider === 'openai') {
    const base = settings.baseUrl || 'https://api.openai.com/v1';
    const openaiTools = tools.map(t => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.input_schema },
    }));
    const msgs = [{ role: 'system', content: systemPrompt }, ...messages];
    const r = await fetch(`${base}/chat/completions`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${settings.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: settings.model || 'gpt-4o-mini',
        messages: msgs,
        tools: openaiTools,
        max_tokens: Math.min(Number(settings.maxTokens) || 1024, 2048),
      }),
    });
    if (!r.ok) throw new Error(`OpenAI HTTP ${r.status}`);
    const d = await r.json();
    const msg = d.choices?.[0]?.message;
    const toolCalls = msg?.tool_calls?.map(tc => ({
      id:    tc.id,
      name:  tc.function.name,
      input: JSON.parse(tc.function.arguments || '{}'),
    })) || [];
    return {
      stopReason: toolCalls.length ? 'tool_use' : 'end_turn',
      text:       msg?.content || '',
      rawContent: msg,
      toolCalls,
    };
  }

  // Google y Ollama: sin tool calling nativo → solo texto
  const { callAI } = require('./service');
  const text = await callAI(settings, systemPrompt, messages.filter(m => typeof m.content === 'string'));
  return { stopReason: 'end_turn', text, rawContent: text, toolCalls: [] };
}

module.exports = { chat };
