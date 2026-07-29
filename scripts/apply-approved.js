#!/usr/bin/env node
"use strict";

const { applyApproved, loadApprovedFiles } = require("../monitor/apply-engine");
const { runPostApplyValidation } = require("../monitor/post-apply-validation");
const { saveUpdateHistory } = require("../monitor/update-history");
const { saveOperationStatus } = require("../monitor/operation-status");
const { execSync } = require("child_process");

async function main() {
  const apply = process.argv.includes("--apply");
  const result = await applyApproved({ apply });

  const summary = {
    MODE: apply ? "APPLY" : "DRY_RUN",
    APPLIED: result.applied === true,
    APPROVED_COUNT: result.approvedCount || 0,
    PREVIEW_COUNT: result.previewCount || 0,
    PUBLIC_DATA_AUTO_MODIFY: result.applied === true,
    AUTO_PUBLICATION: false,
    previews: result.previews || [],
    errors: result.errors || []
  };

  if (result.applied) {
    const appliedUrls = (result.previews || []).map((preview) => preview.url);
    const validationResult = await runPostApplyValidation({ appliedUrls });
    const approvedFiles = loadApprovedFiles();
    const history = saveUpdateHistory(result, validationResult, approvedFiles);

    summary.POST_APPLY_VALIDATION = validationResult.POST_APPLY_VALIDATION;
    summary.UPDATE_HISTORY = history.UPDATE_HISTORY;
    summary.historyDir = history.operationDir;

    try {
      execSync("node scripts/static-build.js", { stdio: "pipe" });
      summary.BUILD = "PASS";
    } catch (err) {
      summary.BUILD = "FAIL";
      summary.errors.push("Build failed after apply");
    }

    const operationStatus = await saveOperationStatus();
    summary.CURRENT_STATUS = operationStatus.currentStatus;

    if (validationResult.POST_APPLY_VALIDATION !== "PASS" || summary.BUILD !== "PASS") {
      summary.errors.push.apply(summary.errors, validationResult.errors || []);
    }
  }

  console.log("=== Apply Approved Updates ===");
  console.log(JSON.stringify(summary, null, 2));

  if (summary.errors.length) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
