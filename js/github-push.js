// ============================================================================
// github-push.js
// Pushes SS files to the crdw-sweep-specify repo via the Cloudflare Worker.
// The worker holds the GITHUB_TOKEN secret — no token needed in the browser.
//
// Target path: projects/{projectName}/{filename}
// Requires: worker URL configured in Settings (same worker used for AI Expand)
//           and user email (for allowlist check in the worker)
// ============================================================================

const GitHubPush = (function () {

  let WORKER_URL = '';
  let USER_EMAIL = '';

  function configure(config) {
    if (config.workerUrl) WORKER_URL = config.workerUrl;
    if (config.email)     USER_EMAIL = config.email;
  }

  function isConfigured() {
    return !!(WORKER_URL && USER_EMAIL);
  }

  /**
   * Push a single file to the repo via the Cloudflare Worker.
   *
   * @param {string} repoName   - ignored (worker targets crdw-sweep-specify)
   * @param {string} filePath   - e.g. "projects/campbell-1/ss-dx.csv"
   * @param {string} csvContent - CSV text
   * @param {string} commitMsg  - commit message
   */
  async function pushFile(repoName, filePath, csvContent, commitMsg) {
    if (!WORKER_URL) {
      throw new Error('Worker URL not configured. Enter it in Settings (same URL used for AI Expand).');
    }
    if (!USER_EMAIL) {
      throw new Error('Email not configured. Enter your OU email in Settings.');
    }

    const workerPushUrl = WORKER_URL.replace(/\/+$/, '') + '/github-push';

    const response = await fetch(workerPushUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email:     USER_EMAIL,
        filePath:  filePath,
        content:   csvContent,
        commitMsg: commitMsg
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error('Worker error (' + response.status + '): ' + errText);
    }

    const data = await response.json();
    if (data.error) {
      throw new Error(data.error);
    }
    return data;
  }

  /**
   * Build CSV content from rows.
   * Schema is built dynamically from the actual row columns.
   * Internal fields (_*) are excluded; desired/category/keyword_matched are placed last.
   */
  function buildCsvContent(rows) {
    if (!rows || rows.length === 0) return '';
    var reserved = { desired: true, category: true, keyword_matched: true };
    var sampleRow = rows[0];
    var dataCols = Object.keys(sampleRow).filter(function (k) {
      return !k.startsWith('_') && !reserved[k];
    });
    var schema = dataCols.concat(['desired', 'category', 'keyword_matched']);

    var headerLine = schema.join(',');
    var dataLines = rows.map(function (row) {
      return schema.map(function (col) {
        var val;
        if (col === 'desired') {
          val = row.desired ? 'TRUE' : 'FALSE';
        } else {
          val = row[col];
        }
        if (val === undefined || val === null) val = '';
        val = String(val);
        if (val.indexOf(',') !== -1 || val.indexOf('"') !== -1 || val.indexOf('\n') !== -1) {
          val = '"' + val.replace(/"/g, '""') + '"';
        }
        return val;
      }).join(',');
    });

    return [headerLine].concat(dataLines).join('\n');
  }

  /**
   * Build search-terms manifest CSV content
   */
  function buildManifestContent(keywords, type, matchingData, projectName, dateStart, dateEnd, activeSystems) {
    var exportedAt = new Date().toISOString();
    var systemsStr = activeSystems.join('; ');

    function countMatches(kw) {
      var core = kw.toLowerCase().replace(/^\*+|\*+$/g, '');
      if (!core) return 0;
      return matchingData.filter(function (row) {
        return Object.values(row).some(function (v) {
          return (v || '').toString().toLowerCase().indexOf(core) !== -1;
        });
      }).length;
    }

    function csvQuote(val) {
      val = String(val == null ? '' : val);
      if (val.indexOf(',') !== -1 || val.indexOf('"') !== -1 || val.indexOf('\n') !== -1) {
        return '"' + val.replace(/"/g, '""') + '"';
      }
      return val;
    }

    var header = 'keyword,dictionary_type,is_wildcard,match_count,project_name,date_start,date_end,active_systems,exported_at';
    var lines = keywords.map(function (kw) {
      var isWild  = kw.indexOf('*') !== -1 ? 'TRUE' : 'FALSE';
      var matches = countMatches(kw);
      return [
        csvQuote(kw), csvQuote(type), isWild, matches,
        csvQuote(projectName), csvQuote(dateStart), csvQuote(dateEnd),
        csvQuote(systemsStr), csvQuote(exportedAt)
      ].join(',');
    });

    return [header].concat(lines).join('\n');
  }

  return {
    configure:            configure,
    isConfigured:         isConfigured,
    pushFile:             pushFile,
    buildCsvContent:      buildCsvContent,
    buildManifestContent: buildManifestContent
  };
})();
