"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const {
  AUTO_PUBLISH,
  REVIEW_QUEUE_STATUSES,
  validateSupportServiceCandidate
} = require("./support-service-discovery-engine");

const ROOT = path.join(__dirname, "..");
const REVIEW_DIR = path.join(ROOT, "data", "review", "support_service");
const REVIEW_QUEUE_FILE = path.join(REVIEW_DIR, "support_service_review_queue.json");

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function buildQueueId(candidate) {
  return (
    "SSRQ-" +
    crypto
      .createHash("sha256")
      .update([candidate.candidate_id, candidate.text || ""].join("|"))
      .digest("hex")
      .slice(0, 10)
      .toUpperCase()
  );
}

function createReviewChecklist() {
  return {
    source: false,
    content: false,
    region: false,
    period: false,
    location: false,
    conditions: false
  };
}

function createDefaultDecision(status) {
  return {
    status: status || "NEW",
    reviewer: "",
    reviewed_at: "",
    review_note: ""
  };
}

function candidateToReviewItem(candidate, options) {
  options = options || {};
  const titleParts = [];
  if (candidate.opening_type === "FREE_OPEN" && candidate.subcategory_detail) {
    titleParts.push("無料" + (candidate.detected_keyword || ""));
  } else if (candidate.detected_keyword) {
    titleParts.push(candidate.detected_keyword);
  } else if (candidate.facility_name) {
    titleParts.push(candidate.facility_name);
  } else {
    titleParts.push("生活支援情報");
  }

  const sourceLabel = candidate.account
    ? candidate.account + " (" + (candidate.source_type || "X") + ")"
    : candidate.source_url || "UNKNOWN";

  return {
    queue_id: buildQueueId(candidate),
    candidate_id: candidate.candidate_id,
    source_id: candidate.source_id,
    category: "SUPPORT_SERVICE",
    status: candidate.status === "OUT_OF_AREA" ? "REJECTED" : "NEW",
    title: titleParts.join(" "),
    text: candidate.text,
    detected_keyword: candidate.detected_keyword,
    subcategory: candidate.subcategory,
    subcategory_detail: candidate.subcategory_detail,
    opening_type: candidate.opening_type,
    provider_type: candidate.provider_type,
    source_confidence: candidate.source_confidence,
    source_tier: candidate.source_tier || null,
    prefecture: candidate.prefecture,
    municipality: candidate.municipality,
    facility_name: candidate.facility_name,
    address: candidate.address,
    hours: candidate.hours || "UNKNOWN",
    conditions: candidate.conditions || null,
    web_complement_status: candidate.web_complement_status || "UNKNOWN",
    published_at: candidate.published_at,
    available_from: candidate.available_from,
    available_until: candidate.available_until,
    checked_at: candidate.checked_at,
    availability_status: candidate.availability_status,
    verification_status: candidate.verification_status,
    auto_publish: AUTO_PUBLISH,
    review_checklist: createReviewChecklist(),
    decision: createDefaultDecision(candidate.status === "OUT_OF_AREA" ? "REJECTED" : "NEW"),
    source_trace: {
      candidate_id: candidate.candidate_id,
      source_id: candidate.source_id,
      source_type: candidate.source_type,
      source_url: candidate.source_url,
      post_url: candidate.post_url || candidate.source_url || "",
      account: candidate.account,
      detected_keywords: candidate.detected_keywords || [],
      source_label: sourceLabel,
      candidates_file: options.candidatesFile || "data/candidates/support_service_candidates.json"
    },
    created_at: options.createdAt || new Date().toISOString()
  };
}

function buildSupportServiceReviewQueue(candidateBatch, options) {
  options = options || {};
  const candidates = (candidateBatch && candidateBatch.candidates) || [];
  const reviewCandidates = candidates.filter(function (candidate) {
    return candidate && candidate.status === "NEW";
  });
  const items = reviewCandidates.map(function (candidate) {
    return candidateToReviewItem(candidate, options);
  });

  const statusSummary = REVIEW_QUEUE_STATUSES.reduce(function (acc, status) {
    acc[status] = 0;
    return acc;
  }, {});
  items.forEach(function (item) {
    const status = item.status || "NEW";
    statusSummary[status] = (statusSummary[status] || 0) + 1;
  });

  return {
    version: 1,
    category: "SUPPORT_SERVICE",
    generated_at: new Date().toISOString(),
    AUTO_PUBLISH: AUTO_PUBLISH,
    auto_publish: AUTO_PUBLISH,
    item_count: items.length,
    status_summary: statusSummary,
    source_candidates_file:
      options.candidatesFile || "data/candidates/support_service_candidates.json",
    items: items
  };
}

function validateSupportServiceReviewItem(item, index) {
  const label = "items[" + index + "]";
  const errors = [];

  if (!item || typeof item !== "object") {
    errors.push(label + ": entry missing");
    return errors;
  }

  [
    "queue_id",
    "candidate_id",
    "source_id",
    "category",
    "status",
    "title",
    "text",
    "verification_status",
    "checked_at"
  ].forEach(function (field) {
    if (!item[field]) {
      errors.push(label + ": missing " + field);
    }
  });

  if (item.category !== "SUPPORT_SERVICE") {
    errors.push(label + ": category must be SUPPORT_SERVICE");
  }
  if (REVIEW_QUEUE_STATUSES.indexOf(item.status) === -1) {
    errors.push(label + ": invalid status " + item.status);
  }
  if (item.auto_publish !== false) {
    errors.push(label + ": auto_publish must be false");
  }
  if (!item.review_checklist || typeof item.review_checklist !== "object") {
    errors.push(label + ": review_checklist missing");
  } else {
    ["source", "content", "region", "period", "location", "conditions"].forEach(function (field) {
      if (typeof item.review_checklist[field] !== "boolean") {
        errors.push(label + ": review_checklist." + field + " must be boolean");
      }
    });
  }
  if (!item.decision || typeof item.decision !== "object") {
    errors.push(label + ": decision missing");
  }
  if (!item.source_trace || !item.source_trace.candidate_id) {
    errors.push(label + ": source_trace.candidate_id missing");
  }

  return errors;
}

function validateSupportServiceReviewQueue(queue) {
  const errors = [];

  if (!queue || queue.version !== 1) {
    errors.push("review queue version must be 1");
  }
  if (queue.category !== "SUPPORT_SERVICE") {
    errors.push("review queue category must be SUPPORT_SERVICE");
  }
  if (queue.AUTO_PUBLISH !== false || queue.auto_publish !== false) {
    errors.push("review queue AUTO_PUBLISH must be false");
  }
  if (!Array.isArray(queue.items)) {
    errors.push("review queue items must be an array");
    return errors;
  }
  if (queue.item_count !== queue.items.length) {
    errors.push("review queue item_count mismatch");
  }

  const ids = new Set();
  queue.items.forEach(function (item, index) {
    errors.push.apply(errors, validateSupportServiceReviewItem(item, index));
    if (item.queue_id) {
      if (ids.has(item.queue_id)) {
        errors.push("duplicate queue_id: " + item.queue_id);
      }
      ids.add(item.queue_id);
    }
  });

  return errors;
}

function writeSupportServiceReviewQueue(queue, options) {
  options = options || {};
  const outputPath = options.outputPath || REVIEW_QUEUE_FILE;
  writeJson(outputPath, queue);
  return outputPath;
}

function loadSupportServiceReviewQueue(options) {
  options = options || {};
  return readJson(options.inputPath || REVIEW_QUEUE_FILE, {
    version: 1,
    category: "SUPPORT_SERVICE",
    AUTO_PUBLISH: AUTO_PUBLISH,
    auto_publish: AUTO_PUBLISH,
    item_count: 0,
    status_summary: { NEW: 0, REVIEWING: 0, APPROVED: 0, REJECTED: 0 },
    source_candidates_file: "data/candidates/support_service_candidates.json",
    items: []
  });
}

const CANDIDATE_REVIEW_TRANSITIONS = {
  NEW: {
    START_REVIEW: "REVIEWING",
    APPROVE: "APPROVED",
    REJECT: "REJECTED"
  },
  REVIEWING: {
    APPROVE: "APPROVED",
    REJECT: "REJECTED"
  }
};

function transitionCandidateReviewItem(item, action, options) {
  options = options || {};
  const currentStatus = item.status || "NEW";
  const allowed = CANDIDATE_REVIEW_TRANSITIONS[currentStatus] || {};
  const nextStatus = allowed[action];

  if (!nextStatus) {
    return {
      item: item,
      error: "invalid candidate review transition from " + currentStatus + " via " + action
    };
  }

  const timestamp = options.timestamp || new Date().toISOString();
  return {
    item: Object.assign({}, item, {
      status: nextStatus,
      decision: {
        status: nextStatus,
        reviewer: options.reviewer || item.decision && item.decision.reviewer || "operator",
        reviewed_at: timestamp,
        review_note: options.reviewNote || item.decision && item.decision.review_note || ""
      }
    }),
    error: null
  };
}

function approveCandidateReviewItems(reviewQueue, options) {
  options = options || {};
  const items = (reviewQueue.items || []).map(function (item) {
    if (!item || item.status === "REJECTED" || item.status === "APPROVED") {
      return item;
    }
    const transition = transitionCandidateReviewItem(item, "APPROVE", options);
    return transition.error ? item : transition.item;
  });

  const statusSummary = REVIEW_QUEUE_STATUSES.reduce(function (acc, status) {
    acc[status] = 0;
    return acc;
  }, {});
  items.forEach(function (item) {
    const status = item.status || "NEW";
    statusSummary[status] = (statusSummary[status] || 0) + 1;
  });

  return Object.assign({}, reviewQueue, {
    items: items,
    item_count: items.length,
    status_summary: statusSummary
  });
}

function getApprovedCandidateReviewItems(reviewQueue) {
  return (reviewQueue.items || []).filter(function (item) {
    return item && item.status === "APPROVED";
  });
}

function findCandidateByReviewItem(candidateBatch, reviewItem) {
  const candidateId =
    (reviewItem.source_trace && reviewItem.source_trace.candidate_id) || reviewItem.candidate_id;
  return (candidateBatch.candidates || []).find(function (candidate) {
    return candidate && candidate.candidate_id === candidateId;
  });
}

function buildApprovedCandidateBatch(candidateBatch, reviewQueue) {
  const approvedItems = getApprovedCandidateReviewItems(reviewQueue);
  const candidates = approvedItems
    .map(function (item) {
      return findCandidateByReviewItem(candidateBatch, item);
    })
    .filter(function (candidate) {
      return Boolean(candidate) && candidate.status === "NEW";
    });

  return {
    version: "1.0",
    category: "SUPPORT_SERVICE",
    generated_at: new Date().toISOString(),
    AUTO_PUBLISH: AUTO_PUBLISH,
    auto_publish: AUTO_PUBLISH,
    candidate_count: candidates.length,
    in_area_count: candidates.length,
    out_of_area_count: 0,
    excluded_count: 0,
    candidates: candidates
  };
}

module.exports = {
  AUTO_PUBLISH,
  REVIEW_QUEUE_FILE,
  REVIEW_DIR,
  REVIEW_QUEUE_STATUSES,
  buildQueueId,
  candidateToReviewItem,
  buildSupportServiceReviewQueue,
  validateSupportServiceReviewItem,
  validateSupportServiceReviewQueue,
  writeSupportServiceReviewQueue,
  loadSupportServiceReviewQueue,
  CANDIDATE_REVIEW_TRANSITIONS,
  transitionCandidateReviewItem,
  approveCandidateReviewItems,
  getApprovedCandidateReviewItems,
  findCandidateByReviewItem,
  buildApprovedCandidateBatch
};
