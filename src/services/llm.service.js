/**
 * LLM Service - Groq-powered natural language → graph traversal and SQL generation.
 */
const config = require('../config/env');

const SCHEMA = `
CREATE TABLE business_partners ( business_partner_id VARCHAR(50) PRIMARY KEY, name VARCHAR(255), partner_type VARCHAR(50), created_at TIMESTAMP );
CREATE TABLE business_partner_addresses ( address_id VARCHAR(50) PRIMARY KEY, business_partner_id VARCHAR(50), address_line_1 VARCHAR(255), city VARCHAR(100), country VARCHAR(100), postal_code VARCHAR(20) );
CREATE TABLE customer_company_assignments ( assignment_id VARCHAR(50) PRIMARY KEY, business_partner_id VARCHAR(50), company_code VARCHAR(50), assigned_at TIMESTAMP );
CREATE TABLE customer_sales_area_assignments ( assignment_id VARCHAR(50) PRIMARY KEY, business_partner_id VARCHAR(50), sales_organization VARCHAR(50), distribution_channel VARCHAR(50), division VARCHAR(50) );
CREATE TABLE products ( product_id VARCHAR(50) PRIMARY KEY, category VARCHAR(100), base_unit VARCHAR(20), created_at TIMESTAMP );
CREATE TABLE product_descriptions ( description_id VARCHAR(50) PRIMARY KEY, product_id VARCHAR(50), language_code VARCHAR(10), description VARCHAR(255) );
CREATE TABLE plants ( plant_id VARCHAR(50) PRIMARY KEY, name VARCHAR(255), city VARCHAR(100), country VARCHAR(100) );
CREATE TABLE product_plants ( product_plant_id VARCHAR(50) PRIMARY KEY, product_id VARCHAR(50), plant_id VARCHAR(50) );
CREATE TABLE product_storage_locations ( storage_location_id VARCHAR(50) PRIMARY KEY, product_plant_id VARCHAR(50), name VARCHAR(100) );
CREATE TABLE sales_order_headers ( sales_order_id VARCHAR(50) PRIMARY KEY, business_partner_id VARCHAR(50), order_date DATE, total_amount DECIMAL(15, 2), currency VARCHAR(10), status VARCHAR(50) );
CREATE TABLE sales_order_items ( sales_order_item_id VARCHAR(50) PRIMARY KEY, sales_order_id VARCHAR(50), product_id VARCHAR(50), plant_id VARCHAR(50), quantity DECIMAL(15, 2), unit_price DECIMAL(15, 2), net_amount DECIMAL(15, 2) );
CREATE TABLE outbound_delivery_headers ( delivery_id VARCHAR(50) PRIMARY KEY, sales_order_id VARCHAR(50), business_partner_id VARCHAR(50), delivery_date DATE, status VARCHAR(50) );
CREATE TABLE outbound_delivery_items ( delivery_item_id VARCHAR(50) PRIMARY KEY, delivery_id VARCHAR(50), sales_order_item_id VARCHAR(50), product_id VARCHAR(50), delivered_quantity DECIMAL(15, 2) );
CREATE TABLE billing_document_headers ( billing_document_id VARCHAR(50) PRIMARY KEY, sales_order_id VARCHAR(50), delivery_id VARCHAR(50), business_partner_id VARCHAR(50), billing_date DATE, total_amount DECIMAL(15, 2), currency VARCHAR(10), status VARCHAR(50) );
CREATE TABLE billing_document_items ( billing_item_id VARCHAR(50) PRIMARY KEY, billing_document_id VARCHAR(50), delivery_item_id VARCHAR(50), product_id VARCHAR(50), billed_quantity DECIMAL(15, 2), net_amount DECIMAL(15, 2) );
CREATE TABLE billing_document_cancellations ( cancellation_id VARCHAR(50) PRIMARY KEY, billing_document_id VARCHAR(50), reason VARCHAR(255), cancellation_date DATE );
CREATE TABLE journal_entry_items_accounts_receivable ( journal_entry_id VARCHAR(50) PRIMARY KEY, billing_document_id VARCHAR(50), business_partner_id VARCHAR(50), posting_date DATE, amount DECIMAL(15, 2), currency VARCHAR(10) );
CREATE TABLE payments_accounts_receivable ( payment_id VARCHAR(50) PRIMARY KEY, journal_entry_id VARCHAR(50), business_partner_id VARCHAR(50), payment_date DATE, cleared_amount DECIMAL(15, 2), currency VARCHAR(10) );
`;

/**
 * Build a compact graph summary (used when no specific entity is mentioned).
 */
function buildGraphSummary(graphData) {
  const { nodes = [], edges = [] } = graphData;
  const nodeTypeCounts = {};
  const samplesByType  = {};
  for (const n of nodes) {
    nodeTypeCounts[n.type] = (nodeTypeCounts[n.type] || 0) + 1;
    if (!samplesByType[n.type]) samplesByType[n.type] = [];
    if (samplesByType[n.type].length < 1)           // only 1 sample per type
      samplesByType[n.type].push({ id: n.id, label: n.label });
  }
  const edgeRelCounts = {};
  for (const e of edges) {
    edgeRelCounts[e.relation] = (edgeRelCounts[e.relation] || 0) + 1;
  }
  return {
    summary:     { totalNodes: nodes.length, totalEdges: edges.length, nodeTypes: nodeTypeCounts, edgeTypes: edgeRelCounts },
    nodeSamples: samplesByType
  };
}

/**
 * Extract any raw ID numbers mentioned in the user query.
 * e.g. "Order 740583" → { rawId: '740583', prefixedIds: ['O_740583'] }
 *      "invoice 90504248" → { rawId: '90504248', prefixedIds: ['I_90504248'] }
 */
function extractQueryIds(query) {
  const patterns = [
    { regex: /\border\s*#?\s*([A-Z0-9_-]+)/i,    prefixes: ['O_'] },
    { regex: /\binvoice\s*#?\s*([A-Z0-9_-]+)/i,  prefixes: ['I_'] },
    { regex: /\bcustomer\s*#?\s*([A-Z0-9_-]+)/i, prefixes: ['C_'] },
    { regex: /\bproduct\s*#?\s*([A-Z0-9_-]+)/i,  prefixes: ['P_'] },
    { regex: /\bdelivery\s*#?\s*([A-Z0-9_-]+)/i, prefixes: ['D_'] },
    { regex: /\bpayment\s*#?\s*([A-Z0-9_-]+)/i,  prefixes: ['PAY_'] },
    { regex: /\bje\s*#?\s*([A-Z0-9_-]+)/i,       prefixes: ['JE_'] },
    { regex: /\bjournal\s*entry\s*#?\s*([A-Z0-9_-]+)/i, prefixes: ['JE_'] },
    // Generic number pattern — try all prefixes
    { regex: /\b(\d{5,})\b/,                      prefixes: ['O_','I_','C_','P_','D_','PAY_','JE_'] }
  ];

  for (const { regex, prefixes } of patterns) {
    const m = query.match(regex);
    if (m) {
      const rawId = m[1];
      return { rawId, prefixedIds: prefixes.map(p => `${p}${rawId}`) };
    }
  }
  return null;
}

/**
 * Build a targeted subgraph (node + all direct neighbours + connecting edges)
 * for a specific node ID. Keeps the prompt small but highly relevant.
 *
 * Token strategy:
 *   - centerNode  : FULL properties (this is what the user is asking about)
 *   - direct 1-hop neighbors : id, type, label + properties (for context)
 *   - secondary 2-hop nodes  : id, type, label only (slim)
 */
function buildTargetedSubgraph(nodeId, graphData) {
  const { nodes = [], edges = [] } = graphData;
  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  const center = nodeMap.get(nodeId);
  if (!center) return null;

  // Direct edges (outgoing + incoming)
  const relevantEdges = edges.filter(e => e.source === nodeId || e.target === nodeId);

  // 1-hop neighbour IDs
  const directNeighbourIds = new Set();
  relevantEdges.forEach(e => {
    directNeighbourIds.add(e.source);
    directNeighbourIds.add(e.target);
  });
  directNeighbourIds.delete(nodeId); // don't include center itself

  // 2-hop expansion — cap at 30 secondary edges to control token usage
  const allNeighbourIds = new Set([...directNeighbourIds]);
  const secondaryEdges = edges
    .filter(e =>
      (directNeighbourIds.has(e.source) || directNeighbourIds.has(e.target)) &&
      e.source !== nodeId && e.target !== nodeId
    )
    .slice(0, 30);
  secondaryEdges.forEach(e => {
    allNeighbourIds.add(e.source);
    allNeighbourIds.add(e.target);
  });

  // Helper: slim node (no properties)
  const slim = n => ({ id: n.id, type: n.type, label: n.label });

  // Build neighbor list: direct neighbors get properties, secondary stay slim
  const subNodes = [...allNeighbourIds]
    .map(id => nodeMap.get(id))
    .filter(Boolean)
    .map(n => {
      if (directNeighbourIds.has(n.id)) {
        // Include properties for direct neighbors too
        return { id: n.id, type: n.type, label: n.label, properties: n.properties || {} };
      }
      return slim(n);
    });

  const subEdges = [...relevantEdges, ...secondaryEdges]
    .map(e => ({ source: e.source, relation: e.relation, target: e.target }));

  // Center node: FULL data (id, type, label, ALL properties)
  const centerNode = {
    id: center.id,
    type: center.type,
    label: center.label,
    properties: center.properties || {}
  };

  return { centerNode, nodes: subNodes, edges: subEdges };
}

/**
 * Traverse an in-memory graph with the LLM to answer a natural language question.
 * - For specific entity queries: injects real subgraph data for that entity.
 * - For general queries: sends a compact schema summary.
 *
 * @param {string} userQuery
 * @param {Object} graphData  { nodes, edges }
 * @returns {{ answer: string, path: string, focusNodeId: string|null }}
 */
exports.traverseGraphWithQuery = async (userQuery, graphData) => {
  const { nodes = [], edges = [] } = graphData;

  // ── 1. Try to find a specific entity in the graph ──────────────────────────
  const extracted = extractQueryIds(userQuery);
  let contextSection = '';
  let foundNode = null;

  if (extracted) {
    const nodeMap = new Map(nodes.map(n => [n.id, n]));

    // Stage 1 — Try exact prefixed IDs
    for (const pid of extracted.prefixedIds) {
      if (nodeMap.has(pid)) { foundNode = nodeMap.get(pid); break; }
    }

    // Stage 2 — Fallback: scan all nodes for ID suffix or label match
    if (!foundNode) {
      const raw = extracted.rawId;
      foundNode = nodes.find(n =>
        n.id.endsWith(`_${raw}`) ||
        (n.label && n.label.includes(raw))
      ) || null;
    }

    console.log(`[LLM] extractQueryIds rawId=${extracted.rawId} → foundNode=${foundNode?.id || 'NOT FOUND'} (graph has ${nodes.length} nodes)`);

    if (foundNode) {
      const sub = buildTargetedSubgraph(foundNode.id, graphData);
      // Use compact JSON (no pretty-print) to minimise tokens
      contextSection = `
SPECIFIC ENTITY FOUND — use this real data to answer the question:
Center Node: ${JSON.stringify(sub.centerNode)}
Connected Nodes: ${JSON.stringify(sub.nodes)}
Connecting Edges: ${JSON.stringify(sub.edges)}
`;
    } else {
      // ID was mentioned but not found — tell LLM clearly
      contextSection = `
NOTE: The user asked about ID "${extracted.rawId}" (tried: ${extracted.prefixedIds.join(', ')} + label scan).
This ID does NOT exist in the graph (${nodes.length} nodes loaded).
Tell the user this entity is not found and suggest they check the ID.
`;
    }
  } else {
    // General question — use compact summary (no pretty-print)
    const summary = buildGraphSummary(graphData);
    contextSection = `GRAPH SUMMARY (${nodes.length} nodes, ${edges.length} edges total):\n${JSON.stringify(summary)}`;
  }

  const systemPrompt = `You are a graph traversal assistant for a supply chain dataset.

Relationship schema:
  Customer  --PLACED-->      Order
  Customer  --BILLED_BY-->   Invoice
  Customer  --HAS_ADDRESS--> Address
  Order     --CONTAINS-->    Product
  Invoice   --RECORDED_IN--> JournalEntry
  Invoice   --PAID_BY-->     Payment

${contextSection}

RESPONSE FORMAT (strict JSON, no markdown):
{
  "answer": "<direct factual answer using only the data above>",
  "path":   "<traversal path used, e.g. Customer → Order → Invoice → Payment>"
}

RULES:
- Use ONLY the data provided above. Do not hallucinate.
- For specific entity questions, always state the node ID and its connections.
- If the entity is not found, say so clearly with the ID that was searched.
- Always return valid JSON.`;

  try {
    const response = await fetch(config.API_BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.GROK_API_KEY}`
      },
      body: JSON.stringify({
        model: config.MODEL_NAME,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userQuery }
        ],
        temperature: 0,
        response_format: { type: 'json_object' }
      })
    });

    if (!response.ok) {
      let errMessage = response.statusText;
      try {
        const errData = await response.json();
        errMessage = JSON.stringify(errData);
      } catch (e) {}
      throw new Error(`LLM Error: HTTP ${response.status} - ${errMessage}`);
    }

    const data = await response.json();
    const raw  = data.choices[0].message.content.trim();
    console.log('[LLM traverseGraphWithQuery raw]:\n', raw);

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      parsed = { answer: raw, path: '' };
    }

    return {
      answer:      parsed.answer || 'I was unable to find a clear answer in the graph.',
      path:        parsed.path   || '',
      focusNodeId: foundNode?.id || null
    };
  } catch (error) {
    console.error('[LLM Service Error - traverseGraphWithQuery]:', error.message);
    throw error;
  }
};


/**
 * Calls the LLM to convert natural language to SQL.
 */
exports.generateSqlFromQuery = async (userQuery) => {

  const systemPrompt = `You are an intelligent data assistant connected to a PostgreSQL database.

The dataset includes the following entities:

Core Flow:
- Orders
- Deliveries
- Invoices
- Payments

Supporting Entities:
- Customers
- Products
- Address

These entities are related and should be used to trace the full lifecycle:
Order → Delivery → Invoice → Payment

Your job is to:
1. Understand the user's natural language query.
2. Analyze the database schema and entity relationships.
3. Dynamically generate an SQL query based on:
   - Correct table names
   - Correct column names
   - Relationships between entities
4. Ensure the query reflects the user's intent (e.g., highest, total, latest, status tracking).
5. Return results in a clean format.

IMPORTANT:
- Queries MUST adapt based on actual database structure.
- Use relationships to JOIN tables when needed.

STRICT RULES:
- Only generate SELECT queries.
- Do NOT modify the database (no INSERT, UPDATE, DELETE, DROP, ALTER).
- Use aggregations like MAX, SUM, COUNT, AVG when needed.
- Use JOINs for multi-table queries.
- Handle missing or empty results gracefully.
- Do not hallucinate columns.

DATABASE SCHEMA:
${SCHEMA}

RESPONSE FORMAT:

SQL Query:
<generated SQL query>

Final Answer:
<clear and user-friendly answer>
`;

  try {
    const response = await fetch(config.API_BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.GROK_API_KEY}`
      },
      body: JSON.stringify({
        model: config.MODEL_NAME,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userQuery }
        ],
        temperature: 0,
      })
    });

    if (!response.ok) {
        let errMessage = response.statusText;
        try {
            const errData = await response.json();
            errMessage = JSON.stringify(errData);
        } catch(e) {}
        throw new Error(`LLM Error: HTTP ${response.status} - ${errMessage}`);
    }

    const data = await response.json();
    let content = data.choices[0].message.content.trim();
    
    console.log("[LLM Raw Content]:\n", content);

    let extractedQuery = "";
    let extractedAnswer = "";

    const sqlMatch = content.match(/SQL Query:\s*([\s\S]*?)(?=Final Answer:|$)/i);
    const answerMatch = content.match(/Final Answer:\s*([\s\S]*?)$/i);

    if (sqlMatch && sqlMatch[1]) {
      let q = sqlMatch[1].trim();
      q = q.replace(/^[\s\*]*(```sql|```)?[\s\*]*/i, '');
      q = q.replace(/[\s\*]*(```)?[\s\*]*$/i, '');
      extractedQuery = q.trim();
    } else {
      extractedQuery = content; 
    }

    if (answerMatch && answerMatch[1]) {
      extractedAnswer = answerMatch[1].trim();
    } else {
      extractedAnswer = "Here are the results:\n<result>";
    }

    return { query: extractedQuery, answerTemplate: extractedAnswer };
  } catch (error) {
    console.error('[LLM Service Error]:', error.message);
    throw error;
  }
};

exports.generateAnswerFromData = async (userQuery, sqlQuery, dbData) => {

  const systemPrompt = `You are a data analyst answering user questions based on database results.

Original User Query: "${userQuery}"
SQL Executed: "${sqlQuery}"
Raw DB Results (JSON): 
${JSON.stringify(dbData, null, 2)}

Provide a concise, direct, and structured natural language answer exactly reflecting the data. Do NOT explain the SQL. If the DB Results are empty, gently state that no matching data was found.`;

  try {
    const response = await fetch(config.API_BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.GROK_API_KEY}`
      },
      body: JSON.stringify({
        model: config.MODEL_NAME,
        messages: [
          { role: 'system', content: systemPrompt }
        ],
        temperature: 0.2,
      })
    });

    if (!response.ok) {
        let errMessage = response.statusText;
        try {
            const errData = await response.json();
            errMessage = JSON.stringify(errData);
        } catch(e) {}
        throw new Error(`LLM Error: HTTP ${response.status} - ${errMessage}`);
    }

    const data = await response.json();
    let answer = data.choices[0].message.content.trim();
    
    console.log(`[LLM Service] Generated Answer:\n${answer}`);
    return answer;
  } catch (error) {
    console.error('[LLM Service Error]:', error.message);
    throw error;
  }
};
