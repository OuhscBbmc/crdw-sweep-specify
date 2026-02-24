// ============================================================================
// github-push.js
// Push SS files to a CRDW project repo via the GitHub Contents API
//
// Target path: data-public/metadata/{filename}
// Creates a commit per file (or updates if file already exists)
// ============================================================================

const GitHubPush = (function () {

  let GH_TOKEN = '';
  let GH_ORG   = 'OuhscBbmc'; // default org; can be overridden via settings

  function configure(config) {
    if (config.ghToken) GH_TOKEN = config.ghToken;
    if (config.ghOrg)   GH_ORG   = config.ghOrg;
  }

  function isConfigured() {
    // Only a personal access token is required; org defaults to OuhscBbmc
    return !!GH_TOKEN;
  }

  /**
   * Push a CSV string to a file in the project repo.
   *
   * @param {string} repoName    - e.g. "campbell-endometrial-cancer-1"
   * @param {string} filePath    - e.g. "data-public/metadata/ss-dx.csv"
   * @param {string} csvContent  - the CSV text
   * @param {string} commitMsg   - commit message
   * @returns {Promise<Object>}  - GitHub API response
   */
  async function pushFile(repoName, filePath, csvContent, commitMsg) {
    if (!GH_TOKEN || !GH_ORG) {
      throw new Error('GitHub not configured. Go to Settings and enter your GitHub token and org.');
    }

    const apiUrl = 'https://api.github.com/repos/' + GH_ORG + '/' + repoName + '/contents/' + filePath;

    // Check if file already exists (need its SHA to update)
    let existingSha = null;
    try {
      var checkResp = await fetch(apiUrl, {
        headers: {
          'Authorization': 'Bearer ' + GH_TOKEN,
          'Accept': 'application/vnd.github.v3+json'
        }
      });
      if (checkResp.ok) {
        var existing = await checkResp.json();
        existingSha = existing.sha;
      }
    } catch (e) {
      // File doesn't exist yet — that's fine
    }

    // Base64 encode the CSV content
    var encoded = btoa(unescape(encodeURIComponent(csvContent)));

    var body = {
      message: commitMsg,
      content: encoded
    };
    if (existingSha) {
      body.sha = existingSha;
    }

    var resp = await fetch(apiUrl, {
      method: 'PUT',
      headers: {
        'Authorization': 'Bearer ' + GH_TOKEN,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!resp.ok) {
      var errText = await resp.text();
      throw new Error('GitHub API error (' + resp.status + '): ' + errText);
    }

    return await resp.json();
  }

  /**
   * Build CSV content from rows.
   * Schema is built dynamically from the actual row columns (same as csv-download.js).
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
    configure: configure,
    isConfigured: isConfigured,
    pushFile: pushFile,
    buildCsvContent: buildCsvContent,
    buildManifestContent: buildManifestContent
  };
})();
