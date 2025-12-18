import express from "express";
import cors from "cors";
import Database from "better-sqlite3";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// === CONFIG ===
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const DB_PATH = path.join(__dirname, "santa.db");

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(PUBLIC_DIR));

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

// === DB INIT ===
db.exec(`
CREATE TABLE IF NOT EXISTS rooms (
  code TEXT PRIMARY KEY,
  admin_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS participants (
  id TEXT PRIMARY KEY,
  room_code TEXT NOT NULL,
  name TEXT NOT NULL,
  desc TEXT NOT NULL,
  participant_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(room_code) REFERENCES rooms(code)
);

CREATE TABLE IF NOT EXISTS assignments (
  room_code TEXT NOT NULL,
  giver_id TEXT NOT NULL UNIQUE,
  receiver_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(room_code) REFERENCES rooms(code),
  FOREIGN KEY(giver_id) REFERENCES participants(id),
  FOREIGN KEY(receiver_id) REFERENCES participants(id)
);
`);

function token(bytes = 16) {
  return crypto.randomBytes(bytes).toString("hex");
}

function normalizeName(s) {
  return String(s ?? "").trim();
}

function requireAdmin(req, roomCode) {
  const auth = req.headers.authorization || "";
  const key = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const room = db.prepare("SELECT * FROM rooms WHERE code=?").get(roomCode);
  if (!room) return { ok: false, status: 404, msg: "Room not found" };
  if (!key || key !== room.admin_key) return { ok: false, status: 401, msg: "Admin unauthorized" };
  return { ok: true, room };
}

function getParticipantByKey(roomCode, participantKey) {
  return db.prepare(
    "SELECT * FROM participants WHERE room_code=? AND participant_key=?"
  ).get(roomCode, participantKey);
}

// === DERANGEMENT (no self) ===
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function makeDerangement(ids) {
  if (ids.length < 2) throw new Error("Need at least 2 participants");
  for (let attempt = 0; attempt < 5000; attempt++) {
    const receivers = shuffle(ids);
    let ok = true;
    for (let i = 0; i < ids.length; i++) {
      if (ids[i] === receivers[i]) { ok = false; break; }
    }
    if (ok) return receivers;
  }
  throw new Error("Could not generate derangement");
}

// === API ===

// Create room
app.post("/api/rooms", (req, res) => {
  const code = normalizeName(req.body?.code || "").toUpperCase() || `SS-${token(3).toUpperCase()}`;
  const exists = db.prepare("SELECT code FROM rooms WHERE code=?").get(code);
  if (exists) return res.status(409).json({ error: "Room already exists", code });

  const adminKey = token(16);
  db.prepare("INSERT INTO rooms(code, admin_key, status) VALUES (?,?, 'OPEN')").run(code, adminKey);
  res.json({ code, adminKey, adminUrl: `/admin.html?room=${encodeURIComponent(code)}&admin=${encodeURIComponent(adminKey)}` });
});

// Add one participant (admin)
app.post("/api/rooms/:code/participants", (req, res) => {
  const roomCode = String(req.params.code || "").toUpperCase();
  const gate = requireAdmin(req, roomCode);
  if (!gate.ok) return res.status(gate.status).json({ error: gate.msg });

  if (gate.room.status !== "OPEN") return res.status(400).json({ error: "Room is not OPEN (already drawn)" });

  const name = normalizeName(req.body?.name);
  const desc = normalizeName(req.body?.desc);
  if (!name || !desc) return res.status(400).json({ error: "name and desc required" });

  // unique name in room (case-insensitive)
  const existing = db.prepare("SELECT 1 FROM participants WHERE room_code=? AND lower(name)=lower(?)").get(roomCode, name);
  if (existing) return res.status(409).json({ error: "Participant name already exists in this room" });

  const id = token(12);
  const participantKey = token(16);
  db.prepare(
    "INSERT INTO participants(id, room_code, name, desc, participant_key) VALUES (?,?,?,?,?)"
  ).run(id, roomCode, name, desc, participantKey);

  res.json({
    id,
    name,
    desc,
    participantKey,
    link: `/me.html?room=${encodeURIComponent(roomCode)}&key=${encodeURIComponent(participantKey)}`
  });
});

// Import many participants (admin)
app.post("/api/rooms/:code/import", (req, res) => {
  const roomCode = String(req.params.code || "").toUpperCase();
  const gate = requireAdmin(req, roomCode);
  if (!gate.ok) return res.status(gate.status).json({ error: gate.msg });

  if (gate.room.status !== "OPEN") return res.status(400).json({ error: "Room is not OPEN (already drawn)" });

  const lines = Array.isArray(req.body?.lines) ? req.body.lines : [];
  if (!lines.length) return res.status(400).json({ error: "lines[] required" });

  const insert = db.prepare(
    "INSERT INTO participants(id, room_code, name, desc, participant_key) VALUES (?,?,?,?,?)"
  );

  const created = [];
  const tx = db.transaction(() => {
    for (const item of lines) {
      const name = normalizeName(item?.name);
      const desc = normalizeName(item?.desc);
      if (!name || !desc) continue;

      const existing = db.prepare("SELECT 1 FROM participants WHERE room_code=? AND lower(name)=lower(?)").get(roomCode, name);
      if (existing) continue;

      const id = token(12);
      const participantKey = token(16);
      insert.run(id, roomCode, name, desc, participantKey);
      created.push({ name, participantKey });
    }
  });

  tx();

  res.json({
    createdCount: created.length,
    created: created.map(p => ({
      name: p.name,
      link: `/me.html?room=${encodeURIComponent(roomCode)}&key=${encodeURIComponent(p.participantKey)}`
    }))
  });
});

// Admin: list participants + links (and whether draw done)
app.get("/api/rooms/:code/links", (req, res) => {
  const roomCode = String(req.params.code || "").toUpperCase();
  const gate = requireAdmin(req, roomCode);
  if (!gate.ok) return res.status(gate.status).json({ error: gate.msg });

  const people = db.prepare(
    "SELECT id, name, desc, participant_key FROM participants WHERE room_code=? ORDER BY lower(name)"
  ).all(roomCode);

  const status = gate.room.status;
  res.json({
    room: roomCode,
    status,
    participants: people.map(p => ({
      name: p.name,
      desc: p.desc,
      link: `/me.html?room=${encodeURIComponent(roomCode)}&key=${encodeURIComponent(p.participant_key)}`
    }))
  });
});

// Admin: launch draw
app.post("/api/rooms/:code/draw", (req, res) => {
  const roomCode = String(req.params.code || "").toUpperCase();
  const gate = requireAdmin(req, roomCode);
  if (!gate.ok) return res.status(gate.status).json({ error: gate.msg });

  const room = gate.room;
  if (room.status !== "OPEN") return res.json({ room: roomCode, status: room.status, message: "Already drawn" });

  const people = db.prepare("SELECT id FROM participants WHERE room_code=?").all(roomCode);
  if (people.length < 3) return res.status(400).json({ error: "Need at least 3 participants for a fun draw (min 2 technically, but 3 recommended)." });

  const ids = people.map(p => p.id);
  const receivers = makeDerangement(ids);

  const insert = db.prepare("INSERT INTO assignments(room_code, giver_id, receiver_id) VALUES (?,?,?)");
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM assignments WHERE room_code=?").run(roomCode);
    for (let i = 0; i < ids.length; i++) {
      insert.run(roomCode, ids[i], receivers[i]);
    }
    db.prepare("UPDATE rooms SET status='DRAWN' WHERE code=?").run(roomCode);
  });
  tx();

  res.json({ room: roomCode, status: "DRAWN", count: ids.length });
});

// Participant: get my assignment
app.get("/api/rooms/:code/me", (req, res) => {
  const roomCode = String(req.params.code || "").toUpperCase();
  const auth = req.headers.authorization || "";
  const participantKey = auth.startsWith("Bearer ") ? auth.slice(7) : "";

  const room = db.prepare("SELECT code, status FROM rooms WHERE code=?").get(roomCode);
  if (!room) return res.status(404).json({ error: "Room not found" });

  const me = getParticipantByKey(roomCode, participantKey);
  if (!me) return res.status(401).json({ error: "Unauthorized participant" });

  if (room.status !== "DRAWN") {
    return res.json({ room: roomCode, status: room.status, message: "Not drawn yet" });
  }

  const row = db.prepare(`
    SELECT r.name AS receiverName, r.desc AS receiverDesc
    FROM assignments a
    JOIN participants r ON r.id = a.receiver_id
    WHERE a.room_code=? AND a.giver_id=?
  `).get(roomCode, me.id);

  if (!row) return res.status(500).json({ error: "Assignment missing (admin should redraw or check DB)" });

  res.json({
    room: roomCode,
    status: "DRAWN",
    receiverName: row.receiverName,
    receiverDesc: row.receiverDesc
  });
});

app.listen(PORT, () => {
  console.log(`✅ Secret Santa server running on http://localhost:${PORT}`);
  console.log(`➡️ Admin: http://localhost:${PORT}/admin.html`);
});
