-- ============================================================================
-- export-location-epic.sql
-- Export Epic department/location dictionary
-- from cdw_epic_waystation.caboodle.department_dim
-- Run once on CDW to generate dictionary-location-epic.csv
-- PHI-free: contains only department names and classifications
-- ============================================================================

SELECT DISTINCT
    dd.department_key
  , dd.department_external_name
  , dd.department_name
  , dd.department_specialty
  , dd.location_name
  , dd.is_bed
  , dd.is_room
  , dd.department_type
FROM cdw_epic_waystation.caboodle.department_dim dd
WHERE dd.department_key > 0
ORDER BY
    dd.location_name
  , dd.department_name
;
