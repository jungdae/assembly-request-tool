(function (root) {
  "use strict";

  const STORAGE_KEY = "assembly.assign.cases.v1";

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let inQuotes = false;
    const source = String(text || "").replace(/^\uFEFF/, "");

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
        if (char === "\r" && next === "\n") i += 1;
        row.push(cell);
        if (row.some((value) => value.length > 0)) rows.push(row);
        row = [];
        cell = "";
        continue;
      }
      cell += char;
    }
    if (cell.length > 0 || row.length > 0) {
      row.push(cell);
      if (row.some((value) => value.length > 0)) rows.push(row);
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

  async function loadText(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url} 읽기 실패: ${response.status}`);
    return response.text();
  }

  async function loadCsv(url) {
    return rowsToObjects(parseCsv(await loadText(url)));
  }

  function readCases() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    } catch {
      return [];
    }
  }

  function writeCases(cases) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cases, null, 2));
  }

  function clearCases() {
    localStorage.removeItem(STORAGE_KEY);
  }

  function makeCaseId(row) {
    return `${row.파일명 || "문항"}::${row.의원 || ""}::${row.문항번호 || ""}`;
  }

  function normalizeQuestion(row) {
    const base = {
      id: row.id || makeCaseId(row),
      파일명: row.파일명 || "",
      위원회: row.위원회 || "",
      의원: row.의원 || "",
      제출기한: row.제출기한 || "",
      문항번호: row.문항번호 || "",
      요구내용: row.요구내용 || "",
      세부항목: row.세부항목 || "",
      비고: row.비고 || "",
      상태: row.상태 || "접수",
      후보: Array.isArray(row.후보) ? row.후보 : [],
      주관과: row.주관과 || "",
      협조과: Array.isArray(row.협조과) ? row.협조과 : [],
      확정방법: row.확정방법 || "",
      기록: Array.isArray(row.기록) ? row.기록 : [],
    };
    return base;
  }

  function mergeCases(nextRows) {
    const cases = readCases();
    const byId = new Map(cases.map((item) => [item.id, item]));
    for (const row of nextRows.map(normalizeQuestion)) {
      const previous = byId.get(row.id);
      byId.set(row.id, previous ? { ...row, ...previous, 후보: previous.후보 || row.후보 } : row);
    }
    const next = Array.from(byId.values());
    writeCases(next);
    return next;
  }

  function setStatus(message, tone = "info") {
    const target = document.querySelector("[data-status]");
    if (!target) return;
    target.textContent = message || "";
    target.dataset.tone = tone;
  }

  function formatCandidate(candidate) {
    if (!candidate) return "";
    return `${candidate.과} (${candidate.점수}, ${candidate.근거키워드})`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function todayStamp() {
    return new Date().toISOString();
  }

  root.Common = {
    STORAGE_KEY,
    parseCsv,
    rowsToObjects,
    loadText,
    loadCsv,
    readCases,
    writeCases,
    clearCases,
    mergeCases,
    normalizeQuestion,
    makeCaseId,
    setStatus,
    formatCandidate,
    escapeHtml,
    todayStamp,
  };
})(typeof self !== "undefined" ? self : this);
