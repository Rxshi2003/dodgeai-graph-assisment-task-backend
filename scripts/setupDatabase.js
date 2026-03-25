const db = require('../src/services/db.service');
const pool = db.pool;

// 2. Sequential SQL Queries (Ordered by dependencies)
const queries = [
  {
    name: 'business_partners',
    sql: `CREATE TABLE IF NOT EXISTS business_partners (
        business_partner_id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(255),
        partner_type VARCHAR(50),
        created_at TIMESTAMP
    );`
  },
  {
    name: 'business_partner_addresses',
    sql: `CREATE TABLE IF NOT EXISTS business_partner_addresses (
        address_id VARCHAR(50) PRIMARY KEY,
        business_partner_id VARCHAR(50) REFERENCES business_partners(business_partner_id),
        address_line_1 VARCHAR(255),
        city VARCHAR(100),
        country VARCHAR(100),
        postal_code VARCHAR(20)
    );`
  },
  {
    name: 'customer_company_assignments',
    sql: `CREATE TABLE IF NOT EXISTS customer_company_assignments (
        assignment_id VARCHAR(50) PRIMARY KEY,
        business_partner_id VARCHAR(50) REFERENCES business_partners(business_partner_id),
        company_code VARCHAR(50),
        assigned_at TIMESTAMP
    );`
  },
  {
    name: 'customer_sales_area_assignments',
    sql: `CREATE TABLE IF NOT EXISTS customer_sales_area_assignments (
        assignment_id VARCHAR(50) PRIMARY KEY,
        business_partner_id VARCHAR(50) REFERENCES business_partners(business_partner_id),
        sales_organization VARCHAR(50),
        distribution_channel VARCHAR(50),
        division VARCHAR(50)
    );`
  },
  {
    name: 'products',
    sql: `CREATE TABLE IF NOT EXISTS products (
        product_id VARCHAR(50) PRIMARY KEY,
        category VARCHAR(100),
        base_unit VARCHAR(20),
        created_at TIMESTAMP
    );`
  },
  {
    name: 'product_descriptions',
    sql: `CREATE TABLE IF NOT EXISTS product_descriptions (
        description_id VARCHAR(50) PRIMARY KEY,
        product_id VARCHAR(50) REFERENCES products(product_id),
        language_code VARCHAR(10),
        description VARCHAR(255)
    );`
  },
  {
    name: 'plants',
    sql: `CREATE TABLE IF NOT EXISTS plants (
        plant_id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(255),
        city VARCHAR(100),
        country VARCHAR(100)
    );`
  },
  {
    name: 'product_plants',
    sql: `CREATE TABLE IF NOT EXISTS product_plants (
        product_plant_id VARCHAR(50) PRIMARY KEY,
        product_id VARCHAR(50) REFERENCES products(product_id),
        plant_id VARCHAR(50) REFERENCES plants(plant_id)
    );`
  },
  {
    name: 'product_storage_locations',
    sql: `CREATE TABLE IF NOT EXISTS product_storage_locations (
        storage_location_id VARCHAR(50) PRIMARY KEY,
        product_plant_id VARCHAR(50) REFERENCES product_plants(product_plant_id),
        name VARCHAR(100)
    );`
  },
  {
    name: 'sales_order_headers',
    sql: `CREATE TABLE IF NOT EXISTS sales_order_headers (
        sales_order_id VARCHAR(50) PRIMARY KEY,
        business_partner_id VARCHAR(50) REFERENCES business_partners(business_partner_id),
        order_date DATE,
        total_amount DECIMAL(15, 2),
        currency VARCHAR(10),
        status VARCHAR(50)
    );`
  },
  {
    name: 'sales_order_items',
    sql: `CREATE TABLE IF NOT EXISTS sales_order_items (
        sales_order_item_id VARCHAR(50) PRIMARY KEY,
        sales_order_id VARCHAR(50) REFERENCES sales_order_headers(sales_order_id),
        product_id VARCHAR(50) REFERENCES products(product_id),
        plant_id VARCHAR(50) REFERENCES plants(plant_id),
        quantity DECIMAL(15, 2),
        unit_price DECIMAL(15, 2),
        net_amount DECIMAL(15, 2)
    );`
  },
  {
    name: 'outbound_delivery_headers',
    sql: `CREATE TABLE IF NOT EXISTS outbound_delivery_headers (
        delivery_id VARCHAR(50) PRIMARY KEY,
        sales_order_id VARCHAR(50) REFERENCES sales_order_headers(sales_order_id),
        business_partner_id VARCHAR(50) REFERENCES business_partners(business_partner_id),
        delivery_date DATE,
        status VARCHAR(50)
    );`
  },
  {
    name: 'outbound_delivery_items',
    sql: `CREATE TABLE IF NOT EXISTS outbound_delivery_items (
        delivery_item_id VARCHAR(50) PRIMARY KEY,
        delivery_id VARCHAR(50) REFERENCES outbound_delivery_headers(delivery_id),
        sales_order_item_id VARCHAR(50) REFERENCES sales_order_items(sales_order_item_id),
        product_id VARCHAR(50) REFERENCES products(product_id),
        delivered_quantity DECIMAL(15, 2)
    );`
  },
  {
    name: 'billing_document_headers',
    sql: `CREATE TABLE IF NOT EXISTS billing_document_headers (
        billing_document_id VARCHAR(50) PRIMARY KEY,
        sales_order_id VARCHAR(50) REFERENCES sales_order_headers(sales_order_id),
        delivery_id VARCHAR(50) REFERENCES outbound_delivery_headers(delivery_id),
        business_partner_id VARCHAR(50) REFERENCES business_partners(business_partner_id),
        billing_date DATE,
        total_amount DECIMAL(15, 2),
        currency VARCHAR(10),
        status VARCHAR(50)
    );`
  },
  {
    name: 'billing_document_items',
    sql: `CREATE TABLE IF NOT EXISTS billing_document_items (
        billing_item_id VARCHAR(50) PRIMARY KEY,
        billing_document_id VARCHAR(50) REFERENCES billing_document_headers(billing_document_id),
        delivery_item_id VARCHAR(50) REFERENCES outbound_delivery_items(delivery_item_id),
        product_id VARCHAR(50) REFERENCES products(product_id),
        billed_quantity DECIMAL(15, 2),
        net_amount DECIMAL(15, 2)
    );`
  },
  {
    name: 'billing_document_cancellations',
    sql: `CREATE TABLE IF NOT EXISTS billing_document_cancellations (
        cancellation_id VARCHAR(50) PRIMARY KEY,
        billing_document_id VARCHAR(50) REFERENCES billing_document_headers(billing_document_id),
        reason VARCHAR(255),
        cancellation_date DATE
    );`
  },
  {
    name: 'journal_entry_items_accounts_receivable',
    sql: `CREATE TABLE IF NOT EXISTS journal_entry_items_accounts_receivable (
        journal_entry_id VARCHAR(50) PRIMARY KEY,
        billing_document_id VARCHAR(50) REFERENCES billing_document_headers(billing_document_id),
        business_partner_id VARCHAR(50) REFERENCES business_partners(business_partner_id),
        posting_date DATE,
        amount DECIMAL(15, 2),
        currency VARCHAR(10)
    );`
  },
  {
    name: 'payments_accounts_receivable',
    sql: `CREATE TABLE IF NOT EXISTS payments_accounts_receivable (
        payment_id VARCHAR(50) PRIMARY KEY,
        journal_entry_id VARCHAR(50) REFERENCES journal_entry_items_accounts_receivable(journal_entry_id),
        business_partner_id VARCHAR(50) REFERENCES business_partners(business_partner_id),
        payment_date DATE,
        cleared_amount DECIMAL(15, 2),
        currency VARCHAR(10)
    );`
  }
];

// 3. Execution Function
async function setupDatabase() {
  const client = await pool.connect();

  try {
    console.log('Starting PostgreSQL schema setup...\n');

    // Execute sequentially
    for (const query of queries) {
      try {
        await client.query(query.sql);
        console.log(`✅ SUCCESS: Table '${query.name}' created (or already exists).`);
      } catch (error) {
        console.error(`❌ ERROR: Failed creating table '${query.name}'.`);
        console.error(`   Details: ${error.message}\n`);

        // Stop execution on failure to prevent foreign key errors down the line
        throw new Error(`Execution aborted at table ${query.name}`);
      }
    }

    console.log('\n🎉 All tables successfully created and verified!');

  } catch (error) {
    console.error('\n⚠️ Database Setup Failed:', error.message);
  } finally {
    client.release(); // release the client back to the pool
    await pool.end(); // close the pool cleanly so the Node script exits
  }
}

// 4. Run the script
setupDatabase();
