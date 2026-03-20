require('dotenv').config();
const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// ── Database setup 
const db = new Database('skybook.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT,
    date TEXT,
    time TEXT,
    instructor TEXT,
    aircraft TEXT,
    booked_by TEXT,
    status TEXT DEFAULT 'available'
  );

  CREATE TABLE IF NOT EXISTS instructors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    rating TEXT,
    available INTEGER DEFAULT 1
  );
`);

// ── Seed sample data if database is empty 
const count = db.prepare('SELECT COUNT(*) as c FROM slots').get();
if (count.c === 0) {
  const ins = db.prepare(
    `INSERT INTO slots (type,date,time,instructor,aircraft,status)
     VALUES (?,?,?,?,?,?)`
  );
  ins.run('flight','2026-03-25','09:00','Capt. James','G-ABCD','available');
  ins.run('flight','2026-03-25','11:00','Capt. Sarah','G-EFGH','available');
  ins.run('flight','2026-03-26','14:00','Capt. James','G-ABCD','available');
  ins.run('exam',  '2026-03-27','10:00','Examiner Brown','Room A','available');
  ins.run('exam',  '2026-03-28','13:00','Examiner Lee','Room B','available');

  db.prepare(`INSERT INTO instructors (name,rating) VALUES (?,?)`).run('Capt. James','CPL');
  db.prepare(`INSERT INTO instructors (name,rating) VALUES (?,?)`).run('Capt. Sarah','PPL');
}

// ── Routes ─────────────────────────────────────────────────────

app.get('/api/slots/flights', (req, res) => {
  const slots = db.prepare(
    `SELECT * FROM slots WHERE type='flight' AND status='available'`
  ).all();
  res.json(slots);
});

app.get('/api/slots/exams', (req, res) => {
  const slots = db.prepare(
    `SELECT * FROM slots WHERE type='exam' AND status='available'`
  ).all();
  res.json(slots);
});

app.post('/api/book', (req, res) => {
  const { userId, slotId } = req.body;
  const slot = db.prepare(`SELECT * FROM slots WHERE id=?`).get(slotId);

  if (!slot || slot.status !== 'available') {
    return res.json({ success: false, message: 'Slot no longer available' });
  }

  db.prepare(
    `UPDATE slots SET status='booked', booked_by=? WHERE id=?`
  ).run(userId, slotId);

  res.json({
    success: true,
    message: `Booked! ${slot.type} on ${slot.date} at ${slot.time} with ${slot.instructor}`
  });
});

app.get('/api/instructors/schedule', (req, res) => {
  const instructors = db.prepare(`SELECT * FROM instructors`).all();
  const result = instructors.map(i => {
    const booked = db.prepare(
      `SELECT date, time FROM slots WHERE instructor=? AND status='booked'`
    ).all(i.name);
    const avail = db.prepare(
      `SELECT COUNT(*) as c FROM slots WHERE instructor=? AND status='available'`
    ).get(i.name);
    return {
      ...i,
      bookedSlots: booked.map(s => `${s.date} ${s.time}`),
      availableSlots: avail.c
    };
  });
  res.json(result);
});

app.post('/api/ai/book', async (req, res) => {
  const { userId, message, history = [] } = req.body;

  const flightSlots = db.prepare(
    `SELECT * FROM slots WHERE type='flight' AND status='available'`
  ).all();
  const examSlots = db.prepare(
    `SELECT * FROM slots WHERE type='exam' AND status='available'`
  ).all();

  const systemPrompt = `You are SkyBook AI, a friendly flight school booking assistant.

Available flight slots: ${JSON.stringify(flightSlots)}
Available exam slots: ${JSON.stringify(examSlots)}

When a student asks to book, find the best matching slot.
Always respond with valid JSON only, no markdown, no extra text:

If just chatting:
{"reply": "your message here", "booking": null}

If you found a slot to book:
{"reply": "your message confirming the slot", "booking": {"slotId": 1, "type": "flight", "date": "2026-03-25", "time": "09:00", "instructor": "Capt. James"}}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 500,
        system: systemPrompt,
        messages: [
          ...history.map(h => ({
            role: h.role === 'agent' ? 'assistant' : 'user',
            content: h.content
          })),
          { role: 'user', content: message }
        ]
      })
    });

    const data = await response.json();
    const text = data.content[0].text;
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    res.json(parsed);

  } catch (err) {
    console.error(err);
    res.json({ reply: "Sorry, I couldn't process that. Please try again.", booking: null });
  }
});

app.post('/api/cancel', (req, res) => {
  const { userId, slotId } = req.body;
  const slot = db.prepare(`SELECT * FROM slots WHERE id=?`).get(slotId);

  if (!slot) {
    return res.json({ success: false, message: 'Slot not found' });
  }

  if (slot.booked_by !== userId) {
    return res.json({ success: false, message: 'You can only cancel your own bookings' });
  }

  db.prepare(
    `UPDATE slots SET status='available', booked_by=NULL WHERE id=?`
  ).run(slotId);

  res.json({ success: true, message: `Booking cancelled for ${slot.date} at ${slot.time}` });
});


// ── Start server ───────────────────────────────────────────────
app.listen(3000, () => {
    
  console.log('✅ SkyBook server running on http://localhost:3000');
});