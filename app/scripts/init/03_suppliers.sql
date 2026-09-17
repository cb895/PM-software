-- =============================================================
-- SUPPLIER SEED DATA — MetabolicTrack Lab PM System
-- Generated from Supplier_Details upload
-- All credentials blanked — update via UI after new logins set up
-- =============================================================

-- Add supplier_type and onboarding_status columns if not present
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS supplier_type  VARCHAR(50);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS onboarding_status VARCHAR(50);

-- Insert all suppliers
INSERT INTO suppliers (name, code, website, supplier_type, notes, onboarding_status, is_active) VALUES
    ('Abbexa', 'ABX', 'https://www.abbexa.com/', 'Manufacturer', NULL, 'Ready for Approval', TRUE),
    ('Ahlstrom', 'AHL', NULL, 'Manufacturer', 'Supplier quality survey in progress', 'Email/inquiry sent', TRUE),
    ('Arista Biologicals', 'ARB', 'https://www.fortislife.com/', 'Manufacturer', NULL, 'Email/inquiry sent', TRUE),
    ('Avantor', 'AVA', NULL, 'Manufacturer', 'Supplier quality survey needed', 'Ready for Approval', TRUE),
    ('Bangs', 'BNG', NULL, 'Manufacturer', 'Standard certification done; quality survey in progress', 'Email/inquiry sent', TRUE),
    ('BiosPacific', 'BSP', NULL, 'Manufacturer', NULL, 'Verified', TRUE),
    ('BioSynth', 'BSY', NULL, 'Manufacturer', NULL, 'To do', TRUE),
    ('BioTechne', 'BTH', NULL, 'Manufacturer', NULL, 'Email/inquiry sent', TRUE),
    ('Corning', 'CRN', NULL, 'Manufacturer', NULL, 'Verified', TRUE),
    ('Dialunox', 'DLX', NULL, 'Manufacturer', NULL, 'To do', TRUE),
    ('Drummond', 'DMD', NULL, 'Manufacturer', NULL, 'Verified', TRUE),
    ('Eli Tech', 'ELT', NULL, 'Manufacturer', NULL, 'To do', TRUE),
    ('Fisher Scientific', 'FIS', 'https://www.fishersci.com', 'Manufacturer', NULL, 'To do', TRUE),
    ('Forma', NULL, NULL, 'Manufacturer', NULL, 'To do', TRUE),
    ('Fortis/nanoComposix', 'FNC', NULL, 'Manufacturer', NULL, 'Ready for Approval', TRUE),
    ('Hemex', 'GZE', NULL, 'Manufacturer', NULL, 'Ready for Approval', TRUE),
    ('Impak Corporation', 'IMP', NULL, 'Manufacturer', NULL, 'Ready for Approval', TRUE),
    ('Jiutu', 'JIU', NULL, 'Manufacturer', NULL, 'To do', TRUE),
    ('Joan Lab', 'JOA', NULL, 'Manufacturer', NULL, 'To do', TRUE),
    ('Kanani Biologicals', 'KAB', NULL, 'Manufacturer', NULL, 'Verified', TRUE),
    ('Kenosha', 'KEN', NULL, 'Manufacturer', NULL, 'Ready for Approval', TRUE),
    ('Kinbio', 'KIN', NULL, 'Manufacturer', NULL, 'Email/inquiry sent', TRUE),
    ('Lab Line Instruments Inc', 'LLI', NULL, 'Manufacturer', NULL, 'Verified', TRUE),
    ('Medix Biochemica', 'MXB', 'https://www.medixbiochemica.com', 'Manufacturer', NULL, 'To do', TRUE),
    ('Metash', 'MTS', NULL, 'Manufacturer', NULL, 'To do', TRUE),
    ('OHAUS', 'OHS', NULL, 'Manufacturer', NULL, 'To do', TRUE),
    ('Pickering', 'PCK', NULL, 'Manufacturer', NULL, 'To do', TRUE),
    ('Porex', 'PRX', NULL, 'Manufacturer', NULL, 'Email/inquiry sent', TRUE),
    ('R&D Systems', 'RDS', NULL, 'Manufacturer', NULL, 'Ready for Approval', TRUE),
    ('Research Products International', 'RPI', NULL, 'Manufacturer', NULL, 'Ready for Approval', TRUE),
    ('Ruishan', 'RUI', 'https://www.rndsystems.com/', 'Manufacturer', NULL, 'To do', TRUE),
    ('Sartorius', 'SRT', NULL, 'Manufacturer', NULL, 'Verified', TRUE),
    ('Scientific Notebook Company', 'SNC', NULL, 'Manufacturer', NULL, 'Verified', TRUE),
    ('Sigma Aldrich', 'SGA', 'https://www.sigmaaldrich.com/US/en/login', 'Manufacturer', NULL, 'Ready for Approval', TRUE),
    ('Stirling', 'STR', NULL, 'Manufacturer', NULL, 'To do', TRUE),
    ('Thermo Scientific', 'THS', NULL, 'Manufacturer', NULL, 'Verified', TRUE),
    ('ThermoFisher', 'THF', 'https://identity.thermofisher.com/account-center/signin.html', 'Manufacturer', NULL, 'Verified', TRUE),
    ('Vevor', 'VEV', NULL, 'Manufacturer', NULL, 'To do', TRUE),
    ('VWR', 'VWR', NULL, 'Manufacturer', NULL, 'To do', TRUE),
    ('Amazon', 'AMZ', 'https://www.amazon.com', 'Good Provider/Trading Company', NULL, 'Ready for Approval', TRUE),
    ('FedEx', 'FDX', 'https://www.fedex.com/secure-login/en-us/', 'Services', NULL, 'Ready for Approval', TRUE),
    ('UPS', 'UPS', NULL, 'Services', NULL, 'Ready for Approval', TRUE),
    ('Monday.com', 'MDY', NULL, 'Services', NULL, 'Verified', TRUE),
    ('Qualio', 'QLO', NULL, 'Services', NULL, 'Verified', TRUE),
    ('Quickbooks', 'QBK', NULL, 'Services', NULL, 'Ready for Approval', TRUE),
    ('HubSpot', 'HBS', NULL, 'Services', NULL, 'To do', TRUE),
    ('Dext', NULL, NULL, 'Services', NULL, 'Ready for Approval', TRUE),
    ('Slack', 'SLK', NULL, 'Services', NULL, 'Ready for Approval', TRUE),
    ('BBI Solutions', 'BBI', NULL, 'Manufacturer', NULL, 'Verified', TRUE),
    ('Invitrogen', 'INV', NULL, 'Manufacturer', NULL, 'To do', TRUE),
    ('ESK', 'ESK', NULL, 'Good Provider/Trading Company', NULL, 'To do', TRUE),
    ('USA Scientific', 'USS', NULL, 'Manufacturer', NULL, 'To do', TRUE),
    ('Antibodies Online', NULL, 'https://www.antibodies-online.com/', 'Manufacturer', NULL, 'To do', TRUE),
    ('LSBio', 'LSB', NULL, 'Manufacturer', NULL, 'To do', TRUE),
    ('Southern Biotech', 'SBT', NULL, 'Manufacturer', NULL, 'To do', TRUE),
    ('Jackson Immunoresearch', 'JIR', NULL, 'Manufacturer', NULL, 'Verified', TRUE),
    ('CST Technologies', 'CST', NULL, 'Manufacturer', NULL, 'Verified', TRUE),
    ('Cytivia', 'CYV', NULL, 'Manufacturer', NULL, 'Verified', TRUE),
    ('Cusabio', 'CUB', NULL, 'Manufacturer', NULL, 'Verified', TRUE),
    ('Origene', 'ORI', NULL, 'Manufacturer', NULL, 'Verified', TRUE);

-- Blank credential placeholders for suppliers that had portal logins
-- Fill these in via the supplier management UI once new MT logins are created
INSERT INTO supplier_credentials (supplier_id, portal_url, username, encrypted_password, portal_email, account_number, notes)
SELECT id, 'https://www.abbexa.com/', NULL, NULL, NULL, NULL, 'Credentials pending — update after MT login setup'
FROM suppliers WHERE name = 'Abbexa';
INSERT INTO supplier_credentials (supplier_id, portal_url, username, encrypted_password, portal_email, account_number, notes)
SELECT id, 'https://www.fortislife.com/', NULL, NULL, NULL, NULL, 'Credentials pending — update after MT login setup'
FROM suppliers WHERE name = 'Arista Biologicals';
INSERT INTO supplier_credentials (supplier_id, portal_url, username, encrypted_password, portal_email, account_number, notes)
SELECT id, NULL, NULL, NULL, NULL, NULL, 'Credentials pending — update after MT login setup'
FROM suppliers WHERE name = 'Bangs';
INSERT INTO supplier_credentials (supplier_id, portal_url, username, encrypted_password, portal_email, account_number, notes)
SELECT id, NULL, NULL, NULL, NULL, NULL, 'Credentials pending — update after MT login setup'
FROM suppliers WHERE name = 'BioSynth';
INSERT INTO supplier_credentials (supplier_id, portal_url, username, encrypted_password, portal_email, account_number, notes)
SELECT id, NULL, NULL, NULL, NULL, NULL, 'Credentials pending — update after MT login setup'
FROM suppliers WHERE name = 'BioTechne';
INSERT INTO supplier_credentials (supplier_id, portal_url, username, encrypted_password, portal_email, account_number, notes)
SELECT id, NULL, NULL, NULL, NULL, NULL, 'Credentials pending — update after MT login setup'
FROM suppliers WHERE name = 'Drummond';
INSERT INTO supplier_credentials (supplier_id, portal_url, username, encrypted_password, portal_email, account_number, notes)
SELECT id, NULL, NULL, NULL, NULL, NULL, 'Credentials pending — update after MT login setup'
FROM suppliers WHERE name = 'Eli Tech';
INSERT INTO supplier_credentials (supplier_id, portal_url, username, encrypted_password, portal_email, account_number, notes)
SELECT id, 'https://www.fishersci.com', NULL, NULL, NULL, NULL, 'Credentials pending — update after MT login setup'
FROM suppliers WHERE name = 'Fisher Scientific';
INSERT INTO supplier_credentials (supplier_id, portal_url, username, encrypted_password, portal_email, account_number, notes)
SELECT id, NULL, NULL, NULL, NULL, NULL, 'Credentials pending — update after MT login setup'
FROM suppliers WHERE name = 'Impak Corporation';
INSERT INTO supplier_credentials (supplier_id, portal_url, username, encrypted_password, portal_email, account_number, notes)
SELECT id, 'https://www.medixbiochemica.com', NULL, NULL, NULL, NULL, 'Credentials pending — update after MT login setup'
FROM suppliers WHERE name = 'Medix Biochemica';
INSERT INTO supplier_credentials (supplier_id, portal_url, username, encrypted_password, portal_email, account_number, notes)
SELECT id, 'https://www.rndsystems.com/', NULL, NULL, NULL, NULL, 'Credentials pending — update after MT login setup'
FROM suppliers WHERE name = 'Ruishan';
INSERT INTO supplier_credentials (supplier_id, portal_url, username, encrypted_password, portal_email, account_number, notes)
SELECT id, NULL, NULL, NULL, NULL, NULL, 'Credentials pending — update after MT login setup'
FROM suppliers WHERE name = 'Sartorius';
INSERT INTO supplier_credentials (supplier_id, portal_url, username, encrypted_password, portal_email, account_number, notes)
SELECT id, NULL, NULL, NULL, NULL, NULL, 'Credentials pending — update after MT login setup'
FROM suppliers WHERE name = 'Scientific Notebook Company';
INSERT INTO supplier_credentials (supplier_id, portal_url, username, encrypted_password, portal_email, account_number, notes)
SELECT id, 'https://www.sigmaaldrich.com/US/en/login', NULL, NULL, NULL, NULL, 'Credentials pending — update after MT login setup'
FROM suppliers WHERE name = 'Sigma Aldrich';
INSERT INTO supplier_credentials (supplier_id, portal_url, username, encrypted_password, portal_email, account_number, notes)
SELECT id, 'https://identity.thermofisher.com/account-center/signin.html', NULL, NULL, NULL, NULL, 'Credentials pending — update after MT login setup'
FROM suppliers WHERE name = 'ThermoFisher';
INSERT INTO supplier_credentials (supplier_id, portal_url, username, encrypted_password, portal_email, account_number, notes)
SELECT id, 'https://www.fedex.com/secure-login/en-us/', NULL, NULL, NULL, NULL, 'Credentials pending — update after MT login setup'
FROM suppliers WHERE name = 'FedEx';
INSERT INTO supplier_credentials (supplier_id, portal_url, username, encrypted_password, portal_email, account_number, notes)
SELECT id, NULL, NULL, NULL, NULL, NULL, 'Credentials pending — update after MT login setup'
FROM suppliers WHERE name = 'USA Scientific';
INSERT INTO supplier_credentials (supplier_id, portal_url, username, encrypted_password, portal_email, account_number, notes)
SELECT id, 'https://www.antibodies-online.com/', NULL, NULL, NULL, NULL, 'Credentials pending — update after MT login setup'
FROM suppliers WHERE name = 'Antibodies Online';
INSERT INTO supplier_credentials (supplier_id, portal_url, username, encrypted_password, portal_email, account_number, notes)
SELECT id, NULL, NULL, NULL, NULL, NULL, 'Credentials pending — update after MT login setup'
FROM suppliers WHERE name = 'LSBio';
INSERT INTO supplier_credentials (supplier_id, portal_url, username, encrypted_password, portal_email, account_number, notes)
SELECT id, NULL, NULL, NULL, NULL, NULL, 'Credentials pending — update after MT login setup'
FROM suppliers WHERE name = 'Southern Biotech';
INSERT INTO supplier_credentials (supplier_id, portal_url, username, encrypted_password, portal_email, account_number, notes)
SELECT id, NULL, NULL, NULL, NULL, NULL, 'Credentials pending — update after MT login setup'
FROM suppliers WHERE name = 'Jackson Immunoresearch';
INSERT INTO supplier_credentials (supplier_id, portal_url, username, encrypted_password, portal_email, account_number, notes)
SELECT id, NULL, NULL, NULL, NULL, NULL, 'Credentials pending — update after MT login setup'
FROM suppliers WHERE name = 'Cytivia';

-- Verification
SELECT COUNT(*) AS total_suppliers FROM suppliers;
SELECT COUNT(*) AS suppliers_with_credential_rows FROM supplier_credentials;