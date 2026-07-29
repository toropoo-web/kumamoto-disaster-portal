"use strict";

const HIGH_KEYWORDS = [
  "避難",
  "避難所",
  "開設",
  "閉鎖",
  "給水",
  "断水",
  "復旧",
  "支援",
  "災害",
  "通信障害"
];

const MEDIUM_KEYWORDS = ["窓口", "施設", "交通", "行政サービス"];

const LOW_CHANGE_TYPES = new Set([
  "PAGE_UPDATED_AT_CHANGED",
  "TITLE_CHANGED"
]);

const REVIEW_STATUS = {
  REQUIRES_REVIEW: "REQUIRES_REVIEW",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED"
};

function slugify(value) {
  return String(value || "unknown")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase();
}

function buildCandidateId(raw, index) {
  const stamp = (raw.detectedAt || raw.generatedAt || new Date().toISOString())
    .slice(0, 10)
    .replace(/-/g, "");
  const source = slugify(raw.sourceId || raw.source || "SRC");
  const seq = String(index + 1).padStart(3, "0");
  return "CAND-" + stamp + "-" + source + "-" + seq;
}

function classifyPriority(candidate) {
  const keywords = candidate.keywords || [];
  const textParts = [
    candidate.changeType || "",
    candidate.municipality || "",
    candidate.before && candidate.before.title,
    candidate.after && candidate.after.title,
    keywords.join(" ")
  ].filter(Boolean);

  const text = textParts.join(" ");

  if (HIGH_KEYWORDS.some((keyword) => text.includes(keyword))) {
    return "HIGH";
  }

  if (candidate.category === "communication" && /通信|災害|断水|復旧|支援/.test(text)) {
    return "HIGH";
  }

  if (MEDIUM_KEYWORDS.some((keyword) => text.includes(keyword))) {
    return "MEDIUM";
  }

  if (LOW_CHANGE_TYPES.has(candidate.changeType)) {
    return "LOW";
  }

  if ((candidate.changeTypes || []).every((type) => LOW_CHANGE_TYPES.has(type))) {
    return "LOW";
  }

  if (keywords.length === 0 && (candidate.changeType || "").includes("UPDATED")) {
    return "LOW";
  }

  return "MEDIUM";
}

function normalizeReviewStatus(raw) {
  const status = raw.reviewStatus || raw.verificationStatus || "REQUIRES_REVIEW";
  if (status === "REQUIRES_MANUAL_REVIEW") {
    return REVIEW_STATUS.REQUIRES_REVIEW;
  }
  if (status === "APPROVED" || status === "REJECTED") {
    return status;
  }
  return REVIEW_STATUS.REQUIRES_REVIEW;
}

function normalizeCandidate(raw, index) {
  const changeTypes = raw.changeTypes || (raw.changeType ? [raw.changeType] : ["CONTENT_CHANGED"]);
  const changeType = changeTypes[0] || "CONTENT_CHANGED";

  const candidate = {
    id: raw.id || buildCandidateId(raw, index),
    source: raw.sourceId || raw.source,
    municipality: raw.sourceName || raw.municipality,
    category: raw.category || "municipality",
    areaId: raw.areaId || null,
    publicCategoryId: raw.publicCategoryId || null,
    url: raw.sourceUrl || raw.url,
    detectedAt: raw.detectedAt || raw.generatedAt || new Date().toISOString(),
    changeType,
    changeTypes,
    priority: raw.priority || null,
    keywords: raw.detectedKeywords || raw.keywords || [],
    before: raw.before || {
      title: raw.beforeTitle || null,
      contentHash: raw.previousHash || null,
      pageUpdatedAt: raw.beforePageUpdatedAt || null
    },
    after: raw.after || {
      title: raw.headline || raw.afterTitle || null,
      contentHash: raw.currentHash || null,
      pageUpdatedAt: raw.afterPageUpdatedAt || null
    },
    safetyFlags: raw.safetyFlags || [],
    reviewStatus: normalizeReviewStatus(raw),
    incidentScope: raw.incidentScope || "2026_KUMAMOTO_EARTHQUAKE",
    autoPublish: false
  };

  candidate.priority = classifyPriority(candidate);
  return candidate;
}

function validateCandidateShape(candidate) {
  const required = [
    "id",
    "source",
    "municipality",
    "url",
    "detectedAt",
    "changeType",
    "priority",
    "keywords",
    "before",
    "after",
    "reviewStatus"
  ];

  return required.every((key) => Object.prototype.hasOwnProperty.call(candidate, key));
}

module.exports = {
  HIGH_KEYWORDS,
  MEDIUM_KEYWORDS,
  REVIEW_STATUS,
  buildCandidateId,
  classifyPriority,
  normalizeCandidate,
  validateCandidateShape
};
