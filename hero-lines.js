/* HERO LINES: the court lines in the hero (home and inner pages) draw themselves once, then rest.
   Only decoration. If hero-bg.css is emptied (photo mode) this adds nothing.
   To remove: delete this file and its <script> line in index.html. */
(function () {
    'use strict';
    var hero = document.querySelector('body#homePage .hero, body:is(#facilitiesPage, #bookingPage, #guestBookingPage, #trackPage, #profilePage) .page-hero, body:is(#loginPage, #registerPage) .auth-page');
    var auth = hero && hero.classList.contains('auth-page');
    if (!hero) return;
    // photo mode (hero-bg.css emptied): the court-line variable is gone, so do nothing
    var vars = getComputedStyle(document.documentElement);
    if (!vars.getPropertyValue(auth ? '--court-full' : '--hero-court-full').trim()) return;

    var NS = 'http://www.w3.org/2000/svg';
    var FULL = [
        ['rect', { x: 20, y: 20, width: 760, height: 560 }],
        ['path', { d: 'M400 20V580' }],
        ['circle', { cx: 400, cy: 300, r: 110 }],
        ['rect', { x: 20, y: 170, width: 170, height: 260 }],
        ['rect', { x: 610, y: 170, width: 170, height: 260 }]
    ];
    var HALF = [
        ['rect', { x: 20, y: 20, width: 760, height: 560 }],
        ['rect', { x: 290, y: 20, width: 220, height: 250 }],
        ['circle', { cx: 400, cy: 270, r: 80 }],
        ['path', { d: 'M120 20V130A290 290 0 0 0 680 130V20' }],
        ['path', { d: 'M360 50H440' }],
        ['circle', { cx: 400, cy: 72, r: 16 }],
        ['path', { d: 'M300 600A100 100 0 0 1 500 600' }]
    ];

    function build(cls, shapes, offset) {
        var svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('viewBox', '0 0 800 600');
        svg.setAttribute('class', cls);
        svg.setAttribute('aria-hidden', 'true');
        shapes.forEach(function (s, i) {
            var el = document.createElementNS(NS, s[0]);
            Object.keys(s[1]).forEach(function (k) { el.setAttribute(k, s[1][k]); });
            el.setAttribute('pathLength', '1');
            el.style.setProperty('--i', i + offset);
            svg.appendChild(el);
        });
        return svg;
    }

    var wrap = document.createElement('div');
    wrap.className = 'hero-lines' + (auth ? ' hero-lines-auth' : '');
    wrap.setAttribute('aria-hidden', 'true');
    wrap.appendChild(build('hl-full', FULL, 0));
    wrap.appendChild(build('hl-half', HALF, 2));
    hero.insertBefore(wrap, hero.firstChild);
    hero.classList.add('has-lines');
})();