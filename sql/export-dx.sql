-- ============================================================================
-- export-dx.sql
-- Export diagnosis dictionary from cdw_outpost.lexis.dim_dx
-- Run once on CDW to generate dictionary-dx.csv
-- Source: cdw_outpost.lexis.dim_dx (standard source for 95% of repos)
-- PHI-free: contains only ICD codes and descriptions
-- ============================================================================

SELECT DISTINCT
    d.concept_id
  , d.vocabulary_id
  , d.icd_code
  , d.icd_description
FROM cdw_outpost.lexis.dim_dx d
WHERE d.vocabulary_id IN ('ICD10CM', 'ICD9CM')
ORDER BY
    d.vocabulary_id
  , d.icd_code
;
