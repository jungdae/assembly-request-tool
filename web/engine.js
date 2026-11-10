(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.AssignEngine = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const state = {
    rules: [],
    departments: new Set(),
  };

  function parseCsv(text) {
    const source = String(text || "").replace(/^\uFEFF/, "");
    const papa = typeof globalThis !== "undefined" ? globalThis.Papa : null;
    if (papa && typeof papa.parse === "function") {
      const result = papa.parse(source, { skipEmptyLines: true });
      if (result.errors && result.errors.length) {
        throw new Error(`CSV 읽기 실패: ${result.errors[0].message}`);
      }
      return result.data;
    }

    const rows = [];
    let row = [];
    let cell = "";
    let inQuotes = false;

    for (let i = 0; i < source.length; i += 1) {
      const char = source[i];
      const next = source[i + 1];

      if (char === '"') {
        if (inQuotes && next === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }

      if (char === "," && !inQuotes) {
        row.push(cell);
        cell = "";
        continue;
      }

      if ((char === "\n" || char === "\r") && !inQuotes) {
        if (char === "\r" && next === "\n") {
          i += 1;
        }
        row.push(cell);
        if (row.some((value) => value.length > 0)) {
          rows.push(row);
        }
        row = [];
        cell = "";
        continue;
      }

      cell += char;
    }

    if (cell.length > 0 || row.length > 0) {
      row.push(cell);
      if (row.some((value) => value.length > 0)) {
        rows.push(row);
      }
    }

    return rows;
  }

  function rowsToObjects(rows) {
    const headers = rows[0] || [];
    return rows.slice(1).map((row) => {
      const object = {};
      headers.forEach((header, index) => {
        object[header] = row[index] || "";
      });
      return object;
    });
  }

  function splitWords(value) {
    const text = String(value || "").trim();
    if (!text || text === "-") {
      return [];
    }
    return text
      .split("|")
      .map((word) => word.trim())
      .filter(Boolean);
  }

  function normalize(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/\s+/g, "");
  }

  function contains(text, keyword) {
    return normalize(text).includes(normalize(keyword));
  }

  function loadFromText(rulesCsv, orgCsv) {
    const orgRows = rowsToObjects(parseCsv(orgCsv));
    const departments = new Set(orgRows.map((row) => row["과"].trim()).filter(Boolean));

    const rules = rowsToObjects(parseCsv(rulesCsv))
      .map((row, index) => ({
        order: index,
        과: row["과"].trim(),
        키워드: row["키워드"].trim(),
        제외어: splitWords(row["제외어"]),
        우선순위: Number(row["우선순위"] || 0),
      }))
      .filter((rule) => departments.has(rule.과) && rule.키워드);

    state.departments = departments;
    state.rules = rules;
    return api;
  }

  async function loadFromUrls(
    rulesUrl = "../data/배분기준표_소관키워드_304건.csv",
    orgUrl = "../data/A부_조직도_26개과.csv"
  ) {
    if (typeof fetch !== "function") {
      throw new Error("이 환경에서는 fetch를 사용할 수 없습니다.");
    }
    const [rulesResponse, orgResponse] = await Promise.all([fetch(rulesUrl), fetch(orgUrl)]);
    if (!rulesResponse.ok) {
      throw new Error(`배분기준표를 읽지 못했습니다: ${rulesResponse.status}`);
    }
    if (!orgResponse.ok) {
      throw new Error(`조직도를 읽지 못했습니다: ${orgResponse.status}`);
    }
    return loadFromText(await rulesResponse.text(), await orgResponse.text());
  }

  function loadFromFiles(rulesPath, orgPath) {
    if (typeof require !== "function") {
      throw new Error("파일 로드는 Node 환경에서만 사용할 수 있습니다.");
    }
    const fs = require("fs");
    return loadFromText(fs.readFileSync(rulesPath, "utf8"), fs.readFileSync(orgPath, "utf8"));
  }

  function classify(요구내용) {
    const bestByDepartment = new Map();

    for (const rule of state.rules) {
      if (!contains(요구내용, rule.키워드)) {
        continue;
      }
      if (rule.제외어.some((word) => contains(요구내용, word))) {
        continue;
      }

      const score = rule.우선순위 + rule.키워드.length / 10;
      const current = bestByDepartment.get(rule.과);
      if (
        !current ||
        score > current.점수 ||
        (score === current.점수 && rule.키워드.length > current.근거키워드.length)
      ) {
        bestByDepartment.set(rule.과, {
          과: rule.과,
          점수: Number(score.toFixed(2)),
          근거키워드: rule.키워드,
          _order: rule.order,
        });
      }
    }

    return Array.from(bestByDepartment.values())
      .sort((a, b) => b.점수 - a.점수 || a._order - b._order || a.과.localeCompare(b.과, "ko"))
      .slice(0, 3)
      .map(({ 과, 점수, 근거키워드 }) => ({ 과, 점수, 근거키워드 }));
  }

  const api = {
    classify,
    loadFromText,
    loadFromUrls,
    loadFromFiles,
    parseCsv,
  };

  if (typeof module === "object" && module.exports) {
    try {
      const path = require("path");
      loadFromFiles(
        path.join(__dirname, "..", "data", "배분기준표_소관키워드_304건.csv"),
        path.join(__dirname, "..", "data", "A부_조직도_26개과.csv")
      );
    } catch (error) {
      // 테스트나 브라우저 번들 과정에서는 명시적으로 loadFromText/loadFromFiles를 호출할 수 있다.
    }
  }

  return api;
});
