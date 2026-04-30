const kommo = require('../lib/kommo');
const config = require('./config');
const { onlyDigits } = require('./normalize');

const PHONE_FIELD_CODE = 'PHONE';
const EMAIL_FIELD_CODE = 'EMAIL';
const ENUM_CODE_DEFAULT = 'WORK';

function buildContactFields({ phone, email }) {
  const fields = [];
  if (phone) {
    fields.push({
      field_code: PHONE_FIELD_CODE,
      values: [{ value: phone, enum_code: ENUM_CODE_DEFAULT }]
    });
  }
  if (email) {
    fields.push({
      field_code: EMAIL_FIELD_CODE,
      values: [{ value: email, enum_code: ENUM_CODE_DEFAULT }]
    });
  }
  return fields;
}

function extractFieldValues(entity, fieldCode) {
  const fields = entity?.custom_fields_values || [];
  const found = fields.find((f) => f?.field_code === fieldCode);
  if (!found) return [];
  return (found.values || []).map((v) => v?.value).filter(Boolean);
}

function tagsFromEntity(entity) {
  return (entity?._embedded?.tags || []).map((t) => ({ id: t.id, name: t.name }));
}

function ensureTagsList(existingTags, namesToAdd) {
  const existingNamesLower = new Set(existingTags.map((t) => String(t.name || '').toLowerCase()));
  const merged = [...existingTags.map((t) => ({ id: t.id }))];
  for (const name of namesToAdd) {
    if (!existingNamesLower.has(String(name).toLowerCase())) {
      merged.push({ name });
      existingNamesLower.add(String(name).toLowerCase());
    }
  }
  return merged;
}

async function searchContactByQuery(query) {
  if (!query) return null;
  try {
    const data = await kommo.apiRequest(
      'get',
      `/api/v4/contacts?query=${encodeURIComponent(query)}&with=leads`
    );
    const items = data?._embedded?.contacts || [];
    return items[0] || null;
  } catch (error) {
    if (error?.response?.status === 204 || error?.response?.status === 404) {
      return null;
    }
    throw error;
  }
}

async function findContact({ phone, email }) {
  const candidates = [];
  if (phone) {
    candidates.push(phone);
    const digits = onlyDigits(phone);
    if (digits && digits !== phone) candidates.push(digits);
    if (digits.length >= 10) candidates.push(digits.slice(-10));
  }
  if (email) candidates.push(email);

  for (const q of candidates) {
    const found = await searchContactByQuery(q);
    if (found) return found;
  }
  return null;
}

async function createContact({ contact, orderNumber }) {
  const body = [
    {
      name: contact.fullName || [contact.firstName, contact.lastName].filter(Boolean).join(' '),
      first_name: contact.firstName || '',
      last_name: contact.lastName || '',
      custom_fields_values: buildContactFields({
        phone: contact.phone,
        email: contact.email
      }),
      _embedded: {
        tags: [
          { name: config.kommo.clienteTagName },
          ...(orderNumber ? [{ name: orderNumber }] : [])
        ]
      }
    }
  ];

  const data = await kommo.apiRequest('post', '/api/v4/contacts', body);
  return data?._embedded?.contacts?.[0] || null;
}

async function updateContactIfNeeded({ existing, contact, orderNumber }) {
  const patch = {};
  const existingEmails = extractFieldValues(existing, EMAIL_FIELD_CODE).map((v) =>
    String(v).toLowerCase()
  );
  const existingPhones = extractFieldValues(existing, PHONE_FIELD_CODE).map((v) => onlyDigits(v));

  const customFields = [];

  if (contact.email && !existingEmails.includes(contact.email)) {
    customFields.push({
      field_code: EMAIL_FIELD_CODE,
      values: [{ value: contact.email, enum_code: ENUM_CODE_DEFAULT }]
    });
  }

  if (contact.phone) {
    const incomingDigits = onlyDigits(contact.phone);
    if (!existingPhones.includes(incomingDigits)) {
      customFields.push({
        field_code: PHONE_FIELD_CODE,
        values: [{ value: contact.phone, enum_code: ENUM_CODE_DEFAULT }]
      });
    }
  }

  if (customFields.length > 0) {
    patch.custom_fields_values = customFields;
  }

  const tagsToAdd = [config.kommo.clienteTagName, orderNumber].filter(Boolean);
  const mergedTags = ensureTagsList(tagsFromEntity(existing), tagsToAdd);
  if (mergedTags.length !== tagsFromEntity(existing).length) {
    patch._embedded = { tags: mergedTags };
  }

  if (Object.keys(patch).length === 0) {
    return existing;
  }

  const data = await kommo.apiRequest('patch', `/api/v4/contacts/${existing.id}`, patch);
  return data || existing;
}

async function getLeadsForContact(contactId) {
  if (!contactId) return [];
  try {
    const data = await kommo.apiRequest('get', `/api/v4/contacts/${contactId}?with=leads`);
    const links = data?._embedded?.leads || [];
    if (links.length === 0) return [];
    const leads = [];
    for (const link of links) {
      try {
        const lead = await kommo.apiRequest('get', `/api/v4/leads/${link.id}`);
        leads.push(lead);
      } catch (_e) {
        // skip
      }
    }
    return leads;
  } catch (_error) {
    return [];
  }
}

const leadFieldTypeCache = new Map();

async function getLeadFieldType(fieldId) {
  if (!fieldId) return null;
  if (leadFieldTypeCache.has(fieldId)) return leadFieldTypeCache.get(fieldId);
  try {
    const data = await kommo.apiRequest('get', `/api/v4/leads/custom_fields/${fieldId}`);
    const type = data?.type || null;
    leadFieldTypeCache.set(fieldId, type);
    return type;
  } catch (_error) {
    leadFieldTypeCache.set(fieldId, null);
    return null;
  }
}

function unixSecondsFromOrder(order) {
  const d = new Date(order.orderDate);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor(d.getTime() / 1000);
}

async function buildLastOrderFields(order) {
  const map = config.kommo.fields;
  const out = [];
  if (map.lastOrderNumber && order.orderNumber) {
    out.push({ field_id: map.lastOrderNumber, values: [{ value: order.orderNumber }] });
  }
  if (map.lastOrderDate) {
    const fieldType = await getLeadFieldType(map.lastOrderDate);
    if (fieldType === 'date' || fieldType === 'date_time' || fieldType === 'birthday') {
      const seconds = unixSecondsFromOrder(order);
      if (seconds !== null) {
        out.push({ field_id: map.lastOrderDate, values: [{ value: seconds }] });
      }
    } else if (order.orderDateFormatted) {
      out.push({ field_id: map.lastOrderDate, values: [{ value: order.orderDateFormatted }] });
    }
  }
  if (map.lastOrderTotal && order.total) {
    const totalText = order.currency ? `${order.total} ${order.currency}` : order.total;
    out.push({ field_id: map.lastOrderTotal, values: [{ value: totalText }] });
  }
  if (map.lastOrderItems && order.itemsSummary) {
    out.push({ field_id: map.lastOrderItems, values: [{ value: order.itemsSummary }] });
  }
  if (map.lastOrderStatus && order.status) {
    out.push({ field_id: map.lastOrderStatus, values: [{ value: order.status }] });
  }
  return out;
}

async function createLead({ contactId, contactName, order }) {
  if (!config.kommo.pipelineClientesId || !config.kommo.statusRecientesId) {
    throw new Error(
      'Faltan KOMMO_PIPELINE_CLIENTES_ID o KOMMO_STATUS_RECIENTES_ID en .env (corre discover.js).'
    );
  }

  const body = [
    {
      name: `${contactName || 'Cliente'} ${order.orderDateFormatted}`.trim(),
      pipeline_id: config.kommo.pipelineClientesId,
      status_id: config.kommo.statusRecientesId,
      custom_fields_values: await buildLastOrderFields(order),
      _embedded: {
        contacts: contactId ? [{ id: contactId }] : [],
        tags: [
          { name: config.kommo.clienteTagName },
          ...(order.orderNumber ? [{ name: order.orderNumber }] : [])
        ]
      }
    }
  ];

  const data = await kommo.apiRequest('post', '/api/v4/leads', body);
  return data?._embedded?.leads?.[0] || null;
}

async function updateLeadOnNewOrder({ lead, order }) {
  const patch = {};

  if (config.kommo.pipelineClientesId && config.kommo.statusRecientesId) {
    patch.pipeline_id = config.kommo.pipelineClientesId;
    patch.status_id = config.kommo.statusRecientesId;
  }

  const customFields = await buildLastOrderFields(order);
  if (customFields.length > 0) {
    patch.custom_fields_values = customFields;
  }

  if (order.orderNumber) {
    const mergedTags = ensureTagsList(tagsFromEntity(lead), [order.orderNumber]);
    if (mergedTags.length !== tagsFromEntity(lead).length) {
      patch._embedded = { tags: mergedTags };
    }
  }

  if (Object.keys(patch).length === 0) {
    return lead;
  }

  const data = await kommo.apiRequest('patch', `/api/v4/leads/${lead.id}`, patch);
  return data || lead;
}

async function stopSalesbotsOnLead(leadId) {
  const botIds = config.kommo.botsToStop;
  const results = [];
  if (!leadId) return results;

  if (botIds.length === 0) {
    try {
      await kommo.apiRequest('delete', `/api/v2/salesbot/run?entity_type=2&entity_id=${leadId}`);
      results.push({ ok: true, mode: 'all' });
    } catch (error) {
      results.push({
        ok: false,
        mode: 'all',
        status: error?.response?.status || null,
        message: error.message
      });
    }
    return results;
  }

  for (const botId of botIds) {
    try {
      await kommo.apiRequest(
        'delete',
        `/api/v2/salesbot/${encodeURIComponent(botId)}/run?entity_type=2&entity_id=${leadId}`
      );
      results.push({ ok: true, botId });
    } catch (error) {
      results.push({
        ok: false,
        botId,
        status: error?.response?.status || null,
        message: error.message
      });
    }
  }
  return results;
}

async function syncOrder(order) {
  const audit = {
    orderNumber: order.orderNumber,
    contact: { action: null, id: null },
    lead: { action: null, id: null },
    bots: []
  };

  let contactRecord = await findContact({
    phone: order.contact.phone,
    email: order.contact.email
  });

  if (!contactRecord) {
    contactRecord = await createContact({
      contact: order.contact,
      orderNumber: order.orderNumber
    });
    audit.contact.action = 'created';
  } else {
    contactRecord = await updateContactIfNeeded({
      existing: contactRecord,
      contact: order.contact,
      orderNumber: order.orderNumber
    });
    audit.contact.action = 'updated';
  }

  audit.contact.id = contactRecord?.id || null;

  const existingLeads = await getLeadsForContact(contactRecord?.id);
  const openLead = existingLeads.find((l) => !l.closed_at) || existingLeads[0] || null;

  let leadRecord;
  if (openLead) {
    leadRecord = await updateLeadOnNewOrder({ lead: openLead, order });
    audit.lead.action = 'updated';
  } else {
    leadRecord = await createLead({
      contactId: contactRecord?.id,
      contactName: order.contact.fullName,
      order
    });
    audit.lead.action = 'created';
  }

  audit.lead.id = leadRecord?.id || null;

  if (leadRecord?.id) {
    audit.bots = await stopSalesbotsOnLead(leadRecord.id);
  }

  return audit;
}

module.exports = { syncOrder };
