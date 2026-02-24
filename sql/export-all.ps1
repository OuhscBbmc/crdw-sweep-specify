# ============================================================================
# export-all.ps1
# Master export script - runs all dictionary queries and writes CSVs
# to the ../data/ directory for the CRDW Sweep & Specify web app.
#
# Usage:
#   1. Open PowerShell
#   2. cd to this sql/ directory
#   3. .\export-all.ps1
#
# Prerequisites:
#   - sqlcmd must be in PATH (already installed on this machine)
#   - ODBC connection to CDW (uses Windows auth by default)
#
# Each query is run via sqlcmd with comma-separated output.
# Output goes to ../data/dictionary-*.csv
# ============================================================================

param(
    [string]$Server = "YOURSERVER",     # <-- CHANGE THIS to your CDW SQL Server hostname
    [string]$OutDir = (Join-Path $PSScriptRoot "..\data")
)

# Ensure output directory exists
if (-not (Test-Path $OutDir)) {
    New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
}

Write-Host "============================================" -ForegroundColor Cyan
Write-Host " CRDW Sweep & Specify - CSV Export"            -ForegroundColor Cyan
Write-Host " Output directory: $OutDir"                  -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# --------------------------------------------------------------------------
# Helper function: run a query and write CSV
# --------------------------------------------------------------------------
function Export-DictCsv {
    param(
        [string]$Name,
        [string]$Query,
        [string]$OutFile,
        [string]$Database = "master"
    )

    $outPath = Join-Path $OutDir $OutFile
    Write-Host "[$Name] Exporting to $OutFile ..." -ForegroundColor Yellow

    try {
        # Run sqlcmd with comma-separated output, no column width padding
        # -W trims trailing spaces, -s "," sets comma separator, -h -1 suppresses headers from sqlcmd
        # We'll add our own header line
        $result = sqlcmd -S $Server -d $Database -E `
            -Q $Query `
            -s "," -W -h -1 -w 65535 2>&1

        if ($LASTEXITCODE -ne 0) {
            Write-Host "  ERROR: sqlcmd failed with exit code $LASTEXITCODE" -ForegroundColor Red
            Write-Host "  $result" -ForegroundColor Red
            return
        }

        # Filter out blank lines and the row-count line (e.g., "(12345 rows affected)")
        $lines = $result | Where-Object {
            $_ -and
            $_.Trim() -ne "" -and
            $_ -notmatch "^\(\d+ rows? affected\)$"
        }

        # Write to file
        $lines | Out-File -FilePath $outPath -Encoding UTF8

        $rowCount = $lines.Count - 0  # all lines are data (header added by query)
        Write-Host "  OK: $rowCount rows written" -ForegroundColor Green
    }
    catch {
        Write-Host "  ERROR: $_" -ForegroundColor Red
    }
}


# --------------------------------------------------------------------------
# 1. Diagnoses (cdw_outpost.lexis.dim_dx)
# --------------------------------------------------------------------------
Export-DictCsv -Name "dx" -OutFile "dictionary-dx.csv" -Query @"
SELECT 'concept_id' AS concept_id, 'vocabulary_id' AS vocabulary_id, 'icd_code' AS icd_code, 'icd_description' AS icd_description
UNION ALL
SELECT DISTINCT
    CAST(d.concept_id AS varchar(20))
  , d.vocabulary_id
  , d.icd_code
  , REPLACE(REPLACE(d.icd_description, ',', ';'), CHAR(10), ' ')
FROM cdw_outpost.lexis.dim_dx d
WHERE d.vocabulary_id IN ('ICD10CM', 'ICD9CM')
ORDER BY 2, 3
"@


# --------------------------------------------------------------------------
# 2. Medication - Epic (cdw_epic_waystation.caboodle.medication_dim)
# --------------------------------------------------------------------------
Export-DictCsv -Name "medication-epic" -OutFile "dictionary-medication-epic.csv" -Query @"
SELECT 'medication_key' AS c1, 'name' AS c2, 'generic_name' AS c3, 'pharmaceutical_class' AS c4, 'pharmaceutical_subclass' AS c5, 'therapeutic_class' AS c6
UNION ALL
SELECT DISTINCT
    CAST(md.medication_key AS varchar(20))
  , REPLACE(REPLACE(md.name, ',', ';'), CHAR(10), ' ')
  , REPLACE(REPLACE(ISNULL(md.generic_name, ''), ',', ';'), CHAR(10), ' ')
  , REPLACE(ISNULL(md.pharmaceutical_class, ''), ',', ';')
  , REPLACE(ISNULL(md.pharmaceutical_subclass, ''), ',', ';')
  , REPLACE(ISNULL(md.therapeutic_class, ''), ',', ';')
FROM cdw_epic_waystation.caboodle.medication_dim md
WHERE md.medication_key > 0
ORDER BY 3, 2
"@


# --------------------------------------------------------------------------
# 3. Medication - Meditech (cdw_meditech.dictionary.medication)
# --------------------------------------------------------------------------
Export-DictCsv -Name "medication-meditech" -OutFile "dictionary-medication-meditech.csv" -Query @"
SELECT 'medication_mnemonic' AS c1, 'meditech_source' AS c2, 'medication_name' AS c3, 'generic' AS c4, 'ndc' AS c5
UNION ALL
SELECT DISTINCT
    ISNULL(dm.medication_mnemonic, '')
  , ISNULL(dm.meditech_source, '')
  , REPLACE(REPLACE(ISNULL(dm.medication_name, ''), ',', ';'), CHAR(10), ' ')
  , REPLACE(REPLACE(ISNULL(dm.generic, ''), ',', ';'), CHAR(10), ' ')
  , ISNULL(dm.ndc, '')
FROM cdw_meditech.dictionary.medication dm
ORDER BY 4, 3
"@


# --------------------------------------------------------------------------
# 4. Medication - Centricity
# NOTE: Verify the exact table name. This is based on dunn-meningioma-1 patterns.
# --------------------------------------------------------------------------
Export-DictCsv -Name "medication-centricity" -OutFile "dictionary-medication-centricity.csv" -Query @"
SELECT 'description' AS c1, 'genericmed' AS c2, 'ndc_11' AS c3, 'gpi' AS c4
UNION ALL
SELECT DISTINCT
    REPLACE(REPLACE(ISNULL(cm.description, ''), ',', ';'), CHAR(10), ' ')
  , REPLACE(REPLACE(ISNULL(cm.genericmed, ''), ',', ';'), CHAR(10), ' ')
  , ISNULL(cm.ndc_11, '')
  , ISNULL(cm.gpi, '')
FROM cdw_outpost.centricity.medication cm
ORDER BY 2, 1
"@


# --------------------------------------------------------------------------
# 5. Lab - Epic (cdw_epic_waystation.caboodle.lab_component_dim)
# --------------------------------------------------------------------------
Export-DictCsv -Name "lab-epic" -OutFile "dictionary-lab-epic.csv" -Query @"
SELECT 'lab_component_key' AS c1, 'name' AS c2, 'common_name' AS c3, 'loinc_code' AS c4, 'loinc_name' AS c5, 'default_unit' AS c6, 'type' AS c7
UNION ALL
SELECT DISTINCT
    CAST(lcd.lab_component_key AS varchar(20))
  , REPLACE(REPLACE(ISNULL(lcd.name, ''), ',', ';'), CHAR(10), ' ')
  , REPLACE(REPLACE(ISNULL(lcd.common_name, ''), ',', ';'), CHAR(10), ' ')
  , ISNULL(lcd.loinc_code, '')
  , REPLACE(REPLACE(ISNULL(lcd.loinc_name, ''), ',', ';'), CHAR(10), ' ')
  , REPLACE(ISNULL(lcd.default_unit, ''), ',', ';')
  , REPLACE(ISNULL(lcd.type, ''), ',', ';')
FROM cdw_epic_waystation.caboodle.lab_component_dim lcd
WHERE lcd.lab_component_key IN (
    SELECT DISTINCT l.lab_component_key
    FROM cdw_epic.caboodle.lab_component_result l
)
ORDER BY 2
"@


# --------------------------------------------------------------------------
# 6. Lab - Meditech (cdw_meditech.dictionary.lab)
# --------------------------------------------------------------------------
Export-DictCsv -Name "lab-meditech" -OutFile "dictionary-lab-meditech.csv" -Query @"
SELECT 'print_number' AS c1, 'source_meditech' AS c2, 'lab_mnemonic' AS c3, 'lab_desc' AS c4, 'loinc' AS c5, 'abbreviation' AS c6
UNION ALL
SELECT DISTINCT
    ISNULL(CAST(dl.print_number AS varchar(20)), '')
  , ISNULL(dl.source_meditech, '')
  , ISNULL(dl.lab_mnemonic, '')
  , REPLACE(REPLACE(ISNULL(dl.lab_desc, ''), ',', ';'), CHAR(10), ' ')
  , ISNULL(dl.loinc, '')
  , ISNULL(dl.abbreviation, '')
FROM cdw_meditech.dictionary.lab dl
WHERE dl.active = 1
ORDER BY 4
"@


# --------------------------------------------------------------------------
# 7. Location - Epic (cdw_epic_waystation.caboodle.department_dim)
# --------------------------------------------------------------------------
Export-DictCsv -Name "location-epic" -OutFile "dictionary-location-epic.csv" -Query @"
SELECT 'department_key' AS c1, 'department_external_name' AS c2, 'department_name' AS c3, 'department_specialty' AS c4, 'location_name' AS c5, 'is_bed' AS c6, 'is_room' AS c7, 'department_type' AS c8
UNION ALL
SELECT DISTINCT
    CAST(dd.department_key AS varchar(20))
  , REPLACE(REPLACE(ISNULL(dd.department_external_name, ''), ',', ';'), CHAR(10), ' ')
  , REPLACE(REPLACE(ISNULL(dd.department_name, ''), ',', ';'), CHAR(10), ' ')
  , REPLACE(ISNULL(dd.department_specialty, ''), ',', ';')
  , REPLACE(REPLACE(ISNULL(dd.location_name, ''), ',', ';'), CHAR(10), ' ')
  , CAST(ISNULL(dd.is_bed, 0) AS varchar(1))
  , CAST(ISNULL(dd.is_room, 0) AS varchar(1))
  , REPLACE(ISNULL(dd.department_type, ''), ',', ';')
FROM cdw_epic_waystation.caboodle.department_dim dd
WHERE dd.department_key > 0
ORDER BY 5, 3
"@


# --------------------------------------------------------------------------
# 8. Location - GECB (cdw_gecb.gecb.fact_sched)
# --------------------------------------------------------------------------
Export-DictCsv -Name "location-gecb" -OutFile "dictionary-location-gecb.csv" -Query @"
SELECT 'sched_location_id' AS c1, 'sched_location' AS c2, 'clinic_name' AS c3, 'billing_loc_name' AS c4
UNION ALL
SELECT DISTINCT
    CAST(fs.sched_location_id AS varchar(20))
  , REPLACE(REPLACE(ISNULL(fs.sched_location, ''), ',', ';'), CHAR(10), ' ')
  , REPLACE(REPLACE(ISNULL(fs.clinic_name, ''), ',', ';'), CHAR(10), ' ')
  , REPLACE(REPLACE(ISNULL(fs.billing_loc_name, ''), ',', ';'), CHAR(10), ' ')
FROM cdw_gecb.gecb.fact_sched fs
WHERE fs.sched_location_id IS NOT NULL
ORDER BY 3, 2
"@


# --------------------------------------------------------------------------
# 9. Location - Meditech (cdw_meditech.dictionary.location)
# --------------------------------------------------------------------------
Export-DictCsv -Name "location-meditech" -OutFile "dictionary-location-meditech.csv" -Query @"
SELECT 'location_mnemonic' AS c1, 'location_description' AS c2, 'facility_name' AS c3, 'campus_name' AS c4, 'location_type' AS c5, 'location_subtype' AS c6
UNION ALL
SELECT DISTINCT
    ISNULL(dl.location_mnemonic, '')
  , REPLACE(REPLACE(ISNULL(dl.location_description, ''), ',', ';'), CHAR(10), ' ')
  , REPLACE(REPLACE(ISNULL(dl.facility_name, ''), ',', ';'), CHAR(10), ' ')
  , REPLACE(ISNULL(dl.campus_name, ''), ',', ';')
  , REPLACE(ISNULL(dl.location_type, ''), ',', ';')
  , REPLACE(ISNULL(dl.location_subtype, ''), ',', ';')
FROM cdw_meditech.dictionary.location dl
ORDER BY 3, 2
"@


# --------------------------------------------------------------------------
# Summary
# --------------------------------------------------------------------------
Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host " Export complete! Files in: $OutDir"         -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

Get-ChildItem $OutDir -Filter "dictionary-*.csv" | ForEach-Object {
    $lines = (Get-Content $_.FullName | Measure-Object -Line).Lines
    Write-Host ("  {0,-45} {1,8} rows  {2,10}" -f $_.Name, ($lines - 1), ("{0:N0} KB" -f ($_.Length / 1KB))) -ForegroundColor White
}

Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Verify row counts look reasonable" -ForegroundColor White
Write-Host "  2. git add data/ && git commit -m 'Update dictionary CSVs'" -ForegroundColor White
Write-Host "  3. git push  (to update GitHub Pages)" -ForegroundColor White
