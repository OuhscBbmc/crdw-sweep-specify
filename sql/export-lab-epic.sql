-- ============================================================================
-- export-lab-epic.sql
-- Export Epic lab component dictionary from cdw_epic_waystation.caboodle.lab_component_dim
-- Filtered to components that actually exist in lab_component_result
-- Run once on CDW to generate dictionary-lab-epic.csv
-- PHI-free: contains only lab component names and identifiers
-- ============================================================================

SELECT DISTINCT
    lcd.lab_component_key
  , lcd.name
  , lcd.common_name
  , lcd.loinc_code
  , lcd.loinc_name
  , lcd.default_unit
  , lcd.type
FROM cdw_epic_waystation.caboodle.lab_component_dim lcd
WHERE lcd.lab_component_key IN (
    SELECT DISTINCT l.lab_component_key
    FROM cdw_epic.caboodle.lab_component_result l
)
ORDER BY lcd.name
;
