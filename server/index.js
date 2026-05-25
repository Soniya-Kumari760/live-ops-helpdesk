require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { Pool } = require('pg');

// --- Database connection ---
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

// --- Express + Socket.IO setup ---
const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

// --- Lock manager (memory mein) ---
const ticketLocks = {}; 
// format: { ticketId: { agentId, agentName, lockedAt } }

// --- REST API Routes ---

// Sabhi tickets lao
app.get('/api/tickets', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM tickets ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Ek ticket lao
app.get('/api/tickets/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM tickets WHERE id = $1',
      [req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Ticket update karo
app.put('/api/tickets/:id', async (req, res) => {
  const { title, description, status, priority } = req.body;
  try {
    const result = await pool.query(
      `UPDATE tickets 
       SET title=$1, description=$2, status=$3, priority=$4, updated_at=NOW()
       WHERE id=$5 RETURNING *`,
      [title, description, status, priority, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Sabhi agents lao
app.get('/api/agents', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM agents');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Socket.IO real-time events ---
io.on('connection', (socket) => {
  console.log(`Agent connected: ${socket.id}`);

  // Jab agent connect ho, sabhi current locks bhejo
  socket.emit('all_locks', ticketLocks);

  // Ticket lock karo
  socket.on('lock_ticket', ({ ticketId, agentId, agentName }) => {
    if (!ticketLocks[ticketId]) {
      ticketLocks[ticketId] = { agentId, agentName, lockedAt: new Date() };
      io.emit('ticket_locked', { ticketId, agentId, agentName });
      console.log(`Ticket ${ticketId} locked by ${agentName}`);
    }
  });

  // Ticket unlock karo
  socket.on('unlock_ticket', ({ ticketId, agentId }) => {
    if (ticketLocks[ticketId]?.agentId === agentId) {
      delete ticketLocks[ticketId];
      io.emit('ticket_unlocked', { ticketId });
      console.log(`Ticket ${ticketId} unlocked`);
    }
  });

  // Agent disconnect hone par uske saare locks hatao
  socket.on('disconnect', () => {
    console.log(`Agent disconnected: ${socket.id}`);
  });
});

// --- Server start karo ---
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});