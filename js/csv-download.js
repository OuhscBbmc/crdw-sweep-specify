// ============================================================================
// csv-download.js
// CSV export with correct ss-* schema for each type and source system
// Downloads files that match ss-*-ellis.R expectations exactly
// ============================================================================

const CsvDownload = (function () {

  /**
   * Get the column schema for a specific download type
   * Returns ordered column names matching ss-*-ellis.R expectations
   */
  function getDownloadSchema(type, source) {
    const schemas = {
      'dx': [
        'concept_id', 'vocabulary_id', 'icd_code', 'icd_description', 'desired', 'category'
      ],
      'medication-epic': [
        'medication_key', 'name', 'generic_name', 'pharmaceutical_class',
        'pharmaceutical_subclass', 'therapeutic_class', 'desired', 'category'
      ],
      'medication-meditech': [
        'medication_mnemonic', 'meditech_source', 'medication_name',
        'generic', 'ndc', 'desired', 'category'
      ],
      'medication-centricity': [
        'description', 'genericmed', 'ndc_11', 'gpi', 'desired', 'category'
      ],
      'lab-epic': [
        'lab_component_key', 'name', 'common_name', 'loinc_code',
        'loinc_name', 'default_unit', 'type', 'desired', 'category'
      ],
      'lab-meditech': [
        'print_number', 'source_meditech', 'lab_mnemonic', 'lab_desc',
        'loinc', 'abbreviation', 'desired', 'category'
      ],
      'location-epic': [
        'department_key', 'department_external_name', 'department_name',
        'department_specialty', 'location_name', 'desired', 'category'
      ],
      'location-gecb': [
        'sched_location_id', 'sched_location', 'clinic_name',
        'billing_loc_name', 'desired', 'category'
      ],
      'location-meditech': [
        'location_mnemonic', 'location_description', 'facility_name',
        'campus_name', 'location_type', 'desired', 'category'
      ]
    };

    const key = source ? `${type}-${source}` : type;
    return schemas[key] || schemas[type] || [];
  }

  /**
   * Get the filename for a specific download type
   */
  function getDownloadFilename(type, source, projectName) {
    const prefix = projectName ? `${projectName}-` : '';
    const fileNames = {
      'dx':                     `${prefix}ss-dx.csv`,
      'medication-epic':        `${prefix}ss-medication-epic.csv`,
      'medication-meditech':    `${prefix}ss-medication-meditech.csv`,
      'medication-centricity':  `${prefix}ss-medication-centricity.csv`,
      'lab-epic':               `${prefix}ss-lab-epic.csv`,
      'lab-meditech':           `${prefix}ss-lab-meditech.csv`,
      'location-epic':          `${prefix}ss-location-epic.csv`,
      'location-gecb':          `${prefix}ss-location-gecb.csv`,
      'location-meditech':      `${prefix}ss-location-meditech.csv`
    };

    const key = source ? `${type}-${source}` : type;
    return fileNames[key] || `${prefix}ss-${type}.csv`;
  }

  /**
   * Export rows as a CSV file download
   * @param {Object[]} rows - Data rows with desired and category fields
   * @param {string} type - Dictionary type
   * @param {string} source - Source system (e.g., 'epic', 'meditech')
   * @param {string} projectName - Project name for filename
   * @param {boolean} desiredOnly - If true, only export rows with desired=true
   */
  function download(rows, type, source, projectName, desiredOnly) {
    const schema = getDownloadSchema(type, source);
    if (schema.length === 0) {
      console.error('No schema found for', type, source);
      return;
    }

    let exportRows = rows;
    if (desiredOnly) {
      exportRows = rows.filter(r => r.desired);
    }

    // Build CSV content
    const headerLine = schema.join(',');
    const dataLines = exportRows.map(row => {
      return schema.map(col => {
        let val = row[col];
        if (col === 'desired') {
          val = row.desired ? 'TRUE' : 'FALSE';
        }
        if (val === undefined || val === null) val = '';
        // Quote fields that contain commas, quotes, or newlines
        val = String(val);
        if (val.includes(',') || val.includes('"') || val.includes('\n')) {
          val = '"' + val.replace(/"/g, '""') + '"';
        }
        return val;
      }).join(',');
    });

    const csvContent = [headerLine, ...dataLines].join('\n');
    const filename = getDownloadFilename(type, source, projectName);

    triggerDownload(csvContent, filename);
    return { filename, rowCount: exportRows.length };
  }

  /**
   * Download all system-specific CSVs for a type at once
   * Creates a separate CSV for each source system
   */
  function downloadAll(dataBySource, type, projectName, desiredOnly) {
    const results = [];
    Object.entries(dataBySource).forEach(([source, rows]) => {
      const result = download(rows, type, source, projectName, desiredOnly);
      if (result) results.push(result);
    });
    return results;
  }

  /**
   * Export a search-terms manifest CSV alongside the data CSVs.
   * Records every keyword used so the search can be reproduced later.
   *
   * Columns:
   *   keyword          - the search term as entered
   *   dictionary_type  - dx, medication, lab, or location
   *   is_wildcard      - TRUE if the keyword contained *
   *   match_count      - how many rows this keyword matched
   *   project_name     - project name from the setup bar
   *   date_start       - study date range start
   *   date_end         - study date range end
   *   active_systems   - comma-separated source systems used
   *   exported_at      - ISO 8601 timestamp of when the download happened
   *
   * @param {Object} opts
   * @param {string[]} opts.keywords       - array of keyword strings
   * @param {string}   opts.type           - dictionary type
   * @param {Object[]} opts.matchingData   - the rows that were exported
   * @param {string}   opts.projectName    - project name
   * @param {string}   opts.dateStart      - date-start value
   * @param {string}   opts.dateEnd        - date-end value
   * @param {string[]} opts.activeSystems  - active source systems
   */
  function downloadSearchManifest(opts) {
    var keywords      = opts.keywords || [];
    var type          = opts.type || '';
    var matchingData  = opts.matchingData || [];
    var projectName   = opts.projectName || '';
    var dateStart     = opts.dateStart || '';
    var dateEnd       = opts.dateEnd || '';
    var activeSystems = opts.activeSystems || [];
    var exportedAt    = new Date().toISOString();
    var systemsStr    = activeSystems.join('; ');

    if (keywords.length === 0) return null;

    // Count how many rows each keyword matched
    function countMatches(kw) {
      var core = kw.toLowerCase().replace(/^\*+|\*+$/g, '');
      if (!core) return 0;
      return matchingData.filter(function (row) {
        return Object.values(row).some(function (v) {
          return (v || '').toString().toLowerCase().indexOf(core) !== -1;
        });
      }).length;
    }

    var header = 'keyword,dictionary_type,is_wildcard,match_count,project_name,date_start,date_end,active_systems,exported_at';
    var lines = keywords.map(function (kw) {
      var isWild  = kw.indexOf('*') !== -1 ? 'TRUE' : 'FALSE';
      var matches = countMatches(kw);
      return [
        csvQuote(kw),
        csvQuote(type),
        isWild,
        matches,
        csvQuote(projectName),
        csvQuote(dateStart),
        csvQuote(dateEnd),
        csvQuote(systemsStr),
        csvQuote(exportedAt)
      ].join(',');
    });

    var csvContent = [header].concat(lines).join('\n');
    var prefix = projectName ? projectName + '-' : '';
    var filename = prefix + 'ss-' + type + '-search-terms.csv';

    triggerDownload(csvContent, filename);
    return { filename: filename, termCount: keywords.length };
  }

  /**
   * Quote a CSV field if it contains commas, quotes, or newlines.
   */
  function csvQuote(val) {
    val = String(val == null ? '' : val);
    if (val.indexOf(',') !== -1 || val.indexOf('"') !== -1 || val.indexOf('\n') !== -1) {
      return '"' + val.replace(/"/g, '""') + '"';
    }
    return val;
  }

  function triggerDownload(content, filename) {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  }

  return {
    download,
    downloadAll,
    downloadSearchManifest,
    getDownloadSchema,
    getDownloadFilename
  };
})();
