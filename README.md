# 🚀 DodgeAI Graph System — Backend

## 📌 Overview

This backend powers the DodgeAI Graph-Based Query System. It converts natural language queries into structured database queries using an LLM and executes them on a graph-based dataset.

🔗 **Frontend Repository:**
https://github.com/Rxshi2003/dodgeai-graph-assisment-task

---

## 🏗️ Architecture Decisions

### 1. Layered Architecture

* **Controller Layer**

  * Handles incoming API requests

* **Service Layer**

  * LLM interaction
  * Query generation

* **Database Layer**

  * Executes structured queries

---

### 2. Graph-Based Data Modeling

* Data represented as:

  * **Nodes** → Entities (Products, Orders, Customers)
  * **Edges** → Relationships

* Enables:

  * Complex relationship queries
  * Better semantic understanding

---

### 3. LLM Integration

* LLM used to:

  * Interpret natural language queries
  * Generate structured queries (SQL/Graph queries)

---

## 🗄️ Database Choice

### Why Graph-Based Approach?

* Handles relationships efficiently
* Suitable for:

  * Supply chain data
  * Order tracking
  * Entity connections

### Implementation

* MySQL used as base database
* Logical graph constructed in backend
* Relationships mapped programmatically

---

## 🧠 LLM Prompting Strategy

### 1. Structured Prompting

* System prompt defines:

  * Schema
  * Allowed queries
  * Output format

### 2. Controlled Output

* LLM forced to return:

  * SQL queries only
  * No explanations

### 3. Example-Based Prompting

* Few-shot examples included:

  * Improves accuracy
  * Reduces hallucination

---

## 🛡️ Guardrails

### 1. Query Validation

* Only SELECT queries allowed
* No destructive operations (DELETE, DROP)

### 2. Sanitization

* Prevent SQL injection
* Validate generated queries

### 3. Error Handling

* LLM failure fallback
* Database error handling

### 4. Rate Limiting (Optional)

* Prevent abuse

---

## 🔄 Request Flow

1. User sends query from frontend
2. Controller receives request
3. LLM converts query → SQL
4. SQL executed on database
5. Result returned to frontend

---

## ⚙️ Setup Instructions

```bash id="8gk6wf"
git clone https://github.com/Rxshi2003/dodgeai-graph-assisment-task-backend.git
cd dodgeai-graph-assisment-task-backend
npm install
npm start
```

---

## 🌐 Environment Variables

Create `.env` file:

```env id="2ytsb2"
PORT=3001
DB_HOST=your_host
DB_USER=your_user
DB_PASSWORD=your_password
DB_NAME=your_database
LLM_API_KEY=your_api_key
```

---

## 🚀 Deployment

* Hosted on **Render**
* Add environment variables
* Deploy as Web Service

---

## 📌 Key Features

* Natural language to SQL conversion
* Graph-based data understanding
* LLM-powered query engine
* Secure query execution

---

## 📷 Future Improvements

* True graph database (Neo4j)
* Query caching
* Streaming responses
* Multi-LLM fallback system

---
