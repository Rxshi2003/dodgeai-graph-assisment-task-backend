const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const config = {
  // LLM Config
  GROK_API_KEY: process.env.GROK_API_KEY,
  API_BASE_URL: process.env.API_BASE_URL,
  MODEL_NAME: process.env.MODEL_NAME,

  // App Config
  PORT: process.env.PORT || 3001,

  // Database Config (Render-compatible single connection string)
  DATABASE_URL: process.env.DATABASE_URL,
};

// Validate required environment variables
const requiredConfig = ['GROK_API_KEY', 'API_BASE_URL', 'MODEL_NAME', 'DATABASE_URL'];
const missingConfig = requiredConfig.filter((key) => !config[key]);

if (missingConfig.length > 0) {
  console.error(`\nCRITICAL STARTUP ERROR: Missing required environment variables: ${missingConfig.join(', ')}`);
  console.error('Please check your .env file and ensure these are defined.\n');
  process.exit(1);
}

module.exports = config;
