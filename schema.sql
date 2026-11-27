-- =====================================================================
--  MultiSport  -  database setup  (MySQL / MariaDB, works with XAMPP)
--  MetroGate Silang Estates sports-facility reservation system
--
--  How to use (phpMyAdmin):  Import  ->  choose this file  ->  Go.
--  It is SAFE to run more than once: every table uses IF NOT EXISTS,
--  so an existing database and its data are never changed or erased.
--
--  After importing, create the admin login with:   node create-admin.js
-- =====================================================================

CREATE DATABASE IF NOT EXISTS multisport_db
    CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE multisport_db;

-- ---------------------------------------------------------------------
-- users: customers and the admin (role = 'admin'). Passwords are bcrypt hashes, never plain text.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id          INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    email       VARCHAR(255) NOT NULL,
    password    VARCHAR(255) NOT NULL,
    firstName   VARCHAR(100) NOT NULL DEFAULT '',
    lastName    VARCHAR(100) NOT NULL DEFAULT '',
    phone       VARCHAR(30)  NULL,
    address     VARCHAR(255) NULL,
    role        VARCHAR(20)  NOT NULL DEFAULT 'customer',   -- 'customer' or 'admin'
    disabled    TINYINT(1)   NOT NULL DEFAULT 0,                        -- 1 = admin switched the account off (cannot log in)
    privacy_consent_at DATETIME NULL,                           -- when the customer agreed to the Privacy Policy (RA 10173)
    created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- bookings: every reservation (guest or logged-in).
--   booking_status : Pending, Approved, Rejected, Cancelled, Cancel Requested, Refunded
--   is_deleted     : 1 = removed by the admin (kept for records, hidden everywhere)
--   cancelled_by   : 'customer' or 'admin'
--   reschedule_*   : a customer's request to move an Approved booking (waits for the admin)
--   payment_proof  : file name of the payment screenshot (the picture itself is saved in the uploads folder)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bookings (
    id               INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    reference_no     VARCHAR(100) NOT NULL,
    payment_ref      VARCHAR(100) NULL,
    fullname         VARCHAR(100) NOT NULL,
    email            VARCHAR(255) NOT NULL,
    phone            VARCHAR(30)  NOT NULL,
    address          VARCHAR(255) NULL,
    purpose          VARCHAR(255) NULL,
    organization     VARCHAR(150) NULL,
    facility         VARCHAR(100) NOT NULL,
    booking_date     DATE         NOT NULL,
    time_slot        VARCHAR(20)  NOT NULL,
    duration_hours   INT          NOT NULL DEFAULT 1,
    amount           DECIMAL(10,2) NOT NULL DEFAULT 0,
    payment_proof    VARCHAR(120) NULL,
    booking_status   VARCHAR(30)  NOT NULL DEFAULT 'Pending',
    is_deleted       TINYINT(1)   NOT NULL DEFAULT 0,
    cancelled_by     VARCHAR(20)  NULL,
    reschedule_date  DATE         NULL,
    reschedule_time  VARCHAR(20)  NULL,
    reschedule_count INT          NOT NULL DEFAULT 0,
    privacy_consent_at DATETIME   NULL,                      -- when the customer agreed to the Privacy Policy (RA 10173)
    created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_bookings_reference (reference_no),
    KEY idx_bookings_email (email),
    KEY idx_bookings_slot (facility, booking_date, booking_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- facility_status: whether each court is available / under maintenance / occupied.
-- (The server also creates this table by itself on start-up.)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS facility_status (
    facility_key VARCHAR(20) NOT NULL PRIMARY KEY,
    status       VARCHAR(20) NOT NULL DEFAULT 'available',
    updated_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO facility_status (facility_key, status) VALUES
    ('basketball', 'available'),
    ('volleyball', 'available'),
    ('tennis',     'available'),
    ('badminton',  'available');