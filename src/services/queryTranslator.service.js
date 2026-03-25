/**
 * queryTranslator.service.js
 *
 * Converts natural language user queries into structured query JSON.
 * Does NOT execute queries — only produces the intent/entity/traversal spec.
 *
 * Output format:
 * {
 *   intent:    string,          // count | traverse | filter | aggregate | detect
 *   entities:  string[],        // node types involved
 *   filters:   object,          // field-level constraints
 *   operation: string,          // top | trace | list | count | detect
 *   traversal: string[]         // ordered path through the graph
 * }
 *
 * Exports:
 *   translateQuery(naturalLanguage)  → structuredQuery
 *   EXAMPLES                         → array of labelled example translations
 */

// ─────────────────────────────────────────────────────────────────────────────
// Schema definition (used by rules engine & LLM prompt)
// ─────────────────────────────────────────────────────────────────────────────

const GRAPH_SCHEMA = {
  nodes: ['Customer', 'Order', 'Product', 'Delivery', 'Invoice', 'Payment', 'JournalEntry', 'Address'],
  edges: [
    { from: 'Customer', to: 'Address',      relation: 'HAS_ADDRESS'  },
    { from: 'Customer', to: 'Order',         relation: 'PLACED'        },
    { from: 'Order',    to: 'Product',       relation: 'CONTAINS'      },
    { from: 'Customer', to: 'Invoice',       relation: 'BILLED_BY'     },
    { from: 'Invoice',  to: 'JournalEntry',  relation: 'RECORDED_IN'   },
    { from: 'Invoice',  to: 'Payment',       relation: 'PAID_BY'       }
  ],
  // Traversal paths commonly requested
  paths: {
    fullOrderFlow:   ['Customer', 'Order', 'Product', 'Invoice', 'Payment'],
    invoiceFlow:     ['Customer', 'Invoice', 'JournalEntry', 'Payment'],
    orderToProduct:  ['Order', 'Product'],
    customerSummary: ['Customer', 'Order', 'Invoice', 'Payment']
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Keyword rules engine
// ─────────────────────────────────────────────────────────────────────────────

const RULES = [
  // ── COUNT rules ────────────────────────────────────────────────────────────
  {
    match: /\bhow many\b.*\border(s)?\b/i,
    result: {
      intent: 'count', entities: ['Order'],
      filters: {}, operation: 'count', traversal: ['Order']
    }
  },
  {
    match: /\bhow many\b.*\binvoice(s)?\b/i,
    result: {
      intent: 'count', entities: ['Invoice'],
      filters: {}, operation: 'count', traversal: ['Invoice']
    }
  },
  {
    match: /\bhow many\b.*\bpayment(s)?\b/i,
    result: {
      intent: 'count', entities: ['Payment'],
      filters: {}, operation: 'count', traversal: ['Payment']
    }
  },
  {
    match: /\bhow many\b.*\bcustomer(s)?\b/i,
    result: {
      intent: 'count', entities: ['Customer'],
      filters: {}, operation: 'count', traversal: ['Customer']
    }
  },

  // ── TOP / AGGREGATE rules ──────────────────────────────────────────────────
  {
    match: /\btop\b.*\bproduct(s)?\b/i,
    result: {
      intent: 'aggregate', entities: ['Product', 'Order'],
      filters: {}, operation: 'top',
      traversal: ['Order', 'Product']
    }
  },
  {
    match: /\btop\b.*\bcustomer(s)?\b/i,
    result: {
      intent: 'aggregate', entities: ['Customer', 'Invoice'],
      filters: {}, operation: 'top',
      traversal: ['Customer', 'Invoice']
    }
  },
  {
    match: /\bhighest\b.*\brevenue\b|\bmost\b.*\brevenue\b/i,
    result: {
      intent: 'aggregate', entities: ['Customer', 'Invoice'],
      filters: {}, operation: 'top',
      traversal: ['Customer', 'Invoice', 'Payment']
    }
  },

  // ── TRACE / TRAVERSAL rules ────────────────────────────────────────────────
  {
    match: /\btrace\b.*\binvoice\b|\bfull.*(flow|journey).*\binvoice\b/i,
    result: {
      intent: 'traverse', entities: ['Customer', 'Invoice', 'JournalEntry', 'Payment'],
      filters: {}, operation: 'trace',
      traversal: ['Customer', 'Invoice', 'JournalEntry', 'Payment']
    }
  },
  {
    match: /\btrace\b.*\border\b|\bfull.*(flow|journey).*\border\b/i,
    result: {
      intent: 'traverse', entities: ['Customer', 'Order', 'Product', 'Invoice', 'Payment'],
      filters: {}, operation: 'trace',
      traversal: ['Customer', 'Order', 'Product', 'Invoice', 'Payment']
    }
  },
  {
    match: /\border(s)?\b.*\bcustomer\b|\border(s)?\b.*\bplaced\b/i,
    result: {
      intent: 'traverse', entities: ['Customer', 'Order'],
      filters: {}, operation: 'list',
      traversal: ['Customer', 'Order']
    }
  },

  // ── FILTER rules ───────────────────────────────────────────────────────────
  {
    match: /\bunpaid\b.*\binvoice(s)?\b|\binvoice(s)?\b.*\bnot paid\b/i,
    result: {
      intent: 'filter', entities: ['Invoice', 'Payment'],
      filters: { paymentStatus: 'missing' }, operation: 'list',
      traversal: ['Invoice', 'Payment']
    }
  },
  {
    match: /\bsettled\b.*\binvoice(s)?\b|\binvoice(s)?\b.*\bsettled\b/i,
    result: {
      intent: 'filter', entities: ['Invoice', 'Payment'],
      filters: { paymentStatus: 'settled' }, operation: 'list',
      traversal: ['Invoice', 'Payment']
    }
  },
  {
    match: /\border(s)?\b.*(without|no|missing)\b.*\bproduct(s)?\b/i,
    result: {
      intent: 'detect', entities: ['Order', 'Product'],
      filters: { relation: 'CONTAINS', status: 'missing' }, operation: 'detect',
      traversal: ['Order', 'Product']
    }
  },
  {
    match: /\border(s)?\b.*(without|no|missing)\b.*\binvoice(s)?\b/i,
    result: {
      intent: 'detect', entities: ['Order', 'Invoice'],
      filters: { relation: 'BILLED_BY', status: 'missing' }, operation: 'detect',
      traversal: ['Customer', 'Order', 'Invoice']
    }
  },
  {
    match: /\bdisconnected\b|\bisolated\b.*\bnode(s)?\b/i,
    result: {
      intent: 'detect', entities: ['*'],
      filters: { status: 'disconnected' }, operation: 'detect',
      traversal: []
    }
  },

  // ── DELIVERY rules ─────────────────────────────────────────────────────────
  {
    match: /\bdelivery\b|\bdeliveries\b|\bdelivered\b/i,
    result: {
      intent: 'traverse', entities: ['Order', 'Delivery'],
      filters: {}, operation: 'list',
      traversal: ['Order', 'Delivery', 'Invoice']
    }
  },

  // ── PAYMENT rules ──────────────────────────────────────────────────────────
  {
    match: /\bpayment(s)?\b.*\btotal\b|\btotal\b.*\bpayment(s)?\b/i,
    result: {
      intent: 'aggregate', entities: ['Payment'],
      filters: {}, operation: 'aggregate',
      traversal: ['Invoice', 'Payment']
    }
  }
];

// ─────────────────────────────────────────────────────────────────────────────
// Entity & ID extractor
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pull any specific IDs mentioned in the query.
 * e.g. "Invoice 90504248" → { Invoice: 'I_90504248' }
 */
function extractIds(text) {
  const idPatterns = [
    { type: 'Invoice',      regex: /\binvoice\s+([A-Z0-9_-]+)/i,  prefix: 'I_'   },
    { type: 'Order',        regex: /\border\s+([A-Z0-9_-]+)/i,     prefix: 'O_'   },
    { type: 'Customer',     regex: /\bcustomer\s+([A-Z0-9_-]+)/i,  prefix: 'C_'   },
    { type: 'Product',      regex: /\bproduct\s+([A-Z0-9_-]+)/i,   prefix: 'P_'   },
    { type: 'Payment',      regex: /\bpayment\s+([A-Z0-9_-]+)/i,   prefix: 'PAY_' },
    { type: 'Delivery',     regex: /\bdelivery\s+([A-Z0-9_-]+)/i,  prefix: 'D_'   }
  ];

  const ids = {};
  for (const { type, regex, prefix } of idPatterns) {
    const match = text.match(regex);
    if (match) {
      // Don't double-prefix if user already used the prefix
      ids[type] = match[1].startsWith(prefix) ? match[1] : `${prefix}${match[1]}`;
    }
  }
  return ids;
}

/**
 * Extract filter values like currency, date ranges, amounts.
 */
function extractFilters(text) {
  const filters = {};

  // Currency
  const currencyMatch = text.match(/\b(INR|USD|EUR|GBP)\b/i);
  if (currencyMatch) filters.currency = currencyMatch[1].toUpperCase();

  // Amount threshold  e.g. "greater than 1000" or "above 5000"
  const amountMatch = text.match(/(?:greater than|above|more than|over)\s+(\d+(?:\.\d+)?)/i);
  if (amountMatch) filters.amountGt = parseFloat(amountMatch[1]);

  const amountLtMatch = text.match(/(?:less than|below|under)\s+(\d+(?:\.\d+)?)/i);
  if (amountLtMatch) filters.amountLt = parseFloat(amountLtMatch[1]);

  // Year / fiscal year
  const yearMatch = text.match(/\b(20\d{2})\b/);
  if (yearMatch) filters.fiscalYear = yearMatch[1];

  // Limit / top N
  const topNMatch = text.match(/\btop\s+(\d+)\b/i);
  if (topNMatch) filters.limit = parseInt(topNMatch[1], 10);

  return filters;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main translator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Translate a natural language query into a structured query JSON.
 *
 * @param {string} naturalLanguage
 * @returns {{
 *   intent:    string,
 *   entities:  string[],
 *   filters:   object,
 *   operation: string,
 *   traversal: string[]
 * }}
 */
function translateQuery(naturalLanguage) {
  const text = naturalLanguage.trim();

  // Match against rules engine
  for (const rule of RULES) {
    if (rule.match.test(text)) {
      const specificIds = extractIds(text);
      const extraFilters = extractFilters(text);
      return {
        ...rule.result,
        filters: {
          ...rule.result.filters,
          ...extraFilters,
          ...(Object.keys(specificIds).length ? { ids: specificIds } : {})
        }
      };
    }
  }

  // Fallback: unknown query — still return valid JSON skeleton
  const extractedIds     = extractIds(text);
  const extractedFilters = extractFilters(text);
  const mentionedEntities = GRAPH_SCHEMA.nodes.filter(n =>
    new RegExp(`\\b${n}`, 'i').test(text)
  );

  return {
    intent:    'unknown',
    entities:  mentionedEntities.length ? mentionedEntities : ['*'],
    filters:   { ...extractedFilters, ...(Object.keys(extractedIds).length ? { ids: extractedIds } : {}) },
    operation: 'list',
    traversal: mentionedEntities
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Labelled examples
// ─────────────────────────────────────────────────────────────────────────────

const EXAMPLES = [
  {
    input: 'How many orders are there?',
    output: translateQuery('How many orders are there?')
  },
  {
    input: 'Show top 5 products by orders',
    output: translateQuery('Show top 5 products by orders')
  },
  {
    input: 'Trace the full flow of invoice 90504248',
    output: translateQuery('Trace the full flow of invoice 90504248')
  },
  {
    input: 'List all unpaid invoices',
    output: translateQuery('List all unpaid invoices')
  },
  {
    input: 'Find orders without invoice in fiscal year 2025',
    output: translateQuery('Find orders without invoice in fiscal year 2025')
  },
  {
    input: 'Which customer has the highest revenue above 10000 INR?',
    output: translateQuery('Which customer has the highest revenue above 10000 INR?')
  },
  {
    input: 'Show all deliveries for order 740506',
    output: translateQuery('Show all deliveries for order 740506')
  },
  {
    input: 'Find disconnected nodes in the graph',
    output: translateQuery('Find disconnected nodes in the graph')
  }
];

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = { translateQuery, EXAMPLES, GRAPH_SCHEMA };
