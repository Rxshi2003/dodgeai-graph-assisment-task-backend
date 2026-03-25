const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const config = {
  // LLM Config
  GROK_API_KEY: process.env.GROK_API_KEY,
  API_BASE_URL: process.env.API_BASE_URL,
  MODEL_NAME: process.env.MODEL_NAME,
  
  // App Config
  PORT: process.env.PORT || 3001,
  
  // Database Config
  DB_USER: process.env.DB_USER,
  DB_PASSWORD: process.env.DB_PASSWORD,
  DB_HOST: process.env.DB_HOST,
  DB_PORT: process.env.DB_PORT,
  DB_NAME: process.env.DB_NAME,
};

// Validate required environment variables
const requiredConfig = ['GROK_API_KEY', 'API_BASE_URL', 'MODEL_NAME', 'DB_USER', 'DB_PASSWORD', 'DB_HOST', 'DB_PORT', 'DB_NAME'];
const missingConfig = requiredConfig.filter((key) => !config[key]);

if (missingConfig.length > 0) {
  console.error(`\nCRITICAL STARTUP ERROR: Missing required environment variables: ${missingConfig.join(', ')}`);
  console.error('Please check your .env file and ensure these are defined.\n');
  process.exit(1);
}

module.exports = config;
