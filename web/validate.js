(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.Validate = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function validateReply(requirement, workbookRows, options = {}) {
    const rows = Array.isArray(workbookRows) ? workbookRows.map(asCells) : [];
    const title = rows[0] || [];
    const headers = (rows[1] || []).map((value) => String(value ?? "").trim());
    const findings = [];
    const dataRows = rows.slice(2).filter((row) => row.some(hasValue));

    if (!title.some(hasValue)) {
      findings.push(finding("요구 표시", 1, "1행 요구 표시가 비어 있습니다."));
    }
    if (!headers.some(Boolean)) {
      findings.push(finding("머리글", 2, "2행 머리글이 비어 있습니다."));
    }

    const yearIndex = findHeader(headers, /연도|년도/);
    const budgetIndex = findHeader(headers, /예산|예산액/);
    const expenseIndex = findHeader(headers, /집행액|집행금액/);
    const noteIndex = findHeader(headers, /비고|사유|특이사항/);
    const requestedYears = String(requirement || "").match(/최근\s*(\d+)\s*(?:개\s*)?년/);

    if (requestedYears) {
      const count = Number(requestedYears[1]);
      if (yearIndex < 0) {
        findings.push(finding("연도 누락", "전체", `최근 ${count}년 요구인데 2행 머리글에 연도 열이 없습니다.`));
      } else {
        const submitted = new Set(dataRows.map((row) => extractYear(row[yearIndex])).filter(Boolean));
        const currentYear = Number(options.currentYear) || new Date().getFullYear();
        const lastCompletedYear = currentYear - 1;
        const required = Array.from({ length: count }, (_, index) => String(lastCompletedYear - count + 1 + index));
        const missing = required.filter((year) => !submitted.has(year));
        if (missing.length) {
          findings.push(finding("연도 누락", "전체", `최근 ${count}년 기준(${required[0]}~${required[required.length - 1]}) 중 누락: ${missing.join(", ")}`));
        }
      }
    }

    if (budgetIndex >= 0 && expenseIndex >= 0) {
      dataRows.forEach((row, index) => {
        if (isTotalRow(row)) return;
        const budget = parseNumber(row[budgetIndex]);
        const expense = parseNumber(row[expenseIndex]);
        const note = noteIndex >= 0 ? String(row[noteIndex] ?? "").trim() : "";
        if (budget !== null && expense !== null && expense > budget && !note) {
          findings.push(finding("집행액>예산", index + 3, `집행액(${formatNumber(expense)})이 예산(${formatNumber(budget)})보다 크지만 비고가 없습니다.`));
        }
      });
    }

    const total = dataRows.find((row) => isTotalRow(row));
    if (total) {
      const numericColumns = headers
        .map((header, index) => ({ header, index }))
        .filter(({ header }) => /건수|인원|예산|집행액|집행금액|금액|수량/.test(normalizeHeader(header)));
      numericColumns.forEach(({ header, index }) => {
        const totalValue = parseNumber(total[index]);
        const detailValues = dataRows
          .filter((row) => !isTotalRow(row))
          .map((row) => parseNumber(row[index]))
          .filter((value) => value !== null);
        if (totalValue === null || !detailValues.length) return;
        const sum = detailValues.reduce((acc, value) => acc + value, 0);
        if (Math.abs(sum - totalValue) > 0.01) {
          findings.push(finding("합계 행 불일치", "합계", `${header}: 세부행 합계 ${formatNumber(sum)} · 합계행 ${formatNumber(totalValue)}`));
        }
      });
    }

    return {
      요구표시: title.filter(hasValue).map((value) => String(value).trim()).join(" "),
      머리글: headers,
      자료행수: dataRows.length,
      확인필요: findings,
    };
  }

  function validateIntake(rows, departments) {
    const allowed = new Set((departments || []).map((value) => String(value || "").trim()).filter(Boolean));
    const findings = [];
    const required = ["접수번호", "접수일", "위원회", "요구의원", "문항번호", "요구내용", "제출기한"];
    const seen = new Map();

    (Array.isArray(rows) ? rows : []).forEach((row, index) => {
      const line = index + 2;
      required.forEach((field) => {
        if (!String(row[field] ?? "").trim()) findings.push(finding("필수 값 공백", line, `${field} 값이 비어 있습니다.`));
      });

      const received = parseISODate(row.접수일);
      const dueText = String(row.제출기한 ?? "").trim();
      const due = parseISODate(dueText);
      if (dueText && due === null) {
        findings.push(finding("제출기한 형식", line, `제출기한 '${dueText}'은 YYYY-MM-DD 형식이 아닙니다.`));
      }
      if (received !== null && due !== null && due < received) {
        findings.push(finding("기한 역전", line, `제출기한 ${dueText}이 접수일 ${String(row.접수일).trim()}보다 빠릅니다.`));
      }

      const start = parsePeriod(row.요구기간_시작);
      const end = parsePeriod(row.요구기간_끝);
      if (start !== null && end !== null && start > end) {
        findings.push(finding("기간 역전", line, `요구기간 시작(${row.요구기간_시작})이 끝(${row.요구기간_끝})보다 늦습니다.`));
      }

      const allocation = String(row.배분과 ?? "").trim();
      const allocationType = String(row.배분구분 ?? "").trim();
      if (allocation && !allowed.has(allocation)) {
        findings.push(finding("조직도 밖 과", line, `배분과 '${allocation}'이 조직도 26개 과에 없습니다.`));
      } else if (!allocation && allocationType && allocationType !== "공통") {
        findings.push(finding("필수 값 공백", line, "배분과 값이 비어 있습니다."));
      }

      const receiptNo = String(row.접수번호 ?? "").trim();
      const questionNo = String(row.문항번호 ?? "").trim();
      if (receiptNo && questionNo) {
        const key = `${receiptNo}\u0000${questionNo}`;
        if (seen.has(key)) {
          findings.push(finding("중복 접수", line, `접수번호 ${receiptNo} · 문항번호 ${questionNo} 조합이 ${seen.get(key)}행과 중복됩니다.`));
        } else {
          seen.set(key, line);
        }
      }
    });

    return {
      전체건수: Array.isArray(rows) ? rows.length : 0,
      확인필요: findings,
    };
  }

  function asCells(row) {
    if (Array.isArray(row)) return row;
    if (row && typeof row === "object") return Object.values(row);
    return [row ?? ""];
  }

  function findHeader(headers, pattern) {
    return headers.findIndex((header) => pattern.test(normalizeHeader(header)));
  }

  function normalizeHeader(value) {
    return String(value ?? "").replace(/\s+/g, "").toLowerCase();
  }

  function hasValue(value) {
    return String(value ?? "").trim() !== "";
  }

  function extractYear(value) {
    const match = String(value ?? "").match(/(?:19|20)\d{2}/);
    return match ? match[0] : "";
  }

  function parseNumber(value) {
    let text = String(value ?? "").trim();
    if (!text || text === "-" || text === "—") return null;
    const negative = /^\(.*\)$/.test(text);
    text = text.replace(/[(),₩원\s]/g, "");
    if (!/^-?\d+(?:\.\d+)?$/.test(text)) return null;
    const number = Number(text);
    if (!Number.isFinite(number)) return null;
    return negative ? -Math.abs(number) : number;
  }

  function isTotalRow(row) {
    return row.some((cell) => /합계|총계/.test(String(cell ?? "")));
  }

  function parseISODate(value) {
    const text = String(value ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
    const date = new Date(`${text}T00:00:00.000Z`);
    return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text ? null : date.getTime();
  }

  function parsePeriod(value) {
    const text = String(value ?? "").trim();
    const match = text.match(/^(\d{4})(?:[-./](\d{1,2})(?:[-./](\d{1,2}))?)?$/);
    if (!match) return null;
    return Number(match[1]) * 10000 + Number(match[2] || 0) * 100 + Number(match[3] || 0);
  }

  function finding(항목, 행, 내용) {
    return { 항목, 행, 내용 };
  }

  function formatNumber(value) {
    return Number(value).toLocaleString("ko-KR", { maximumFractionDigits: 2 });
  }

  return { validateReply, validateIntake, parseNumber, parsePeriod };
});
