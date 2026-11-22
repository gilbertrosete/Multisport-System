# MultiSport - Sports Facility Reservation System
MetroGate Silang Estates, by Moldex Realty. Customers (and guests) reserve the basketball, volleyball,
tennis and badminton courts online; the admin approves bookings, handles cancel / reschedule requests and
manages court status.

**Stack:** HTML / CSS / JavaScript (front end), Node.js + Express (API), MySQL (XAMPP), bcrypt, Nodemailer.

## What you need
- [Node.js](https://nodejs.org) 18 or newer
- [XAMPP](https://www.apachefriends.org) (Apache is not needed, only **MySQL**)
- VS Code with the **Live Server** extension (or any static web server)

## First-time setup
1. **Start MySQL** in the XAMPP Control Panel.
2. **Create the database:** open <http://localhost/phpmyadmin> -> **Import** -> choose `schema.sql` -> **Go**.
   (It is safe to run again; it never deletes existing data.)
3. **Install the packages:** open a terminal in this folder and run `npm install`.
4. **Create the admin account:**
   `node create-admin.js admin@example.com YourStrongPassword`
5. *(Optional)* **Email notices:** copy `mail-config.example.js` to `mail-config.js` and fill in a Gmail address
   and its App Password. Without it the system works normally, it just does not send emails.

## Every time you run it
1. Start MySQL in XAMPP.
2. In this folder run `node server.js`. The terminal should say
   `Connected to MySQL Database (multisport_db)!` and `Server running on http://localhost:5000`.
3. Right-click `index.html` -> **Open with Live Server** (the pages call the API at `http://localhost:5000/api`).
4. Admin: log in on the Login page with the admin account; it opens the admin dashboard.

## Good to know
- **Prices** are set in `server.js` (`RATES`): basketball / volleyball / tennis 500 per hour, badminton 300 per hour.
  The server works out the amount itself, so a changed browser value cannot lower the price.
- **Payment screenshots** are saved in a folder called `MultiSport-Uploads` in your user folder (outside the project on
  purpose, so Live Server does not reload the page). Set the `MULTISPORT_UPLOADS` environment variable to use another place.
  Only the admin can open a screenshot.
- **Database connection:** the server uses a connection pool, so it reconnects by itself if MySQL restarts or drops an idle connection.
- **Double-booking protection:** requests for the same court and date are handled one at a time, so two people
  paying at the same moment cannot both get the same time slot (the second one is told it is taken).
- **Rate limit:** one device can make about 20 bookings, 30 sign-in / sign-up attempts and 8 password-reset requests
  every 15 minutes (the pages show a "try again in ..." message). Normal use never reaches this. When testing a lot
  from one computer, start the server with `MULTISPORT_NO_RATE_LIMIT=1` to turn it off
  (PowerShell: `$env:MULTISPORT_NO_RATE_LIMIT=1; node server.js`).
- **Admin sign-in and failed-login counters** are kept in memory: restarting `node server.js` signs the admin out
  (just log in again).
- The MySQL user is `root` with no password (the XAMPP default). Change it in `server.js` (and `create-admin.js`)
  if your MySQL has a password.

## Files
| File | What it is |
|---|---|
| `server.js` | The API (bookings, availability, accounts, admin, email) |
| `schema.sql` | Database tables (`users`, `bookings`, `facility_status`) |
| `create-admin.js` | Creates or resets the admin account |
| `index.html`, `facilities.html`, `booking.html`, `guest-booking.html`, `track-booking.html`, `login.html`, `register.html`, `profile.html` | Customer pages |
| `admin-dashboard.html`, `admin.js`, `admin.css` | Admin dashboard |
| `script.js`, `avail.js`, `cancel.js`, `legal.js`, `nav.js` ... | Front-end scripts |
| `home.css`, `pages.css`, `style.css`, `nav-account.css`, `hero-bg.css` | Styles |
| `mail.js`, `mail-config.example.js` | Email notices |