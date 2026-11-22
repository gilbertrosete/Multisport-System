const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bcrypt = require('bcrypt'); // Para sa password hashing
const crypto = require('crypto'); // Para sa admin login token
const fs = require('fs');
const path = require('path');
const os = require('os');
const mailer = require('./mail.js'); // Email notices (skipped automatically until mail-config.js is filled in)

const app = express();
app.use(cors());
app.use(express.json({ limit: '8mb' })); // payment screenshots arrive inside the booking request

const COURT_KEYS = ['basketball', 'volleyball', 'tennis', 'badminton'];
const COURT_STATES = ['available', 'maintenance', 'occupied'];
// Price per hour. The server works out the amount itself, so a changed browser value cannot lower the price.
const RATES = { basketball: 500, volleyball: 500, tennis: 500, badminton: 300 };
const BOOKING_STATUSES = ['Pending', 'Approved', 'Rejected', 'Cancelled', 'Cancel Requested', 'Refunded'];
const DEAD_STATUSES = ['Rejected', 'Cancelled', 'Refunded'];   // these do not hold a slot
const TIME_SLOT_CHOICES = ['8:00 AM', '10:00 AM', '12:00 PM', '2:00 PM', '4:00 PM', '6:00 PM', '8:00 PM'];
const PH_PHONE = /^09\d{9}$/;
const EMAIL_OK = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// In-memory failed login attempts tracker.
// 3 wrong passwords lock that email on that device for 5 minutes (the lock lifts by itself).
const loginAttempts = {};
const LOGIN_MAX_TRIES = 3, LOGIN_LOCK_MS = 5 * 60 * 1000;
function clearAttempts(email) {
    Object.keys(loginAttempts).forEach(k => { if (k.split('|')[0] === email) delete loginAttempts[k]; });
}

// MySQL Connection Setup (XAMPP) - dateStrings: true prevents timezone shifts (-1 day bug)
// A connection POOL is used instead of one single connection: if XAMPP/MySQL drops an idle connection
// (or restarts), the pool simply opens a new one, so the server no longer stops with
// "Cannot enqueue Query after fatal error". db.query(...) works exactly the same as before.
const db = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'multisport_db',
    dateStrings: true,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000
});

db.getConnection((err, connection) => {
    if (err) {
        console.error('MySQL Connection Error:', err);
    } else {
        connection.release();
        console.log('Connected to MySQL Database (multisport_db)!');
        setupFacilityStatus();
        setupRescheduleColumns();
    }
});

// ---------------------------------------------------------------
// ONE-AT-A-TIME LOCK (stops double booking)
// A booking is first checked ("is the time free?") and then saved. If two people send the same
// court + date + time at the same moment, both checks could pass before either one is saved.
// withLock makes requests for the SAME court and date wait in line, so the second person's check
// already sees the first person's booking. Other courts / dates are not slowed down.
// The lock is released after saving, and always after 15 seconds at the latest (so it can never get stuck).
// ---------------------------------------------------------------
const bookingLocks = new Map();   // 'court|date' -> promise of the last request in the line
function withLock(key, task) {
    const previous = bookingLocks.get(key) || Promise.resolve();
    const turn = previous.then(() => new Promise((resolve) => {
        let finished = false;
        const release = () => { if (finished) return; finished = true; clearTimeout(timer); resolve(); };
        const timer = setTimeout(release, 15000);
        try { task(release); } catch (e) { console.error('Lock task error:', e); release(); }
    }));
    bookingLocks.set(key, turn);
    turn.then(() => { if (bookingLocks.get(key) === turn) bookingLocks.delete(key); });
}

// ---------------------------------------------------------------
// RATE LIMIT (per visitor address, kept in memory)
// Stops one visitor from flooding the server: spam bookings that fill the calendar, endless "forgot
// password" e-mails, password guessing on many accounts. Normal use never reaches these limits.
// Over the limit -> HTTP 429 with a message the pages already show. To switch it off while testing,
// start the server with  MULTISPORT_NO_RATE_LIMIT=1
// ---------------------------------------------------------------
function rateLimit(max, windowMs, message) {
    const hits = new Map();   // address -> { count, resetAt }
    setInterval(() => {
        const now = Date.now();
        for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
    }, 60 * 1000).unref();
    return (req, res, next) => {
        if (process.env.MULTISPORT_NO_RATE_LIMIT === '1') return next();
        const now = Date.now();
        const key = req.ip || 'unknown';
        let h = hits.get(key);
        if (!h || h.resetAt <= now) { h = { count: 0, resetAt: now + windowMs }; hits.set(key, h); }
        h.count += 1;
        if (h.count > max) {
            const wait = Math.ceil((h.resetAt - now) / 1000);
            res.setHeader('Retry-After', String(wait));
            const mins = Math.ceil(wait / 60);
            return res.status(429).json({ success: false, message: message + ' Please try again in ' + (wait > 90 ? mins + ' minutes.' : wait + ' seconds.') });
        }
        next();
    };
}
const MIN15 = 15 * 60 * 1000;
const limitBooking  = rateLimit(20, MIN15, 'Too many booking attempts from this device.');
const limitAccount  = rateLimit(30, MIN15, 'Too many sign-in or sign-up attempts from this device.');
const limitReset    = rateLimit(8,  MIN15, 'Too many password reset requests from this device.');
const limitLookup   = rateLimit(60, MIN15, 'Too many look-ups from this device.');
const limitRequests = rateLimit(30, MIN15, 'Too many requests from this device.');

// ---------------------------------------------------------------
// ADMIN SESSIONS
// When an admin logs in, the server gives back a random token. Admin-only
// endpoints (change status, remove booking, court status, user count) refuse
// any request that does not carry it. Tokens live in memory, so restarting
// node server.js signs the admin out (just log in again).
// ---------------------------------------------------------------
const adminTokens = new Map(); // token -> expiry time (ms)
const ADMIN_SESSION_MS = 8 * 60 * 60 * 1000; // 8 hours

function issueAdminToken() {
    const token = crypto.randomBytes(32).toString('hex');
    adminTokens.set(token, Date.now() + ADMIN_SESSION_MS);
    return token;
}

function requireAdmin(req, res, next) {
    const header = String(req.headers.authorization || '');
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const expires = token ? adminTokens.get(token) : null;
    if (!expires || expires < Date.now()) {
        if (token) adminTokens.delete(token);
        return res.status(401).json({ success: false, message: 'Admin login required.' });
    }
    next();
}

// Customer sessions work the same way: login gives a token, and "my bookings" only answers to it.
const userTokens = new Map(); // token -> { email, expires }
function issueUserToken(email) {
    const token = crypto.randomBytes(32).toString('hex');
    userTokens.set(token, { email: String(email || '').trim().toLowerCase(), expires: Date.now() + ADMIN_SESSION_MS });
    return token;
}
function requireUser(req, res, next) {
    const header = String(req.headers.authorization || '');
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const entry = token ? userTokens.get(token) : null;
    if (!entry || entry.expires < Date.now()) {
        if (token) userTokens.delete(token);
        return res.status(401).json({ success: false, message: 'Please log in again.' });
    }
    req.userEmail = entry.email;
    next();
}

app.post('/api/admin/logout', (req, res) => {
    const header = String(req.headers.authorization || '');
    if (header.startsWith('Bearer ')) { adminTokens.delete(header.slice(7).trim()); userTokens.delete(header.slice(7).trim()); }
    res.json({ success: true });
});

// ---------------------------------------------------------------
// COURT STATUS (stored in the database so every visitor sees the same thing)
// The table is created automatically the first time the server starts.
// ---------------------------------------------------------------
function setupFacilityStatus() {
    db.query(
        `CREATE TABLE IF NOT EXISTS facility_status (
            facility_key VARCHAR(20) NOT NULL PRIMARY KEY,
            status VARCHAR(20) NOT NULL DEFAULT 'available',
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )`,
        (err) => {
            if (err) return console.error('Court status table error:', err);
            db.query(
                "INSERT IGNORE INTO facility_status (facility_key, status) VALUES ?",
                [COURT_KEYS.map(k => [k, 'available'])],
                (err2) => { if (err2) console.error('Court status seed error:', err2); }
            );
        }
    );
}

// Reschedule requests are stored on the booking itself (the booking stays Approved
// until the admin decides). The columns are added automatically when missing.
function setupRescheduleColumns() {
    const wanted = [
        ['reschedule_date', 'DATE NULL'],
        ['reschedule_time', 'VARCHAR(20) NULL'],
        ['reschedule_count', 'INT NOT NULL DEFAULT 0'],
        ['payment_proof', 'VARCHAR(120) NULL']
    ];
    wanted.forEach(([name, type]) => {
        db.query('SHOW COLUMNS FROM bookings LIKE ?', [name], (err, rows) => {
            if (err) return console.error('Reschedule column check error:', err);
            if (rows.length) return;
            db.query('ALTER TABLE bookings ADD COLUMN ' + name + ' ' + type, (err2) => {
                if (err2) console.error('Could not add column ' + name + ':', err2);
                else console.log('Added bookings.' + name);
            });
        });
    });
}

// ---------------------------------------------------------------
// PAYMENT SCREENSHOTS
// The picture is checked (real JPG/PNG/WebP, not too big) and saved in the uploads folder
// with a random file name. Only the admin can open it again (GET /api/bookings/:id/payment-proof).
// ---------------------------------------------------------------
// Saved OUTSIDE the project folder on purpose: VS Code Live Server reloads the page whenever a file
// inside the project changes, which would close the "Thank you" window right after booking.
// Default: a folder called MultiSport-Uploads in your user folder. Set MULTISPORT_UPLOADS to use another place.
const UPLOAD_DIR = process.env.MULTISPORT_UPLOADS || path.join(os.homedir(), 'MultiSport-Uploads');
const PROOF_MAX_BYTES = 4 * 1024 * 1024;

function readProof(dataUrl) {
    const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
    if (!m) return null;
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length < 200 || buf.length > PROOF_MAX_BYTES) return null;
    const isJpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    const isWebp = buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP';
    if (!(isJpeg || isPng || isWebp)) return null;
    return { buf, ext: isJpeg ? '.jpg' : (isPng ? '.png' : '.webp') };
}

function saveProof(proof, referenceNo) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const safeRef = String(referenceNo || 'booking').replace(/[^A-Za-z0-9-]/g, '').slice(0, 30) || 'booking';
    const name = safeRef + '-' + crypto.randomBytes(8).toString('hex') + proof.ext;
    fs.writeFileSync(path.join(UPLOAD_DIR, name), proof.buf);
    return name;
}

const PROOF_TYPES = { '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

app.get('/api/bookings/:id/payment-proof', requireAdmin, (req, res) => {
    db.query("SELECT payment_proof FROM bookings WHERE id = ? LIMIT 1", [Number(req.params.id)], (err, rows) => {
        if (err) {
            console.error('Proof Lookup Error:', err);
            return res.status(500).json({ success: false, message: 'Database error.' });
        }
        const file = rows && rows[0] && rows[0].payment_proof ? path.basename(String(rows[0].payment_proof)) : '';
        if (!file) return res.status(404).json({ success: false, message: 'No screenshot for this booking.' });
        fs.readFile(path.join(UPLOAD_DIR, file), (readErr, data) => {
            if (readErr) return res.status(404).json({ success: false, message: 'The screenshot file was not found.' });
            res.setHeader('Content-Type', PROOF_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
            res.setHeader('Cache-Control', 'private, max-age=300');
            res.end(data);
        });
    });
});

function courtKeyOf(facilityName) {
    const text = String(facilityName || '').toLowerCase();
    return COURT_KEYS.find(k => text.includes(k)) || null;
}

app.get('/api/facility-status', (req, res) => {
    db.query("SELECT facility_key, status FROM facility_status", (err, rows) => {
        if (err) {
            console.error('Court Status Fetch Error:', err);
            return res.status(500).json({ error: err.message });
        }
        const out = {};
        COURT_KEYS.forEach(k => { out[k] = 'available'; });
        rows.forEach(r => { if (COURT_KEYS.includes(r.facility_key)) out[r.facility_key] = r.status; });
        res.json(out);
    });
});

app.put('/api/facility-status/:key', requireAdmin, (req, res) => {
    const key = String(req.params.key || '').toLowerCase();
    const status = String((req.body || {}).status || '').toLowerCase();
    if (!COURT_KEYS.includes(key) || !COURT_STATES.includes(status)) {
        return res.status(400).json({ success: false, message: 'Unknown court or status.' });
    }
    db.query(
        "INSERT INTO facility_status (facility_key, status) VALUES (?, ?) ON DUPLICATE KEY UPDATE status = VALUES(status)",
        [key, status],
        (err) => {
            if (err) {
                console.error('Court Status Update Error:', err);
                return res.status(500).json({ success: false, message: 'Could not save the court status.' });
            }
            res.json({ success: true, facility: key, status });
        }
    );
});

// GET ALL BOOKINGS (admin only: it holds names, emails and phone numbers)
app.get('/api/bookings', requireAdmin, (req, res) => {
    const query = "SELECT * FROM bookings WHERE is_deleted = 0 OR is_deleted IS NULL ORDER BY id DESC";
    db.query(query, (err, results) => {
        if (err) {
            console.error('Fetch Bookings Error:', err);
            return res.status(500).json({ error: err.message });
        }
        res.json(results);
    });
});

// PUBLIC: which time ranges are taken. No names, emails, phone numbers or amounts.
app.get('/api/bookings/busy', (req, res) => {
    const q = `SELECT id, facility, booking_date, time_slot, duration_hours, booking_status FROM bookings
               WHERE (is_deleted = 0 OR is_deleted IS NULL)
               AND COALESCE(booking_status, 'Pending') NOT IN ('Rejected', 'Cancelled', 'Refunded')`;
    db.query(q, (err, rows) => {
        if (err) {
            console.error('Busy Slots Error:', err);
            return res.status(500).json({ error: 'Database error' });
        }
        res.setHeader('Cache-Control', 'no-store');
        res.json(rows);
    });
});

// PUBLIC: look up ONE booking. The reference code alone is not enough, the booking email must match too.
function publicBooking(b) {
    const out = Object.assign({}, b);
    delete out.payment_proof; delete out.is_deleted;
    return out;
}
app.get('/api/bookings/lookup', limitLookup, (req, res) => {
    const reference_no = String(req.query.reference_no || '').trim();
    const email = String(req.query.email || '').trim().toLowerCase();
    if (!reference_no || !email) {
        return res.status(400).json({ success: false, message: 'Please enter the booking reference and the email used for the booking.' });
    }
    db.query("SELECT * FROM bookings WHERE reference_no = ? AND (is_deleted = 0 OR is_deleted IS NULL) LIMIT 1", [reference_no], (err, rows) => {
        if (err) {
            console.error('Lookup Error:', err);
            return res.status(500).json({ success: false, message: 'Database error.' });
        }
        if (!rows.length || String(rows[0].email || '').trim().toLowerCase() !== email) {
            return res.status(404).json({ success: false, message: 'No booking matches that reference and email.' });
        }
        res.setHeader('Cache-Control', 'no-store');
        res.json({ success: true, booking: publicBooking(rows[0]) });
    });
});

// LOGGED-IN CUSTOMER: only the bookings of the account that is logged in
app.get('/api/my-bookings', requireUser, (req, res) => {
    db.query("SELECT * FROM bookings WHERE LOWER(TRIM(email)) = ? AND (is_deleted = 0 OR is_deleted IS NULL) ORDER BY id DESC", [req.userEmail], (err, rows) => {
        if (err) {
            console.error('My Bookings Error:', err);
            return res.status(500).json({ error: 'Database error' });
        }
        res.setHeader('Cache-Control', 'no-store');
        res.json(rows.map(publicBooking));
    });
});

// ---------------------------------------------------------------
// TIME RANGE HELPERS
// A booking is stored as its start time ("6:00 PM") + duration_hours,
// so it blocks every hour from the start until start + duration.
// The facility closes at 10:00 PM.
// ---------------------------------------------------------------
const CLOSING_HOUR = 22;

function hourOf(text) {
    const m = /(\d{1,2}):\d{2}\s*(AM|PM)/i.exec(String(text || ''));
    if (!m) return null;
    const h = parseInt(m[1], 10) % 12;
    return m[2].toUpperCase() === 'PM' ? h + 12 : h;
}

function cleanDuration(value) {
    const n = parseInt(value, 10);
    return Number.isFinite(n) ? Math.min(Math.max(n, 1), 4) : 1;
}

// Calls back with an error message when the request cannot be booked, or null when it is free.
function findScheduleProblem(facility, dateStr, timeSlot, durationHours, done, excludeId) {
    const start = hourOf(timeSlot);
    if (start === null) return done(null, '⚠️ Please choose a valid start time.');
    const end = start + durationHours;

    if (end > CLOSING_HOUR) {
        return done(null, '⚠️ The facility closes at 10:00 PM.\n\nPlease choose a shorter duration or an earlier start time.');
    }

    // a court the admin marked as under maintenance / occupied cannot be booked
    const courtKey = courtKeyOf(facility);
    if (courtKey) {
        return db.query("SELECT status FROM facility_status WHERE facility_key = ?", [courtKey], (stErr, stRows) => {
            if (!stErr && stRows.length && stRows[0].status && stRows[0].status !== 'available') {
                return done(null, `⚠️ This court is currently ${stRows[0].status}.\n\nPlease choose another court or try again later.`);
            }
            checkOverlap();
        });
    }
    checkOverlap();

    function checkOverlap() {

    const query = `
        SELECT time_slot, duration_hours FROM bookings
        WHERE LOWER(facility) LIKE LOWER(?)
        AND booking_date = ?
        AND (is_deleted = 0 OR is_deleted IS NULL)
        AND COALESCE(booking_status, 'Pending') NOT IN ('Rejected', 'Cancelled', 'Refunded')
        AND (? IS NULL OR id <> ?)
    `;

    const skipId = excludeId ? Number(excludeId) : null;
    db.query(query, [`%${facility}%`, dateStr, skipId, skipId], (err, rows) => {
        if (err) return done(err);

        const clash = rows.some(r => {
            const s = hourOf(r.time_slot);
            if (s === null) return false;
            const e = s + Math.max(1, parseInt(r.duration_hours, 10) || 1);
            return s < end && e > start;
        });

        if (clash) {
            return done(null, `⚠️ Slot Unavailable!\n\nThis schedule (${timeSlot}, ${durationHours} hour${durationHours > 1 ? 's' : ''}) for ${facility} on ${dateStr} overlaps an existing reservation.`);
        }
        done(null, null);
    });
    }
}

// ---------------------------------------------------------------
// PUBLIC AVAILABILITY CALENDAR (home page)
// Only says which start times are free. No names, emails or amounts leave the server.
//   GET /api/availability?month=2026-11
// A start time is free when its hour is not covered by a live booking
// (start + duration), the date is not in the past, and the court is not
// under maintenance / occupied.
// ---------------------------------------------------------------
const START_HOURS = [8, 10, 12, 14, 16, 18, 20];
const HOUR_LABEL = h => ((h % 12) || 12) + ':00 ' + (h < 12 ? 'AM' : 'PM');
const pad2 = n => String(n).padStart(2, '0');

app.get('/api/availability', (req, res) => {
    const now = new Date();
    const todayStr = now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate());
    const monthStr = String(req.query.month || todayStr.slice(0, 7));
    const m = /^(\d{4})-(\d{2})$/.exec(monthStr);
    if (!m || +m[2] < 1 || +m[2] > 12) return res.status(400).json({ success: false, message: 'month must look like 2026-11' });

    const year = +m[1], mon = +m[2];
    const lastDay = new Date(year, mon, 0).getDate();
    const first = monthStr + '-01', last = monthStr + '-' + pad2(lastDay);

    db.query("SELECT facility_key, status FROM facility_status", (stErr, stRows) => {
        const courts = {};
        COURT_KEYS.forEach(k => { courts[k] = 'available'; });
        if (!stErr) stRows.forEach(r => { if (COURT_KEYS.includes(r.facility_key)) courts[r.facility_key] = r.status || 'available'; });

        db.query(
            `SELECT facility, booking_date, time_slot, duration_hours FROM bookings
             WHERE booking_date BETWEEN ? AND ?
             AND (is_deleted = 0 OR is_deleted IS NULL)
             AND COALESCE(booking_status, 'Pending') NOT IN ('Rejected', 'Cancelled', 'Refunded')`,
            [first, last],
            (err, rows) => {
                if (err) {
                    console.error('Availability error:', err);
                    return res.status(500).json({ success: false, message: 'Database error' });
                }
                const covered = {};   // 'YYYY-MM-DD|court' -> Set of hours in use
                rows.forEach(r => {
                    const key = courtKeyOf(r.facility);
                    const start = hourOf(r.time_slot);
                    if (!key || start === null) return;
                    const date = String(r.booking_date).split('T')[0];
                    const set = covered[date + '|' + key] || (covered[date + '|' + key] = new Set());
                    const dur = Math.max(1, parseInt(r.duration_hours, 10) || 1);
                    for (let h = start; h < start + dur; h++) set.add(h);
                });

                const days = {};
                for (let d = 1; d <= lastDay; d++) {
                    const date = monthStr + '-' + pad2(d);
                    const day = {};
                    COURT_KEYS.forEach(k => {
                        if (date < todayStr || courts[k] !== 'available') { day[k] = []; return; }
                        const used = covered[date + '|' + k];
                        day[k] = START_HOURS
                            .filter(h => !(used && used.has(h)))
                            .filter(h => date > todayStr || h > now.getHours())
                            .map(HOUR_LABEL);
                    });
                    days[date] = day;
                }
                res.setHeader('Cache-Control', 'no-store');
                // start times of today that already went by (so the page can tell "time passed" apart from "booked")
                const passed = START_HOURS.filter(h => h <= now.getHours()).map(HOUR_LABEL);
                res.json({ success: true, month: monthStr, today: todayStr, starts: START_HOURS.map(HOUR_LABEL), passed, courts, days });
            }
        );
    });
});

// CHECK AVAILABILITY ENDPOINT (looks at the whole start-to-end range, not only the start time)
app.post('/api/bookings/check-availability', (req, res) => {
    const { facility, booking_date, time_slot } = req.body;
    const cleanDate = String(booking_date).trim().split('T')[0];
    const duration = cleanDuration(req.body.duration_hours);

    findScheduleProblem(facility, cleanDate, time_slot, duration, (err, problem) => {
        if (err) {
            console.error('Check Availability Error:', err);
            return res.status(500).json({ available: false, message: 'Database error checking availability' });
        }
        if (problem) return res.json({ available: false, message: problem });
        res.json({ available: true, message: 'Slot is available!' });
    });
});

// CREATE NEW BOOKING (WITH DETAILED LOGGING)
app.post('/api/bookings', limitBooking, (req, res) => {
    const { 
        reference_no, 
        payment_ref, 
        fullname, 
        email, 
        phone, 
        address, 
        purpose, 
        organization, 
        facility, 
        booking_date, 
        time_slot, 
        amount,
        payment_proof
    } = req.body;
    
    const cleanDateStr = String(booking_date || '').trim().split('T')[0];
    const duration = cleanDuration(req.body.duration_hours);

    // ---- the server checks everything again (the web page can be bypassed) ----
    const bad = (message) => res.status(400).json({ success: false, message });
    const nameClean = String(fullname || '').trim().replace(/\s+/g, ' ');
    const emailClean = String(email || '').trim();
    const phoneClean = String(phone || '').trim();
    const courtKey = courtKeyOf(facility);

    if (!/^[A-Za-z\u00C0-\u024F][A-Za-z\u00C0-\u024F .'\-]{0,98}$/.test(nameClean)) return bad('Please enter a valid full name (letters only).');
    if (!EMAIL_OK.test(emailClean) || emailClean.length > 255) return bad('Please enter a valid email address.');
    if (!PH_PHONE.test(phoneClean) && phoneClean !== 'N/A') return bad('Please enter a valid Philippine mobile number (09XXXXXXXXX).');
    if (!courtKey) return bad('Please choose a valid facility.');
    if (!TIME_SLOT_CHOICES.includes(String(time_slot || '').trim())) return bad('Please choose a valid start time.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDateStr) || Number.isNaN(Date.parse(cleanDateStr + 'T00:00:00Z'))
        || new Date(cleanDateStr + 'T00:00:00Z').toISOString().slice(0, 10) !== cleanDateStr) {
        return bad('Please choose a valid reservation date.');
    }
    const nowCheck = new Date();
    const todayCheck = todayText();
    if (cleanDateStr < todayCheck) return bad('That date has already passed. Please choose today or a later date.');
    if (cleanDateStr === todayCheck && hourOf(time_slot) <= nowCheck.getHours()) return bad('That start time has already passed. Please choose a later time.');
    const lastDay = new Date(nowCheck.getFullYear() + 1, nowCheck.getMonth(), nowCheck.getDate());
    if (cleanDateStr > lastDay.getFullYear() + '-' + pad2(lastDay.getMonth() + 1) + '-' + pad2(lastDay.getDate())) return bad('Reservations open up to one year ahead.');
    if (!String(reference_no || '').trim()) return bad('Missing reference number.');

    // the price is set here, not by the browser: hourly rate x hours
    const amountServer = RATES[courtKey] * duration;

    const insertQuery = `
        INSERT INTO bookings (reference_no, payment_ref, fullname, email, phone, address, purpose, organization, facility, booking_date, time_slot, duration_hours, amount, payment_proof, booking_status, is_deleted)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', 0)
    `;

    // the payment screenshot is required and must be a real picture
    const proof = readProof(payment_proof);
    if (!proof) {
        return res.status(400).json({ success: false, message: 'Please upload a clear screenshot of your payment (JPG, PNG or WebP).' });
    }

    // checked again here so the slot cannot be taken twice (two people paying at the same moment, or a direct API call)
    // The check and the save run inside a lock for this court + date, so two requests cannot both pass the check.
    withLock(courtKey + '|' + cleanDateStr, (release) => {
    findScheduleProblem(facility, cleanDateStr, time_slot, duration, (checkErr, problem) => {
        if (checkErr) {
            release();
            console.error('Booking Availability Error:', checkErr);
            return res.status(500).json({ success: false, message: 'Database error checking availability.' });
        }
        if (problem) { release(); return res.status(409).json({ success: false, message: problem }); }

        let proofFile;
        try {
            proofFile = saveProof(proof, reference_no);
        } catch (saveErr) {
            release();
            console.error('Save Screenshot Error:', saveErr);
            return res.status(500).json({ success: false, message: 'Could not save the payment screenshot. Please try again.' });
        }

        db.query(insertQuery, [
            String(reference_no).trim().slice(0, 100),
            String(payment_ref || 'N/A').trim().slice(0, 100),
            nameClean,
            emailClean,
            phoneClean,
            String(address || 'N/A').trim().slice(0, 255),
            String(purpose || 'N/A').trim().slice(0, 100),
            String(organization || 'N/A').trim().slice(0, 100),
            facility,
            cleanDateStr,
            String(time_slot).trim(),
            duration,
            amountServer,
            proofFile
        ], (err, result) => {
            release();
            if (err) {
                fs.unlink(path.join(UPLOAD_DIR, proofFile), () => {});
                console.error('❌ Insert Booking Error Details:', err);
                return res.status(500).json({ success: false, message: 'Failed to create booking: ' + err.sqlMessage });
            }
            console.log(`✅ [SUCCESS] New Booking Inserted into MySQL! ID: ${result.insertId} | Ref: ${reference_no} | ${time_slot} x ${duration}h`);
            mailer.notify('received', {
                reference_no, fullname, email, facility, booking_date: cleanDateStr,
                time_slot, duration_hours: duration, amount: amountServer
            });
            res.json({ success: true, id: result.insertId, reference_no });
        });
    });
    });
});

// UPDATE BOOKING STATUS (Approve / Reject / Cancel / Refund) - admin only
// Rules: only known statuses; the booking must exist; a booking that was Rejected / Cancelled / Refunded
// can only be brought back (Pending / Approved / Cancel Requested) if its slot is still free.
app.put('/api/bookings/:id', requireAdmin, (req, res) => {
    const bookingId = Number(req.params.id);
    const booking_status = String((req.body || {}).booking_status || '').trim();

    if (!BOOKING_STATUSES.includes(booking_status)) {
        return res.status(400).json({ success: false, message: 'Unknown status.' });
    }

    // read the booking first, so the email can say what actually changed
    db.query("SELECT * FROM bookings WHERE id = ? AND (is_deleted = 0 OR is_deleted IS NULL) LIMIT 1", [bookingId], (findErr, found) => {
        if (findErr) {
            console.error('Update Status Lookup Error:', findErr);
            return res.status(500).json({ success: false, message: 'Failed to update status.' });
        }
        const before = found && found[0];
        if (!before) return res.status(404).json({ success: false, message: 'Booking not found.' });
        const previous = before.booking_status || 'Pending';

        if (previous === booking_status) return res.json({ success: true });

        if (previous === 'Refunded' && booking_status !== 'Refunded') {
            return res.status(400).json({ success: false, message: 'A refunded booking is closed. Ask the customer to book again.' });
        }
        if (booking_status === 'Refunded' && !['Rejected', 'Cancelled', 'Approved', 'Cancel Requested'].includes(previous)) {
            return res.status(400).json({ success: false, message: 'Only a rejected or cancelled booking can be marked as refunded.' });
        }

        const reviving = DEAD_STATUSES.includes(previous) && !DEAD_STATUSES.includes(booking_status);
        const apply = (release) => {
            db.query("UPDATE bookings SET booking_status = ? WHERE id = ?", [booking_status, bookingId], (err) => {
                if (release) release();
                if (err) {
                    console.error('Update Status Error:', err);
                    return res.status(500).json({ success: false, message: 'Failed to update status.' });
                }
                // a waiting reschedule request makes no sense once the booking is no longer Approved
                if (booking_status !== 'Approved') {
                    db.query("UPDATE bookings SET reschedule_date = NULL, reschedule_time = NULL WHERE id = ?", [bookingId], () => {});
                }
                // an admin cancelling is marked as such (the customer cancelling is set by the cancel request)
                if (booking_status === 'Cancelled' && previous !== 'Cancel Requested') {
                    db.query("UPDATE bookings SET cancelled_by = 'admin' WHERE id = ?", [bookingId], () => {});
                }

                let kind = null;
                if (booking_status === 'Approved' && previous === 'Pending') kind = 'approved';
                else if (booking_status === 'Approved' && previous === 'Cancel Requested') kind = 'cancel_kept';
                else if (booking_status === 'Rejected') kind = 'rejected';
                else if (booking_status === 'Cancelled' && previous === 'Cancel Requested') kind = 'cancel_accepted';
                else if (booking_status === 'Refunded') kind = 'refunded';
                if (kind) mailer.notify(kind, before);
                res.json({ success: true });
            });
        };

        if (!reviving) return apply();

        const reviveDate = String(before.booking_date).split('T')[0];
        withLock((courtKeyOf(before.facility) || 'other') + '|' + reviveDate, (release) => {
        findScheduleProblem(before.facility, reviveDate, before.time_slot,
            Math.max(1, parseInt(before.duration_hours, 10) || 1), (checkErr, problem) => {
                if (checkErr) {
                    release();
                    console.error('Update Status Availability Error:', checkErr);
                    return res.status(500).json({ success: false, message: 'Database error checking availability.' });
                }
                if (problem) {
                    release();
                    return res.status(409).json({ success: false, message: 'Cannot bring this booking back: its schedule is no longer free.\n' + problem.replace(/^⚠️\s*/, '') });
                }
                apply(release);
            }, before.id);
        });
    });
});

// CUSTOMER CANCEL REQUEST (guest via reference code + email, or logged-in customer)
app.post('/api/bookings/cancel-request', limitRequests, (req, res) => {
    const reference_no = String(req.body.reference_no || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();

    if (!reference_no || !email) {
        return res.status(400).json({ success: false, message: 'Reference code and email are required.' });
    }

    const find = "SELECT * FROM bookings WHERE reference_no = ? AND (is_deleted = 0 OR is_deleted IS NULL) LIMIT 1";
    db.query(find, [reference_no], (err, rows) => {
        if (err) {
            console.error('Cancel Lookup Error:', err);
            return res.status(500).json({ success: false, message: 'Database error.' });
        }
        if (!rows.length || String(rows[0].email || '').trim().toLowerCase() !== email) {
            return res.status(404).json({ success: false, message: 'No booking matches that reference code and email.' });
        }

        const b = rows[0];
        const status = b.booking_status || 'Pending';
        const now = new Date();
        const today = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
        const playDate = String(b.booking_date).split('T')[0];

        let next = null;
        if (status === 'Pending' && playDate >= today) next = 'Cancelled';
        else if (status === 'Approved' && playDate > today) next = 'Cancel Requested';

        if (!next) {
            return res.status(400).json({
                success: false,
                message: status === 'Pending' || status === 'Approved'
                    ? 'This reservation can no longer be cancelled online because its date has arrived or passed.'
                    : 'This reservation cannot be cancelled (current status: ' + status + ').'
            });
        }

        db.query("UPDATE bookings SET booking_status = ?, cancelled_by = 'customer', reschedule_date = NULL, reschedule_time = NULL WHERE id = ? AND booking_status = ?", [next, b.id, status], (err2, result) => {
            if (err2) {
                console.error('Cancel Update Error:', err2);
                return res.status(500).json({ success: false, message: 'Could not save the cancellation.' });
            }
            if (!result.affectedRows) {
                return res.status(409).json({ success: false, message: 'The reservation changed in the meantime. Please refresh.' });
            }
            mailer.notify(next === 'Cancelled' ? 'cancel_done' : 'cancel_received', rows[0]);
            res.json({ success: true, status: next });
        });
    });
});

// CUSTOMER RESCHEDULE REQUEST
// Rules: Approved booking, play date after today, one reschedule per booking, no other
// request waiting, same court and same duration (so the price stays the same),
// new date after today, and the new schedule must be free.
const MAX_RESCHEDULES = 1;

function todayText() {
    const now = new Date();
    return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
}

app.post('/api/bookings/reschedule-request', limitRequests, (req, res) => {
    const reference_no = String(req.body.reference_no || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const newDate = String(req.body.booking_date || '').trim().split('T')[0];
    const newTime = String(req.body.time_slot || '').trim();

    if (!reference_no || !email) {
        return res.status(400).json({ success: false, message: 'Reference code and email are required.' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate) || !TIME_SLOT_CHOICES.includes(newTime)) {
        return res.status(400).json({ success: false, message: 'Please choose a valid new date and time.' });
    }

    const find = "SELECT * FROM bookings WHERE reference_no = ? AND (is_deleted = 0 OR is_deleted IS NULL) LIMIT 1";
    db.query(find, [reference_no], (err, rows) => {
        if (err) {
            console.error('Reschedule Lookup Error:', err);
            return res.status(500).json({ success: false, message: 'Database error.' });
        }
        if (!rows.length || String(rows[0].email || '').trim().toLowerCase() !== email) {
            return res.status(404).json({ success: false, message: 'No booking matches that reference code and email.' });
        }

        const b = rows[0];
        const today = todayText();
        const playDate = String(b.booking_date).split('T')[0];
        const status = b.booking_status || 'Pending';

        if (status !== 'Approved') {
            return res.status(400).json({ success: false, message: 'Only an approved reservation can be rescheduled.' });
        }
        if (playDate <= today) {
            return res.status(400).json({ success: false, message: 'This reservation can no longer be rescheduled because its date has arrived or passed.' });
        }
        if (b.reschedule_date) {
            return res.status(400).json({ success: false, message: 'You already have a reschedule request waiting for the administrator.' });
        }
        if ((parseInt(b.reschedule_count, 10) || 0) >= MAX_RESCHEDULES) {
            return res.status(400).json({ success: false, message: 'This reservation was already rescheduled once. Please contact the management for more changes.' });
        }
        if (newDate <= today) {
            return res.status(400).json({ success: false, message: 'The new date must be after today.' });
        }
        if (newDate === playDate && newTime === b.time_slot) {
            return res.status(400).json({ success: false, message: 'That is your current schedule. Please pick a different date or time.' });
        }

        const duration = Math.max(1, parseInt(b.duration_hours, 10) || 1);
        findScheduleProblem(b.facility, newDate, newTime, duration, (checkErr, problem) => {
            if (checkErr) {
                console.error('Reschedule Availability Error:', checkErr);
                return res.status(500).json({ success: false, message: 'Database error checking availability.' });
            }
            if (problem) return res.status(409).json({ success: false, message: problem });

            db.query(
                "UPDATE bookings SET reschedule_date = ?, reschedule_time = ? WHERE id = ? AND booking_status = 'Approved' AND reschedule_date IS NULL",
                [newDate, newTime, b.id],
                (err2, result) => {
                    if (err2) {
                        console.error('Reschedule Save Error:', err2);
                        return res.status(500).json({ success: false, message: 'Could not save the request.' });
                    }
                    if (!result.affectedRows) {
                        return res.status(409).json({ success: false, message: 'The reservation changed in the meantime. Please refresh.' });
                    }
                    mailer.notify('resched_received', b, { date: newDate, time: newTime });
                    res.json({ success: true, reschedule_date: newDate, reschedule_time: newTime });
                }
            );
        }, b.id);
    });
});

// ADMIN: approve (move the booking) or decline a reschedule request
app.post('/api/bookings/:id/reschedule-decision', requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    const decision = String((req.body || {}).decision || '').toLowerCase();
    if (!['approve', 'decline'].includes(decision)) {
        return res.status(400).json({ success: false, message: 'Decision must be approve or decline.' });
    }

    db.query("SELECT * FROM bookings WHERE id = ? AND (is_deleted = 0 OR is_deleted IS NULL) LIMIT 1", [id], (err, rows) => {
        if (err) {
            console.error('Reschedule Decision Lookup Error:', err);
            return res.status(500).json({ success: false, message: 'Database error.' });
        }
        const b = rows && rows[0];
        if (!b || !b.reschedule_date) {
            return res.status(404).json({ success: false, message: 'There is no reschedule request for this booking.' });
        }

        if (decision === 'decline') {
            return db.query("UPDATE bookings SET reschedule_date = NULL, reschedule_time = NULL WHERE id = ?", [id], (err2) => {
                if (err2) return res.status(500).json({ success: false, message: 'Could not save the decision.' });
                mailer.notify('resched_declined', b);
                res.json({ success: true, decision });
            });
        }

        if ((b.booking_status || 'Pending') !== 'Approved') {
            return res.status(400).json({ success: false, message: 'Only an approved booking can be moved.' });
        }

        const newDate = String(b.reschedule_date).split('T')[0];
        const duration = Math.max(1, parseInt(b.duration_hours, 10) || 1);
        // the new slot may have been taken since the request was sent, so check again
        withLock((courtKeyOf(b.facility) || 'other') + '|' + newDate, (release) => {
        findScheduleProblem(b.facility, newDate, b.reschedule_time, duration, (checkErr, problem) => {
            if (checkErr) {
                release();
                console.error('Reschedule Decision Availability Error:', checkErr);
                return res.status(500).json({ success: false, message: 'Database error checking availability.' });
            }
            if (problem) { release(); return res.status(409).json({ success: false, message: problem }); }

            db.query(
                "UPDATE bookings SET booking_date = ?, time_slot = ?, reschedule_count = COALESCE(reschedule_count, 0) + 1, reschedule_date = NULL, reschedule_time = NULL WHERE id = ?",
                [newDate, b.reschedule_time, id],
                (err3) => {
                    release();
                    if (err3) {
                        console.error('Reschedule Apply Error:', err3);
                        return res.status(500).json({ success: false, message: 'Could not move the booking.' });
                    }
                    mailer.notify('resched_approved', b, { date: newDate, time: b.reschedule_time });
                    res.json({ success: true, decision, booking_date: newDate, time_slot: b.reschedule_time });
                }
            );
        }, id);
        });
    });
});

// SOFT DELETE ENDPOINT
app.delete('/api/bookings/:id', requireAdmin, (req, res) => {
    const bookingId = req.params.id;
    const query = "UPDATE bookings SET is_deleted = 1 WHERE id = ?";

    db.query(query, [bookingId], (err, result) => {
        if (err) {
            console.error('Soft Delete Error:', err);
            return res.status(500).json({ success: false, message: 'Failed to soft delete booking.' });
        }
        res.json({ success: true, message: 'Booking soft deleted successfully!' });
    });
});

// REAL USER REGISTER (WITH BCRYPT PASSWORD HASHING - ORGANIZATION REMOVED)
app.post('/api/register', limitAccount, async (req, res) => {
    const { email, password, firstName, lastName, phone, address } = req.body || {};

    // checked here too, not only on the page
    const emailClean = String(email || '').trim();
    const nameOk = v => !String(v || '').trim() || /^[A-Za-z\u00C0-\u024F][A-Za-z\u00C0-\u024F .'\-]{0,98}$/.test(String(v).trim());
    if (!EMAIL_OK.test(emailClean) || emailClean.length > 255) return res.json({ success: false, message: 'Please enter a valid email address.' });
    if (typeof password !== 'string' || password.length < 6 || password.length > 72) return res.json({ success: false, message: 'Your password must be 6 to 72 characters.' });
    if (!String(firstName || '').trim() || !nameOk(firstName) || !nameOk(lastName)) return res.json({ success: false, message: 'Please enter a valid first and last name (letters only).' });
    const phoneClean = String(phone || 'N/A').trim();
    if (phoneClean !== 'N/A' && !PH_PHONE.test(phoneClean)) return res.json({ success: false, message: 'Please enter a valid Philippine mobile number (09XXXXXXXXX).' });

    try {
        const checkQuery = "SELECT * FROM users WHERE email = ?";
        db.query(checkQuery, [emailClean], async (err, results) => {
            if (err) {
                console.error('Check User Error:', err);
                return res.status(500).json({ success: false, message: 'Database error' });
            }
            if (results.length > 0) {
                return res.json({ success: false, message: 'Email is already registered.' });
            }

            const saltRounds = 10;
            const hashedPassword = await bcrypt.hash(password, saltRounds);

            const insertQuery = `
                INSERT INTO users (email, password, firstName, lastName, phone, address, role)
                VALUES (?, ?, ?, ?, ?, ?, 'customer')
            `;
            db.query(insertQuery, [
                emailClean,
                hashedPassword,
                String(firstName || '').trim(),
                String(lastName || '').trim(),
                phoneClean,
                String(address || 'N/A').trim().slice(0, 255) || 'N/A'
            ], (err2, result) => {
                if (err2) {
                    console.error('Registration Insert Error:', err2);
                    return res.status(500).json({ success: false, message: 'Failed to register: ' + err2.sqlMessage });
                }
                res.json({ success: true, message: 'Account created successfully in MySQL!' });
            });
        });
    } catch (hashErr) {
        console.error('Hashing Error:', hashErr);
        res.status(500).json({ success: false, message: 'Internal server error during registration.' });
    }
});

// REAL USER & ADMIN LOGIN (BCRYPT + LOCK AFTER 3 WRONG PASSWORDS)
// The lock is per email AND per device, and it ends by itself after 5 minutes, so nobody can keep
// another person (or the admin) locked out just by typing wrong passwords.
app.post('/api/login', limitAccount, (req, res) => {
    const email = String((req.body || {}).email || '').trim();
    const password = String((req.body || {}).password || '');
    if (!email || !password) {
        return res.json({ success: false, message: 'Please enter your email and password.' });
    }
    const emailKey = email.toLowerCase();
    const key = emailKey + '|' + (req.ip || '');

    let slot = loginAttempts[key];
    if (slot && slot.lockedUntil && slot.lockedUntil <= Date.now()) { delete loginAttempts[key]; slot = null; }
    if (!slot) slot = loginAttempts[key] = { count: 0, lockedUntil: 0 };

    if (slot.lockedUntil > Date.now()) {
        const mins = Math.ceil((slot.lockedUntil - Date.now()) / 60000);
        return res.json({
            success: false,
            message: '⚠️ Security Alert: You entered incorrect credentials 3 times in a row. Please try again in ' + mins + ' minute' + (mins > 1 ? 's' : '') + ', or use "Forgot password".'
        });
    }

    const failed = () => {
        slot.count += 1;
        const remaining = LOGIN_MAX_TRIES - slot.count;
        if (remaining <= 0) slot.lockedUntil = Date.now() + LOGIN_LOCK_MS;
        return res.json({
            success: false,
            message: `Invalid email or password. ${remaining > 0 ? remaining + ' attempt(s) remaining.' : '⚠️ Warning: 3 consecutive failed login attempts recorded. Login is paused for 5 minutes.'}`
        });
    };

    db.query("SELECT * FROM users WHERE email = ?", [email], async (err, results) => {
        if (err) {
            console.error('Login Error:', err);
            return res.status(500).json({ success: false, message: 'Database error' });
        }
        if (results.length === 0) return failed();

        const user = results[0];
        let match = false;
        try { match = await bcrypt.compare(password, user.password); } catch (e) { match = false; }
        if (!match) return failed();

        delete loginAttempts[key];

        const isAdmin = user.role === 'admin';
        res.json({
            success: true,
            token: isAdmin ? issueAdminToken() : undefined,
            userToken: isAdmin ? undefined : issueUserToken(user.email),
            user: {
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                phone: user.phone,
                address: user.address,
                role: user.role || 'customer'
            }
        });
    });
});

// ---------------------------------------------------------------
// FORGOT PASSWORD (6-digit code sent by email, kept in memory for 10 minutes)
// The answer never says whether an email is registered. Admin accounts are
// skipped on purpose: an admin password is changed in the database.
// ---------------------------------------------------------------
const resetCodes = new Map();           // email -> { code, expires, tries, last }
const RESET_MINUTES = 10, RESET_MAX_TRIES = 5, RESET_COOLDOWN_MS = 60 * 1000;

app.post('/api/forgot-password/request', limitReset, (req, res) => {
    const email = String((req.body || {}).email || '').toLowerCase().trim();
    const generic = { success: true, message: 'If that email has an account, a 6-digit code was sent. It works for ' + RESET_MINUTES + ' minutes.' };
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return res.json({ success: false, message: 'Please enter a valid email address.' });
    }
    const old = resetCodes.get(email);
    if (old && Date.now() - old.last < RESET_COOLDOWN_MS) {
        const wait = Math.ceil((RESET_COOLDOWN_MS - (Date.now() - old.last)) / 1000);
        return res.json({ success: false, message: 'Please wait ' + wait + ' seconds before asking for another code.' });
    }
    db.query("SELECT email, firstName, role FROM users WHERE email = ?", [email], (err, rows) => {
        if (err) {
            console.error('Forgot password lookup error:', err);
            return res.status(500).json({ success: false, message: 'Database error' });
        }
        if (!rows.length || rows[0].role === 'admin') return res.json(generic);
        const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
        resetCodes.set(email, { code, expires: Date.now() + RESET_MINUTES * 60 * 1000, tries: 0, last: Date.now() });
        const sent = mailer.sendResetCode(rows[0].email, rows[0].firstName, code);
        // With email OFF (or a placeholder address) show the code in this terminal so a demo still works.
        if (!sent) console.log('[Forgot password] Email is not available. Code for ' + email + ': ' + code);
        res.json(generic);
    });
});

app.post('/api/forgot-password/reset', limitReset, (req, res) => {
    const body = req.body || {};
    const email = String(body.email || '').toLowerCase().trim();
    const code = String(body.code || '').trim();
    const newPassword = String(body.newPassword || '');
    const bad = { success: false, message: 'That code is wrong or has expired. Please ask for a new one.' };

    if (newPassword.length < 6) {
        return res.json({ success: false, message: 'Your new password must be at least 6 characters.' });
    }
    const entry = resetCodes.get(email);
    if (!entry || entry.expires < Date.now() || entry.tries >= RESET_MAX_TRIES) {
        resetCodes.delete(email);
        return res.json(bad);
    }
    const a = Buffer.from(entry.code), b = Buffer.from(code.padEnd(entry.code.length).slice(0, entry.code.length));
    if (code.length !== entry.code.length || !crypto.timingSafeEqual(a, b)) {
        entry.tries += 1;
        const left = RESET_MAX_TRIES - entry.tries;
        if (left <= 0) resetCodes.delete(email);
        return res.json({ success: false, message: left > 0 ? 'Wrong code. ' + left + ' attempt(s) left.' : 'Too many wrong codes. Please ask for a new one.' });
    }
    bcrypt.hash(newPassword, 10).then((hash) => {
        db.query("UPDATE users SET password = ? WHERE email = ? AND (role IS NULL OR role <> 'admin')", [hash, email], (err, result) => {
            if (err) {
                console.error('Forgot password update error:', err);
                return res.status(500).json({ success: false, message: 'Database error' });
            }
            if (!result.affectedRows) return res.json(bad);
            resetCodes.delete(email);
            clearAttempts(email);   // also lifts the "3 wrong attempts" lock for this email
            res.json({ success: true, message: 'Password changed. You can log in now.' });
        });
    }).catch((e) => {
        console.error('Forgot password hash error:', e);
        res.status(500).json({ success: false, message: 'Internal server error.' });
    });
});

// COUNT REGISTERED USERS (for the admin dashboard)
// ==========================================
// UPDATE OWN ACCOUNT DETAILS (Settings)
// The email is the account identity: it is never changed here.
// The current password is required, because the site has no login session.
// ==========================================
app.put('/api/users/update', async (req, res) => {
    const { email, password, firstName, lastName, phone, address } = req.body || {};

    const clean = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
    const first = clean(firstName, 60);
    const last = clean(lastName, 60);
    const tel = clean(phone, 20);
    const addr = clean(address, 255);

    if (!email || !password) {
        return res.json({ success: false, message: 'Please enter your current password to save changes.' });
    }
    if (!first) {
        return res.json({ success: false, message: 'First name is required.' });
    }
    if (tel && !/^[0-9+()\-\s]{7,20}$/.test(tel)) {
        return res.json({ success: false, message: 'Please enter a valid contact number.' });
    }

    db.query('SELECT * FROM users WHERE email = ?', [email], async (err, results) => {
        if (err) {
            console.error('Update Profile Lookup Error:', err);
            return res.status(500).json({ success: false, message: 'Database error' });
        }
        if (results.length === 0) {
            return res.json({ success: false, message: 'Account not found.' });
        }

        const match = await bcrypt.compare(String(password), results[0].password);
        if (!match) {
            return res.json({ success: false, message: 'Incorrect password. Your details were not changed.' });
        }

        const sql = 'UPDATE users SET firstName = ?, lastName = ?, phone = ?, address = ? WHERE email = ?';
        db.query(sql, [first, last, tel || 'N/A', addr || 'N/A', email], (err2) => {
            if (err2) {
                console.error('Update Profile Error:', err2);
                return res.status(500).json({ success: false, message: 'Could not save your details.' });
            }
            res.json({
                success: true,
                message: 'Your details were updated.',
                user: { email, firstName: first, lastName: last, phone: tel || 'N/A', address: addr || 'N/A' }
            });
        });
    });
});

app.get('/api/users/count', requireAdmin, (req, res) => {
    const query = "SELECT COUNT(*) AS total FROM users WHERE role IS NULL OR role <> 'admin'";
    db.query(query, (err, results) => {
        if (err) {
            console.error('Count Users Error:', err);
            return res.status(500).json({ error: err.message });
        }
        res.json({ total: results[0].total });
    });
});

console.log('Payment screenshots are saved in: ' + UPLOAD_DIR);

const PORT = 5000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));