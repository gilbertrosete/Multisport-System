/* =========================================================
   MultiSport - cancel requests (customer side)
   Used by track-booking.html and profile.html. Loaded after script.js.

   Rules (also enforced again by POST /api/bookings/cancel-request):
   - Pending  + date today or later  -> cancelled right away (admin refunds)
   - Approved + date after today     -> "Cancel Requested" (admin accepts / keeps)
   - the email has to match the booking
   ========================================================= */

(function () {
    'use strict';

    var API = 'http://localhost:5000/api';

    function todayIso() {
        var d = new Date();
        return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
    }

    function dateOf(b) { return String(b.booking_date || '').split('T')[0]; }

    /* what a cancel would do for this booking: 'now' | 'request' | null */
    function cancelMode(b) {
        var s = b.booking_status || 'Pending';
        var d = dateOf(b), t = todayIso();
        if (s === 'Pending' && d >= t) return 'now';
        if (s === 'Approved' && d > t) return 'request';
        return null;
    }

    function el(tag, cls, text) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text != null) n.textContent = text;
        return n;
    }

    /* ---------- dialog ---------- */

    function openDialog(opts) {
        /* opts: { booking, email (optional, known), onDone(newStatus) } */
        var b = opts.booking;
        var mode = cancelMode(b);
        if (!mode) return;

        var overlay = el('div', 'cx-overlay');
        var box = el('div', 'cx-dialog');
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-modal', 'true');

        var title = el('h3', 'cx-title', mode === 'now' ? 'Cancel this reservation?' : 'Request a cancellation?');
        var ref = el('p', 'cx-ref', b.reference_no + ' · ' + b.facility + ' · ' + dateOf(b));
        var text = el('p', 'cx-text', mode === 'now'
            ? 'This booking is still waiting for approval, so it will be cancelled right away. The management will then return your payment.'
            : 'This booking is already approved, so the administrator has to confirm the cancellation. It stays valid until they do. Once accepted, your payment will be returned.');

        box.appendChild(title); box.appendChild(ref); box.appendChild(text);

        var emailInput = null;
        if (!opts.email) {
            var label = el('label', 'cx-label', 'Email used for the booking');
            emailInput = el('input', 'cx-input');
            emailInput.type = 'email';
            emailInput.placeholder = 'you@example.com';
            emailInput.autocomplete = 'email';
            label.appendChild(emailInput);
            box.appendChild(label);
        }

        var msg = el('p', 'cx-msg');
        msg.setAttribute('role', 'alert');
        box.appendChild(msg);

        var row = el('div', 'cx-actions');
        var keep = el('button', 'cx-btn', 'Keep reservation');
        keep.type = 'button';
        var go = el('button', 'cx-btn cx-danger', mode === 'now' ? 'Cancel reservation' : 'Send request');
        go.type = 'button';
        row.appendChild(keep); row.appendChild(go);
        box.appendChild(row);

        overlay.appendChild(box);
        document.body.appendChild(overlay);

        function close() {
            document.removeEventListener('keydown', onKey);
            overlay.remove();
        }
        function onKey(e) { if (e.key === 'Escape') close(); }
        document.addEventListener('keydown', onKey);
        overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) close(); });
        keep.addEventListener('click', close);

        go.addEventListener('click', async function () {
            var email = (opts.email || (emailInput && emailInput.value) || '').trim();
            if (!email) { msg.textContent = 'Please enter the email you used for this booking.'; if (emailInput) emailInput.focus(); return; }
            go.disabled = true; keep.disabled = true;
            go.textContent = 'Sending…';
            msg.textContent = '';
            try {
                var res = await fetch(API + '/bookings/cancel-request', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ reference_no: b.reference_no, email: email })
                });
                var data = await res.json().catch(function () { return {}; });
                if (res.ok && data.success) {
                    close();
                    if (opts.onDone) opts.onDone(data.status);
                    return;
                }
                msg.textContent = data.message || 'Could not send the cancellation.';
            } catch (err) {
                msg.textContent = 'Cannot connect to the server. Make sure node server.js is running.';
            }
            go.disabled = false; keep.disabled = false;
            go.textContent = mode === 'now' ? 'Cancel reservation' : 'Send request';
        });

        (emailInput || keep).focus();
    }

    /* ---------- reschedule ---------- */

    var START_CHOICES = [
        ['8:00 AM', 8], ['10:00 AM', 10], ['12:00 PM', 12], ['2:00 PM', 14],
        ['4:00 PM', 16], ['6:00 PM', 18], ['8:00 PM', 20]
    ];
    var CLOSING_HOUR = 22;

    function hourOf(text) {
        var m = /(\d{1,2}):\d{2}\s*(AM|PM)/i.exec(String(text || ''));
        if (!m) return null;
        var h = parseInt(m[1], 10) % 12;
        return m[2].toUpperCase() === 'PM' ? h + 12 : h;
    }

    function tomorrowIso() {
        var d = new Date();
        d.setDate(d.getDate() + 1);
        return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
    }

    /* an approved booking that is still ahead, has not been moved before and has no request waiting */
    function canReschedule(b) {
        return (b.booking_status || 'Pending') === 'Approved' &&
            dateOf(b) > todayIso() &&
            !b.reschedule_date &&
            (parseInt(b.reschedule_count, 10) || 0) < 1;
    }

    function hasPendingReschedule(b) {
        return (b.booking_status || 'Pending') === 'Approved' && !!b.reschedule_date;
    }

    function niceDate(iso) {
        var p = String(iso || '').split('T')[0].split('-');
        if (p.length !== 3) return iso;
        var m = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        return m[parseInt(p[1], 10) - 1] + ' ' + parseInt(p[2], 10) + ', ' + p[0];
    }

    /* which start times are free on that date for this booking (its own slot does not count as taken) */
    async function freeStarts(b, dateIso) {
        var duration = Math.max(1, parseInt(b.duration_hours, 10) || 1);
        var all = [];
        var status = 'available';
        try {
            var rs = await Promise.all([fetch(API + '/bookings/busy'), fetch(API + '/facility-status')]);
            all = await rs[0].json();
            var st = await rs[1].json();
            var key = String(b.facility || '').toLowerCase().split(' ')[0];
            if (st && st[key]) status = st[key];
        } catch (err) { /* the server checks again when the request is sent */ }

        var fac = String(b.facility || '').toLowerCase();
        var busy = (Array.isArray(all) ? all : []).filter(function (x) {
            var s = x.booking_status || 'Pending';
            return Number(x.id) !== Number(b.id) &&
                String(x.facility || '').toLowerCase() === fac &&
                dateOf(x) === dateIso &&
                s !== 'Rejected' && s !== 'Cancelled' && s !== 'Refunded';
        });

        return {
            courtStatus: status,
            slots: START_CHOICES.map(function (c) {
                var start = c[1], end = start + duration, ok = end <= CLOSING_HOUR;
                if (ok) {
                    ok = !busy.some(function (x) {
                        var s = hourOf(x.time_slot);
                        if (s === null) return false;
                        var e = s + Math.max(1, parseInt(x.duration_hours, 10) || 1);
                        return s < end && e > start;
                    });
                }
                return { label: c[0], ok: ok };
            })
        };
    }

    function openReschedule(opts) {
        var b = opts.booking;
        if (!canReschedule(b)) return;
        var duration = Math.max(1, parseInt(b.duration_hours, 10) || 1);

        var overlay = el('div', 'cx-overlay');
        var box = el('div', 'cx-dialog');
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-modal', 'true');

        box.appendChild(el('h3', 'cx-title', 'Reschedule reservation'));
        box.appendChild(el('p', 'cx-ref', b.reference_no + ' · ' + b.facility + ' · ' + duration + (duration > 1 ? ' hours' : ' hour')));
        box.appendChild(el('p', 'cx-text',
            'Current schedule: ' + niceDate(dateOf(b)) + ', ' + b.time_slot + '. Pick a new date and time on the same court. ' +
            'Your reservation stays as it is until the administrator approves the change. You can reschedule once.'));

        var dateLabel = el('label', 'cx-label', 'New date');
        var dateInput = el('input', 'cx-input');
        dateInput.type = 'date';
        dateInput.min = tomorrowIso();
        dateLabel.appendChild(dateInput);
        box.appendChild(dateLabel);

        var timeLabel = el('label', 'cx-label', 'New start time');
        timeLabel.style.marginTop = '12px';
        var timeSelect = el('select', 'cx-input');
        timeSelect.disabled = true;
        var first = el('option', null, 'Choose a date first');
        first.value = '';
        timeSelect.appendChild(first);
        timeLabel.appendChild(timeSelect);
        box.appendChild(timeLabel);

        var emailInput = null;
        if (!opts.email) {
            var emailLabel = el('label', 'cx-label', 'Email used for the booking');
            emailLabel.style.marginTop = '12px';
            emailInput = el('input', 'cx-input');
            emailInput.type = 'email';
            emailInput.placeholder = 'you@example.com';
            emailInput.autocomplete = 'email';
            emailLabel.appendChild(emailInput);
            box.appendChild(emailLabel);
        }

        var msg = el('p', 'cx-msg');
        msg.setAttribute('role', 'alert');
        box.appendChild(msg);

        var row = el('div', 'cx-actions');
        var keep = el('button', 'cx-btn', 'Keep current schedule');
        keep.type = 'button';
        var go = el('button', 'cx-btn cx-primary', 'Send request');
        go.type = 'button';
        row.appendChild(keep); row.appendChild(go);
        box.appendChild(row);

        overlay.appendChild(box);
        document.body.appendChild(overlay);

        function close() {
            document.removeEventListener('keydown', onKey);
            overlay.remove();
        }
        function onKey(e) { if (e.key === 'Escape') close(); }
        document.addEventListener('keydown', onKey);
        overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) close(); });
        keep.addEventListener('click', close);

        var loadSeq = 0;
        dateInput.addEventListener('change', async function () {
            var mine = ++loadSeq;
            msg.textContent = '';
            var picked = dateInput.value;
            timeSelect.innerHTML = '';
            timeSelect.disabled = true;
            if (!picked) { var o = el('option', null, 'Choose a date first'); o.value = ''; timeSelect.appendChild(o); return; }
            if (picked < tomorrowIso()) {
                msg.textContent = 'The new date must be after today.';
                var o2 = el('option', null, 'Choose a later date'); o2.value = ''; timeSelect.appendChild(o2);
                return;
            }
            var wait = el('option', null, 'Checking availability…'); wait.value = ''; timeSelect.appendChild(wait);

            var info = await freeStarts(b, picked);
            if (mine !== loadSeq) return;
            timeSelect.innerHTML = '';

            if (info.courtStatus !== 'available') {
                var o3 = el('option', null, 'This court is currently ' + info.courtStatus); o3.value = ''; timeSelect.appendChild(o3);
                msg.textContent = 'This court cannot be booked right now.';
                return;
            }
            var anyFree = info.slots.some(function (s) { return s.ok; });
            var ph = el('option', null, anyFree ? 'Choose a start time' : 'No free time on this date');
            ph.value = '';
            timeSelect.appendChild(ph);
            info.slots.forEach(function (s) {
                var opt = el('option', null, s.label + (s.ok ? '' : ' — not available'));
                opt.value = s.label;
                opt.disabled = !s.ok;
                timeSelect.appendChild(opt);
            });
            timeSelect.disabled = !anyFree;
            if (!anyFree) msg.textContent = 'Please pick another date.';
        });

        go.addEventListener('click', async function () {
            var email = (opts.email || (emailInput && emailInput.value) || '').trim();
            if (!dateInput.value) { msg.textContent = 'Please choose a new date.'; dateInput.focus(); return; }
            if (!timeSelect.value) { msg.textContent = 'Please choose a new start time.'; timeSelect.focus(); return; }
            if (!email) { msg.textContent = 'Please enter the email you used for this booking.'; if (emailInput) emailInput.focus(); return; }

            go.disabled = true; keep.disabled = true;
            go.textContent = 'Sending…';
            msg.textContent = '';
            try {
                var res = await fetch(API + '/bookings/reschedule-request', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        reference_no: b.reference_no,
                        email: email,
                        booking_date: dateInput.value,
                        time_slot: timeSelect.value
                    })
                });
                var data = await res.json().catch(function () { return {}; });
                if (res.ok && data.success) {
                    close();
                    if (opts.onDone) opts.onDone(data);
                    return;
                }
                msg.textContent = String(data.message || 'Could not send the request.').replace(/^⚠️\s*/, '').split('\n')[0];
            } catch (err) {
                msg.textContent = 'Cannot connect to the server. Make sure node server.js is running.';
            }
            go.disabled = false; keep.disabled = false;
            go.textContent = 'Send request';
        });

        dateInput.focus();
    }

    window.MSCancel = { mode: cancelMode, open: openDialog, canReschedule: canReschedule, hasPendingReschedule: hasPendingReschedule, reschedule: openReschedule };


    /* ---------- track-booking.html ---------- */

    var badge = document.querySelector('.tracking-status-badge');
    var refEl = document.querySelector('.tracking-reference');
    if (!badge || !refEl) return;

    function setMessage(title, desc) {
        var box = document.querySelector('.tracking-status-message');
        if (!box) return;
        var t = box.querySelector('strong'), p = box.querySelector('p');
        if (t) t.textContent = title;
        if (p) p.textContent = desc;
    }

    function clearSteps() {
        var steps = document.querySelectorAll('.progress-step');
        for (var i = 1; i < steps.length; i++) steps[i].classList.remove('active');
        for (var k = 1; k < steps.length; k++) {
            var s = steps[k].querySelector('span');
            if (s) s.textContent = k + 1;
        }
    }

    function peso(n) {
        return '₱' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function decorate(b) {
        var old = document.getElementById('cancelBox');
        if (old) old.remove();

        var status = b.booking_status || 'Pending';
        var card = document.querySelector('.tracking-preview-card');

        if (status === 'Cancel Requested') {
            setMessage('Cancellation requested',
                'Your request was sent. The administrator will confirm it. Your booking stays valid until then, so check this page again later.');
        } else if (status === 'Cancelled') {
            setMessage('Reservation cancelled — refund pending',
                'This reservation was cancelled. The management will return your payment of ' + peso(b.amount) + '. This page will show "Refunded" once it has been sent.');
            clearSteps();
        }

        if (status === 'Refunded' && String(b.cancelled_by || '') === 'customer') {
            setMessage('Cancellation — refund completed',
                'You cancelled this reservation and the management has returned your payment of ' + peso(b.amount) + '.');
        }

        if (hasPendingReschedule(b)) {
            setMessage('Reschedule requested',
                'You asked to move this reservation to ' + niceDate(b.reschedule_date) + ', ' + b.reschedule_time +
                '. It keeps its current schedule until the administrator approves the change, so check this page again later.');
        } else if (status === 'Approved' && (parseInt(b.reschedule_count, 10) || 0) > 0) {
            var note = document.querySelector('.tracking-status-message p');
            if (note && note.textContent.indexOf('rescheduled') === -1) note.textContent += ' This reservation was rescheduled.';
        }

        if (!card || (!cancelMode(b) && !canReschedule(b))) return;

        var box = el('div', 'cancel-box no-print');
        box.id = 'cancelBox';
        var p = el('p', 'cancel-note', canReschedule(b)
            ? 'Cannot make it on this date? You can move it to another schedule or cancel it before the date.'
            : 'Cannot make it? You can cancel this reservation before the date.');
        box.appendChild(p);

        var actions = el('div', 'cancel-actions');

        if (canReschedule(b)) {
            var moveBtn = el('button', 'resched-btn', 'Reschedule');
            moveBtn.type = 'button';
            moveBtn.addEventListener('click', function () {
                openReschedule({
                    booking: b,
                    onDone: function (data) {
                        b.reschedule_date = data.reschedule_date;
                        b.reschedule_time = data.reschedule_time;
                        decorate(b);
                    }
                });
            });
            actions.appendChild(moveBtn);
        }

        var btn = el('button', 'cancel-btn', 'Cancel reservation');
        btn.type = 'button';
        btn.addEventListener('click', function () {
            openDialog({
                booking: b,
                onDone: function (newStatus) {
                    b.booking_status = newStatus;
                    b.reschedule_date = null;
                    var strong = badge.querySelector('strong');
                    if (strong) strong.textContent = newStatus;
                    decorate(b);
                }
            });
        });
        if (cancelMode(b)) actions.appendChild(btn);

        box.appendChild(actions);
        card.appendChild(box);
    }

    var seq = 0;
    async function refresh() {
        var ref = (refEl.textContent || '').trim().toUpperCase();
        var mine = ++seq;
        if (!ref || ref === 'MS-2026-XXXX') return;
        try {
            var email = window.__trackEmail || '';
            if (!email) return;
            var res = await fetch(API + '/bookings/lookup?reference_no=' + encodeURIComponent(ref) + '&email=' + encodeURIComponent(email));
            var data = await res.json();
            if (mine !== seq) return;
            if (data && data.success && data.booking) decorate(data.booking);
        } catch (err) { /* the page already shows its own error */ }
    }

    /* script.js rewrites the badge each time a booking is shown */
    new MutationObserver(refresh).observe(badge, { childList: true });
})();