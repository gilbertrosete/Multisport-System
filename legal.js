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

    var UPDATED = 'November 27, 2026';
    var BRAND = 'Moldex Realty';                          /* the name shown at the top of the pop-up and in the text */
    var PLACE = 'MetroGate Silang Estates';
    var CONTACT = 'MoldexRealty@gmail.com';                /* contact address shown in the privacy text (same as the footer) */
    var STORE_KEY = 'msPrivacyAgreed';
    var VERSION = '1';
    var GATED = ['continueBookingBtn', 'submitGuestBooking', 'submitRegisterBtn', 'confirmQrPaymentBtn'];   /* buttons that wait for the agreement */

    /* ------------------------------------------------------------------ the text */
    var PRIVACY = {
        title: 'Privacy Policy',
        sections: [
            ['1. Introduction', [
                'This Privacy Policy explains how the reservation system for the sports facilities of ' + PLACE + ', operated by ' + BRAND + ', collects, uses, stores and protects your personal information. We follow the Data Privacy Act of 2012 (Republic Act No. 10173) and its implementing rules.',
                'By ticking "I agree" when you register or reserve a facility, you give your consent to the handling of your information as described here. If you do not agree, you may simply not continue; no information is saved until you submit your registration or reservation.'
            ]],
            ['2. Who Is Responsible', [
                BRAND + ' is the personal information controller for the information collected through this system. Questions, requests and complaints about your information can be sent to ' + CONTACT + '.'
            ]],
            ['3. Information We Collect', [
                'Account registration: your name, email address, contact number, address and a password. The password is stored only in a scrambled (hashed) form, never as readable text.',
                'Reservation: your name, email address, contact number and address, the facility, date, time and duration you chose, your purpose and organization, the payment reference number, and the payment screenshot you upload.',
                'The payment screenshot may show payment details such as an account name or number. Please upload only what is needed to prove your payment.',
                'We also keep the date and time of your consent and the status of your reservation (for example pending, approved, rejected, cancelled or refunded).'
            ]],
            ['4. Why We Collect It', [
                'To process, confirm and manage your reservation; to check your payment and handle cancellations, rescheduling and refunds; to send you email updates about your booking; to contact you if there is a problem with your schedule; to prevent double booking; and to keep reservation and income records and reports for the facilities.',
                'We use your information only for these purposes. We do not use it for advertising or marketing.'
            ]],
            ['5. Who Can See It', [
                'Your information is seen only by the authorized personnel of ' + BRAND + ' and ' + PLACE + ' who manage the facilities and reservations. It is not sold or rented. It is disclosed to others only if the law, a court or a government agency requires it.',
                'Email updates are sent through an email service on our behalf and contain only the details of your own booking.'
            ]],
            ['6. How Long We Keep It', [
                'Reservation records and payment screenshots are kept for as long as needed for accounting, auditing and dispute handling, and as required by law. Account information is kept while your account is active. When information is no longer needed, it is deleted or made anonymous.'
            ]],
            ['7. How We Protect It', [
                'We use reasonable organizational and technical measures: hashed passwords, limited access to the admin dashboard, payment screenshots that only the administrator can open, and limits on repeated requests. No online system can be made completely risk-free, so please also keep your own password private.',
                'If a breach affecting your information happens and the law requires it, we will notify you and the National Privacy Commission.'
            ]],
            ['8. Your Rights', [
                'Under the Data Privacy Act you have the right to be informed, to access the information we hold about you, to correct it, to object to its use, to withdraw your consent, to ask for it to be blocked or deleted, to data portability, and to claim compensation for damages caused by misuse of your information. These rights are subject to the limits allowed by law and to our need to keep records.',
                'To make a request, write to ' + CONTACT + ' and tell us the email address you used. We may ask you to confirm your identity first. Withdrawing consent or asking for deletion may mean we can no longer process a reservation for you.',
                'If you believe your rights were violated, you may also file a complaint with the National Privacy Commission (privacy.gov.ph).'
            ]],
            ['9. Cookies and Browser Storage', [
                'The system uses your browser storage to keep you signed in, to remember the facility, date and time you chose, and to remember that you agreed to this policy during your visit. It is not used for advertising or tracking.'
            ]],
            ['10. Changes to This Privacy Policy', [
                'This policy may be updated when necessary. The new date will appear at the top of this page, and you will be asked to agree again if the changes are important.'
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
            ['6. Cancellation, Rescheduling and Refunds', [
                'Cancellation: a reservation can be cancelled online up to the day before its date. On the day of the reservation, please contact the management.',
                'Rescheduling: an approved reservation can be moved once to another open schedule before its date. The new schedule must be approved by the management.',
                'Refunds: if a reservation is rejected, or a cancellation is accepted by the management, the payment is refunded in full to the account it was paid from, and you will be notified by email. No-shows and cancellations made after the reservation has started are not refunded unless the management decides otherwise.'
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

    /* privacy.html / terms.html: write the same text on the page itself (one source of text for pop-up and page) */
    function renderPage() {
        var box = document.getElementById('legalDoc');
        if (!box) return;
        var doc = box.getAttribute('data-kind') === 'terms' ? TERMS : PRIVACY;
        box.innerHTML = '';
        box.appendChild(el('p', 'legal-date', 'Last updated: ' + UPDATED));
        doc.sections.forEach(function (sec) {
            box.appendChild(el('h2', '', sec[0]));
            sec[1].forEach(function (t) { box.appendChild(el('p', '', t)); });
        });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', renderPage); else renderPage();

    window.MultiSportLegal = { open: open, agreed: agreed, reset: forget };
})();
