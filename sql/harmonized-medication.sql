USE [cdw_cache_staging];

-- Harmonized Medication Query
-- Combines medication data from Epic Caboodle, Meditech, and Centricity
-- Standardizes column names and data types across all three systems

-- ============================================================================
-- Part 1: Epic Caboodle medication events
-- ============================================================================
SELECT
    me.medication_event_key                     AS medication_event_id
    ,me.medication_key
    ,me.mrn_epic_durable                        AS mrn
    ,me.encounter_key
    ,me.medication_order_key
    ,CAST(NULL AS VARCHAR(25))                  AS medication_mnemonic
    ,CAST(NULL AS VARCHAR(11))                  AS ndc_11
    ,CAST(NULL AS VARCHAR(20))                  AS ddid
    ,md.name                                    AS medication_name
    ,md.generic_name
    ,me.route
    ,me.dose_unit
    ,me.minimum_dose                            AS dose_min
    ,me.maximum_dose                            AS dose_max
    ,CAST(NULL AS VARCHAR(20))                  AS dose
    ,me.frequency
    ,md.gpi
    ,CAST(NULL AS VARCHAR(50))                  AS rxnorm
    ,me.administered
    ,me.administration_action
    ,me.refills_written
    ,CAST(NULL AS VARCHAR(100))                 AS instructions
    ,CAST(NULL AS VARCHAR(500))                 AS sig
    ,CAST(NULL AS VARCHAR(100))                 AS legend
    ,'Epic'                                     AS source_db
FROM cdw_epic.caboodle.medication_event me
    INNER JOIN cdw_epic_waystation.caboodle.medication_dim md
        ON me.medication_key = md.medication_key

UNION ALL

-- ============================================================================
-- Part 2: Meditech medications
-- ============================================================================
SELECT
    m.medication_index                          AS medication_event_id
    ,CAST(NULL AS INT)                          AS medication_key
    ,m.mrn_meditech_internal                    AS mrn
    ,CAST(NULL AS INT)                          AS encounter_key
    ,CAST(NULL AS INT)                          AS medication_order_key
    ,m.medication_mnemonic
    ,m.ndc                                      AS ndc_11
    ,CAST(NULL AS VARCHAR(20))                  AS ddid
    ,m.medication_name
    ,md2.generic                                AS generic_name
    ,m.route
    ,m.dose_unit
    ,CAST(NULL AS DECIMAL(10,2))                AS dose_min
    ,CAST(NULL AS DECIMAL(10,2))                AS dose_max
    ,CAST(NULL AS VARCHAR(20))                  AS dose
    ,CAST(NULL AS VARCHAR(50))                  AS frequency
    ,CAST(NULL AS VARCHAR(200))                 AS gpi
    ,CAST(NULL AS VARCHAR(50))                  AS rxnorm
    ,CAST(NULL AS VARCHAR(10))                  AS administered
    ,CAST(NULL AS VARCHAR(50))                  AS administration_action
    ,CAST(NULL AS INT)                          AS refills_written
    ,CAST(NULL AS VARCHAR(100))                 AS instructions
    ,m.sig
    ,CAST(NULL AS VARCHAR(100))                 AS legend
    ,'Meditech'                                 AS source_db
FROM cdw_meditech.meditech.medication m
    LEFT JOIN cdw_meditech.dictionary.medication md2
        ON m.medication_mnemonic = md2.medication_mnemonic

UNION ALL

-- ============================================================================
-- Part 3: Centricity medications
-- ============================================================================
SELECT
    c.mid                                       AS medication_event_id
    ,CAST(NULL AS INT)                          AS medication_key
    ,c.mrn_centricity                           AS mrn
    ,CAST(NULL AS INT)                          AS encounter_key
    ,CAST(NULL AS INT)                          AS medication_order_key
    ,CAST(NULL AS VARCHAR(25))                  AS medication_mnemonic
    ,c.ndc_11
    ,c.ddid
    ,c.description                              AS medication_name
    ,c.genericmed                               AS generic_name
    ,c.route
    ,c.dose_unit
    ,CAST(NULL AS DECIMAL(10,2))                AS dose_min
    ,CAST(NULL AS DECIMAL(10,2))                AS dose_max
    ,CAST(NULL AS VARCHAR(20))                  AS dose
    ,CAST(NULL AS VARCHAR(50))                  AS frequency
    ,CAST(NULL AS VARCHAR(200))                 AS gpi
    ,CAST(NULL AS VARCHAR(50))                  AS rxnorm
    ,CAST(NULL AS VARCHAR(10))                  AS administered
    ,CAST(NULL AS VARCHAR(50))                  AS administration_action
    ,CAST(NULL AS INT)                          AS refills_written
    ,CAST(NULL AS VARCHAR(100))                 AS instructions
    ,CAST(NULL AS VARCHAR(500))                 AS sig
    ,CAST(NULL AS VARCHAR(100))                 AS legend
    ,'Centricity'                               AS source_db
FROM cdw_centricity.centricity.medicate c
;
