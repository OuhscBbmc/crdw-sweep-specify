-- ============================================================================
-- export-location-gecb.sql
-- Export GECB scheduling location dictionary
-- from cdw_gecb.gecb.fact_sched (outpatient scheduling locations)
-- Run once on CDW to generate dictionary-location-gecb.csv
-- PHI-free: contains only location names and identifiers
-- ============================================================================

SELECT DISTINCT
    fs.sched_location_id
  , fs.sched_location
  , fs.clinic_name
  , fs.billing_loc_name
FROM cdw_gecb.gecb.fact_sched fs
WHERE fs.sched_location_id IS NOT NULL
ORDER BY
    fs.clinic_name
  , fs.sched_location
;
