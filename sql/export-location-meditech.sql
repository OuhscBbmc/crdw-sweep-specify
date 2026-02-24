-- ============================================================================
-- export-location-meditech.sql
-- Export Meditech location dictionary from cdw_meditech.dictionary.location
-- Run once on CDW to generate dictionary-location-meditech.csv
-- PHI-free: contains only location names and classifications
-- ============================================================================

SELECT DISTINCT
    dl.location_mnemonic
  , dl.location_description
  , dl.facility_name
  , dl.campus_name
  , dl.location_type
  , dl.location_subtype
FROM cdw_meditech.dictionary.location dl
ORDER BY
    dl.facility_name
  , dl.location_description
;
