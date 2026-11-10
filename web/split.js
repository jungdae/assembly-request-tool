(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.QuestionSplit = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const HEADERS = ["파일명", "위원회", "의원", "제출기한", "문항번호", "요구내용", "세부항목", "비고"];

  function normalizeLine(line) {
    return String(line || "").replace(/\s+/g, " ").trim();
  }

  function appendText(current, text, separator = "\n") {
    const value = String(text || "").trim();
    if (!value) return current || "";
    if (!current) return value;
    return `${current}${separator}${value}`;
  }

  function parseHeader(line) {
    const match = normalizeLine(line).match(/^(.+?)\s+(.+?)\s+의원실\s+자료요구서$/);
    if (!match) {
      throw new Error(`첫 줄 형식이 맞지 않습니다: ${line}`);
    }
    return { 위원회: match[1], 의원: match[2] };
  }

  function parseDeadline(line) {
    const match = normalizeLine(line).match(/제출기한:\s*(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\./);
    if (!match) {
      throw new Error(`제출기한을 찾지 못했습니다: ${line}`);
    }
    return `${match[1]}-${String(Number(match[2])).padStart(2, "0")}-${String(Number(match[3])).padStart(2, "0")}`;
  }

  function finishItem(item, rows) {
    if (!item) return;
    rows.push(item);
  }

  function splitText(text, fileName = "") {
    const lines = String(text || "")
      .split(/\r?\n/)
      .map(normalizeLine)
      .filter(Boolean);

    if (lines.length < 2) {
      throw new Error(`${fileName || "문서"}의 내용 줄이 부족합니다.`);
    }

    const header = parseHeader(lines[0]);
    const deadline = parseDeadline(lines[1]);
    const rows = [];
    let current = null;
    let lastField = "요구내용";

    for (const line of lines.slice(2)) {
      if (line.startsWith("수신:") || line.startsWith("담당 보좌관:") || line === "끝.") {
        continue;
      }

      const numberMatch = line.match(/^(\d+)\.\s*(.*)$/);
      const detailMatch = line.match(/^([가나])\.\s*(.*)$/);

      if (numberMatch) {
        finishItem(current, rows);
        current = {
          파일명: fileName,
          위원회: header.위원회,
          의원: header.의원,
          제출기한: deadline,
          문항번호: numberMatch[1],
          요구내용: numberMatch[2].trim(),
          세부항목: "",
          비고: "",
        };
        lastField = "요구내용";
        continue;
      }

      if (!current) continue;

      if (detailMatch) {
        current.세부항목 = appendText(
          current.세부항목,
          `${detailMatch[1]}. ${detailMatch[2].trim()}`,
          " / "
        );
        lastField = "세부항목";
        continue;
      }

      if (line.startsWith("※")) {
        current.비고 = appendText(current.비고, line.replace(/^※\s*/, ""), " / ");
        lastField = "비고";
        continue;
      }

      current[lastField] = appendText(current[lastField], line, lastField === "세부항목" || lastField === "비고" ? " / " : "\n");
    }

    finishItem(current, rows);
    return rows;
  }

  function expectedCountFromFileName(fileName) {
    const match = String(fileName || "").match(/_(\d+)문항\.pdf$/);
    return match ? Number(match[1]) : null;
  }

  function summarize(rows) {
    const grouped = new Map();
    for (const row of rows) {
      if (!grouped.has(row.파일명)) grouped.set(row.파일명, []);
      grouped.get(row.파일명).push(row);
    }
    return Array.from(grouped, ([fileName, items]) => {
      const numbers = items.map((row) => Number(row.문항번호));
      const expected = expectedCountFromFileName(fileName);
      const last = numbers.length ? numbers[numbers.length - 1] : 0;
      const continuous = numbers.every((number, index) => number === index + 1);
      const matched = expected === items.length && expected === last && continuous;
      return {
        파일명: fileName,
        "파일명의 문항 수": expected || "",
        "뽑은 문항 수": items.length,
        "마지막 번호": last || "",
        "번호 연속": continuous ? "O" : "X",
        "일치": matched ? "O" : "X",
      };
    });
  }

  return {
    HEADERS,
    splitText,
    summarize,
    expectedCountFromFileName,
  };
});
