const express = require('express');
const { handleQuery, handleGetGraph, handleLocalQuery, handleReloadGraph } = require('../controllers/query.controller');

const router = express.Router();

// POST /query       — LLM-powered natural language graph traversal
router.post('/query', handleQuery);

// POST /query-local — Rule-based translate → execute → format (no LLM)
router.post('/query-local', handleLocalQuery);

// GET  /graph       — Return raw graph structure (for pre-load and debugging)
router.get('/graph', handleGetGraph);

// POST /graph/reload — Invalidate in-memory cache, re-read all JSONL files
router.post('/graph/reload', handleReloadGraph);

module.exports = router;
