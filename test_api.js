"use strict";

const app = require("./api/app.js");
const org = require("./api/org.json");

function createMemoryStore(initial = []) {
  let cases = initial;
  return {
    async read() {
      return JSON.parse(JSON.stringify(cases));
    },
    async write(next) {
      cases = JSON.parse(JSON.stringify(next));
    },
    snapshot() {
      return JSON.parse(JSON.stringify(cases));
    },
  };
}

function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    payload: "",
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(value) {
      this.payload = value || "";
    },
  };
}

async function call(handler, method, body) {
  const req = { method, body };
  const res = createResponse();
  await handler(req, res);
  return {
    status: res.statusCode,
    body: res.payload ? JSON.parse(res.payload) : null,
  };
}

function pass(actual, expectedStatus, expectedState) {
  if (actual.status !== expectedStatus) return false;
  if (expectedState && (!actual.body || actual.body.상태 !== expectedState)) return false;
  return true;
}

async function main() {
  const store = createMemoryStore();
  const fakeOpenAI = createFakeOpenAI([
    {
      후보: [
        { 과: "디지털정책과", 근거: "디지털전환 사업 소관입니다." },
        { 과: "없는과", 근거: "목록 밖 과라 제거되어야 합니다." },
        { 과: "정보화담당관", 근거: "정보화 시스템과 관련됩니다." },
      ],
      해당없음: false,
    },
    {
      후보: [],
      해당없음: true,
    },
  ]);
  const handler = app.createHandler({ store, orgData: org, openaiClient: fakeOpenAI });
  const id = "테스트.pdf::김테스트::1";

  const tests = [
    {
      이름: "GET 전체 조회",
      기대: "200",
      실행: () => call(handler, "GET"),
      확인: (result) => result.status === 200 && Array.isArray(result.body) && result.body.length === 0,
    },
    {
      이름: "AI추천 목록 밖 과 제거",
      기대: "200 후보 2",
      실행: () => call(handler, "POST", {
        작업: "AI추천",
        요구내용: "최근 3년간 디지털전환 시스템 개선 현황",
      }),
      확인: (result) => (
        result.status === 200 &&
        result.body.후보.length === 2 &&
        result.body.후보[0].과 === "디지털정책과" &&
        result.body.후보.every((item) => item.과 !== "없는과") &&
        fakeOpenAI.lastPayload.model === "gpt-4o-mini" &&
        fakeOpenAI.lastPayload.temperature === 0 &&
        fakeOpenAI.lastPayload.response_format.type === "json_object"
      ),
    },
    {
      이름: "AI추천 해당없음",
      기대: "200 해당없음",
      실행: () => call(handler, "POST", {
        작업: "AI추천",
        요구내용: "조직도에 없는 매우 특수한 요구",
      }),
      확인: (result) => result.status === 200 && result.body.해당없음 === true && result.body.후보.length === 0,
    },
    {
      이름: "AI추천 키 없음",
      기대: "500",
      실행: () => call(app.createHandler({
        store,
        orgData: org,
        openaiClient: app.createOpenAIClient({ apiKey: "" }),
      }), "POST", {
        작업: "AI추천",
        요구내용: "최근 3년간 정보화 사업 현황",
      }),
      확인: (result) => result.status === 500 && /OPENAI_API_KEY/.test(result.body.error),
    },
    {
      이름: "접수",
      기대: "200 접수",
      실행: () => call(handler, "POST", {
        작업: "접수",
        문항: {
          id,
          파일명: "테스트.pdf",
          위원회: "정무위원회",
          의원: "김테스트",
          제출기한: "2026-10-12",
          문항번호: "1",
          요구내용: "최근 3년간 디지털전환 사업 추진 현황",
          세부항목: "가. 연도별 예산",
          비고: "※ 세부 기준 포함",
          연락처: "저장되면 안 됨",
        },
      }),
      확인: (result) => pass(result, 200, "접수") && !("연락처" in result.body.case),
    },
    {
      이름: "조직도 밖 과 배분",
      기대: "400",
      실행: () => call(handler, "POST", {
        작업: "배분",
        id,
        주관과: "없는과",
        협조과: [],
        확정방법: "규칙",
      }),
      확인: (result) => result.status === 400,
    },
    {
      이름: "배분",
      기대: "200 배분확정",
      실행: () => call(handler, "POST", {
        작업: "배분",
        id,
        주관과: "디지털정책과",
        협조과: ["정보화담당관"],
        확정방법: "규칙",
        후보: [{ 과: "디지털정책과", 점수: 5, 근거키워드: "디지털전환" }],
      }),
      확인: (result) => pass(result, 200, "배분확정"),
    },
    {
      이름: "담당 아닌 과 회신",
      기대: "403",
      실행: () => call(handler, "POST", {
        작업: "회신",
        id,
        과: "안전정책과",
        파일명: "회신.xlsx",
        행: [{ 연도: "2026" }],
      }),
      확인: (result) => result.status === 403,
    },
    {
      이름: "사유 없는 재배정요청",
      기대: "400",
      실행: () => call(handler, "POST", {
        작업: "재배정요청",
        id,
        과: "디지털정책과",
      }),
      확인: (result) => result.status === 400,
    },
    {
      이름: "주관 과 회신",
      기대: "200 회신중",
      실행: () => call(handler, "POST", {
        작업: "회신",
        id,
        과: "디지털정책과",
        파일명: "회신.xlsx",
        행: [{ 연도: "2026", 항목명: "디지털전환" }],
      }),
      확인: (result) => pass(result, 200, "회신중"),
    },
    {
      이름: "협조 과 회신",
      기대: "200 회신완료",
      실행: () => call(handler, "POST", {
        작업: "회신",
        id,
        과: "정보화담당관",
        파일명: "회신.xlsx",
        행: [{ 연도: "2026", 항목명: "정보화" }],
      }),
      확인: (result) => pass(result, 200, "회신완료"),
    },
    {
      이름: "순서 오류 회신",
      기대: "409",
      실행: () => call(handler, "POST", {
        작업: "회신",
        id,
        과: "디지털정책과",
        파일명: "회신.xlsx",
      }),
      확인: (result) => result.status === 409,
    },
  ];

  const rows = [];
  let ok = true;
  for (const test of tests) {
    const result = await test.실행();
    const success = test.확인(result);
    ok = ok && success;
    rows.push({
      시험: test.이름,
      기대: test.기대,
      실제: `${result.status}${result.body && result.body.상태 ? ` ${result.body.상태}` : ""}`,
      결과: success ? "O" : "X",
      오류: result.body && result.body.error ? result.body.error : "",
    });
  }

  console.table(rows);
  console.log("최종 저장 건수:", store.snapshot().length);
  console.log("첫 문항 상태:", store.snapshot()[0] && store.snapshot()[0].상태);

  if (!ok) process.exitCode = 1;
}

function createFakeOpenAI(responses) {
  return {
    lastPayload: null,
    async createChatCompletion(payload) {
      this.lastPayload = payload;
      const body = responses.shift() || { 후보: [], 해당없음: true };
      return {
        choices: [
          {
            message: {
              content: JSON.stringify(body),
            },
          },
        ],
      };
    },
  };
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
