// Bot Format Converter: List ↔ DAG
// ============================================================================
// Convierte entre los dos formatos soportados por el engine:
//   • LIST: array de steps con ramas anidadas (formato legacy)
//   • DAG:  nodes[] + edges[] (formato nuevo, editable visualmente)
//
// El converter respeta el modelo de Wapi: forward-only, no cycles.

'use strict';

const crypto = require('crypto');

function _id() {
  return 'n_' + crypto.randomBytes(6).toString('hex');
}

// ─── Detección de formato ────────────────────────────────────────────────
function detectFormat(stepsJson) {
  if (!stepsJson) return 'list';
  try {
    const parsed = typeof stepsJson === 'string' ? JSON.parse(stepsJson) : stepsJson;
    if (Array.isArray(parsed)) return 'list';
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.nodes) && Array.isArray(parsed.edges)) {
      return 'dag';
    }
    return 'list';
  } catch { return 'list'; }
}

function parse(stepsJson) {
  if (!stepsJson) return null;
  if (typeof stepsJson === 'string') {
    try { return JSON.parse(stepsJson); } catch { return null; }
  }
  return stepsJson;
}

// ─── List → DAG ──────────────────────────────────────────────────────────
// Convierte un array de steps (con ramas anidadas) a un grafo nodes/edges.
//
// Reglas:
//   • Cada step en el array se vuelve un node con id único
//   • Steps consecutivos se conectan con un edge: stepA → stepB
//   • Steps tipo 'condition' / 'branch' / 'wait_response' con sub-steps en
//     ramas se expanden: el branch step se conecta a la primera de cada rama
//     con `edge.branch = nombreRama`. El último step de cada rama se conecta
//     al siguiente step del array padre (continuación natural).
//   • Si la rama termina sin continuación natural, queda como leaf node.
//
function listToDag(steps) {
  if (!Array.isArray(steps) || !steps.length) {
    return { nodes: [], edges: [] };
  }
  const nodes = [];
  const edges = [];

  // Convierte recursivamente un array de steps a nodes+edges.
  // Retorna { firstId, lastIds[] }:
  //   firstId: id del primer node de este array
  //   lastIds: ids de los nodos que quedan abiertos (sin edge out hacia "siguiente")
  function convertArray(stepsArr, parentNextNode) {
    if (!stepsArr.length) {
      return { firstId: null, lastIds: parentNextNode ? [parentNextNode] : [] };
    }

    // Crear todos los nodes primero
    const localNodes = stepsArr.map(step => {
      const id = step._id || _id();
      const node = {
        id,
        type: step.type,
        config: step.config || {},
        // Si el step original tenía _x/_y (coords visuales del editor), los preservamos
        x: step._x ?? null,
        y: step._y ?? null,
      };
      nodes.push(node);
      return { id, original: step };
    });

    // Conectar secuencialmente: localNodes[i] → localNodes[i+1]
    let openLastIds = []; // nodos que terminan "abiertos" (sin conexión a sig)
    for (let i = 0; i < localNodes.length; i++) {
      const { id, original } = localNodes[i];
      const nextLocalId = (i + 1 < localNodes.length) ? localNodes[i + 1].id : null;

      // ¿Este step tiene ramas?
      const branches = _extractBranches(original);
      if (branches && Object.keys(branches).length > 0) {
        // Para cada rama, convertir recursivamente y conectar
        for (const [branchName, branchSteps] of Object.entries(branches)) {
          if (!Array.isArray(branchSteps) || !branchSteps.length) {
            // Rama vacía → conecta directo al siguiente del array padre
            if (nextLocalId) {
              edges.push({ from: id, to: nextLocalId, branch: branchName });
            }
            continue;
          }
          const branchResult = convertArray(branchSteps, nextLocalId);
          if (branchResult.firstId) {
            edges.push({ from: id, to: branchResult.firstId, branch: branchName });
          }
          // El último de la rama se conecta al siguiente del array padre
          if (nextLocalId) {
            for (const lastId of branchResult.lastIds) {
              if (lastId !== nextLocalId) {
                edges.push({ from: lastId, to: nextLocalId });
              }
            }
          } else if (parentNextNode) {
            for (const lastId of branchResult.lastIds) {
              edges.push({ from: lastId, to: parentNextNode });
            }
          } else {
            openLastIds.push(...branchResult.lastIds);
          }
        }
      } else {
        // Step sin ramas: conexión simple al siguiente
        if (nextLocalId) {
          edges.push({ from: id, to: nextLocalId });
        }
      }

      // Si es el último del array y no tiene ramas, queda abierto
      if (i === localNodes.length - 1) {
        if (!branches || Object.keys(branches).length === 0) {
          openLastIds.push(id);
        }
      }
    }

    return {
      firstId: localNodes[0].id,
      lastIds: openLastIds.length ? openLastIds : [localNodes[localNodes.length - 1].id],
    };
  }

  convertArray(steps, null);

  // Auto-layout simple: posicionar nodos en grid según topological order
  _autoLayout(nodes, edges);

  return { nodes, edges };
}

// Extrae las ramas de un step según su tipo
function _extractBranches(step) {
  const c = step.config || {};
  // condition/branch: branches = { true: [...], false: [...] }
  if (step.type === 'condition' || step.type === 'branch') {
    return c.branches || null;
  }
  // wait_response: branches = { on_text_reply, on_button_click, on_timeout, on_delivery_fail }
  if (step.type === 'wait_response') {
    return c.branches || null;
  }
  return null;
}

// Auto-layout: asigna x/y por columna topological + fila por orden de visita
function _autoLayout(nodes, edges) {
  const nodeMap = Object.fromEntries(nodes.map(n => [n.id, n]));
  const outEdges = {};
  const inDegree = {};
  for (const n of nodes) { outEdges[n.id] = []; inDegree[n.id] = 0; }
  for (const e of edges) {
    outEdges[e.from].push(e.to);
    inDegree[e.to] = (inDegree[e.to] || 0) + 1;
  }
  // BFS desde roots
  const roots = nodes.filter(n => !inDegree[n.id]).map(n => n.id);
  const col = {};
  const queue = roots.map(id => ({ id, c: 0 }));
  while (queue.length) {
    const { id, c } = queue.shift();
    if (col[id] !== undefined && col[id] >= c) continue;
    col[id] = Math.max(col[id] || 0, c);
    for (const next of outEdges[id]) {
      queue.push({ id: next, c: c + 1 });
    }
  }
  // Agrupar por columna
  const cols = {};
  for (const n of nodes) {
    const c = col[n.id] || 0;
    cols[c] = cols[c] || [];
    cols[c].push(n.id);
  }
  // Posicionar
  const COL_W = 320, ROW_H = 180, X0 = 80, Y0 = 80;
  for (const [c, ids] of Object.entries(cols)) {
    ids.forEach((id, i) => {
      const n = nodeMap[id];
      // Solo asignar si no tenía coords explícitas
      if (n.x == null) n.x = X0 + Number(c) * COL_W;
      if (n.y == null) n.y = Y0 + i * ROW_H;
    });
  }
}

// ─── DAG → List ──────────────────────────────────────────────────────────
// Conversión inversa para mostrar el bot en vista "Lista" o para downgrade.
// Hace un walk topológico siguiendo las edges sin branch primero, expandiendo
// branches en sub-arrays. Funciona para DAGs que vinieron de list (es lossy
// para grafos arbitrarios).
function dagToList({ nodes, edges }) {
  if (!nodes || !nodes.length) return [];
  const nodeMap = Object.fromEntries(nodes.map(n => [n.id, n]));
  const outEdges = {};
  const inDegree = {};
  for (const n of nodes) { outEdges[n.id] = []; inDegree[n.id] = 0; }
  for (const e of edges) {
    outEdges[e.from].push(e);
    inDegree[e.to] = (inDegree[e.to] || 0) + 1;
  }
  const visited = new Set();

  function walk(startId) {
    const result = [];
    let current = startId;
    while (current && !visited.has(current)) {
      visited.add(current);
      const node = nodeMap[current];
      if (!node) break;
      const step = { _id: node.id, type: node.type, config: node.config || {} };
      // Preservar coords si existen
      if (node.x != null) step._x = node.x;
      if (node.y != null) step._y = node.y;

      const outs = outEdges[current] || [];
      const branchOuts = outs.filter(e => e.branch);
      const plainOut = outs.find(e => !e.branch);

      // Si tiene ramas, expandirlas en config.branches
      if (branchOuts.length) {
        step.config = step.config || {};
        step.config.branches = step.config.branches || {};
        for (const e of branchOuts) {
          step.config.branches[e.branch] = walk(e.to);
        }
      }
      result.push(step);
      current = plainOut?.to || null;
    }
    return result;
  }

  // Empezar desde el root (sin incoming edges)
  const roots = nodes.filter(n => !inDegree[n.id]);
  if (!roots.length) return [];
  return walk(roots[0].id);
}

module.exports = { detectFormat, parse, listToDag, dagToList };
