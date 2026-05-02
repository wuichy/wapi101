# Kommo — Referencia técnica

> Documento de referencia para integración con Kommo (CRM, ex-amoCRM). Generado a partir de developers.kommo.com, kommo.com/help, comunidad y SDKs públicos. Última actualización: 2026-04-30.

---

## 1. Visión general

Kommo es un CRM SaaS orientado a ventas conversacionales. Cada cuenta vive en un subdominio: `https://{subdomain}.kommo.com`. Toda llamada a la API debe ir a ese subdominio, **nunca a kommo.com directo**.

**Modelo de datos principal:**
- **Leads** (deals): entidad central. `id`, `name`, `price`, `status_id`, `pipeline_id`, `responsible_user_id`, `closed_at`, `loss_reason_id`, `tags`, `custom_fields_values`, `_embedded.contacts`, etc.
- **Contacts**: personas. Email/teléfono son **custom fields del sistema** (`field_code` = `EMAIL` / `PHONE`, multitext con enums `WORK`/`MOB`/`HOME`/`OTHER`).
- **Companies**: organizaciones.
- **Customers**: módulo aparte para gestión recurrente (post-venta).
- **Pipelines + Statuses (stages)**: cada pipeline contiene stages. **142 = Won**, **143 = Lost** son **reservados y no se pueden borrar**.
- **Tasks**: con `task_type_id`, `entity_type`, `complete_till`, `is_completed`.
- **Notes**: feed cronológico (common, call_in, call_out, attachment, etc.).
- **Events**: actividad inmutable (auditoría) — útil para sincronización delta.
- **Custom Fields**: por entidad. Tipos: text, numeric, checkbox, select, multiselect, date, url, multitext, textarea, file, etc.
- **Catalogs/Lists**: bases de datos personalizadas (productos).
- **Sources**: representa canales de entrada de leads.

**Límites clave:**
- **Webhooks**: máx 100/cuenta. Solo planes Advanced+.
- **Pipelines**: 50 máx · **Stages por pipeline**: 100 máx.
- **Sources por integración**: 100 máx · **Lists por cuenta**: 10 máx.
- **Custom field values por entidad**: 40 máx.
- **Storage**: 10 GB en trial.

---

## 2. Autenticación (OAuth 2.0)

**Authorization Code flow:**
1. Redirect: `https://www.kommo.com/oauth?client_id={INTEGRATION_ID}&state={CSRF}&mode=post_message`
2. Kommo redirige al `Redirect URI` con `?code=...&referer={subdomain}.kommo.com`. **Guarda el `referer`** — lo necesitas para todas las llamadas.
3. Intercambio: `POST https://{subdomain}.kommo.com/oauth2/access_token` con `client_id`, `client_secret`, `grant_type=authorization_code`, `code`, `redirect_uri`.
4. Tokens: `access_token` (24h JWT) + `refresh_token` (3 meses).
5. Refresh: `grant_type=refresh_token`. **El refresh anterior queda invalidado** — guarda el nuevo en transacción.

**Long-lived token** (integraciones privadas): desde *Configuración → Integraciones → Crear integración → Keys and Scopes*. Sin `redirect_uri`. Ideal para módulos backend single-tenant.

**Header**: `Authorization: Bearer {access_token}`.

**Webhook de desinstalación**: HMAC-SHA256(`{client_id}|{account_id}`, secret_key) → comparar con query param `signature`.

---

## 3. REST API

**Base**: `https://{subdomain}.kommo.com/api/v4/`. JSON con `Content-Type: application/hal+json`.

**Formato HAL+JSON**: `_links` (self, next, prev) + `_embedded` con relaciones.

**Paginación**: `page` (1-indexed) + `limit` (máx 250, recomendado ≤50). Iterar siguiendo `_links.next.href`. **204 No Content = no hay más** (no 200 con array vacío).

**Filtros**: `filter[field]`, `filter[field][from|to]`, `order[field]=asc|desc`.

**Embedded**: `with=contacts,companies,catalog_elements,loss_reason`.

**Búsqueda**: `?query=foo@bar.com` en contacts (full-text por nombre/email/teléfono — **clave para deduplicación**).

**Endpoints principales:**

| Recurso | URL |
|---|---|
| Leads | `/api/v4/leads`, `/api/v4/leads/{id}` |
| Leads complejos (lead+contact+company en uno) | `/api/v4/leads/complex` |
| Incoming leads | `/api/v4/leads/unsorted` |
| Contacts | `/api/v4/contacts`, `/api/v4/contacts/{id}` |
| Companies | `/api/v4/companies` |
| Tasks | `/api/v4/tasks` |
| Notes | `/api/v4/leads/{id}/notes` |
| Pipelines | `/api/v4/leads/pipelines` |
| Custom Fields | `/api/v4/leads/custom_fields` |
| Users | `/api/v4/users` |
| Events | `/api/v4/events` |
| Catalogs | `/api/v4/catalogs/{id}/elements` |
| Webhooks | `/api/v4/webhooks` |

**Bulk**: `POST`/`PATCH /api/v4/leads` aceptan arrays de hasta 250 (recomendado ≤50; >50 → 504 frecuente).

**Rate limit**: **7 req/seg por cuenta**. 429 → bloqueo temporal; abuso → 403 con IP banneada.

**Custom fields en payload:**
```json
"custom_fields_values": [
  { "field_id": 12345, "values": [{ "value": "Order #1042" }] },
  { "field_code": "PHONE", "values": [{ "value": "+5215512345678", "enum_code": "MOB" }]},
  { "field_id": 67890, "values": [{ "enum_id": 9999 }] }
]
```

**HTTP codes**: 200, 202 (bulk en cola), 204, 400 (field_id inválido), 401, 402 (plan insuficiente), 403, 404, 429, 504.

---

## 4. Webhooks

**Registro**: UI o `POST /api/v4/webhooks` con `{ "destination": "https://...", "settings": ["add_lead", "status_lead", ...] }`.

**Eventos**:
- Leads: `add_lead`, `update_lead`, `delete_lead`, `restore_lead`, `status_lead`, `responsible_lead`
- Contacts: `add_contact`, `update_contact`, `delete_contact`, `responsible_contact`
- Companies: `add_company`, `update_company`, `delete_company`
- Tasks/Notes/Catalog: similar
- Talks/Messages (Chats API)

**Payload**: `application/x-www-form-urlencoded` con JSON anidado:
```
leads[status][0][id]=123
leads[status][0][status_id]=142
leads[status][0][old_status_id]=12345
leads[status][0][pipeline_id]=7891011
account[id]=999
account[subdomain]=midominio
```

**Expectativas**:
- Responder **HTTP 100–299 en menos de 2 segundos**.
- 100+ respuestas inválidas en 2h → webhook deshabilitado.
- Reintentos: 5 min → 15 min → 15 min → 1 h.
- **Sin firma HMAC nativa** (solo el de desinstalación). Usar token secreto en URL del endpoint o whitelist de IPs.

**Webhooks en Digital Pipeline**: variante por-stage configurable en *Leads → Automatizar → API: + Send webhook*.

---

## 5. Salesbot

Motor de automatización conversacional declarado en JSON.

**Handlers clave para integraciones:**

- **`widget_request`**: hace HTTP a tu backend desde el bot (solo dentro de paso "Widget").
  ```json
  {
    "handler": "widget_request",
    "params": {
      "url": "https://midominio.com/handler",
      "data": { "lead_id": "{{lead.id}}", "from": "salesbot" }
    }
  }
  ```
- **`conditions`**: ramificación con operadores (`=`, `!=`, `>`, `<`, `contains`), variables Mustache (`{{contact.name}}`, `{{lead.cf.<field_id>}}`, `{{json.foo}}` de la respuesta del último `widget_request`).
- **`show`** / **`message`**: enviar texto al chat.
- **`question`**: esperar respuesta del usuario.
- **`goto`**: saltar a paso.

---

## 6. Widgets (apps embebidas)

Estructura `.zip`:
```
manifest.json   (metadata, locations, scopes, i18n)
script.js       (AMD/RequireJS)
style.css
images/         (logo + thumbnails)
templates/      (Twig server + Handlebars cliente)
i18n/           (en.json, es.json, pt.json, ru.json)
```

**Locations** del manifest: `lead_card`, `contact_card`, `company_card`, `customer_card`, `settings`, `advanced_settings`, `lead_sources`, `digital_pipeline`, `salesbot_designer`, `card_sdk`, `lists`.

**Web SDK**: JS SDK (modales, notificaciones), Card SDK (manipular card actual), Lists SDK, Salesbot SDK.

---

## 7. Chats API

Dominio dedicado (no el subdominio del usuario). Firma **HMAC-SHA1** en cada petición con `secret` del canal.

**Flujo**:
1. Registrar canal: `POST /v2/origin/custom/{channel_id}/connect`.
2. Mensajes salientes: `POST /v2/origin/custom/{scope_id}` con `{ "event_type": "new_message", "payload": {...} }`.
3. Recibir: Kommo → tu callback URL.
4. Desconectar: `DELETE /v2/origin/custom/{channel_id}/disconnect`.

**Tipos**: text, picture, video, file, voice, sticker, location, contact.

**Header**: `X-Signature: <hmac_sha1(body, channel_secret)>` + `Date` RFC 1123.

---

## 8. Casos comunes WooCommerce ↔ Kommo

### a) Crear lead al hacer pedido
1. Buscar contacto por email: `GET /api/v4/contacts?query={email}`.
2. Si no existe → crear con `custom_fields_values` (PHONE/EMAIL).
3. Crear lead con `POST /api/v4/leads/complex` (lead+contact+company en un round-trip).
4. Guardar `kommo_lead_id` en order meta.

```json
[{
  "name": "Pedido #1042 - Juan Pérez",
  "price": 4599,
  "pipeline_id": 7891011,
  "status_id": 12345001,
  "_embedded": {
    "contacts": [{
      "first_name": "Juan", "last_name": "Pérez",
      "custom_fields_values": [
        { "field_code": "EMAIL", "values": [{ "value": "juan@x.com", "enum_code": "WORK" }]},
        { "field_code": "PHONE", "values": [{ "value": "+5215512345678", "enum_code": "MOB" }]}
      ]
    }],
    "tags": [{ "name": "woocommerce" }, { "name": "wc-processing" }]
  },
  "custom_fields_values": [
    { "field_id": 1, "values": [{ "value": 1042 }] },
    { "field_id": 2, "values": [{ "value": "https://shop.tld/wp-admin/post.php?post=1042" }] }
  ]
}]
```

### b) Sincronizar estados WC → Kommo stages

| WooCommerce | Kommo stage |
|---|---|
| pending | "Por pagar" (custom) |
| processing | "En preparación" |
| on-hold | "En espera" |
| completed | 142 (Won) |
| cancelled | 143 (Lost) + `loss_reason_id` |
| refunded | 143 + tag "refund" |
| failed | 143 + `loss_reason_id` |

`PATCH /api/v4/leads/{id}` con `{ "status_id": ..., "pipeline_id": ... }`.

### c) Webhook reverso Kommo → WC
Recibir `status_lead` → buscar order via `_kommo_lead_id` → actualizar status. **Idempotencia**: bandera `_kommo_skip_next_sync` para evitar bucle.

### d) Deduplicación
Antes de crear contacto: `GET /api/v4/contacts?query={email}`. Normalizar phone a E.164 (sin espacios/guiones).

### e) Catálogo de productos
Sincronizar `wp_posts` con un Catalog dedicado: `POST /api/v4/catalogs/{id}/elements`. Vincular al lead vía `_embedded.catalog_elements`.

### f) Custom fields recomendados (lead)
WC Order ID, Order URL, Order Status, Payment Method, Shipping Method, Total, Currency, Customer Note, Coupons, Tracking Number, Tracking URL.

---

## 9. Pitfalls y mejores prácticas

- **Subdominio siempre**, nunca `kommo.com` directo. El `referer` del callback OAuth es la fuente de verdad.
- **Refresh token se invalida al usarlo**. Con condiciones de carrera (dos workers refrescando), uno verá `400 invalid_grant`. Usa lock distribuido (Redis/transient WP) y persiste en transacción.
- **7 req/seg global por cuenta** — implementa cola con backoff exponencial + jitter ante 429. Bulk con lotes ≤50 (no 250).
- **Webhooks no firmados**: añade token secreto en URL (`/kommo-webhook?t=xxx`).
- **2 segundos de SLA**: encola (Action Scheduler de WC) y responde 200 inmediato. >100 inválidas en 2h → webhook deshabilitado.
- **`field_id` no es portable entre cuentas**. Usa `field_code` cuando exista (EMAIL/PHONE/POSITION/IM); para custom propios, mapeo en UI o crearlos al activar el plugin.
- **Stages 142/143 reservados** — no usar para "intermedio".
- **40 custom fields máximo por entidad** — no expongas todos los meta de WC sin filtro.
- **Multitext (email/phone)**: enviar el **array completo** (Kommo reemplaza, no merge).
- **Bucle infinito WC↔Kommo**: cualquier `PATCH` dispara `update_lead` webhook. Marca origen con flag temporal.
- **Tokens cifrados** (no `wp_options` plano). Si filtras `client_secret`, rota primero el secret y luego los tokens.
- **Eventos como fuente delta**: `GET /api/v4/events?filter[type]=...&filter[created_at][from]=...` — más fiable que webhooks para reconciliación tras downtime.
- **Trial/Free**: sin webhooks (Advanced+). Documenta el requisito.
- **i18n**: nombres de stage como los puso el usuario; no asumas inglés.

---

## 10. Referencias clave

**Oficial:**
- [Kommo for developers](https://developers.kommo.com/docs/kommo-for-developers)
- [API Reference](https://developers.kommo.com/reference/kommo-api-reference)
- [Limitations](https://developers.kommo.com/docs/limitations) · [HTTP codes](https://developers.kommo.com/docs/http-codes)
- [OAuth 2.0](https://developers.kommo.com/docs/oauth-20) · [Private integration](https://developers.kommo.com/docs/private-integration)

**REST:**
- [Leads](https://developers.kommo.com/reference/leads) · [Complex leads](https://developers.kommo.com/reference/complex-leads)
- [Contacts](https://developers.kommo.com/reference/contacts) · [Pipelines & stages](https://developers.kommo.com/reference/leads-pipelines-and-stages)
- [Custom fields](https://developers.kommo.com/reference/custom-fields) · [Tasks](https://developers.kommo.com/reference/tasks-list) · [Notes](https://developers.kommo.com/reference/notes) · [Events](https://developers.kommo.com/reference/events)

**Webhooks:**
- [General](https://developers.kommo.com/docs/webhooks-general) · [Eventos](https://developers.kommo.com/reference/webhook-events) · [Digital Pipeline](https://developers.kommo.com/docs/webhooks-dp)

**Salesbot/Widgets:**
- [Salesbot SDK](https://developers.kommo.com/docs/salesbot-sdk) · [Widget structure](https://developers.kommo.com/docs/widget) · [JS SDK](https://developers.kommo.com/docs/js-sdk) · [Card SDK](https://developers.kommo.com/docs/card-sdk)

**Chats API:**
- [Chats development](https://www.kommo.com/developers/content/chats/development/)
- [Register channel](https://developers.kommo.com/reference/register-channel) · [Send messages](https://developers.kommo.com/reference/send-import-messages)

**WooCommerce ↔ Kommo:**
- [Integración oficial](https://www.kommo.com/integrations/woocommerce/) · [Blog: WC integration](https://www.kommo.com/blog/woocommerce-integration/)
- [Make.com](https://www.make.com/en/integrations/amo-crm/woocommerce) · [Albato](https://albato.com/connect/kommo-with-woocommerce)

**SDKs/comunidad:**
- [PHP: dedomorozoff/kommo-api-php](https://github.com/dedomorozoff/kommo-api-php)
- [Python: GearPlug/kommo-python](https://github.com/GearPlug/kommo-python)
- [Go: whatcrm/go-amocrm](https://github.com/whatcrm/go-amocrm)
- [Discord Dev Community](https://discord.gg/CjstJTrBHu)
