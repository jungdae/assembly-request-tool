const fs = require("fs");
const path = require("path");
const engine = require("./web/engine.js");

const testPath = path.join(__dirname, "data", "시험_요구문항_40건.csv");
const testCsv = fs.readFileSync(testPath, "utf8");
const testRows = engine.parseCsv(testCsv);
const [headers, ...rows] = testRows;

function toObject(row) {
  const object = {};
  headers.forEach((header, index) => {
    object[header] = row[index] || "";
  });
  return object;
}

const wrong = [];
let top1 = 0;
let top3 = 0;

for (const row of rows.map(toObject)) {
  const candidates = engine.classify(row["요구내용"]);
  const departments = candidates.map((candidate) => candidate.과);
  const answer = row["정답_배분과"];

  if (departments[0] === answer) {
    top1 += 1;
  } else {
    wrong.push({
      시험번호: row["시험번호"],
      요구내용: row["요구내용"],
      정답: answer,
      "엔진 결과": departments.length ? departments.join(" > ") : "후보 없음",
    });
  }

  if (departments.includes(answer)) {
    top3 += 1;
  }
}

console.log(`1순위 정답 ${top1}/${rows.length} · 3순위 안 ${top3}/${rows.length}`);
console.log();
console.log("틀린 문항 표");
console.log("시험번호 | 요구내용 | 정답 | 엔진 결과");
for (const row of wrong) {
  console.log(`${row.시험번호} | ${row.요구내용} | ${row.정답} | ${row["엔진 결과"]}`);
}
