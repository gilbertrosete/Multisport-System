/* =========================================================
   MultiSport - smooth mouse-wheel scrolling (customer pages only)

   The wheel moves a target position and the page glides to it, so scrolling
   feels like a modern website instead of jumping in steps.

   It stays out of the way when:
   - the visitor prefers reduced motion, or uses a touch screen
   - the wheel is over something that scrolls by itself (a dialog, a table, a list)
   - Ctrl is held (browser zoom) or the gesture is sideways
   Keyboard, scrollbar dragging and links keep working normally.

   To switch it off: delete the <script src="smooth.js"> line from a page.
   ========================================================= */
(function () {
    'use strict';

    if (window.__msSmoothLoaded) return;
    window.__msSmoothLoaded = true;

    var mq = window.matchMedia;
    if (mq && (mq('(prefers-reduced-motion: reduce)').matches || !mq('(pointer: fine)').matches)) return;
    window.__msSmooth = true;          /* only set when smoothing is really active */

    var root = document.scrollingElement || document.documentElement;
    var TAU = 110;                  /* ms: higher = longer glide */
    var STEP = 1;                   /* wheel distance multiplier */

    var target = root.scrollTop;
    var current = target;
    var running = false;
    var last = 0;

    function maxScroll() { return Math.max(0, root.scrollHeight - window.innerHeight); }
    function clamp(v) { return Math.min(Math.max(v, 0), maxScroll()); }

    /* is there an inner scroller under the pointer that can still move this way? */
    function innerScroller(node, dy) {
        while (node && node !== document.body && node !== document.documentElement) {
            if (node.nodeType === 1) {
                var cs = window.getComputedStyle(node);
                var oy = cs.overflowY;
                if ((oy === 'auto' || oy === 'scroll' || oy === 'overlay') && node.scrollHeight > node.clientHeight + 1) {
                    var atTop = node.scrollTop <= 0;
                    var atEnd = node.scrollTop + node.clientHeight >= node.scrollHeight - 1;
                    if ((dy < 0 && !atTop) || (dy > 0 && !atEnd)) return true;
                }
                if (node.tagName === 'TEXTAREA' || node.tagName === 'SELECT') return true;
            }
            node = node.parentNode;
        }
        return false;
    }

    function frame(now) {
        var dt = Math.min(now - last, 64);
        last = now;
        var k = 1 - Math.exp(-dt / TAU);
        current += (target - current) * k;
        if (Math.abs(target - current) < 0.4) current = target;
        window.scrollTo({ top: current, left: 0, behavior: 'instant' });
        if (current !== target) {
            requestAnimationFrame(frame);
        } else {
            running = false;
        }
    }

    function onWheel(e) {
        if (e.defaultPrevented || e.ctrlKey || e.metaKey) return;
        if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
        if (document.body && document.body.style.overflow === 'hidden') return;   /* page is locked by a dialog */

        var dy = e.deltaY;
        if (e.deltaMode === 1) dy *= 16;                 /* lines -> pixels */
        else if (e.deltaMode === 2) dy *= window.innerHeight;
        if (!dy) return;

        if (innerScroller(e.target, dy)) return;

        if (!running) { current = root.scrollTop; target = current; }
        var next = clamp(target + dy * STEP);
        if (next === target && (next === 0 || next === maxScroll())) return;   /* at an edge: let the browser handle it */

        e.preventDefault();
        target = next;
        if (!running) {
            running = true;
            last = performance.now();
            requestAnimationFrame(frame);
        }
    }

    /* anything else that moves the page (keyboard, scrollbar, links): follow it */
    window.addEventListener('scroll', function () {
        if (!running) { current = root.scrollTop; target = current; }
    }, { passive: true });

    window.addEventListener('wheel', onWheel, { passive: false });
})();