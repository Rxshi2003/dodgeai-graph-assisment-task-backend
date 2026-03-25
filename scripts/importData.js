const fs = require('fs');
const path = require('path');
const readline = require('readline');
const db = require('../src/services/db.service');
const pool = db.pool;

// 2. Process a single JSONL file line-by-line
async function processJsonlFile(filePath, tableName) {
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity // Handle all variations of carriage returns
  });

  const client = await pool.connect();
  let successCount = 0;
  let errorCount = 0;

  try {
    // Start a transaction for bulk performance and safety
    await client.query('BEGIN');

    for await (const line of rl) {
      if (!line.trim()) continue;

      try {
        const record = JSON.parse(line);
        const columns = Object.keys(record);
        const values = Object.values(record);

        // Build dynamic parameterized INSERT query
        const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
        const query = `
          INSERT INTO ${tableName} (${columns.join(', ')}) 
          VALUES (${placeholders}) 
          ON CONFLICT DO NOTHING
        `;

        await client.query(query, values);
        successCount++;
      } catch (err) {
        console.error(`⚠️ Skipping line in ${tableName}: ${err.message}`);
        errorCount++;
      }
    }

    await client.query('COMMIT');
    console.log(`✅ Loaded ${successCount} records into '${tableName}' (${errorCount} errors)`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`❌ Transaction completely failed for ${tableName}:`, err.message);
  } finally {
    client.release();
  }
}

// 3. Orchestrate finding folders and files
async function loadAllData(dataDir) {
  try {
    // Check if data directory actually exists
    if (!fs.existsSync(dataDir)) {
      throw new Error(`Data directory not found at: ${dataDir}`);
    }

    const folders = await fs.promises.readdir(dataDir, { withFileTypes: true });

    for (const folder of folders) {
      if (!folder.isDirectory()) continue;

      const tableName = folder.name; // Use folder name identically as PostgreSQL table name
      const folderPath = path.join(dataDir, folder.name);

      const files = await fs.promises.readdir(folderPath);
      const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));

      if (jsonlFiles.length === 0) {
        console.log(`⏭️  Skipping '${tableName}' (No .jsonl files found)`);
      }

      for (const file of jsonlFiles) {
        const filePath = path.join(folderPath, file);
        console.log(`⏳ Processing: ${tableName} -> ${file}`);
        await processJsonlFile(filePath, tableName);
      }
    }

    console.log('\n🎉 Complete! All bulk JSONL data inserted successfully!');
  } catch (err) {
    console.error('\n💥 Master script failed:', err.message);
  } finally {
    await pool.end(); // close DB connection pool
  }
}

// 4. Run the Script 
// Adjust the path to wherever your /data folder lives
const absoluteDataPath = path.resolve(__dirname, '../data');
loadAllData(absoluteDataPath);
