/* =========================================================
   MULTISPORT — shared page extras
   (mobile menu + Escape key for the photo viewer)

   script.js has no handler for #mobileMenuBtn, so on phones the
   menu button did nothing. This file adds it.
   If you later add a menu handler to script.js, remove this
   file's <script> tag so the menu does not toggle twice.
========================================================= */

(function () {
    var btn = document.getElementById('mobileMenuBtn');
    var nav = document.querySelector('.main-nav');
    var actions = document.getElementById('userNavAction');

    function setOpen(open) {
        nav.classList.toggle('mobile-open', open);
        actions.classList.toggle('mobile-open', open);
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        btn.textContent = open ? '✕' : '☰';
    }

    if (btn && nav && actions) {
        btn.addEventListener('click', function () {
            setOpen(!nav.classList.contains('mobile-open'));
        });

        nav.addEventListener('click', function (e) {
            if (e.target.closest('a')) setOpen(false);
        });
    }

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && window.closeImageModal) {
            window.closeImageModal();
        }
    });
})();