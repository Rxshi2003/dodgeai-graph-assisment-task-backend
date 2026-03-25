/**
 * resultFormatter.service.js
 *
 * Converts structured { result, explanation } from queryExecutor
 * into a concise plain-text human-readable answer.
 *
 * Rules:
 *  - Only uses provided data
 *  - No assumptions or hallucinations
 *  - Concise and factual
 *
 * Export:
 *   formatResult(queryResult, originalQuery) → string
 */

// ─────────────────────────────────────────────────────────────────────────────
// Internal sub-formatters per operation type
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format a count result.
 * result: [{ type, count }]
 */
function formatCount({ result, explanation }) {
  if (!result?.length) return explanation || 'No data found.';
  if (result.length === 1) {
    const { type, count } = result[0];
    return `There are **${count}** ${type}(s) in the dataset.`;
  }
  const lines = result.map(r => `  • ${r.type}: ${r.count}`).join('\n');
  return `Graph node summary:\n${lines}`;
}

/**
 * Format top/aggregate results.
 * result: [{ label, orderCount | invoiceCount | totalRevenue }]
 */
function formatTop({ result, explanation }) {
  if (!result?.length) return explanation || 'No data found.';

  const header = explanation || `Top ${result.length} result(s):`;
  const lines  = result.map((r, i) => {
    const rank  = `${i + 1}.`;
    const label = r.label || r.productId || r.customerId || r.nodeId || '—';
    const value =
      r.orderCount   != null ? `${r.orderCount} order(s)` :
      r.invoiceCount != null ? `${r.invoiceCount} invoice(s)` :
      r.totalRevenue != null ? `₹${r.totalRevenue.toLocaleString()}` :
      '';
    return `  ${rank} ${label}${value ? ` — ${value}` : ''}`;
  });
  return `${header}\n${lines.join('\n')}`;
}

/**
 * Format a trace/traversal result.
 * result: [{ customer, order, invoice, products, payments, isSettled, journalEntries }]
 */
function formatTrace({ result, explanation }) {
  if (!result?.length) return explanation || 'No trace data found.';

  const item = result[0];

  // Invoice flow trace
  if (item.invoice) {
    const parts = [];
    if (item.customer)  parts.push(`Customer: ${item.customer.label}`);
    parts.push(`Invoice: ${item.invoice.label}`);
    if (item.journalEntries?.length)
      parts.push(`Journal Entries: ${item.journalEntries.map(j => j.label).join(', ')}`);
    if (item.payments?.length)
      parts.push(`Payment(s): ${item.payments.map(p => p.label).join(', ')}`);
    parts.push(`Status: ${item.isSettled ? '✅ Settled' : '⚠️ Unsettled'}`);
    return parts.join('\n');
  }

  // Order journey trace
  if (item.order) {
    const parts = [];
    if (item.customer) parts.push(`Customer: ${item.customer.label}`);
    parts.push(`Order: ${item.order.label}`);
    if (item.products?.length)
      parts.push(`Products (${item.products.length}): ${item.products.slice(0, 3).map(p => p.label).join(', ')}${item.products.length > 3 ? ' ...' : ''}`);
    if (item.invoices?.length)
      parts.push(`Invoice(s): ${item.invoices.map(i => i.label).join(', ')}`);
    if (item.payments?.length)
      parts.push(`Payment(s): ${item.payments.map(p => p.label).join(', ')}`);
    return parts.join('\n');
  }

  // BFS result
  if (item.node) {
    const byDepth = {};
    result.forEach(({ node, depth }) => {
      if (!byDepth[depth]) byDepth[depth] = [];
      byDepth[depth].push(node.label || node.id);
    });
    const lines = Object.entries(byDepth).map(
      ([d, labels]) => `  Depth ${d}: ${labels.slice(0, 5).join(', ')}${labels.length > 5 ? ` (+${labels.length - 5} more)` : ''}`
    );
    return `Reachable nodes (${result.length} total):\n${lines.join('\n')}`;
  }

  return explanation || JSON.stringify(result, null, 2);
}

/**
 * Format list/filter results.
 * result: Node[] or Neighbor[]
 */
function formatList({ result, explanation }) {
  if (!result?.length) return explanation || 'No matching records found.';

  const MAX_SHOW = 10;
  const shown    = result.slice(0, MAX_SHOW);
  const extra    = result.length - MAX_SHOW;

  const lines = shown.map(r => {
    if (r.neighbor) return `  • ${r.neighbor.label || r.neighbor.id} — [${r.relation}]`;
    if (r.label)    return `  • ${r.label} (${r.type || ''})`;
    if (r.id)       return `  • ${r.id}`;
    return `  • ${JSON.stringify(r)}`;
  });

  const suffix = extra > 0 ? `\n  ... and ${extra} more.` : '';
  const header = explanation || `${result.length} result(s):`;
  return `${header}\n${lines.join('\n')}${suffix}`;
}

/**
 * Format detect/health-check results.
 * result: issue objects with { type, nodeId, label, missing } OR plain nodes
 */
function formatDetect({ result, explanation }) {
  if (!result?.length) {
    return `✅ No issues detected. ${explanation || ''}`.trim();
  }

  const MAX_SHOW = 8;
  const shown    = result.slice(0, MAX_SHOW);
  const extra    = result.length - MAX_SHOW;

  const lines = shown.map(r => {
    if (r.missing) return `  ⚠️  ${r.type} "${r.label}" — ${r.missing}`;
    if (r.label)   return `  ⚠️  ${r.type} "${r.label}" [${r.id}]`;
    return `  ⚠️  ${r.id}`;
  });

  const suffix = extra > 0 ? `\n  ... and ${extra} more issues.` : '';
  const header = explanation || `${result.length} issue(s) detected:`;
  return `${header}\n${lines.join('\n')}${suffix}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main formatter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format a { result, explanation } object into a readable plain-text string.
 *
 * @param {{ result: any[], explanation: string }} queryResult
 * @param {{ intent: string, operation: string }}  query  — structured query JSON for context
 * @returns {string}
 */
function formatResult(queryResult, query = {}) {
  if (!queryResult) return 'No response received.';

  const { result = [], explanation = '' } = queryResult;
  const operation = query.operation || 'list';
  const intent    = query.intent    || 'unknown';

  // Empty result guard
  if (!result.length && explanation) return explanation;

  switch (operation) {
    case 'count':                     return formatCount({ result, explanation });
    case 'top':
    case 'aggregate':                 return formatTop({ result, explanation });
    case 'trace':                     return formatTrace({ result, explanation });
    case 'list':
    case 'filter':                    return formatList({ result, explanation });
    case 'detect':                    return formatDetect({ result, explanation });
    default:
      // Infer from intent as fallback
      if (intent === 'count')         return formatCount({ result, explanation });
      if (intent === 'aggregate')     return formatTop({ result, explanation });
      if (intent === 'traverse')      return formatTrace({ result, explanation });
      if (intent === 'detect')        return formatDetect({ result, explanation });
      return formatList({ result, explanation });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = { formatResult };
