-- ============================================================================
-- export-medication-centricity.sql
-- Export Centricity medication dictionary
-- Run once on CDW to generate dictionary-medication-centricity.csv
-- PHI-free: contains only medication names and identifiers
--
-- NOTE: Exact source table TBD. Pattern from dunn-meningioma-1 uses
-- cdw_outpost.centricity.* for medication data. Adjust table/column
-- names as needed once confirmed.
-- ============================================================================

SELECT DISTINCT
    cm.description
  , cm.genericmed
  , cm.ndc_11
  , cm.gpi
FROM cdw_outpost.centricity.medication cm
ORDER BY
    cm.genericmed
  , cm.description
;
