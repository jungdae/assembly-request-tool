const fs = require("fs");
const path = require("path");

const inputPath = path.join(__dirname, "data", "A부_조직도_26개과.csv");
const outputPath = path.join(__dirname, "org.json");

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

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

const csv = fs.readFileSync(inputPath, "utf8").replace(/^\uFEFF/, "");
const rows = parseCsv(csv);
const headers = rows[0];

const columnIndex = {
  실국: headers.indexOf("실국"),
  과: headers.indexOf("과"),
  대표키워드: headers.indexOf("대표키워드"),
};

for (const [name, index] of Object.entries(columnIndex)) {
  if (index === -1) {
    throw new Error(`CSV에서 '${name}' 열을 찾지 못했습니다.`);
  }
}

const org = rows.slice(1).map((row) => ({
  실국: row[columnIndex.실국].trim(),
  과: row[columnIndex.과].trim(),
  대표키워드: row[columnIndex.대표키워드]
    .split("|")
    .map((keyword) => keyword.trim())
    .filter(Boolean),
}));

fs.writeFileSync(outputPath, `${JSON.stringify(org, null, 2)}\n`, "utf8");

console.log(`원소 수: ${org.length}`);
console.log("첫 원소:");
console.log(JSON.stringify(org[0], null, 2));
