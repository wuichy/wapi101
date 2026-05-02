# Reelance CRM

App multi-canal con pipelines, leads, contactos e integraciones de mensajería (WhatsApp Business API, WhatsApp Lite QR, Messenger, Instagram, Telegram, TikTok). Sustituyó la dependencia de Kommo del proyecto padre con un core propio.

> ⚡ **Si eres una IA o nuevo desarrollador**: lee primero **[docs/MANUAL_MAESTRO.md](docs/MANUAL_MAESTRO.md)** — contiene IDs importantes, decisiones arquitectónicas, lecciones aprendidas y runbooks. Es el contrato vivo del proyecto.

Sirve público en **https://lucho101.com** (vía cloudflared en una Mac de escritorio). Reelance Hub viejo (en el directorio raíz) sigue presente pero apagado.

---

## Cómo correr

```bash
cd app
cp .env.example .env       # editar .env con tus secrets
npm install
npm start
```

Abre http://localhost:3001 · `/healthz` para healthcheck.

---

## Estado actual (paso 0)

- ✅ Layout/UI estática siguiendo el diseño aprobado
- ✅ Sidebar con: Inicio · Chats · **Pipelines** · Leads · Clientes · Plantillas · Integraciones · Ajustes
- ✅ Vista Chats con datos mock (lista, conversación, panel Lead/Contacto)
- ✅ Configuración separada en `.env` (portátil localhost ↔ VPS)
- ✅ Slot listo para Claude API (`ANTHROPIC_API_KEY` en config)
- ⏳ Backend / DB SQLite
- ⏳ Pipelines reales
- ⏳ Usuarios + roles (Admin / Vendedor)
- ⏳ Integraciones de canal

---

## Plan modular (paso a paso)

Cada módulo en su propia carpeta. Si rompemos uno, el resto sigue funcionando.

```
app/
├── server.js                    Express minimal — monta routers de cada módulo
├── public/                      UI estática (vainilla)
├── src/                         (lo construimos paso a paso)
│   ├── db/                      SQLite + schema + migraciones
│   ├── security/                crypto helpers (AES-256-GCM para tokens)
│   ├── modules/
│   │   ├── auth/                Login + roles (admin / vendedor)
│   │   ├── users/               CRUD usuarios
│   │   ├── contacts/            Contactos (1 contacto → N leads)
│   │   ├── leads/               Leads + campos personalizados
│   │   ├── pipelines/           Pipelines + etapas (stages)
│   │   ├── conversations/       Hilos de chat unificados
│   │   └── messages/            Mensajes (entrante/saliente, dispatcher único)
│   ├── integrations/
│   │   ├── whatsapp/            WhatsApp Cloud API
│   │   ├── messenger/           Messenger Send API
│   │   ├── instagram/           Instagram Messaging
│   │   └── tiktok/              TikTok (sin DM público — content posting)
│   └── ai/                      Claude API (auto-respuestas, sugerencias, resumen)
└── docs/
    ├── LECCIONES_APRENDIDAS.md  Errores de Reelance Hub que no repetiremos
    └── DEPLOYMENT.md            Local (Mac) vs VPS — qué cambia
```

### Orden propuesto

1. **(actual)** UI estática con mock data — ver y ajustar diseño
2. **DB + Auth + Users** — SQLite, login, roles admin/vendedor
3. **Pipelines + Stages** — CRUD básico
4. **Contacts** — CRUD, búsqueda, deduplicación por teléfono/email
5. **Leads** — relación a contact + pipeline + stage
6. **Conversations + Messages** — modelo unificado para todos los canales
7. **WhatsApp Cloud** — primer canal (más usado), webhook + send
8. **Messenger / Instagram** — Meta Graph API
9. **TikTok** — content posting (sin DM)
10. **IA multi-proveedor** — interfaz `AIProvider` que soporta Claude, GPT, Gemini y **Ollama local** (Gemma/Llama). Cambiar de proveedor = cambiar `.env` o un dropdown en Ajustes → IA. La info de la empresa (system prompt) se edita desde la UI.
11. **UI dinámica** — reemplazar mock con llamadas reales

---

## Convenciones

- **Modular**: cada módulo expone `routes.js` (router Express) + `service.js` (lógica) + `schema.sql` si toca DB.
- **Aislado**: si un módulo falla, los demás siguen. Errores capturados, no propagados al global handler.
- **Sin deps pesadas**: Express + better-sqlite3. No ORM por ahora.
- **Vanilla JS en frontend**. Sin framework hasta que pese.
- **Configuración por `.env`**: mismo código sirve en Mac local y VPS — solo cambia `.env`.

---

## Lecciones aprendidas (del proyecto padre)

Antes de construir cualquier feature, revisa [docs/LECCIONES_APRENDIDAS.md](docs/LECCIONES_APRENDIDAS.md).
Resumen rápido de qué evitar:

- ❌ Storage en JSON local → ✅ SQLite
- ❌ Polling 4s → ✅ SSE
- ❌ Doble envío de mensajes (sin idempotencia) → ✅ `external_id` único
- ❌ Tokens en plain text → ✅ AES-256-GCM
- ❌ Webhooks sin dedup → ✅ tabla `webhook_events` con UNIQUE
- ❌ API versioning implícito → ✅ pinear `META_GRAPH_VERSION` en env

---

## Despliegue

- **Local (Mac)**: ya documentado, igual que Reelance Hub padre (cloudflared + LaunchAgents).
- **VPS**: cuando crezca, plan en [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Cambia `.env` y wrappers (systemd vs launchd), no el código.

---

## Referencias persistentes

- [Kommo reference](../docs/integrations/kommo-reference.md) — modelo de datos, OAuth, webhooks, pitfalls
- [Meta + TikTok reference](../docs/integrations/meta-tiktok-reference.md) — WhatsApp Cloud, Messenger, IG Graph, TikTok Login Kit
