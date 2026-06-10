'use strict';

const DEFAULT_MODELS = {
  anthropic: 'claude-haiku-4-5-20251001',
  openai:    'gpt-4o-mini',
  google:    'gemini-1.5-flash',
  ollama:    'gemma2:9b',
};

// Pricing público en USD por 1M tokens (input / output).
// Fuente: anthropic.com/pricing y openai.com/pricing (oct 2025).
// Si el modelo no está en esta lista, no calculamos costo pero sí log tokens.
const PRICING = {
  // Anthropic Claude
  'claude-haiku-4-5-20251001':   { in: 1.00,  out: 5.00 },
  'claude-haiku-4-5':            { in: 1.00,  out: 5.00 },
  'claude-haiku-3-5-20241022':   { in: 0.80,  out: 4.00 },
  'claude-3-5-haiku-20241022':   { in: 0.80,  out: 4.00 },
  'claude-sonnet-4-5-20250929':  { in: 3.00,  out: 15.00 },
  'claude-sonnet-4-20250514':    { in: 3.00,  out: 15.00 },
  'claude-3-5-sonnet-20241022':  { in: 3.00,  out: 15.00 },
  'claude-opus-4-20250514':      { in: 15.00, out: 75.00 },
  'claude-3-opus-20240229':      { in: 15.00, out: 75.00 },
  // OpenAI
  'gpt-4o-mini':                 { in: 0.15,  out: 0.60 },
  'gpt-4o':                      { in: 2.50,  out: 10.00 },
  'gpt-4-turbo':                 { in: 10.00, out: 30.00 },
  // Google Gemini
  'gemini-1.5-flash':            { in: 0.075, out: 0.30 },
  'gemini-1.5-pro':              { in: 1.25,  out: 5.00 },
  // Ollama (local, $0)
};

function _estimateCost(model, inputTokens, outputTokens) {
  const p = PRICING[model];
  if (!p) return 0;
  return ((inputTokens || 0) * p.in + (outputTokens || 0) * p.out) / 1_000_000;
}

// Registra una llamada al LLM en ai_usage_log para tracking de consumo.
// Llamada de "fire-and-forget" — si falla, no rompe el flujo principal.
function _logUsage(db, { tenantId, provider, model, inputTokens, outputTokens, kind }) {
  if (!db || !tenantId) return;
  try {
    const cost = _estimateCost(model, inputTokens, outputTokens);
    db.prepare(`
      INSERT INTO ai_usage_log (tenant_id, provider, model, input_tokens, output_tokens, cost_usd, kind)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(tenantId, provider, model || null, inputTokens || 0, outputTokens || 0, cost, kind || 'other');
  } catch (err) {
    console.warn('[ai-usage] log failed:', err.message);
  }
}

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

/**
 * callAI — llama al LLM del provider configurado por el tenant.
 *
 * @param {object} settings - { provider, apiKey, model, temperature, maxTokens, baseUrl }
 * @param {string} systemPrompt
 * @param {Array}  history - mensajes [{role, content}]
 * @param {object} [track] - opcional, para registrar usage:
 *   { db, tenantId, kind } — si se pasa, se inserta fila en ai_usage_log
 *
 * @returns {Promise<string>} - texto de respuesta
 */
// ¿El tenant tiene saldo de IA disponible? Solo aplica si el sistema de saldo
// está EN USO (ai_credit_loaded_at seteado) — tenants con su propia API key y
// sin carga de saldo no se bloquean. Antes el saldo solo se MOSTRABA: con
// saldo en 0, el matcher y el fallback seguían quemando tokens sin límite.
function hasAiCredit(db, tenantId) {
  try {
    const t = db.prepare('SELECT ai_credit_loaded_usd, ai_credit_loaded_at FROM tenants WHERE id = ?').get(tenantId) || {};
    if (!t.ai_credit_loaded_at) return true;
    const loaded = Number(t.ai_credit_loaded_usd || 0);
    const r = db.prepare('SELECT COALESCE(SUM(cost_usd),0) AS c FROM ai_usage_log WHERE tenant_id = ? AND created_at >= ?')
      .get(tenantId, t.ai_credit_loaded_at);
    return loaded - (r?.c || 0) > 0;
  } catch (_) { return true; }
}

async function callAI(settings, systemPrompt, history, track) {
  // Enforcement central de saldo: corta matcher, fallback, ai_reply y copilot
  // en un solo punto cuando el saldo cargado se agotó.
  if (track?.db && track?.tenantId && !hasAiCredit(track.db, track.tenantId)) {
    throw new Error('Saldo de IA agotado — recarga en Configuración → IA');
  }
  const provider    = settings.provider || 'anthropic';
  const apiKey      = settings.apiKey   || '';
  const model       = settings.model    || DEFAULT_MODELS[provider] || DEFAULT_MODELS.anthropic;
  const temperature = Number(settings.temperature ?? 0.7);
  const maxTokens   = Number(settings.maxTokens   ?? 1024);
  const baseUrl     = settings.baseUrl  || '';

  let inputTokens = 0;
  let outputTokens = 0;
  let text = '';

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
    text = d.content?.[0]?.text || '';
    inputTokens  = d.usage?.input_tokens  || 0;
    outputTokens = d.usage?.output_tokens || 0;
  } else if (provider === 'openai') {
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
    text = d.choices?.[0]?.message?.content || '';
    inputTokens  = d.usage?.prompt_tokens     || 0;
    outputTokens = d.usage?.completion_tokens || 0;
  } else if (provider === 'google') {
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
    text = d.candidates?.[0]?.content?.parts?.[0]?.text || '';
    inputTokens  = d.usageMetadata?.promptTokenCount     || 0;
    outputTokens = d.usageMetadata?.candidatesTokenCount || 0;
  } else if (provider === 'ollama') {
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
    text = d.message?.content || '';
    inputTokens  = d.prompt_eval_count || 0;
    outputTokens = d.eval_count        || 0;
  } else {
    throw new Error(`Proveedor no soportado: ${provider}`);
  }

  // Registrar usage si el caller pasó contexto de tracking
  if (track && track.db && track.tenantId) {
    _logUsage(track.db, {
      tenantId:     track.tenantId,
      provider,
      model,
      inputTokens,
      outputTokens,
      kind:         track.kind || 'other',
    });
  }

  return text;
}

// ─── Stats de consumo para Settings → IA ─────────────────────────────
function getUsageStats(db, tenantId) {
  // Cuenta total + total del mes en curso + desglose por kind
  const totalRow = db.prepare(`
    SELECT
      COALESCE(SUM(input_tokens),  0) AS in_tok,
      COALESCE(SUM(output_tokens), 0) AS out_tok,
      COALESCE(SUM(cost_usd),      0) AS cost
    FROM ai_usage_log WHERE tenant_id = ?
  `).get(tenantId);

  // Mes en curso (desde el día 1 del mes actual)
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const monthStartTs = Math.floor(monthStart.getTime() / 1000);

  const monthRow = db.prepare(`
    SELECT
      COALESCE(SUM(input_tokens),  0) AS in_tok,
      COALESCE(SUM(output_tokens), 0) AS out_tok,
      COALESCE(SUM(cost_usd),      0) AS cost,
      COUNT(*) AS calls
    FROM ai_usage_log WHERE tenant_id = ? AND created_at >= ?
  `).get(tenantId, monthStartTs);

  const byKind = db.prepare(`
    SELECT kind, COUNT(*) AS calls, SUM(input_tokens+output_tokens) AS tokens, SUM(cost_usd) AS cost
    FROM ai_usage_log WHERE tenant_id = ? AND created_at >= ?
    GROUP BY kind ORDER BY cost DESC
  `).all(tenantId, monthStartTs);

  const byModel = db.prepare(`
    SELECT model, COUNT(*) AS calls, SUM(input_tokens+output_tokens) AS tokens, SUM(cost_usd) AS cost
    FROM ai_usage_log WHERE tenant_id = ? AND created_at >= ?
    GROUP BY model ORDER BY cost DESC
  `).all(tenantId, monthStartTs);

  // Saldo cargado y alert
  const tenant = db.prepare(`
    SELECT ai_credit_loaded_usd, ai_credit_loaded_at, ai_credit_alert_threshold_usd
    FROM tenants WHERE id = ?
  `).get(tenantId) || {};

  // Restante estimado: cargado - consumido desde la fecha de carga
  let consumedSinceLoad = 0;
  if (tenant.ai_credit_loaded_at) {
    const r = db.prepare(`SELECT COALESCE(SUM(cost_usd),0) AS c FROM ai_usage_log WHERE tenant_id=? AND created_at >= ?`)
      .get(tenantId, tenant.ai_credit_loaded_at);
    consumedSinceLoad = r.c || 0;
  }
  const loaded = Number(tenant.ai_credit_loaded_usd || 0);
  const remaining = Math.max(0, loaded - consumedSinceLoad);

  return {
    loaded,
    loadedAt: tenant.ai_credit_loaded_at || null,
    alertThreshold: Number(tenant.ai_credit_alert_threshold_usd || 5),
    consumedSinceLoad,
    remaining,
    total: {
      inputTokens:  totalRow.in_tok,
      outputTokens: totalRow.out_tok,
      cost:         totalRow.cost,
    },
    month: {
      inputTokens:  monthRow.in_tok,
      outputTokens: monthRow.out_tok,
      cost:         monthRow.cost,
      calls:        monthRow.calls,
    },
    byKind,
    byModel,
  };
}

function setCredit(db, tenantId, { loadedUsd, alertThreshold }) {
  const updates = [];
  const params  = [];
  if (typeof loadedUsd === 'number' && loadedUsd >= 0) {
    updates.push('ai_credit_loaded_usd = ?');
    updates.push('ai_credit_loaded_at = unixepoch()');
    params.push(loadedUsd);
  }
  if (typeof alertThreshold === 'number' && alertThreshold >= 0) {
    updates.push('ai_credit_alert_threshold_usd = ?');
    params.push(alertThreshold);
  }
  if (!updates.length) return;
  params.push(tenantId);
  db.prepare(`UPDATE tenants SET ${updates.join(', ')} WHERE id = ?`).run(...params);
}

module.exports = { getSettings, getKnowledgeContext, getConversationHistory, callAI, getUsageStats, setCredit, hasAiCredit };
