// ============================================================================
// search.js
// Client-side keyword LIKE matching engine
// Implements the same pattern as CDW SQL: column LIKE '%' + keyword + '%'
// ============================================================================

const SearchEngine = (function () {

  /**
   * Run keyword LIKE matching against data rows
   * @param {Object[]} data - Array of row objects
   * @param {string[]} searchColumns - Column names to search in
   * @param {string} keyword - Keyword to search for
   * @returns {Object[]} Matching rows with keyword_matched set
   */
  function likeMatch(data, searchColumns, keyword) {
    const kw = keyword.toLowerCase().trim();
    if (!kw) return [];

    return data.filter(row => {
      return searchColumns.some(col => {
        const val = (row[col] || '').toString().toLowerCase();
        return val.includes(kw);
      });
    });
  }

  /**
   * Run multiple keywords and mark which keyword matched each row
   * @param {Object[]} data - Array of row objects
   * @param {string[]} searchColumns - Column names to search in
   * @param {Array<{keyword: string, category: string}>} keywords - Keywords with categories
   * @returns {Map<number, {keyword: string, category: string}>} Map of row index to match info
   */
  function multiKeywordMatch(data, searchColumns, keywords) {
    const matches = new Map();

    keywords.forEach(({ keyword, category }) => {
      const kw = keyword.toLowerCase().trim();
      if (!kw) return;

      data.forEach((row, idx) => {
        if (matches.has(idx)) return; // first keyword wins
        const hit = searchColumns.some(col => {
          const val = (row[col] || '').toString().toLowerCase();
          return val.includes(kw);
        });
        if (hit) {
          matches.set(idx, { keyword, category: category || '' });
        }
      });
    });

    return matches;
  }

  /**
   * Get searchable columns for a dictionary type
   */
  function getSearchColumns(type, source) {
    const columns = {
      dx: ['icd_code', 'icd_description'],
      'medication-epic': ['name', 'generic_name', 'pharmaceutical_class', 'pharmaceutical_subclass', 'therapeutic_class'],
      'medication-meditech': ['medication_name', 'generic', 'medication_mnemonic'],
      'medication-centricity': ['description', 'genericmed'],
      'lab-epic': ['name', 'common_name', 'loinc_code', 'loinc_name'],
      'lab-meditech': ['lab_desc', 'lab_mnemonic', 'abbreviation', 'loinc'],
      'location-epic': ['department_name', 'department_external_name', 'department_specialty', 'location_name', 'department_type'],
      'location-gecb': ['sched_location', 'clinic_name', 'billing_loc_name'],
      'location-meditech': ['location_description', 'facility_name', 'location_type', 'location_subtype']
    };

    const key = source ? `${type}-${source}` : type;
    return columns[key] || columns[type] || Object.keys({});
  }

  /**
   * Simple search filter - matches any column containing the search term
   * Used for the instant search box
   */
  function simpleSearch(data, searchTerm) {
    const term = searchTerm.toLowerCase().trim();
    if (!term) return data;

    return data.filter(row => {
      return Object.values(row).some(val => {
        return (val || '').toString().toLowerCase().includes(term);
      });
    });
  }

  return {
    likeMatch,
    multiKeywordMatch,
    getSearchColumns,
    simpleSearch
  };
})();
