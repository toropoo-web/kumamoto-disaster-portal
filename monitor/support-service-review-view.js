"use strict";

const fs = require("fs");
const path = require("path");

const { AUTO_PUBLISH } = require("./support-service-discovery-engine");
const {
  buildChangeReviewDisplayData,
  normalizeReviewStatus,
  REVIEW_STATUSES,
  REVIEW_TRANSITIONS,
  REVIEW_ACTIONS
} = require("./support-service-change-review");
const {
  loadSupportServiceSourceRegistry
} = require("./support-service-source-registry");

const ROOT = path.join(__dirname, "..");
const OPERATOR_VIEW_FILE = path.join(
  ROOT,
  "data",
  "review",
  "support_service",
  "support_service_operator_view.json"
);

const FORBIDDEN_SOURCE_FIELDS = [
  "trust",
  "rank",
  "score",
  "confidence",
  "official_flag",
  "tier"
];

const DIFF_FIELDS = [
  "title",
  "subcategory",
  "facility_name",
  "address",
  "opening_type",
  "available_from",
  "available_until",
  "status"
];

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function buildSourceLookup(sourceRegistry) {
  const lookup = {};
  ((sourceRegistry && sourceRegistry.sources) || []).forEach(function (source) {
    if (source && source.source_id) {
      lookup[source.source_id] = source;
    }
  });
  return lookup;
}

function buildSourceDisplay(source, sourceId) {
  if (!source) {
    return {
      source_id: sourceId || "UNKNOWN",
      source_name: "UNKNOWN",
      url: "UNKNOWN",
      account: "UNKNOWN",
      area: "UNKNOWN",
      categories: []
    };
  }

  return {
    source_id: source.source_id,
    source_name: source.source_name || "UNKNOWN",
    url: source.url || "UNKNOWN",
    account: source.account || "",
    area: source.area || "UNKNOWN",
    categories: Array.isArray(source.categories) ? source.categories.slice() : []
  };
}

function buildDiffDisplay(before, after) {
  const left = before || {};
  const right = after || {};
  const fields = [];

  DIFF_FIELDS.forEach(function (field) {
    const beforeValue = left[field] === undefined || left[field] === null ? "UNKNOWN" : left[field];
    const afterValue = right[field] === undefined || right[field] === null ? "UNKNOWN" : right[field];
    if (beforeValue !== afterValue) {
      fields.push({
        field: field,
        before: beforeValue,
        after: afterValue
      });
    }
  });

  return {
    has_diff: fields.length > 0,
    fields: fields
  };
}

function getAvailableActions(status) {
  const normalized = normalizeReviewStatus(status);
  const transitions = REVIEW_TRANSITIONS[normalized] || {};
  return Object.keys(transitions).filter(function (action) {
    return REVIEW_ACTIONS.indexOf(action) !== -1 && action !== "APPLY";
  });
}

function groupLogsByReviewId(reviewLog) {
  const grouped = {};
  ((reviewLog && reviewLog.entries) || []).forEach(function (entry) {
    if (!entry || !entry.review_id) {
      return;
    }
    if (!grouped[entry.review_id]) {
      grouped[entry.review_id] = [];
    }
    grouped[entry.review_id].push({
      review_id: entry.review_id,
      action: entry.action,
      timestamp: entry.timestamp,
      reviewer: entry.reviewer || ""
    });
  });
  return grouped;
}

function buildReviewViewItem(reviewItem, options) {
  options = options || {};
  const display = buildChangeReviewDisplayData(reviewItem);
  const sourceLookup = options.sourceLookup || {};
  const logsByReview = options.logsByReview || {};
  const reviewId = reviewItem.review_id || reviewItem.queue_id;

  return {
    review_id: reviewId,
    change_id: reviewItem.change_id,
    information_id: reviewItem.information_id,
    change_type: reviewItem.change_type,
    title: display.title,
    facility_name: display.facility_name,
    municipality: display.municipality,
    source_id: reviewItem.source_id || null,
    source: buildSourceDisplay(sourceLookup[reviewItem.source_id], reviewItem.source_id),
    detected_at: reviewItem.detected_at,
    status: normalizeReviewStatus(reviewItem.status),
    reviewer: reviewItem.reviewer || "",
    reviewed_at: reviewItem.reviewed_at || "",
    review_note: reviewItem.review_note || "",
    before: reviewItem.before || {},
    after: reviewItem.after || {},
    diff: buildDiffDisplay(reviewItem.before, reviewItem.after),
    available_actions: getAvailableActions(reviewItem.status),
    logs: logsByReview[reviewId] || []
  };
}

function buildAlertViewItems(alertQueue) {
  return ((alertQueue && alertQueue.alerts) || []).map(function (alert) {
    return {
      alert_id: alert.alert_id,
      change_id: alert.change_id,
      change_type: alert.change_type,
      created_at: alert.created_at,
      status: alert.status
    };
  });
}

function buildOperatorReviewView(options) {
  options = options || {};
  const reviewQueue = options.reviewQueue || { items: [] };
  const reviewLog = options.reviewLog || { entries: [] };
  const alertQueue = options.alertQueue || { alerts: [] };
  const sourceRegistry =
    options.sourceRegistry || loadSupportServiceSourceRegistry(options.sourceRegistryOptions);
  const sourceLookup = buildSourceLookup(sourceRegistry);
  const logsByReview = groupLogsByReviewId(reviewLog);

  const reviews = (reviewQueue.items || []).map(function (item) {
    return buildReviewViewItem(item, {
      sourceLookup: sourceLookup,
      logsByReview: logsByReview
    });
  });

  const statusSummary = REVIEW_STATUSES.reduce(function (acc, status) {
    acc[status] = 0;
    return acc;
  }, {});
  reviews.forEach(function (review) {
    statusSummary[review.status] = (statusSummary[review.status] || 0) + 1;
  });

  return {
    version: "1.0",
    category: "SUPPORT_SERVICE",
    view_type: "OPERATOR_REVIEW",
    generated_at: new Date().toISOString(),
    AUTO_PUBLISH: AUTO_PUBLISH,
    auto_publish: false,
    review_count: reviews.length,
    alert_count: (alertQueue.alerts || []).length,
    status_summary: statusSummary,
    source_registry_file: "data/support_service_discovery/source_registry.json",
    review_queue_file: "data/review/support_service/support_service_change_review_queue.json",
    review_log_file: "data/review/support_service/support_service_review_log.json",
    alert_queue_file: "data/review/support_service/support_service_alert_queue.json",
    reviews: reviews,
    alerts: buildAlertViewItems(alertQueue)
  };
}

function validateOperatorReviewView(view) {
  const errors = [];

  if (!view || view.version !== "1.0") {
    errors.push("operator view version must be 1.0");
  }
  if (view.view_type !== "OPERATOR_REVIEW") {
    errors.push("operator view view_type must be OPERATOR_REVIEW");
  }
  if (view.AUTO_PUBLISH !== false || view.auto_publish !== false) {
    errors.push("operator view AUTO_PUBLISH must be false");
  }
  if (!Array.isArray(view.reviews)) {
    errors.push("operator view reviews must be an array");
    return errors;
  }
  if (view.review_count !== view.reviews.length) {
    errors.push("operator view review_count mismatch");
  }

  view.reviews.forEach(function (review, index) {
    const label = "reviews[" + index + "]";
    [
      "review_id",
      "change_type",
      "title",
      "facility_name",
      "municipality",
      "detected_at",
      "status",
      "before",
      "after"
    ].forEach(function (field) {
      if (review[field] === undefined || review[field] === null || review[field] === "") {
        if (field === "before" || field === "after") {
          return;
        }
        errors.push(label + ": missing " + field);
      }
    });

    if (!review.source || typeof review.source !== "object") {
      errors.push(label + ": source missing");
    } else {
      FORBIDDEN_SOURCE_FIELDS.forEach(function (field) {
        if (review.source[field] !== undefined) {
          errors.push(label + ": forbidden source field " + field);
        }
      });
    }

    if (!Array.isArray(review.logs)) {
      errors.push(label + ": logs must be an array");
    }
    if (!Array.isArray(review.available_actions)) {
      errors.push(label + ": available_actions must be an array");
    }
  });

  if (!Array.isArray(view.alerts)) {
    errors.push("operator view alerts must be an array");
  }

  return errors;
}

function writeOperatorReviewView(view, options) {
  options = options || {};
  const outputPath = options.outputPath || OPERATOR_VIEW_FILE;
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(outputPath, JSON.stringify(view, null, 2) + "\n", "utf8");
  return outputPath;
}

function loadOperatorReviewView(options) {
  options = options || {};
  return readJson(options.inputPath || OPERATOR_VIEW_FILE, {
    version: "1.0",
    category: "SUPPORT_SERVICE",
    view_type: "OPERATOR_REVIEW",
    AUTO_PUBLISH: false,
    auto_publish: false,
    review_count: 0,
    alert_count: 0,
    reviews: [],
    alerts: []
  });
}

module.exports = {
  OPERATOR_VIEW_FILE,
  FORBIDDEN_SOURCE_FIELDS,
  DIFF_FIELDS,
  buildSourceDisplay,
  buildDiffDisplay,
  getAvailableActions,
  buildReviewViewItem,
  buildAlertViewItems,
  buildOperatorReviewView,
  validateOperatorReviewView,
  writeOperatorReviewView,
  loadOperatorReviewView
};
