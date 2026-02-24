// ============================================================================
// system-logic.js
// Determines which source systems to show based on date range and visit context
// Epic go-live date: 2023-06-03
// ============================================================================

const SystemLogic = (function () {
  const EPIC_GOLIVE = new Date('2023-06-03');
  const ICD10_START = new Date('2015-10-01');

  /**
   * Determine active systems for a given dictionary type
   * @param {string} type - 'dx', 'medication', 'lab', or 'location'
   * @param {Date} dateStart
   * @param {Date} dateEnd
   * @param {boolean} outpatient
   * @param {boolean} inpatient
   * @returns {string[]} Array of system names to include
   */
  function getActiveSystems(type, dateStart, dateEnd, outpatient, inpatient) {
    const beforeEpic = dateStart < EPIC_GOLIVE;
    const afterEpic  = dateEnd >= EPIC_GOLIVE;

    if (type === 'dx') {
      return getDxSystems(dateStart, dateEnd);
    }
    if (type === 'medication') {
      return getMedicationSystems(beforeEpic, afterEpic, outpatient, inpatient);
    }
    if (type === 'lab') {
      return getLabSystems(beforeEpic, afterEpic);
    }
    if (type === 'location') {
      return getLocationSystems(beforeEpic, afterEpic, outpatient, inpatient);
    }
    if (type === 'procedure') {
      return getProcedureSystems(beforeEpic, afterEpic);
    }
    return [];
  }

  function getDxSystems(dateStart, dateEnd) {
    const systems = [];
    if (dateEnd >= ICD10_START) systems.push('icd10');
    if (dateStart < ICD10_START) systems.push('icd9');
    // If no dates result in anything, default to ICD-10
    if (systems.length === 0) systems.push('icd10');
    return systems;
  }

  function getMedicationSystems(beforeEpic, afterEpic, outpatient, inpatient) {
    const systems = [];
    if (afterEpic) {
      systems.push('epic');
    }
    if (beforeEpic && inpatient) {
      systems.push('meditech');
    }
    if (beforeEpic && outpatient) {
      systems.push('centricity');
    }
    // If nothing selected, default to Epic
    if (systems.length === 0) systems.push('epic');
    return systems;
  }

  function getLabSystems(beforeEpic, afterEpic) {
    const systems = [];
    if (afterEpic) systems.push('epic');
    if (beforeEpic) systems.push('meditech');
    if (systems.length === 0) systems.push('epic');
    return systems;
  }

  function getProcedureSystems(beforeEpic, afterEpic) {
    const systems = [];
    if (afterEpic)  systems.push('epic');
    if (beforeEpic) systems.push('gecb');
    if (systems.length === 0) systems.push('epic');
    return systems;
  }

  function getLocationSystems(beforeEpic, afterEpic, outpatient, inpatient) {
    const systems = [];
    if (afterEpic) {
      systems.push('epic');
    }
    if (beforeEpic && outpatient) {
      systems.push('gecb');
    }
    if (beforeEpic && inpatient) {
      systems.push('meditech');
    }
    if (systems.length === 0) systems.push('epic');
    return systems;
  }

  /**
   * Get display label for a system badge
   */
  function getSystemLabel(system) {
    const labels = {
      epic:       'Epic',
      meditech:   'Meditech',
      centricity: 'Centricity',
      gecb:       'GECB',
      icd10:      'ICD-10-CM',
      icd9:       'ICD-9-CM'
    };
    return labels[system] || system;
  }

  /**
   * Map system names to CSV filenames
   */
  function getSystemCsvFiles(type, systems) {
    const fileMap = {
      dx: {
        icd10: 'dictionary-dx.csv',
        icd9:  'dictionary-dx.csv'  // same file, filter by vocabulary_id
      },
      medication: {
        epic:       'dictionary-medication.csv',
        meditech:   'dictionary-medication.csv',
        centricity: 'dictionary-medication.csv'
      },
      lab: {
        epic:     'dictionary-lab.csv',
        meditech: 'dictionary-lab.csv'
      },
      location: {
        epic:     'dictionary-location-epic.csv',
        gecb:     'dictionary-location-gecb.csv',
        meditech: 'dictionary-location-meditech.csv'
      },
      procedure: {
        epic: 'dictionary-procedure.csv',
        gecb: 'dictionary-procedure.csv'
      }
    };

    const map = fileMap[type] || {};
    const files = new Set();
    systems.forEach(s => {
      if (map[s]) files.add(map[s]);
    });
    return Array.from(files);
  }

  return {
    getActiveSystems,
    getSystemLabel,
    getSystemCsvFiles,
    EPIC_GOLIVE,
    ICD10_START
  };
})();
