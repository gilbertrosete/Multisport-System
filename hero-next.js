/* NEXT AVAILABLE: the left panel of the booking bar on the home page.
   Shows the soonest open time for the sport chosen in the bar. On "All courts" it rotates through every court.
   Data: GET /api/availability (free times only, no personal data). Nothing is written anywhere. */
(function () {
    'use strict';
    var nameEl = document.getElementById('nextCourt');
    var timeEl = document.getElementById('nextTime');
    var select = document.getElementById('homeSportSelect');
    if (!nameEl || !timeEl || !select) return;

    var API = (typeof API_BASE !== 'undefined') ? API_BASE : '/api';
    var NAMES = { basketball: 'Basketball Court', volleyball: 'Volleyball Court', tennis: 'Tennis Court', badminton: 'Badminton Court' };
    var ORDER = ['basketball', 'volleyball', 'tennis', 'badminton'];
    var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var months = {};          // 'YYYY-MM' -> availability data
    var shown = null;

    function two(n) { return (n < 10 ? '0' : '') + n; }
    function ym(d) { return d.getFullYear() + '-' + two(d.getMonth() + 1); }
    function iso(d) { return ym(d) + '-' + two(d.getDate()); }
    function short(t) { return String(t).replace(':00 ', ' '); }
    function dayText(off, d) { return off === 0 ? 'Today' : off === 1 ? 'Tomorrow' : DAYS[d.getDay()] + ' ' + d.getDate(); }

    /* hour (0-23) of a label like "10:00 AM" */
    function hourOf(label) {
        var m = /^(\d+):(\d+)\s*(AM|PM)$/i.exec(String(label).trim());
        if (!m) return 0;
        var h = parseInt(m[1], 10) % 12;
        return (m[3].toUpperCase() === 'PM' ? h + 12 : h) + parseInt(m[2], 10) / 60;
    }

    function find(key) {
        var keys = key ? [key] : ORDER;
        var now = new Date();
        for (var off = 0; off < 60; off++) {
            var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + off);
            var data = months[ym(d)];
            if (!data) return null;                       // still loading
            var day = data.days && data.days[iso(d)];
            for (var i = 0; i < keys.length; i++) {
                var free = day && day[keys[i]];
                if (free && off === 0) {   /* today: hide times that already started, even between two refreshes */
                    var nowH = now.getHours() + now.getMinutes() / 60;
                    free = free.filter(function (t) { return hourOf(t) > nowH; });
                }
                var open = !data.courts || !data.courts[keys[i]] || data.courts[keys[i]] === 'available';
                if (open && free && free.length) return { key: keys[i], text: dayText(off, d) + ' · ' + short(free[0]) };
            }
        }
        return { none: true };
    }

    var rot = 0, dotsEl = null, swapTimer = null;
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function setText(name, time) {
        clearTimeout(swapTimer);
        if (shown === null || reduce) { nameEl.textContent = name; timeEl.textContent = time; return; }
        nameEl.classList.add('is-swap'); timeEl.classList.add('is-swap');
        swapTimer = setTimeout(function () {
            nameEl.textContent = name; timeEl.textContent = time;
            nameEl.classList.remove('is-swap'); timeEl.classList.remove('is-swap');
        }, 260);
    }

    function paintDots(n, active) {
        if (!dotsEl) {
            dotsEl = document.createElement('div');
            dotsEl.className = 'quick-next-dots';
            dotsEl.setAttribute('aria-hidden', 'true');
            timeEl.parentNode.insertBefore(dotsEl, timeEl.nextSibling);
        }
        if (dotsEl.children.length !== n) {
            dotsEl.innerHTML = '';
            for (var i = 0; i < n; i++) dotsEl.appendChild(document.createElement('span'));
        }
        for (var j = 0; j < dotsEl.children.length; j++) dotsEl.children[j].className = j === active ? 'on' : '';
    }


    /* the hero's bottom edge lines up with the little dashes: tell the page how far down the bar they sit */
    var barEl = document.querySelector('.quick-booking-card');
    function measure() {
        if (!dotsEl || !barEl || !dotsEl.children.length) return;
        var br = barEl.getBoundingClientRect(), dr = dotsEl.getBoundingClientRect();
        if (!br.height || !dr.height) return;
        var d = Math.round(dr.top + dr.height / 2 - br.top);
        document.body.style.setProperty('--qd', d + 'px');
    }


    /* keep every court name on ONE line (so the dashes, and with them the hero edge, never jump):
       measure the longest name and shrink the text only if it would not fit */
    var baseFont = null;
    function fitName() {
        var box = nameEl.parentNode, cs = getComputedStyle(box);
        var avail = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 40;   /* 40 = room for the slanted edge */
        if (!(avail > 60)) return;
        nameEl.style.fontSize = '';
        baseFont = parseFloat(getComputedStyle(nameEl).fontSize);
        var probe = nameEl.cloneNode(false);
        probe.removeAttribute('id');
        probe.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;white-space:nowrap;width:auto;';
        box.appendChild(probe);
        var widest = 0;
        Object.keys(NAMES).forEach(function (k) { probe.textContent = NAMES[k]; widest = Math.max(widest, probe.offsetWidth); });
        box.removeChild(probe);
        if (widest > avail) nameEl.style.fontSize = Math.floor(baseFont * avail / widest * 10) / 10 + 'px';
        measure();
    }
    fitName();
    window.addEventListener('resize', fitName);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitName);

    /* "All courts" cycles through each court's next open time; a chosen sport shows only its own */
    function paint() {
        var key = select.value === 'pick' ? '' : select.value;
        var keys = key ? [key] : ORDER, list = [];
        for (var i = 0; i < keys.length; i++) {
            var r = find(keys[i]);
            if (r === null) return;                       // still loading
            if (!r.none) list.push({ name: NAMES[r.key], time: r.text });
        }
        var name, time, idx = 0;
        if (!list.length) { name = key ? NAMES[key] : 'All courts'; time = 'Fully booked for now'; paintDots(0, -1); }
        else {
            idx = rot % list.length;
            name = list[idx].name; time = list[idx].time;
            paintDots(list.length > 1 ? list.length : 0, idx);
        }
        var sig = name + '|' + time;
        if (sig === shown) return;
        setText(name, time);
        shown = sig;
        measure();
    }

    function load(month) {
        return fetch(API + '/availability?month=' + encodeURIComponent(month))
            .then(function (r) { return r.json(); })
            .then(function (data) { if (data && data.success) months[month] = data; });
    }
    function loadAll() {
        var now = new Date();
        var next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        var quiet = function () { /* a month that fails to load is simply skipped */ };
        Promise.all([load(ym(now)).catch(quiet), load(ym(next)).catch(quiet)]).then(function () {
            paint();
            if (!shown && !months[ym(now)]) timeEl.textContent = 'Choose a sport to see open days';
        });
    }
    loadAll();
    setInterval(loadAll, 60000);

    window.addEventListener('resize', measure);
    if (window.ResizeObserver && barEl) new ResizeObserver(measure).observe(barEl);
    select.addEventListener('change', function () { rot = 0; paint(); });
    setInterval(function () { if (!document.hidden) { rot++; paint(); } }, 4500);   // next court
    setInterval(paint, 500);   // also follows the court chips in the calendar below
})();
