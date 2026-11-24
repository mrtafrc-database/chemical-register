
-- =========================================
-- CHEMICAL REGISTER
-- Initial Seed Data
-- Cloudflare D1 / SQLite
-- =========================================

-- 1. SECTIONS
INSERT OR IGNORE INTO sections
(id, section_code, section_name)
VALUES
('sec_adm', 'ADM', 'Administration'),
('sec_coc', 'COC', 'Control Center'),
('sec_com', 'COM', 'Communication'),
('sec_dwe', 'DWE', 'DWE'),
('sec_ews', 'EWS', 'EWS'),
('sec_frc', 'FRC', 'FRC'),
('sec_ohl', 'OHL', 'Overhead Line'),
('sec_psd_pid', 'PSD-PID', 'PSD-PID'),
('sec_psy_grs', 'PSY-GRS', 'PSY-GRS'),
('sec_qst', 'QST', 'QST'),
('sec_rst', 'RST', 'Rolling Stock'),
('sec_sig', 'SIG', 'Signalling'),
('sec_str', 'STR', 'STR'),
('sec_trw_trd', 'TRW-TRD', 'TRW-TRD'),
('sec_mlr', 'MLR', 'MLR'),
('sec_apm', 'APM', 'APM');

-- 2. ROLES
INSERT OR IGNORE INTO roles
(id, role_code, role_name)
VALUES
('role_requestor', 'REQUESTOR', 'Requestor'),
('role_store', 'STORE', 'Store'),
('role_safety', 'SAFETY', 'Safety'),
('role_admin', 'ADMIN', 'Administrator');
