-- ============================================================================
-- export-medication-epic.sql
-- Export Epic medication dictionary from cdw_epic_waystation.caboodle.medication_dim
-- Run once on CDW to generate dictionary-medication-epic.csv
-- PHI-free: contains only medication names and classifications
-- ============================================================================

SELECT DISTINCT
    md.medication_key
  , md.name
  , md.generic_name
  , md.pharmaceutical_class
  , md.pharmaceutical_subclass
  , md.therapeutic_class
FROM cdw_epic_waystation.caboodle.medication_dim md
WHERE md.medication_key > 0
ORDER BY
    md.generic_name
  , md.name
;
