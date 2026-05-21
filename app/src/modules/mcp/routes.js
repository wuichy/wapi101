// MCP HTTP transport — implementa JSON-RPC 2.0 sobre POST /api/mcp.
// Cliente MCP (Claude Desktop, Cursor) se conecta vía `mcp-remote` o nativo y
// envía: initialize, tools/list, tools/call.
//
// Auth: Bearer machine_token estándar de wapi101 (mt_*). El authMiddleware ya
// pobló req.tenantId y req.advisor antes de llegar aquí.

const express = require('express');
const { TOOLS, callTool } = require('./service');

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = { name: 'wapi101-mcp', version: '0.1.0' };

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}
function rpcError(id, code, message, data) {
  const err = { code, message };
  if (data !== undefined) err.data = data;
  return { jsonrpc: '2.0', id, error: err };
}

async function handleRpc(db, tenantId, msg) {
  const { id = null, method, params = {} } = msg || {};
  try {
    switch (method) {
      case 'initialize':
        return rpcResult(id, {
          protocolVersion: PROTOCOL_VERSION,
          serverInfo: SERVER_INFO,
          capabilities: { tools: {} },
        });
      case 'notifications/initialized':
        return null; // notification, no response
      case 'ping':
        return rpcResult(id, {});
      case 'tools/list':
        return rpcResult(id, { tools: TOOLS });
      case 'tools/call': {
        const { name, arguments: args } = params || {};
        if (!name) return rpcError(id, -32602, 'Falta el parámetro "name".');
        try {
          const result = await callTool(db, tenantId, name, args || {});
          return rpcResult(id, result);
        } catch (e) {
          // Devolver el error como contenido del tool (MCP convention) en vez
          // de tirar el RPC entero — así el cliente lo muestra al usuario.
          return rpcResult(id, {
            content: [{ type: 'text', text: `Error: ${e.message}` }],
            isError: true,
          });
        }
      }
      default:
        return rpcError(id, -32601, `Método no soportado: ${method}`);
    }
  } catch (e) {
    return rpcError(id, -32603, `Error interno: ${e.message}`);
  }
}

module.exports = (db) => {
  const router = express.Router();

  // POST /api/mcp — endpoint principal JSON-RPC 2.0
  router.post('/', express.json({ limit: '1mb' }), async (req, res) => {
    if (!req.tenantId) return res.status(401).json({ error: 'unauthenticated' });
    const body = req.body;
    if (Array.isArray(body)) {
      // Batch: procesa cada uno, filtra notifications (que devuelven null)
      const results = await Promise.all(body.map(m => handleRpc(db, req.tenantId, m)));
      return res.json(results.filter(r => r !== null));
    }
    const result = await handleRpc(db, req.tenantId, body);
    if (result === null) return res.status(204).end();
    return res.json(result);
  });

  // GET /api/mcp — health/info para validar que el endpoint vive
  router.get('/', (req, res) => {
    res.json({
      server: SERVER_INFO,
      protocolVersion: PROTOCOL_VERSION,
      tenantId: req.tenantId,
      transport: 'http',
      toolsCount: TOOLS.length,
      hint: 'Envía requests POST con JSON-RPC 2.0 (initialize, tools/list, tools/call).',
    });
  });

  return router;
};
