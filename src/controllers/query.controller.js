const llmService = require('../services/llm.service');
const graphBuilder = require('../services/graphBuilder.service');
const { buildGraph } = require('../services/graphMemory.service');  // reads ALL JSONL files
const { translateQuery } = require('../services/queryTranslator.service');
const { executeQuery } = require('../services/queryExecutor.service');
const { formatResult } = require('../services/resultFormatter.service');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.resolve(__dirname, '../../data');

// Fallback graph used if DB is unavailable
const FALLBACK_GRAPH = {
  nodes: [
    { id: 'C_101', type: 'Customer', label: 'Customer 101' },
    { id: 'A_001', type: 'Address', label: 'Berlin, DE' },
    { id: 'O_5001', type: 'Order', label: 'Order 5001' },
    { id: 'P_200', type: 'Product', label: 'Product 200' },
    { id: 'D_7001', type: 'Delivery', label: 'Delivery 7001' },
    { id: 'I_9001', type: 'Invoice', label: 'Invoice 9001' },
    { id: 'PAY_3001', type: 'Payment', label: 'Payment 3001' },
    { id: 'JE_4001', type: 'JournalEntry', label: 'JE 4001' }
  ],
  edges: [
    { source: 'C_101', target: 'A_001', relation: 'HAS_ADDRESS' },
    { source: 'C_101', target: 'O_5001', relation: 'PLACED' },
    { source: 'O_5001', target: 'P_200', relation: 'CONTAINS' },
    { source: 'O_5001', target: 'D_7001', relation: 'DELIVERED_BY' },
    { source: 'D_7001', target: 'I_9001', relation: 'BILLED_BY' },
    { source: 'I_9001', target: 'PAY_3001', relation: 'PAID_BY' },
    { source: 'I_9001', target: 'JE_4001', relation: 'RECORDED_IN' }
  ]
};

/**
 * Loads the graph from the database, with a fallback to the demo graph.
 */
// Cache the graph so we only parse all JSONL files once per process
let _graphCache = null;

async function loadGraph() {
  // 1. Return cached graph if available
  if (_graphCache) return _graphCache;

  // 2. Try JSONL files first — reads ALL records, no row limit
  if (fs.existsSync(DATA_DIR)) {
    try {
      const graph = await buildGraph(DATA_DIR);
      if (graph.nodes && graph.nodes.length > 0) {
        console.log(`[Controller] JSONL graph loaded: ${graph.nodes.length} nodes, ${graph.edges.length} edges`);
        _graphCache = graph;
        return graph;
      }
    } catch (jsonlErr) {
      console.warn('[Controller] JSONL load failed:', jsonlErr.message);
    }
  }

  // 3. Try database
  try {
    const graph = await graphBuilder.buildFullGraph();
    if (graph.nodes && graph.nodes.length > 0) {
      console.log(`[Controller] DB graph loaded: ${graph.nodes.length} nodes, ${graph.edges.length} edges`);
      _graphCache = graph;
      return graph;
    }
  } catch (dbErr) {
    console.warn('[Controller] DB load failed:', dbErr.message);
  }

  // 4. Last resort: fallback demo
  console.warn('[Controller] Using fallback demo graph.');
  return FALLBACK_GRAPH;
}

/**
 * POST /query — Natural language graph traversal
 */
exports.handleQuery = async (req, res) => {
  try {
    const { query } = req.body;

    if (!query || typeof query !== 'string') {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'A valid "query" string must be provided in the request body.'
      });
    }

    console.log(`[Controller] Received user query: "${query}"`);

    // Load live graph from DB (or fallback)
    const graphData = await loadGraph();

    // Traverse graph with LLM
    let answer = 'Error generating response.';
    let path = '';
    let focusNodeId = null;

    try {
      const llmResponse = await llmService.traverseGraphWithQuery(query, graphData);
      answer = llmResponse.answer;
      path = llmResponse.path;
      focusNodeId = llmResponse.focusNodeId || null;

      if (path && path.length > 0) {
        answer += `\n\n**Path Traced:** ${path}`;
      }
    } catch (llmError) {
      console.error('[Controller] LLM Error:', llmError.message);
      answer = 'Failed to traverse graph with LLM: ' + llmError.message;
    }

    return res.status(200).json({
      answer,
      query: 'In-Context Graph Traversal',
      focusNodeId,
      result: graphData
    });

  } catch (error) {
    console.error('[Controller] Fatal Error:', error);
    return res.status(500).json({ error: 'Internal server error while processing the request.' });
  }
};

/**
 * GET /graph — Return the raw graph structure (useful for frontend pre-load & debugging)
 */
exports.handleGetGraph = async (req, res) => {
  try {
    const graphData = await loadGraph();
    // Strip adjacencyList (Map is not JSON-serialisable) before sending
    return res.status(200).json({ nodes: graphData.nodes, edges: graphData.edges });
  } catch (error) {
    console.error('[Controller] Error fetching graph:', error);
    return res.status(500).json({ error: 'Failed to build graph.' });
  }
};

/**
 * POST /graph/reload — Clear the graph cache so next request re-reads all JSONL files
 */
exports.handleReloadGraph = (req, res) => {
  _graphCache = null;
  console.log('[Controller] Graph cache cleared — will reload all JSONL files on next request.');
  return res.status(200).json({ message: 'Graph cache cleared. Next request will reload all data files.' });
};

/**
 * POST /query-local
 * Translate NL → structured query → execute on graph → format answer.
 * No LLM involved — instant, deterministic, factual.
 */
exports.handleLocalQuery = async (req, res) => {
  try {
    const { query } = req.body;
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'A valid "query" string is required.' });
    }

    console.log(`[Local] Query: "${query}"`);

    // 1. Load graph
    const graphData = await loadGraph();

    // Build adjacencyList for the graph if not present
    if (!graphData.adjacencyList) {
      const nodeMap = new Map(graphData.nodes.map(n => [n.id, n]));
      const adj = new Map(graphData.nodes.map(n => [n.id, []]));
      graphData.edges.forEach(e => {
        if (adj.has(e.source)) adj.get(e.source).push({ target: e.target, relation: e.relation });
      });
      graphData.adjacencyList = adj;
    }

    // 2. Translate
    const structuredQuery = translateQuery(query);
    console.log('[Local] Structured query:', structuredQuery);

    // 3. Execute
    const queryResult = executeQuery(structuredQuery, graphData);

    // 4. Format
    const answer = formatResult(queryResult, structuredQuery);

    return res.status(200).json({
      answer,
      structuredQuery,
      queryResult,
      result: graphData
    });

  } catch (error) {
    console.error('[Local] Error:', error);
    return res.status(500).json({ error: 'Internal error processing local query.' });
  }
};
