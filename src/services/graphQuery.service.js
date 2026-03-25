/**
 * graphQuery.service.js
 *
 * Reusable graph query functions operating on the in-memory graph
 * produced by graphMemory.service.buildGraph().
 *
 * Input shape expected:
 *   { nodes: Node[], edges: Edge[], adjacencyList: Map<id, [{target, relation}]> }
 *
 * Exports:
 *   COUNT      — countByType, topProductsByOrders, invoiceCountPerCustomer
 *   TRAVERSAL  — traceInvoiceFlow, traceOrderJourney, getNeighbors, bfs
 *   FILTER     — filterByType, detectMissingRelationships, findDisconnectedNodes
 */

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Get a node by id (O(1) via nodeMap). */
function getNode(nodeMap, id) {
  return nodeMap || null; // caller passes nodeMap directly
}

/** Build a reverse edge map: target → [{source, relation}] */
function buildReverseMap(edges) {
  const rev = new Map();
  for (const { source, target, relation } of edges) {
    if (!rev.has(target)) rev.set(target, []);
    rev.get(target).push({ source, relation });
  }
  return rev;
}

/** Convert nodes array to a Map<id, node> for O(1) lookup. */
function toNodeMap(nodes) {
  return new Map(nodes.map(n => [n.id, n]));
}


// =============================================================================
// SECTION 1 — COUNT OPERATIONS
// =============================================================================

/**
 * Count nodes grouped by their type.
 *
 * @param {object[]} nodes
 * @returns {{ [type: string]: number }}
 *
 * @example
 * countByType(nodes)
 * // → { Customer: 50, Order: 200, Product: 80, Invoice: 190, ... }
 */
function countByType(nodes) {
  return nodes.reduce((acc, node) => {
    acc[node.type] = (acc[node.type] || 0) + 1;
    return acc;
  }, {});
}

/**
 * Top N products ranked by how many orders reference them.
 *
 * @param {object[]} edges
 * @param {object[]} nodes
 * @param {number}   topN   default 10
 * @returns {{ productId, label, orderCount }[]}
 */
function topProductsByOrders(edges, nodes, topN = 10) {
  const nodeMap = toNodeMap(nodes);
  const counts  = new Map();

  for (const { source, target, relation } of edges) {
    if (relation !== 'CONTAINS') continue;
    counts.set(target, (counts.get(target) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([productId, orderCount]) => ({
      productId,
      label:      nodeMap.get(productId)?.label || productId,
      orderCount
    }));
}

/**
 * Number of invoices linked to each customer (via BILLED_BY edges).
 *
 * @param {object[]} edges
 * @param {object[]} nodes
 * @returns {{ customerId, label, invoiceCount }[]}  sorted descending
 */
function invoiceCountPerCustomer(edges, nodes) {
  const nodeMap = toNodeMap(nodes);
  const counts  = new Map();

  for (const { source, target, relation } of edges) {
    if (relation !== 'BILLED_BY') continue;
    counts.set(source, (counts.get(source) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([customerId, invoiceCount]) => ({
      customerId,
      label:        nodeMap.get(customerId)?.label || customerId,
      invoiceCount
    }));
}

/**
 * Total revenue per customer (sum of invoice netAmount properties).
 *
 * @param {object[]} edges
 * @param {object[]} nodes
 * @returns {{ customerId, label, totalRevenue }[]}
 */
function revenuePerCustomer(edges, nodes) {
  const nodeMap = toNodeMap(nodes);
  const totals  = new Map();

  for (const { source, target, relation } of edges) {
    if (relation !== 'BILLED_BY') continue;
    const invoice = nodeMap.get(target);
    const amount  = parseFloat(invoice?.properties?.totalNetAmount || 0);
    totals.set(source, (totals.get(source) || 0) + amount);
  }

  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([customerId, totalRevenue]) => ({
      customerId,
      label: nodeMap.get(customerId)?.label || customerId,
      totalRevenue: +totalRevenue.toFixed(2)
    }));
}


// =============================================================================
// SECTION 2 — TRAVERSAL QUERIES
// =============================================================================

/**
 * Breadth-First Search from a start node.
 * Returns all reachable nodes in BFS order with their depth.
 *
 * @param {string} startId
 * @param {Map}    adjacencyList
 * @param {Map}    nodeMap
 * @param {number} maxDepth   default Infinity
 * @returns {{ node: object, depth: number, via: string }[]}
 */
function bfs(startId, adjacencyList, nodeMap, maxDepth = Infinity) {
  const visited = new Set([startId]);
  const queue   = [{ id: startId, depth: 0, via: null }];
  const result  = [];

  while (queue.length) {
    const { id, depth, via } = queue.shift();
    const node = nodeMap.get(id);
    if (node) result.push({ node, depth, via });
    if (depth >= maxDepth) continue;

    for (const { target, relation } of (adjacencyList.get(id) || [])) {
      if (!visited.has(target)) {
        visited.add(target);
        queue.push({ id: target, depth: depth + 1, via: relation });
      }
    }
  }

  return result;
}

/**
 * Get the direct neighbors of a node.
 *
 * @param {string} nodeId
 * @param {Map}    adjacencyList
 * @param {Map}    nodeMap
 * @returns {{ neighbor: object, relation: string }[]}
 */
function getNeighbors(nodeId, adjacencyList, nodeMap) {
  return (adjacencyList.get(nodeId) || []).map(({ target, relation }) => ({
    neighbor: nodeMap.get(target) || { id: target },
    relation
  }));
}

/**
 * Trace the full flow of an invoice:
 *   Customer → (BILLED_BY) → Invoice → (RECORDED_IN) → JournalEntry
 *                                    → (PAID_BY)      → Payment
 *
 * Uses reverse edges to walk back from Invoice to Customer.
 *
 * @param {string}   invoiceId    e.g. 'I_90504248'
 * @param {object[]} edges
 * @param {object[]} nodes
 * @returns {{ customer, invoice, journalEntries, payments }}
 */
function traceInvoiceFlow(invoiceId, edges, nodes) {
  const nodeMap   = toNodeMap(nodes);
  const reverseMap = buildReverseMap(edges);

  const invoice = nodeMap.get(invoiceId);
  if (!invoice) return { error: `Invoice ${invoiceId} not found` };

  // Walk backward: who billed this invoice?
  const customerLinks = (reverseMap.get(invoiceId) || [])
    .filter(e => e.relation === 'BILLED_BY')
    .map(e => nodeMap.get(e.source))
    .filter(Boolean);

  // Walk forward: journal entries and payments
  const forwardEdges = edges.filter(e => e.source === invoiceId);
  const journalEntries = forwardEdges
    .filter(e => e.relation === 'RECORDED_IN')
    .map(e => nodeMap.get(e.target))
    .filter(Boolean);
  const payments = forwardEdges
    .filter(e => e.relation === 'PAID_BY')
    .map(e => nodeMap.get(e.target))
    .filter(Boolean);

  return {
    customer:      customerLinks[0] || null,
    invoice,
    journalEntries,
    payments,
    isSettled:     payments.length > 0
  };
}

/**
 * Trace the full journey of an order:
 *   Customer → Order → [Products] → Invoice → Payment
 *
 * @param {string}   orderId    e.g. 'O_740506'
 * @param {object[]} edges
 * @param {object[]} nodes
 * @returns {{ customer, order, products, invoices, payments }}
 */
function traceOrderJourney(orderId, edges, nodes) {
  const nodeMap    = toNodeMap(nodes);
  const reverseMap = buildReverseMap(edges);

  const order = nodeMap.get(orderId);
  if (!order) return { error: `Order ${orderId} not found` };

  // Who placed this order? (reverse of PLACED edge from Customer → Order)
  const customerLinks = (reverseMap.get(orderId) || [])
    .filter(e => e.relation === 'PLACED')
    .map(e => nodeMap.get(e.source))
    .filter(Boolean);

  const forwardEdges = edges.filter(e => e.source === orderId);

  // Products in this order
  const products = forwardEdges
    .filter(e => e.relation === 'CONTAINS')
    .map(e => nodeMap.get(e.target))
    .filter(Boolean);

  // Invoices and their payments (Customer BILLED_BY Invoice, linked by same customer)
  const customer = customerLinks[0] || null;
  const invoiceLinks = customer
    ? edges.filter(e => e.source === customer.id && e.relation === 'BILLED_BY')
        .map(e => nodeMap.get(e.target)).filter(Boolean)
    : [];

  const payments = invoiceLinks.flatMap(inv =>
    edges.filter(e => e.source === inv.id && e.relation === 'PAID_BY')
      .map(e => nodeMap.get(e.target)).filter(Boolean)
  );

  return { customer, order, products, invoices: invoiceLinks, payments };
}


// =============================================================================
// SECTION 3 — FILTER & DETECTION QUERIES
// =============================================================================

/**
 * Filter nodes by type.
 *
 * @param {object[]} nodes
 * @param {string}   type   e.g. 'Customer', 'Invoice'
 * @returns {object[]}
 */
function filterByType(nodes, type) {
  return nodes.filter(n => n.type === type);
}

/**
 * Detect invoices that have NO linked payment (unsettled invoices).
 *
 * @param {object[]} edges
 * @param {object[]} nodes
 * @returns {object[]}  Invoice nodes with no outgoing PAID_BY edge
 */
function detectUnpaidInvoices(edges, nodes) {
  const invoices   = nodes.filter(n => n.type === 'Invoice');
  const paidIds    = new Set(
    edges.filter(e => e.relation === 'PAID_BY').map(e => e.source)
  );
  return invoices.filter(inv => !paidIds.has(inv.id));
}

/**
 * Detect orders that have no invoice (billing gap).
 *
 * @param {object[]} edges
 * @param {object[]} nodes
 * @returns {object[]}  Customer nodes referenced by an order with no invoice
 */
function detectOrdersWithoutInvoice(edges, nodes) {
  const nodeMap   = toNodeMap(nodes);

  // All customers that have at least one invoice
  const billedCustomers = new Set(
    edges.filter(e => e.relation === 'BILLED_BY').map(e => e.source)
  );

  // Customers who placed orders
  const orderingCustomers = new Set(
    edges.filter(e => e.relation === 'PLACED').map(e => e.source)
  );

  // Customers with orders but no invoice
  return [...orderingCustomers]
    .filter(cid => !billedCustomers.has(cid))
    .map(cid => nodeMap.get(cid))
    .filter(Boolean);
}

/**
 * Detect nodes with no edges at all (completely isolated).
 *
 * @param {object[]}         nodes
 * @param {Map<id, any[]>}   adjacencyList
 * @param {object[]}         edges   (for reverse check)
 * @returns {object[]}
 */
function findDisconnectedNodes(nodes, adjacencyList, edges) {
  const hasIncoming = new Set(edges.map(e => e.target));

  return nodes.filter(n => {
    const outgoing = adjacencyList.get(n.id) || [];
    return outgoing.length === 0 && !hasIncoming.has(n.id);
  });
}

/**
 * Detect missing relationships in the expected chain:
 *   Customer → Order → Product
 *   Customer → Invoice → JournalEntry | Payment
 *
 * Returns a report of which chain links are broken.
 *
 * @param {object[]} edges
 * @param {object[]} nodes
 * @returns {{ type: string, nodeId: string, label: string, missing: string }[]}
 */
function detectMissingRelationships(edges, nodes) {
  const nodeMap = toNodeMap(nodes);
  const issues  = [];

  const hasEdge = (sourceId, relation) =>
    edges.some(e => e.source === sourceId && e.relation === relation);

  const hasIncoming = (targetId, relation) =>
    edges.some(e => e.target === targetId && e.relation === relation);

  for (const node of nodes) {
    switch (node.type) {
      case 'Customer':
        if (!hasEdge(node.id, 'PLACED'))
          issues.push({ type: 'Customer', nodeId: node.id, label: node.label, missing: 'no Orders placed' });
        if (!hasEdge(node.id, 'BILLED_BY'))
          issues.push({ type: 'Customer', nodeId: node.id, label: node.label, missing: 'no Invoices' });
        break;

      case 'Order':
        if (!hasEdge(node.id, 'CONTAINS'))
          issues.push({ type: 'Order', nodeId: node.id, label: node.label, missing: 'no Products' });
        break;

      case 'Invoice':
        if (!hasEdge(node.id, 'PAID_BY') && !hasEdge(node.id, 'RECORDED_IN'))
          issues.push({ type: 'Invoice', nodeId: node.id, label: node.label, missing: 'no Payment or JournalEntry' });
        break;

      case 'JournalEntry':
        if (!hasIncoming(node.id, 'RECORDED_IN'))
          issues.push({ type: 'JournalEntry', nodeId: node.id, label: node.label, missing: 'not linked to any Invoice' });
        break;
    }
  }

  return issues;
}


// =============================================================================
// Exports
// =============================================================================

module.exports = {
  // Count
  countByType,
  topProductsByOrders,
  invoiceCountPerCustomer,
  revenuePerCustomer,

  // Traversal
  bfs,
  getNeighbors,
  traceInvoiceFlow,
  traceOrderJourney,

  // Filter / Detection
  filterByType,
  detectUnpaidInvoices,
  detectOrdersWithoutInvoice,
  findDisconnectedNodes,
  detectMissingRelationships,

  // Internal helpers (exposed for testing)
  toNodeMap,
  buildReverseMap
};
