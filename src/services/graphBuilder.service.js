const dbService = require('./db.service');

/**
 * Transforms relational PostgreSQL data into a unified Graph structure.
 * Nodes: Customer, Order, Product, Delivery, Invoice, Payment, JournalEntry
 * Edges: PLACED, CONTAINS, DELIVERED_BY, BILLED_BY, PAID_BY, RECORDED_IN
 */
exports.buildFullGraph = async () => {
  const nodes = [];
  const edges = [];
  const nodeMap = new Set();

  const addNode = (id, type, label) => {
    if (!nodeMap.has(id) && id) {
      nodes.push({ id, type, label: label || `${type} ${id}` });
      nodeMap.add(id);
    }
  };

  const addEdge = (source, target, relation) => {
    if (source && target) {
      edges.push({ source, target, relation });
    }
  };

  try {
    // 1. Customers (from business_partners - partner_type is the correct column)
    const customers = await dbService.executeReadOnlyQuery(
      `SELECT business_partner_id, name FROM business_partners WHERE partner_type = 'Customer' LIMIT 50`
    );
    customers.forEach(c => {
      const cid = `C_${c.business_partner_id}`;
      addNode(cid, 'Customer', c.name || cid);
    });

    // 1b. Addresses & Customer → Address edges
    const addresses = await dbService.executeReadOnlyQuery(
      `SELECT address_id, business_partner_id, city, country FROM business_partner_addresses LIMIT 100`
    );
    addresses.forEach(a => {
      const aid = `A_${a.address_id}`;
      const label = [a.city, a.country].filter(Boolean).join(', ') || `Address ${a.address_id}`;
      addNode(aid, 'Address', label);
      if (a.business_partner_id) {
        addEdge(`C_${a.business_partner_id}`, aid, 'HAS_ADDRESS');
      }
    });

    // 2. Orders & Customer → Order edges
    const orders = await dbService.executeReadOnlyQuery(
      `SELECT sales_order_id, business_partner_id FROM sales_order_headers LIMIT 50`
    );
    orders.forEach(o => {
      const oid = `O_${o.sales_order_id}`;
      addNode(oid, 'Order', `Order ${o.sales_order_id}`);
      if (o.business_partner_id) {
        addEdge(`C_${o.business_partner_id}`, oid, 'PLACED');
      }
    });

    // 3. Products & Order → Product edges (product_id is the correct column, not material_id)
    const items = await dbService.executeReadOnlyQuery(
      `SELECT sales_order_id, product_id FROM sales_order_items LIMIT 100`
    );
    items.forEach(i => {
      const pid = `P_${i.product_id}`;
      addNode(pid, 'Product', `Product ${i.product_id}`);
      addEdge(`O_${i.sales_order_id}`, pid, 'CONTAINS');
    });

    // 4. Deliveries & Order → Delivery edges
    const deliveries = await dbService.executeReadOnlyQuery(
      `SELECT delivery_id, sales_order_id FROM outbound_delivery_headers LIMIT 50`
    );
    deliveries.forEach(d => {
      const did = `D_${d.delivery_id}`;
      addNode(did, 'Delivery', `Delivery ${d.delivery_id}`);
      if (d.sales_order_id) {
        addEdge(`O_${d.sales_order_id}`, did, 'DELIVERED_BY');
      }
    });

    // 5. Invoices (billing documents) & Delivery → Invoice edges
    const invoices = await dbService.executeReadOnlyQuery(
      `SELECT billing_document_id, delivery_id, sales_order_id FROM billing_document_headers LIMIT 50`
    );
    invoices.forEach(inv => {
      const iid = `I_${inv.billing_document_id}`;
      addNode(iid, 'Invoice', `Invoice ${inv.billing_document_id}`);
      if (inv.delivery_id) {
        addEdge(`D_${inv.delivery_id}`, iid, 'BILLED_BY');
      } else if (inv.sales_order_id) {
        // Fallback: link Invoice directly to Order if no delivery
        addEdge(`O_${inv.sales_order_id}`, iid, 'BILLED_BY');
      }
    });

    // 6. Journal Entries & Invoice → JournalEntry edges
    const journals = await dbService.executeReadOnlyQuery(
      `SELECT journal_entry_id, billing_document_id FROM journal_entry_items_accounts_receivable LIMIT 50`
    );
    journals.forEach(j => {
      const jid = `JE_${j.journal_entry_id}`;
      addNode(jid, 'JournalEntry', `JE ${j.journal_entry_id}`);
      if (j.billing_document_id) {
        addEdge(`I_${j.billing_document_id}`, jid, 'RECORDED_IN');
      }
    });

    // 7. Payments & Invoice → Payment and JournalEntry → Payment edges
    const payments = await dbService.executeReadOnlyQuery(
      `SELECT payment_id, journal_entry_id FROM payments_accounts_receivable LIMIT 50`
    );
    payments.forEach(p => {
      const payid = `PAY_${p.payment_id}`;
      addNode(payid, 'Payment', `Payment ${p.payment_id}`);
      if (p.journal_entry_id) {
        addEdge(`JE_${p.journal_entry_id}`, payid, 'PAID_BY');
      }
    });

    console.log(`[GraphBuilder] Built graph: ${nodes.length} nodes, ${edges.length} edges`);
    return { nodes, edges };

  } catch (err) {
    console.error('[GraphBuilder] Error building graph:', err.message);
    throw err;
  }
};
