"use strict";

const fs = require("fs");
const path = require("path");

const {
  INBOX_FILE,
  REVIEW_QUEUE_FILE,
  APPLY_QUEUE_FILE,
  AUTO_PUBLISH,
  validateDisasterSocialInbox,
  loadDisasterSocialInbox,
  loadDisasterSocialReviewQueue,
  loadDisasterSocialApplyQueue
} = require("./disaster-social-pipeline");

const { INDEX_FILE, SOURCES_FILE } = require("./disaster-social-index-engine");
const {
  loadCommunityRegionMaster,
  LAYER_SCOPE
} = require("./disaster-social-region-master");
const {
  loadEvacuationAlertScope,
  SNS_FETCH_PLATFORMS,
  SNS_FETCH_SINCE_DATE,
  COMMUNITY_SCOPE_MUNICIPALITY_COUNT
} = require("./disaster-social-community-scope");

const ROOT = path.join(__dirname, "..");
const DEFAULT_OUTPUT_FILE = path.join(
  ROOT,
  "data",
  "operation_monitor",
  "disaster-social-operation.json"
);

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function countByStatus(items, field, status) {
  return (items || []).filter(function (item) {
    return item[field] === status;
  }).length;
}

function countByField(items, getter) {
  const summary = {};
  (items || []).forEach(function (item) {
    const key = getter(item) || "UNKNOWN";
    summary[key] = (summary[key] || 0) + 1;
  });
  return summary;
}

function buildPrefectureDetail(indexEntries, reviewItems) {
  const detail = {};
  indexEntries.forEach(function (entry) {
    const prefecture = entry.prefecture || "UNKNOWN";
    if (!detail[prefecture]) {
      detail[prefecture] = {
        entry_count: 0,
        incomplete_count: 0,
        duplicate_count: 0,
        category_counts: {}
      };
    }
    detail[prefecture].entry_count += 1;
    if (entry.status === "incomplete") {
      detail[prefecture].incomplete_count += 1;
    }
    const category = entry.category || "UNKNOWN";
    detail[prefecture].category_counts[category] =
      (detail[prefecture].category_counts[category] || 0) + 1;
  });
  reviewItems.forEach(function (item) {
    if (item.review_status !== "DUPLICATE") {
      return;
    }
    const prefecture = (item.entry && item.entry.prefecture) || "UNKNOWN";
    if (!detail[prefecture]) {
      detail[prefecture] = {
        entry_count: 0,
        incomplete_count: 0,
        duplicate_count: 0,
        category_counts: {}
      };
    }
    detail[prefecture].duplicate_count += 1;
  });
  return detail;
}

function buildDisasterSocialOperationReport(options) {
  options = options || {};

  const inboxPath = options.inboxPath || INBOX_FILE;
  const reviewQueuePath = options.reviewQueuePath || REVIEW_QUEUE_FILE;
  const applyQueuePath = options.applyQueuePath || APPLY_QUEUE_FILE;
  const indexPath = options.indexPath || INDEX_FILE;
  const sourcesPath = options.sourcesPath || SOURCES_FILE;

  const inbox = loadDisasterSocialInbox({ inboxPath: inboxPath });
  const reviewQueue = loadDisasterSocialReviewQueue({ reviewQueuePath: reviewQueuePath });
  const applyQueue = loadDisasterSocialApplyQueue({ applyQueuePath: applyQueuePath });
  const indexPayload = readJson(indexPath, { entries: [], last_updated: null });
  const sourcesPayload = readJson(sourcesPath, { sources: [] });

  const inboxItems = inbox.items || [];
  const reviewItems = reviewQueue.items || [];
  const indexEntries = indexPayload.entries || [];
  const incompleteInbox = inboxItems.filter(function (item) {
    return item.status === "incomplete" || (item.missing_fields && item.missing_fields.length);
  });
  const incompleteIndex = indexEntries.filter(function (entry) {
    return entry.status === "incomplete";
  });
  const incompleteReview = reviewItems.filter(function (item) {
    return item.entry && item.entry.status === "incomplete";
  });

  const sourceTypeSummary = {};
  (sourcesPayload.sources || []).forEach(function (source) {
    const key = source.source_type || "UNKNOWN";
    sourceTypeSummary[key] = (sourceTypeSummary[key] || 0) + 1;
  });

  const schemaErrors = validateDisasterSocialInbox(inbox);
  const regionMaster = loadCommunityRegionMaster();
  const scope = loadEvacuationAlertScope();
  const prefectureSummary = countByField(indexEntries, function (entry) {
    return entry.prefecture;
  });
  const prefectureDetail = buildPrefectureDetail(indexEntries, reviewItems);

  return {
    phase: "DISASTER_CROSS_SEARCH_COMMUNITY_DATA_REBUILD",
    layer_scope: regionMaster.layer_scope || LAYER_SCOPE,
    region_group: regionMaster.region_group || "KYUSHU",
    community_scope: {
      municipality_count: scope.municipality_count,
      municipalities: scope.municipalities,
      source_path: scope.source_path,
      extensible: false
    },
    sns_fetch: {
      platforms: SNS_FETCH_PLATFORMS.slice(),
      since_date: SNS_FETCH_SINCE_DATE
    },
    generated_at: new Date().toISOString(),
    AUTO_PUBLISH: AUTO_PUBLISH,
    AUTO_APPLY: false,
    STOP_AT: "REVIEW_QUEUE",
    manual_apply_required: true,
    ai_judgment: false,
    schema_validation: {
      pass: schemaErrors.length === 0,
      error_count: schemaErrors.length
    },
    counts: {
      inbox_item_count: inboxItems.length,
      review_queue_item_count: reviewItems.length,
      apply_queue_item_count: (applyQueue.items || []).length,
      index_entry_count: indexEntries.length,
      source_count: (sourcesPayload.sources || []).length,
      incomplete_inbox_count: incompleteInbox.length,
      incomplete_index_count: incompleteIndex.length,
      incomplete_review_count: incompleteReview.length,
      duplicate_review_count: countByStatus(reviewItems, "review_status", "DUPLICATE"),
      pending_review_count: countByStatus(reviewItems, "review_status", "PENDING"),
      approved_review_count: countByStatus(reviewItems, "review_status", "APPROVED")
    },
    review_status_summary: reviewQueue.status_summary || {},
    prefecture_summary: prefectureSummary,
    prefecture_detail: prefectureDetail,
    source_type_summary: sourceTypeSummary,
    last_updated: {
      inbox: inbox.last_updated || null,
      review_queue: reviewQueue.last_updated || null,
      apply_queue: applyQueue.last_updated || null,
      index: indexPayload.last_updated || null
    },
    incomplete_items: incompleteReview.map(function (item) {
      return {
        inbox_id: item.inbox_id,
        review_note: item.review_note || "",
        missing_fields: item.missing_fields || [],
        entry_id: item.entry && item.entry.id
      };
    })
  };
}

function writeDisasterSocialOperationReport(options) {
  options = options || {};
  const report = buildDisasterSocialOperationReport(options);
  const outputPath = options.outputPath || DEFAULT_OUTPUT_FILE;
  ensureDir(path.dirname(outputPath));
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  return {
    report: report,
    output_path: outputPath
  };
}

module.exports = {
  DEFAULT_OUTPUT_FILE,
  buildDisasterSocialOperationReport,
  writeDisasterSocialOperationReport
};
