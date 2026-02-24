USE [cdw_cache_staging];

-- ============================================================================
-- harmonized-procedure.sql
-- Combines procedure dictionaries from Epic Caboodle and GECB (CPT billing)
-- into a single file. Standardizes column names across both systems.
-- Run once on CDW to generate data/dictionary-procedure.csv
-- PHI-free: contains only procedure names and identifiers
--
-- System logic (matches app date-based routing):
--   Before 2023-06-03 (Epic go-live): use GECB source for procedures
--   On or after 2023-06-03:           use Epic source for procedures
--
-- Output columns:
--   procedure_key   -- Epic only
--   billing_code    -- GECB only (raw CPT code, no brackets)
--   procedure_name  -- harmonized display name
--   short_name      -- Epic only
--   category        -- Epic category; GECB concept_class_id
--   cpt_code        -- both (Epic cpt_code; GECB billing_code repeated)
--   vocabulary_id   -- both
--   source_db       -- 'Epic' | 'GECB'
-- ============================================================================

-- ============================================================================
-- Part 1: Epic procedures
-- ============================================================================
SELECT
    ps.procedure_key
    ,CAST(NULL AS VARCHAR(15))          AS billing_code
    ,ps.name                            AS procedure_name
    ,ps.short_name
    ,ps.category                        AS category
    ,ps.cpt_code
    ,ps.vocabulary_id
    ,'Epic'                             AS source_db
FROM cdw_epic_waystation.caboodle.procedure_snapshot_dim ps
WHERE ps.is_current = 1
    AND ps.procedure_key > 0

UNION ALL

-- ============================================================================
-- Part 2: GECB / CPT procedures (pre-Epic)
-- Distinct CPT codes from billing, joined to OMOP for descriptions.
-- ============================================================================
SELECT
    CAST(NULL AS INT)                   AS procedure_key
    ,t.billing_code                     AS billing_code
    ,oc.concept_name                    AS procedure_name
    ,CAST(NULL AS VARCHAR(255))         AS short_name
    ,oc.concept_class_id                AS category
    ,t.billing_code                     AS cpt_code
    ,UPPER(t.vocabulary_id)             AS vocabulary_id
    ,'GECB'                             AS source_db
FROM (
    SELECT DISTINCT
        vocabulary_id
        ,billing_code
    FROM cdw_gecb.gecb.fact_transac
    WHERE vocabulary_id = 'cpt4'
) t
    LEFT JOIN cdw_omop_1.v6.concept oc ON
        UPPER(t.vocabulary_id) = oc.vocabulary_id
        AND t.billing_code     = oc.concept_code
WHERE oc.concept_name IS NOT NULL

ORDER BY procedure_name
;
