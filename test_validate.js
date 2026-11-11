"use strict";

const Validate = require("./web/validate.js");
const Flow = require("./web/flow.js");
const org = require("./api/org.json");

const tests = [];

function test(name, run) {
  tests.push({ name, run });
}

test("최근 n년 중 누락 연도 표시", () => {
  const result = Validate.validateReply("최근 3년 실적", [
    ["의원K 자료요구 1번"],
    ["연도", "예산(천원)", "집행액(천원)", "비고"],
    ["2023", "100", "90", ""],
    ["2025", "100", "90", ""],
  ], { currentYear: 2026 });
  return result.확인필요.some((issue) => issue.항목 === "연도 누락" && issue.내용.includes("2024"));
});

test("집행액이 예산보다 크고 비고 없음", () => {
  const result = Validate.validateReply("사업 집행 현황", [
    ["사업 현황"],
    ["항목명", "예산(천원)", "집행액(천원)", "비고"],
    ["사업 A", "1,000", "1,200", ""],
  ]);
  return result.확인필요.some((issue) => issue.항목 === "집행액>예산");
});

test("합계 행 불일치", () => {
  const result = Validate.validateReply("사업 집행 현황", [
    ["사업 현황"],
    ["항목명", "건수", "예산(천원)"],
    ["사업 A", "2", "100"],
    ["사업 B", "3", "200"],
    ["합계", "6", "300"],
  ]);
  return result.확인필요.some((issue) => issue.항목 === "합계 행 불일치" && issue.내용.startsWith("건수"));
});

test("검증용 접수대장 검사 항목", () => {
  const rows = [
    {
      접수번호: "R-1", 접수일: "2026-10-10", 위원회: "위원회", 요구의원: "의원A", 문항번호: "1",
      요구내용: "요구", 제출기한: "2026/10/09", 요구기간_시작: "2025", 요구기간_끝: "2023", 배분구분: "소관", 배분과: "없는과",
    },
    {
      접수번호: "R-1", 접수일: "2026-10-10", 위원회: "위원회", 요구의원: "의원A", 문항번호: "1",
      요구내용: "", 제출기한: "2026-10-12", 요구기간_시작: "2023", 요구기간_끝: "2025", 배분구분: "소관", 배분과: "디지털정책과",
    },
  ];
  const result = Validate.validateIntake(rows, org.map((row) => row.과));
  const categories = new Set(result.확인필요.map((issue) => issue.항목));
  return ["제출기한 형식", "기간 역전", "조직도 밖 과", "중복 접수", "필수 값 공백"].every((name) => categories.has(name));
});

test("보완요청 후 대상 과만 재회신하고 확정", () => {
  const item = {
    id: "case-1",
    상태: "회신완료",
    주관과: "디지털정책과",
    협조과: ["운영지원과"],
    과별회신: {
      디지털정책과: { 파일명: "a.xlsx", 행: [], 메모: "", 확인필요: [] },
      운영지원과: { 파일명: "b.xlsx", 행: [], 메모: "", 확인필요: [] },
    },
  };
  const requested = Flow.apply([item], {
    작업: "보완요청", id: item.id, 과: "운영지원과", 사유: "연도별 표를 보완해 주세요.",
  }, org);
  let forbiddenStatus = 0;
  try {
    Flow.apply(requested.db, { 작업: "회신", id: item.id, 과: "디지털정책과", 파일명: "a2.xlsx" }, org);
  } catch (error) {
    forbiddenStatus = error.status;
  }
  const replied = Flow.apply(requested.db, {
    작업: "회신", id: item.id, 과: "운영지원과", 파일명: "b2.xlsx", 행: [], 확인필요: [],
  }, org);
  const finalized = Flow.apply(replied.db, {
    작업: "확정", id: item.id, 확정코멘트: "회신 자료를 확인했습니다.",
  }, org);
  return requested.상태 === "보완요청" && forbiddenStatus === 403 && replied.상태 === "회신완료" && finalized.상태 === "확정";
});

test("순서 오류와 필수 사유·코멘트 거부", () => {
  const item = { id: "case-2", 상태: "회신중", 주관과: "디지털정책과", 협조과: [], 과별회신: {} };
  let outOfOrder = 0;
  let missingReason = 0;
  let missingComment = 0;
  try { Flow.apply([item], { 작업: "확정", id: item.id, 확정코멘트: "확인" }, org); } catch (error) { outOfOrder = error.status; }
  try { Flow.apply([{ ...item, 상태: "회신완료" }], { 작업: "보완요청", id: item.id, 과: "디지털정책과" }, org); } catch (error) { missingReason = error.status; }
  try { Flow.apply([{ ...item, 상태: "회신완료" }], { 작업: "확정", id: item.id }, org); } catch (error) { missingComment = error.status; }
  return outOfOrder === 409 && missingReason === 400 && missingComment === 400;
});

const results = tests.map(({ name, run }) => {
  let passed = false;
  let error = "";
  try { passed = Boolean(run()); } catch (caught) { error = caught.message; }
  return { 시험: name, 결과: passed ? "O" : "X", 오류: error };
});

console.table(results);
if (results.some((result) => result.결과 !== "O")) process.exitCode = 1;
