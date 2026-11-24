/* =========================================================
   Moldex Realty reservation system - Privacy Policy and Terms of Use pop-ups (customer pages)

   1. The "Privacy Policy" and "Terms of Use" links in the footer open the text in a pop-up.
   2. Before a customer goes on to book (the Continue button on the booking page, the
      Submit reservation button of the guest page) or creates an account, the Privacy Policy
      pops up once per visit and they must tick "I agree" to carry on. The click they made
      then continues exactly as before - this file never changes how a button works, it only
      holds the click until the policy has been agreed.
   3. Any link written as <a href="#" data-legal="privacy"> or data-legal="terms" opens it too.

   The agreement is remembered for the rest of that booking only: opening the booking page or the register page
   starts again without it, so the policy pops up every time someone starts a new booking or sign-up.
   To switch it off: delete this file and the <script src="legal.js"> line in each page.
   To change the wording: edit the PRIVACY and TERMS lists below.
   ========================================================= */
(function () {
    'use strict';
    if (window.__msLegalLoaded) return;
    window.__msLegalLoaded = true;

    var UPDATED = 'November 2026';
    var BRAND = 'Moldex Realty';                          /* the name shown at the top of the pop-up and in the text */
    var PLACE = 'MetroGate Silang Estates';
    var CONTACT = 'MoldexRealty@gmail.com';                /* contact address shown in the privacy text (same as the footer) */
    var STORE_KEY = 'msPrivacyAgreed';
    var VERSION = '1';
    var GATED = ['continueBookingBtn', 'submitGuestBooking', 'submitRegisterBtn'];   /* buttons that wait for the agreement */

    /* ------------------------------------------------------------------ the text */
    var PRIVACY = {
        title: 'Privacy Policy',
        sections: [
            ['1. Introduction', [
                'This Privacy Policy explains how the reservation system for the sports facilities of ' + PLACE + ', operated by ' + BRAND + ', handles the personal information you give when you create an account or reserve a facility.',
                'By continuing, you confirm that you have read this policy.'
            ]],
            ['2. Information We Collect', [
                'When you register or make a reservation, the system collects your name, email address, contact number and address, together with the details of your booking: the facility, date, time, purpose and organization.',
                'It also keeps the payment reference and the payment screenshot you upload so the payment can be checked. If you create an account, your password is stored in a scrambled (hashed) form and not as readable text.'
            ]],
            ['3. How We Use Your Information', [
                'Your information is used to process, confirm and manage your reservation, to check your payment, to send you email updates about the status of your booking, and to contact you if there is a problem with your schedule.',
                'It is also used to keep reservation records for the facilities.'
            ]],
            ['4. Information Security', [
                'We take reasonable steps to protect the information stored in the system against unauthorized access, changes, disclosure or loss. Access to bookings is limited to authorized personnel. No online system can be made completely risk-free, so please also keep your own password private.'
            ]],
            ['5. Information Sharing', [
                'Your information is seen only by authorized personnel of MetroGate Silang Estates and Moldex Realty who manage the facilities and reservations. It is not sold. It may be disclosed when the law requires it.'
            ]],
            ['6. Data Retention', [
                'Reservation and account information is kept for as long as it is needed to run the facilities, keep proper records and meet legal requirements.'
            ]],
            ['7. Your Rights', [
                'Under the Data Privacy Act of 2012 (Republic Act No. 10173) you may ask to see the personal information we hold about you, ask for corrections, object to how it is used, withdraw your consent, or ask for it to be removed, subject to what the law and our records allow.',
                'To make a request, write to ' + CONTACT + '.'
            ]],
            ['8. Cookies and Sessions', [
                'The system uses your browser storage to keep you signed in, to remember the facility, date and time you chose, and to remember that you have read this policy. It is not used for advertising.'
            ]],
            ['9. Changes to This Privacy Policy', [
                'This policy may be updated when necessary. Changes will appear on this page with a new date.'
            ]]
        ]
    };

    var TERMS = {
        title: 'Terms of Use',
        sections: [
            ['1. Acceptance of Terms', [
                'By using the ' + BRAND + ' facility reservation system for ' + PLACE + ', you agree to these Terms of Use. If you do not agree, please do not use the system.'
            ]],
            ['2. Use of the Reservation System', [
                'The system lets residents and guests request a schedule for the sports facilities of MetroGate Silang Estates. Sending a request does not guarantee the schedule. It must first be reviewed and approved by the facility management.'
            ]],
            ['3. Accurate Information', [
                'You are responsible for giving accurate and complete information, including your name, contact details, address and payment details. Reservations with false or missing information may be rejected or cancelled.'
            ]],
            ['4. Reservation Requests', [
                'A new reservation starts as pending and may be approved, rejected or otherwise managed by authorized personnel. You can follow its status with your booking reference on the Track Booking page.',
                'The management may contact you to verify your details or to give instructions before your visit.'
            ]],
            ['5. Payment', [
                'A payment reference and a payment screenshot are required with each reservation. A reservation may be rejected if the payment cannot be verified.'
            ]],
            ['6. Cancellation and Rescheduling', [
                'If you cannot use your schedule, please request a cancellation or change as early as possible through the system or by contacting the management. Cancellations and any refund are subject to the approval of the management.'
            ]],
            ['7. Use of the Facilities', [
                'Please use the facilities with care, follow the rules of MetroGate Silang Estates, and finish on time for the next group. You are responsible for any damage you cause.'
            ]],
            ['8. Your Account', [
                'You are responsible for keeping your password private and for what is done with your account.'
            ]],
            ['9. Changes to Schedules and Terms', [
                'A schedule may be changed or cancelled because of weather, maintenance or other events, and you will be told as soon as possible. These terms may be updated when necessary.'
            ]]
        ]
    };

    /* ------------------------------------------------------------------ look */
    var CSS = [
        '.ms-legal{position:fixed;inset:0;z-index:2147483000;display:none;align-items:center;justify-content:center;padding:20px;background:rgba(5,31,21,.74);}',
        '.ms-legal.open{display:flex;animation:msLegalFade .2s ease;}',
        '@keyframes msLegalFade{from{opacity:0}to{opacity:1}}',
        '.ms-legal-panel{position:relative;display:flex;flex-direction:column;width:100%;max-width:760px;max-height:min(88vh,820px);background:#fff;color:#0c2f20;border-top:5px solid #ef7435;box-shadow:0 30px 80px rgba(0,0,0,.45);font-family:"DM Sans",system-ui,-apple-system,"Segoe UI",sans-serif;}',
        '.ms-legal-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:22px 28px 16px;border-bottom:1px solid #dfe8e0;}',
        '.ms-legal-eyebrow{display:block;margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:#b53d14;}',
        '.ms-legal-title{margin:0;font-family:"Barlow Condensed","Arial Narrow",Impact,sans-serif;font-style:italic;font-weight:800;font-size:36px;line-height:1;letter-spacing:0;text-transform:uppercase;color:#0a3624;}',
        '.ms-legal-x{flex:none;width:40px;height:40px;border:0;background:#eef3ee;color:#0a3624;font-size:22px;line-height:1;cursor:pointer;}',
        '.ms-legal-x:hover{background:#0a3624;color:#fff;}',
        '.ms-legal-body{flex:1;min-height:0;overflow-y:auto;padding:8px 28px 22px;scrollbar-width:thin;scrollbar-color:#ef7435 #eef3ee;overscroll-behavior:contain;}',
        '.ms-legal-body::-webkit-scrollbar{width:10px}.ms-legal-body::-webkit-scrollbar-track{background:#eef3ee}.ms-legal-body::-webkit-scrollbar-thumb{background:#ef7435}',
        '.ms-legal-date{margin:14px 0 0;font-size:13.5px;color:#4d6457;}',
        '.ms-legal-body h3{display:flex;align-items:center;gap:10px;margin:24px 0 8px;font-size:17px;font-weight:700;line-height:1.3;color:#0a3624;}',
        '.ms-legal-body h3::before{content:"";flex:none;width:4px;height:18px;background:#ef7435;}',
        '.ms-legal-body p{margin:0 0 10px;font-size:15.5px;line-height:1.65;color:#2b4a3a;}',
        '.ms-legal-foot{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:14px 20px;padding:16px 28px 20px;border-top:1px solid #dfe8e0;background:#fff;}',
        '.ms-legal-check{display:flex;align-items:center;gap:10px;font-size:15px;color:#0c2f20;cursor:pointer;}',
        '.ms-legal-check input{width:18px;height:18px;margin:0;accent-color:#d9502f;cursor:pointer;}',
        '.ms-legal-go{margin-left:auto;border:0;padding:14px 38px;font-family:"Barlow Condensed","Arial Narrow",Impact,sans-serif;font-style:italic;font-weight:800;font-size:18px;letter-spacing:.1em;text-transform:uppercase;color:#051f15;background:linear-gradient(100deg,#d9502f 0%,#ef7435 45%,#eaa63a 80%,#dcd650 100%);clip-path:polygon(14px 0,100% 0,calc(100% - 14px) 100%,0 100%);cursor:pointer;}',
        '.ms-legal-go:hover{box-shadow:inset 0 0 0 999px rgba(255,255,255,.16);}',
        '.ms-legal-go[disabled]{opacity:.4;cursor:not-allowed;box-shadow:none;}',
        '.ms-legal-x:focus-visible,.ms-legal-go:focus-visible,.ms-legal-check input:focus-visible{outline:3px solid #0a3624;outline-offset:2px;}',
        '@media (max-width:560px){.ms-legal{padding:0;align-items:flex-end}.ms-legal-panel{max-height:94vh}.ms-legal-head,.ms-legal-body,.ms-legal-foot{padding-left:20px;padding-right:20px}.ms-legal-title{font-size:30px}.ms-legal-go{width:100%;margin-left:0}}',
        '@media (prefers-reduced-motion:reduce){.ms-legal.open{animation:none}}'
    ].join('');

    /* ------------------------------------------------------------------ the pop-up */
    var root = null, panel, bodyEl, titleEl, checkRow, checkEl, goBtn, current = null, lastFocus = null;

    function el(tag, cls, text) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text) e.textContent = text;
        return e;
    }

    function build() {
        if (root) return;
        var st = document.createElement('style');
        st.id = 'msLegalCss';
        st.textContent = CSS;
        document.head.appendChild(st);

        root = el('div', 'ms-legal');
        root.setAttribute('aria-hidden', 'true');
        panel = el('div', 'ms-legal-panel');
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'true');
        panel.setAttribute('aria-labelledby', 'msLegalTitle');

        var head = el('div', 'ms-legal-head');
        var hl = el('div');
        hl.appendChild(el('span', 'ms-legal-eyebrow', BRAND + ' · ' + PLACE));
        titleEl = el('h2', 'ms-legal-title');
        titleEl.id = 'msLegalTitle';
        hl.appendChild(titleEl);
        var x = el('button', 'ms-legal-x', '×');
        x.type = 'button';
        x.setAttribute('aria-label', 'Close');
        x.addEventListener('click', function () { close(false); });
        head.appendChild(hl); head.appendChild(x);

        bodyEl = el('div', 'ms-legal-body');
        bodyEl.tabIndex = 0;

        var foot = el('div', 'ms-legal-foot');
        checkRow = el('label', 'ms-legal-check');
        checkEl = document.createElement('input');
        checkEl.type = 'checkbox';
        checkEl.addEventListener('change', function () { goBtn.disabled = !checkEl.checked; });
        checkRow.appendChild(checkEl);
        checkRow.appendChild(el('span', '', 'I agree to the Privacy Policy'));
        goBtn = el('button', 'ms-legal-go');
        goBtn.type = 'button';
        goBtn.addEventListener('click', function () { close(true); });
        foot.appendChild(checkRow); foot.appendChild(goBtn);

        panel.appendChild(head); panel.appendChild(bodyEl); panel.appendChild(foot);
        root.appendChild(panel);
        root.addEventListener('mousedown', function (e) { if (e.target === root) close(false); });
        document.body.appendChild(root);

        document.addEventListener('keydown', function (e) {
            if (!root.classList.contains('open')) return;
            if (e.key === 'Escape') { e.preventDefault(); close(false); return; }
            if (e.key !== 'Tab') return;
            var f = [].filter.call(panel.querySelectorAll('button,input,[tabindex="0"]'), function (n) { return !n.disabled && n.offsetParent !== null; });
            if (!f.length) return;
            var first = f[0], last = f[f.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        });
    }

    /* kind: 'privacy' | 'terms'.  opts.agree = ask for the tick; opts.onAgree = what to do once agreed */
    function open(kind, opts) {
        build();
        opts = opts || {};
        var doc = kind === 'terms' ? TERMS : PRIVACY;
        current = { kind: kind, agree: !!opts.agree, onAgree: opts.onAgree || null };
        lastFocus = document.activeElement;

        titleEl.textContent = doc.title;
        bodyEl.innerHTML = '';
        bodyEl.appendChild(el('p', 'ms-legal-date', 'Last updated: ' + UPDATED));
        doc.sections.forEach(function (s) {
            bodyEl.appendChild(el('h3', '', s[0]));
            s[1].forEach(function (t) { bodyEl.appendChild(el('p', '', t)); });
        });
        bodyEl.scrollTop = 0;

        checkEl.checked = false;
        checkRow.style.display = current.agree ? '' : 'none';
        goBtn.textContent = current.agree ? 'I Agree' : 'I Understand';
        goBtn.disabled = current.agree;

        root.classList.add('open');
        root.setAttribute('aria-hidden', 'false');
        document.documentElement.style.overflow = 'hidden';
        setTimeout(function () { (current.agree ? checkEl : goBtn).focus(); }, 30);
    }

    function close(agreed) {
        if (!root || !root.classList.contains('open')) return;
        var c = current;
        root.classList.remove('open');
        root.setAttribute('aria-hidden', 'true');
        document.documentElement.style.overflow = '';
        current = null;
        if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }
        if (agreed && c && c.agree) {
            remember();
            if (c.onAgree) c.onAgree();
        }
    }

    /* ------------------------------------------------------------------ remembering the agreement */
    var memory = false;
    function agreed() {
        try { return sessionStorage.getItem(STORE_KEY) === VERSION; } catch (e) { return memory; }
    }
    function remember() {
        memory = true;
        try { sessionStorage.setItem(STORE_KEY, VERSION); } catch (e) {}
    }
    function forget() {
        memory = false;
        try { sessionStorage.removeItem(STORE_KEY); } catch (e) {}
    }
    /* every new booking (the booking page) and every new sign-up (the register page) starts without an agreement,
       so the policy always pops up at the first step; the later step of the same booking does not ask again */
    if (document.body && (document.body.id === 'bookingPage' || document.body.id === 'registerPage')) forget();

    /* ------------------------------------------------------------------ wiring */
    /* footer links and any data-legal link */
    document.addEventListener('click', function (e) {
        var a = e.target.closest ? e.target.closest('a') : null;
        if (!a) return;
        var kind = a.getAttribute('data-legal');
        if (!kind && a.closest('.footer-legal')) {
            var t = (a.textContent || '').toLowerCase();
            kind = t.indexOf('privacy') > -1 ? 'privacy' : t.indexOf('terms') > -1 ? 'terms' : '';
        }
        if (kind !== 'privacy' && kind !== 'terms') return;
        e.preventDefault();
        open(kind);
    });

    /* hold the booking / register buttons until the Privacy Policy has been agreed.
       Capture phase: this runs before the page's own click handler and lets it through afterwards. */
    document.addEventListener('click', function (e) {
        var btn = e.target.closest ? e.target.closest('button,a') : null;
        if (!btn || GATED.indexOf(btn.id) === -1 || agreed()) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        open('privacy', { agree: true, onAgree: function () { btn.click(); } });
    }, true);

    window.MultiSportLegal = { open: open, agreed: agreed, reset: forget };
})();