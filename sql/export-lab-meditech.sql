-- ============================================================================
-- export-lab-meditech.sql
-- Export Meditech lab dictionary from cdw_meditech.dictionary.lab
-- Run once on CDW to generate dictionary-lab-meditech.csv
-- PHI-free: contains only lab names and identifiers
-- NOTE: ~40% of Meditech lab entries have NULL LOINC codes
-- ============================================================================

SELECT DISTINCT
    dl.print_number
  , dl.source_meditech
  , dl.lab_mnemonic
  , dl.lab_desc
  , dl.loinc
  , dl.abbreviation
FROM cdw_meditech.dictionary.lab dl
WHERE dl.active = 1
ORDER BY dl.lab_desc
;
