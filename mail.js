/* =========================================================
   MultiSport - email notices (free, through a Gmail account)

   Setup (one time):
   1. Run:  npm install nodemailer
   2. Copy mail-config.example.js to mail-config.js and fill in the
      Gmail address and its App Password (see the comments in that file).
   3. Restart node server.js. The terminal says "Email notices are ON".

   If mail-config.js is missing, still has the example values, or nodemailer is
   not installed, the emails are simply skipped. Bookings keep working.
   An email that fails to send never blocks or breaks a booking.
   ========================================================= */

'use strict';

let transporter = null;
let config = {};

(function init() {
    try {
        config = require('./mail-config.js');
    } catch (err) {
        console.log('Email notices are OFF (create mail-config.js to turn them on).');
        return;
    }
    if (!config.user || !config.pass || /your|example|xxxx/i.test(config.user + config.pass)) {
        console.log('Email notices are OFF (fill in mail-config.js with a real Gmail address and App Password).');
        return;
    }
    let nodemailer;
    try {
        nodemailer = require('nodemailer');
    } catch (err) {
        console.log('Email notices are OFF (run: npm install nodemailer).');
        return;
    }
    transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: config.user, pass: String(config.pass).replace(/\s+/g, '') }
    });
    console.log('Email notices are ON (sending from ' + config.user + ').');
})();

function esc(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function niceDate(value) {
    const p = String(value || '').split('T')[0].split('-');
    if (p.length !== 3) return String(value || '');
    return MONTHS[parseInt(p[1], 10) - 1] + ' ' + parseInt(p[2], 10) + ', ' + p[0];
}

function peso(n) {
    return 'PHP ' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function hours(b) {
    const h = Math.max(1, parseInt(b.duration_hours, 10) || 1);
    return h + (h === 1 ? ' hour' : ' hours');
}

/* what each email says. "extra" carries the new schedule for reschedule emails. */
const MESSAGES = {
    received: (b) => ({
        subject: 'We received your reservation ' + b.reference_no,
        headline: 'Reservation received',
        lines: ['Thank you for booking with Moldex Realty. Your payment is being checked by the management.',
                'You will get another email once your reservation is approved.']
    }),
    approved: (b) => ({
        subject: 'Your reservation is approved ' + b.reference_no,
        headline: 'Reservation approved',
        lines: ['Good news! Your reservation is confirmed. Please show your reference code when you arrive.']
    }),
    rejected: (b) => ({
        subject: 'Update on your reservation ' + b.reference_no,
        headline: 'Reservation declined',
        lines: ['We are sorry, the management could not accept this reservation.',
                'Your payment of ' + peso(b.amount) + ' will be returned to you. You will get another email once the refund has been sent.']
    }),
    refunded: (b) => ({
        subject: 'Your refund has been sent ' + b.reference_no,
        headline: 'Refund sent',
        lines: ['The management has returned your payment of ' + peso(b.amount) + '.',
                'Please allow a little time for it to show in your GCash.']
    }),
    cancel_done: (b) => ({
        subject: 'Your reservation was cancelled ' + b.reference_no,
        headline: 'Reservation cancelled',
        lines: ['As you asked, this reservation has been cancelled.',
                'The management will return your payment of ' + peso(b.amount) + '. You will get another email once it has been sent.']
    }),
    cancel_received: (b) => ({
        subject: 'We received your cancellation request ' + b.reference_no,
        headline: 'Cancellation request received',
        lines: ['The administrator will review your request. Your reservation stays valid until then.']
    }),
    cancel_accepted: (b) => ({
        subject: 'Your cancellation was accepted ' + b.reference_no,
        headline: 'Cancellation accepted',
        lines: ['The management accepted your cancellation.',
                'Your payment of ' + peso(b.amount) + ' will be returned. You will get another email once it has been sent.']
    }),
    cancel_kept: (b) => ({
        subject: 'Your reservation stays active ' + b.reference_no,
        headline: 'Reservation kept',
        lines: ['The management did not cancel this reservation, so it remains approved on the original schedule.']
    }),
    resched_received: (b, x) => ({
        subject: 'We received your reschedule request ' + b.reference_no,
        headline: 'Reschedule request received',
        lines: ['You asked to move this reservation to ' + niceDate(x.date) + ', ' + x.time + '.',
                'Your reservation keeps its current schedule until the administrator approves the change.']
    }),
    resched_approved: (b, x) => ({
        subject: 'Your reservation was moved ' + b.reference_no,
        headline: 'New schedule confirmed',
        lines: ['The management approved your request. Your new schedule is ' + niceDate(x.date) + ', ' + x.time + ' (' + hours(b) + ').']
    }),
    resched_declined: (b) => ({
        subject: 'Your reschedule request was declined ' + b.reference_no,
        headline: 'Reschedule declined',
        lines: ['The management could not move your reservation, so it stays on ' + niceDate(b.booking_date) + ', ' + b.time_slot + '.',
                'You may send another request if you still need to change it.']
    })
};

function render(kind, b, x) {
    const m = MESSAGES[kind](b, x || {});
    const rows = [
        ['Reference', b.reference_no],
        ['Facility', b.facility],
        ['Date', niceDate(b.booking_date)],
        ['Time', b.time_slot + ' · ' + hours(b)],
        ['Amount paid', peso(b.amount)]
    ];
    const name = String(b.fullname || '').trim().split(/\s+/)[0] || 'there';

    const html =
        '<div style="background:#eef2ee;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;">' +
        '<div style="max-width:520px;margin:0 auto;background:#ffffff;border:2px solid #0a3624;">' +
        '<div style="background:#0a3624;color:#fbbf24;padding:16px 22px;font-size:20px;font-weight:700;letter-spacing:1px;">MOLDEX REALTY</div>' +
        '<div style="padding:22px;">' +
        '<h2 style="margin:0 0 12px;color:#0a3624;font-size:22px;">' + esc(m.headline) + '</h2>' +
        '<p style="margin:0 0 12px;color:#334155;font-size:15px;line-height:1.5;">Hi ' + esc(name) + ',</p>' +
        m.lines.map(l => '<p style="margin:0 0 12px;color:#334155;font-size:15px;line-height:1.5;">' + esc(l) + '</p>').join('') +
        '<table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">' +
        rows.map(r => '<tr><td style="padding:8px 0;border-bottom:1px solid #e2e8f0;color:#64748b;width:38%;">' + esc(r[0]) +
            '</td><td style="padding:8px 0;border-bottom:1px solid #e2e8f0;color:#0a3624;font-weight:700;">' + esc(r[1]) + '</td></tr>').join('') +
        '</table>' +
        '<p style="margin:0;color:#64748b;font-size:13px;line-height:1.5;">You can check your reservation anytime on the Track Booking page using your reference code and this email address.</p>' +
        '</div></div></div>';

    const text = m.headline + '\n\nHi ' + name + ',\n\n' + m.lines.join('\n\n') + '\n\n' +
        rows.map(r => r[0] + ': ' + r[1]).join('\n') +
        '\n\nCheck your reservation anytime on the Track Booking page with your reference code and this email.';

    return { subject: m.subject, html, text };
}

/* fire and forget: never throws, never makes the caller wait */
function notify(kind, booking, extra) {
    if (!transporter || !booking || !MESSAGES[kind]) return;
    const to = String(booking.email || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to) || /@multisport\.com$/i.test(to)) return;
    try {
        const mail = render(kind, booking, extra);
        transporter.sendMail({
            from: '"' + (config.fromName || 'Moldex Realty') + '" <' + config.user + '>',
            to,
            subject: mail.subject,
            text: mail.text,
            html: mail.html
        }, (err) => {
            if (err) console.error('Email (' + kind + ') to ' + to + ' failed:', err.message);
            else console.log('Email (' + kind + ') sent to ' + to);
        });
    } catch (err) {
        console.error('Email build error (' + kind + '):', err.message);
    }
}

/* password reset code. Returns true when an email was handed to Gmail. */
function sendResetCode(to, name, code) {
    to = String(to || '').trim();
    if (!transporter) return false;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to) || /@multisport\.com$/i.test(to)) return false;
    const first = String(name || '').trim().split(/\s+/)[0] || 'there';
    const html =
        '<div style="background:#eef2ee;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;">' +
        '<div style="max-width:520px;margin:0 auto;background:#ffffff;border:2px solid #0a3624;">' +
        '<div style="background:#0a3624;color:#fbbf24;padding:16px 22px;font-size:20px;font-weight:700;letter-spacing:1px;">MOLDEX REALTY</div>' +
        '<div style="padding:22px;">' +
        '<h2 style="margin:0 0 12px;color:#0a3624;font-size:22px;">Reset your password</h2>' +
        '<p style="margin:0 0 12px;color:#334155;font-size:15px;line-height:1.5;">Hi ' + esc(first) + ', use this code to set a new password:</p>' +
        '<p style="margin:16px 0;text-align:center;font-size:34px;font-weight:700;letter-spacing:10px;color:#0a3624;background:#fff7d6;border:2px dashed #fbbf24;padding:14px 0;">' + esc(code) + '</p>' +
        '<p style="margin:0;color:#64748b;font-size:13px;line-height:1.5;">The code works for 10 minutes. If you did not ask for this, you can ignore this email and your password stays the same.</p>' +
        '</div></div></div>';
    transporter.sendMail({
        from: '"' + (config.fromName || 'Moldex Realty') + '" <' + config.user + '>',
        to,
        subject: 'Your Moldex Realty password reset code',
        text: 'Hi ' + first + ',\n\nYour password reset code is ' + code + '. It works for 10 minutes.\nIf you did not ask for this, ignore this email.',
        html
    }, (err) => {
        if (err) console.error('Email (reset code) to ' + to + ' failed:', err.message);
        else console.log('Email (reset code) sent to ' + to);
    });
    return true;
}

module.exports = { notify, sendResetCode };