// Creates (or resets) the ADMIN account. Run it once after importing schema.sql:
//
//     node create-admin.js admin@example.com MyStrongPassword
//     node create-admin.js admin@example.com MyStrongPassword "First" "Last"
//
// The password is stored as a bcrypt hash, the same way the register page does it.
// If the email already exists, that account becomes an admin and gets the new password.
const mysql = require('mysql2');
const bcrypt = require('bcrypt');

const [email, password, firstName = 'Admin', lastName = ''] = process.argv.slice(2);
if (!email || !password || password.length < 8) {
    console.log('Usage:  node create-admin.js <email> <password (8+ characters)> ["First name"] ["Last name"]');
    process.exit(1);
}

const db = mysql.createConnection({ host: 'localhost', user: 'root', password: '', database: 'multisport_db' });

(async () => {
    const hash = await bcrypt.hash(password, 10);
    const clean = email.trim().toLowerCase();
    db.query('SELECT id FROM users WHERE LOWER(TRIM(email)) = ?', [clean], (err, rows) => {
        if (err) { console.error('Database error:', err.message); return db.end(); }
        const done = (e) => {
            if (e) console.error('Database error:', e.message);
            else console.log('Admin account ready: ' + clean + '  (log in on the Login page)');
            db.end();
        };
        if (rows.length) {
            db.query("UPDATE users SET password = ?, role = 'admin' WHERE id = ?", [hash, rows[0].id], done);
        } else {
            db.query("INSERT INTO users (email, password, firstName, lastName, role) VALUES (?, ?, ?, ?, 'admin')",
                [clean, hash, firstName, lastName], done);
        }
    });
})();
