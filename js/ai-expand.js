// ============================================================================
// ai-expand.js
// Claude API integration for natural language keyword expansion
// Calls a Cloudflare Worker proxy that holds the ANTHROPIC_API_KEY
// ============================================================================

const AiExpand = (function () {

  // Configurable worker URL - set this to your deployed Cloudflare Worker
  let WORKER_URL = '';

  // Alternatively, allow direct API key for development/testing
  let API_KEY = '';

  // User email for allowlist verification (sent to worker)
  let USER_EMAIL = '';

  /**
   * Configure the AI expand module
   * @param {Object} config
   * @param {string} config.workerUrl - Cloudflare Worker URL
   * @param {string} config.apiKey - Direct API key (dev only)
   * @param {string} config.email - User email for worker auth
   */
  function configure(config) {
    if (config.workerUrl) WORKER_URL = config.workerUrl;
    if (config.apiKey) API_KEY = config.apiKey;
    if (config.email) USER_EMAIL = config.email;
  }

  /**
   * Check if AI expand is available
   */
  function isAvailable() {
    return !!(WORKER_URL || API_KEY);
  }

  /**
   * Get the system prompt for a specific dictionary type
   */
  function getSystemPrompt(type) {
    const baseRules = `You are a clinical research assistant helping researchers find entries in a clinical data warehouse dictionary.

CRITICAL RULES:
- Return ONLY a valid JSON array. No markdown, no explanation, no code fences.
- Each element must be: {"keyword": "term", "category": "group"}
- Keywords should be lowercase search terms that will be matched using LIKE (substring matching)
- Be EXHAUSTIVE - missing a term means the researcher misses data
- Do NOT include codes (ICD, LOINC, RxNorm, NDC) - only searchable text names
- Include common abbreviations and alternate spellings`;

    const typeSpecific = {
      dx: `
You are generating diagnosis search keywords.
- Include the full disease name AND common abbreviations
- Include related conditions and subtypes
- For cancer: include organ-specific terms, staging terms, histology types
- For chronic diseases: include all stages and complications
- Example: "type 2 diabetes" should return: diabetes, diabetic, dm2, hyperglycemia, insulin resistance, etc.`,

      medication: `
You are generating medication search keywords.
- Include ALL generic names (INN/USAN)
- Include ALL brand names (US market, past and present)
- Include drug class terms
- Include combination product names
- For each drug: include oral, injectable, and topical forms if applicable
- Example: "GLP-1 receptor agonists" should return: semaglutide, ozempic, wegovy, rybelsus, liraglutide, victoza, saxenda, dulaglutide, trulicity, exenatide, byetta, bydureon, tirzepatide, mounjaro, zepbound, lixisenatide, adlyxin, etc.`,

      lab: `
You are generating lab test search keywords.
- Include panel names AND individual analyte names
- Include common abbreviations (CBC, CMP, BMP, etc.)
- Include the full analyte name AND abbreviation
- Example: "CBC" should return: white blood cell, wbc, red blood cell, rbc, hemoglobin, hgb, hematocrit, hct, platelet, plt, mcv, mch, mchc, rdw, neutrophil, lymphocyte, monocyte, eosinophil, basophil, etc.
- Example: "renal function" should return: creatinine, bun, urea nitrogen, gfr, glomerular, cystatin, albumin creatinine, microalbumin, etc.`,

      location: `
You are generating clinical location/department search keywords.
- Include department names, specialty names, and unit types
- Include common abbreviations (ICU, NICU, PICU, ED, OR, etc.)
- Include both formal and informal names
- Example: "cardiology" should return: cardiology, cardiac, heart, cardiovascular, cath lab, electrophysiology, echo, etc.`
    };

    return baseRules + (typeSpecific[type] || '');
  }

  /**
   * Call Claude API to expand a natural language query into keywords
   * @param {string} type - Dictionary type
   * @param {string} userInput - Natural language description
   * @returns {Promise<Array<{keyword: string, category: string}>>}
   */
  async function expandKeywords(type, userInput) {
    if (!isAvailable()) {
      throw new Error('AI not configured. Set a Worker URL or API key in Settings.');
    }

    const systemPrompt = getSystemPrompt(type);
    const userPrompt = `Generate a comprehensive list of search keywords for finding the following in a clinical data warehouse:\n\n"${userInput}"\n\nReturn ONLY a JSON array of {"keyword": "...", "category": "..."} objects.`;

    let response;

    if (WORKER_URL) {
      // Use Cloudflare Worker proxy (email required for allowlist)
      if (!USER_EMAIL) {
        throw new Error('Email required. Enter your OU email in Settings to use AI Expand via the team proxy.');
      }
      response = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: userPrompt,
          type: type,
          system: systemPrompt,
          email: USER_EMAIL
        })
      });
    } else if (API_KEY) {
      // Direct API call (development only)
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 2048,
          temperature: 0.1,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }]
        })
      });
    }

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`API error (${response.status}): ${errText}`);
    }

    const data = await response.json();

    // Extract text from Claude's response
    let text;
    if (data.content && data.content[0] && data.content[0].text) {
      // Direct API response format
      text = data.content[0].text;
    } else if (data.text) {
      // Worker might simplify the response
      text = data.text;
    } else if (typeof data === 'string') {
      text = data;
    } else {
      text = JSON.stringify(data);
    }

    // Strip any markdown code fences
    text = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

    // Parse JSON
    let keywords;
    try {
      keywords = JSON.parse(text);
    } catch (e) {
      // Try to extract JSON array from the text
      const match = text.match(/\[[\s\S]*\]/);
      if (match) {
        keywords = JSON.parse(match[0]);
      } else {
        throw new Error('Could not parse AI response as JSON');
      }
    }

    if (!Array.isArray(keywords)) {
      throw new Error('AI response is not an array');
    }

    // Validate and clean
    return keywords
      .filter(k => k && k.keyword && typeof k.keyword === 'string')
      .map(k => ({
        keyword: k.keyword.trim().toLowerCase(),
        category: (k.category || '').trim()
      }));
  }

  return {
    configure,
    isAvailable,
    expandKeywords
  };
})();
