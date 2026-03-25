// =============================================================================
// Neo4j Cypher Queries — DodgeAI Graph Schema
// Entities: Customer, Order, Product, Delivery, Invoice, Payment
// =============================================================================


// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1 — CONSTRAINTS & INDEXES (run once before ingestion)
// ─────────────────────────────────────────────────────────────────────────────

CREATE CONSTRAINT customer_id  IF NOT EXISTS FOR (c:Customer)  REQUIRE c.id IS UNIQUE;
CREATE CONSTRAINT order_id     IF NOT EXISTS FOR (o:Order)     REQUIRE o.id IS UNIQUE;
CREATE CONSTRAINT product_id   IF NOT EXISTS FOR (p:Product)   REQUIRE p.id IS UNIQUE;
CREATE CONSTRAINT delivery_id  IF NOT EXISTS FOR (d:Delivery)  REQUIRE d.id IS UNIQUE;
CREATE CONSTRAINT invoice_id   IF NOT EXISTS FOR (i:Invoice)   REQUIRE i.id IS UNIQUE;
CREATE CONSTRAINT payment_id   IF NOT EXISTS FOR (pay:Payment) REQUIRE pay.id IS UNIQUE;


// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 — CREATE QUERIES  (fresh graph, no duplicate checking)
// ─────────────────────────────────────────────────────────────────────────────

// --- Nodes ---

CREATE (:Customer {
  id:       'C_310000108',
  name:     'Cardenas, Parker and Avila',
  category: '2'
});

CREATE (:Order {
  id:           'O_740506',
  type:         'OR',
  currency:     'INR',
  deliveryDate: '2025-03-31'
});

CREATE (:Product {
  id:          'P_S8907367001003',
  description: 'WB-CG CHARCOAL GANG',
  group:       'ZFG1001'
});

CREATE (:Delivery {
  id:          'D_80737721',
  shippingPnt: '1920',
  pickStatus:  'C'
});

CREATE (:Invoice {
  id:         'I_90504248',
  type:       'F2',
  netAmount:  216.10,
  currency:   'INR',
  fiscalYear: '2025'
});

CREATE (:Payment {
  id:          'PAY_9400000220',
  amount:      897.03,
  currency:    'INR',
  clearDate:   '2025-04-02',
  fiscalYear:  '2025'
});

// --- Relationships ---

MATCH (o:Order {id: 'O_740506'}),     (c:Customer {id: 'C_310000108'})
CREATE (o)-[:PLACED_BY]->(c);

MATCH (o:Order {id: 'O_740506'}),     (p:Product {id: 'P_S8907367001003'})
CREATE (o)-[:CONTAINS {quantity: 48, unit: 'PC', netAmount: 9966.10}]->(p);

MATCH (o:Order {id: 'O_740506'}),     (d:Delivery {id: 'D_80737721'})
CREATE (o)-[:HAS_DELIVERY]->(d);

MATCH (d:Delivery {id: 'D_80737721'}), (i:Invoice {id: 'I_90504248'})
CREATE (d)-[:HAS_INVOICE]->(i);

MATCH (i:Invoice {id: 'I_90504248'}),  (pay:Payment {id: 'PAY_9400000220'})
CREATE (i)-[:HAS_PAYMENT]->(pay);


// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3 — MERGE QUERIES  (idempotent — safe to run repeatedly)
// Use these for bulk ingestion from the JSONL dataset.
// ─────────────────────────────────────────────────────────────────────────────

// --- Upsert Nodes ---

MERGE (c:Customer { id: $customerId })
ON CREATE SET
  c.name     = $name,
  c.category = $category,
  c.createdAt = datetime()
ON MATCH SET
  c.name     = $name;

MERGE (o:Order { id: $orderId })
ON CREATE SET
  o.type         = $orderType,
  o.currency     = $currency,
  o.deliveryDate = $deliveryDate,
  o.createdAt    = datetime()
ON MATCH SET
  o.currency     = $currency;

MERGE (p:Product { id: $productId })
ON CREATE SET
  p.description = $description,
  p.group       = $materialGroup,
  p.createdAt   = datetime();

MERGE (d:Delivery { id: $deliveryId })
ON CREATE SET
  d.shippingPoint = $shippingPoint,
  d.pickStatus    = $pickStatus,
  d.createdAt     = datetime();

MERGE (i:Invoice { id: $invoiceId })
ON CREATE SET
  i.type       = $invoiceType,
  i.netAmount  = toFloat($netAmount),
  i.currency   = $currency,
  i.fiscalYear = $fiscalYear,
  i.createdAt  = datetime()
ON MATCH SET
  i.netAmount  = toFloat($netAmount);

MERGE (pay:Payment { id: $paymentId })
ON CREATE SET
  pay.amount     = toFloat($amount),
  pay.currency   = $currency,
  pay.clearDate  = $clearDate,
  pay.fiscalYear = $fiscalYear,
  pay.createdAt  = datetime();

// --- Upsert Relationships ---

// (:Order)-[:PLACED_BY]->(:Customer)
MATCH (o:Order    { id: $orderId }),
      (c:Customer { id: $customerId })
MERGE (o)-[:PLACED_BY]->(c);

// (:Order)-[:CONTAINS]->(:Product)
MATCH (o:Order   { id: $orderId }),
      (p:Product { id: $productId })
MERGE (o)-[r:CONTAINS]->(p)
ON CREATE SET
  r.quantity  = toInteger($quantity),
  r.unit      = $unit,
  r.netAmount = toFloat($netAmount);

// (:Order)-[:HAS_DELIVERY]->(:Delivery)
MATCH (o:Order    { id: $orderId }),
      (d:Delivery { id: $deliveryId })
MERGE (o)-[:HAS_DELIVERY]->(d);

// (:Delivery)-[:HAS_INVOICE]->(:Invoice)
MATCH (d:Delivery { id: $deliveryId }),
      (i:Invoice  { id: $invoiceId })
MERGE (d)-[:HAS_INVOICE]->(i);

// (:Invoice)-[:HAS_PAYMENT]->(:Payment)
MATCH (i:Invoice  { id: $invoiceId }),
      (pay:Payment { id: $paymentId })
MERGE (i)-[:HAS_PAYMENT]->(pay);


// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4 — USEFUL READ QUERIES
// ─────────────────────────────────────────────────────────────────────────────

// Full order journey: Order → Delivery → Invoice → Payment
MATCH path = (o:Order)-[:HAS_DELIVERY]->(d:Delivery)
                       -[:HAS_INVOICE]->(i:Invoice)
                       -[:HAS_PAYMENT]->(pay:Payment)
RETURN o.id AS order, d.id AS delivery, i.id AS invoice,
       i.netAmount AS invoiceAmount, pay.id AS payment
ORDER BY o.id;

// All orders placed by a specific customer
MATCH (c:Customer {id: $customerId})<-[:PLACED_BY]-(o:Order)
RETURN o.id AS orderId, o.type, o.deliveryDate
ORDER BY o.deliveryDate DESC;

// All products in an order
MATCH (o:Order {id: $orderId})-[r:CONTAINS]->(p:Product)
RETURN p.id, p.description, r.quantity, r.unit, r.netAmount;

// Customer 360 view
MATCH (c:Customer {id: $customerId})<-[:PLACED_BY]-(o:Order)
OPTIONAL MATCH (o)-[:HAS_DELIVERY]->(d:Delivery)
OPTIONAL MATCH (d)-[:HAS_INVOICE]->(i:Invoice)
OPTIONAL MATCH (i)-[:HAS_PAYMENT]->(pay:Payment)
RETURN c.name,
       count(DISTINCT o)   AS totalOrders,
       count(DISTINCT i)   AS totalInvoices,
       sum(i.netAmount)    AS totalBilled,
       count(DISTINCT pay) AS totalPayments;
