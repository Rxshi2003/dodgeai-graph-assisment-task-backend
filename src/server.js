const envConfig = require('./config/env');
const express = require('express');
const cors = require('cors');
const queryRoutes = require('./routes/query.route');

const app = express();
const PORT = envConfig.PORT;

// Middleware
app.use(cors());
app.use(express.json());

// Request logging middleware for better debugging
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Routes
app.use('/', queryRoutes);

// 404 handler for undefined routes
app.use((req, res, next) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled Error:', err.stack);
  res.status(500).json({ error: 'Internal Server Error' });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Backend server is running on http://localhost:${PORT}`);
});
