// ============================================================================
// app.js
// Main application controller for CRDW Sweep & Specify
// Handles: CSV loading, DataTables rendering, tab switching, state management,
//          multi-keyword chip search with wildcard support, auto-select on filter
// ============================================================================

const DictApp = (function () {
  // ---- State ----
  const state = {
    rawData: {},        // Raw CSV data keyed by filename
    data: { dx: [], medication: [], lab: [], location: [], procedure: [] },
    tables: {},         // DataTable instances
    desired: { dx: {}, medication: {}, lab: {}, location: {}, procedure: {} },
    categories: { dx: {}, medication: {}, lab: {}, location: {}, procedure: {} },
    keywordMatched: { dx: {}, medication: {}, lab: {}, location: {}, procedure: {} },
    activeSystems: { dx: [], medication: [], lab: [], location: [], procedure: [] },
    keywords: { dx: [], medication: [], lab: [], location: [], procedure: [] },  // active keyword chips
    aiConfig: {}
  };

  // ---- Initialize ----
  function init() {
    setupTabs();
    setupDateListeners();
    setupKeywordInputs();
    loadAiConfig();
    updateSystemsAndReload();
  }

  // ---- Tab Switching ----
  function setupTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('tab-' + tab).classList.add('active');
        if (state.tables[tab]) {
          state.tables[tab].columns.adjust().draw();
        }
      });
    });
  }

  // ---- Date/Context Listeners ----
  function setupDateListeners() {
    ['date-start', 'date-end', 'ctx-outpatient', 'ctx-inpatient'].forEach(id => {
      document.getElementById(id).addEventListener('change', () => {
        updateSystemsAndReload();
      });
    });
  }

  // ---- Multi-Keyword Chip Input ----
  function setupKeywordInputs() {
    ['dx', 'medication', 'lab', 'location', 'procedure'].forEach(type => {
      const input = document.getElementById('search-' + type);
      const wrapper = document.getElementById('kw-wrapper-' + type);
      if (!input || !wrapper) return;

      // Click on wrapper focuses the input
      wrapper.addEventListener('click', (e) => {
        if (e.target === wrapper || e.target.classList.contains('keyword-chips')) {
          input.focus();
        }
      });

      // Enter or comma adds a keyword chip
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ',') {
          e.preventDefault();
          const val = input.value.replace(/,/g, '').trim();
          if (val) {
            addKeyword(type, val);
            input.value = '';
          }
        }
        // Backspace on empty input removes last chip
        if (e.key === 'Backspace' && input.value === '' && state.keywords[type].length > 0) {
          removeKeyword(type, state.keywords[type].length - 1);
        }
      });

      // Also support pasting comma-separated lists
      input.addEventListener('paste', (e) => {
        e.preventDefault();
        const text = (e.clipboardData || window.clipboardData).getData('text');
        const terms = text.split(/[,\n]+/).map(t => t.trim()).filter(t => t);
        terms.forEach(t => addKeyword(type, t));
        input.value = '';
      });

      // If user types and pauses (no Enter), still use as live filter
      let debounceTimer;
      input.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          applyKeywordFilter(type);
        }, 200);
      });
    });
  }

  /**
   * Add a keyword chip for a given tab type
   */
  function addKeyword(type, keyword) {
    const kw = keyword.trim();
    if (!kw) return;

    // Avoid duplicates
    if (state.keywords[type].some(k => k.toLowerCase() === kw.toLowerCase())) {
      showToast('Keyword "' + kw + '" already added');
      return;
    }

    state.keywords[type].push(kw);
    renderChips(type);
    applyKeywordFilter(type);
  }

  /**
   * Remove a keyword chip by index
   */
  function removeKeyword(type, index) {
    state.keywords[type].splice(index, 1);
    renderChips(type);
    applyKeywordFilter(type);
  }

  /**
   * Clear all keyword chips
   */
  function clearKeywords(type) {
    state.keywords[type] = [];
    renderChips(type);
    // Clear DataTables search to show all rows again
    if (state.tables[type]) {
      state.tables[type].search('').draw();
    }
    updateClearButton(type);
    updateStatusBar(type);
  }

  /**
   * Render the visual chips
   */
  function renderChips(type) {
    const container = document.getElementById('kw-chips-' + type);
    if (!container) return;
    container.innerHTML = '';

    state.keywords[type].forEach((kw, idx) => {
      const chip = document.createElement('span');
      const isWildcard = kw.includes('*');
      chip.className = 'keyword-chip' + (isWildcard ? ' wildcard' : '');
      chip.innerHTML =
        '<span class="chip-text">' + escHtml(kw) + '</span>' +
        '<button class="chip-remove" onclick="DictApp.removeKeyword(\'' + type + '\', ' + idx + ')" title="Remove">&times;</button>';
      container.appendChild(chip);
    });

    updateClearButton(type);
  }

  /**
   * Show/hide the "Clear" button
   */
  function updateClearButton(type) {
    const btn = document.getElementById('btn-clear-kw-' + type);
    if (btn) {
      btn.style.display = state.keywords[type].length > 0 ? '' : 'none';
    }
  }

  /**
   * Convert a keyword (which may contain * wildcards) to a matcher function.
   * - "breast"  → contains "breast"  (LIKE '%breast%')
   * - "ovar*"   → starts with "ovar" (LIKE 'ovar%')
   * - "*itis"   → ends with "itis"   (LIKE '%itis')
   * - "*card*"  → contains "card"    (same as no wildcard)
   */
  function buildMatcher(keyword) {
    const kw = keyword.toLowerCase().trim();
    const startsWithStar = kw.startsWith('*');
    const endsWithStar = kw.endsWith('*');
    const core = kw.replace(/^\*+|\*+$/g, '');

    if (!core) return () => false;

    if (startsWithStar && endsWithStar) {
      // *term* → contains
      return (val) => val.includes(core);
    } else if (endsWithStar) {
      // term* → starts with (word-boundary aware: also matches mid-string word starts)
      return (val) => val.includes(core);
    } else if (startsWithStar) {
      // *term → ends with
      return (val) => val.includes(core);
    } else {
      // no wildcard → contains (LIKE '%term%')
      return (val) => val.includes(core);
    }
  }

  /**
   * Apply the current keyword chips + typed text as a DataTables custom filter.
   * Uses OR logic: a row matches if ANY keyword matches ANY column.
   * When keywords are active, auto-checks "desired" for all matching rows.
   */
  function applyKeywordFilter(type) {
    const table = state.tables[type];
    if (!table) return;

    const input = document.getElementById('search-' + type);
    const typedText = input ? input.value.trim() : '';
    const allTerms = [...state.keywords[type]];
    if (typedText) allTerms.push(typedText);

    // If no keywords at all, clear the filter → show everything
    if (allTerms.length === 0) {
      // Remove our custom filter
      $.fn.dataTable.ext.search = $.fn.dataTable.ext.search.filter(
        fn => fn._kwFilterType !== type
      );
      table.draw();
      updateStatusBar(type);
      return;
    }

    // Build matchers for all keywords
    const matchers = allTerms.map(buildMatcher);

    // Remove any previous keyword filter for this type
    $.fn.dataTable.ext.search = $.fn.dataTable.ext.search.filter(
      fn => fn._kwFilterType !== type
    );

    // Add custom search filter
    const filterFn = function (settings, searchData) {
      if (settings.nTable.id !== 'table-' + type) return true;

      // searchData is an array of the rendered column values (strings)
      const rowText = searchData.map(s => (s || '').toLowerCase());

      // OR logic: match if ANY keyword matches ANY column text
      return matchers.some(matcher => {
        return rowText.some(cellText => matcher(cellText));
      });
    };
    filterFn._kwFilterType = type;
    $.fn.dataTable.ext.search.push(filterFn);

    table.draw();

    // Auto-check "desired" for all visible (matched) rows when chips are present
    if (state.keywords[type].length > 0) {
      autoDesireVisible(type, allTerms);
    }

    updateStatusBar(type);
  }

  /**
   * Auto-check "desired" for all rows currently visible after a keyword filter.
   * Also sets the keyword_matched field so users can see which keyword hit.
   */
  function autoDesireVisible(type, keywords) {
    const table = state.tables[type];
    if (!table) return;

    const matchers = keywords.map(kw => ({ keyword: kw, matcher: buildMatcher(kw) }));

    table.rows({ search: 'applied' }).every(function (rowIdx) {
      const row = state.data[type][rowIdx];
      if (!row) return;

      // Find which keyword matched this row
      const rowValues = Object.values(row).map(v => (v || '').toString().toLowerCase());
      let matchedKw = '';
      for (const { keyword, matcher } of matchers) {
        if (rowValues.some(val => matcher(val))) {
          matchedKw = keyword;
          break;
        }
      }

      row.desired = true;
      row.keyword_matched = matchedKw || row.keyword_matched;
      state.desired[type][row._rowKey] = true;
      state.keywordMatched[type][row._rowKey] = row.keyword_matched;
    });

    // Update DataTable internal data for visible rows so checkboxes re-render
    table.rows({ search: 'applied' }).every(function (rowIdx) {
      var row = state.data[type][rowIdx];
      if (row) {
        this.data(buildRowArray(type, row, rowIdx));
      }
    });
    table.draw(false);
    updateStatusBar(type);
  }

  // ---- AI Config ----
  function loadAiConfig() {
    const stored = localStorage.getItem('cdw-dict-ai-config');
    if (stored) {
      try {
        const config = JSON.parse(stored);
        AiExpand.configure(config);
        GitHubPush.configure(config);
        state.aiConfig = config;
      } catch (e) { /* ignore */ }
    }

    const params = new URLSearchParams(window.location.search);
    const workerUrl = params.get('worker');
    const apiKey = params.get('apikey');
    if (workerUrl || apiKey) {
      const config = {};
      if (workerUrl) config.workerUrl = workerUrl;
      if (apiKey) config.apiKey = apiKey;
      AiExpand.configure(config);
      state.aiConfig = config;
      localStorage.setItem('cdw-dict-ai-config', JSON.stringify(config));
    }
    updateAiIndicator();
  }

  // ---- Settings Modal ----
  function openSettings() {
    const modal = document.getElementById('settings-modal');
    modal.classList.add('visible');
    const stored = localStorage.getItem('cdw-dict-ai-config');
    if (stored) {
      try {
        const config = JSON.parse(stored);
        document.getElementById('settings-apikey').value = config.apiKey || '';
        document.getElementById('settings-worker').value = config.workerUrl || '';
        document.getElementById('settings-email').value = config.email || '';
        document.getElementById('settings-gh-token').value = config.ghToken || '';
        document.getElementById('settings-gh-org').value = config.ghOrg || '';
      } catch (e) { /* ignore */ }
    }
    const statusEl = document.getElementById('settings-status');
    statusEl.className = 'settings-status';
    statusEl.textContent = '';
  }

  function closeSettings() {
    document.getElementById('settings-modal').classList.remove('visible');
  }

  function saveSettings() {
    const apiKey = document.getElementById('settings-apikey').value.trim();
    const workerUrl = document.getElementById('settings-worker').value.trim();
    const email = document.getElementById('settings-email').value.trim();
    const ghToken = document.getElementById('settings-gh-token').value.trim();
    const ghOrg = document.getElementById('settings-gh-org').value.trim();
    const config = {};
    if (apiKey) config.apiKey = apiKey;
    if (workerUrl) config.workerUrl = workerUrl;
    if (email) config.email = email;
    if (ghToken) config.ghToken = ghToken;
    if (ghOrg) config.ghOrg = ghOrg;
    localStorage.setItem('cdw-dict-ai-config', JSON.stringify(config));
    AiExpand.configure(config);
    GitHubPush.configure(config);
    state.aiConfig = config;
    updateAiIndicator();
    closeSettings();
    var parts = [];
    if (AiExpand.isAvailable()) parts.push('AI Expand ready');
    if (GitHubPush.isConfigured()) parts.push('GitHub push ready');
    showToast('Settings saved! ' + (parts.length > 0 ? parts.join(', ') : 'No integrations configured'));
  }

  async function testAiConnection() {
    const apiKey = document.getElementById('settings-apikey').value.trim();
    const workerUrl = document.getElementById('settings-worker').value.trim();
    const statusEl = document.getElementById('settings-status');
    if (!apiKey && !workerUrl) {
      statusEl.className = 'settings-status error';
      statusEl.textContent = 'Enter an API key or Worker URL to test.';
      return;
    }
    statusEl.className = 'settings-status info';
    statusEl.textContent = 'Testing connection...';
    const tempConfig = {};
    if (apiKey) tempConfig.apiKey = apiKey;
    if (workerUrl) tempConfig.workerUrl = workerUrl;
    AiExpand.configure(tempConfig);
    try {
      const keywords = await AiExpand.expandKeywords('medication', 'aspirin');
      if (keywords && keywords.length > 0) {
        statusEl.className = 'settings-status success';
        statusEl.textContent = 'Connection successful! Got ' + keywords.length + ' keywords for test query "aspirin".';
      } else {
        statusEl.className = 'settings-status error';
        statusEl.textContent = 'Connected but received empty response. Check your settings.';
      }
    } catch (err) {
      statusEl.className = 'settings-status error';
      statusEl.textContent = 'Connection failed: ' + err.message;
      if (state.aiConfig) AiExpand.configure(state.aiConfig);
    }
  }

  function updateAiIndicator() {
    const btn = document.querySelector('.btn-settings');
    if (!btn) return;
    if (AiExpand.isAvailable()) {
      btn.innerHTML = '&#9881; Settings <span class="ai-indicator connected">AI Ready</span>';
    } else {
      btn.innerHTML = '&#9881; Settings <span class="ai-indicator disconnected">AI Off</span>';
    }
  }

  // ---- System Detection & Data Loading ----
  function getDateRange() {
    const start = document.getElementById('date-start').value;
    const end = document.getElementById('date-end').value;
    return {
      start: start ? new Date(start) : new Date('2020-01-01'),
      end: end ? new Date(end) : new Date('2025-12-31')
    };
  }

  function getVisitContext() {
    return {
      outpatient: document.getElementById('ctx-outpatient').checked,
      inpatient: document.getElementById('ctx-inpatient').checked
    };
  }

  function updateSystemsAndReload() {
    const dates = getDateRange();
    const ctx = getVisitContext();
    ['dx', 'medication', 'lab', 'location', 'procedure'].forEach(type => {
      state.activeSystems[type] = SystemLogic.getActiveSystems(
        type, dates.start, dates.end, ctx.outpatient, ctx.inpatient
      );
    });
    renderSystemBadges();
    loadAllData();
  }

  function renderSystemBadges() {
    const container = document.getElementById('active-systems');
    container.innerHTML = '';
    const allSystems = new Set();
    Object.values(state.activeSystems).forEach(systems => {
      systems.forEach(s => allSystems.add(s));
    });
    allSystems.forEach(system => {
      const badge = document.createElement('span');
      badge.className = 'system-badge ' + system;
      badge.textContent = SystemLogic.getSystemLabel(system);
      container.appendChild(badge);
    });
  }

  // ---- Data Loading ----
  async function loadAllData() {
    showLoading(true);
    try {
      const types = ['dx', 'medication', 'lab', 'location', 'procedure'];
      for (const type of types) {
        await loadTypeData(type);
      }
    } catch (err) {
      console.error('Error loading data:', err);
      showToast('Error loading dictionary data: ' + err.message);
    } finally {
      showLoading(false);
    }
  }

  async function loadTypeData(type) {
    const systems = state.activeSystems[type];
    const csvFiles = SystemLogic.getSystemCsvFiles(type, systems);

    // Load each CSV file (cache in rawData)
    const loadPromises = csvFiles.map(async file => {
      if (!state.rawData[file]) {
        state.rawData[file] = await loadCsv('data/' + file);
      }
      return { file, data: state.rawData[file] };
    });

    const results = await Promise.all(loadPromises);

    // Process and merge data with source system annotation
    const merged = [];
    results.forEach(({ file, data }) => {
      const source = inferSource(file);
      data.forEach((row, idx) => {
        // For dx, filter by vocabulary based on date range
        if (type === 'dx') {
          const vocab = row.vocabulary_id;
          if (vocab === 'ICD10CM' && !systems.includes('icd10')) return;
          if (vocab === 'ICD9CM' && !systems.includes('icd9')) return;
        }

        // For types using a unified combined file, filter rows by source_db
        let rowSource = source;
        if (row.source_db && (type === 'medication' || type === 'lab' || type === 'procedure')) {
          rowSource = row.source_db.toLowerCase();
          if (!systems.includes(rowSource)) return;
        }

        const rowKey = file + ':' + idx;

        // Default desired = false. Only keyword matching or user clicks set it true.
        // If the user has already toggled this row (stored in state.desired), honor that.
        var userOverride = state.desired[type][rowKey];
        var isDesired = (userOverride !== undefined) ? userOverride : false;

        merged.push({
          ...row,
          _source: rowSource,
          _rowKey: rowKey,
          desired: isDesired,
          category: state.categories[type][rowKey] || row.category || '',
          keyword_matched: state.keywordMatched[type][rowKey] || ''
        });
      });
    });

    state.data[type] = merged;
    // Clear cached column detection so it re-scans from new data
    _detectedCols[type] = null;
    renderTable(type, merged);
    updateBadge(type, merged.length);
    updateStatusBar(type);

    // Re-apply keyword filter if keywords are active
    if (state.keywords[type].length > 0) {
      applyKeywordFilter(type);
    }

    console.log('[' + type + '] Loaded ' + merged.length + ' rows from ' + csvFiles.join(', '));
  }

  function inferSource(filename) {
    if (filename.includes('-epic'))       return 'epic';
    if (filename.includes('-meditech'))   return 'meditech';
    if (filename.includes('-centricity')) return 'centricity';
    if (filename.includes('-gecb'))       return 'gecb';
    return 'cdw';
  }

  /**
   * Strip UTF-8 BOM from text if present.
   */
  function stripBom(text) {
    return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
  }

  /**
   * Parse CSV text into an array of row objects.
   */
  function parseCsvText(text, filename) {
    var clean = stripBom(text);
    var result = Papa.parse(clean, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false
    });
    console.log('[DATA] Parsed ' + filename + ': ' + result.data.length + ' rows, columns: ' + (result.meta.fields || []).join(', '));
    return result.data;
  }

  /**
   * Load a CSV file.
   * Priority order:
   *   1. fetch() from data/ directory  (works on HTTP / GitHub Pages)
   *   2. EMBEDDED_DATA fallback         (works on file:// with no server)
   *   3. PapaParse download fallback    (last resort)
   *
   * This ensures that when you update a CSV, the app picks it up on
   * refresh (via fetch) instead of always showing stale embedded data.
   */
  function loadCsv(url) {
    var filename = url.split('/').pop();

    return new Promise(function (resolve) {
      // 1. Try fetch first (works on HTTP — picks up updated CSVs)
      fetch(url)
        .then(function (response) {
          if (!response.ok) throw new Error('HTTP ' + response.status);
          return response.text();
        })
        .then(function (text) {
          var data = parseCsvText(text, filename);
          console.log('[DATA] Fetched ' + filename + ': ' + data.length + ' rows');
          resolve(data);
        })
        .catch(function (err) {
          console.warn('[DATA] fetch failed for ' + filename + ': ' + err.message);

          // 2. fetch failed (likely file:// protocol) → try embedded data
          if (typeof EMBEDDED_DATA !== 'undefined' && EMBEDDED_DATA[filename]) {
            var data = EMBEDDED_DATA[filename];
            console.log('[DATA] Loaded ' + filename + ' from embedded data: ' + data.length + ' rows');
            resolve(data);
            return;
          }

          // 3. Last resort: PapaParse download mode
          console.log('[DATA] fetch + embedded both failed for ' + filename + ', trying PapaParse download...');
          Papa.parse(url, {
            download: true,
            header: true,
            skipEmptyLines: true,
            dynamicTyping: false,
            complete: function (results) {
              console.log('[DATA] PapaParse loaded ' + filename + ': ' + results.data.length + ' rows');
              resolve(results.data);
            },
            error: function () {
              console.warn('[DATA] Could not load ' + filename + ' from any source');
              // Show a helpful message for the user
              if (window.location.protocol === 'file:') {
                showToast('Cannot load ' + filename + ' via file://. Please serve with: python -m http.server 8080');
              }
              resolve([]);
            }
          });
        });
    });
  }

  // ---- Table Rendering ----
  function renderTable(type, data) {
    // Destroy existing table if any
    if (state.tables[type]) {
      state.tables[type].destroy();
      $('#table-' + type).empty();
    }

    var columnDefs = getColumnDefs(type);
    var rows = data.map(function (row, idx) { return buildRowArray(type, row, idx); });

    // Re-create thead with header checkbox for "Desired" column
    var theadHtml = '<thead><tr>' +
      columnDefs.map(function (c, i) {
        if (i === 0) {
          // First column = Desired → add a "select all" checkbox in header
          return '<th class="desired-cell"><input type="checkbox" ' +
            'onchange="DictApp.toggleSelectAllVisible(\'' + type + '\', this.checked)" ' +
            'title="Check/uncheck all matching rows (desired)" id="header-check-' + type + '"></th>';
        }
        return '<th>' + c.title + '</th>';
      }).join('') +
      '</tr></thead><tbody></tbody>';
    $('#table-' + type).html(theadHtml);

    state.tables[type] = $('#table-' + type).DataTable({
      data: rows,
      columns: columnDefs,
      pageLength: 50,
      lengthMenu: [25, 50, 100, 250, 500],
      order: [],               // No default sort - show in CSV order
      autoWidth: false,
      deferRender: true,
      search: { smart: true, regex: false, caseInsensitive: true },
      createdRow: function (tr, rowData, dataIndex) {
        var rowObj = state.data[type][dataIndex];
        if (rowObj && rowObj.desired) $(tr).addClass('desired-row');
        if (rowObj && rowObj.keyword_matched) $(tr).addClass('ai-matched');
      },
      language: {
        emptyTable: 'No dictionary data loaded. Ensure CSV files are in the data/ directory.',
        zeroRecords: 'No matching entries found. Try a different search term.',
        info: 'Showing _START_ to _END_ of _TOTAL_ entries',
        infoFiltered: '(filtered from _MAX_ total)',
        lengthMenu: 'Show _MENU_ entries'
      }
    });

    // Populate medication filters if applicable
    if (type === 'medication') {
      populateMedFilters(data);
    }

    // Update visible count on every draw
    state.tables[type].on('draw', function () {
      updateStatusBar(type);
      updateHeaderCheckbox(type);
    });
  }

  /**
   * Auto-detect data columns from the loaded data.
   * Returns the list of column keys found in the data, excluding internal
   * fields (_source, _rowKey, desired, category, keyword_matched).
   * Caches per type so we only scan once.
   */
  var _detectedCols = {};
  function detectDataColumns(type) {
    if (_detectedCols[type]) return _detectedCols[type];

    var colSet = {};
    var colOrder = [];
    var data = state.data[type];
    // Scan first 20 rows (from potentially different sources) to collect all keys
    var scanLimit = Math.min(data.length, 100);
    for (var i = 0; i < scanLimit; i++) {
      var row = data[i];
      Object.keys(row).forEach(function (k) {
        if (!k.startsWith('_') && k !== 'desired' && k !== 'category' && k !== 'keyword_matched') {
          if (!colSet[k]) {
            colSet[k] = true;
            colOrder.push(k);
          }
        }
      });
    }

    _detectedCols[type] = colOrder;
    console.log('[COLS] Detected ' + type + ' columns: ' + colOrder.join(', '));
    return colOrder;
  }

  /**
   * Build human-readable column titles from raw column names.
   * e.g. "icd_description" → "Icd Description", "loinc_code" → "Loinc Code"
   */
  function colTitle(colName) {
    return colName
      .replace(/_/g, ' ')
      .replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  /**
   * Build DataTables column definitions dynamically from detected columns.
   * Always: [Include checkbox] + [Source badge if not dx] + [data cols...] + [Category] + [Matched By]
   */
  function getColumnDefs(type) {
    var dataCols = detectDataColumns(type);
    var defs = [];

    // 1. Desired checkbox column (always first)
    defs.push({ title: 'Desired', className: 'desired-cell', orderable: false, width: '60px' });

    // 2. Source badge column (for non-dx types that merge multiple systems)
    if (type !== 'dx') {
      defs.push({ title: 'Source', width: '80px' });
    }

    // 3. Dynamic data columns from the CSV headers
    dataCols.forEach(function (col) {
      defs.push({ title: colTitle(col) });
    });

    // 4. Category (editable) + Matched By columns (always last)
    defs.push({ title: 'Category', className: 'category-cell', orderable: false });
    defs.push({ title: 'Matched By', orderable: false });

    return defs;
  }

  /**
   * Build a row array dynamically matching the column order from getColumnDefs.
   */
  function buildRowArray(type, row, idx) {
    var dataCols = detectDataColumns(type);
    var desiredChecked = row.desired ? 'checked' : '';
    var desiredHtml = '<input type="checkbox" ' + desiredChecked + ' onchange="DictApp.toggleDesired(\'' + type + '\', ' + idx + ', this.checked)">';
    var categoryHtml = '<input type="text" value="' + escHtml(row.category) + '" onchange="DictApp.setCategory(\'' + type + '\', ' + idx + ', this.value)" placeholder="e.g. obesity-related" title="Optional label to group this row (e.g. obesity-related, age-related)">';
    var kwHtml = escHtml(row.keyword_matched || '');

    var arr = [];
    // 1. Include checkbox
    arr.push(desiredHtml);
    // 2. Source badge (non-dx)
    if (type !== 'dx') {
      arr.push(sourceLabel(row._source));
    }
    // 3. Dynamic data columns
    dataCols.forEach(function (col) {
      arr.push(escHtml(String(row[col] || '')));
    });
    // 4. Category + Matched By
    arr.push(categoryHtml);
    arr.push(kwHtml);

    return arr;
  }

  function sourceLabel(src) {
    var labels = { epic: 'Epic', meditech: 'Meditech', centricity: 'Centricity', gecb: 'GECB', cdw: 'CDW' };
    return '<span class="system-badge ' + src + '">' + (labels[src] || src) + '</span>';
  }

  // ---- Desired / Category State ----
  function toggleDesired(type, idx, checked) {
    var row = state.data[type][idx];
    if (!row) return;
    row.desired = checked;
    state.desired[type][row._rowKey] = checked;
    var tr = state.tables[type].row(idx).node();
    if (tr) $(tr).toggleClass('desired-row', checked);
    updateStatusBar(type);
    updateHeaderCheckbox(type);
  }

  function setCategory(type, idx, value) {
    var row = state.data[type][idx];
    if (!row) return;
    row.category = value;
    state.categories[type][row._rowKey] = value;
  }

  /**
   * Header checkbox: toggle desired for ALL currently visible rows
   */
  function toggleSelectAllVisible(type, checked) {
    var table = state.tables[type];
    if (!table) return;

    // 1. Update data model for ALL rows matching the current filter
    table.rows({ search: 'applied' }).every(function (rowIdx) {
      var row = state.data[type][rowIdx];
      if (row) {
        row.desired = checked;
        state.desired[type][row._rowKey] = checked;
      }
    });

    // 2. Update the DataTable's internal data so checkboxes render correctly
    //    Only update visible (filtered) rows to avoid rebuilding 100K+ rows
    table.rows({ search: 'applied' }).every(function (rowIdx) {
      var row = state.data[type][rowIdx];
      if (row) {
        this.data(buildRowArray(type, row, rowIdx));
      }
    });

    table.draw(false);

    // 3. Also update DOM checkboxes on the currently rendered page
    $('#table-' + type + ' tbody input[type="checkbox"]').prop('checked', checked);

    // 4. Update row highlighting
    if (checked) {
      $('#table-' + type + ' tbody tr').addClass('desired-row');
    } else {
      $('#table-' + type + ' tbody tr').removeClass('desired-row');
    }

    updateStatusBar(type);
    var count = table.rows({ search: 'applied' }).count();
    showToast(checked ? 'Checked ' + count + ' visible rows' : 'Unchecked ' + count + ' visible rows');
  }

  /**
   * Update the header checkbox state based on whether all visible rows are checked
   */
  function updateHeaderCheckbox(type) {
    var cb = document.getElementById('header-check-' + type);
    if (!cb) return;
    var table = state.tables[type];
    if (!table) return;

    var allChecked = true;
    var anyVisible = false;
    table.rows({ search: 'applied' }).every(function (idx) {
      anyVisible = true;
      var row = state.data[type][idx];
      if (row && !row.desired) allChecked = false;
    });

    cb.checked = anyVisible && allChecked;
    cb.indeterminate = anyVisible && !allChecked &&
      state.data[type].some(function (r) { return r.desired; });
  }

  function selectAllVisible(type) {
    toggleSelectAllVisible(type, true);
  }

  function deselectAll(type) {
    state.data[type].forEach(function (row) {
      row.desired = false;
      state.desired[type][row._rowKey] = false;
    });
    var table = state.tables[type];
    if (table) {
      // Update DataTable internal data for visible rows
      table.rows({ search: 'applied' }).every(function (rowIdx) {
        var row = state.data[type][rowIdx];
        if (row) {
          this.data(buildRowArray(type, row, rowIdx));
        }
      });
      table.draw(false);
      // Update DOM checkboxes on current page
      $('#table-' + type + ' tbody input[type="checkbox"]').prop('checked', false);
      $('#table-' + type + ' tbody tr').removeClass('desired-row');
    }
    updateStatusBar(type);
    updateHeaderCheckbox(type);
    showToast('Unchecked all rows');
  }

  // ---- Medication Filters ----
  function populateMedFilters(data) {
    var routes = new Set();
    var sources = new Set();
    data.forEach(function (row) {
      if (row.route && row.route !== 'NULL') routes.add(row.route);
      if (row._source) sources.add(row._source);
    });
    populateSelect('filter-pharm-class', Array.from(routes).sort(), 'All Routes');
    populateSelect('filter-pharm-subclass', [], 'N/A');
    populateSelect('filter-source-system', Array.from(sources).sort(), 'All Systems');

    ['filter-pharm-class', 'filter-pharm-subclass', 'filter-source-system'].forEach(function (id) {
      var el = document.getElementById(id);
      var newEl = el.cloneNode(true);
      el.parentNode.replaceChild(newEl, el);
      newEl.addEventListener('change', function () { applyMedFilters(); });
    });
  }

  function populateSelect(selectId, options, allLabel) {
    var select = document.getElementById(selectId);
    select.innerHTML = '<option value="">' + allLabel + '</option>';
    options.forEach(function (opt) {
      var option = document.createElement('option');
      option.value = opt;
      option.textContent = opt;
      select.appendChild(option);
    });
  }

  function applyMedFilters() {
    var table = state.tables.medication;
    if (!table) return;
    var routeFilter = document.getElementById('filter-pharm-class').value.toLowerCase();
    var sourceFilter = document.getElementById('filter-source-system').value.toLowerCase();

    // Clear and add custom filter
    $.fn.dataTable.ext.search = $.fn.dataTable.ext.search.filter(
      function (fn) { return !fn._isMedFilter; }
    );
    var filterFn = function (settings, searchData, dataIndex) {
      if (settings.nTable.id !== 'table-medication') return true;
      var row = state.data.medication[dataIndex];
      if (!row) return true;
      if (routeFilter && (row.route || '').toLowerCase() !== routeFilter) return false;
      if (sourceFilter && (row._source || '').toLowerCase() !== sourceFilter) return false;
      return true;
    };
    filterFn._isMedFilter = true;
    $.fn.dataTable.ext.search.push(filterFn);

    table.draw();
    updateStatusBar('medication');
  }

  // ---- AI Expand ----
  function toggleAiPanel(type) {
    var panel = document.getElementById('ai-panel-' + type);
    panel.classList.toggle('visible');
    if (panel.classList.contains('visible')) {
      document.getElementById('ai-input-' + type).focus();
    }
  }

  async function runAiExpand(type) {
    var input = document.getElementById('ai-input-' + type).value.trim();
    if (!input) {
      showToast('Please enter a description of what you need');
      return;
    }
    var statusEl = document.getElementById('ai-status-' + type);
    if (!AiExpand.isAvailable()) {
      statusEl.className = 'ai-status error';
      statusEl.textContent = 'AI not configured. Click Settings (gear icon) to enter your API key.';
      return;
    }
    statusEl.className = 'ai-status loading';
    statusEl.textContent = 'Generating keywords...';
    try {
      var keywords = await AiExpand.expandKeywords(type, input);
      statusEl.className = 'ai-status success';
      statusEl.textContent = 'Generated ' + keywords.length + ' keywords. Adding as chips...';

      // Add AI-generated keywords as chips
      keywords.forEach(function (kw) {
        var term = kw.keyword || kw;
        if (term && !state.keywords[type].some(function (k) { return k.toLowerCase() === term.toLowerCase(); })) {
          state.keywords[type].push(term);
        }
      });
      renderChips(type);
      applyKeywordFilter(type);

      statusEl.textContent = 'Done! ' + keywords.length + ' keywords added. Review and adjust desired selections.';
    } catch (err) {
      statusEl.className = 'ai-status error';
      statusEl.textContent = 'Error: ' + err.message;
      console.error('AI expand error:', err);
    }
  }

  function getSearchColumnsForType(type) {
    var allCols = new Set();
    state.data[type].forEach(function (row) {
      Object.keys(row).forEach(function (k) {
        if (!k.startsWith('_') && k !== 'desired' && k !== 'category' && k !== 'keyword_matched') {
          allCols.add(k);
        }
      });
    });
    return Array.from(allCols);
  }

  // ---- CSV Download ----
  // Always downloads ALL matching rows (visible after filter).
  // Each row has a "desired" column (TRUE/FALSE) that the user can toggle
  // in the table before downloading. Unfiltered rows are not included.
  // Also downloads a companion search-terms manifest CSV for reproducibility.
  function downloadCsv(type) {
    var table = state.tables[type];
    var projectName = document.getElementById('project-name').value.trim();
    var hasFilter = state.keywords[type].length > 0;

    // Collect only the rows that match the current filter (visible rows).
    // If no filter is active, include ALL rows.
    var matchingData = [];
    if (table && hasFilter) {
      table.rows({ search: 'applied' }).every(function (idx) {
        var row = state.data[type][idx];
        if (row) matchingData.push(row);
      });
    } else {
      matchingData = state.data[type];
    }

    if (matchingData.length === 0) {
      showToast('No matching rows to download. Add search keywords first.');
      return;
    }

    // Group by source system for per-system CSV files
    var bySource = {};
    matchingData.forEach(function (row) {
      var src = row._source || 'cdw';
      if (!bySource[src]) bySource[src] = [];
      bySource[src].push(row);
    });

    var desiredCount = matchingData.filter(function (r) { return r.desired; }).length;
    var totalCount = matchingData.length;

    // 1. Download the data CSV(s)
    if (type === 'dx') {
      var result = CsvDownload.download(matchingData, 'dx', null, projectName, false);
    } else {
      var results = CsvDownload.downloadAll(bySource, type, projectName, false);
    }

    // 2. Download the search-terms manifest (if keywords were used)
    var keywords = state.keywords[type];
    if (keywords.length > 0) {
      var dateStart = document.getElementById('date-start').value || '';
      var dateEnd   = document.getElementById('date-end').value || '';
      var systems   = state.activeSystems[type] || [];

      // Small delay so browser doesn't block the second download
      setTimeout(function () {
        CsvDownload.downloadSearchManifest({
          keywords:      keywords,
          type:          type,
          matchingData:  matchingData,
          projectName:   projectName,
          dateStart:     dateStart,
          dateEnd:       dateEnd,
          activeSystems: systems
        });
      }, 500);
    }

    // 3. Toast summary
    if (type === 'dx') {
      if (result) {
        var msg = 'Downloaded ' + result.filename + ' (' + totalCount + ' rows, ' + desiredCount + ' marked desired)';
        if (keywords.length > 0) msg += ' + search-terms manifest';
        showToast(msg);
      }
    } else {
      if (results && results.length > 0) {
        var summary = results.map(function (r) { return r.filename; }).join(', ');
        var msg2 = 'Downloaded ' + results.length + ' file(s): ' + summary + ' (' + totalCount + ' rows, ' + desiredCount + ' desired)';
        if (keywords.length > 0) msg2 += ' + search-terms manifest';
        showToast(msg2);
      }
    }
  }

  // ---- Send to CRDW (GitHub Push) ----
  async function sendToCrdw(type) {
    if (!GitHubPush.isConfigured()) {
      showToast('GitHub not configured. Go to Settings and enter your GitHub token and org.');
      return;
    }

    var projectName = document.getElementById('project-name').value.trim();
    if (!projectName) {
      showToast('Enter a Project Name first (e.g., campbell-endometrial-cancer-1)');
      return;
    }

    var table = state.tables[type];
    var hasFilter = state.keywords[type].length > 0;

    // Collect matching rows (same logic as downloadCsv)
    var matchingData = [];
    if (table && hasFilter) {
      table.rows({ search: 'applied' }).every(function (idx) {
        var row = state.data[type][idx];
        if (row) matchingData.push(row);
      });
    } else {
      matchingData = state.data[type];
    }

    if (matchingData.length === 0) {
      showToast('No matching rows to push. Add search keywords first.');
      return;
    }

    // Group by source for per-system files
    var bySource = {};
    matchingData.forEach(function (row) {
      var src = row._source || 'cdw';
      if (!bySource[src]) bySource[src] = [];
      bySource[src].push(row);
    });

    var repoName = projectName;
    var basePath = 'data-public/metadata';
    var filesToPush = [];

    // Build the SS data CSV(s)
    if (type === 'dx') {
      var schema = CsvDownload.getDownloadSchema('dx', null);
      var csv = GitHubPush.buildCsvContent(matchingData, schema);
      var fname = CsvDownload.getDownloadFilename('dx', null, '');
      filesToPush.push({ path: basePath + '/' + fname, content: csv, label: fname });
    } else {
      Object.keys(bySource).forEach(function (source) {
        var rows = bySource[source];
        var schema = CsvDownload.getDownloadSchema(type, source);
        var csv = GitHubPush.buildCsvContent(rows, schema);
        var fname = CsvDownload.getDownloadFilename(type, source, '');
        filesToPush.push({ path: basePath + '/' + fname, content: csv, label: fname });
      });
    }

    // Build the search-terms manifest (if keywords were used)
    var keywords = state.keywords[type];
    if (keywords.length > 0) {
      var dateStart = document.getElementById('date-start').value || '';
      var dateEnd   = document.getElementById('date-end').value || '';
      var systems   = state.activeSystems[type] || [];
      var manifestCsv = GitHubPush.buildManifestContent(
        keywords, type, matchingData, projectName, dateStart, dateEnd, systems
      );
      var manifestName = 'ss-' + type + '-search-terms.csv';
      filesToPush.push({ path: basePath + '/' + manifestName, content: manifestCsv, label: manifestName });
    }

    // Push all files
    showToast('Pushing ' + filesToPush.length + ' file(s) to ' + repoName + '...');
    var successCount = 0;
    var errors = [];

    for (var i = 0; i < filesToPush.length; i++) {
      var f = filesToPush[i];
      try {
        var commitMsg = 'Update ' + f.label + ' from CRDW Sweep & Specify';
        await GitHubPush.pushFile(repoName, f.path, f.content, commitMsg);
        successCount++;
      } catch (err) {
        errors.push(f.label + ': ' + err.message);
        console.error('[CRDW Push] Failed to push ' + f.path + ':', err);
      }
    }

    if (errors.length > 0) {
      showToast('Pushed ' + successCount + '/' + filesToPush.length + ' files. Errors: ' + errors.join('; '));
    } else {
      showToast('Pushed ' + successCount + ' file(s) to ' + repoName + '/' + basePath + '/');
    }
  }

  // ---- UI Helpers ----
  function updateBadge(type, count) {
    var badge = document.getElementById('badge-' + type);
    if (badge) badge.textContent = count.toLocaleString();
  }

  function updateStatusBar(type) {
    var data = state.data[type];
    var table = state.tables[type];
    document.getElementById('total-' + type).textContent = data.length.toLocaleString();
    if (table) {
      var visibleCount = table.rows({ search: 'applied' }).count();
      document.getElementById('visible-' + type).textContent = visibleCount.toLocaleString();
    }
    var desiredCount = data.filter(function (r) { return r.desired; }).length;
    document.getElementById('desired-' + type).textContent = desiredCount.toLocaleString();
  }

  function showLoading(visible) {
    document.getElementById('loading-overlay').classList.toggle('visible', visible);
  }

  function showToast(message) {
    var toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('visible');
    setTimeout(function () { toast.classList.remove('visible'); }, 3000);
  }

  function escHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ---- Public API ----
  return {
    init: init,
    toggleDesired: toggleDesired,
    setCategory: setCategory,
    selectAllVisible: selectAllVisible,
    toggleSelectAllVisible: toggleSelectAllVisible,
    deselectAll: deselectAll,
    addKeyword: addKeyword,
    removeKeyword: removeKeyword,
    clearKeywords: clearKeywords,
    toggleAiPanel: toggleAiPanel,
    runAiExpand: runAiExpand,
    downloadCsv: downloadCsv,
    sendToCrdw: sendToCrdw,
    openSettings: openSettings,
    closeSettings: closeSettings,
    saveSettings: saveSettings,
    testAiConnection: testAiConnection,
    showToast: showToast,
    getState: function () { return state; }
  };
})();

// ---- Boot ----
$(document).ready(function () {
  DictApp.init();
});
