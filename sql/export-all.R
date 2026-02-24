# ============================================================================
# export-all.R
# Export all CDW dictionary tables to CSV for the CRDW Sweep & Specify web app.
#
# Usage:
#   1. Open R / RStudio
#   2. source("sql/export-all.R")
#   -- OR --
#   Rscript sql/export-all.R
#
# Prerequisites:
#   - R packages: DBI, odbc, readr
#   - ODBC DSN "cdw_cache_staging" configured (Windows auth)
#
# Output: ../data/dictionary-*.csv (9 files)
# ============================================================================

library(DBI)
library(odbc)
library(readr)

# ---- Configuration ---------------------------------------------------------
# Change these if your DSN names differ
dsn_staging   <- "cdw_cache_staging"    # for Epic, OMOP tables
dsn_outpost   <- "cdw_outpost"          # for Centricity, lexis (dx)

# Output directory (relative to this script's location, or absolute)
out_dir <- file.path(dirname(sys.frame(1)$ofile %||% "."), "..", "data")
out_dir <- normalizePath(out_dir, mustWork = FALSE)
if (!dir.exists(out_dir)) dir.create(out_dir, recursive = TRUE)

cat("============================================\n")
cat(" CRDW Sweep & Specify - CSV Export (R)\n")
cat(" Output directory:", out_dir, "\n")
cat("============================================\n\n")

# ---- Helper ----------------------------------------------------------------
export_query <- function(dsn, query, filename, label) {
  out_path <- file.path(out_dir, filename)
  cat(sprintf("[%s] Querying %s ...\n", label, dsn))

  tryCatch({
    con <- dbConnect(odbc::odbc(), dsn = dsn)
    on.exit(dbDisconnect(con), add = TRUE)

    df <- dbGetQuery(con, query)

    readr::write_csv(df, out_path)
    cat(sprintf("  OK: %s rows -> %s\n", format(nrow(df), big.mark = ","), filename))
  }, error = function(e) {
    cat(sprintf("  ERROR: %s\n", e$message))
  })
}


# ---- 1. Diagnoses ----------------------------------------------------------
export_query(
  dsn   = dsn_outpost,
  label = "dx",
  filename = "dictionary-dx.csv",
  query = "
    SELECT DISTINCT
        d.concept_id
      , d.vocabulary_id
      , d.icd_code
      , d.icd_description
    FROM cdw_outpost.lexis.dim_dx d
    WHERE d.vocabulary_id IN ('ICD10CM', 'ICD9CM')
    ORDER BY d.vocabulary_id, d.icd_code
  "
)


# ---- 2. Medication - Epic --------------------------------------------------
export_query(
  dsn   = dsn_staging,
  label = "medication-epic",
  filename = "dictionary-medication-epic.csv",
  query = "
    SELECT DISTINCT
        md.medication_key
      , md.name
      , md.generic_name
      , md.pharmaceutical_class
      , md.pharmaceutical_subclass
      , md.therapeutic_class
    FROM cdw_epic_waystation.caboodle.medication_dim md
    WHERE md.medication_key > 0
    ORDER BY md.generic_name, md.name
  "
)


# ---- 3. Medication - Meditech ----------------------------------------------
export_query(
  dsn   = dsn_staging,
  label = "medication-meditech",
  filename = "dictionary-medication-meditech.csv",
  query = "
    SELECT DISTINCT
        dm.medication_mnemonic
      , dm.meditech_source
      , dm.medication_name
      , dm.generic
      , dm.ndc
    FROM cdw_meditech.dictionary.medication dm
    ORDER BY dm.generic, dm.medication_name
  "
)


# ---- 4. Medication - Centricity --------------------------------------------
# NOTE: Verify the exact table name on your CDW.
# This is based on dunn-meningioma-1 patterns.
export_query(
  dsn   = dsn_outpost,
  label = "medication-centricity",
  filename = "dictionary-medication-centricity.csv",
  query = "
    SELECT DISTINCT
        cm.description
      , cm.genericmed
      , cm.ndc_11
      , cm.gpi
    FROM cdw_outpost.centricity.medication cm
    ORDER BY cm.genericmed, cm.description
  "
)


# ---- 5. Lab - Epic ---------------------------------------------------------
export_query(
  dsn   = dsn_staging,
  label = "lab-epic",
  filename = "dictionary-lab-epic.csv",
  query = "
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
  "
)


# ---- 6. Lab - Meditech -----------------------------------------------------
export_query(
  dsn   = dsn_staging,
  label = "lab-meditech",
  filename = "dictionary-lab-meditech.csv",
  query = "
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
  "
)


# ---- 7. Location - Epic ----------------------------------------------------
export_query(
  dsn   = dsn_staging,
  label = "location-epic",
  filename = "dictionary-location-epic.csv",
  query = "
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
    ORDER BY dd.location_name, dd.department_name
  "
)


# ---- 8. Location - GECB ----------------------------------------------------
export_query(
  dsn   = dsn_staging,
  label = "location-gecb",
  filename = "dictionary-location-gecb.csv",
  query = "
    SELECT DISTINCT
        fs.sched_location_id
      , fs.sched_location
      , fs.clinic_name
      , fs.billing_loc_name
    FROM cdw_gecb.gecb.fact_sched fs
    WHERE fs.sched_location_id IS NOT NULL
    ORDER BY fs.clinic_name, fs.sched_location
  "
)


# ---- 9. Location - Meditech ------------------------------------------------
export_query(
  dsn   = dsn_staging,
  label = "location-meditech",
  filename = "dictionary-location-meditech.csv",
  query = "
    SELECT DISTINCT
        dl.location_mnemonic
      , dl.location_description
      , dl.facility_name
      , dl.campus_name
      , dl.location_type
      , dl.location_subtype
    FROM cdw_meditech.dictionary.location dl
    ORDER BY dl.facility_name, dl.location_description
  "
)


# ---- Summary ---------------------------------------------------------------
cat("\n============================================\n")
cat(" Export complete!\n")
cat("============================================\n\n")

csv_files <- list.files(out_dir, pattern = "^dictionary-.*\\.csv$", full.names = TRUE)
for (f in csv_files) {
  n <- length(readLines(f, warn = FALSE)) - 1L
  sz <- file.size(f) / 1024
  cat(sprintf("  %-45s %8s rows  %10s\n",
    basename(f),
    format(n, big.mark = ","),
    sprintf("%.0f KB", sz)
  ))
}

cat("\nNext steps:\n")
cat("  1. Verify row counts look reasonable\n")
cat("  2. git add data/ && git commit -m 'Update dictionary CSVs'\n")
cat("  3. git push  (to update GitHub Pages)\n")
