#!/usr/bin/env node
"use strict";

const path = require("path");

const ROOT = path.join(__dirname, "..");

const {
  loadSupportServiceChangeReviewQueue,
  writeSupportServiceChangeReviewQueue,
  transitionReviewStatus,
  appendReviewLogEntries,
  loadSupportServiceReviewLog,
  loadSupportServiceAlertQueue,
  writeSupportServiceAlertQueue,
  normalizeReviewStatus
} = require(path.join(ROOT, "monitor", "support-service-change-review"));

const {
  buildOperatorReviewView,
  writeOperatorReviewView,
  validateOperatorReviewView
} = require(path.join(ROOT, "monitor", "support-service-review-view"));

function parseArgs(argv) {
  const options = {
    reviewId: null,
    action: null,
    reviewer: "operator",
    note: ""
  };

  (argv || []).forEach(function (arg) {
    if (arg.indexOf("--review-id=") === 0) {
      options.reviewId = arg.slice("--review-id=".length);
    } else if (arg.indexOf("--action=") === 0) {
      options.action = arg.slice("--action=".length).toUpperCase();
    } else if (arg.indexOf("--reviewer=") === 0) {
      options.reviewer = arg.slice("--reviewer=".length);
    } else if (arg.indexOf("--note=") === 0) {
      options.note = arg.slice("--note=".length);
    }
  });

  return options;
}

function resolveAlertStatus(action) {
  if (action === "APPROVE" || action === "REJECT") {
    return "RESOLVED";
  }
  return null;
}

function main() {
  const options = parseArgs(process.argv.slice(2));

  if (!options.reviewId || !options.action) {
    console.error("Usage: node scripts/apply-support-service-change-review.js --review-id=SSREV-... --action=START|APPROVE|REJECT [--reviewer=name] [--note=text]");
    process.exit(1);
  }

  const reviewQueue = loadSupportServiceChangeReviewQueue();
  const itemIndex = (reviewQueue.items || []).findIndex(function (item) {
    return item.review_id === options.reviewId || item.queue_id === options.reviewId;
  });

  if (itemIndex === -1) {
    console.error("Review item not found: " + options.reviewId);
    process.exit(1);
  }

  const currentItem = reviewQueue.items[itemIndex];
  const transition = transitionReviewStatus(currentItem, options.action, {
    reviewer: options.reviewer,
    reviewNote: options.note,
    timestamp: new Date().toISOString()
  });

  if (transition.error) {
    console.error(transition.error);
    process.exit(1);
  }

  const items = reviewQueue.items.slice();
  items[itemIndex] = transition.item;

  const statusSummary = {
    NEW: 0,
    REVIEWING: 0,
    APPROVED: 0,
    REJECTED: 0,
    APPLIED: 0
  };
  items.forEach(function (item) {
    const status = normalizeReviewStatus(item.status);
    statusSummary[status] = (statusSummary[status] || 0) + 1;
  });

  const nextQueue = Object.assign({}, reviewQueue, {
    generated_at: new Date().toISOString(),
    item_count: items.length,
    status_summary: statusSummary,
    items: items
  });

  writeSupportServiceChangeReviewQueue(nextQueue);
  appendReviewLogEntries([transition.logEntry]);

  const alertStatus = resolveAlertStatus(options.action);
  if (alertStatus) {
    const alertQueue = loadSupportServiceAlertQueue();
    const alerts = (alertQueue.alerts || []).map(function (alert) {
      if (alert.change_id === currentItem.change_id && alert.status === "NEW") {
        return Object.assign({}, alert, { status: alertStatus });
      }
      return alert;
    });
    const alertSummary = { NEW: 0, RESOLVED: 0 };
    alerts.forEach(function (alert) {
      alertSummary[alert.status] = (alertSummary[alert.status] || 0) + 1;
    });
    writeSupportServiceAlertQueue(
      Object.assign({}, alertQueue, {
        alerts: alerts,
        alert_count: alerts.length,
        status_summary: alertSummary,
        generated_at: new Date().toISOString()
      })
    );
  }

  const operatorView = buildOperatorReviewView({
    reviewQueue: nextQueue,
    reviewLog: loadSupportServiceReviewLog(),
    alertQueue: loadSupportServiceAlertQueue()
  });
  const viewErrors = validateOperatorReviewView(operatorView);
  if (viewErrors.length) {
    console.error("Operator view validation failed:");
    viewErrors.forEach(function (message) {
      console.error(" - " + message);
    });
    process.exit(1);
  }

  const viewPath = writeOperatorReviewView(operatorView);

  console.log("=== SUPPORT_SERVICE Change Review Decision ===");
  console.log(
    JSON.stringify(
      {
        SUPPORT_SERVICE_CHANGE_REVIEW_DECISION: "PASS",
        review_id: transition.item.review_id,
        action: options.action,
        previous_status: normalizeReviewStatus(currentItem.status),
        next_status: transition.item.status,
        reviewer: options.reviewer,
        operator_view: path.relative(ROOT, viewPath).split(path.sep).join("/"),
        AUTO_PUBLISH: false
      },
      null,
      2
    )
  );
  console.log("SUPPORT_SERVICE_CHANGE_REVIEW_DECISION_COMPLETE");
}

main();
