# Meta (WhatsApp / Facebook / Instagram) y TikTok — Referencia técnica

> Documento de referencia para construir la app multi-canal. Generado a partir de developers.facebook.com, developers.tiktok.com, comunidad y SDKs oficiales. Última actualización: 2026-04-30.

---

## 1. Panorama general

| Plataforma | Mensajería 1:1 | Posting orgánico | Ads/Marketing | Analytics |
|---|---|---|---|---|
| **WhatsApp Cloud API** | Sí (núcleo) | No | Click-to-WhatsApp ads (Meta Ads) | Conversaciones, plantillas, calidad |
| **Messenger** | Sí (Send API) | N/A | Click-to-Messenger ads | Insights por hilo |
| **Facebook Pages** | N/A (usa Messenger) | Sí (posts, fotos, videos, Reels) | Marketing API | Page Insights |
| **Instagram Graph** | Sí (Messaging API) | Sí (feed, reels, carruseles, stories) | Marketing API | Media Insights |
| **TikTok Developers** | No | Sí (Content Posting API) | TikTok Marketing API | Display API |

**Conceptos comunes Meta vs TikTok:**
- App ID / App Secret en cada portal
- OAuth 2.0 estándar
- Permisos/Scopes granulares — algunos requieren App Review
- Tokens de varios tipos
- Sandbox/test mode disponible en ambos

---

## 2. Meta App Fundamentals

**Tipos de app**: Business (B2B, recomendado para WA/Messenger/IG/Marketing), Consumer (FB Login en apps de consumo).

**Permisos** — dos niveles:
- **Standard Access**: datos propios del developer/admin sin App Review.
- **Advanced Access**: datos de terceros (clientes que conectan sus cuentas). Requiere **App Review + Business Verification**.

**Permisos típicos**:
- WhatsApp: `whatsapp_business_management`, `whatsapp_business_messaging`, `business_management`
- Messenger/Pages: `pages_messaging`, `pages_manage_metadata`, `pages_read_engagement`, `pages_manage_posts`, `pages_show_list`, `read_insights`
- Instagram: `instagram_basic`, `instagram_manage_messages`, `instagram_manage_comments`, `instagram_content_publish`, `instagram_manage_insights`
- Ads: `ads_management`, `ads_read`

**Tokens — cuándo usar cada uno:**

| Tipo | Uso | Vida útil |
|---|---|---|
| User Access Token | Probar API por usuario (Graph Explorer) | Short ~1-2h; long-lived ~60 días |
| Page Access Token | Operar una Page (Messenger, posts) | Derivado de long-lived user → never-expires (mientras user tenga rol) |
| App Access Token | Acciones a nivel app (verificar webhooks) | No expira, NUNCA en cliente |
| **System User Token** | **Producción servidor-a-servidor** | **Permanente — recomendado** |
| Client Token | Combinado con App ID en clientes móviles | Limitado |

**Para CRM multi-tenant**: System User del Business Manager del cliente (vía Embedded Signup) → token cifrado en DB.

**Webhooks Meta:**
1. URL HTTPS válida.
2. **GET de verificación**: responde `hub.challenge` si `hub.verify_token` coincide.
3. **POST de eventos**: verificar **`X-Hub-Signature-256`** (HMAC-SHA256 con App Secret sobre **raw body**).
4. **200 OK rápido**. Reintentos hasta **7 días**.

> CRÍTICO: la firma se calcula sobre el body crudo. En Express: `app.use('/webhooks/meta', express.raw({type: 'application/json'}))` antes de cualquier `bodyParser.json()`.

---

## 3. WhatsApp Cloud API

Base: `https://graph.facebook.com/v{N}.0/`.

**Onboarding**: Business Portfolio (BM) → WhatsApp Business Account (WABA) → Phone Number → Display Name verificado → Number registration (PIN 6 dígitos).

### Embedded Signup ("WhatsApp lite")

Flujo oficial para que un cliente conecte su WhatsApp en tu app sin salir. **Desde 30-jun-2025**: Meta exige Tech Provider Program o ser BSP.

**Requisitos**:
- App tipo Business + producto WhatsApp habilitado
- Partner Solution configurada
- Business Verification de tu propio Business Portfolio
- Recomendado: ser Tech Provider

**Flujo técnico**:
1. Cargar FB JS SDK en front.
2. `FB.login(...)` con `extras: { feature: 'whatsapp_embedded_signup', sessionInfoVersion: 3 }`.
3. Usuario crea/selecciona BM, WABA, agrega número, verifica SMS — todo en popup.
4. Callback entrega `code` → tu backend lo intercambia por token; evento `WA_EMBEDDED_SIGNUP` entrega `phone_number_id` y `waba_id`.
5. Backend instala app de partner sobre WABA (System User) y suscribe webhooks.

Tiempo de onboarding (BSPs): ~5 minutos.

### Endpoints principales

- `POST /{phone_number_id}/messages` — enviar mensaje
- `GET /{phone_number_id}/message_templates` — listar plantillas
- `POST /{waba_id}/message_templates` — crear plantilla
- `POST /{phone_number_id}/media` — upload (devuelve `media_id`)
- `GET /{media_id}` — URL temporal de descarga
- `POST /{phone_number_id}/register` — registrar número (PIN)

### Tipos de mensaje

- **text**: hasta 4096 chars, soporta `preview_url`.
- **template**: único permitido fuera de la ventana de 24h. `name`, `language`, `components` (header/body/button params).
- **interactive**:
  - **button** (reply): hasta 3 botones, dentro de 24h.
  - **list**: 1 sección con hasta 10 secciones / 10 filas.
  - **product / product_list**: integración con Meta Commerce.
  - **flow**: forms multi-paso.
  - **cta_url**, **location_request_message**.
- **media**: image/video/document/audio/sticker (por `id` subido o `link`).

### Plantillas (templates)

Categorías:
- **MARKETING** — promos. Siempre cobradas.
- **UTILITY** — confirmaciones/alertas transaccionales. **Gratis dentro de customer service window** (post julio-2025).
- **AUTHENTICATION** — OTP. Siempre cobradas. Subtipos: copy-code, one-tap autofill, zero-tap.

Componentes: `HEADER` (text/image/video/document/location), `BODY`, `FOOTER`, `BUTTONS` (quick_reply, url, phone_number, copy_code, otp).

Variables: `{{1}}`, `{{2}}`... secuenciales sin saltos.

Aprobación humana+automatizada, minutos a horas. Webhook `message_template_status_update`.

### Customer Service Window

- **24h CSW**: se abre cada vez que el usuario te escribe. Dentro permites mensajes free-form.
- Fuera: solo plantillas aprobadas.

**Pricing PMP (Per-Message Pricing) desde 1-jul-2025**:
- Marketing: siempre cobrado.
- Utility: gratis dentro de CSW; cobrado fuera.
- Authentication: siempre cobrado.
- Service (free-form): gratis.
- **Free entry point**: Click-to-WhatsApp Ad / Page CTA → 72h gratis.

### Tiers (cambian 2026)

Histórico: 250 → 1K → 10K → 100K → ilimitado.

**Q1 2026**: Meta retira tiers de 2K y 10K. Tras Business Verification → 100K daily limit inmediato. Remoción total Q2 2026.

### Throughput (MPS)

- Default: **80 MPS por phone number**.
- **1000 MPS automático** si calidad media+ y conversaciones únicas iniciadas en 24h. Sin costo extra.
- Error `131056` = throttle por destinatario.

### Migración On-Premise → Cloud

- **On-Premise sunset**: sin nuevos signups desde **1-jul-2024**; última versión soportada expiró **23-oct-2025**.
- Beneficios: 90% menos infra, 4x throughput (1000 vs 250 MPS), 99.9% uptime, p99 < 5s.

---

## 4. Messenger Platform (Facebook)

**Conexión**: cliente conecta FB Page con `pages_messaging` + `pages_manage_metadata` → Page Access Token → suscribir campos `messages`, `messaging_postbacks`, `messaging_optins`, `message_reads`, `message_deliveries`, `message_reactions`, `messaging_handovers`, `messaging_referrals`.

**Send API**: `POST https://graph.facebook.com/v{N}.0/me/messages?access_token={page-token}` con `text` o `attachment` (image/audio/video/file/template).

**Webhook events**: `entry[].messaging[]` con `message`, `postback`, `optin`, `delivery`, `read`, `reaction`, `referral`, `pass_thread_control`.

**Persistent menu / ice breakers / get-started**: vía Messenger Profile API (`POST /me/messenger_profile`).

**Handover protocol**: Primary Receiver vs Secondary Receivers (`pass_thread_control`, `take_thread_control`, `request_thread_control`). Page Inbox app ID: `263902037430900`.

> Meta retiró Handover Protocol para Instagram → ahora Conversation Routing.

**Restricciones**:
- 24h window para free-form.
- Fuera: Message Tags (`CONFIRMED_EVENT_UPDATE`, `POST_PURCHASE_UPDATE`, `ACCOUNT_UPDATE`, `HUMAN_AGENT`).
- **Desde 27-abr-2026**: `CONFIRMED_EVENT_UPDATE`, `ACCOUNT_UPDATE`, `POST_PURCHASE_UPDATE` darán error 100. Sobrevive `HUMAN_AGENT` (extiende 7 días para humanos reales).
- Sponsored Messages (paid) y One-time notifications también disponibles.

---

## 5. Facebook Graph — Pages

**Publicar**:
- Texto/link: `POST /{page-id}/feed` con `message`, `link`.
- Foto: `POST /{page-id}/photos` con `url` o multipart.
- **Video / Reel**: Video API resumible (`rupload.facebook.com`): `start` → `transfer` (chunks) → `finish`. Reels: `media_type=REELS`.
- **Programar**: `scheduled_publish_time` (epoch) + `published=false`.

**Insights**: `GET /{page-id}/insights?metric=...`. Métricas comunes: `page_impressions`, `page_engaged_users`, `page_fans`, `page_post_engagements`. **Deprecaciones grandes el 15-nov-2025 y 15-jun-2026** — verificar antes de implementar.

**Comentarios**: webhook field `feed`. Endpoints `GET /{post-id}/comments`, `POST /{comment-id}/comments` (responder), `DELETE /{comment-id}`.

---

## 6. Instagram Graph API

**Tipos de cuenta soportados**: Business (vinculada a FB Page) y Creator (vinculada a FB Page). Personal NO soportado. **Instagram Basic Display API EOL diciembre 2024**.

### Dos rutas de auth (2025+)

1. **Instagram API with Facebook Login** (clásico): user → FB → vincula Page+IG.
2. **Instagram API with Instagram Login** (lanzado julio-2024): OAuth directo en `api.instagram.com/oauth/authorize` con scopes `instagram_business_basic`, `instagram_business_manage_messages`, `instagram_business_content_publish`, etc. Scopes legacy deprecados **27-ene-2025**. Tokens 60 días + refresh con `ig_refresh_token`.

### Instagram Messaging API (DM)

Permisos: `instagram_manage_messages` (FB) o `instagram_business_manage_messages` (IG Login) + `pages_manage_metadata` para suscripción.

Webhook events: `messages`, `messaging_postbacks`, `message_reactions`, `messaging_seen`, `story_replies`, `mentions`.

**Rate limits**: **200 DMs automatizados/hora/cuenta**. Ventana 24h; extensión 7d con `human_agent` tag.

### Content Publishing API

Flujo 2 pasos:
1. `POST /{ig-user-id}/media` con `image_url`/`video_url`/`media_type` (`REELS`, `STORIES`, `CAROUSEL`) → `creation_id`.
2. `POST /{ig-user-id}/media_publish?creation_id=...`.

**Limitaciones**:
- 100 media publicados/24h (carousel cuenta 1).
- Carousel: hasta 10 items.
- Reels: hasta 15 min técnico; 5–90s con 9:16 aparecen en Reels tab.
- Stories: soportadas desde 2023 con permisos correctos.
- Campo `alt_text` desde 24-mar-2025.
- Permisos post-deprecation: `instagram_business_basic` + `instagram_business_content_publish`.

**Insights**: `GET /{ig-media-id}/insights?metric=...`. Varias métricas deprecadas en v21 desde 8-ene-2025 (`video_views` no-Reels, `email_contacts`, `profile_views`, `website_clicks`, `phone_call_clicks`, `text_message_clicks`).

**Hashtag search**: `GET /ig_hashtag_search?user_id&q=` + `GET /{hashtag-id}/top_media|recent_media`. Limit **30 hashtags únicos / 7 días por cuenta**.

**Mentions**: webhook `mentions` + `GET /{ig-user-id}/tags`.

---

## 7. TikTok for Developers

Portal: `developers.tiktok.com`. Base API: `https://open.tiktokapis.com/v2/`. OAuth: `https://www.tiktok.com/v2/auth/authorize/`.

### Login Kit

OAuth 2.0 estándar. Disponible iOS, Android, Web, Desktop.

Scopes:
- `user.info.basic`: `open_id`, `union_id`, `display_name`, `avatar_url`, `bio_description`
- `user.info.profile`, `user.info.stats`
- `video.list`: leer videos
- `video.upload`: subir como draft
- `video.publish`: publicar directo

Flujo: redirect a `/v2/auth/authorize/?client_key=...&scope=...&redirect_uri=...&response_type=code&state=...` → `code` → `POST /v2/oauth/token/` → `access_token` (24h) + `refresh_token` (~365 días).

### Display API

- `GET /v2/user/info/` — perfil del usuario autorizado.
- `GET /v2/video/list/` — videos recientes.
- `GET /v2/video/query/?fields=...` — query por `video_ids`.

> URLs de video de `/video/list/` son **temporales (~6h)**. No cachees long-term.

### Content Posting API

Dos modos:
- **Direct Post** (`post_mode=DIRECT_POST`): scope `video.publish`.
- **Upload as Draft** (`post_mode=MEDIA_UPLOAD`): scope `video.upload`.

Flujo:
1. `POST /v2/post/publish/video/init/` con `source_info` (`PULL_FROM_URL` o `FILE_UPLOAD`), `video_size`, `chunk_size`. → `upload_url` + `publish_id`.
2. Si `FILE_UPLOAD`: `PUT` chunks (max ~64MB).
3. `GET /v2/post/publish/status/fetch/?publish_id=...` — polling (`PROCESSING_DOWNLOAD`, `PROCESSING_UPLOAD`, `PUBLISH_COMPLETE`, `FAILED`).

Photo posting: `/v2/post/publish/content/init/` con `media_type=PHOTO`.

### Webhooks

Eventos: `video.publish.complete/failed`, `video.upload.complete/failed`, `authorization.removed`, `portability.download.ready`. Verificar firma TikTok.

### App Review / Audit

Sin audit:
- Posts solo `SELF_ONLY` (privado).
- Cuenta del usuario debe estar en privado al publicar.

Con audit aprobado: visibilidad pública.

### TikTok for Business / Marketing API

Portal: `business-api.tiktok.com`. Base: `/open_api/v1.3/`.

Endpoints: `/campaign/...`, `/adgroup/...`, `/ad/...`, `/report/integrated/get/` (Auction+Reservation), `/event/track/` (server-side conversions).

Token long-lived de Advertiser, no expira hasta revocación.

### Embedding

oEmbed (`https://www.tiktok.com/oembed?url=...`). Web embed `<blockquote class="tiktok-embed">` + `embed.tiktok.com/embed.js`.

---

## 8. Patrones para app multi-canal

### Almacenamiento de tokens

- Encriptación at-rest (KMS/libsodium/pgcrypto). Nunca plain text.
- Meta multi-tenant: System User token del cliente (Embedded Signup → install on WABA → genera SU token) — permanente.
- Page tokens: derivar de long-lived user (60d) → never-expires.
- IG con Instagram Login: 60d token, job que llame `GET /refresh_access_token?grant_type=ig_refresh_token` cada ~50 días.
- TikTok user: access 24h + refresh ~365d → refresh automático.
- TikTok ads: long-lived, manejar 401 con relogin.

### Webhook receiver unificado

```
POST /webhooks/meta     → verifica X-Hub-Signature-256 con APP_SECRET
POST /webhooks/tiktok   → verifica firma TikTok (header documentado)
```

Discriminar plataforma por **path** (no payload). Meta sub-router: `entry[0].changes[0].field` o `messaging[0]`.

Patrón:
1. Verifica firma sobre raw body.
2. Devuelve 200 inmediato.
3. Encola (Redis/SQS).
4. Worker procesa + dedup (Meta retries hasta 7 días = duplicados).

### Buzón unificado (schema sugerido)

```
channels(id, tenant_id, type [whatsapp|messenger|instagram|tiktok], external_id, access_token_enc, refresh_token_enc, expires_at, ...)
contacts(id, tenant_id, channel_id, external_id, name, profile_pic, ...)
conversations(id, tenant_id, channel_id, contact_id, status, last_message_at, window_expires_at, ...)
messages(id, conversation_id, direction [in|out], external_id, type, body_text, media_url, payload_json, status, sent_at, ...)
```

`window_expires_at` clave para WhatsApp CSW (24h) y Messenger/IG (24h, 7d con human_agent).

### Deduplicación cross-channel

IDs distintos por plataforma (phone WA, PSID Messenger, ISID IG, `open_id`/`union_id` TikTok). Estrategia: `people(tenant_id, normalized_phone | normalized_email)` + `identities(person_id, channel_id, external_id)` para soft-merge.

### Rate limits comparativos

| Canal | Límite outbound |
|---|---|
| WhatsApp Cloud | 80 MPS default → 1000 MPS auto; tier diario |
| Messenger | Implícito por App+Page |
| Instagram DM | **200 DMs auto/hora/cuenta** |
| Instagram Publishing | 100 posts/24h |
| TikTok Content Posting | No documentado público |

---

## 9. Costos y políticas

### WhatsApp pricing (orden de magnitud, USD post-jul-2025)

Varía por mercado. Referenciales:
- México: marketing ~$0.04, utility ~$0.01
- Brasil: marketing ~$0.06, utility ~$0.014
- India: marketing ~$0.0098, utility ~$0.0022
- US: marketing ~$0.025, utility ~$0.004
- Authentication: típicamente menor que marketing

Volume discounts por tier+región para utility/auth.

**Free**: service window, free entry point (CTW ads / Page CTA → 72h), utility dentro de CSW.

### Restricciones de contenido

WhatsApp/Meta prohíbe: drogas, armas, alcohol/tabaco a menores, sexual, datos sensibles, scam. TikTok: Community Guidelines + Branded Content Policy.

### App Review pitfalls

- Screencast no muestra el flujo exacto de cada permiso.
- Falta Privacy Policy URL accesible.
- Test user bloqueado por geo/login wall.
- WhatsApp: no demostrar valor agregado vs UI Meta directa.
- IG: pedir `instagram_manage_insights` sin caso de uso real.

---

## 10. Pitfalls y mejores prácticas

- **Tokens**: nunca asumas permanente. Hooks de error 401/`OAuthException` → re-OAuth o alerta.
- **Graph API versioning**: Meta libera cada 3 meses (v22 ene-2025, v23 mayo-2025, v24 oct-2025). 2 años de soporte por versión. **Pinear constante** (`META_GRAPH_VERSION = "v22.0"`), upgrade quarterly tras smoke tests. NO usar "latest" implícito.
- **Webhook duplicados**: idempotencia por `(message_id, status)` único en DB.
- **Webhook signature**: `express.raw()` antes de `bodyParser.json()`.
- **WhatsApp template rejections** comunes:
  - Variables mal formateadas (`{1}`, `{{1}` → rechazo)
  - No secuenciales o saltos (`{{1}}, {{2}}, {{4}}`)
  - Categoría incorrecta (promo en utility → rechazo + alza costos)
  - URL shorteners y `wa.me` links
  - Texto vago/spammy
  - Idioma declarado distinto al texto
  - Body < 1024 chars, header texto < 60
- **Customer service window**: trackear `last_inbound_at` por contacto.
- **TikTok Content Posting**: review estricto. Sin audit, todo privado. NO prometer al cliente "publicar a TikTok" hasta tener audit.
- **TikTok Display URLs**: temporales ~6h.
- **Instagram migration**: Instagram Login simplifica onboarding pero requiere update scopes. Los viejos siguen para FB-Login flow.
- **Page Inbox handover**: mantener inbox Meta como secondary receiver — fallback manual.
- **Comunidad/debug**: r/FacebookAds, r/socialmedia, Stack Overflow tags `whatsapp-cloud-api`, `instagram-graph-api`, `tiktok-api`.

### SDKs/repos relevantes

- **WhatsApp** oficial Node.js: [WhatsApp/WhatsApp-Nodejs-SDK](https://github.com/WhatsApp/WhatsApp-Nodejs-SDK)
- **Meta samples**: [fbsamples/whatsapp-api-examples](https://github.com/fbsamples/whatsapp-api-examples), [fbsamples/messenger-platform-samples](https://github.com/fbsamples/messenger-platform-samples)
- **Community WA**: tawn33y/whatsapp-cloud-api, MarcosNicolau/whatsapp-business-sdk, great-detail/WhatsApp-JS-SDK
- **Facebook Business SDK**: [facebook-python-business-sdk](https://github.com/facebook/facebook-python-business-sdk), [facebook-nodejs-business-sdk](https://github.com/facebook/facebook-nodejs-business-sdk)
- **TikTok Business SDK**: [tiktok/tiktok-business-api-sdk](https://github.com/tiktok/tiktok-business-api-sdk)

---

## 11. Referencias clave

### Meta general
- [Meta for Developers Apps](https://developers.facebook.com/apps/)
- [Graph API Changelog](https://developers.facebook.com/docs/graph-api/changelog) · [Versioning](https://developers.facebook.com/docs/graph-api/guides/versioning/)
- [Permissions](https://developers.facebook.com/docs/permissions/) · [Access Levels](https://developers.facebook.com/docs/graph-api/overview/access-levels/)
- [Access Tokens](https://developers.facebook.com/docs/facebook-login/guides/access-tokens/) · [Webhooks](https://developers.facebook.com/docs/graph-api/webhooks/)

### WhatsApp Cloud API
- [Cloud API Get Started](https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started)
- [Embedded Signup](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview/)
- [Pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing) · [Messaging Limits](https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits)
- [On-Premises Sunset](https://developers.facebook.com/docs/whatsapp/on-premises/sunset)
- [System User Tokens](https://developers.facebook.com/documentation/business-messaging/whatsapp/access-tokens/)
- [Interactive Messages](https://developers.facebook.com/docs/whatsapp/cloud-api/messages/interactive-list-messages/)
- [Webhooks reference messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages)

### Messenger
- [Send API](https://developers.facebook.com/docs/messenger-platform/reference/send-api/)
- [Webhooks](https://developers.facebook.com/docs/messenger-platform/webhooks)
- [Changelog](https://developers.facebook.com/docs/messenger-platform/changelog/)
- [Ice Breakers](https://developers.facebook.com/docs/messenger-platform/reference/messenger-profile-api/ice-breakers/)

### FB Pages / Video
- [Page Video Reels](https://developers.facebook.com/docs/graph-api/reference/page/video_reels/)
- [Video API](https://developers.facebook.com/docs/video-api/overview/)

### Instagram
- [Instagram Platform](https://developers.facebook.com/docs/instagram-platform/)
- [IG with Instagram Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/)
- [Content Publishing](https://developers.facebook.com/docs/instagram-platform/content-publishing/)
- [Webhooks Instagram Messaging](https://developers.facebook.com/docs/messenger-platform/instagram/features/webhook/)

### TikTok
- [TikTok for Developers](https://developers.tiktok.com/)
- [Login Kit](https://developers.tiktok.com/doc/login-kit-overview)
- [Display API](https://developers.tiktok.com/doc/display-api-get-started/)
- [Content Posting](https://developers.tiktok.com/doc/content-posting-api-get-started)
- [Scopes](https://developers.tiktok.com/doc/scopes-overview) · [Webhooks](https://developers.tiktok.com/doc/webhooks-overview/)
- [App Review Guidelines](https://developers.tiktok.com/doc/app-review-guidelines/)
- [Marketing API](https://business-api.tiktok.com/portal)
- [Business API SDK](https://github.com/tiktok/tiktok-business-api-sdk)

### Comunidad
- [Meta Dev Community](https://developers.facebook.com/community/) · [TikTok Dev Community](https://developers.tiktok.com/community)
- Reddit: r/FacebookAds, r/socialmedia, r/TikTokDeveloper, r/whatsappbusiness
