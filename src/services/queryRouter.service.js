/**
 * queryRouter.service.js
 *
 * Routes natural language queries to one of the available backend functions.
 * Returns ONLY structured JSON — no explanations, no hallucinations.
 *
 * Available functions:
 *   getTopProducts   — products with most invoices
 *   traceInvoice     — full flow for a specific invoice_id
 *   findBrokenFlows  — orders delivered but not billed / incomplete chains
 *   reject           — out of scope
 *
 * Export:
 *   routeQuery(naturalLanguage) → { function, parameters } | { function: 'reject', reason }
 */

// ─── Function definitions ────────────────────────────────────────────────────
const FUNCTIONS = {
  getTopProducts: {
    description: 'Returns products with the highest number of invoices',
    patterns: [
      /\btop\b.*\bproduct(s)?\b/i,
      /\bbest[\s-]?selling\b/i,
      /\bproduct(s)?\b.*\bmost\b.*\binvoice(s)?\b/i,
      /\bmost\b.*\bproduct(s)?\b/i,
      /\bhighest\b.*\bproduct(s)?\b/i,
      /\bproduct(s)?\b.*\brank(ed|ing)?\b/i,
      /\bpopular\b.*\bproduct(s)?\b/i
    ],
    extractParams: (text) => {
      const topN = text.match(/\btop\s+(\d+)\b/i);
      return topN ? { limit: parseInt(topN[1], 10) } : {};
    }
  },

  traceInvoice: {
    description: 'Full flow of an invoice: Order → Delivery → Invoice → Payment',
    patterns: [
      /\btrace\b.*\binvoice\b/i,
      /\binvoice\b.*\bflow\b/i,
      /\bfull\b.*\bflow\b.*\binvoice\b/i,
      /\binvoice\b.*\bjourney\b/i,
      /\bshow\b.*\binvoice\b.*\b\d+/i,
      /\binvoice\b.*\b\d{5,}\b/i,
      /\bpayment(s)?\b.*\binvoice\b.*\b\d+/i,
      /\btrack\b.*\binvoice\b/i
    ],
    extractParams: (text) => {
      // Match "invoice 90504248" or "invoice #90504248" or bare 5+ digit number near 'invoice'
      const explicit = text.match(/\binvoice\s*#?\s*([A-Z0-9_-]+)/i);
      if (explicit) {
        const raw = explicit[1];
        return { invoice_id: raw.startsWith('I_') ? raw : `I_${raw}` };
      }
      // Bare long number anywhere in query
      const bare = text.match(/\b(\d{5,})\b/);
      if (bare) return { invoice_id: `I_${bare[1]}` };
      return {};
    }
  },

  findBrokenFlows: {
    description: 'Finds incomplete order flows (delivered but not billed, unpaid invoices, etc.)',
    patterns: [
      /\bbroken\b.*\bflow(s)?\b/i,
      /\bincomplete\b.*\bflow(s)?\b/i,
      /\bmissing\b.*\b(invoice|payment|delivery|billing)\b/i,
      /\bunpaid\b.*\binvoice(s)?\b/i,
      /\border(s)?\b.*(without|no|missing)\b.*\b(invoice|payment|billing)\b/i,
      /\bdelivered\b.*\bnot\b.*\bbilled\b/i,
      /\bnot\b.*\bpaid\b/i,
      /\bdisconnected\b/i,
      /\borphan(ed)?\b/i,
      /\bgap(s)?\b.*\b(billing|payment|flow)\b/i
    ],
    extractParams: (_text) => ({})
  }
};

// ─── Out-of-scope patterns ───────────────────────────────────────────────────
const OUT_OF_SCOPE_PATTERNS = [
  /\bweather\b/i,
  /\bstock\s+market\b/i,
  /\bsocial\s+media\b/i,
  /\brecipe\b/i,
  /\bsports\b/i,
  /\bpolitics\b/i,
  /\bnews\b/i,
  /\btranslat(e|ion)\b/i,
  /\bpoem\b/i,
  /\bjoke\b/i
];

// ─── Main router ─────────────────────────────────────────────────────────────

/**
 * Route a natural language query to the correct backend function.
 *
 * @param {string} naturalLanguage
 * @returns {{ function: string, parameters: object }
 *        | { function: 'reject', reason: string }}
 */
function routeQuery(naturalLanguage) {
  const text = (naturalLanguage || '').trim();

  // 1. Check out-of-scope first
  for (const pattern of OUT_OF_SCOPE_PATTERNS) {
    if (pattern.test(text)) {
      return { function: 'reject', reason: 'out_of_scope' };
    }
  }

  // 2. Match against function patterns (order matters — most specific first)
  for (const [fnName, def] of Object.entries(FUNCTIONS)) {
    for (const pattern of def.patterns) {
      if (pattern.test(text)) {
        const parameters = def.extractParams(text);
        return { function: fnName, parameters };
      }
    }
  }

  // 3. Fallback — cannot map to any function
  return { function: 'reject', reason: 'out_of_scope' };
}

// ─── Example routing table (for documentation / tests) ───────────────────────
const EXAMPLES = [
  {
    input:  'Show top 5 products by invoices',
    output: { function: 'getTopProducts', parameters: { limit: 5 } }
  },
  {
    input:  'Trace invoice 90504248',
    output: { function: 'traceInvoice', parameters: { invoice_id: 'I_90504248' } }
  },
  {
    input:  'Show full flow for invoice #I_90504219',
    output: { function: 'traceInvoice', parameters: { invoice_id: 'I_90504219' } }
  },
  {
    input:  'Find orders delivered but not billed',
    output: { function: 'findBrokenFlows', parameters: {} }
  },
  {
    input:  'List unpaid invoices',
    output: { function: 'findBrokenFlows', parameters: {} }
  },
  {
    input:  'What is the weather today?',
    output: { function: 'reject', reason: 'out_of_scope' }
  }
];

// ─── Exports ─────────────────────────────────────────────────────────────────
module.exports = { routeQuery, EXAMPLES };
