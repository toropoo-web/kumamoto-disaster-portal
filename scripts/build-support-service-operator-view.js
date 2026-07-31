#!/usr/bin/env node
"use strict";

const path = require("path");

const ROOT = path.join(__dirname, "..");

const {
  loadSupportServiceChangeReviewQueue
} = require(path.join(ROOT, "monitor", "support-service-change-review"));

const {
  loadSupportServiceReviewLog,
  loadSupportServiceAlertQueue
} = require(path.join(ROOT, "monitor", "support-service-change-review"));

const {
  buildOperatorReviewView,
  writeOperatorReviewView,
  validateOperatorReviewView
} = require(path.join(ROOT, "monitor", "support-service-review-view"));

function main() {
  const operatorView = buildOperatorReviewView({
    reviewQueue: loadSupportServiceChangeReviewQueue(),
    reviewLog: loadSupportServiceReviewLog(),
    alertQueue: loadSupportServiceAlertQueue()
  });

  const errors = validateOperatorReviewView(operatorView);
  if (errors.length) {
    console.error("Operator view validation failed:");
    errors.forEach(function (message) {
      console.error(" - " + message);
    });
    process.exit(1);
  }

  const outputPath = writeOperatorReviewView(operatorView);

  console.log("=== SUPPORT_SERVICE Operator View Build ===");
  console.log(
    JSON.stringify(
      {
        SUPPORT_SERVICE_OPERATOR_VIEW: "PASS",
        output: path.relative(ROOT, outputPath).split(path.sep).join("/"),
        review_count: operatorView.review_count,
        alert_count: operatorView.alert_count,
        status_summary: operatorView.status_summary,
        AUTO_PUBLISH: operatorView.AUTO_PUBLISH
      },
      null,
      2
    )
  );
  console.log("SUPPORT_SERVICE_OPERATOR_VIEW_BUILD_COMPLETE");
}

main();
