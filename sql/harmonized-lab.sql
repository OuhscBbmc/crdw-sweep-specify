USE [cdw_cache_staging];

-- ============================================================================
-- harmonized-lab.sql
-- Combines lab dictionaries from Epic Caboodle and Meditech into a single file.
-- Standardizes column names across both systems.
-- Run once on CDW to generate data/dictionary-lab.csv
-- PHI-free: contains only lab component names and identifiers
--
-- Output columns:
--   lab_component_key  -- Epic only
--   print_number       -- Meditech only
--   source_meditech    -- Meditech only
--   lab_name           -- harmonized display name
--   common_name        -- Epic only
--   lab_mnemonic       -- Meditech only
--   loinc_code         -- both (Meditech loinc → loinc_code)
--   loinc_name         -- Epic only
--   default_unit       -- Epic only
--   source_db          -- 'Epic' | 'Meditech'
-- ============================================================================

-- ============================================================================
-- Part 1: Epic lab components
-- ============================================================================
SELECT
    lcd.lab_component_key
    ,CAST(NULL AS VARCHAR(10))          AS print_number
    ,CAST(NULL AS VARCHAR(10))          AS source_meditech
    ,lcd.name                           AS lab_name
    ,lcd.common_name
    ,CAST(NULL AS VARCHAR(50))          AS lab_mnemonic
    ,lcd.loinc_code
    ,lcd.loinc_name
    ,lcd.default_unit
    ,'Epic'                             AS source_db
FROM cdw_epic_waystation.caboodle.lab_component_dim lcd
WHERE lcd.lab_component_key IN (
    SELECT DISTINCT l.lab_component_key
    FROM cdw_epic.caboodle.lab_component_result l
)

UNION ALL

-- ============================================================================
-- Part 2: Meditech lab dictionary
-- ============================================================================
SELECT
    CAST(NULL AS INT)                   AS lab_component_key
    ,dl.print_number
    ,dl.source_meditech
    ,dl.lab_desc                        AS lab_name
    ,CAST(NULL AS VARCHAR(255))         AS common_name
    ,dl.lab_mnemonic
    ,dl.loinc                           AS loinc_code
    ,CAST(NULL AS VARCHAR(255))         AS loinc_name
    ,CAST(NULL AS VARCHAR(25))          AS default_unit
    ,'Meditech'                         AS source_db
FROM cdw_meditech.dictionary.lab dl
WHERE dl.active = 1

ORDER BY lab_name
;
