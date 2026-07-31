#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");

const {
  buildOperatorReviewView,
  validateOperatorReviewView,
  buildReviewViewItem,
  buildDiffDisplay,
  writeOperatorReviewView,
  loadOperatorReviewView
} = require(path.join(ROOT, "monitor", "support-service-review-view"));

const {
  buildSupportServiceChangeQueue
} = require(path.join(ROOT, "monitor", "support-service-change-queue"));

const {
  buildChangeReviewQueue
} = require(path.join(ROOT, "monitor", "support-service-change-review"));

const {
  transitionReviewStatus,
  validateReviewLog
} = require(path.join(ROOT, "monitor", "support-service-change-review"));

const {
  buildDisasterSearchIndex
} = require(path.join(ROOT, "monitor", "disaster-search-index-engine"));

const PUBLIC_WATER_FILES = [
  "data/water_search_index.json",
  "data/public/water_search_index.json",
  "data/water_cross_view.json",
  "data/public/water_cross_view.json"
];

function hashFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function baseInformation(overrides) {
  return Object.assign(
    {
      information_id: "SSINF-OPVIEW001",
      source_id: "SSRC-7E2F4A91B0",
      category: "SUPPORT_SERVICE",
      subcategory: "BATH",
      subcategory_detail: "SHOWER",
      title: "無料シャワー",
      facility_name: "熊本市総合体育館",
      address: "熊本県熊本市中央区",
      municipality: "熊本市",
      opening_type: "FREE_OPEN",
      published_at: "2026-07-28",
      available_from: "2026-07-28",
      available_until: "UNKNOWN",
      checked_at: "2026-07-31T03:00:00.000Z",
      status: "ACTIVE"
    },
    overrides || {}
  );
}

function main() {
  const errors = [];
  const checks = [];

  [
    "monitor/support-service-review-view.js",
    "admin/support-service-review/index.html",
    "admin/css/support-service-review.css",
    "admin/js/support-service-review.js",
    "scripts/build-support-service-operator-view.js",
    "scripts/apply-support-service-change-review.js"
  ].forEach(function (file) {
    const exists = fs.existsSync(path.join(ROOT, file));
    checks.push({ check: file, pass: exists });
    if (!exists) {
      errors.push("Missing file: " + file);
    }
  });

  const publicHashesBefore = {};
  PUBLIC_WATER_FILES.forEach(function (file) {
    const fullPath = path.join(ROOT, file);
    if (fs.existsSync(fullPath)) {
      publicHashesBefore[file] = hashFile(fullPath);
    }
  });

  const indexBefore = buildDisasterSearchIndex();
  const categoriesBefore = {};
  indexBefore.index.forEach(function (entry) {
    categoriesBefore[entry.category] = (categoriesBefore[entry.category] || 0) + 1;
  });

  const newInformation = baseInformation({ information_id: "SSINF-OPNEW001" });
  const changeQueue = buildSupportServiceChangeQueue([], [newInformation]);
  const reviewQueue = buildChangeReviewQueue(changeQueue, {
    discoveredInformations: [newInformation],
    currentInformations: []
  });
  const operatorView = buildOperatorReviewView({
    reviewQueue: reviewQueue,
    reviewLog: { version: "1.0", entries: [] },
    alertQueue: { version: "1.0", alerts: [] }
  });

  checks.push({
    check: "case1 review queue readable for list view",
    pass: operatorView.review_count >= 1 && operatorView.reviews.length >= 1,
    reviewCount: operatorView.review_count
  });
  if (operatorView.review_count < 1) {
    errors.push("case1 failed: operator view list is empty");
  }

  const viewErrors = validateOperatorReviewView(operatorView);
  checks.push({
    check: "operator view schema valid",
    pass: viewErrors.length === 0,
    errors: viewErrors
  });
  errors.push.apply(errors, viewErrors);

  const beforeUpdated = baseInformation({
    information_id: "SSINF-OPUPD001",
    available_until: "UNKNOWN"
  });
  const afterUpdated = baseInformation({
    information_id: "SSINF-OPUPD001",
    available_until: "2026-08-02"
  });
  const updatedQueue = buildChangeReviewQueue(
    buildSupportServiceChangeQueue([beforeUpdated], [afterUpdated]),
    {
      discoveredInformations: [afterUpdated],
      currentInformations: [beforeUpdated]
    }
  );
  const updatedViewItem = buildReviewViewItem(updatedQueue.items[0], {
    sourceLookup: { "SSRC-7E2F4A91B0": { source_id: "SSRC-7E2F4A91B0", source_name: "熊本市総合体育館", url: "https://example.invalid", account: "", area: "熊本県熊本市", categories: ["BATH"] } },
    logsByReview: {}
  });
  checks.push({
    check: "case2 UPDATED before/after display",
    pass:
      updatedViewItem.change_type === "UPDATED" &&
      updatedViewItem.diff.has_diff &&
      updatedViewItem.diff.fields.some(function (field) {
        return field.field === "available_until" && field.before === "UNKNOWN" && field.after === "2026-08-02";
      })
  });
  if (!updatedViewItem.diff.has_diff) {
    errors.push("case2 failed: expected UPDATED diff display");
  }

  const beforeEnded = baseInformation({
    information_id: "SSINF-OPEND001",
    status: "ACTIVE"
  });
  const afterEnded = baseInformation({
    information_id: "SSINF-OPEND001",
    status: "EXPIRED",
    available_until: "2026-07-30"
  });
  const endedQueue = buildChangeReviewQueue(
    buildSupportServiceChangeQueue([beforeEnded], [afterEnded]),
    {
      discoveredInformations: [afterEnded],
      currentInformations: [beforeEnded]
    }
  );
  const endedViewItem = buildReviewViewItem(endedQueue.items[0], { logsByReview: {} });
  checks.push({
    check: "case3 ENDED shows EXPIRED",
    pass:
      endedViewItem.change_type === "ENDED" &&
      endedViewItem.after.status === "EXPIRED"
  });
  if (endedViewItem.after.status !== "EXPIRED") {
    errors.push("case3 failed: expected EXPIRED in ENDED view");
  }

  const logEntry = {
    review_id: reviewQueue.items[0].review_id,
    action: "START",
    timestamp: "2026-07-31T10:00:00.000Z",
    reviewer: "operator-a"
  };
  const viewWithLogs = buildOperatorReviewView({
    reviewQueue: reviewQueue,
    reviewLog: { version: "1.0", entries: [logEntry] },
    alertQueue: { version: "1.0", alerts: [] }
  });
  checks.push({
    check: "case4 review log displayed",
    pass:
      viewWithLogs.reviews[0] &&
      viewWithLogs.reviews[0].logs.length === 1 &&
      viewWithLogs.reviews[0].logs[0].action === "START"
  });
  if (!viewWithLogs.reviews[0] || viewWithLogs.reviews[0].logs.length !== 1) {
    errors.push("case4 failed: review log not attached to view item");
  }

  const transition = transitionReviewStatus(reviewQueue.items[0], "START", {
    reviewer: "operator-a",
    timestamp: "2026-07-31T10:00:00.000Z"
  });
  checks.push({
    check: "case5 status transition for operation",
    pass: transition.item.status === "REVIEWING" && transition.logEntry.action === "START"
  });
  if (transition.item.status !== "REVIEWING") {
    errors.push("case5 failed: START transition did not move to REVIEWING");
  }

  const logErrors = validateReviewLog({
    version: "1.0",
    entries: [transition.logEntry]
  });
  checks.push({
    check: "case5 review log schema after operation",
    pass: logErrors.length === 0,
    errors: logErrors
  });
  errors.push.apply(errors, logErrors);

  const html = fs.readFileSync(
    path.join(ROOT, "admin", "support-service-review", "index.html"),
    "utf8"
  );
  const js = fs.readFileSync(path.join(ROOT, "admin", "js", "support-service-review.js"), "utf8");
  [
    { name: "admin page noindex", pattern: /noindex/ },
    { name: "operator view json path", pattern: /support_service_operator_view\.json/ },
    { name: "before after diff render", pattern: /renderDiff/ },
    { name: "source display render", pattern: /source\.source_name/ },
    { name: "forbidden trust field absent", pattern: /trust/, invert: true },
    { name: "forbidden score field absent", pattern: /score/, invert: true },
    { name: "cli operation command", pattern: /review:support-service-change/ }
  ].forEach(function (check) {
    const hay = html + "\n" + js;
    const matched = check.pattern.test(hay);
    const pass = check.invert ? !matched : matched;
    checks.push({ check: "UI: " + check.name, pass: pass });
    if (!pass) {
      errors.push("UI check failed: " + check.name);
    }
  });

  writeOperatorReviewView(viewWithLogs);
  const committedView = loadOperatorReviewView();
  const committedViewErrors = validateOperatorReviewView(committedView);
  checks.push({
    check: "committed operator view valid",
    pass: committedViewErrors.length === 0,
    errors: committedViewErrors
  });
  errors.push.apply(errors, committedViewErrors);

  const diff = buildDiffDisplay({ status: "ACTIVE" }, { status: "EXPIRED" });
  checks.push({
    check: "diff display utility",
    pass: diff.has_diff && diff.fields.some(function (field) { return field.field === "status"; })
  });

  const indexAfter = buildDisasterSearchIndex();
  const categoriesAfter = {};
  indexAfter.index.forEach(function (entry) {
    categoriesAfter[entry.category] = (categoriesAfter[entry.category] || 0) + 1;
  });

  checks.push({
    check: "case6 WATER index count unchanged",
    pass: categoriesBefore.WATER === categoriesAfter.WATER
  });
  checks.push({
    check: "case6 VOLUNTEER index count unchanged",
    pass: categoriesBefore.VOLUNTEER === categoriesAfter.VOLUNTEER
  });
  if (categoriesBefore.WATER !== categoriesAfter.WATER) {
    errors.push("case6 failed: WATER count changed");
  }
  if (categoriesBefore.VOLUNTEER !== categoriesAfter.VOLUNTEER) {
    errors.push("case6 failed: VOLUNTEER count changed");
  }

  PUBLIC_WATER_FILES.forEach(function (file) {
    const fullPath = path.join(ROOT, file);
    if (!fs.existsSync(fullPath) || !publicHashesBefore[file]) {
      return;
    }
    const after = hashFile(fullPath);
    const pass = after === publicHashesBefore[file];
    checks.push({ check: "case6 water file unchanged: " + file, pass: pass });
    if (!pass) {
      errors.push("case6 failed: water file changed: " + file);
    }
  });

  const output = {
    SUPPORT_SERVICE_OPERATOR_VIEW_VALIDATION: errors.length === 0 ? "PASS" : "FAIL",
    AUTO_PUBLISH: false,
    reviewCount: operatorView.review_count,
    checks: checks,
    errors: errors
  };

  console.log("=== SUPPORT_SERVICE Operator View Validation (Phase23) ===");
  console.log(JSON.stringify(output, null, 2));

  if (errors.length) {
    process.exit(1);
  }

  console.log("PHASE23_SUPPORT_SERVICE_OPERATOR_VIEW_COMPLETE");
}

main();
