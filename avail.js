/* =========================================================
   MultiSport - home page availability calendar

   Shows, for every day of a month, which courts still have open start times.
   Data comes from GET /api/availability (free times only, no personal data).
   Picking a free time sends the visitor to the booking page with the court,
   date and time already chosen (same hand-off the old Search Slot used).
   ========================================================= */
(function () {
    'use strict';

    var panel = document.getElementById('availPanel');
    if (!panel) return;

    var API = (typeof API_BASE !== 'undefined') ? API_BASE : 'http://localhost:5000/api';

    var COURTS = [
        { key: 'basketball', name: 'Basketball', short: 'Basketball Court' },
        { key: 'volleyball', name: 'Volleyball', short: 'Volleyball Court' },
        { key: 'tennis',     name: 'Tennis',     short: 'Tennis Court' },
        { key: 'badminton',  name: 'Badminton',  short: 'Badminton Court' }
    ];
    var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    var MAX_AHEAD = 3;                       /* how many months ahead can be browsed */

    var el = {
        chips: document.getElementById('availChips'),
        label: document.getElementById('availMonthLabel'),
        grid: document.getElementById('availGrid'),
        day: document.getElementById('availDay'),
        legend: document.getElementById('availLegend'),
        prev: document.getElementById('availPrev'),
        next: document.getElementById('availNext'),
        select: document.getElementById('homeSportSelect'),
        viewBtn: document.getElementById('homeCalendarBtn'),
        closeBtn: document.getElementById('availClose')
    };

    var state = { month: '', today: '', data: null, filter: '', selected: '', startMonth: '', error: '' };

    function make(tag, cls, text) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text != null) n.textContent = text;
        return n;
    }
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    function addMonths(ym, delta) {
        var p = ym.split('-'), d = new Date(+p[0], +p[1] - 1 + delta, 1);
        return d.getFullYear() + '-' + pad(d.getMonth() + 1);
    }
    function niceDay(dateStr) {
        var p = dateStr.split('-'), d = new Date(+p[0], +p[1] - 1, +p[2]);
        return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getDay()] + ', ' +
            MONTHS[+p[1] - 1] + ' ' + (+p[2]);
    }
    function visibleCourts() {
        return state.filter ? COURTS.filter(function (c) { return c.key === state.filter; }) : COURTS;
    }

    /* free / almost full / full for one court on one day */
    /* total = start times still ahead (times that already passed today are not counted) */
    function level(freeCount, total, courtStatus) {
        if (courtStatus && courtStatus !== 'available') return 'off';
        if (total <= 0) return 'ended';
        if (freeCount === 0) return 'full';
        return freeCount <= Math.ceil(total * 0.4) ? 'low' : 'open';
    }
    function passedList(date) {
        return (state.data && date === state.data.today && state.data.passed) || [];
    }

    /* ---------- court filter (chips + the Sport select in the bar stay in step) ---------- */
    function buildChips() {
        el.chips.textContent = '';
        [{ key: '', name: 'All courts' }].concat(COURTS).forEach(function (c) {
            var b = make('button', 'avail-chip' + (state.filter === c.key ? ' on' : ''), c.name);
            b.type = 'button';
            b.setAttribute('aria-pressed', state.filter === c.key ? 'true' : 'false');
            b.addEventListener('click', function () { setFilter(c.key); });
            el.chips.appendChild(b);
        });
    }
    function setFilter(key) {
        state.filter = key;
        if (el.select) el.select.value = key;
        buildChips();
        renderGrid();
        renderDay();
    }

    /* ---------- month grid ---------- */
    function renderGrid() {
        var data = state.data;
        el.grid.textContent = '';
        if (!data) return;

        var p = state.month.split('-'), year = +p[0], mon = +p[1];
        el.label.textContent = MONTHS[mon - 1] + ' ' + year;
        el.prev.disabled = state.month <= state.startMonth;
        el.next.disabled = state.month >= addMonths(state.startMonth, MAX_AHEAD);

        var blanks = new Date(year, mon - 1, 1).getDay();
        var lastDay = new Date(year, mon, 0).getDate();
        var courts = visibleCourts();

        for (var i = 0; i < blanks; i++) el.grid.appendChild(make('span', 'avail-cell blank'));

        for (var d = 1; d <= lastDay; d++) {
            var date = state.month + '-' + pad(d);
            var isPast = date < data.today;
            var cell = make('button', 'avail-cell');
            cell.type = 'button';
            cell.dataset.date = date;
            cell.appendChild(make('span', 'avail-num', String(d)));

            if (isPast) {
                cell.classList.add('past');
                cell.disabled = true;
            } else {
                var dots = make('span', 'avail-dots' + (courts.length === 1 ? ' single' : ''));
                var best = 'full', summary = [];
                courts.forEach(function (c) {
                    var free = (data.days[date] && data.days[date][c.key]) || [];
                    var lv = level(free.length, data.starts.length - passedList(date).length, data.courts[c.key]);
                    var dot = make('i', 'dot ' + lv);
                    dots.appendChild(dot);
                    summary.push(c.name + ': ' + (lv === 'off' ? 'closed' : lv === 'ended' ? 'times passed' : free.length + ' open'));
                    if (lv === 'open' || (lv === 'low' && best !== 'open')) best = lv;
                });
                cell.appendChild(dots);
                cell.setAttribute('aria-label', niceDay(date) + '. ' + summary.join(', '));
                if (date === data.today) cell.classList.add('today');
                if (date === state.selected) cell.classList.add('picked');
                cell.addEventListener('click', function () {
                    state.selected = this.dataset.date;
                    renderGrid();
                    renderDay(true);
                });
            }
            el.grid.appendChild(cell);
        }
    }

    /* ---------- the chosen day: every court with its open times ---------- */
    function renderDay(scrollToIt) {
        var data = state.data;
        el.day.textContent = '';
        if (!data) return;

        if (!state.selected) {
            el.day.appendChild(make('p', 'avail-hint', 'Pick a day on the calendar to see the open times.'));
            return;
        }
        var date = state.selected;
        el.day.appendChild(make('h4', 'avail-day-title', niceDay(date)));
        el.day.appendChild(make('p', 'avail-hint', 'Tap an open time to book it.'));

        visibleCourts().forEach(function (c) {
            var free = (data.days[date] && data.days[date][c.key]) || [];
            var status = data.courts[c.key];
            var block = make('div', 'avail-court');
            var head = make('div', 'avail-court-head');
            head.appendChild(make('strong', '', c.name));
            var off = status && status !== 'available';
            var gone = passedList(date);
            var ended = !off && gone.length >= data.starts.length;
            head.appendChild(make('span', 'avail-court-note ' + (off || ended ? 'off' : free.length ? 'ok' : 'full'),
                off ? (status === 'maintenance' ? 'Under maintenance' : 'Not available') :
                ended ? 'Times passed' :
                free.length ? free.length + ' open' : 'Fully booked'));
            block.appendChild(head);

            var times = make('div', 'avail-times');
            data.starts.forEach(function (t) {
                var isFree = free.indexOf(t) !== -1;
                var wentBy = gone.indexOf(t) !== -1;
                var b = make(isFree ? 'button' : 'span', 'avail-time ' + (isFree ? 'free' : wentBy ? 'taken passed' : 'taken'), t.replace(':00 ', ' '));
                if (wentBy) b.title = 'This time has already passed';
                if (isFree) {
                    b.type = 'button';
                    b.title = 'Book ' + c.name + ' on ' + niceDay(date) + ' at ' + t;
                    b.addEventListener('click', function () { book(c.key, date, t); });
                }
                times.appendChild(b);
            });
            block.appendChild(times);
            el.day.appendChild(block);
        });

        if (scrollToIt && window.matchMedia('(max-width: 900px)').matches) {
            el.day.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }

    function book(key, date, time) {
        if (typeof window.selectSlotAndBook === 'function') window.selectSlotAndBook(key, date, time);
        else window.location.href = 'booking.html?facility=' + encodeURIComponent(key);
    }

    /* ---------- load a month ---------- */
    function load(month) {
        el.grid.setAttribute('aria-busy', 'true');
        return fetch(API + '/availability?month=' + encodeURIComponent(month))
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data || !data.success) throw new Error((data && data.message) || 'Bad answer');
                state.data = data;
                state.month = month;
                state.today = data.today;
                if (!state.startMonth) state.startMonth = data.today.slice(0, 7);
                state.error = '';
            })
            .catch(function () {
                state.data = null;
                state.error = 'The calendar could not be loaded. Make sure node server.js is running.';
            })
            .then(function () {
                el.grid.removeAttribute('aria-busy');
                if (state.error) {
                    el.grid.textContent = '';
                    el.day.textContent = '';
                    el.label.textContent = '—';
                    el.grid.appendChild(make('p', 'avail-error', state.error));
                    return;
                }
                /* keep the picked day only if it belongs to this month; first visit starts on today */
                if (!state.selected || state.selected.slice(0, 7) !== month) {
                    state.selected = (month === state.today.slice(0, 7)) ? state.today : '';
                }
                renderGrid();
                renderDay();
            });
    }

    function buildLegend() {
        el.legend.textContent = '';
        [['open', 'Open times'], ['low', 'Almost full'], ['full', 'Fully booked'], ['off', 'Closed']].forEach(function (x) {
            var s = make('span', 'avail-key');
            s.appendChild(make('i', 'dot ' + x[0]));
            s.appendChild(document.createTextNode(x[1]));
            el.legend.appendChild(s);
        });
    }

    el.prev.addEventListener('click', function () { load(addMonths(state.month, -1)); });
    el.next.addEventListener('click', function () { load(addMonths(state.month, 1)); });

    /* ---------- the calendar stays hidden until the visitor asks for it ---------- */
    var loaded = false;
    function isOpen() { return !panel.hidden; }
    function openPanel() {
        if (isOpen()) return;
        panel.hidden = false;
        panel.classList.remove('avail-in'); void panel.offsetWidth; panel.classList.add('avail-in');
        if (el.viewBtn) {
            el.viewBtn.textContent = 'Hide Open Days';
            el.viewBtn.setAttribute('aria-expanded', 'true');
        }
        if (!loaded) {
            loaded = true;
            var now = new Date();
            load(now.getFullYear() + '-' + pad(now.getMonth() + 1));
        }
        setTimeout(function () { panel.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 60);
    }
    function closePanel() {
        panel.hidden = true;
        if (el.viewBtn) {
            el.viewBtn.textContent = 'See Open Days';
            el.viewBtn.setAttribute('aria-expanded', 'false');
        }
    }

    /* picking anything in the Sport list (including All courts) opens the calendar for it; no button needed */
    if (el.select) el.select.addEventListener('change', function () {
        var v = el.select.value;
        if (v === 'pick') { if (isOpen()) closePanel(); return; }   /* choosing "Choose a sport" again hides the calendar */
        setFilter(v);
        openPanel();
    });
    if (el.closeBtn) el.closeBtn.addEventListener('click', function () {
        closePanel();
        if (el.select) el.select.value = 'pick';
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    if (el.viewBtn) {
        el.viewBtn.setAttribute('aria-expanded', 'false');
        el.viewBtn.setAttribute('aria-controls', 'availPanel');
        el.viewBtn.addEventListener('click', function () { isOpen() ? closePanel() : openPanel(); });
    }

    buildChips();
    buildLegend();
    panel.hidden = true;

    /* a booking made in another tab frees / takes times: refresh quietly (only while it is open) */
    setInterval(function () {
        if (isOpen() && document.visibilityState === 'visible' && state.month) load(state.month);
    }, 60000);
})();