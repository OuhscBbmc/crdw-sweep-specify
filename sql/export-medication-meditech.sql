-- ============================================================================
-- export-medication-meditech.sql
-- Export Meditech medication dictionary from cdw_meditech.dictionary.medication
-- Run once on CDW to generate dictionary-medication-meditech.csv
-- PHI-free: contains only medication names and identifiers
-- ============================================================================

SELECT DISTINCT
    dm.medication_mnemonic
  , dm.meditech_source
  , dm.medication_name
  , dm.generic
  , dm.ndc
FROM cdw_meditech.dictionary.medication dm
ORDER BY
    dm.generic
  , dm.medication_name
;
