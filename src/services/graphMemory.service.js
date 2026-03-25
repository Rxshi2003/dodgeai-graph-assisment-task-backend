/**
 * graphMemory.service.js
 *
 * Builds an in-memory graph directly from the JSONL dataset files.
 * No database required — reads raw .jsonl files from /data directory.
 *
 * Field names verified against actual JSONL records.
 *
 * Exports:
 *   createNodes(dataDir)        → Map<nodeId, { id, type, label, properties }>
 *   createEdges(nodeMap, dataDir) → Array<{ source, target, relation }>
 *   buildGraph(dataDir)         → { nodes, edges, adjacencyList }
 */

const fs       = require('fs');
const path     = require('path');
const readline = require('readline');

// ─── JSONL Helpers ────────────────────────────────────────────────────────────

/** Parse a single JSONL file into an array of objects. */
async function readJsonl(filePath) {
  const records = [];
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity
  });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try { records.push(JSON.parse(trimmed)); } catch (_) {}
  }
  return records;
}

/** Read every .jsonl file inside a folder and merge results. */
async function readFolder(folderPath) {
  if (!fs.existsSync(folderPath)) return [];
  const files = (await fs.promises.readdir(folderPath)).filter(f => f.endsWith('.jsonl'));
  const all = [];
  for (const file of files) {
    const rows = await readJsonl(path.join(folderPath, file));
    all.push(...rows);
  }
  return all;
}

// ─── Entity Configuration ─────────────────────────────────────────────────────
// Each entry maps a /data subfolder to its node type, using VERIFIED field names.

const ENTITY_CONFIG = {
  // Folder                             idField                labelFn
  business_partners: {
    prefix:   'C',
    type:     'Customer',
    idField:  'businessPartner',
    labelFn:  r => r.businessPartnerFullName || r.organizationBpName1 || `Customer ${r.businessPartner}`
  },
  business_partner_addresses: {
    prefix:   'A',
    type:     'Address',
    idField:  'addressId',
    labelFn:  r => [r.cityName, r.country].filter(Boolean).join(', ') || `Address ${r.addressId}`
  },
  sales_order_headers: {
    prefix:   'O',
    type:     'Order',
    idField:  'salesOrder',
    labelFn:  r => `Order ${r.salesOrder}`
  },
  product_descriptions: {
    prefix:   'P',
    type:     'Product',
    idField:  'product',
    labelFn:  r => r.productDescription || `Product ${r.product}`
  },
  outbound_delivery_headers: {
    prefix:   'D',
    type:     'Delivery',
    idField:  'deliveryDocument',
    labelFn:  r => `Delivery ${r.deliveryDocument}`
  },
  billing_document_headers: {
    prefix:   'I',
    type:     'Invoice',
    idField:  'billingDocument',
    labelFn:  r => `Invoice ${r.billingDocument}`
  },
  // accountingDocument is the shared key across journals & payments
  journal_entry_items_accounts_receivable: {
    prefix:   'JE',
    type:     'JournalEntry',
    idField:  'accountingDocument',
    labelFn:  r => `JE ${r.accountingDocument}`
  },
  payments_accounts_receivable: {
    prefix:   'PAY',
    type:     'Payment',
    idField:  'accountingDocument',
    labelFn:  r => `Payment ${r.accountingDocument}`
  }
};

// ─── createNodes ──────────────────────────────────────────────────────────────

/**
 * Read every entity folder and build a node Map.
 *
 * @param {string} dataDir  Absolute path to the /data directory.
 * @returns {Promise<Map<string, object>>}  nodeId → { id, type, label, properties }
 */
async function createNodes(dataDir) {
  const nodeMap = new Map();

  for (const [folder, cfg] of Object.entries(ENTITY_CONFIG)) {
    const folderPath = path.join(dataDir, folder);
    const records    = await readFolder(folderPath);

    let added = 0;
    for (const record of records) {
      const rawId = record[cfg.idField];
      if (!rawId) continue;
      const nodeId = `${cfg.prefix}_${rawId}`;
      if (!nodeMap.has(nodeId)) {
        nodeMap.set(nodeId, {
          id:         nodeId,
          type:       cfg.type,
          label:      cfg.labelFn(record),
          properties: record
        });
        added++;
      }
    }
    console.log(`[createNodes] ${cfg.type.padEnd(14)} +${added} nodes  (from ${folder})`);
  }

  console.log(`\n[createNodes] ✔ Total nodes: ${nodeMap.size}\n`);
  return nodeMap;
}

// ─── createEdges ─────────────────────────────────────────────────────────────

/**
 * Derive all edges from FK references embedded in JSONL records.
 * Only links nodes that already exist in nodeMap.
 *
 * Relationships (verified field names):
 *   Customer  --HAS_ADDRESS--> Address        (businessPartner → addressId)
 *   Customer  --PLACED-->      Order           (soldToParty    → salesOrder)
 *   Order     --CONTAINS-->    Product         (salesOrder     → material)
 *   Customer  --BILLED_BY-->   Invoice         (soldToParty    → billingDocument)
 *   Invoice   --RECORDED_IN--> JournalEntry    (referenceDocument → accountingDocument)
 *   Invoice   --PAID_BY-->     Payment         (referenceDocument → accountingDocument)
 *
 * @param {Map<string, object>} nodeMap
 * @param {string}              dataDir
 * @returns {Promise<Array<{source:string, target:string, relation:string}>>}
 */
async function createEdges(nodeMap, dataDir) {
  const edges = [];

  const addEdge = (source, target, relation) => {
    if (source && target && nodeMap.has(source) && nodeMap.has(target)) {
      edges.push({ source, target, relation });
    }
  };

  // ── Customer → Address  (HAS_ADDRESS) ────────────────────────────────────
  const addresses = await readFolder(path.join(dataDir, 'business_partner_addresses'));
  addresses.forEach(a => {
    addEdge(`C_${a.businessPartner}`, `A_${a.addressId}`, 'HAS_ADDRESS');
  });

  // ── Customer → Order  (PLACED) ───────────────────────────────────────────
  const orders = await readFolder(path.join(dataDir, 'sales_order_headers'));
  orders.forEach(o => {
    addEdge(`C_${o.soldToParty}`, `O_${o.salesOrder}`, 'PLACED');
  });

  // ── Order → Product  (CONTAINS) ──────────────────────────────────────────
  // sales_order_items uses 'salesOrder' and 'material' (the product id)
  const orderItems = await readFolder(path.join(dataDir, 'sales_order_items'));
  orderItems.forEach(i => {
    addEdge(`O_${i.salesOrder}`, `P_${i.material}`, 'CONTAINS');
  });

  // Outbound deliveries have no direct salesOrder FK in headers JSONL.
  // We skip Order → Delivery to avoid broken links.

  // ── Customer → Invoice  (BILLED_BY) ──────────────────────────────────────
  // billing_document_headers links soldToParty → billingDocument directly
  const invoices = await readFolder(path.join(dataDir, 'billing_document_headers'));
  invoices.forEach(inv => {
    addEdge(`C_${inv.soldToParty}`, `I_${inv.billingDocument}`, 'BILLED_BY');
  });

  // ── Invoice → JournalEntry  (RECORDED_IN) ────────────────────────────────
  // referenceDocument in journal_entry_items points to billingDocument
  const journals = await readFolder(path.join(dataDir, 'journal_entry_items_accounts_receivable'));
  journals.forEach(j => {
    addEdge(`I_${j.referenceDocument}`, `JE_${j.accountingDocument}`, 'RECORDED_IN');
  });

  // ── Invoice → Payment  (PAID_BY) ─────────────────────────────────────────
  // payments table referenceDocument also points to billingDocument
  const payments = await readFolder(path.join(dataDir, 'payments_accounts_receivable'));
  payments.forEach(p => {
    addEdge(`I_${p.referenceDocument}`, `PAY_${p.accountingDocument}`, 'PAID_BY');
  });

  console.log(`[createEdges] ✔ Total edges: ${edges.length}\n`);
  return edges;
}

// ─── buildGraph ───────────────────────────────────────────────────────────────

/**
 * Orchestrates createNodes + createEdges and returns an in-memory graph
 * stored as an adjacency list (Map).
 *
 * Adjacency list format:
 *   Map<nodeId, Array<{ target: string, relation: string }>>
 *
 * @param {string} dataDir  Absolute path to the /data directory.
 * @returns {Promise<{ nodes: object[], edges: object[], adjacencyList: Map }>}
 */
async function buildGraph(dataDir) {
  console.log('\n📦 [buildGraph] Starting in-memory graph build...\n');

  // Step 1 — nodes
  const nodeMap = await createNodes(dataDir);

  // Step 2 — edges
  const edges = await createEdges(nodeMap, dataDir);

  // Step 3 — adjacency list (directed)
  const adjacencyList = new Map();
  for (const nodeId of nodeMap.keys()) {
    adjacencyList.set(nodeId, []);
  }
  for (const { source, target, relation } of edges) {
    adjacencyList.get(source).push({ target, relation });
  }

  const nodes = Array.from(nodeMap.values());

  console.log('✅ [buildGraph] Complete!');
  console.log(`   Nodes            : ${nodes.length}`);
  console.log(`   Edges            : ${edges.length}`);
  console.log(`   Adjacency entries: ${adjacencyList.size}\n`);

  return { nodes, edges, adjacencyList };
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = { createNodes, createEdges, buildGraph };
