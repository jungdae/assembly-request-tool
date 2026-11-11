(function (root) {
  "use strict";

  const STORAGE_KEY = "assembly.assign.cases.v1";
  const API_PATH = "/api/app";

  function parseCsv(text) {
    const source = String(text || "").replace(/^\uFEFF/, "");
    if (root.Papa && typeof root.Papa.parse === "function") {
      const result = root.Papa.parse(source, { skipEmptyLines: true });
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

  async function readWorkbook(file) {
    if (!root.XLSX || typeof root.XLSX.read !== "function") {
      throw new Error("엑셀 파일을 읽으려면 SheetJS(xlsx.full.min.js)가 필요합니다.");
    }
    return root.XLSX.read(await file.arrayBuffer(), { type: "array" });
  }

  function isApiMode() {
    return /\.vercel\.app$/i.test(root.location && root.location.hostname ? root.location.hostname : "");
  }

  function storageLabel() {
    return isApiMode() ? "서버 저장: /api/app · Vercel Blob cases.json" : "브라우저 저장: 이 PC localStorage";
  }

  function showStorageMode() {
    const target = document.querySelector("[data-storage-mode]");
    if (target) target.textContent = storageLabel();
  }

  function readLocalCases() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    } catch {
      return [];
    }
  }

  function writeLocalCases(cases) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cases, null, 2));
  }

  async function readCases() {
    showStorageMode();
    if (!isApiMode()) return readLocalCases();
    const response = await fetch(API_PATH, { cache: "no-store" });
    if (!response.ok) throw new Error(`서버 기록 읽기 실패: ${response.status}`);
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  }

  async function writeCases(cases) {
    showStorageMode();
    if (isApiMode()) throw new Error("서버 저장은 상태 변경 요청으로만 할 수 있습니다.");
    writeLocalCases(cases);
    return cases;
  }

  async function clearCases() {
    if (isApiMode()) throw new Error("서버 저장은 화면에서 전체 삭제하지 않습니다.");
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
      과별회신: row.과별회신 && typeof row.과별회신 === "object" ? row.과별회신 : {},
      재배정: row.재배정 && typeof row.재배정 === "object" ? row.재배정 : {},
      보완: row.보완 && typeof row.보완 === "object" ? row.보완 : {},
      확정코멘트: row.확정코멘트 || "",
      일시: row.일시 || "",
      기록: Array.isArray(row.기록) ? row.기록 : [],
    };
    return base;
  }

  async function mergeCases(nextRows) {
    const cases = await readCases();
    const byId = new Map(cases.map((item) => [item.id, item]));
    for (const row of nextRows.map(normalizeQuestion)) {
      const previous = byId.get(row.id);
      byId.set(row.id, previous ? { ...row, ...previous, 후보: previous.후보 || row.후보 } : row);
    }
    const next = Array.from(byId.values());
    await writeCases(next);
    return next;
  }

  async function applyRequest(request, org) {
    showStorageMode();
    if (isApiMode()) {
      const response = await fetch(API_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `서버 요청 실패: ${response.status}`);
      return data;
    }
    if (!root.Flow || typeof root.Flow.apply !== "function") {
      throw new Error("상태 변경에는 flow.js가 필요합니다.");
    }
    const applied = root.Flow.apply(readLocalCases(), request, org);
    writeLocalCases(applied.db);
    return { ok: true, 상태: applied.상태, case: applied.case, cases: applied.db };
  }

  async function loadHistory() {
    try {
      return await loadCsv("data/접수대장.csv");
    } catch {
      return [];
    }
  }

  function historyFor(item, rows) {
    const keyword = item && item.후보 && item.후보[0] ? String(item.후보[0].근거키워드 || "").trim() : "";
    if (!keyword) return { keyword: "", count: 0, mainDept: "", recent: [] };
    const matched = (rows || []).filter((row) => String(row.요구내용 || "").includes(keyword));
    const counts = new Map();
    matched.forEach((row) => {
      const dept = String(row.배분과 || "").trim();
      if (dept) counts.set(dept, (counts.get(dept) || 0) + 1);
    });
    const mainDept = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
    const recent = matched
      .slice()
      .sort((a, b) => String(b.접수일 || "").localeCompare(String(a.접수일 || "")))
      .slice(0, 5);
    return { keyword, count: matched.length, mainDept, recent };
  }

  function renderHistory(history) {
    if (!history || !history.keyword) return '<span class="muted">과거 이력 없음</span>';
    const summary = `${history.count}건 · 주로 ${history.mainDept || "확인필요"}`;
    const recent = history.recent.length
      ? `<ul class="history-list">${history.recent.map((row) => `<li>${escapeHtml(row.접수일)} · ${escapeHtml(row.배분과)} · ${escapeHtml(row.요구내용)}</li>`).join("")}</ul>`
      : "";
    return `<div><strong>${escapeHtml(summary)}</strong><div class="small">근거 키워드: ${escapeHtml(history.keyword)}</div>${recent}</div>`;
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
    API_PATH,
    parseCsv,
    rowsToObjects,
    loadText,
    loadCsv,
    readWorkbook,
    isApiMode,
    storageLabel,
    showStorageMode,
    readLocalCases,
    readCases,
    writeCases,
    clearCases,
    mergeCases,
    applyRequest,
    loadHistory,
    historyFor,
    renderHistory,
    normalizeQuestion,
    makeCaseId,
    setStatus,
    formatCandidate,
    escapeHtml,
    todayStamp,
  };
})(typeof self !== "undefined" ? self : this);
