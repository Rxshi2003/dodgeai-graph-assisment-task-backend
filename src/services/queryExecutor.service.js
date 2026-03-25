/**
 * queryExecutor.service.js
 *
 * Maps a structured query JSON (from queryTranslator.service.js)
 * to real graph traversal logic (from graphQuery.service.js)
 * and returns factual results from the in-memory graph.
 *
 * ONLY uses graph data — no hallucination, no external calls.
 *
 * Output format:
 * {
 *   result:      object[],
 *   explanation: string
 * }
 *
 * Usage:
 *   const graph    = await buildGraph(dataDir);
 *   const query    = translateQuery('Top 5 products by orders');
 *   const response = executeQuery(query, graph);
 */

const {
  countByType,
  topProductsByOrders,
  invoiceCountPerCustomer,
  revenuePerCustomer,
  bfs,
  getNeighbors,
  traceInvoiceFlow,
  traceOrderJourney,
  filterByType,
  detectUnpaidInvoices,
  detectOrdersWithoutInvoice,
  findDisconnectedNodes,
  detectMissingRelationships,
  toNodeMap,
  buildReverseMap
} = require('./graphQuery.service');

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Safe description of a node for use in explanations */
const nodeDesc = n => (n ? `${n.type} [${n.id}] "${n.label}"` : '(not found)');

/** Apply amount filters from query.filters to a result array with netAmount/amount field */
function applyAmountFilter(results, filters) {
  if (!filters) return results;
  let out = results;
  if (filters.amountGt !== undefined) out = out.filter(r => (r.totalRevenue || r.invoiceAmount || 0) > filters.amountGt);
  if (filters.amountLt !== undefined) out = out.filter(r => (r.totalRevenue || r.invoiceAmount || 0) < filters.amountLt);
  if (filters.limit    !== undefined) out = out.slice(0, filters.limit);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Operation handlers — each maps to a specific graphQuery function
// ─────────────────────────────────────────────────────────────────────────────

const HANDLERS = {

  // ── COUNT ────────────────────────────────────────────────────────────────
  count(query, { nodes }) {
    const type    = query.entities[0];
    const counts  = countByType(nodes);

    if (type === '*') {
      const result = Object.entries(counts).map(([type, count]) => ({ type, count }));
      return {
        result,
        explanation: `Found ${nodes.length} total nodes across ${result.length} types.`
      };
    }

    const count = counts[type] || 0;
    return {
      result: [{ type, count }],
      explanation: `There are ${count} ${type} node(s) in the graph.`
    };
  },

  // ── TOP / AGGREGATE ──────────────────────────────────────────────────────
  top(query, { nodes, edges }) {
    const { entities, filters } = query;
    const limit = filters?.limit || 10;

    // Top products by order count
    if (entities.includes('Product')) {
      const raw    = topProductsByOrders(edges, nodes, limit);
      const result = applyAmountFilter(raw, filters);
      return {
        result,
        explanation: `Top ${result.length} product(s) ranked by number of orders containing them.`
      };
    }

    // Top customers by invoice count
    if (entities.includes('Customer') && entities.includes('Invoice')) {
      const raw    = invoiceCountPerCustomer(edges, nodes).slice(0, limit);
      const result = applyAmountFilter(raw, filters);
      return {
        result,
        explanation: `Top ${result.length} customer(s) ranked by invoice count.`
      };
    }

    // Customer revenue ranking
    if (entities.includes('Customer') && entities.includes('Payment')) {
      const raw    = revenuePerCustomer(edges, nodes).slice(0, limit);
      const result = applyAmountFilter(raw, filters);
      return {
        result,
        explanation: `Top ${result.length} customer(s) ranked by total billed revenue.`
      };
    }

    return { result: [], explanation: 'No matching aggregate handler for given entities.' };
  },

  aggregate(query, graph) {
    return HANDLERS.top(query, graph);
  },

  // ── TRACE / TRAVERSE ─────────────────────────────────────────────────────
  trace(query, { nodes, edges, adjacencyList }) {
    const { filters, traversal } = query;
    const ids     = filters?.ids || {};
    const nodeMap = toNodeMap(nodes);

    // Trace specific invoice
    if (ids.Invoice) {
      const flow = traceInvoiceFlow(ids.Invoice, edges, nodes);
      if (flow.error) return { result: [], explanation: flow.error };
      return {
        result: [flow],
        explanation:
          `Invoice ${ids.Invoice}: ` +
          `customer=${nodeDesc(flow.customer)}, ` +
          `journalEntries=${flow.journalEntries.length}, ` +
          `payments=${flow.payments.length}, ` +
          `settled=${flow.isSettled}.`
      };
    }

    // Trace specific order
    if (ids.Order) {
      const journey = traceOrderJourney(ids.Order, edges, nodes);
      if (journey.error) return { result: [], explanation: journey.error };
      return {
        result: [journey],
        explanation:
          `Order ${ids.Order}: ` +
          `customer=${nodeDesc(journey.customer)}, ` +
          `products=${journey.products.length}, ` +
          `invoices=${journey.invoices.length}, ` +
          `payments=${journey.payments.length}.`
      };
    }

    // BFS from specific customer
    if (ids.Customer) {
      const maxDepth = traversal.length || 3;
      const reachable = bfs(ids.Customer, adjacencyList, nodeMap, maxDepth);
      return {
        result: reachable,
        explanation: `BFS from ${ids.Customer}: found ${reachable.length} reachable nodes within depth ${maxDepth}.`
      };
    }

    return { result: [], explanation: 'Trace requires a specific id (Invoice, Order, or Customer) in filters.ids.' };
  },

  // ── LIST ──────────────────────────────────────────────────────────────────
  list(query, { nodes, edges, adjacencyList }) {
    const { entities, filters } = query;
    const ids     = filters?.ids || {};
    const nodeMap = toNodeMap(nodes);

    // If a specific ID is given, return neighbors
    const specificId = Object.values(ids)[0];
    if (specificId) {
      const center    = nodeMap.get(specificId);
      const neighbors = getNeighbors(specificId, adjacencyList, nodeMap);
      return {
        result: neighbors,
        explanation: center
          ? `${neighbors.length} direct neighbor(s) of ${nodeDesc(center)}.`
          : `Node ${specificId} not found in graph.`
      };
    }

    // List nodes of given type(s)
    const type   = entities[0];
    const result = type && type !== '*' ? filterByType(nodes, type) : nodes;
    return {
      result: result.slice(0, 100),
      explanation: `Found ${result.length} ${type || 'total'} node(s). Returning up to 100.`
    };
  },

  // ── FILTER ────────────────────────────────────────────────────────────────
  filter(query, { nodes, edges }) {
    const { filters } = query;

    if (filters?.paymentStatus === 'missing') {
      const result = detectUnpaidInvoices(edges, nodes);
      return {
        result,
        explanation: `${result.length} unpaid invoice(s) found (Invoices with no PAID_BY edge).`
      };
    }

    if (filters?.paymentStatus === 'settled') {
      const paidIds = new Set(
        edges.filter(e => e.relation === 'PAID_BY').map(e => e.source)
      );
      const result = nodes.filter(n => n.type === 'Invoice' && paidIds.has(n.id));
      return {
        result,
        explanation: `${result.length} settled invoice(s) found.`
      };
    }

    // Generic type filter
    const type   = query.entities[0];
    const result = filterByType(nodes, type);
    return {
      result: result.slice(0, 100),
      explanation: `${result.length} ${type} node(s) matched the filter.`
    };
  },

  // ── DETECT ────────────────────────────────────────────────────────────────
  detect(query, { nodes, edges, adjacencyList }) {
    const { filters } = query;

    if (filters?.status === 'disconnected') {
      const result = findDisconnectedNodes(nodes, adjacencyList, edges);
      return {
        result,
        explanation: `${result.length} disconnected node(s) found (no incoming or outgoing edges).`
      };
    }

    if (filters?.relation === 'CONTAINS' && filters?.status === 'missing') {
      const ordersWithProducts = new Set(
        edges.filter(e => e.relation === 'CONTAINS').map(e => e.source)
      );
      const result = nodes.filter(n => n.type === 'Order' && !ordersWithProducts.has(n.id));
      return {
        result,
        explanation: `${result.length} order(s) have no CONTAINS edge (no linked products).`
      };
    }

    if (filters?.relation === 'BILLED_BY' && filters?.status === 'missing') {
      const result = detectOrdersWithoutInvoice(edges, nodes);
      return {
        result,
        explanation: `${result.length} customer(s) placed orders but have no invoice linked.`
      };
    }

    // Full relationship health check
    const result = detectMissingRelationships(edges, nodes);
    return {
      result,
      explanation: `Graph health check: ${result.length} missing relationship(s) detected across all node types.`
    };
  },

  // ── UNKNOWN fallback ──────────────────────────────────────────────────────
  unknown(query, { nodes }) {
    const counts = countByType(nodes);
    return {
      result: [counts],
      explanation: `Query intent not recognized. Returning graph summary instead.`
    };
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Main executor
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Execute a structured query JSON against an in-memory graph.
 *
 * @param {object} query   — output of translateQuery()
 * @param {object} graph   — output of buildGraph(): { nodes, edges, adjacencyList }
 * @returns {{ result: any[], explanation: string }}
 */
function executeQuery(query, graph) {
  if (!graph || !graph.nodes) {
    return { result: [], explanation: 'Graph is not loaded. Call buildGraph() first.' };
  }
  if (!query || !query.operation) {
    return { result: [], explanation: 'Invalid query object — missing operation field.' };
  }

  const handler = HANDLERS[query.operation] || HANDLERS.unknown;

  try {
    return handler(query, graph);
  } catch (err) {
    return {
      result:      [],
      explanation: `Execution error for operation "${query.operation}": ${err.message}`
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = { executeQuery };
