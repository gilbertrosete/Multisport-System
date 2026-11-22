/* =========================================================
   MULTISPORT FACILITY RESERVATION SYSTEM
   FULL SYSTEM ENGINE (SOFT DELETE & FLEXIBLE LIVE CALENDAR ENGINE)
========================================================= */

const API_BASE = "http://localhost:5000/api";

// Strict Input Validation Helper Functions
window.validateNameInput = function(nameStr) {
    const nameRegex = /^[A-Za-zÑñ\s]+$/;
    return nameRegex.test(nameStr);
};

window.validateEmailInput = function(emailStr) {
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    return emailRegex.test(emailStr);
};

window.validatePhoneInput = function(phoneStr) {
    const phoneRegex = /^09\d{9}$/;
    return phoneRegex.test(phoneStr);
};

/* Philippine mobile numbers only: 11 digits, 09XXXXXXXXX.
   Typed or pasted text is cleaned as the user types: letters and symbols are dropped,
   +63 / 63 / 9... become 09..., and the field stops at 11 digits. */
window.normalizePhPhone = function(raw) {
    var d = String(raw || "").replace(/\D/g, "");
    if (d.indexOf("63") === 0) d = "0" + d.slice(2);
    else if (d.charAt(0) === "9") d = "0" + d;
    return d.slice(0, 11);
};
(function () {
    var PH_IDS = { guestPhone: 1, phoneNumber: 1, acctPhone: 1 };
    var MSG = "Enter an 11-digit mobile number that starts with 09 (example: 09123456789).";
    function prep(el) {
        if (!el || el.getAttribute("data-ph") === "1") return;
        el.setAttribute("data-ph", "1");
        el.setAttribute("inputmode", "numeric");
        el.setAttribute("maxlength", "11");
        el.setAttribute("autocomplete", "tel-national");
        el.setAttribute("pattern", "09[0-9]{9}");
        el.setAttribute("title", MSG);
    }
    function check(el) {
        var v = el.value;
        el.setCustomValidity(v && !/^09\d{9}$/.test(v) ? MSG : "");
    }
    document.addEventListener("focusin", function (e) {
        if (e.target && PH_IDS[e.target.id]) prep(e.target);
    });
    document.addEventListener("input", function (e) {
        var el = e.target;
        if (!el || !PH_IDS[el.id]) return;
        prep(el);
        var clean = window.normalizePhPhone(el.value);
        if (clean !== el.value) el.value = clean;
        check(el);
    });
    document.addEventListener("DOMContentLoaded", function () {
        Object.keys(PH_IDS).forEach(function (id) { prep(document.getElementById(id)); });
    });
})();

/* ---------------------------------------------------------
   BOOKING TIME RANGES
   A booking is saved as its start time ("6:00 PM") plus duration_hours,
   so it blocks every hour from the start until start + duration.
--------------------------------------------------------- */
window.msHourOf = function (text) {
    const m = /(\d{1,2}):\d{2}\s*(AM|PM)/i.exec(String(text || ""));
    if (!m) return null;
    const h = parseInt(m[1], 10) % 12;
    return m[2].toUpperCase() === "PM" ? h + 12 : h;
};

window.msBookingRange = function (b) {
    const start = window.msHourOf(b.time_slot);
    if (start === null) return null;
    const dur = Math.max(1, parseInt(b.duration_hours, 10) || 1);
    return { start: start, end: start + dur };
};

/* true when [from, from + length) touches any booking in the list */
window.msOverlaps = function (bookings, from, length) {
    const to = from + (length || 1);
    return bookings.some(b => {
        const r = window.msBookingRange(b);
        return r && r.start < to && r.end > from;
    });
};

window.msIsFree = function (status) {
    const st = String(status || "Pending").trim().toLowerCase();
    return st === "rejected" || st === "cancelled" || st === "refunded";
};

// Helper Function para linisin ang nakatagong booking draft sa localStorage
window.clearBookingDraft = function() {
    localStorage.removeItem("multisportSelectedFacility");
    localStorage.removeItem("multisportSelectedIcon");
    localStorage.removeItem("multisportFacilityRate");
    localStorage.removeItem("multisportSelectedDate");
    localStorage.removeItem("multisportRawDate");
    localStorage.removeItem("multisportSelectedTime");
    localStorage.removeItem("multisportSelectedDuration");
    localStorage.removeItem("multisportDurationHours");
    localStorage.removeItem("multisportTotalPriceNum");
    localStorage.removeItem("multisportTotalPrice");
};

// Function para sa User Logout (Naka-ayos na para bumalik sa login page)
window.logoutUser = function() {
    localStorage.removeItem("multisportLoggedInUser");
    localStorage.removeItem("multisportAdminSession");
    localStorage.removeItem("multisportAdminToken");
    localStorage.removeItem("multisportUserToken");
    localStorage.removeItem("multisportBookingEmail");
    localStorage.removeItem("multisportBookingReference");
    window.clearBookingDraft();
    alert("You have logged out successfully.");
    window.location.href = "login.html";
};

/* =========================================================
   FACILITY STATUS & MAINTENANCE ENGINE
========================================================= */
window.getFacilityStatuses = function() {
    const defaultStatuses = {
        basketball: "available",
        volleyball: "available",
        tennis: "available",
        badminton: "available"
    };
    /* the real values live in the database; localStorage only keeps the last copy
       so the pages can paint instantly before the server answers */
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem("multisportFacilityStatuses") || "null"); } catch (e) { saved = null; }
    return Object.assign({}, defaultStatuses, saved || {});
};

/* admin token (given by the server at admin login) */
window.getAdminToken = function() {
    try { return localStorage.getItem("multisportAdminToken") || ""; } catch (e) { return ""; }
};
window.adminHeaders = function(extra) {
    return Object.assign({ "Content-Type": "application/json", "Authorization": "Bearer " + window.getAdminToken() }, extra || {});
};

/* read the court statuses from the database */
window.loadFacilityStatuses = async function() {
    try {
        const res = await fetch(`${API_BASE}/facility-status`);
        if (!res.ok) return;
        const data = await res.json();
        if (!data || typeof data !== "object") return;
        const before = localStorage.getItem("multisportFacilityStatuses");
        const merged = Object.assign(window.getFacilityStatuses(), data);
        localStorage.setItem("multisportFacilityStatuses", JSON.stringify(merged));
        window.applyFacilityStatusesToUI();
        if (before !== JSON.stringify(merged)) window.dispatchEvent(new Event("storage"));
    } catch (e) { /* offline: keep what the page already shows */ }
};

/* admin only: the server refuses this without the admin token */
window.changeFacilityStatus = async function(facilityKey, newStatus) {
    const selectEl = document.getElementById(`status_${facilityKey}`);
    const previous = window.getFacilityStatuses()[facilityKey] || "available";
    try {
        const res = await fetch(`${API_BASE}/facility-status/${facilityKey}`, {
            method: "PUT",
            headers: window.adminHeaders(),
            body: JSON.stringify({ status: newStatus })
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) {
            alert("Your admin session has expired. Please log in again.");
            window.location.href = "login.html";
            return;
        }
        if (!res.ok || !data.success) throw new Error(data.message || "failed");
        const statuses = window.getFacilityStatuses();
        statuses[facilityKey] = newStatus;
        localStorage.setItem("multisportFacilityStatuses", JSON.stringify(statuses));
        alert(`Status for ${facilityKey.toUpperCase()} updated to: ${newStatus.toUpperCase()}`);
    } catch (err) {
        if (selectEl) selectEl.value = previous;
        alert("Could not save the court status. Please check your connection and try again.");
    }
    window.applyFacilityStatusesToUI();
    window.dispatchEvent(new Event("storage"));
};

window.applyFacilityStatusesToUI = function() {
    const statuses = window.getFacilityStatuses();

    Object.keys(statuses).forEach(fac => {
        const selectEl = document.getElementById(`status_${fac}`);
        if (selectEl) {
            selectEl.value = statuses[fac];
        }
    });

    const facilityCards = document.querySelectorAll(".facility-card, article.card");
    facilityCards.forEach(card => {
        const textContent = card.textContent.toLowerCase();
        let matchedKey = null;

        if (textContent.includes("basketball")) matchedKey = "basketball";
        else if (textContent.includes("volleyball")) matchedKey = "volleyball";
        else if (textContent.includes("tennis")) matchedKey = "tennis";
        else if (textContent.includes("badminton")) matchedKey = "badminton";

        if (matchedKey && statuses[matchedKey]) {
            const statusVal = statuses[matchedKey];
            const statusBadge = card.querySelector(".facility-status, .tag, span[class*='status']");
            const bookBtn = card.querySelector("a[href*='booking']");

            if (statusBadge) {
                statusBadge.classList.remove("status-maintenance", "status-occupied");

                if (statusVal === "maintenance") {
                    statusBadge.textContent = "Under Maintenance";
                    statusBadge.classList.add("status-maintenance");
                    statusBadge.style.backgroundColor = "#334155";
                    statusBadge.style.color = "#ffffff";
                } else if (statusVal === "occupied") {
                    statusBadge.textContent = "Occupied / Event";
                    statusBadge.classList.add("status-occupied");
                    statusBadge.style.backgroundColor = "#475569";
                    statusBadge.style.color = "#ffffff";
                } else {
                    statusBadge.textContent = "Available";
                    statusBadge.style.backgroundColor = "#0f172a";
                    statusBadge.style.color = "#ffffff";
                }
            }

            if (bookBtn) {
                if (statusVal !== "available") {
                    bookBtn.textContent = statusVal === "maintenance" ? "Maintenance" : "Unavailable";
                    bookBtn.style.pointerEvents = "none";
                    bookBtn.style.opacity = "0.5";
                    bookBtn.style.background = "#64748b";
                } else {
                    bookBtn.textContent = "Book";
                    bookBtn.style.pointerEvents = "auto";
                    bookBtn.style.opacity = "1";
                    bookBtn.style.background = "";
                }
            }
        }
    });

    if (document.querySelector(".booking-page-section")) {
        Object.keys(statuses).forEach(fac => {
            const radioInput = document.querySelector(`input[name="facility"][value="${fac}"]`);
            if (radioInput) {
                const choiceLabel = radioInput.closest(".facility-choice");
                if (statuses[fac] !== "available") {
                    radioInput.disabled = true;
                    if (choiceLabel) {
                        choiceLabel.style.opacity = "0.4";
                        choiceLabel.style.cursor = "not-allowed";
                        choiceLabel.title = `This court is currently ${statuses[fac]}`;
                    }
                    if (radioInput.checked) {
                        radioInput.checked = false;
                    }
                } else {
                    radioInput.disabled = false;
                    if (choiceLabel) {
                        choiceLabel.style.opacity = "1";
                        choiceLabel.style.cursor = "pointer";
                        choiceLabel.title = "";
                    }
                }
            }
        });
        window.applyFacilityLock();
    }
};

/* When a visitor arrives with a court already chosen (a "Book" button on Home / Facilities, or a day picked in the
   calendar), the other three courts fade out and cannot be selected. "Back to facilities" changes the court. */
window._lockedFacility = "";
window.applyFacilityLock = function () {
    const locked = window._lockedFacility;
    if (!locked) return;
    document.querySelectorAll('input[name="facility"]').forEach(radio => {
        const label = radio.closest(".facility-choice");
        if (radio.value === locked) {
            if (label) label.classList.remove("is-locked");
            return;
        }
        radio.disabled = true;
        radio.checked = false;
        if (label) {
            label.classList.add("is-locked");
            label.title = "You already picked a court. Use Back to facilities to change it.";
        }
    });
};

/* =========================================================
   AUTO-DISABLE OCCUPIED TIME SLOTS ON BOOKING PAGE
========================================================= */
/* A start time is "past" when its date is before today, or it is today and its hour has already begun
   (same rule the server uses for the calendar). */
window.msPastCheck = function (dateStr, hour) {
    if (!dateStr || hour === null || hour === undefined) return false;
    const today = new Date().toLocaleDateString("en-CA");
    if (dateStr < today) return true;
    return dateStr === today && hour <= new Date().getHours();
};

window.applyPastSlots = function () {
    const dateInput = document.getElementById("bookingDate");
    const radios = document.querySelectorAll('input[name="time"]');
    if (!dateInput || !radios.length) return;
    const date = dateInput.value;
    let pastCount = 0;
    radios.forEach(radio => {
        const label = radio.closest("label") || radio.parentElement;
        const past = window.msPastCheck(date, window.msHourOf(radio.value));
        if (past) {
            pastCount++;
            radio.disabled = true;
            if (radio.checked) radio.checked = false;
            radio.dataset.past = "1";
            if (label) { label.style.opacity = "0.4"; label.style.cursor = "not-allowed"; label.title = "This time has already passed."; }
        } else if (radio.dataset.past === "1") {
            radio.dataset.past = "";
            radio.disabled = false;
            if (label) { label.style.opacity = "1"; label.style.cursor = "pointer"; label.title = ""; }
        }
    });
    /* nothing left today: say so, instead of leaving a row of faded buttons */
    let note = document.getElementById("pastNote");
    if (pastCount === radios.length) {
        if (!note) {
            note = document.createElement("p");
            note.id = "pastNote";
            note.className = "past-note";
            const first = radios[0].closest("label") || radios[0];
            const group = first.parentElement;
            group.parentElement.insertBefore(note, group.nextSibling);
        }
        note.textContent = "There are no more open times for this date. Please pick another day.";
        note.hidden = false;
    } else if (note) {
        note.hidden = true;
    }
};

async function syncOccupiedTimeSlots() {
    const selectedFacilityInput = document.querySelector('input[name="facility"]:checked');
    const bookingDateInput = document.getElementById("bookingDate");

    window.applyPastSlots();
    if (!selectedFacilityInput || !bookingDateInput || !bookingDateInput.value) return;

    const facilityVal = selectedFacilityInput.value; 
    const bookingDate = bookingDateInput.value;

    try {
        const res = await fetch(`${API_BASE}/bookings/busy`);
        const allBookings = await res.json();

        const activeBookings = allBookings.filter(b => {
            const dbFac = String(b.facility || "").toLowerCase();
            const dbDate = String(b.booking_date || "").split("T")[0];
            const dbStatus = String(b.booking_status || "Pending").toLowerCase();

            return dbFac.includes(facilityVal.toLowerCase()) && 
                   dbDate === bookingDate && 
                   dbStatus !== "rejected" && 
                   dbStatus !== "cancelled" && 
                   dbStatus !== "refunded";
        });

        // hours already taken (start + duration); booking.html uses this to limit the Duration list
        window._occupiedRanges = activeBookings.map(window.msBookingRange).filter(Boolean);

        const timeInputs = document.querySelectorAll('input[name="time"]');
        timeInputs.forEach(radio => {
            const parentLabel = radio.closest("label") || radio.parentElement;

            // a start time is taken when its hour falls inside a booked range
            const radioHour = window.msHourOf(radio.value);
            const isOccupied = radioHour !== null && window._occupiedRanges.some(r => r.start <= radioHour && radioHour < r.end);
            const isPast = window.msPastCheck(bookingDate, radioHour);

            if (isPast) {
                radio.disabled = true;
                radio.dataset.past = "1";
                if (radio.checked) radio.checked = false;
                if (parentLabel) {
                    parentLabel.style.opacity = "0.4";
                    parentLabel.style.cursor = "not-allowed";
                    parentLabel.title = "This time has already passed.";
                }
            } else if (isOccupied) {
                radio.dataset.past = "";
                radio.disabled = true;
                if (radio.checked) radio.checked = false;

                if (parentLabel) {
                    parentLabel.style.opacity = "0.4";
                    parentLabel.style.cursor = "not-allowed";
                    parentLabel.title = "This time slot is already reserved.";
                }
            } else {
                radio.dataset.past = "";
                radio.disabled = false;
                if (parentLabel) {
                    parentLabel.style.opacity = "1";
                    parentLabel.style.cursor = "pointer";
                    parentLabel.title = "";
                }
            }
        });
        window.applyPastSlots();

        window.dispatchEvent(new Event("occupied-ranges"));

    } catch (err) {
        console.error("Error syncing occupied slots:", err);
    }
}

window.updateLiveBookingSummary = function () {
    const facilityData = {
        basketball: { name: "Basketball Court", type: "Indoor · Basketball", icon: "🏀", rate: 500 },
        volleyball: { name: "Volleyball Court", type: "Indoor · Volleyball", icon: "🏐", rate: 500 },
        tennis: { name: "Tennis Court", type: "Outdoor · Tennis", icon: "🎾", rate: 500 },
        badminton: { name: "Badminton Court", type: "Indoor · Badminton", icon: "🏸", rate: 300 }
    };

    const selectedFacility = document.querySelector('input[name="facility"]:checked');
    const icon = document.querySelector(".summary-sport-icon");
    const name = document.querySelector(".summary-preview-content strong");
    const type = document.querySelector(".summary-preview-content > span:last-child");

    let facilityRate = 0;
    if (selectedFacility && facilityData[selectedFacility.value]) {
        const fac = facilityData[selectedFacility.value];
        if (icon) icon.textContent = fac.icon;
        if (name) name.textContent = fac.name;
        if (type) type.textContent = fac.type;
        facilityRate = fac.rate;

        localStorage.setItem("multisportSelectedFacility", fac.name);
        localStorage.setItem("multisportSelectedIcon", fac.icon);
        localStorage.setItem("multisportFacilityRate", fac.rate);
    } else {
        localStorage.removeItem("multisportSelectedFacility");
        localStorage.removeItem("multisportSelectedIcon");
        localStorage.removeItem("multisportFacilityRate");
        if (icon) icon.textContent = "❓";
        if (name) name.textContent = "Select a facility";
        if (type) type.textContent = "No facility chosen";
    }

    const bookingDate = document.getElementById("bookingDate");
    const summaryDate = document.getElementById("summaryDate");
    if (bookingDate && summaryDate) {
        if (bookingDate.value) {
            summaryDate.textContent = bookingDate.value;
            localStorage.setItem("multisportSelectedDate", bookingDate.value);
            localStorage.setItem("multisportRawDate", bookingDate.value);
        } else {
            summaryDate.textContent = "Not selected";
            localStorage.removeItem("multisportSelectedDate");
            localStorage.removeItem("multisportRawDate");
        }
    }

    const selectedTime = document.querySelector('input[name="time"]:checked');
    const summaryTime = document.getElementById("summaryTime");
    if (summaryTime) {
        if (selectedTime) {
            summaryTime.textContent = selectedTime.value;
            localStorage.setItem("multisportSelectedTime", selectedTime.value);
        } else {
            summaryTime.textContent = "Not selected";
            localStorage.removeItem("multisportSelectedTime");
        }
    }

    const bookingDuration = document.getElementById("bookingDuration");
    const summaryDuration = document.getElementById("summaryDuration");
    
    let durationHours = 1;
    if (bookingDuration && bookingDuration.value) {
        durationHours = parseInt(bookingDuration.value) || 1;
    }

    if (bookingDuration && summaryDuration) {
        const sel = bookingDuration.options[bookingDuration.selectedIndex];
        if (bookingDuration.value && sel) {
            const text = sel.textContent.trim();
            summaryDuration.textContent = text;
            localStorage.setItem("multisportSelectedDuration", text);
        } else {
            summaryDuration.textContent = "Not selected";
        }
    }

    localStorage.setItem("multisportDurationHours", String(durationHours));

    const totalPrice = facilityRate * durationHours;
    if (facilityRate > 0) {
        localStorage.setItem("multisportTotalPriceNum", totalPrice);
        localStorage.setItem("multisportTotalPrice", "₱" + totalPrice.toLocaleString() + ".00");
    }

    const selectedMethod = document.querySelector('input[name="booking_method"]:checked');
    const summaryMethod = document.getElementById("summaryMethod");
    const continueBtn = document.getElementById("continueBookingBtn");
    const loggedInUserRaw = localStorage.getItem("multisportLoggedInUser");

    {
        /* no more "account or guest" choice: a logged-in customer pays here,
           everyone else continues to the guest form (which offers "Log in instead") */
        if (!loggedInUserRaw) {
            if (summaryMethod) summaryMethod.textContent = "Guest Booking";
            if (continueBtn) {
                continueBtn.href = "guest-booking.html";
                continueBtn.onclick = async function (e) {
                    e.preventDefault();
                    window.updateLiveBookingSummary();

                    const selFac = localStorage.getItem("multisportSelectedFacility");
                    const selDate = localStorage.getItem("multisportSelectedDate");
                    const selTime = localStorage.getItem("multisportSelectedTime");

                    let missingFields = [];
                    if (!selFac) missingFields.push("Facility");
                    if (!selDate || selDate === "Not selected") missingFields.push("Reservation Date");
                    if (!selTime || selTime === "Not selected") missingFields.push("Preferred Time");

                    if (missingFields.length > 0) {
                        alert("⚠️ Missing required details!\n\nPlease complete: " + missingFields.join(", "));
                        return;
                    }

                    const isAvailable = await checkAvailability(selFac, selDate, selTime);
                    if (isAvailable) {
                        /* the guest page only opens when it was reached from this booking step */
                        try { sessionStorage.setItem("msGuestFlow", "1"); } catch (err) {}
                        window.location.href = "guest-booking.html";
                    }
                };
            }
        } else {
            if (summaryMethod) summaryMethod.textContent = "Customer Account";
            if (continueBtn) {
                if (loggedInUserRaw) {
                    continueBtn.href = "#";
                    continueBtn.onclick = async function (e) {
                        e.preventDefault();
                        window.updateLiveBookingSummary();

                        const selectedFacility = localStorage.getItem("multisportSelectedFacility");
                        const selectedDate = localStorage.getItem("multisportSelectedDate");
                        const selectedTime = localStorage.getItem("multisportSelectedTime");

                        let missingFields = [];
                        if (!selectedFacility) missingFields.push("Facility");
                        if (!selectedDate || selectedDate === "Not selected") missingFields.push("Reservation Date");
                        if (!selectedTime || selectedTime === "Not selected") missingFields.push("Preferred Time");

                        if (missingFields.length > 0) {
                            alert("⚠️ Missing required details!\n\nPlease complete: " + missingFields.join(", "));
                            return;
                        }

                        const isAvailable = await checkAvailability(selectedFacility, selectedDate, selectedTime);
                        if (!isAvailable) return;

                        const modal = document.getElementById("qrPaymentModal");
                        const priceDisplay = document.getElementById("modalTotalPriceDisplay");
                        const currentTotal = localStorage.getItem("multisportTotalPrice") || "₱500.00";
                        
                        if (priceDisplay) priceDisplay.textContent = "Total: " + currentTotal;
                        if (modal) modal.style.display = "flex";
                    };
                } else {
                    continueBtn.href = "login.html";
                    continueBtn.onclick = null;
                }
            }
        }
    }
};

async function checkAvailability(facility, booking_date, time_slot) {
    try {
        const duration_hours = parseInt(localStorage.getItem("multisportDurationHours"), 10) || 1;
        const res = await fetch(`${API_BASE}/bookings/check-availability`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ facility, booking_date, time_slot, duration_hours })
        });
        const data = await res.json();
        if (!data.available) {
            alert(data.message);
            return false;
        }
        return true;
    } catch (err) {
        console.error("Availability Check Error:", err);
        return true;
    }
}

document.addEventListener("DOMContentLoaded", function () {
    const urlParams = new URLSearchParams(window.location.search);
    const selectedFacilityParam = urlParams.get('facility');

    document.querySelectorAll("a[href='index.html'], a.logo, .brand-logo-img").forEach(homeLink => {
        homeLink.addEventListener("click", () => {
            window.clearBookingDraft();
        });
    });

    const directBookBtns = document.querySelectorAll("a[href='booking.html']:not(.nav-link)");
    directBookBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            window.clearBookingDraft();
        });
    });

    window.applyFacilityStatusesToUI();
    window.loadFacilityStatuses();
    setInterval(function () { if (document.visibilityState === "visible") window.loadFacilityStatuses(); }, 30000);

    if (document.querySelector(".booking-page-section")) {
        const guestRadio = document.querySelector('input[name="booking_method"][value="guest"]');
        const accountRadio = document.querySelector('input[name="booking_method"][value="account"]');
        const loggedInUserRaw = localStorage.getItem("multisportLoggedInUser");
        const acctNote = document.getElementById("bookingAccountNote");
        if (acctNote) acctNote.hidden = !!loggedInUserRaw;

        if (loggedInUserRaw) {
            if (accountRadio) accountRadio.checked = true;
            if (guestRadio) {
                guestRadio.disabled = true;
                const parentLabel = guestRadio.closest(".booking-method");
                if (parentLabel) {
                    parentLabel.style.opacity = "0.5";
                    parentLabel.style.cursor = "not-allowed";
                }
            }
        } else {
            if (guestRadio) {
                guestRadio.disabled = false;
                guestRadio.checked = true;
                const parentLabel = guestRadio.closest(".booking-method");
                if (parentLabel) {
                    parentLabel.style.opacity = "1";
                    parentLabel.style.cursor = "pointer";
                }
            }
        }

        const cameFromCalendar = !!localStorage.getItem("multisportFromSearchModal");
        if (!localStorage.getItem("multisportFromSearchModal")) {
            if (!selectedFacilityParam) {
                window.clearBookingDraft();
            } else {
                /* a court picked from the "Book" buttons starts with an empty date and time,
                   so an old booking's schedule never carries over */
                ["multisportSelectedDate", "multisportRawDate", "multisportSelectedTime", "multisportSelectedDuration",
                 "multisportDurationHours", "multisportTotalPriceNum", "multisportTotalPrice"].forEach(k => localStorage.removeItem(k));
            }
        }
        
        localStorage.removeItem("multisportFromSearchModal");

        const savedFacility = localStorage.getItem("multisportSelectedFacility");
        const savedDate = localStorage.getItem("multisportSelectedDate");
        const savedTime = localStorage.getItem("multisportSelectedTime");

        document.querySelectorAll('input[name="facility"]').forEach(radio => {
            radio.checked = false;
        });

        document.querySelectorAll('input[name="time"]').forEach(radio => {
            radio.checked = false;
        });

        const dateInput = document.getElementById("bookingDate");
        if (dateInput) {
            dateInput.value = "";
        }

        let targetFac = selectedFacilityParam || savedFacility;
        if (targetFac) {
            const cleanFac = targetFac.toLowerCase().trim();
            let mapKey = "";

            if (cleanFac.includes("volleyball")) mapKey = "volleyball";
            else if (cleanFac.includes("tennis")) mapKey = "tennis";
            else if (cleanFac.includes("badminton")) mapKey = "badminton";
            else if (cleanFac.includes("basketball")) mapKey = "basketball";

            if (mapKey) {
                const facRadio = document.querySelector(`input[name="facility"][value="${mapKey}"]`);
                if (facRadio && !facRadio.disabled) {
                    facRadio.checked = true;
                    if (selectedFacilityParam || cameFromCalendar) {
                        window._lockedFacility = mapKey;
                        window.applyFacilityLock();
                    }
                }
            }
        }

        if (dateInput && savedDate && savedDate !== "Not selected") {
            dateInput.value = savedDate;
        }

        document.querySelectorAll('input[name="facility"]').forEach(input => {
            input.addEventListener("change", async () => {
                window.updateLiveBookingSummary();
                await syncOccupiedTimeSlots();
            });
        });

        if (dateInput) {
            dateInput.addEventListener("change", async () => {
                window.updateLiveBookingSummary();
                await syncOccupiedTimeSlots();
            });
        }

        syncOccupiedTimeSlots().then(() => {
            if (savedTime && savedTime !== "Not selected") {
                const timeInputs = document.querySelectorAll('input[name="time"]');
                timeInputs.forEach(radio => {
                    if (!radio.disabled && radio.value.toLowerCase().includes(savedTime.toLowerCase().split("-")[0].trim())) {
                        radio.checked = true;
                    }
                });
            }
            window.updateLiveBookingSummary();
        });

        const durationSelect = document.getElementById("bookingDuration");
        if (durationSelect) {
            durationSelect.addEventListener("change", window.updateLiveBookingSummary);
        }
        document.querySelectorAll('input[name="time"], input[name="booking_method"]').forEach(input => {
            input.addEventListener("change", window.updateLiveBookingSummary);
        });
    }

    const guestFirstName = document.getElementById("guestFirstName");
    const guestLastName = document.getElementById("guestLastName");
    const guestEmail = document.getElementById("guestEmail");
    const guestPhone = document.getElementById("guestPhone");
    const guestAddress = document.getElementById("guestAddress");
    const guestPurpose = document.getElementById("guestPurpose");

    const guestSummaryName = document.getElementById("guestSummaryName");
    const guestSummaryContact = document.getElementById("guestSummaryContact");

    function updateGuestSummaryLive() {
        const fName = guestFirstName ? guestFirstName.value.trim() : "";
        const lName = guestLastName ? guestLastName.value.trim() : "";
        const emailVal = guestEmail ? guestEmail.value.trim() : "";
        const phoneVal = guestPhone ? guestPhone.value.trim() : "";

        if (guestSummaryName) {
            if (fName || lName) {
                guestSummaryName.textContent = `${fName} ${lName}`.trim();
            } else {
                guestSummaryName.textContent = "Not provided";
            }
        }

        if (guestSummaryContact) {
            if (emailVal || phoneVal) {
                guestSummaryContact.textContent = emailVal && phoneVal ? `${emailVal} / ${phoneVal}` : (emailVal || phoneVal);
            } else {
                guestSummaryContact.textContent = "Not provided";
            }
        }
    }

    if (document.querySelector(".guest-booking-page") || document.title.toLowerCase().includes("guest") || guestFirstName) {
        const savedFacility = localStorage.getItem("multisportSelectedFacility") || "Select a facility";
        const savedIcon = localStorage.getItem("multisportSelectedIcon") || "❓";
        const savedDate = localStorage.getItem("multisportSelectedDate") || "Not selected";
        const savedTime = localStorage.getItem("multisportSelectedTime") || "Not selected";
        const savedPrice = localStorage.getItem("multisportTotalPrice") || "₱0.00";

        const iconEl = document.querySelector(".summary-sport-icon") || document.querySelector(".choice-icon") || document.querySelector(".summary-preview-image");
        const titleEl = document.querySelector(".summary-preview-content strong") || document.querySelector(".selected-facility-name");
        const subEl = document.querySelector(".summary-preview-content span:last-child");

        if (iconEl && iconEl.children.length === 0) iconEl.textContent = savedIcon;
        if (titleEl) titleEl.textContent = savedFacility;
        if (subEl) subEl.textContent = "Total: " + savedPrice;

        const summaryDate = document.getElementById("summaryDate");
        const summaryTime = document.getElementById("summaryTime");
        if (summaryDate) summaryDate.textContent = savedDate;
        if (summaryTime) summaryTime.textContent = savedTime;

        [guestFirstName, guestLastName, guestEmail, guestPhone, guestAddress].forEach(input => {
            if (input) {
                input.addEventListener("input", updateGuestSummaryLive);
            }
        });

        updateGuestSummaryLive();

        const submitGuestBookingBtn = document.getElementById("submitGuestBooking");

        if (submitGuestBookingBtn) {
            submitGuestBookingBtn.addEventListener("click", async function (e) {
                e.preventDefault();

                const fName = guestFirstName ? guestFirstName.value.trim() : "";
                const lName = guestLastName ? guestLastName.value.trim() : "";
                const emailVal = guestEmail ? guestEmail.value.trim() : "";
                const phoneVal = guestPhone ? guestPhone.value.trim() : "";
                const addressVal = guestAddress ? guestAddress.value.trim() : "";
                const purposeVal = guestPurpose ? guestPurpose.value.trim() : "";
                
                const confirmCheckbox = document.getElementById("guestAgreement") || document.querySelector("input[type='checkbox']");

                let specificMissing = [];
                if (!fName) specificMissing.push("First name");
                if (!lName) specificMissing.push("Last name");
                if (!emailVal) specificMissing.push("Email address");
                if (!phoneVal) specificMissing.push("Contact number");
                if (!addressVal) specificMissing.push("Address");
                if (!purposeVal) specificMissing.push("Purpose of reservation");

                if (specificMissing.length > 0) {
                    alert("⚠️ Please fill in your " + specificMissing.join(", ") + ".");
                    return;
                }

                if (!validateNameInput(fName)) {
                    alert("⚠️ Invalid First Name!\nNumbers and special characters are not allowed.");
                    guestFirstName.focus();
                    return;
                }
                if (!validateNameInput(lName)) {
                    alert("⚠️ Invalid Last Name!\nNumbers and special characters are not allowed.");
                    guestLastName.focus();
                    return;
                }
                if (!validateEmailInput(emailVal)) {
                    alert("⚠️ Invalid Email Address!\nPlease enter a valid email format (e.g., name@gmail.com).");
                    guestEmail.focus();
                    return;
                }
                if (!validatePhoneInput(phoneVal)) {
                    alert("⚠️ Please enter a valid contact number (Example: 09123456789).");
                    guestPhone.focus();
                    return;
                }

                if (confirmCheckbox && !confirmCheckbox.checked) {
                    alert("⚠️ Please confirm and check the agreement box before submitting your reservation.");
                    confirmCheckbox.focus();
                    return;
                }

                localStorage.setItem("multisportGuestName", fName + " " + lName);
                localStorage.setItem("multisportGuestEmail", emailVal);
                localStorage.setItem("multisportGuestPhone", phoneVal || "N/A");
                localStorage.setItem("multisportGuestAddress", addressVal);
                localStorage.setItem("multisportGuestPurpose", purposeVal);
                localStorage.setItem("multisportGuestOrg", "N/A");

                const selFac = localStorage.getItem("multisportSelectedFacility");
                const selDate = localStorage.getItem("multisportSelectedDate");
                const selTime = localStorage.getItem("multisportSelectedTime");

                const isAvailable = await checkAvailability(selFac, selDate, selTime);
                if (!isAvailable) return;

                const modal = document.getElementById("qrPaymentModal");
                const priceDisplay = document.getElementById("modalTotalPriceDisplay");
                const currentTotal = localStorage.getItem("multisportTotalPrice") || "₱500.00";
                
                if (priceDisplay) priceDisplay.textContent = "Total: " + currentTotal;
                if (modal) modal.style.display = "flex";
            });
        }
    }

    const confirmQrBtn = document.getElementById("confirmQrPaymentBtn");
    const cancelQrBtn = document.getElementById("cancelQrModalBtn");
    const qrModal = document.getElementById("qrPaymentModal");

    /* GCash reference numbers are digits only (13 for Send Money). Spaces and letters are removed
       while typing, and the box stops at 13. Change these two numbers if your receipts differ. */
    const REF_MIN_DIGITS = 13;
    const REF_MAX_DIGITS = 13;
    const refBox = document.getElementById("modalRefNumberInput");
    if (refBox) {
        const cleanRef = () => {
            const cleaned = refBox.value.replace(/\D/g, "").slice(0, REF_MAX_DIGITS);
            if (refBox.value !== cleaned) refBox.value = cleaned;
        };
        refBox.addEventListener("input", cleanRef);
        refBox.addEventListener("paste", () => setTimeout(cleanRef, 0));
    }

    /* payment screenshot: shrunk in the browser (so the upload stays small) and sent with the booking */
    let proofData = "";
    const proofInput = document.getElementById("modalProofInput");
    const proofPreview = document.getElementById("proofPreview");

    function shrinkImage(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(new Error("read"));
            reader.onload = () => {
                const img = new Image();
                img.onerror = () => reject(new Error("image"));
                img.onload = () => {
                    const MAX = 1400;
                    const scale = Math.min(1, MAX / Math.max(img.width, img.height));
                    const canvas = document.createElement("canvas");
                    canvas.width = Math.max(1, Math.round(img.width * scale));
                    canvas.height = Math.max(1, Math.round(img.height * scale));
                    const ctx = canvas.getContext("2d");
                    ctx.fillStyle = "#ffffff";
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    resolve(canvas.toDataURL("image/jpeg", 0.82));
                };
                img.src = reader.result;
            };
            reader.readAsDataURL(file);
        });
    }

    if (proofInput) {
        proofInput.addEventListener("change", async () => {
            proofData = "";
            if (proofPreview) { proofPreview.hidden = true; proofPreview.removeAttribute("src"); }
            const file = proofInput.files && proofInput.files[0];
            if (!file) return;
            if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
                alert("Please choose a screenshot in JPG, PNG or WebP format.");
                proofInput.value = "";
                return;
            }
            if (file.size > 15 * 1024 * 1024) {
                alert("That picture is too large. Please choose a screenshot under 15 MB.");
                proofInput.value = "";
                return;
            }
            try {
                proofData = await shrinkImage(file);
                if (proofPreview) { proofPreview.src = proofData; proofPreview.hidden = false; }
            } catch (err) {
                alert("We couldn't read that picture. Please choose another screenshot.");
                proofInput.value = "";
            }
        });
    }

    if (confirmQrBtn) {
        confirmQrBtn.onclick = async function() {
            const refInput = document.getElementById("modalRefNumberInput");
            const paymentRef = refInput ? refInput.value.replace(/\D/g, "") : "";

            if (!paymentRef) {
                alert("Please enter your GCash reference number.");
                if (refInput) refInput.focus();
                return;
            }
            if (paymentRef.length < REF_MIN_DIGITS) {
                alert("The GCash reference number should be " + REF_MIN_DIGITS + " digits. You entered " + paymentRef.length + ".\n\nPlease check your GCash receipt and try again.");
                if (refInput) refInput.focus();
                return;
            }
            if (document.getElementById("modalProofInput") && !proofData) {
                alert("Please upload a screenshot of your GCash payment.");
                if (proofInput) proofInput.focus();
                return;
            }

            const year = new Date().getFullYear();
            const number = Math.floor(1000 + Math.random() * 9000);
            const reference = "MS-" + year + "-" + number;

            let rawDateStored = localStorage.getItem("multisportRawDate") || localStorage.getItem("multisportSelectedDate");
            let rawDate = rawDateStored ? rawDateStored.split('T')[0] : new Date().toLocaleDateString('en-CA');
            let loggedInUserRaw = localStorage.getItem("multisportLoggedInUser");

            let bookingPayload = {};

            if (loggedInUserRaw && !document.getElementById("guestFirstName")) {
                const user = JSON.parse(loggedInUserRaw);
                bookingPayload = {
                    reference_no: reference,
                    payment_ref: paymentRef,
                    fullname: (user.firstName || "Customer") + " " + (user.lastName || ""),
                    email: user.email || "customer@multisport.com",
                    phone: user.phone || "N/A",
                    address: user.address || "N/A",
                    purpose: "Customer Account Reservation",
                    organization: "N/A",
                    facility: localStorage.getItem("multisportSelectedFacility") || "Basketball Court",
                    booking_date: rawDate,
                    time_slot: localStorage.getItem("multisportSelectedTime") || "Not selected",
                    amount: localStorage.getItem("multisportTotalPriceNum") || 500.00,
                    duration_hours: parseInt(localStorage.getItem("multisportDurationHours"), 10) || 1,
                    payment_proof: proofData
                };
            } else {
                const gName = localStorage.getItem("multisportGuestName") || "Guest User";
                const gEmail = localStorage.getItem("multisportGuestEmail") || "guest@multisport.com";
                const gPhone = localStorage.getItem("multisportGuestPhone") || "N/A";
                const gAddress = localStorage.getItem("multisportGuestAddress") || "N/A";
                const gPurpose = localStorage.getItem("multisportGuestPurpose") || "General Reservation";
                const gOrg = localStorage.getItem("multisportGuestOrg") || "N/A";

                bookingPayload = {
                    reference_no: reference,
                    payment_ref: paymentRef,
                    fullname: gName,
                    email: gEmail,
                    phone: gPhone,
                    address: gAddress,
                    purpose: gPurpose,
                    organization: gOrg,
                    facility: localStorage.getItem("multisportSelectedFacility") || "Basketball Court",
                    booking_date: rawDate,
                    time_slot: localStorage.getItem("multisportSelectedTime") || "Not selected",
                    amount: localStorage.getItem("multisportTotalPriceNum") || 500.00,
                    duration_hours: parseInt(localStorage.getItem("multisportDurationHours"), 10) || 1,
                    payment_proof: proofData
                };
            }

            try {
                const response = await fetch(`${API_BASE}/bookings`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(bookingPayload)
                });
                const data = await response.json();

                if (data.success) {
                    if (qrModal) qrModal.style.display = "none";
                    localStorage.setItem("multisportBookingReference", reference);
                    localStorage.setItem("multisportBookingEmail", bookingPayload.email || "");
                    window.clearBookingDraft(); /* the next booking starts blank */
                    window.showBookingSuccess({
                        reference: reference,
                        facility: bookingPayload.facility,
                        date: bookingPayload.booking_date,
                        time: bookingPayload.time_slot,
                        hours: bookingPayload.duration_hours,
                        amount: bookingPayload.amount
                    });
                } else {
                    alert(data.message || "We couldn't complete your booking. Please try again.");
                }
            } catch (error) {
                console.error("Booking Error:", error);
                alert("We couldn't reach the server. Please check your connection and try again.");
            }
        };
    }

    if (cancelQrBtn) {
        cancelQrBtn.onclick = function() {
            if (qrModal) qrModal.style.display = "none";
        };
    }

    const trackingForm = document.getElementById("trackingForm");
    if (trackingForm) {
        const bookingReferenceInput = document.getElementById("bookingReference");
        const trackingPreview = document.querySelector(".tracking-preview-card");
        const trackingReference = document.querySelector(".tracking-reference");
        const trackingStatusBadge = document.querySelector(".tracking-status-badge");

        const trackingEmailInput = document.getElementById("trackingEmail");

        async function fetchAndDisplayBooking(refCode, isUserSearch = false, emailCode = "") {
            try {
                const res = await fetch(`${API_BASE}/bookings/lookup?reference_no=${encodeURIComponent(refCode)}&email=${encodeURIComponent(emailCode)}`);
                const found = await res.json().catch(() => ({}));
                const booking = found && found.success ? found.booking : null;

                if (!booking) {
                    alert("⚠️ Reservation not found.\nPlease double-check the reference code and the email you used for the booking.");
                    if (trackingPreview) trackingPreview.style.display = "none";
                    return;
                }
                window.__trackEmail = emailCode; /* cancel.js needs it to refresh the booking */

                if (isUserSearch) {
                    alert("✅ Reservation Record Found!\nReference: " + booking.reference_no + "\nStatus: " + (booking.booking_status || "Pending"));
                }

                if (trackingReference) trackingReference.textContent = booking.reference_no;
                
                const currentStatus = booking.booking_status || "Pending";

                if (trackingStatusBadge) {
                    let badgeColor = "#334155";
                    if (currentStatus === "Approved") badgeColor = "#0f172a";
                    if (currentStatus === "Rejected" || currentStatus === "Refunded") badgeColor = "#475569";
                    if (currentStatus === "Refunded") badgeColor = "#1e293b";

                    trackingStatusBadge.innerHTML = `<span class="status-dot"></span> Status: <strong style="color: ${badgeColor};">${currentStatus}</strong> (Paid via QR)`;
                }

                const progressSteps = document.querySelectorAll(".progress-step");
                if (progressSteps.length >= 4) {
                    progressSteps.forEach((step, idx) => {
                        step.classList.remove("active");
                        step.style.background = ""; 
                        step.style.color = "";
                        const iconSpan = step.querySelector("span");
                        if (iconSpan) iconSpan.textContent = idx + 1;
                    });

                    progressSteps[0].classList.add("active");
                    progressSteps[0].querySelector("span").textContent = "✓";

                    if (currentStatus === "Approved") {
                        progressSteps[1].classList.add("active");
                        progressSteps[1].querySelector("span").textContent = "✓";
                        progressSteps[2].classList.add("active");
                        progressSteps[2].querySelector("span").textContent = "✓";
                        progressSteps[3].classList.add("active");
                        progressSteps[3].querySelector("span").textContent = "✓";
                    } else if (currentStatus === "Rejected" || currentStatus === "Refunded") {
                        progressSteps[1].classList.remove("active");
                    } else {
                        progressSteps[1].classList.add("active");
                    }
                }

                const detailBoxes = document.querySelectorAll(".tracking-detail");
                if (detailBoxes.length >= 4) {
                    const facStrong = detailBoxes[0].querySelector("strong");
                    if (facStrong) facStrong.textContent = booking.facility + " — Paid: ₱" + parseFloat(booking.amount).toLocaleString() + ".00";

                    const dateStrong = detailBoxes[1].querySelector("strong");
                    if (dateStrong) dateStrong.textContent = String(booking.booking_date || "").split("T")[0];

                    const schedStrong = detailBoxes[2].querySelector("strong");
                    if (schedStrong) schedStrong.textContent = booking.time_slot;

                    const typeStrong = detailBoxes[3].querySelector("strong");
                    if (typeStrong) typeStrong.textContent = booking.fullname + " (" + booking.email + ")";
                }

                let statusMsgBox = document.querySelector(".tracking-status-message") || document.querySelector(".alert-box, .status-alert");
                if (statusMsgBox) {
                    const titleEl = statusMsgBox.querySelector("strong");
                    const descEl = statusMsgBox.querySelector("p");

                    if (currentStatus === "Approved") {
                        if (titleEl) titleEl.textContent = "Reservation Approved & Confirmed!";
                        if (descEl) descEl.textContent = "Your booking has been reviewed and approved by the administrator. Please present your reference code upon arrival.";
                    } else if (currentStatus === "Refunded") {
                        if (titleEl) titleEl.textContent = "Reservation Update — Refund Completed";
                        if (descEl) descEl.textContent = "Your reservation was declined and your payment has been successfully refunded by the management.";
                    } else if (currentStatus === "Rejected") {
                        if (titleEl) titleEl.textContent = "Reservation Update — Booking Declined";
                        if (descEl) descEl.textContent = "Your reservation request was not approved. If you have already transferred a payment via QR reference, please reach out to the management for refund or verification assistance.";
                    } else {
                        if (titleEl) titleEl.textContent = "Waiting for administrator review";
                        if (descEl) descEl.textContent = "Your reservation request has been submitted and is waiting for the facility administrator to review.";
                    }
                }

                let printBtn = document.getElementById("printReceiptBtn");
                if (!printBtn && trackingPreview) {
                    printBtn = document.createElement("button");
                    printBtn.id = "printReceiptBtn";
                    printBtn.className = "no-print";
                    printBtn.style.cssText = "margin-top: 20px; padding: 12px 24px; background: #0f172a; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 15px; width: 100%; transition: background 0.2s;";
                    printBtn.onclick = function() { window.print(); };
                    trackingPreview.appendChild(printBtn);
                }

                if (printBtn) {
                    if (currentStatus === "Approved") {
                        printBtn.style.display = "block";
                        printBtn.innerHTML = "Print Approved Online Receipt";
                    } else {
                        printBtn.style.display = "none";
                    }
                }

                if (trackingPreview) {
                    trackingPreview.classList.add("printable-receipt");
                    trackingPreview.style.display = "block";
                    trackingPreview.style.visibility = "visible";
                    trackingPreview.style.opacity = "1";
                }

                localStorage.removeItem("multisportBookingReference");

            } catch (err) {
                console.error("Error fetching tracking info:", err);
                alert("Error connecting to server. Please try again.");
            }
        }

        trackingForm.addEventListener("submit", function (event) {
            event.preventDefault();
            const enteredReference = bookingReferenceInput ? bookingReferenceInput.value.trim().toUpperCase() : "";
            const enteredEmail = trackingEmailInput ? trackingEmailInput.value.trim() : "";
            if (!enteredReference) {
                alert("Please enter a valid booking reference number (e.g., MS-2026-XXXX).");
                return;
            }
            if (!enteredEmail) {
                alert("Please enter the email you used for the booking.");
                return;
            }
            fetchAndDisplayBooking(enteredReference, true, enteredEmail);
        });

        const autoRef = localStorage.getItem("multisportBookingReference");
        if (autoRef) {
            /* the email comes from the booking just made, or from the logged-in account */
            let autoEmail = localStorage.getItem("multisportBookingEmail") || "";
            if (!autoEmail) {
                try { autoEmail = (JSON.parse(localStorage.getItem("multisportLoggedInUser")) || {}).email || ""; } catch (e) { autoEmail = ""; }
            }
            if (autoEmail) {
                fetchAndDisplayBooking(autoRef, false, autoEmail);
                localStorage.removeItem("multisportBookingEmail");
            } else if (bookingReferenceInput) {
                bookingReferenceInput.value = autoRef; /* the visitor only needs to type the email */
            }
        }
    }

    const registerForm = document.getElementById("registerForm");
    if (registerForm) {
        registerForm.addEventListener("submit", async function (e) {
            e.preventDefault();
            const email = document.getElementById("registerEmail").value.trim();
            const password = document.getElementById("registerPassword").value;
            const confirmPassword = document.getElementById("confirmPassword").value;
            
            const firstName = document.getElementById("firstName") ? document.getElementById("firstName").value.trim() : "Customer";
            const lastName = document.getElementById("lastName") ? document.getElementById("lastName").value.trim() : "";
            const phone = document.getElementById("phoneNumber") ? document.getElementById("phoneNumber").value.trim() : "N/A";
            
            const addressInput = document.getElementById("registerAddress");
            const address = addressInput ? addressInput.value.trim() : "N/A";

            if (!validateNameInput(firstName)) {
                alert("⚠️ Invalid First Name!\nNumbers and special characters are not allowed.");
                return;
            }
            if (!validateNameInput(lastName)) {
                alert("⚠️ Invalid Last Name!\nNumbers and special characters are not allowed.");
                return;
            }
            if (!validateEmailInput(email)) {
                alert("⚠️ Invalid Email Address!\nPlease enter a valid email format (e.g., name@gmail.com).");
                return;
            }
            if (!validatePhoneInput(phone)) {
                alert("⚠️ Please enter a valid contact number (Example: 09123456789).");
                return;
            }

            if (password !== confirmPassword) {
                alert("Passwords do not match!");
                return;
            }

            try {
                const response = await fetch(`${API_BASE}/register`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password, firstName, lastName, phone, address })
                });

                const data = await response.json();
                if (data.success) {
                    alert("✅ Your account has been created.\n\nYou can now log in. Taking you to the login page...");
                    window.location.href = "login.html";
                } else {
                    alert(data.message || "Registration failed.");
                }
            } catch (err) {
                console.error("Registration Error:", err);
            }
        });
    }

    const loginForm = document.getElementById("loginForm");
    if (loginForm) {
        loginForm.addEventListener("submit", async function (e) {
            e.preventDefault();
            const emailInput = document.getElementById("loginEmail").value.trim();
            const passwordInput = document.getElementById("loginPassword").value;

            try {
                const response = await fetch(`${API_BASE}/login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: emailInput, password: passwordInput })
                });

                const data = await response.json();

                if (data.success) {
                    if (data.user.role === 'admin') {
                        localStorage.setItem("multisportAdminSession", JSON.stringify(data.user));
                        localStorage.setItem("multisportAdminToken", data.token || "");
                        alert("Admin login successful! Redirecting to Admin Dashboard...");
                        window.location.href = "admin-dashboard.html";
                    } else {
                        localStorage.setItem("multisportLoggedInUser", JSON.stringify(data.user));
                        localStorage.setItem("multisportUserToken", data.userToken || "");
                        alert("Login successful!");
                        window.location.href = "index.html"; // Na-update na para sa Home/Index page mapunta
                    }
                } else {
                    alert(data.message || "Invalid email or password.");
                }
            } catch (err) {
                console.error("Login Error:", err);
            }
        });
    }

    const adminTableBody = document.getElementById("adminTableBody");
    if (adminTableBody || document.querySelector(".admin-body")) {
        renderAdminDashboard("all");

        document.querySelectorAll("[data-admin-filter]").forEach((btn) => {
            btn.addEventListener("click", function () {
                document.querySelectorAll("[data-admin-filter]").forEach(b => b.classList.remove("active"));
                this.classList.add("active");
                const filterVal = this.getAttribute("data-admin-filter");
                renderAdminDashboard(filterVal);
            });
        });
    }

    // Quick Search Button with Preferred Time Filter & Secured Privacy
    const searchBtn = document.getElementById("homeQuickSearchBtn");
    if (searchBtn) {
        searchBtn.addEventListener("click", async function (e) {
            e.preventDefault();

            const sportSelect = document.getElementById("homeSportSelect");
            const dateInput = document.getElementById("homeQuickDate");
            const timeFilterSelect = document.getElementById("homeQuickTime");

            const selectedSport = sportSelect ? sportSelect.value.trim().toLowerCase() : "";
            const selectedDate = dateInput ? dateInput.value.trim() : "";
            const rawTimeVal = timeFilterSelect ? timeFilterSelect.value.trim() : "";

            let preferredTimeFilter = "any time";
            if (rawTimeVal === "8:00 AM") preferredTimeFilter = "morning";
            else if (rawTimeVal === "12:00 PM") preferredTimeFilter = "afternoon";
            else if (rawTimeVal === "6:00 PM") preferredTimeFilter = "evening";
            else if (rawTimeVal.toLowerCase().includes("morning")) preferredTimeFilter = "morning";
            else if (rawTimeVal.toLowerCase().includes("afternoon")) preferredTimeFilter = "afternoon";
            else if (rawTimeVal.toLowerCase().includes("evening")) preferredTimeFilter = "evening";

            if (!selectedSport || !selectedDate) {
                alert("Please select both a Sport and a Date to check court availability.");
                return;
            }

            const allStatuses = window.getFacilityStatuses();
            let matchedKey = "basketball";
            if (selectedSport.includes("volleyball")) matchedKey = "volleyball";
            else if (selectedSport.includes("tennis")) matchedKey = "tennis";
            else if (selectedSport.includes("badminton")) matchedKey = "badminton";
            else if (selectedSport.includes("basketball")) matchedKey = "basketball";

            const currentFacStatus = allStatuses[matchedKey] || "available";

            const modal = document.getElementById("scheduleModal");
            const titleEl = document.getElementById("modalScheduleTitle");
            const subEl = document.getElementById("modalScheduleSub");
            const slotsContainer = document.getElementById("scheduleSlotsContainer");

            const sportName = selectedSport.charAt(0).toUpperCase() + selectedSport.slice(1) + " Court";
            if (titleEl) titleEl.textContent = `${sportName} — Schedule`;
            if (subEl) subEl.textContent = `Reservations for Date: ${selectedDate} (${preferredTimeFilter.toUpperCase()})`;

            if (slotsContainer) {
                slotsContainer.innerHTML = `<div style="text-align: center; padding: 20px; color: #64748b;">Checking database for bookings...</div>`;
            }

            if (modal) modal.style.display = "flex";

            try {
                const res = await fetch(`${API_BASE}/bookings/busy`);
                const allBookings = await res.json();

                const relevantBookings = allBookings.filter(b => {
                    const dbFacility = (b.facility || "").toLowerCase();
                    const dbDateStr = String(b.booking_date || "").split("T")[0];
                    const dbStatus = String(b.booking_status || "Pending").trim().toLowerCase();

                    const isFacilityMatch = dbFacility.includes(selectedSport);
                    const isDateMatch = dbDateStr === selectedDate || dbDateStr.includes(selectedDate);
                    const isNotRejected = dbStatus !== "rejected" && dbStatus !== "cancelled" && dbStatus !== "refunded";

                    return isFacilityMatch && isDateMatch && isNotRejected;
                });

                const allTimeSlots = [
                    { slot: "8:00 AM - 10:00 AM", category: "morning" },
                    { slot: "10:00 AM - 12:00 PM", category: "morning" },
                    { slot: "12:00 PM - 2:00 PM", category: "afternoon" },
                    { slot: "2:00 PM - 4:00 PM", category: "afternoon" },
                    { slot: "4:00 PM - 6:00 PM", category: "afternoon" },
                    { slot: "6:00 PM - 8:00 PM", category: "evening" },
                    { slot: "8:00 PM - 10:00 PM", category: "evening" }
                ];

                const filteredTimeSlots = allTimeSlots.filter(item => {
                    if (preferredTimeFilter === "any time" || preferredTimeFilter === "anytime" || !preferredTimeFilter) {
                        return true;
                    }
                    return item.category === preferredTimeFilter;
                });

                if (slotsContainer) {
                    slotsContainer.innerHTML = "";

                    if (currentFacStatus !== "available") {
                        const statusBanner = document.createElement("div");
                        const statusTitle = currentFacStatus === "maintenance" ? "Under Maintenance" : "Unavailable / Occupied Event";
                        statusBanner.style.cssText = "background: #fee2e2; border: 1px solid #f87171; color: #991b1b; padding: 12px 16px; border-radius: 8px; font-weight: 600; font-size: 13px; text-align: center; margin-bottom: 12px;";
                        statusBanner.innerHTML = `⚠️ This court is currently <strong>${statusTitle}</strong>. Booking is disabled.`;
                        slotsContainer.appendChild(statusBanner);
                    }

                    if (filteredTimeSlots.length === 0) {
                        slotsContainer.innerHTML += `<div style="text-align: center; padding: 20px; color: #64748b;">No time slots available for the selected category.</div>`;
                        return;
                    }

                    filteredTimeSlots.forEach(item => {
                        const slot = item.slot;
                        // Reserved when any booking (start + duration) touches this 2-hour block
                        const slotStart = window.msHourOf(slot);
                        const matchedBooking = slotStart === null ? null : relevantBookings.find(b => {
                            const r = window.msBookingRange(b);
                            return r && r.start < slotStart + 2 && r.end > slotStart;
                        });

                        const slotRow = document.createElement("div");
                        slotRow.style.cssText = "display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-radius: 8px; border: 1px solid #e2e8f0; background: #f8fafc; margin-bottom: 8px;";

                        if (currentFacStatus !== "available") {
                            const statusText = currentFacStatus === "maintenance" ? "Maintenance" : "Unavailable";
                            slotRow.style.opacity = "0.6";
                            slotRow.innerHTML = `
                                <div>
                                    <strong style="color: #0f172a; font-size: 0.95rem;">${slot}</strong>
                                    <div style="font-size: 12px; color: #dc2626; font-weight: 600; margin-top: 2px;">${statusText}</div>
                                </div>
                                <button disabled style="background: #94a3b8; color: white; border: none; padding: 6px 14px; border-radius: 6px; cursor: not-allowed; font-weight: 600; font-size: 13px;">${statusText}</button>
                            `;
                        } else if (matchedBooking) {
                            slotRow.style.background = "#f1f5f9";
                            slotRow.style.borderColor = "#cbd5e1";
                            slotRow.innerHTML = `
                                <div>
                                    <strong style="color: #0f172a; font-size: 0.95rem;">${slot}</strong>
                                    <div style="font-size: 12px; color: #475569; font-weight: 600; margin-top: 2px;">Reserved Slot (Not Available)</div>
                                </div>
                                <span style="background: #334155; color: white; padding: 4px 10px; border-radius: 4px; font-size: 12px; font-weight: 600;">Occupied</span>
                            `;
                        } else {
                            slotRow.innerHTML = `
                                <div>
                                    <strong style="color: #0f172a; font-size: 0.95rem;">${slot}</strong>
                                    <div style="font-size: 12px; color: #0f172a; font-weight: 600; margin-top: 2px;">Available for Reservation</div>
                                </div>
                                <button onclick="selectSlotAndBook('${selectedSport}', '${selectedDate}', '${slot}')" style="background: #0f172a; color: white; border: none; padding: 6px 14px; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 13px;">Book Slot →</button>
                            `;
                        }

                        slotsContainer.appendChild(slotRow);
                    });
                }

            } catch (err) {
                console.error("Error fetching live schedule:", err);
                if (slotsContainer) {
                    slotsContainer.innerHTML = `<div style="text-align: center; padding: 20px; color: #475569;">Failed to load schedule. Ensure node server.js is running.</div>`;
                }
            }
        });
    }
});

async function renderAdminDashboard(filter = "all") {
    const adminTableBody = document.getElementById("adminTableBody");
    if (!adminTableBody) return;

    try {
        const res = await fetch(`${API_BASE}/bookings`, { headers: window.adminHeaders() });
        const bookings = await res.json();
        if (!Array.isArray(bookings)) return;

        const statTotal = document.getElementById("statTotal");
        const statPending = document.getElementById("statPending");
        const statApproved = document.getElementById("statApproved");
        const statRejected = document.getElementById("statRejected");

        if (statTotal) statTotal.textContent = bookings.length;
        if (statPending) statPending.textContent = bookings.filter(b => (b.booking_status || "Pending") === "Pending").length;
        if (statApproved) statApproved.textContent = bookings.filter(b => b.booking_status === "Approved").length;
        if (statRejected) statRejected.textContent = bookings.filter(b => b.booking_status === "Rejected" || b.booking_status === "Cancelled" || b.booking_status === "Refunded").length;

        const refundNeededBookings = bookings.filter(b => (b.booking_status === "Rejected" || b.booking_status === "Cancelled") && parseFloat(b.amount || 0) > 0);
        const refundNeededCount = refundNeededBookings.length;

        let headerActions = document.querySelector(".admin-header-actions, header, .admin-top-bar") || document.querySelector(".admin-dashboard-container");
        let bellContainer = document.getElementById("adminNotificationBellContainer");

        if (!bellContainer && headerActions) {
            bellContainer = document.createElement("div");
            bellContainer.id = "adminNotificationBellContainer";
            bellContainer.style.cssText = "position: relative; display: inline-block; margin-left: auto; margin-right: 20px; cursor: pointer;";
            
            headerActions.style.display = "flex";
            headerActions.style.alignItems = "center";
            headerActions.appendChild(bellContainer);
        }

        if (bellContainer) {
            bellContainer.innerHTML = `
                <div id="bellIconBtn" style="position: relative; font-size: 16px; background: #f1f5f9; padding: 8px 12px; border-radius: 6px; display: flex; align-items: center; justify-content: center; border: 1px solid #cbd5e1; color: #334155; font-weight: 600;">
                    Notifications
                    ${refundNeededCount > 0 ? `<span style="margin-left: 6px; background: #334155; color: white; font-size: 10px; font-weight: bold; padding: 2px 6px; border-radius: 4px;">${refundNeededCount}</span>` : ""}
                </div>
                <div id="notificationDropdown" style="display: none; position: absolute; right: 0; top: 45px; width: 320px; background: white; border: 1px solid #cbd5e1; border-radius: 8px; box-shadow: 0 10px 25px rgba(0,0,0,0.08); z-index: 1000; padding: 15px;">
                    <div style="font-weight: bold; font-size: 14px; margin-bottom: 10px; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; color: #0f172a; display: flex; justify-content: space-between; align-items: center;">
                        <span>Activity Alerts</span>
                        <span style="font-size: 11px; background: #f1f5f9; color: #334155; padding: 2px 6px; border-radius: 4px; border: 1px solid #cbd5e1;">${refundNeededCount} Refunds</span>
                    </div>
                    <div style="max-height: 250px; overflow-y: auto;">
                        ${refundNeededCount === 0 ? `<div style="font-size: 13px; color: #64748b; text-align: center; padding: 15px;">No pending alerts.</div>` : 
                          refundNeededBookings.map(b => `
                            <div style="padding: 8px 0; border-bottom: 1px solid #f8fafc; font-size: 12px;">
                                <strong>${b.reference_no}</strong> — ${b.fullname}<br>
                                <span style="color: #475569; font-weight: 600;">Needs Refund: ₱${parseFloat(b.amount).toLocaleString()}.00</span>
                            </div>
                          `).join("")}
                    </div>
                </div>
            `;

            const bellBtn = document.getElementById("bellIconBtn");
            const dropdown = document.getElementById("notificationDropdown");

            bellBtn.onclick = function(e) {
                e.stopPropagation();
                dropdown.style.display = dropdown.style.display === "block" ? "none" : "block";
            };

            window.onclick = function() {
                if (dropdown) dropdown.style.display = "none";
            };
        }

        let filteredBookings = bookings;
        if (filter !== "all") {
            filteredBookings = bookings.filter(b => (b.booking_status || "Pending").toLowerCase() === filter.toLowerCase());
        }

        if (filteredBookings.length === 0) {
            adminTableBody.innerHTML = `
                <tr>
                    <td colspan="6" style="text-align: center; padding: 30px; color: #64748b;">
                        No reservation records found.
                    </td>
                </tr>
            `;
            return;
        }

        window._adminAllBookings = bookings;

        const formatDateOnly = (dateStr) => {
            if (!dateStr) return "";
            return String(dateStr).split("T")[0];
        };

        adminTableBody.innerHTML = filteredBookings.map((b) => {
            const currentStatus = b.booking_status || "Pending";
            let badgeClass = "badge-warning";
            if (currentStatus === "Approved") badgeClass = "badge-success";
            if (currentStatus === "Rejected" || currentStatus === "Cancelled") badgeClass = "badge-danger";
            if (currentStatus === "Refunded") badgeClass = "badge-success";

            let actionIndicators = "";
            if ((currentStatus === "Rejected" || currentStatus === "Cancelled") && parseFloat(b.amount || 0) > 0) {
                actionIndicators = `
                    <div style="margin-top: 6px;">
                        <span style="display: inline-block; background: #f8fafc; color: #334155; font-size: 11px; padding: 3px 8px; border-radius: 4px; font-weight: 600; border: 1px solid #cbd5e1;">Needs Refund (₱${parseFloat(b.amount).toLocaleString()}.00)</span>
                        <br><button onclick="updateBookingStatusInDB(${b.id}, 'Refunded')" style="margin-top: 5px; background: #334155; color: white; border: none; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-weight: 600; font-size: 11px;">Process Refund</button>
                    </div>
                `;
            } else if (currentStatus === "Refunded") {
                actionIndicators = `<div style="margin-top: 6px;"><span style="display: inline-block; background: #f1f5f9; color: #0f172a; font-size: 11px; padding: 3px 8px; border-radius: 4px; font-weight: 600; border: 1px solid #cbd5e1;">Refund Completed</span></div>`;
            }

            return `
                <tr>
                    <td style="width: 150px; white-space: nowrap;"><a href="#" onclick="openAdminDetailsModal(${b.id}); return false;" style="color: #0f172a; text-decoration: underline; font-weight: 600;">${b.reference_no}</a></td>
                    <td>
                        <strong style="color: #0f172a;">${b.fullname}</strong><br>
                        <span style="font-size: 12px; color: #64748b;">${b.email}</span>
                    </td>
                    <td>
                        <span style="color: #0f172a; font-weight: 500;">${b.facility}</span><br>
                        <span style="color: #334155; font-weight: 600; font-size: 12px;">Paid: ₱${parseFloat(b.amount).toLocaleString()}.00</span>
                    </td>
                    <td>
                        <span style="color: #0f172a; white-space: nowrap;">${formatDateOnly(b.booking_date)}</span><br>
                        <span style="font-size: 12px; color: #64748b; white-space: nowrap;">${b.time_slot}</span>
                    </td>
                    <td>
                        <span class="badge ${badgeClass}" style="padding: 4px 10px; border-radius: 4px; font-weight: 600; font-size: 12px; display: inline-block; background: #f1f5f9; color: #0f172a; border: 1px solid #cbd5e1;">${currentStatus}</span>
                        ${actionIndicators}
                    </td>
                    <td>
                        <div style="display: inline-flex; align-items: center; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 6px; padding: 2px; gap: 4px; white-space: nowrap;">
                            <button onclick="openAdminDetailsModal(${b.id})" style="background: #f8fafc; color: #0f172a; border: 1px solid #cbd5e1; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-weight: 600; font-size: 12px;">View</button>
                            
                            ${currentStatus === "Pending" ? `
                                <button onclick="updateBookingStatusInDB(${b.id}, 'Approved')" style="background: #0f172a; color: white; border: none; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-weight: 600; font-size: 12px;">Approve</button>
                                <button onclick="updateBookingStatusInDB(${b.id}, 'Rejected')" style="background: #475569; color: white; border: none; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-weight: 600; font-size: 12px;">Reject</button>
                            ` : `
                                <span style="font-size: 12px; color: #64748b; font-weight: 500; padding: 0 8px;">Resolved</span>
                            `}
                            
                            <button onclick="deleteBookingFromDB(${b.id}, '${b.reference_no}')" title="Delete" style="background: #ffffff; color: #475569; border: 1px solid #cbd5e1; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-weight: 600; font-size: 12px;">Remove</button>
                        </div>
                    </td>
                </tr>
            `;
        }).join("");
    } catch (err) {
        console.error("Dashboard Fetch Error:", err);
    }
}

window.openAdminDetailsModal = function(bookingId) {
    const bookings = window._adminAllBookings || [];
    const b = bookings.find(item => item.id === bookingId);
    if (!b) return;

    let existingModal = document.getElementById("adminDetailsModalPopup");
    if (existingModal) existingModal.remove();

    const modalHTML = `
        <div id="adminDetailsModalPopup" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(15,23,42,0.5); display: flex; align-items: center; justify-content: center; z-index: 9999;">
            <div style="background: white; width: 480px; max-width: 90%; border-radius: 8px; border: 1px solid #cbd5e1; box-shadow: 0 10px 25px rgba(0,0,0,0.1); padding: 24px; font-family: inherit;">
                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #e2e8f0; padding-bottom: 12px; margin-bottom: 16px;">
                    <h3 style="margin: 0; font-size: 16px; color: #0f172a; font-weight: 700;">Reservation Details</h3>
                    <button onclick="document.getElementById('adminDetailsModalPopup').remove()" style="background: none; border: none; font-size: 16px; cursor: pointer; color: #64748b; font-weight: bold;">✕</button>
                </div>
                <div style="font-size: 13px; color: #334155; display: flex; flex-direction: column; gap: 8px;">
                    <div><strong>Reference No:</strong> <span style="color: #0f172a; font-weight: 600;">${b.reference_no}</span></div>
                    <div><strong>Payment Ref:</strong> <span style="background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-weight: 600; color: #0f172a; border: 1px solid #cbd5e1;">${b.payment_ref || 'N/A'}</span></div>
                    <div><strong>Full Name:</strong> ${b.fullname}</div>
                    <div><strong>Email Address:</strong> ${b.email}</div>
                    <div><strong>Contact Number:</strong> ${b.phone || 'N/A'}</div>
                    <div><strong>Address:</strong> ${b.address || 'N/A'}</div>
                    <div><strong>Purpose:</strong> ${b.purpose || 'N/A'}</div>
                    <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 4px 0;">
                    <div><strong>Facility:</strong> ${b.facility}</div>
                    <div><strong>Schedule:</strong> ${String(b.booking_date || "").split("T")[0]} (${b.time_slot})</div>
                    <div><strong>Amount Paid:</strong> ₱${parseFloat(b.amount || 0).toLocaleString()}.00</div>
                    <div><strong>Status:</strong> <span style="font-weight: 600; color: #0f172a;">${b.booking_status || 'Pending'}</span></div>
                </div>
                <div style="margin-top: 20px; text-align: right;">
                    <button onclick="document.getElementById('adminDetailsModalPopup').remove()" style="background: #0f172a; color: white; border: none; padding: 6px 16px; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 13px;">Close</button>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
};

window.updateBookingStatusInDB = async function(id, newStatus) {
    try {
        const res = await fetch(`${API_BASE}/bookings/${id}`, {
            method: 'PUT',
            headers: window.adminHeaders(),
            body: JSON.stringify({ booking_status: newStatus })
        });
        const data = await res.json();
        if (data.success) {
            alert(`Booking status updated to ${newStatus}!`);
            renderAdminDashboard("all");
        }
    } catch (err) {
        console.error("Error updating status:", err);
    }
};

window.deleteBookingFromDB = async function(id, refNo) {
    const confirmDelete = confirm(`Are you sure you want to remove booking record [${refNo}]?`);
    if (!confirmDelete) return;

    try {
        const res = await fetch(`${API_BASE}/bookings/${id}`, {
            method: 'DELETE',
            headers: window.adminHeaders()
        });
        const data = await res.json();
        
        if (data.success) {
            alert(`Booking ${refNo} has been removed successfully!`);
            renderAdminDashboard("all");
        } else {
            alert(data.message || "Failed to remove booking.");
        }
    } catch (err) {
        console.error("Error soft deleting booking:", err);
        alert("Cannot connect to server.");
    }
};

/* =========================================================
   DYNAMIC HERO SLIDER & LEGIT "NEXT AVAILABLE" ENGINE
========================================================= */

const heroFacilities = ["basketball", "volleyball", "tennis", "badminton"];
let currentSlideIndex = 0;
let sliderInterval = null;

window.switchHeroSlide = async function(sportKey, btnEl) {
    const targetIndex = heroFacilities.indexOf(sportKey);
    if (targetIndex === -1) return;
    currentSlideIndex = targetIndex;

    document.querySelectorAll(".slide-img").forEach(img => img.classList.remove("active"));
    const targetImg = document.getElementById(`slide-${sportKey}`);
    if (targetImg) targetImg.classList.add("active");

    const dots = document.querySelectorAll(".dot-btn");
    dots.forEach((dot, idx) => {
        if (idx === currentSlideIndex) {
            dot.classList.add("active");
        } else {
            dot.classList.remove("active");
        }
    });

    document.querySelectorAll(".sport-icon-btn").forEach(btn => btn.classList.remove("active"));
    const icons = document.querySelectorAll(".sport-icon-btn");
    if (icons[currentSlideIndex]) icons[currentSlideIndex].classList.add("active");

    const labelEl = document.getElementById("floatingFacilityName");
    if (labelEl) {
        labelEl.textContent = sportKey.charAt(0).toUpperCase() + sportKey.slice(1) + " Court";
    }

    const floatingCard = document.querySelector(".hero-floating-card, [class*='floating-card'], [class*='next-available']");
    if (floatingCard) {
        const subTextEl = floatingCard.querySelector("span:last-child, p, .next-avail-time");
        if (subTextEl) {
            subTextEl.textContent = "Checking schedule...";
        }

        try {
            const res = await fetch(`${API_BASE}/bookings/busy`);
            const allBookings = await res.json();

            const todayStr = new Date().toLocaleDateString('en-CA');
            const timeSlots = [
                "8:00 AM", "10:00 AM", "12:00 PM",
                "2:00 PM", "4:00 PM", "6:00 PM", "8:00 PM"
            ];

            const facBookingsToday = allBookings.filter(b => {
                const fac = (b.facility || "").toLowerCase();
                const d = String(b.booking_date || "").split("T")[0];
                const st = String(b.booking_status || "Pending").toLowerCase();
                return fac.includes(sportKey) && d === todayStr && !window.msIsFree(st);
            });

            const nowHour = new Date().getHours() + new Date().getMinutes() / 60;

            let foundSlot = null;
            for (let slot of timeSlots) {
                const slotHour = window.msHourOf(slot);
                const isBooked = nowHour >= slotHour || window.msOverlaps(facBookingsToday, slotHour, 1);
                if (!isBooked) {
                    foundSlot = slot;
                    break;
                }
            }

            if (subTextEl) {
                if (foundSlot) {
                    subTextEl.textContent = `Today · ${foundSlot}`;
                } else {
                    subTextEl.textContent = "Tomorrow · 8:00 AM";
                }
            }
        } catch (err) {
            console.error("Error fetching live hero availability:", err);
            if (subTextEl) subTextEl.textContent = "Available Today";
        }
    }
};

function startAutoSlider() {
    if (sliderInterval) clearInterval(sliderInterval);

    sliderInterval = setInterval(() => {
        currentSlideIndex = (currentSlideIndex + 1) % heroFacilities.length;
        window.switchHeroSlide(heroFacilities[currentSlideIndex]);
    }, 4000);
}

document.addEventListener("DOMContentLoaded", () => {
    if (document.querySelector(".hero") || document.getElementById("heroSlider")) {
        startAutoSlider();
    }

    const dots = document.querySelectorAll(".dot-btn");
    dots.forEach((dot, index) => {
        dot.addEventListener("click", () => {
            window.switchHeroSlide(heroFacilities[index]);
            startAutoSlider();
        });
    });
});

window.closeScheduleModal = function() {
    const modal = document.getElementById("scheduleModal");
    if (modal) modal.style.display = "none";
};

window.selectSlotAndBook = function(sport, date, timeSlot) {
    const cleanSport = String(sport || "").toLowerCase().trim();

    const facilityData = {
        basketball: { name: "Basketball Court", icon: "🏀", rate: 500 },
        volleyball: { name: "Volleyball Court", icon: "🏐", rate: 500 },
        tennis: { name: "Tennis Court", icon: "🎾", rate: 500 },
        badminton: { name: "Badminton Court", icon: "🏸", rate: 300 }
    };

    let matchedKey = "basketball";
    if (cleanSport.includes("volleyball")) matchedKey = "volleyball";
    else if (cleanSport.includes("tennis")) matchedKey = "tennis";
    else if (cleanSport.includes("badminton")) matchedKey = "badminton";
    else if (cleanSport.includes("basketball")) matchedKey = "basketball";

    const fac = facilityData[matchedKey];

    localStorage.setItem("multisportFromSearchModal", "true");
    localStorage.setItem("multisportSelectedFacility", fac.name);
    localStorage.setItem("multisportSelectedIcon", fac.icon);
    localStorage.setItem("multisportFacilityRate", fac.rate);
    localStorage.setItem("multisportSelectedDate", date);
    localStorage.setItem("multisportRawDate", date);
    localStorage.setItem("multisportSelectedTime", timeSlot);

    window.location.href = "booking.html";
};


/* =========================================================
   BOOKING SUCCESS WINDOW ("Thank you" after payment)
========================================================= */
window.showBookingSuccess = function (info) {
    const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    function niceDate(value) {
        const p = String(value || "").split("T")[0].split("-");
        if (p.length !== 3) return String(value || "");
        return MONTHS[parseInt(p[1], 10) - 1] + " " + parseInt(p[2], 10) + ", " + p[0];
    }
    function make(tag, cls, text) {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text != null) n.textContent = text;
        return n;
    }

    const hours = Math.max(1, parseInt(info.hours, 10) || 1);
    const amount = Number(info.amount || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const overlay = make("div", "ok-overlay");
    const box = make("div", "ok-dialog");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-labelledby", "okTitle");

    const mark = make("div", "ok-mark", "✓");
    mark.setAttribute("aria-hidden", "true");
    const title = make("h3", "ok-title", "Thank you for your reservation!");
    title.id = "okTitle";
    const lead = make("p", "ok-lead", "We have received your payment. Our team will now verify it and confirm your schedule.");

    const refBox = make("div", "ok-ref");
    refBox.appendChild(make("span", "ok-ref-label", "Your reference code"));
    refBox.appendChild(make("strong", "ok-ref-code", info.reference));

    const list = make("dl", "ok-list");
    [
        ["Facility", info.facility],
        ["Date", niceDate(info.date)],
        ["Time", info.time + " · " + hours + (hours === 1 ? " hour" : " hours")],
        ["Amount paid", "₱" + amount]
    ].forEach(function (r) {
        list.appendChild(make("dt", null, r[0]));
        list.appendChild(make("dd", null, r[1]));
    });

    const note = make("p", "ok-note", "Please keep your reference code. You can follow the status of your reservation anytime on the Track Booking page.");

    const actions = make("div", "ok-actions");
    const copyBtn = make("button", "ok-btn", "Copy code");
    copyBtn.type = "button";
    const trackBtn = make("button", "ok-btn ok-primary", "Track my reservation");
    trackBtn.type = "button";
    actions.appendChild(copyBtn);
    actions.appendChild(trackBtn);

    [mark, title, lead, refBox, list, note, actions].forEach(function (n) { box.appendChild(n); });
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    function goTrack() { window.location.href = "track-booking.html"; }
    trackBtn.addEventListener("click", goTrack);
    copyBtn.addEventListener("click", function () {
        function done() {
            copyBtn.textContent = "Copied ✓";
            setTimeout(function () { copyBtn.textContent = "Copy code"; }, 1800);
        }
        function fallback() {
            const t = document.createElement("textarea");
            t.value = info.reference;
            t.style.position = "fixed";
            t.style.opacity = "0";
            document.body.appendChild(t);
            t.select();
            let ok = false;
            try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
            t.remove();
            if (ok) done();
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(info.reference).then(done, fallback);
        } else {
            fallback();
        }
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") goTrack(); });
    trackBtn.focus();
};

/* =========================================================
   IMAGE LIGHTBOX PREVIEW FUNCTIONS (ADDED)
========================================================= */
window.openImageModal = function(imageSrc, imageTitle) {
    const modal = document.getElementById('imageLightboxModal');
    const lightboxImg = document.getElementById('lightboxImage');
    const lightboxTitle = document.getElementById('lightboxTitle');

    if (modal && lightboxImg) {
        lightboxImg.src = imageSrc;
        if (lightboxTitle) lightboxTitle.textContent = imageTitle;
        modal.style.display = 'flex';
    }
};

window.closeImageModal = function() {
    const modal = document.getElementById('imageLightboxModal');
    if (modal) {
        modal.style.display = 'none';
    }
};

/* =========================================================
   ACCOUNT MENU + SETTINGS (auto-rendered in the nav when logged in)
   - the menu is styled by nav-account.css
   - Settings edits name, contact number and address.
     The email is shown but locked, and the current password is
     required to save (the server checks it).
========================================================= */
(function () {
    function esc(v) {
        return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
        });
    }
    function readUser() {
        try { return JSON.parse(localStorage.getItem("multisportLoggedInUser")); } catch (e) { return null; }
    }
    function fullNameOf(user) {
        return (user.firstName ? (user.firstName + " " + (user.lastName || "")).trim() : (user.email ? user.email.split("@")[0] : "Member"));
    }
    function initialsOf(name) {
        return name.split(" ").filter(Boolean).map(function (n) { return n[0]; }).join("").substring(0, 2).toUpperCase() || "M";
    }

    var ICON_CHEVRON = '<svg class="acct-chevron" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="square"><path d="M6 9l6 6 6-6"/></svg>';
    var ICON_USER = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg>';
    var ICON_GEAR = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1"/></svg>';
    var ICON_LOCK = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square"><rect x="5" y="11" width="14" height="10"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';

    function renderAccountMenu() {
        var host = document.getElementById("userNavAction") || document.querySelector(".nav-actions");
        var user = readUser();
        if (!host || document.querySelector(".admin-body") || !user) return;

        var name = fullNameOf(user);
        var email = user.email || "";

        host.innerHTML =
            '<div class="acct" id="profileDropdownContainer">' +
                '<button type="button" class="acct-trigger" id="acctTrigger" aria-haspopup="true" aria-expanded="false" onclick="toggleProfileMenu(event)">' +
                    '<span class="acct-badge" data-acct="initials">' + esc(initialsOf(name)) + '</span>' +
                    '<span class="acct-name" data-acct="name">' + esc(name) + '</span>' +
                    ICON_CHEVRON +
                '</button>' +
                '<div class="acct-menu" id="profileDropdownMenu" role="menu" style="display:none">' +
                    '<div class="acct-head">' +
                        '<span class="acct-kicker">Signed in as</span>' +
                        '<strong data-acct="name">' + esc(name) + '</strong>' +
                        '<span class="acct-mail">' + esc(email) + '</span>' +
                    '</div>' +
                    '<div class="acct-list">' +
                        '<a href="profile.html" class="acct-item" role="menuitem"><span class="acct-ico">' + ICON_USER + '</span>My profile &amp; bookings</a>' +
                        '<button type="button" class="acct-item" role="menuitem" onclick="openAccountSettings()"><span class="acct-ico">' + ICON_GEAR + '</span>Settings</button>' +
                    '</div>' +
                    '<div class="acct-foot"><button type="button" class="acct-logout" onclick="logoutUser()">Log out</button></div>' +
                '</div>' +
            '</div>';
    }

    function refreshAccountText(user) {
        var name = fullNameOf(user);
        document.querySelectorAll('[data-acct="name"]').forEach(function (el) { el.textContent = name; });
        document.querySelectorAll('[data-acct="initials"]').forEach(function (el) { el.textContent = initialsOf(name); });
        var head = document.getElementById("profileHeaderName");
        if (head) head.textContent = name;
    }

    /* ---------- Settings modal ---------- */
    function buildSettingsModal() {
        if (document.getElementById("acctSettingsModal")) return;
        var wrap = document.createElement("div");
        wrap.className = "acct-modal";
        wrap.id = "acctSettingsModal";
        wrap.setAttribute("role", "dialog");
        wrap.setAttribute("aria-modal", "true");
        wrap.setAttribute("aria-labelledby", "acctSettingsTitle");
        wrap.style.display = "none";
        wrap.innerHTML =
            '<div class="acct-panel">' +
                '<button type="button" class="acct-close" id="acctSettingsClose" aria-label="Close settings">&times;</button>' +
                '<span class="acct-eyebrow">Account</span>' +
                '<h2 id="acctSettingsTitle">Settings</h2>' +
                '<p class="acct-sub">Update your name, contact number and address.</p>' +
                '<form id="acctSettingsForm" novalidate>' +
                    '<div class="acct-row">' +
                        '<label class="acct-field"><span>First name</span><input type="text" id="acctFirst" maxlength="60" autocomplete="given-name"></label>' +
                        '<label class="acct-field"><span>Last name</span><input type="text" id="acctLast" maxlength="60" autocomplete="family-name"></label>' +
                    '</div>' +
                    '<label class="acct-field acct-locked"><span>Email address</span>' +
                        '<div class="acct-lockwrap"><input type="email" id="acctEmail" readonly tabindex="-1">' + ICON_LOCK + '</div>' +
                        '<small>Your email is your account ID, so it cannot be changed.</small></label>' +
                    '<label class="acct-field"><span>Contact number</span><input type="tel" id="acctPhone" maxlength="20" autocomplete="tel"></label>' +
                    '<label class="acct-field"><span>Address</span><input type="text" id="acctAddress" maxlength="255" autocomplete="street-address"></label>' +
                    '<label class="acct-field"><span>Current password</span><input type="password" id="acctPassword" autocomplete="current-password" placeholder="Needed to save changes"></label>' +
                    '<p class="acct-msg" id="acctMsg" role="status" aria-live="polite"></p>' +
                    '<div class="acct-actions">' +
                        '<button type="button" class="acct-btn acct-btn-ghost" id="acctCancel">Cancel</button>' +
                        '<button type="submit" class="acct-btn acct-btn-main" id="acctSave">Save changes</button>' +
                    '</div>' +
                '</form>' +
            '</div>';
        document.body.appendChild(wrap);

        function close() { window.closeAccountSettings(); }
        wrap.addEventListener("click", function (e) { if (e.target === wrap) close(); });
        document.getElementById("acctSettingsClose").addEventListener("click", close);
        document.getElementById("acctCancel").addEventListener("click", close);
        document.addEventListener("keydown", function (e) {
            if (e.key === "Escape" && wrap.style.display !== "none") close();
        });

        document.getElementById("acctSettingsForm").addEventListener("submit", async function (e) {
            e.preventDefault();
            var user = readUser();
            var msg = document.getElementById("acctMsg");
            var save = document.getElementById("acctSave");
            if (!user) return;

            var first = document.getElementById("acctFirst").value.trim();
            var last = document.getElementById("acctLast").value.trim();
            var phone = document.getElementById("acctPhone").value.trim();
            var address = document.getElementById("acctAddress").value.trim();
            var password = document.getElementById("acctPassword").value;

            function fail(text) { msg.textContent = text; msg.className = "acct-msg is-error"; }

            if (!first) return fail("Please enter your first name.");
            if (phone && !validatePhoneInput(phone)) return fail("Please enter a valid mobile number (example: 09123456789).");
            if (!password) return fail("Please enter your current password to save changes.");

            save.disabled = true;
            save.textContent = "Saving...";
            msg.textContent = "";
            msg.className = "acct-msg";

            try {
                var res = await fetch(API_BASE + "/users/update", {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ email: user.email, password: password, firstName: first, lastName: last, phone: phone, address: address })
                });
                var data = await res.json();

                if (data && data.success) {
                    var updated = Object.assign({}, user, {
                        firstName: data.user.firstName,
                        lastName: data.user.lastName,
                        phone: data.user.phone,
                        address: data.user.address
                    });
                    localStorage.setItem("multisportLoggedInUser", JSON.stringify(updated));
                    refreshAccountText(updated);
                    msg.textContent = "Saved. Your details were updated.";
                    msg.className = "acct-msg is-ok";
                    document.getElementById("acctPassword").value = "";
                    setTimeout(function () { window.closeAccountSettings(); }, 900);
                } else {
                    fail((data && data.message) || "Could not save your details.");
                }
            } catch (err) {
                fail("Cannot reach the server. Please make sure node server.js is running.");
            } finally {
                save.disabled = false;
                save.textContent = "Save changes";
            }
        });
    }

    window.openAccountSettings = function () {
        var user = readUser();
        if (!user) return;
        buildSettingsModal();
        var menuEl = document.getElementById("profileDropdownMenu");
        if (menuEl) menuEl.style.display = "none";
        var na = function (v) { return (!v || v === "N/A") ? "" : v; };
        document.getElementById("acctFirst").value = user.firstName || "";
        document.getElementById("acctLast").value = user.lastName || "";
        document.getElementById("acctEmail").value = user.email || "";
        document.getElementById("acctPhone").value = na(user.phone);
        document.getElementById("acctAddress").value = na(user.address);
        document.getElementById("acctPassword").value = "";
        var msg = document.getElementById("acctMsg");
        msg.textContent = "";
        msg.className = "acct-msg";
        document.getElementById("acctSettingsModal").style.display = "flex";
        document.body.classList.add("acct-modal-open");
        document.getElementById("acctFirst").focus();
    };

    window.closeAccountSettings = function () {
        var m = document.getElementById("acctSettingsModal");
        if (m) m.style.display = "none";
        document.body.classList.remove("acct-modal-open");
    };

    window.toggleProfileMenu = function (e) {
        if (e) e.stopPropagation();
        var menu = document.getElementById("profileDropdownMenu");
        var trigger = document.getElementById("acctTrigger");
        if (!menu) return;
        var open = menu.style.display !== "block";
        menu.style.display = open ? "block" : "none";
        if (trigger) trigger.setAttribute("aria-expanded", open ? "true" : "false");
    };

    window.addEventListener("click", function (e) {
        var menu = document.getElementById("profileDropdownMenu");
        if (menu && !(e.target.closest && e.target.closest("#profileDropdownMenu"))) {
            menu.style.display = "none";
            var trigger = document.getElementById("acctTrigger");
            if (trigger) trigger.setAttribute("aria-expanded", "false");
        }
    });

    document.addEventListener("DOMContentLoaded", renderAccountMenu);
})();

/* =========================================================
   SCROLL HEADER CLASS TOGGLE (PRESERVES EXISTING CSS DESIGN)
========================================================= */
window.addEventListener("scroll", function () {
    const header = document.querySelector(".site-header");
    if (header) {
        if (window.scrollY > 20) {
            header.classList.add("scrolled");
        } else {
            header.classList.remove("scrolled");
        }
    }
});