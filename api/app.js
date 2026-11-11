"use strict";

const flow = require("../web/flow.js");
const org = require("./org.json");

const CASES_PATH = "cases.json";

function createHandler(options = {}) {
  const store = options.store || createBlobStore();
  const orgData = options.orgData || org;

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
      const status = error instanceof flow.FlowError ? error.status : 500;
      return send(res, status, {
        ok: false,
        error: error.message || "서버 오류가 발생했습니다.",
        details: error.details || undefined,
      });
    }
  };
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
module.exports._test = { readJsonBody, send };
