(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.Flow = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const CASE_FIELDS = [
    "id",
    "파일명",
    "위원회",
    "의원",
    "제출기한",
    "문항번호",
    "요구내용",
    "세부항목",
    "비고",
    "상태",
    "주관과",
    "협조과",
    "확정방법",
    "후보",
    "과별회신",
    "재배정",
    "보완",
    "확정코멘트",
    "일시",
    "기록",
  ];

  const ASSIGNABLE_STATUSES = new Set(["접수", "재배정요청", "배분확정"]);
  const REPLY_STATUSES = new Set(["배분확정", "회신중", "보완요청"]);

  class FlowError extends Error {
    constructor(status, message, details) {
      super(message);
      this.name = "FlowError";
      this.status = status;
      this.details = details || null;
    }
  }

  function apply(db, request, org) {
    const action = String((request && request.작업) || "").trim();
    const cases = normalizeCases(db);
    const departments = normalizeDepartments(org);

    if (!action) throw new FlowError(400, "작업 값이 필요합니다.");
    if (action === "접수") return receive(cases, request || {});
    if (action === "배분") return assign(cases, request || {}, departments);
    if (action === "회신") return reply(cases, request || {}, departments);
    if (action === "재배정요청") return requestReassign(cases, request || {}, departments);
    if (action === "보완요청") return requestSupplement(cases, request || {}, departments);
    if (action === "확정") return finalize(cases, request || {});
    if (action === "AI추천") return notYet(400, "AI추천은 S7에서 추가합니다.");
    throw new FlowError(400, `알 수 없는 작업입니다: ${action}`);
  }

  function receive(cases, request) {
    const source = request.문항 || request.case || request;
    const incoming = sanitizeCase(source);
    incoming.상태 = incoming.상태 || "접수";
    if (!incoming.id) incoming.id = makeCaseId(incoming);
    if (!incoming.id) throw new FlowError(400, "접수할 문항 id를 만들 수 없습니다.");

    const index = findIndex(cases, incoming.id);
    const previous = index >= 0 ? cases[index] : {};
    const item = sanitizeCase({ ...previous, ...incoming, 상태: previous.상태 || incoming.상태 || "접수" });
    addLog(item, {
      작업: "접수",
      문항: item.id,
      메모: request.메모 || "문항 접수",
    });

    const next = cases.slice();
    if (index >= 0) next[index] = item;
    else next.push(item);
    return result(next, item);
  }

  function assign(cases, request, departments) {
    const item = getCase(cases, request.id);
    if (!ASSIGNABLE_STATUSES.has(item.상태)) {
      throw new FlowError(409, `${item.상태} 상태에서는 배분할 수 없습니다.`);
    }

    const main = clean(request.주관과);
    const supports = unique(toArray(request.협조과).map(clean).filter(Boolean)).filter((dept) => dept !== main);
    assertDepartment(main, departments, "주관과");
    supports.forEach((dept) => assertDepartment(dept, departments, "협조과"));

    const method = clean(request.확정방법);
    if (!["규칙", "AI", "수정"].includes(method)) {
      throw new FlowError(400, "확정방법은 규칙, AI, 수정 중 하나여야 합니다.");
    }

    item.상태 = "배분확정";
    item.주관과 = main;
    item.협조과 = supports;
    item.확정방법 = method;
    if (Array.isArray(request.후보)) item.후보 = sanitizeCandidates(request.후보, departments);
    item.재배정 = {};
    addLog(item, {
      작업: "배분",
      문항: item.id,
      과: main,
      주관과: main,
      협조과: supports,
      확정방법: method,
    });
    return result(replaceCase(cases, item), item);
  }

  function reply(cases, request, departments) {
    const item = getCase(cases, request.id);
    if (!REPLY_STATUSES.has(item.상태)) {
      throw new FlowError(409, `${item.상태} 상태에서는 회신할 수 없습니다.`);
    }

    const department = clean(request.과);
    assertDepartment(department, departments, "과");
    assertResponsible(item, department);
    if (item.상태 === "보완요청" && department !== clean(item.보완.과)) {
      throw new FlowError(403, `보완 회신 담당은 ${clean(item.보완.과)}입니다.`);
    }

    item.과별회신 = isPlainObject(item.과별회신) ? item.과별회신 : {};
    item.과별회신[department] = sanitizeReply(request);
    if (item.상태 === "보완요청") item.보완 = {};
    item.상태 = allResponsibleDepartments(item).every((dept) => item.과별회신[dept]) ? "회신완료" : "회신중";
    addLog(item, {
      작업: "회신",
      문항: item.id,
      과: department,
    });
    return result(replaceCase(cases, item), item);
  }

  function requestSupplement(cases, request, departments) {
    const item = getCase(cases, request.id);
    if (!["회신중", "회신완료"].includes(item.상태)) {
      throw new FlowError(409, `${item.상태} 상태에서는 보완요청을 할 수 없습니다.`);
    }

    const department = clean(request.과);
    const reason = clean(request.사유);
    assertDepartment(department, departments, "과");
    assertResponsible(item, department);
    if (!reason) throw new FlowError(400, "보완요청 사유가 필요합니다.");

    item.상태 = "보완요청";
    item.보완 = { 과: department, 사유: reason, 일시: now() };
    addLog(item, {
      작업: "보완요청",
      문항: item.id,
      과: department,
      사유: reason,
    });
    return result(replaceCase(cases, item), item);
  }

  function finalize(cases, request) {
    const item = getCase(cases, request.id);
    if (item.상태 !== "회신완료") {
      throw new FlowError(409, `${item.상태} 상태에서는 확정할 수 없습니다.`);
    }

    const comment = clean(request.확정코멘트 || request.코멘트);
    if (!comment) throw new FlowError(400, "확정 코멘트가 필요합니다.");
    item.상태 = "확정";
    item.확정코멘트 = comment;
    addLog(item, {
      작업: "확정",
      문항: item.id,
      코멘트: comment,
    });
    return result(replaceCase(cases, item), item);
  }

  function requestReassign(cases, request, departments) {
    const item = getCase(cases, request.id);
    if (!REPLY_STATUSES.has(item.상태)) {
      throw new FlowError(409, `${item.상태} 상태에서는 재배정요청을 할 수 없습니다.`);
    }

    const department = clean(request.과);
    const reason = clean(request.사유);
    const desired = clean(request.희망과);
    assertDepartment(department, departments, "과");
    assertResponsible(item, department);
    if (!reason) throw new FlowError(400, "재배정요청 사유가 필요합니다.");
    if (desired) assertDepartment(desired, departments, "희망과");

    item.상태 = "재배정요청";
    item.재배정 = {
      과: department,
      사유: reason,
      희망과: desired,
      일시: now(),
    };
    addLog(item, {
      작업: "재배정요청",
      문항: item.id,
      과: department,
      사유: reason,
      희망과: desired,
    });
    return result(replaceCase(cases, item), item);
  }

  function notYet(status, message) {
    throw new FlowError(status, message);
  }

  function sanitizeCase(source) {
    const row = source || {};
    const item = {};
    CASE_FIELDS.forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(row, field)) item[field] = row[field];
    });
    if (item.과별회신 === undefined && row["과별 회신"] !== undefined) item.과별회신 = row["과별 회신"];
    if (item.확정코멘트 === undefined && row["확정 코멘트"] !== undefined) item.확정코멘트 = row["확정 코멘트"];

    item.id = clean(item.id) || makeCaseId(item);
    item.파일명 = clean(item.파일명);
    item.위원회 = clean(item.위원회);
    item.의원 = clean(item.의원);
    item.제출기한 = clean(item.제출기한);
    item.문항번호 = clean(item.문항번호);
    item.요구내용 = clean(item.요구내용);
    item.세부항목 = clean(item.세부항목);
    item.비고 = clean(item.비고);
    item.상태 = clean(item.상태) || "접수";
    item.주관과 = clean(item.주관과);
    item.협조과 = unique(toArray(item.협조과).map(clean).filter(Boolean));
    item.확정방법 = clean(item.확정방법);
    item.후보 = Array.isArray(item.후보) ? item.후보.map(sanitizeCandidate).filter(Boolean) : [];
    item.과별회신 = isPlainObject(item.과별회신) ? item.과별회신 : {};
    item.재배정 = isPlainObject(item.재배정) ? item.재배정 : {};
    item.보완 = isPlainObject(item.보완) ? item.보완 : {};
    item.확정코멘트 = clean(item.확정코멘트);
    item.일시 = clean(item.일시);
    item.기록 = Array.isArray(item.기록) ? item.기록.filter(isPlainObject) : [];
    return item;
  }

  function sanitizeCandidate(candidate) {
    if (!candidate) return null;
    if (typeof candidate === "string") return { 과: clean(candidate) };
    return {
      과: clean(candidate.과),
      점수: candidate.점수 === undefined ? "" : candidate.점수,
      근거키워드: clean(candidate.근거키워드),
      근거: clean(candidate.근거),
      출처: clean(candidate.출처),
    };
  }

  function sanitizeCandidates(candidates, departments) {
    return candidates
      .map(sanitizeCandidate)
      .filter((candidate) => candidate && candidate.과 && departments.has(candidate.과))
      .slice(0, 3);
  }

  function sanitizeReply(request) {
    return {
      파일명: clean(request.파일명),
      행: Array.isArray(request.행) ? request.행 : [],
      메모: clean(request.메모),
      확인필요: Array.isArray(request.확인필요) ? request.확인필요 : [],
      일시: now(),
    };
  }

  function normalizeCases(db) {
    const rows = Array.isArray(db) ? db : db && Array.isArray(db.cases) ? db.cases : [];
    return rows.map(sanitizeCase);
  }

  function normalizeDepartments(org) {
    const source = Array.isArray(org) ? org : org && Array.isArray(org.departments) ? org.departments : [];
    const names = source
      .map((row) => (typeof row === "string" ? row : row && row.과))
      .map(clean)
      .filter(Boolean);
    return new Set(names);
  }

  function getCase(cases, id) {
    const caseId = clean(id);
    if (!caseId) throw new FlowError(400, "문항 id가 필요합니다.");
    const item = cases.find((row) => row.id === caseId);
    if (!item) throw new FlowError(400, `문항을 찾을 수 없습니다: ${caseId}`);
    return { ...item, 협조과: item.협조과.slice(), 기록: item.기록.slice(), 과별회신: { ...item.과별회신 } };
  }

  function replaceCase(cases, item) {
    return cases.map((row) => (row.id === item.id ? sanitizeCase(item) : row));
  }

  function findIndex(cases, id) {
    return cases.findIndex((row) => row.id === id);
  }

  function result(next, item) {
    return {
      ok: true,
      상태: item.상태,
      case: sanitizeCase(item),
      db: next.map(sanitizeCase),
    };
  }

  function allResponsibleDepartments(item) {
    return unique([item.주관과, ...toArray(item.협조과)].map(clean).filter(Boolean));
  }

  function assertResponsible(item, department) {
    const departments = allResponsibleDepartments(item);
    if (!departments.includes(department)) {
      throw new FlowError(403, `${department}는 이 문항의 담당 과가 아닙니다.`);
    }
  }

  function assertDepartment(department, departments, label) {
    if (!department) throw new FlowError(400, `${label} 값이 필요합니다.`);
    if (!departments.has(department)) throw new FlowError(400, `조직도에 없는 과입니다: ${department}`);
  }

  function addLog(item, entry) {
    const stamp = now();
    item.일시 = stamp;
    item.기록 = [
      ...(Array.isArray(item.기록) ? item.기록 : []),
      {
        일시: stamp,
        ...entry,
      },
    ];
  }

  function makeCaseId(row) {
    const file = clean(row && row.파일명) || "문항";
    const member = clean(row && row.의원);
    const number = clean(row && row.문항번호);
    return `${file}::${member}::${number}`;
  }

  function toArray(value) {
    if (Array.isArray(value)) return value;
    if (typeof value === "string") return value.split("|");
    return [];
  }

  function unique(values) {
    return Array.from(new Set(values));
  }

  function clean(value) {
    return String(value ?? "").trim();
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function now() {
    return new Date().toISOString();
  }

  return {
    apply,
    FlowError,
    normalizeCases,
    normalizeDepartments,
    makeCaseId,
  };
});
