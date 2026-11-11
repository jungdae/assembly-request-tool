"use strict";

const flow = require("../web/flow.js");
const org = require("./org.json");

const CASES_PATH = "cases.json";

function createHandler(options = {}) {
  const store = options.store || createBlobStore();
  const orgData = options.orgData || org;
  const openaiClient = options.openaiClient || createOpenAIClient();

  return async function handler(req, res) {
    try {
      if (req.method === "GET") {
        return send(res, 200, await store.read());
      }

      if (req.method !== "POST") {
        setHeader(res, "Allow", "GET, POST");
        return send(res, 405, { error: "GET 또는 POST만 사용할 수 있습니다." });
      }

      const request = await readJsonBody(req);
      if (request.작업 === "AI추천") {
        return send(res, 200, await recommendWithAI(request, orgData, openaiClient));
      }

      const current = await store.read();
      const applied = flow.apply(current, request, orgData);
      await store.write(applied.db);
      return send(res, 200, {
        ok: true,
        상태: applied.상태,
        case: applied.case,
        cases: applied.db,
      });
    } catch (error) {
      const status = error instanceof flow.FlowError || Number.isInteger(error.status) ? error.status : 500;
      return send(res, status, {
        ok: false,
        error: error.message || "서버 오류가 발생했습니다.",
        details: error.details || undefined,
      });
    }
  };
}

async function recommendWithAI(request, orgData, openaiClient) {
  const text = String(request.요구내용 || "").trim();
  if (!text) throw statusError(400, "요구내용이 필요합니다.");

  const departments = Array.from(flow.normalizeDepartments(orgData));
  const completion = await openaiClient.createChatCompletion({
    model: "gpt-4o-mini",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: [
          "너는 국회 요구자료 배분 보조자다.",
          "반드시 JSON 객체로만 답한다.",
          "과는 제공된 조직도 과 목록 안에서만 고른다.",
          "후보는 최대 3개이며 각 후보는 {\"과\":\"...\",\"근거\":\"1문장\"} 형식이다.",
          "적절한 과가 없으면 {\"후보\":[],\"해당없음\":true}로 답한다.",
        ].join("\n"),
      },
      {
        role: "user",
        content: JSON.stringify({
          과목록: departments,
          요구내용: text,
          출력형식: { 후보: [{ 과: "과명", 근거: "근거 1문장" }], 해당없음: false },
        }),
      },
    ],
  });

  const raw = completion && completion.choices && completion.choices[0] && completion.choices[0].message
    ? completion.choices[0].message.content
    : "";
  let parsed;
  try {
    parsed = JSON.parse(raw || "{}");
  } catch {
    throw statusError(500, "AI추천 응답을 JSON으로 읽지 못했습니다.");
  }

  const allowed = new Set(departments);
  const 후보 = Array.isArray(parsed.후보)
    ? parsed.후보
        .map((item) => ({
          과: String(item && item.과 ? item.과 : "").trim(),
          근거: String(item && item.근거 ? item.근거 : "").trim(),
        }))
        .filter((item) => item.과 && allowed.has(item.과))
        .slice(0, 3)
    : [];

  return {
    후보,
    해당없음: Boolean(parsed.해당없음) || 후보.length === 0,
  };
}

function createOpenAIClient(options = {}) {
  const apiKey = options.apiKey !== undefined ? options.apiKey : process.env.OPENAI_API_KEY;
  return {
    async createChatCompletion(payload) {
      if (!apiKey) {
        throw statusError(500, "OPENAI_API_KEY 환경변수가 필요합니다. Vercel 프로젝트 Settings > Environment Variables에 설정해 주세요.");
      }
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw statusError(response.status >= 500 ? 500 : 400, data.error && data.error.message ? data.error.message : `OpenAI 호출 실패: ${response.status}`);
      }
      return data;
    },
  };
}

function statusError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function createBlobStore() {
  return {
    async read() {
      const { list } = await loadBlob();
      const listed = await list({ prefix: CASES_PATH, limit: 10 });
      const blob = (listed.blobs || []).find((item) => item.pathname === CASES_PATH);
      if (!blob) return [];
      const response = await fetch(blob.downloadUrl || blob.url, { cache: "no-store" });
      if (response.status === 404) return [];
      if (!response.ok) throw new Error(`cases.json 읽기 실패: ${response.status}`);
      const data = await response.json();
      return Array.isArray(data) ? data : [];
    },
    async write(cases) {
      const { put } = await loadBlob();
      await put(CASES_PATH, JSON.stringify(cases, null, 2), {
        access: "private",
        contentType: "application/json; charset=utf-8",
        addRandomSuffix: false,
        allowOverwrite: true,
      });
    },
  };
}

async function loadBlob() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("BLOB_READ_WRITE_TOKEN 환경변수가 필요합니다.");
  }
  return import("@vercel/blob");
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body.trim()) return JSON.parse(req.body);

  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

function send(res, status, body) {
  if (typeof res.status === "function" && typeof res.json === "function") {
    return res.status(status).json(body);
  }
  res.statusCode = status;
  setHeader(res, "Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body, null, 2));
  return undefined;
}

function setHeader(res, name, value) {
  if (typeof res.setHeader === "function") res.setHeader(name, value);
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
module.exports.createBlobStore = createBlobStore;
module.exports.createOpenAIClient = createOpenAIClient;
module.exports.recommendWithAI = recommendWithAI;
module.exports._test = { readJsonBody, send };
