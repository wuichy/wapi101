'use strict';

const DEFAULT_MODELS = {
  anthropic: 'claude-haiku-4-5-20251001',
  openai:    'gpt-4o-mini',
  google:    'gemini-1.5-flash',
  ollama:    'gemma2:9b',
};

function getSettings(db, tenantId) {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = 'ai_settings' AND tenant_id = ?").get(tenantId);
  return row ? JSON.parse(row.value) : {};
}

function getKnowledgeContext(db, tenantId) {
  const sources = db.prepare(
    "SELECT title, category, content FROM ai_knowledge_sources WHERE tenant_id = ? AND active = 1 ORDER BY sort_order, id"
  ).all(tenantId);
  if (!sources.length) return '';
  return sources.map(s => `[${s.category || s.title}]\n${s.content}`).join('\n\n');
}

function getConversationHistory(db, tenantId, convoId, limit = 15) {
  const rows = db.prepare(`
    SELECT direction, body FROM messages
     WHERE conversation_id = ? AND tenant_id = ? AND body IS NOT NULL AND body != ''
     ORDER BY created_at DESC LIMIT ?
  `).all(convoId, tenantId, limit);
  return rows.reverse().map(r => ({
    role:    r.direction === 'outgoing' ? 'assistant' : 'user',
    content: r.body,
  }));
}

async function callAI(settings, systemPrompt, history) {
  const provider    = settings.provider || 'anthropic';
  const apiKey      = settings.apiKey   || '';
  const model       = settings.model    || DEFAULT_MODELS[provider] || DEFAULT_MODELS.anthropic;
  const temperature = Number(settings.temperature ?? 0.7);
  const maxTokens   = Number(settings.maxTokens   ?? 1024);
  const baseUrl     = settings.baseUrl  || '';

  if (provider === 'anthropic') {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model, max_tokens: maxTokens, temperature,
        system:   systemPrompt,
        messages: history,
      }),
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new Error(e.error?.message || `Anthropic HTTP ${r.status}`);
    }
    const d = await r.json();
    return d.content?.[0]?.text || '';
  }

  if (provider === 'openai') {
    const base = baseUrl || 'https://api.openai.com/v1';
    const messages = systemPrompt
      ? [{ role: 'system', content: systemPrompt }, ...history]
      : history;
    const r = await fetch(`${base}/chat/completions`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens }),
    });
    if (!r.ok) throw new Error(`OpenAI HTTP ${r.status}`);
    const d = await r.json();
    return d.choices?.[0]?.message?.content || '';
  }

  if (provider === 'google') {
    const contents = history.map(m => ({
      role:  m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: systemPrompt ? { parts: [{ text: systemPrompt }] } : undefined,
          contents,
          generationConfig: { temperature, maxOutputTokens: maxTokens },
        }),
      }
    );
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new Error(e.error?.message || `Google HTTP ${r.status}`);
    }
    const d = await r.json();
    return d.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  if (provider === 'ollama') {
    const base = baseUrl || 'http://localhost:11434';
    const messages = systemPrompt
      ? [{ role: 'system', content: systemPrompt }, ...history]
      : history;
    const r = await fetch(`${base}/api/chat`, {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: false,
        options: { temperature, num_predict: maxTokens } }),
    });
    if (!r.ok) throw new Error(`Ollama HTTP ${r.status}`);
    const d = await r.json();
    return d.message?.content || '';
  }

  throw new Error(`Proveedor no soportado: ${provider}`);
}

module.exports = { getSettings, getKnowledgeContext, getConversationHistory, callAI };
