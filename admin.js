/* =========================================================
   MULTISPORT — ADMIN DASHBOARD ENGINE  (admin.js)

   Load this AFTER script.js on admin-dashboard.html.

   What it does
   - Replaces renderAdminDashboard / openAdminDetailsModal /
     updateBookingStatusInDB / deleteBookingFromDB with versions that
     use the new dashboard markup (script.js is NOT edited; its own
     DOMContentLoaded code simply calls the new functions).
   - Adds the revenue section (computed in the browser from
     GET /api/bookings, so no change to server.js is needed).
   - Escapes every booking field before it is put on the page
     (guests type their own name/email, so it must not be trusted).

   Revenue rules (reservation date is the date used)
   - Revenue    = Approved bookings whose reservation date has arrived (today or earlier)
   - Upcoming   = Approved bookings dated after today (own tile, not revenue yet)
   - Awaiting   = Pending / Cancel requested (paid by QR, waiting for the admin)
   - Refund due = Rejected / Cancelled with an amount, not yet Refunded
   - Refunded   = Refunded
========================================================= */

(function () {
    'use strict';

    var API = (typeof API_BASE !== 'undefined') ? API_BASE : 'http://localhost:5000/api';

    /* ---------- admin sign-in guard ----------
       The real protection is on the server (it refuses admin requests without a
       valid token). This only sends a signed-out visitor back to the login page. */
    function token() { try { return localStorage.getItem('multisportAdminToken') || ''; } catch (e) { return ''; } }
    function kickOut() {
        try {
            localStorage.removeItem('multisportAdminToken');
            localStorage.removeItem('multisportAdminSession');
        } catch (e) { /* ignore */ }
        window.location.replace('login.html');
    }
    if (!token()) { kickOut(); return; }

    /* fetch with the admin token; an expired token sends the admin back to log in */
    async function authFetch(url, opts) {
        opts = opts || {};
        opts.headers = Object.assign({ 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token() }, opts.headers || {});
        var res = await fetch(url, opts);
        if (res.status === 401) { kickOut(); throw new Error('Session expired'); }
        return res;
    }

    var COURTS = [
        { key: 'basketball', name: 'Basketball' },
        { key: 'volleyball', name: 'Volleyball' },
        { key: 'tennis', name: 'Tennis' },
        { key: 'badminton', name: 'Badminton' }
    ];

    var RANGE_LABEL = { today: 'Today', week: 'Last 7 days', month: 'This month', all: 'All time' };
    var PREV_LABEL = { today: 'yesterday', week: 'the previous 7 days', month: 'the same days last month' };
    var STATE_LABEL = { available: 'Available', maintenance: 'Under Maintenance', occupied: 'Occupied / Event' };

    var C_EARNED = '#0f6b3b';
    var C_HELD = '#d4920a';
    var C_DUE = '#b42318';
    var C_REFUNDED = '#3a74b8';

    var PAGE_SIZE = 10;

    var state = {
        filter: 'all',
        search: '',
        range: 'month',
        bookings: [],
        limit: PAGE_SIZE,
        cal: { month: '', court: 'all', sel: '' },
        tableView: false,
        trend: []
    };


    /* ---------- helpers ---------- */

    function $(id) { return document.getElementById(id); }

    function esc(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function num(v) {
        var n = parseFloat(v);
        return isFinite(n) ? n : 0;
    }

    function peso(n) {
        return '₱' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function pesoAxis(n, compact) {
        if (compact) {
            if (n >= 1e6) return '₱' + (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
            if (n >= 1e3) return '₱' + (n / 1e3).toFixed(n % 1e3 ? 1 : 0).replace(/\.0$/, '') + 'K';
        }
        return '₱' + n.toLocaleString('en-US');
    }

    function statusOf(b) { return b.booking_status || 'Pending'; }
    function dateOf(b) { return String(b.booking_date || '').split('T')[0].split(' ')[0]; }

    function iso(d) { return d.toLocaleDateString('en-CA'); }

    function fromIso(s) {
        var p = String(s).split('-');
        return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    }

    function addDays(s, n) {
        var d = fromIso(s);
        d.setDate(d.getDate() + n);
        return iso(d);
    }

    function courtKey(name) {
        var n = String(name || '').toLowerCase();
        for (var i = 0; i < COURTS.length; i++) {
            if (n.indexOf(COURTS[i].key) !== -1) return COURTS[i].key;
        }
        return 'other';
    }

    /* set by POST /api/bookings/cancel-request, so a customer cancellation can
       always be told apart from a booking the admin rejected (even after it is refunded) */
    function byCustomer(b) { return String(b.cancelled_by || '') === 'customer' || statusOf(b) === 'Cancel Requested'; }

    function pillOf(s) {
        if (s === 'Approved') return 'pill-approved';
        if (s === 'Rejected' || s === 'Cancelled') return 'pill-rejected';
        if (s === 'Refunded') return 'pill-refunded';
        if (s === 'Cancel Requested') return 'pill-cancel';
        return 'pill-pending';
    }

    /* an approved booking whose customer asked to move it to another date or time */
    function hasMove(b) { return statusOf(b) === 'Approved' && !!b.reschedule_date; }
    function moveText(b) { return String(b.reschedule_date || '').split('T')[0] + ', ' + (b.reschedule_time || ''); }

    function isRefundDue(b) {
        var s = statusOf(b);
        return (s === 'Rejected' || s === 'Cancelled') && num(b.amount) > 0;
    }

    function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

    function toast(message, isError) {
        var el = $('admToast');
        if (!el) return;
        el.textContent = message;
        el.classList.toggle('error', !!isError);
        el.classList.add('on');
        clearTimeout(toast._t);
        toast._t = setTimeout(function () { el.classList.remove('on'); }, 3200);
    }


    /* ---------- period windows ---------- */

    function windows(range, t) {
        if (range === 'today') {
            return { cur: [t, t], curTD: [t, t], prev: [addDays(t, -1), addDays(t, -1)] };
        }
        if (range === 'week') {
            var wk = [addDays(t, -6), t];
            return { cur: wk, curTD: wk, prev: [addDays(t, -13), addDays(t, -7)] };
        }
        if (range === 'month') {
            var d = fromIso(t);
            var first = iso(new Date(d.getFullYear(), d.getMonth(), 1));
            var prevFirst = new Date(d.getFullYear(), d.getMonth() - 1, 1);
            var prevDays = new Date(d.getFullYear(), d.getMonth(), 0).getDate();
            var prevEnd = new Date(prevFirst.getFullYear(), prevFirst.getMonth(), Math.min(d.getDate(), prevDays));
            /* revenue only counts reservations whose date has arrived; the % change
               compares this month so far vs the same days last month */
            return { cur: [first, t], curTD: [first, t], prev: [iso(prevFirst), iso(prevEnd)] };
        }
        return { cur: ['0000-01-01', t], curTD: ['0000-01-01', t], prev: null };
    }

    function earnedIn(list, win) {
        var sum = 0, count = 0;
        list.forEach(function (b) {
            if (statusOf(b) !== 'Approved') return;
            var d = dateOf(b);
            if (d >= win[0] && d <= win[1]) { sum += num(b.amount); count++; }
        });
        return { sum: sum, count: count };
    }


    /* ---------- render: everything ---------- */

    async function load() {
        var res = await authFetch(API + '/bookings');
        var data = await res.json();
        state.bookings = Array.isArray(data) ? data : [];
        window._adminAllBookings = state.bookings;
    }

    /* number of registered customers (GET /api/users/count, added to server.js) */
    async function loadUserCount() {
        var total = $('statUsers'), sub = $('statUsersSub');
        if (!total) return;
        try {
            var res = await authFetch(API + '/users/count');
            if (!res.ok) throw new Error('HTTP ' + res.status);
            var data = await res.json();
            if (typeof data.total === 'undefined') throw new Error('no total');
            total.textContent = Number(data.total);
            if (sub) sub.textContent = 'Customers with an account';
        } catch (err) {
            total.textContent = '—';
            if (sub) {
                var msg = String(err && err.message);
                sub.textContent = msg.indexOf('HTTP 404') !== -1
                    ? 'Add /api/users/count to server.js, then restart it'
                    : (msg.indexOf('HTTP 5') !== -1
                        ? 'Database error. Check the node server.js terminal'
                        : 'Cannot reach the server');
            }
        }
    }

    function paint() {
        paintCounts();
        paintRevenue();
        paintTable();
        paintCalendar();
        paintAlerts();
        paintSide();
        syncCourts();
    }

    /* Overview lists: today's schedule + bookings that need an admin action (read-only view of the same data) */
    function paintOverview() {
        var todayEl = $('ovToday'), actEl = $('ovAction');
        if (!todayEl || !actEl) return;
        var t = iso(new Date()), b = state.bookings;
        function row(x, tag) {
            var s = statusOf(x);
            return '<button type="button" class="ov-row" data-act="view" data-id="' + Number(x.id) + '">' +
                '<span class="ov-time">' + esc(tag) + '</span>' +
                '<span class="ov-main"><b>' + esc(x.fullname) + '</b><small>' + esc(x.facility) + ' · ' + esc(x.reference_no) + '</small></span>' +
                '<span class="pill ' + pillOf(s) + '">' + esc(s) + '</span></button>';
        }
        var today = b.filter(function (x) {
            var s = statusOf(x);
            return dateOf(x) === t && (s === 'Approved' || s === 'Pending' || s === 'Cancel Requested');
        }).sort(function (a, c) { return slotMinutes(a.time_slot) - slotMinutes(c.time_slot); });
        $('ovTodayCount').textContent = today.length;
        todayEl.innerHTML = today.length
            ? today.slice(0, 6).map(function (x) { return row(x, x.time_slot || ''); }).join('') +
              (today.length > 6 ? '<p class="ov-more">+ ' + (today.length - 6) + ' more today. See Calendar.</p>' : '')
            : '<p class="ov-empty">No bookings today.</p>';

        var todo = b.filter(function (x) {
            return statusOf(x) === 'Pending' || statusOf(x) === 'Cancel Requested' || hasMove(x) || isRefundDue(x);
        }).sort(function (a, c) { return String(c.created_at || '').localeCompare(String(a.created_at || '')); });
        $('ovActionCount').textContent = todo.length;
        actEl.innerHTML = todo.length
            ? todo.slice(0, 6).map(function (x) {
                var tag = statusOf(x) === 'Pending' ? 'Approve' : statusOf(x) === 'Cancel Requested' ? 'Cancel?' : hasMove(x) ? 'Move?' : 'Refund';
                return row(x, tag);
              }).join('') + (todo.length > 6 ? '<p class="ov-more">+ ' + (todo.length - 6) + ' more. See Reservations.</p>' : '')
            : '<p class="ov-empty">Nothing waiting. You are all caught up.</p>';
    }

    /* "Needs attention" panel in the sidebar */
    function paintSide() {
        var t = iso(new Date()), b = state.bookings;
        function put(id, n) {
            var el = $(id);
            if (!el) return;
            el.textContent = n;
            var alertish = n > 0 && id !== 'sideToday';
            el.classList.toggle('on', alertish);
            var card = el.closest('.attn-card');
            if (card) card.classList.toggle('has', alertish);
        }
        put('sideReview', b.filter(function (x) { return statusOf(x) === 'Pending'; }).length);
        put('sideCancel', b.filter(function (x) { return statusOf(x) === 'Cancel Requested'; }).length);
        put('sideMove', b.filter(hasMove).length);
        put('sideRefund', b.filter(isRefundDue).length);
        put('sideToday', b.filter(function (x) {
            var s = statusOf(x);
            return dateOf(x) === t && (s === 'Approved' || s === 'Pending' || s === 'Cancel Requested');
        }).length);

        /* "all caught up" message when none of the four action cards has anything */
        var clear = $('attnClear');
        if (clear) {
            var todo = ['sideReview', 'sideCancel', 'sideMove', 'sideRefund'].reduce(function (s, id) {
                return s + (parseInt(($(id) || {}).textContent, 10) || 0);
            }, 0);
            clear.hidden = todo > 0;
        }
        paintOverview();
    }

    window.renderAdminDashboard = async function (filter) {
        if (typeof filter === 'string') {
            if (filter !== state.filter) state.limit = PAGE_SIZE;
            state.filter = filter;
        }

        document.querySelectorAll('[data-admin-filter]').forEach(function (btn) {
            btn.classList.toggle('active', btn.getAttribute('data-admin-filter') === state.filter);
        });

        var chart = $('trendChart');
        if (chart) chart.classList.add('is-loading');

        try {
            await load();
            paint();
            loadUserCount();
        } catch (err) {
            console.error('Dashboard Fetch Error:', err);
            var body = $('adminTableBody');
            if (body) {
                body.innerHTML = '<tr><td colspan="7" class="table-empty table-error">Cannot load reservations. Make sure <code>node server.js</code> is running.</td></tr>';
            }
        } finally {
            if (chart) chart.classList.remove('is-loading');
        }
    };


    /* ---------- counts (ids kept from the old dashboard) ---------- */

    function paintCounts() {
        var b = state.bookings;
        function set(id, v) { var el = $(id); if (el) el.textContent = v; }
        set('statTotal', b.length);
        set('statPending', b.filter(function (x) { return statusOf(x) === 'Pending'; }).length);
        set('statApproved', b.filter(function (x) { return statusOf(x) === 'Approved'; }).length);
        set('statRejected', b.filter(function (x) {
            var s = statusOf(x);
            return s === 'Rejected' || s === 'Cancelled' || s === 'Refunded';
        }).length);
    }


    /* ---------- revenue ---------- */

    function paintRevenue() {
        var list = state.bookings;
        var t = iso(new Date());
        var w = windows(state.range, t);

        var cur = earnedIn(list, w.cur);
        var curTD = earnedIn(list, w.curTD);
        var prev = w.prev ? earnedIn(list, w.prev) : null;

        $('revLabel').textContent = 'Revenue · ' + RANGE_LABEL[state.range];
        $('revFigure').textContent = peso(cur.sum);
        $('revCount').textContent = cur.count;
        $('revAvg').textContent = peso(cur.count ? cur.sum / cur.count : 0);

        /* change vs previous period */
        var delta = $('revDelta');
        var tail = state.range === 'month' ? ', to date' : '';
        if (!prev) {
            delta.textContent = 'All approved reservations up to today.';
        } else if (prev.sum > 0) {
            var pct = (curTD.sum - prev.sum) / prev.sum * 100;
            var cls = pct > 0 ? 'up' : (pct < 0 ? 'down' : '');
            var arrow = pct > 0 ? '▲' : (pct < 0 ? '▼' : '–');
            delta.innerHTML = '<b class="' + cls + '">' + arrow + ' ' + Math.abs(pct).toFixed(1) + '%</b> vs ' + esc(PREV_LABEL[state.range]) + ' (' + esc(peso(prev.sum)) + ')' + tail;
        } else if (curTD.sum > 0) {
            delta.innerHTML = '<b class="up">▲ New</b> nothing earned ' + (state.range === 'today' ? 'yesterday' : 'in the previous period');
        } else {
            delta.textContent = 'No approved revenue in this period yet.';
        }

        /* status tiles (current state, not tied to the period) */
        var upcoming = { sum: 0, count: 0 }, held = { sum: 0, count: 0 }, due = { sum: 0, count: 0 }, refunded = { sum: 0, count: 0 }, approvedAll = { sum: 0, count: 0 };
        list.forEach(function (b) {
            var s = statusOf(b), a = num(b.amount);
            if (s === 'Approved') {
                approvedAll.sum += a; approvedAll.count++;
                if (dateOf(b) > t) { upcoming.sum += a; upcoming.count++; }
            } else if (s === 'Pending' || s === 'Cancel Requested') { held.sum += a; held.count++; }
            else if (isRefundDue(b)) { due.sum += a; due.count++; }
            else if (s === 'Refunded') { refunded.sum += a; refunded.count++; }
        });

        $('tileUpcoming').textContent = peso(upcoming.sum);
        $('tileUpcomingSub').textContent = plural(upcoming.count, 'booking', 'bookings') + ' not yet played';
        $('tileHeld').textContent = peso(held.sum);
        $('tileHeldSub').textContent = plural(held.count, 'booking waiting', 'bookings waiting');
        $('tileDue').textContent = peso(due.sum);
        $('tileDueSub').textContent = due.count ? plural(due.count, 'refund to process', 'refunds to process') : 'Nothing to refund';
        $('tileRefunded').textContent = peso(refunded.sum);
        $('tileRefundedSub').textContent = plural(refunded.count, 'refund completed', 'refunds completed');

        paintTrend(list, t);
        paintCourts(list, w.cur);
        paintLedger(approvedAll, upcoming, held, due, refunded);
    }


    /* trend chart */

    function niceStep(raw) {
        var exp = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
        var f = raw / exp;
        var n = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
        return n * exp;
    }

    var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    function trendRows(list, t) {
        var rows = [], i, d, key;
        var approved = list.filter(function (b) { return statusOf(b) === 'Approved' && dateOf(b) <= t; });

        if (state.range === 'all') {
            var first = approved.reduce(function (m, b) { var x = dateOf(b); return (!m || x < m) ? x : m; }, '');
            var lastD = approved.reduce(function (m, b) { var x = dateOf(b); return (!m || x > m) ? x : m; }, '');
            var endD = fromIso(t);
            var start = first ? fromIso(first) : endD;
            start = new Date(start.getFullYear(), start.getMonth(), 1);
            var cursor = new Date(endD.getFullYear(), endD.getMonth(), 1);
            var months = [];
            while (cursor >= start && months.length < 12) {
                months.unshift(new Date(cursor.getFullYear(), cursor.getMonth(), 1));
                cursor.setMonth(cursor.getMonth() - 1);
            }
            var multiYear = months.length && months[0].getFullYear() !== months[months.length - 1].getFullYear();
            months.forEach(function (m) {
                key = m.getFullYear() + '-' + ('0' + (m.getMonth() + 1)).slice(-2);
                rows.push({
                    key: key,
                    label: MONTHS[m.getMonth()] + (multiYear ? " '" + String(m.getFullYear()).slice(2) : ''),
                    full: MONTHS[m.getMonth()] + ' ' + m.getFullYear(),
                    prefix: true, value: 0, count: 0
                });
            });
        } else {
            var from;
            var until = t;
            if (state.range === 'month') {
                var td = fromIso(t);
                from = iso(new Date(td.getFullYear(), td.getMonth(), 1));
                until = t;
            } else {
                from = addDays(t, -6);
            }
            for (d = from; d <= until; d = addDays(d, 1)) {
                var dd = fromIso(d);
                rows.push({
                    key: d,
                    label: state.range === 'month' ? String(dd.getDate()) : DAYS[dd.getDay()],
                    full: DAYS[dd.getDay()] + ', ' + MONTHS[dd.getMonth()] + ' ' + dd.getDate(),
                    prefix: false, value: 0, count: 0
                });
            }
        }

        approved.forEach(function (b) {
            var d2 = dateOf(b);
            for (i = 0; i < rows.length; i++) {
                if (rows[i].prefix ? d2.indexOf(rows[i].key) === 0 : d2 === rows[i].key) {
                    rows[i].value += num(b.amount);
                    rows[i].count++;
                    break;
                }
            }
        });
        return rows;
    }

    function paintTrend(list, t) {
        var rows = trendRows(list, t);
        state.trend = rows;

        var monthly = state.range === 'all';
        $('trendTitle').textContent = monthly ? 'Monthly revenue' : 'Daily revenue';

        var total = rows.reduce(function (s, r) { return s + r.value; }, 0);
        var peak = rows.reduce(function (m, r) { return r.value > (m ? m.value : 0) ? r : m; }, null);
        var scope = state.range === 'month' ? 'This month' : (monthly ? 'Last ' + rows.length + (rows.length === 1 ? ' month' : ' months') : 'Last 7 days');
        $('trendSub').textContent = scope + ' · ' + peso(total) + (peak ? ' · best ' + (monthly ? 'month' : 'day') + ': ' + peak.full + ' (' + peso(peak.value) + ')' : '');

        var chart = $('trendChart');
        $('trendChart').setAttribute('aria-label', 'Revenue chart. ' + $('trendSub').textContent);

        if (!rows.length || total <= 0) {
            chart.innerHTML = '<div class="rc-empty">No approved revenue in this period yet.</div>';
            buildTrendTable(rows);
            return;
        }

        var maxV = rows.reduce(function (m, r) { return Math.max(m, r.value); }, 0);
        var step = niceStep(maxV / 4);
        var top = step * 4;
        var compact = top >= 10000;
        var every = rows.length > 14 ? Math.ceil(rows.length / 7) : 1;

        var grid = '';
        for (var i = 0; i <= 4; i++) {
            var px = 200 - i * 50;
            grid += '<div class="rc-line' + (i === 0 ? ' base' : '') + '" style="top:' + (i === 0 ? 199 : px) + 'px"><em>' + esc(pesoAxis(step * i, compact)) + '</em></div>';
        }

        var cols = rows.map(function (r, idx) {
            var h = r.value > 0 ? Math.max(r.value / top * 100, 1.2) : 0;
            var showLabel = idx % every === 0 || idx === rows.length - 1;
            return '<div class="rc-col' + (r.value > 0 ? '' : ' zero') + '" tabindex="0" data-i="' + idx + '">' +
                '<div class="rc-barwrap"><div class="rc-bar" style="height:' + h + '%"></div></div>' +
                '<div class="rc-lab">' + (showLabel ? esc(r.label) : '&nbsp;') + '</div></div>';
        }).join('');

        chart.innerHTML = '<div class="rc-grid">' + grid + '</div><div class="rc-cols">' + cols + '</div>';
        buildTrendTable(rows);
    }

    function buildTrendTable(rows) {
        var box = $('trendTable');
        if (!box) return;
        var html = '<table><thead><tr><th>Period</th><th>Bookings</th><th>Revenue</th></tr></thead><tbody>';
        rows.forEach(function (r) {
            html += '<tr><td>' + esc(r.full) + '</td><td>' + r.count + '</td><td>' + esc(peso(r.value)) + '</td></tr>';
        });
        box.innerHTML = html + '</tbody></table>';
    }


    /* revenue by court */

    function paintCourts(list, win) {
        var sums = {}, counts = {};
        COURTS.forEach(function (c) { sums[c.key] = 0; counts[c.key] = 0; });
        var total = 0;

        list.forEach(function (b) {
            if (statusOf(b) !== 'Approved') return;
            var d = dateOf(b);
            if (d < win[0] || d > win[1]) return;
            var k = courtKey(b.facility);
            if (!(k in sums)) return;
            sums[k] += num(b.amount);
            counts[k]++;
            total += num(b.amount);
        });

        var ordered = COURTS.slice().sort(function (a, b) { return sums[b.key] - sums[a.key]; });
        var max = sums[ordered[0].key] || 0;

        $('courtSub').textContent = RANGE_LABEL[state.range] + ' · approved bookings';

        $('courtRows').innerHTML = ordered.map(function (c) {
            var width = max > 0 ? sums[c.key] / max * 100 : 0;
            var share = total > 0 ? Math.round(sums[c.key] / total * 100) : 0;
            return '<div class="court-row">' +
                '<div class="court-row-top"><b>' + esc(c.name) + '</b><span>' + esc(peso(sums[c.key])) + '</span></div>' +
                '<div class="court-track"><div class="court-fill" style="width:' + width + '%"></div></div>' +
                '<small>' + esc(plural(counts[c.key], 'booking', 'bookings')) + ' · ' + share + '% of revenue</small>' +
                '</div>';
        }).join('');
    }


    /* money ledger */

    function paintLedger(approved, upcoming, held, due, refunded) {
        var total = approved.sum + held.sum + due.sum + refunded.sum;
        var parts = [
            { name: 'Approved', note: upcoming.sum > 0 ? 'incl. ' + peso(upcoming.sum) + ' upcoming' : plural(approved.count, 'booking', 'bookings'), v: approved.sum, c: C_EARNED },
            { name: 'Awaiting approval', note: plural(held.count, 'booking', 'bookings'), v: held.sum, c: C_HELD },
            { name: 'Refund due', note: plural(due.count, 'booking', 'bookings'), v: due.sum, c: C_DUE },
            { name: 'Refunded', note: plural(refunded.count, 'booking', 'bookings'), v: refunded.sum, c: C_REFUNDED }
        ];

        var bar = $('ledgerBar');
        bar.innerHTML = total > 0
            ? parts.filter(function (p) { return p.v > 0; }).map(function (p) {
                return '<i style="--seg:' + p.c + ';flex:' + p.v + ' 1 0"></i>';
            }).join('')
            : '';
        bar.setAttribute('aria-label', 'Payments received: ' + parts.map(function (p) { return p.name + ' ' + peso(p.v); }).join(', '));

        $('ledgerRows').innerHTML = parts.map(function (p) {
            var share = total > 0 ? Math.round(p.v / total * 100) : 0;
            return '<div class="ledger-row" style="--seg:' + p.c + '">' +
                '<div class="ledger-name">' + esc(p.name) + '</div>' +
                '<strong>' + esc(peso(p.v)) + '</strong>' +
                '<small>' + share + '% · ' + esc(p.note) + '</small></div>';
        }).join('');

        $('ledgerNote').innerHTML =
            '<span>Total received from customers <b>' + esc(peso(total)) + '</b></span>' +
            '<span>Kept so far (approved) <b>' + esc(peso(approved.sum)) + '</b></span>';
    }


    /* ---------- reservations table ---------- */

    function visibleBookings() {
        var q = state.search.trim().toLowerCase();
        return state.bookings.filter(function (b) {
            var s = statusOf(b).toLowerCase();
            if (state.filter === 'rejected') {
                /* same group as the "Rejected / cancelled" card: a refunded booking was a rejected one first */
                if (s !== 'rejected' && s !== 'cancelled' && s !== 'refunded') return false;
            } else if (state.filter === 'cancellations') {
                if (!byCustomer(b)) return false;
            } else if (state.filter === 'reschedules') {
                if (!hasMove(b)) return false;
            } else if (state.filter !== 'all' && s !== state.filter.toLowerCase()) {
                return false;
            }
            if (!q) return true;
            return [b.reference_no, b.fullname, b.email, b.facility, b.time_slot, dateOf(b)]
                .join(' ').toLowerCase().indexOf(q) !== -1;
        });
    }

    function paintTable() {
        var body = $('adminTableBody');
        if (!body) return;
        var rows = visibleBookings();

        var shown = rows.slice(0, state.limit);
        var more = rows.length - shown.length;

        var countEl = $('tableCount');
        if (countEl) {
            if (more > 0) {
                countEl.textContent = 'Showing ' + shown.length + ' of ' + plural(rows.length, 'reservation', 'reservations');
            } else {
                countEl.textContent = rows.length === state.bookings.length
                    ? 'Showing all ' + plural(rows.length, 'reservation', 'reservations')
                    : 'Showing ' + rows.length + ' of ' + plural(state.bookings.length, 'reservation', 'reservations');
            }
        }

        var moreBox = $('tableMore');
        if (moreBox) {
            moreBox.hidden = more <= 0;
            var moreBtn = $('tableMoreBtn');
            if (moreBtn) moreBtn.textContent = 'Show ' + Math.min(PAGE_SIZE, more) + ' more (' + more + ' left)';
        }

        if (!rows.length) {
            body.innerHTML = '<tr><td colspan="7" class="table-empty">' +
                (state.bookings.length ? 'No reservations match this filter.' : 'No reservation records found.') + '</td></tr>';
            return;
        }

        body.innerHTML = shown.map(function (b, index) {
            var s = statusOf(b);
            var pill = pillOf(s);

            var flag = '';
            if (isRefundDue(b)) flag = '<span class="refund-flag">Needs refund · ' + esc(peso(num(b.amount))) + '</span>';
            else if (s === 'Refunded') flag = '<span class="refund-done">Refund completed</span>';
            else if (s === 'Cancel Requested') flag = '<span class="refund-flag">Customer wants to cancel</span>';
            if (hasMove(b)) flag = '<span class="move-flag">Wants to move to ' + esc(moveText(b)) + '</span>';
            if (byCustomer(b) && s !== 'Cancel Requested') flag += '<span class="cell-sub by-customer">Cancelled by customer</span>';

            var id = Number(b.id);
            var actions = '<button type="button" class="abtn" data-act="view" data-id="' + id + '">View</button>';
            if (s === 'Pending') {
                actions += '<button type="button" class="abtn go" data-act="approve" data-id="' + id + '">Approve</button>' +
                           '<button type="button" class="abtn danger" data-act="reject" data-id="' + id + '">Reject</button>';
            } else if (s === 'Cancel Requested') {
                actions += '<button type="button" class="abtn danger" data-act="cancelok" data-id="' + id + '">Accept cancel</button>' +
                           '<button type="button" class="abtn go" data-act="cancelno" data-id="' + id + '">Keep booking</button>';
            } else if (hasMove(b)) {
                actions += '<button type="button" class="abtn go" data-act="moveok" data-id="' + id + '">Approve move</button>' +
                           '<button type="button" class="abtn" data-act="moveno" data-id="' + id + '">Decline</button>';
            } else if (isRefundDue(b)) {
                actions += '<button type="button" class="abtn go" data-act="refund" data-id="' + id + '">Process refund</button>';
            } else {
                actions += '<span class="resolved">Resolved</span>';
            }
            actions += '<button type="button" class="abtn quiet" data-act="remove" data-id="' + id + '" title="Remove this record">Remove</button>';

            return '<tr>' +
                '<td class="cell-no">' + (index + 1) + '</td>' +
                '<td><a href="#" class="ref-link" data-act="view" data-id="' + id + '">' + esc(b.reference_no) + '</a></td>' +
                '<td><span class="cell-strong">' + esc(b.fullname) + '</span><span class="cell-sub">' + esc(b.email) + '</span></td>' +
                '<td><span class="cell-strong">' + esc(b.facility) + '</span><span class="cell-money">Paid: ' + esc(peso(num(b.amount))) + '</span></td>' +
                '<td><span class="cell-strong nowrap">' + esc(dateOf(b)) + '</span><span class="cell-sub nowrap">' + esc(b.time_slot) + (b.duration_hours ? ' · ' + esc(b.duration_hours) + (Number(b.duration_hours) === 1 ? ' hr' : ' hrs') : '') + '</span></td>' +
                '<td><span class="pill ' + pill + '">' + esc(s) + '</span>' + flag + '</td>' +
                '<td><div class="row-actions">' + actions + '</div></td>' +
                '</tr>';
        }).join('');
    }



    /* ---------- calendar ---------- */

    var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    /* "10:00 AM" -> minutes after midnight */
    function slotMinutes(ts) {
        var m = /(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(String(ts || ''));
        if (!m) return 0;
        var h = Number(m[1]) % 12;
        if (m[3].toUpperCase() === 'PM') h += 12;
        return h * 60 + Number(m[2]);
    }

    function clock(min) {
        var h = Math.floor(min / 60) % 24;
        var m = min % 60;
        var ap = h >= 12 ? 'PM' : 'AM';
        var h12 = h % 12 || 12;
        return h12 + ':' + (m < 10 ? '0' : '') + m + ' ' + ap;
    }

    function slotRange(b) {
        var start = slotMinutes(b.time_slot);
        var hrs = num(b.duration_hours);
        return hrs > 0 ? clock(start) + ' – ' + clock(start + Math.round(hrs * 60)) : String(b.time_slot || '');
    }

    function calClass(b) {
        var s = statusOf(b);
        if (s === 'Approved') return 'approved';
        if (s === 'Cancel Requested') return 'cancel';
        return 'pending';
    }

    /* bookings that hold a court: approved, waiting for approval, or asking to cancel */
    function calBookings() {
        return state.bookings.filter(function (b) {
            var s = statusOf(b);
            if (s !== 'Approved' && s !== 'Pending' && s !== 'Cancel Requested') return false;
            return state.cal.court === 'all' || courtKey(b.facility) === state.cal.court;
        });
    }

    function byDay(list) {
        var map = {};
        list.forEach(function (b) {
            var d = dateOf(b);
            if (!d) return;
            (map[d] = map[d] || []).push(b);
        });
        Object.keys(map).forEach(function (d) {
            map[d].sort(function (a, b) { return slotMinutes(a.time_slot) - slotMinutes(b.time_slot); });
        });
        return map;
    }

    function ensureCalMonth() {
        var t = iso(new Date());
        if (!state.cal.month) state.cal.month = t.slice(0, 7);
        if (!state.cal.sel) state.cal.sel = t;
        if (state.cal.sel.slice(0, 7) !== state.cal.month) {
            state.cal.sel = state.cal.month === t.slice(0, 7) ? t : state.cal.month + '-01';
        }
    }

    function paintCalendar() {
        var grid = $('calGrid');
        if (!grid) return;
        ensureCalMonth();

        var parts = state.cal.month.split('-');
        var year = Number(parts[0]);
        var mon = Number(parts[1]) - 1;
        var first = new Date(year, mon, 1);
        var total = new Date(year, mon + 1, 0).getDate();
        var today = iso(new Date());
        var map = byDay(calBookings());

        var title = $('calTitle');
        if (title) title.textContent = MONTHS[mon] + ' ' + year;

        var html = '';
        for (var i = 0; i < first.getDay(); i++) html += '<span class="cal-blank" aria-hidden="true"></span>';

        for (var d = 1; d <= total; d++) {
            var key = state.cal.month + '-' + (d < 10 ? '0' : '') + d;
            var list = map[key] || [];
            var cls = 'cal-cell';
            if (key === today) cls += ' is-today';
            if (key === state.cal.sel) cls += ' is-selected';
            if (key < today) cls += ' is-past';
            if (list.length) cls += ' has-bookings';

            var chips = list.slice(0, 2).map(function (b) {
                return '<span class="cal-chip ' + calClass(b) + '"><b>' + esc(clock(slotMinutes(b.time_slot)).replace(':00', '')) + '</b> ' + esc(String(b.facility || '').replace(/ court$/i, '')) + '</span>';
            }).join('');
            if (list.length > 2) chips += '<span class="cal-more">+' + (list.length - 2) + ' more</span>';

            var dots = list.slice(0, 4).map(function (b) { return '<i class="' + calClass(b) + '"></i>'; }).join('');

            html += '<button type="button" class="' + cls + '" data-cal-day="' + key + '" aria-label="' + esc(DAYS[new Date(year, mon, d).getDay()] + ', ' + MONTHS[mon] + ' ' + d + ': ' + plural(list.length, 'booking', 'bookings')) + '">' +
                '<span class="cal-num">' + d + '</span>' +
                (list.length ? '<span class="cal-count">' + list.length + '</span>' : '') +
                '<span class="cal-chips">' + chips + '</span>' +
                '<span class="cal-dots">' + dots + '</span>' +
                '</button>';
        }
        grid.innerHTML = html;

        document.querySelectorAll('[data-cal-court]').forEach(function (btn) {
            btn.classList.toggle('active', btn.getAttribute('data-cal-court') === state.cal.court);
        });

        paintCalendarDay(map);
    }

    function paintCalendarDay(map) {
        var box = $('calDay');
        if (!box) return;
        map = map || byDay(calBookings());
        var key = state.cal.sel;
        var list = map[key] || [];
        var dt = fromIso(key);
        var heading = DAYS[dt.getDay()] + ', ' + MONTHS[dt.getMonth()] + ' ' + dt.getDate() + ', ' + dt.getFullYear();
        var scope = state.cal.court === 'all' ? '' : ' · ' + courtName(state.cal.court);

        var rows = list.length ? list.map(function (b) {
            var s = statusOf(b);
            return '<li class="cal-item ' + calClass(b) + '">' +
                '<div class="cal-time">' + esc(slotRange(b)) + '</div>' +
                '<div class="cal-who"><strong>' + esc(b.facility) + '</strong>' +
                    '<span>' + esc(b.fullname) + ' · ' + esc(b.reference_no) + '</span>' +
                    (hasMove(b) ? '<span class="move-flag">Wants to move to ' + esc(moveText(b)) + '</span>' : '') +
                '</div>' +
                '<span class="pill ' + pillOf(s) + '">' + esc(s) + '</span>' +
                '<button type="button" class="abtn" data-act="view" data-id="' + Number(b.id) + '">View</button>' +
                '</li>';
        }).join('') : '<li class="cal-empty">No bookings on this day' + (state.cal.court === 'all' ? '' : ' for this court') + '. All slots are open.</li>';

        box.innerHTML = '<div class="cal-day-head"><h3>' + esc(heading) + '</h3><span>' + plural(list.length, 'booking', 'bookings') + esc(scope) + '</span></div>' +
            '<ul class="cal-list">' + rows + '</ul>';
    }

    function courtName(key) {
        for (var i = 0; i < COURTS.length; i++) if (COURTS[i].key === key) return COURTS[i].name;
        return key;
    }

    function shiftMonth(delta) {
        var p = state.cal.month.split('-');
        var d = new Date(Number(p[0]), Number(p[1]) - 1 + delta, 1);
        state.cal.month = iso(d).slice(0, 7);
        state.cal.sel = '';
        paintCalendar();
    }

    function wireCalendar() {
        var grid = $('calGrid');
        if (!grid) return;
        ensureCalMonth();
        grid.addEventListener('click', function (e) {
            var cell = e.target.closest('[data-cal-day]');
            if (!cell) return;
            state.cal.sel = cell.getAttribute('data-cal-day');
            paintCalendar();
            var panel = $('calDay');
            if (panel && window.matchMedia('(max-width: 700px)').matches) {
                panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        });
        $('calPrev').addEventListener('click', function () { shiftMonth(-1); });
        $('calNext').addEventListener('click', function () { shiftMonth(1); });
        $('calToday').addEventListener('click', function () {
            var t = iso(new Date());
            state.cal.month = t.slice(0, 7);
            state.cal.sel = t;
            paintCalendar();
        });
        document.querySelectorAll('[data-cal-court]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                state.cal.court = btn.getAttribute('data-cal-court');
                paintCalendar();
            });
        });
    }


    /* ---------- alerts (refunds due) ---------- */

    function paintAlerts() {
        var due = state.bookings.filter(isRefundDue);
        var reqs = state.bookings.filter(function (b) { return statusOf(b) === 'Cancel Requested'; });
        var moves = state.bookings.filter(hasMove);
        var count = $('admAlertsCount');
        count.textContent = due.length + reqs.length + moves.length;
        count.classList.toggle('on', due.length + reqs.length + moves.length > 0);

        var total = due.reduce(function (s, b) { return s + num(b.amount); }, 0);
        $('admAlertsTotal').textContent = due.length ? peso(total) + ' to return' : '';

        function item(b, text) {
            return '<button type="button" class="adm-alert-item" data-act="view" data-id="' + Number(b.id) + '">' +
                '<b>' + esc(b.reference_no) + ' — ' + esc(b.fullname) + '</b><span>' + esc(text) + '</span></button>';
        }
        $('admAlertsList').innerHTML = (due.length || reqs.length || moves.length)
            ? reqs.map(function (b) { return item(b, 'Cancel request · ' + peso(num(b.amount))); }).join('') +
              moves.map(function (b) { return item(b, 'Reschedule request · ' + moveText(b)); }).join('') +
              due.map(function (b) { return item(b, 'Needs refund: ' + peso(num(b.amount))); }).join('')
            : '<div class="adm-alert-empty">No pending alerts.</div>';
    }

    function setAlerts(open) {
        var panel = $('admAlertsPanel');
        panel.classList.toggle('open', open);
        $('admAlertsBtn').setAttribute('aria-expanded', open ? 'true' : 'false');
    }


    /* ---------- dialogs ---------- */

    function showOverlay(el) { el.hidden = false; }
    function hideOverlay(el) { el.hidden = true; }

    var confirmResolve = null;

    function ask(opts) {
        return new Promise(function (resolve) {
            $('admConfirmTitle').textContent = opts.title;
            $('admConfirmText').textContent = opts.text;
            var ok = $('admConfirmOk');
            ok.textContent = opts.confirmLabel || 'Confirm';
            ok.className = 'abtn ' + (opts.danger ? 'solid-danger' : 'go');
            confirmResolve = resolve;
            showOverlay($('admConfirm'));
            ok.focus();
        });
    }

    function closeConfirm(result) {
        hideOverlay($('admConfirm'));
        if (confirmResolve) { var r = confirmResolve; confirmResolve = null; r(result); }
    }

    function findBooking(id) {
        id = Number(id);
        return state.bookings.filter(function (b) { return Number(b.id) === id; })[0];
    }

    window.openAdminDetailsModal = function (bookingId) {
        var b = findBooking(bookingId);
        if (!b) return;

        var s = statusOf(b);
        var pill = pillOf(s);
        var id = Number(b.id);

        function row(label, value) {
            return '<div class="detail-row"><span>' + esc(label) + '</span><strong>' + value + '</strong></div>';
        }

        var foot = '';
        if (s === 'Pending') {
            foot += '<button type="button" class="abtn danger" data-act="reject" data-id="' + id + '">Reject</button>' +
                    '<button type="button" class="abtn go" data-act="approve" data-id="' + id + '">Approve</button>';
        } else if (s === 'Cancel Requested') {
            foot += '<button type="button" class="abtn danger" data-act="cancelok" data-id="' + id + '">Accept cancel</button>' +
                    '<button type="button" class="abtn go" data-act="cancelno" data-id="' + id + '">Keep booking</button>';
        } else if (hasMove(b)) {
            foot += '<button type="button" class="abtn" data-act="moveno" data-id="' + id + '">Decline move</button>' +
                    '<button type="button" class="abtn go" data-act="moveok" data-id="' + id + '">Approve move</button>';
        } else if (isRefundDue(b)) {
            foot += '<button type="button" class="abtn go" data-act="refund" data-id="' + id + '">Process refund</button>';
        }
        foot += '<button type="button" class="abtn" data-act="close">Close</button>';

        var modal = $('adminDetailsModalPopup');
        modal.innerHTML =
            '<div class="adm-dialog" role="dialog" aria-modal="true" aria-labelledby="admDetailTitle">' +
                '<button type="button" class="adm-x" data-act="close" aria-label="Close">✕</button>' +
                '<div class="adm-dialog-head"><h3 id="admDetailTitle">Reservation details</h3><p>' + esc(b.reference_no) + '</p></div>' +
                '<div class="adm-dialog-body">' +
                    row('Payment ref', esc(b.payment_ref || 'N/A')) +
                    row('Full name', esc(b.fullname)) +
                    row('Email address', esc(b.email)) +
                    row('Contact number', esc(b.phone || 'N/A')) +
                    row('Address', esc(b.address || 'N/A')) +
                    row('Purpose', esc(b.purpose || 'N/A')) +
                    '<div class="detail-rule"></div>' +
                    row('Facility', esc(b.facility)) +
                    row('Schedule', esc(dateOf(b)) + ' (' + esc(b.time_slot) + ')') +
                    (b.duration_hours ? row('Duration', esc(b.duration_hours) + (Number(b.duration_hours) === 1 ? ' hour' : ' hours')) : '') +
                    row('Amount paid', esc(peso(num(b.amount)))) +
                    '<div class="detail-proof"><span>Payment screenshot</span><div id="proofBox" class="proof-box">' +
                        (b.payment_proof ? 'Loading…' : '<em>No screenshot (booked before this feature)</em>') + '</div></div>' +
                    (hasMove(b) ? row('Requested move', '<span class="move-flag inline">' + esc(moveText(b)) + '</span>') : '') +
                    (statusOf(b) === 'Approved' && Number(b.reschedule_count) > 0 ? row('Rescheduled', 'Once already') : '') +
                    row('Status', '<span class="pill ' + pill + '">' + esc(s) + '</span>') +
                    (byCustomer(b) ? row('Cancelled by', 'Customer') : '') +
                '</div>' +
                '<div class="adm-dialog-foot">' + foot + '</div>' +
            '</div>';
        showOverlay(modal);
        if (b.payment_proof) loadProof(id);
        var first = modal.querySelector('.adm-dialog-foot .abtn:last-child');
        if (first) first.focus();
    };

    /* the screenshot can only be fetched with the admin token, so it is loaded as a blob */
    var proofUrl = '';

    async function loadProof(id) {
        var box = $('proofBox');
        if (!box) return;
        try {
            var res = await authFetch(API + '/bookings/' + Number(id) + '/payment-proof');
            if (!res.ok) throw new Error('HTTP ' + res.status);
            var blob = await res.blob();
            if (proofUrl) URL.revokeObjectURL(proofUrl);
            proofUrl = URL.createObjectURL(blob);
            if ($('proofBox') !== box) return; /* the details window was changed meanwhile */
            box.innerHTML = '';
            var img = document.createElement('img');
            img.className = 'proof-thumb';
            img.alt = 'Payment screenshot. Click to enlarge';
            img.src = proofUrl;
            img.tabIndex = 0;
            img.addEventListener('click', openProofLarge);
            img.addEventListener('keydown', function (e) { if (e.key === 'Enter') openProofLarge(); });
            box.appendChild(img);
            var hint = document.createElement('small');
            hint.textContent = 'Click the picture to enlarge. Compare the amount and reference number with your GCash.';
            box.appendChild(hint);
        } catch (err) {
            if ($('proofBox') === box) box.innerHTML = '<em>The screenshot could not be loaded.</em>';
        }
    }

    function openProofLarge() {
        if (!proofUrl) return;
        var layer = document.createElement('div');
        layer.className = 'proof-lightbox';
        layer.setAttribute('role', 'dialog');
        layer.setAttribute('aria-label', 'Payment screenshot');
        var big = document.createElement('img');
        big.src = proofUrl;
        big.alt = 'Payment screenshot (enlarged)';
        layer.appendChild(big);
        function close() {
            document.removeEventListener('keydown', onKey, true);
            layer.remove();
        }
        function onKey(e) {
            if (e.key === 'Escape') { e.stopPropagation(); close(); }
        }
        document.addEventListener('keydown', onKey, true);
        layer.addEventListener('click', close);
        document.body.appendChild(layer);
    }

    function closeDetails() { hideOverlay($('adminDetailsModalPopup')); }


    /* ---------- actions ---------- */

    window.updateBookingStatusInDB = async function (id, newStatus) {
        var b = findBooking(id);
        var ref = b ? b.reference_no : '#' + id;

        if (newStatus === 'Rejected') {
            var okReject = await ask({
                title: 'Reject booking?',
                text: 'Reject ' + ref + (b ? ' (' + peso(num(b.amount)) + ')' : '') + '? The customer has already paid, so it will be flagged as needing a refund.',
                confirmLabel: 'Reject booking',
                danger: true
            });
            if (!okReject) return;
        } else if (newStatus === 'Cancelled') {
            var okCancel = await ask({
                title: 'Accept cancellation?',
                text: 'Cancel ' + ref + (b ? ' (' + peso(num(b.amount)) + ')' : '') + '? The slot opens up again and the booking is flagged as needing a refund.',
                confirmLabel: 'Accept cancel',
                danger: true
            });
            if (!okCancel) return;
        } else if (newStatus === 'Refunded') {
            var okRefund = await ask({
                title: 'Mark as refunded?',
                text: 'Confirm only after you have sent ' + (b ? peso(num(b.amount)) : 'the money') + ' back to ' + (b ? b.fullname : 'the customer') + '.',
                confirmLabel: 'Mark refunded'
            });
            if (!okRefund) return;
        }

        try {
            var res = await authFetch(API + '/bookings/' + id, {
                method: 'PUT',
                body: JSON.stringify({ booking_status: newStatus })
            });
            var data = await res.json();
            if (data.success) {
                closeDetails();
                toast(ref + ' marked ' + newStatus + '.');
                await window.renderAdminDashboard(state.filter);
            } else {
                toast(data.message || 'Could not update the booking.', true);
            }
        } catch (err) {
            console.error('Error updating status:', err);
            toast('Cannot connect to server.', true);
        }
    };

    window.deleteBookingFromDB = async function (id, refNo) {
        var b = findBooking(id);
        var ref = refNo || (b ? b.reference_no : '#' + id);
        var ok = await ask({
            title: 'Remove booking?',
            text: 'Remove booking record ' + ref + '? It will disappear from the dashboard and from revenue totals.',
            confirmLabel: 'Remove',
            danger: true
        });
        if (!ok) return;

        try {
            var res = await authFetch(API + '/bookings/' + id, { method: 'DELETE' });
            var data = await res.json();
            if (data.success) {
                closeDetails();
                toast('Booking ' + ref + ' removed.');
                await window.renderAdminDashboard(state.filter);
            } else {
                toast(data.message || 'Failed to remove booking.', true);
            }
        } catch (err) {
            console.error('Error soft deleting booking:', err);
            toast('Cannot connect to server.', true);
        }
    };

    /* approve or decline a customer's reschedule request */
    async function decideReschedule(id, decision) {
        var b = findBooking(id);
        if (!b) return;
        var ref = b.reference_no;
        var ok = await ask(decision === 'approve' ? {
            title: 'Approve the move?',
            text: ref + ' will move from ' + dateOf(b) + ' (' + b.time_slot + ') to ' + moveText(b) + '. The price stays the same.',
            confirmLabel: 'Approve move'
        } : {
            title: 'Decline the move?',
            text: ref + ' will stay on ' + dateOf(b) + ' (' + b.time_slot + '). The customer will still be able to ask again.',
            confirmLabel: 'Decline',
            danger: true
        });
        if (!ok) return;

        try {
            var res = await authFetch(API + '/bookings/' + Number(id) + '/reschedule-decision', {
                method: 'POST',
                body: JSON.stringify({ decision: decision })
            });
            var data = await res.json().catch(function () { return {}; });
            if (res.ok && data.success) {
                closeDetails();
                toast(decision === 'approve' ? ref + ' moved to ' + moveText(b) + '.' : 'Move request for ' + ref + ' declined.');
                await window.renderAdminDashboard(state.filter);
            } else {
                toast(String(data.message || 'Could not save the decision.').replace(/^⚠️\s*/, '').split('\n')[0], true);
            }
        } catch (err) {
            console.error('Reschedule decision error:', err);
            toast('Cannot connect to server.', true);
        }
    }

    function runAction(act, id) {
        if (act === 'view') window.openAdminDetailsModal(id);
        else if (act === 'approve') window.updateBookingStatusInDB(id, 'Approved');
        else if (act === 'reject') window.updateBookingStatusInDB(id, 'Rejected');
        else if (act === 'refund') window.updateBookingStatusInDB(id, 'Refunded');
        else if (act === 'cancelok') window.updateBookingStatusInDB(id, 'Cancelled');
        else if (act === 'cancelno') window.updateBookingStatusInDB(id, 'Approved');
        else if (act === 'moveok') decideReschedule(id, 'approve');
        else if (act === 'moveno') decideReschedule(id, 'decline');
        else if (act === 'remove') window.deleteBookingFromDB(id);
        else if (act === 'close') closeDetails();
    }


    /* ---------- courts ---------- */

    function syncCourts() {
        COURTS.forEach(function (c) {
            var sel = $('status_' + c.key);
            var card = $('court_' + c.key);
            if (!sel || !card) return;
            card.dataset.state = sel.value;
            var chip = card.querySelector('.court-state');
            if (chip) chip.textContent = STATE_LABEL[sel.value] || sel.value;
        });
    }


    /* ---------- chart tooltip ---------- */

    function showTip(col) {
        var r = state.trend[Number(col.getAttribute('data-i'))];
        if (!r) return;
        var tip = $('admTip');
        tip.textContent = '';
        var strong = document.createElement('strong');
        strong.textContent = peso(r.value);
        tip.appendChild(strong);
        tip.appendChild(document.createTextNode(r.full + ' · ' + plural(r.count, 'booking', 'bookings')));
        tip.classList.add('on');

        var box = col.getBoundingClientRect();
        var tw = tip.offsetWidth, th = tip.offsetHeight;
        var left = Math.min(Math.max(8, box.left + box.width / 2 - tw / 2), window.innerWidth - tw - 8);
        var topPos = box.top + 8;
        var bar = col.querySelector('.rc-bar');
        if (bar) topPos = bar.getBoundingClientRect().top - th - 10;
        if (topPos < 8) topPos = box.top + 8;
        tip.style.left = left + 'px';
        tip.style.top = topPos + 'px';
    }

    function hideTip() { $('admTip').classList.remove('on'); }


    /* ---------- wiring ---------- */

    document.addEventListener('DOMContentLoaded', function () {
        if (!document.querySelector('.admin-body')) return;

        var dateEl = $('admDate');
        if (dateEl) {
            dateEl.textContent = new Date().toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
        }

        /* sidebar shortcuts: jump to Reservations with the matching filter */
        [document.querySelector('.adm-attn'), document.querySelector('.ov-grid')].forEach(function (desk) {
        if (desk) {
            desk.addEventListener('click', function (e) {
                var btn = e.target.closest('[data-side-go]');
                if (!btn) return;
                var go = btn.getAttribute('data-side-go');
                var search = $('adminSearch');
                if (go === 'today') {
                    search.value = iso(new Date());
                    state.search = search.value;
                    window.renderAdminDashboard('all');
                } else {
                    search.value = '';
                    state.search = '';
                    window.renderAdminDashboard(go);
                }
                if (window.admShowView) window.admShowView('reservations');
            });
        }
        });

        /* period selector */
        $('revRange').addEventListener('click', function (e) {
            var btn = e.target.closest('[data-range]');
            if (!btn) return;
            state.range = btn.getAttribute('data-range');
            document.querySelectorAll('#revRange button').forEach(function (b) { b.classList.toggle('active', b === btn); });
            paintRevenue();
        });

        /* chart <-> table */
        $('trendTableBtn').addEventListener('click', function () {
            state.tableView = !state.tableView;
            this.setAttribute('aria-pressed', state.tableView ? 'true' : 'false');
            this.textContent = state.tableView ? 'Chart view' : 'Table view';
            $('trendChart').hidden = state.tableView;
            $('trendTable').hidden = !state.tableView;
            hideTip();
        });

        /* chart tooltip (hover + keyboard focus) */
        var chart = $('trendChart');
        chart.addEventListener('pointerover', function (e) {
            var col = e.target.closest('.rc-col');
            if (col) showTip(col);
        });
        chart.addEventListener('pointerleave', hideTip);
        chart.addEventListener('focusin', function (e) {
            var col = e.target.closest('.rc-col');
            if (col) showTip(col);
        });
        chart.addEventListener('focusout', hideTip);

        /* search */
        $('adminSearch').addEventListener('input', function () {
            state.search = this.value;
            state.limit = PAGE_SIZE;
            paintTable();
        });

        wireCalendar();

        /* show more reservations */
        var moreBtn = $('tableMoreBtn');
        if (moreBtn) {
            moreBtn.addEventListener('click', function () {
                state.limit += PAGE_SIZE;
                paintTable();
            });
        }

        /* table + alert + dialog actions (one delegated handler) */
        document.addEventListener('click', function (e) {
            var actEl = e.target.closest('[data-act]');
            if (actEl) {
                e.preventDefault();
                if (actEl.closest('#admAlertsPanel')) setAlerts(false);
                runAction(actEl.getAttribute('data-act'), actEl.getAttribute('data-id'));
                return;
            }

            if (e.target.closest('#admAlertsBtn')) {
                setAlerts(!$('admAlertsPanel').classList.contains('open'));
                return;
            }
            if (!e.target.closest('#admAlertsPanel')) setAlerts(false);

            if (e.target === $('adminDetailsModalPopup')) closeDetails();
            if (e.target === $('admConfirm')) closeConfirm(false);
        });

        $('admConfirmOk').addEventListener('click', function () { closeConfirm(true); });
        $('admConfirmCancel').addEventListener('click', function () { closeConfirm(false); });

        document.addEventListener('keydown', function (e) {
            if (e.key !== 'Escape') return;
            if (!$('admConfirm').hidden) closeConfirm(false);
            else if (!$('adminDetailsModalPopup').hidden) closeDetails();
            else setAlerts(false);
        });

        /* court status selects (script.js saves the value; this repaints the cards) */
        document.addEventListener('change', function (e) {
            if (e.target.classList && e.target.classList.contains('facility-status-select')) syncCourts();
        });
        window.addEventListener('storage', syncCourts);
        syncCourts();

        /* logout also clears the admin session */
        var logout = $('adminLogoutBtn');
        if (logout) {
            logout.addEventListener('click', function () {
                /* tell the server to forget the token, then clear it here */
                try {
                    fetch(API + '/admin/logout', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token() }, keepalive: true });
                } catch (err) { /* ignore */ }
                try {
                    localStorage.removeItem('multisportAdminSession');
                    localStorage.removeItem('multisportAdminToken');
                } catch (err) { /* ignore */ }
            });
        }

        /* ---------- Users tab: list, search, booking count, disable / enable ---------- */
        (function () {
            var users = [], uFilter = 'all', uSearch = '', uLimit = PAGE_SIZE, loaded = false;
            var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

            function fmtDay(v) {
                var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ''));
                return m ? MONTHS[Number(m[2]) - 1] + ' ' + Number(m[3]) + ', ' + m[1] : '—';
            }
            function fullName(u) {
                var n = ((u.firstName || '') + ' ' + (u.lastName || '')).trim();
                return n || '(no name)';
            }
            function shown() {
                var q = uSearch.toLowerCase();
                return users.filter(function (u) {
                    if (uFilter === 'active' && u.disabled) return false;
                    if (uFilter === 'disabled' && !u.disabled) return false;
                    if (!q) return true;
                    return [fullName(u), u.email, u.phone].join(' ').toLowerCase().indexOf(q) !== -1;
                });
            }

            function paintUsers() {
                var body = $('usrBody');
                if (!body) return;
                var off = users.filter(function (u) { return u.disabled; }).length;
                $('usrTotal').textContent = users.length;
                $('usrActive').textContent = users.length - off;
                $('usrDisabled').textContent = off;

                document.querySelectorAll('[data-user-filter]').forEach(function (btn) {
                    btn.classList.toggle('active', btn.getAttribute('data-user-filter') === uFilter);
                });

                var rows = shown(), part = rows.slice(0, uLimit), more = rows.length - part.length;
                $('usrCount').textContent = more > 0
                    ? 'Showing ' + part.length + ' of ' + plural(rows.length, 'user', 'users')
                    : 'Showing ' + plural(rows.length, 'user', 'users');
                $('usrMore').hidden = more <= 0;
                $('usrMoreBtn').textContent = 'Show ' + Math.min(PAGE_SIZE, more) + ' more (' + more + ' left)';

                if (!rows.length) {
                    body.innerHTML = '<tr><td colspan="7" class="table-empty">' +
                        (loaded ? (users.length ? 'No users match this search.' : 'No customer has created an account yet.') : 'Loading…') + '</td></tr>';
                    return;
                }
                body.innerHTML = part.map(function (u, i) {
                    var bk = u.booking_count
                        ? '<span class="cell-strong">' + u.booking_count + '</span><span class="cell-sub nowrap">' +
                          (u.active_count ? u.active_count + ' active · ' : '') + 'last ' + esc(fmtDay(u.last_booking)) + '</span>'
                        : '<span class="cell-sub">No bookings yet</span>';
                    return '<tr class="' + (u.disabled ? 'row-disabled' : '') + '">' +
                        '<td class="cell-no">' + (i + 1) + '</td>' +
                        '<td><span class="cell-strong">' + esc(fullName(u)) + '</span><span class="cell-sub">' + esc(u.email) + '</span></td>' +
                        '<td><span class="cell-sub nowrap">' + esc(u.phone || '—') + '</span></td>' +
                        '<td><span class="cell-strong nowrap">' + esc(fmtDay(u.created_at)) + '</span></td>' +
                        '<td>' + bk + '</td>' +
                        '<td><span class="pill ' + (u.disabled ? 'pill-rejected' : 'pill-approved') + '">' + (u.disabled ? 'Disabled' : 'Active') + '</span></td>' +
                        '<td><div class="row-actions">' + (u.disabled
                            ? '<button type="button" class="abtn go" data-user-act="enable" data-id="' + u.id + '">Enable</button>'
                            : '<button type="button" class="abtn danger" data-user-act="disable" data-id="' + u.id + '">Disable</button>') +
                        '</div></td></tr>';
                }).join('');
            }

            window.admLoadUsers = async function () {
                try {
                    var res = await authFetch(API + '/admin/users');
                    if (!res.ok) throw new Error('HTTP ' + res.status);
                    var data = await res.json();
                    users = Array.isArray(data) ? data : [];
                    loaded = true;
                    paintUsers();
                } catch (err) {
                    loaded = true;
                    var body = $('usrBody');
                    if (body && !users.length) {
                        var msg = String(err && err.message);
                        body.innerHTML = '<tr><td colspan="7" class="table-empty">' +
                            (msg.indexOf('HTTP 404') !== -1 ? 'Update server.js, then restart it (node server.js).' : 'Could not load users. Check the node server.js terminal.') + '</td></tr>';
                    }
                }
            };

            document.addEventListener('click', async function (e) {
                var f = e.target.closest('[data-user-filter]');
                if (f) { uFilter = f.getAttribute('data-user-filter'); uLimit = PAGE_SIZE; paintUsers(); return; }
                if (e.target.closest('#usrMoreBtn')) { uLimit += PAGE_SIZE; paintUsers(); return; }
                var btn = e.target.closest('[data-user-act]');
                if (!btn) return;
                var id = Number(btn.getAttribute('data-id'));
                var u = users.filter(function (x) { return x.id === id; })[0];
                if (!u) return;
                var off = btn.getAttribute('data-user-act') === 'disable';
                var ok = await ask({
                    title: off ? 'Disable this account?' : 'Enable this account?',
                    text: off
                        ? fullName(u) + ' (' + u.email + ') will be signed out and will not be able to log in until you enable the account again. Their existing bookings are not changed.'
                        : fullName(u) + ' (' + u.email + ') will be able to log in again.',
                    confirmLabel: off ? 'Disable account' : 'Enable account',
                    danger: off
                });
                if (!ok) return;
                try {
                    var res = await authFetch(API + '/admin/users/' + id + '/disabled', { method: 'PUT', body: JSON.stringify({ disabled: off }) });
                    var data = await res.json().catch(function () { return {}; });
                    if (!res.ok || !data.success) throw new Error(data.message || 'Could not update the account.');
                    u.disabled = off;
                    paintUsers();
                    toast(off ? 'Account disabled.' : 'Account enabled.');
                } catch (err) {
                    toast(err.message || 'Could not update the account.', true);
                }
            });

            var us = $('usrSearch');
            if (us) us.addEventListener('input', function () { uSearch = us.value.trim(); uLimit = PAGE_SIZE; paintUsers(); });
        })();

        /* one view at a time: the sidebar switches between Overview, Revenue,
           Reservations, Calendar and Courts instead of one very long page */
        var VIEWS = ['overview', 'revenue', 'reservations', 'users', 'calendar', 'facilityControlSection'];
        var mainEl = document.querySelector('.adm-main');
        var navLinks = document.querySelectorAll('.adm-nav a[data-nav]');
        window.admShowView = function (id, keepScroll) {
            if (VIEWS.indexOf(id) < 0) id = 'overview';
            if (mainEl) mainEl.setAttribute('data-view', id);
            navLinks.forEach(function (a) { a.classList.toggle('active', a.getAttribute('data-nav') === id); });
            try { history.replaceState(null, '', '#' + id); } catch (err) { /* ignore */ }
            if (id === 'users' && window.admLoadUsers) window.admLoadUsers();
            if (!keepScroll) window.scrollTo(0, 0);
        };
        navLinks.forEach(function (a) {
            a.addEventListener('click', function (e) {
                e.preventDefault();
                window.admShowView(a.getAttribute('data-nav'));
            });
        });
        window.addEventListener('hashchange', function () {
            window.admShowView(location.hash.replace('#', ''), true);
        });
        window.admShowView(location.hash.replace('#', ''), true);

        /* keep the numbers fresh while the page stays open */
        setInterval(function () {
            if (document.visibilityState !== 'visible') return;
            if (!$('adminDetailsModalPopup').hidden || !$('admConfirm').hidden) return;
            window.renderAdminDashboard(state.filter);
        }, 30000);
    });
})();