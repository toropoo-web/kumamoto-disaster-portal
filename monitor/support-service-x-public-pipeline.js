"use strict";

const path = require("path");

const ROOT = path.join(__dirname, "..");

const {
  discoverSupportServiceCandidates,
  AUTO_PUBLISH
} = require("./support-service-discovery-engine");

const {
  buildSupportInformationCandidates
} = require("./support-service-information");

const {
  buildSupportServiceReviewQueue,
  approveCandidateReviewItems,
  buildApprovedCandidateBatch
} = require("./support-service-review-queue");

const { buildSupportServiceChangeQueue } = require("./support-service-change-queue");

const {
  syncChangeReviewWorkflow,
  transitionReviewStatus
} = require("./support-service-change-review");

const {
  buildSupportServiceApplyQueue,
  applySupportServiceQueueItem,
  createEmptyPublicSupportInformation,
  loadPublicSupportInformation,
  validatePublicSupportInformation
} = require("./support-service-public-apply");

const {
  buildDisasterSearchIndex,
  searchDisasterIndex
} = require("./disaster-search-index-engine");

const FORBIDDEN_CANDIDATE_FIELDS = [
  "trust",
  "score",
  "rank",
  "confidence",
  "official_flag"
];

const REQUIRED_CANDIDATE_FIELDS = [
  "source_type",
  "post_url",
  "account",
  "text",
  "detected_keywords",
  "subcategory",
  "municipality",
  "published_at",
  "checked_at"
];

function assertCandidateFields(candidate) {
  const errors = [];
  REQUIRED_CANDIDATE_FIELDS.forEach(function (field) {
    const value = candidate[field];
    if (field === "detected_keywords") {
      if (!Array.isArray(value) || value.length === 0) {
        errors.push("missing detected_keywords");
      }
      return;
    }
    if (value === undefined || value === null || value === "") {
      errors.push("missing " + field);
    }
  });
  FORBIDDEN_CANDIDATE_FIELDS.forEach(function (field) {
    if (Object.prototype.hasOwnProperty.call(candidate, field)) {
      errors.push("forbidden field present: " + field);
    }
  });
  return errors;
}

function approveChangeReviewItems(reviewQueue, options) {
  options = options || {};
  const items = (reviewQueue.items || []).map(function (item) {
    if (!item || item.status === "APPROVED" || item.status === "REJECTED" || item.status === "APPLIED") {
      return item;
    }

    let current = item;
    if (current.status === "NEW") {
      const startTransition = transitionReviewStatus(current, "START", options);
      if (!startTransition.error) {
        current = startTransition.item;
      }
    }

    const approveTransition = transitionReviewStatus(current, "APPROVE", options);
    return approveTransition.error ? item : approveTransition.item;
  });

  return Object.assign({}, reviewQueue, {
    items: items,
    item_count: items.length
  });
}

function buildInformationLookupFromBatch(informationBatch) {
  const lookup = {};
  (informationBatch.informations || []).forEach(function (entry) {
    lookup[entry.information_id] = entry;
  });
  return lookup;
}

function applyApprovedChangesToPublic(publicPayload, applyQueue, changeReviewQueue, informationLookup) {
  const payload = JSON.parse(JSON.stringify(publicPayload));
  const results = [];

  (applyQueue.items || []).forEach(function (queueItem) {
    const applyResult = applySupportServiceQueueItem(
      queueItem,
      payload,
      changeReviewQueue,
      informationLookup
    );
    results.push({
      apply_id: queueItem.apply_id,
      ok: applyResult.ok === true,
      errors: applyResult.errors || []
    });
  });

  return {
    payload: payload,
    results: results,
    appliedCount: results.filter(function (entry) {
      return entry.ok;
    }).length
  };
}

function finalizePublicPayload(payload) {
  payload.information_count = (payload.informations || []).length;
  payload.generated_at = new Date().toISOString();
  return payload;
}

function runSupportServiceXPublicSearchPipeline(options) {
  options = options || {};
  const posts = options.posts || [];
  const referenceDate = options.referenceDate || new Date().toISOString().slice(0, 10);
  const sourceRegistry = options.sourceRegistry || { sources: [] };
  const publicBaseline =
    options.publicBaseline ||
    (options.useCommittedPublic === true
      ? loadPublicSupportInformation()
      : createEmptyPublicSupportInformation());

  const discoveryBatch = discoverSupportServiceCandidates(posts, {
    referenceDate: referenceDate,
    sourceRegistry: sourceRegistry,
    persistSourceRegistry: false
  });

  const candidateReviewQueue = buildSupportServiceReviewQueue(discoveryBatch, options);
  const approvedReviewQueue = approveCandidateReviewItems(candidateReviewQueue, {
    reviewer: options.reviewer || "phase27-operator",
    reviewNote: options.reviewNote || "fixture approved"
  });
  const approvedCandidateBatch = buildApprovedCandidateBatch(discoveryBatch, approvedReviewQueue);
  const informationBatch = buildSupportInformationCandidates(approvedCandidateBatch, {
    sourceRegistry: sourceRegistry,
    checkedAt: options.checkedAt
  });

  const changeQueue = buildSupportServiceChangeQueue(
    publicBaseline.informations || [],
    informationBatch.informations || [],
    {
      currentInformationFile: "data/public/support_information.json",
      discoveredInformationFile: options.discoveredInformationFile || "fixture:x-discovery"
    }
  );

  const workflow = syncChangeReviewWorkflow(changeQueue, {
    discoveredInformations: informationBatch.informations || [],
    currentInformations: publicBaseline.informations || []
  });

  const approvedChangeReviewQueue = approveChangeReviewItems(workflow.reviewQueue, {
    reviewer: options.reviewer || "phase27-operator",
    reviewNote: options.reviewNote || "change review approved"
  });

  const applyQueue = buildSupportServiceApplyQueue(approvedChangeReviewQueue, {
    approvedSourcePrefix: options.approvedSourcePrefix || "phase27:x-public-search"
  });

  const informationLookup = buildInformationLookupFromBatch(informationBatch);
  const applyResult = applyApprovedChangesToPublic(
    publicBaseline,
    applyQueue,
    approvedChangeReviewQueue,
    informationLookup
  );
  const publicPayload = finalizePublicPayload(applyResult.payload);

  const publicErrors = validatePublicSupportInformation(publicPayload);
  const indexPayload = buildDisasterSearchIndex({
    supportInformationPath: null,
    supportInformationPayload: publicPayload
  });

  return {
    AUTO_PUBLISH: AUTO_PUBLISH,
    discoveryBatch: discoveryBatch,
    candidateReviewQueue: approvedReviewQueue,
    approvedCandidateBatch: approvedCandidateBatch,
    informationBatch: informationBatch,
    changeQueue: changeQueue,
    changeReviewQueue: approvedChangeReviewQueue,
    applyQueue: applyQueue,
    publicPayload: publicPayload,
    publicValidationErrors: publicErrors,
    applyResults: applyResult.results,
    appliedCount: applyResult.appliedCount,
    indexPayload: indexPayload,
    searchDisasterIndex: function (query, searchOptions) {
      return searchDisasterIndex(indexPayload, query, searchOptions);
    }
  };
}

module.exports = {
  ROOT,
  FORBIDDEN_CANDIDATE_FIELDS,
  REQUIRED_CANDIDATE_FIELDS,
  assertCandidateFields,
  approveChangeReviewItems,
  runSupportServiceXPublicSearchPipeline
};
