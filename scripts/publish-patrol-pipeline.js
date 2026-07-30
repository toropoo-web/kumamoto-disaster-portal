#!/usr/bin/env node
"use strict";

const { execSync } = require("child_process");
const {
  inspectPublishPipeline,
  syncPublicStatusFromLatestPatrol
} = require("../monitor/patrol-publish-pipeline");

async function runApplyApproved(apply) {
  const args = apply ? ["node", "scripts/apply-approved.js", "--apply"] : ["node", "scripts/apply-approved.js"];
  const output = execSync(args.join(" "), { encoding: "utf8" });
  return output;
}

async function main() {
  const applyApproved = process.argv.includes("--apply-approved");
  const publishStatus = process.argv.includes("--publish-status");
  const dryRun = !applyApproved && !publishStatus;

  const before = inspectPublishPipeline();
  const summary = {
    MODE: dryRun ? "DRY_RUN" : applyApproved || publishStatus ? "PUBLISH" : "DRY_RUN",
    AUTO_PUBLICATION: false,
    pipeline: before.pipeline,
    counts: before.counts,
    latestPatrol: before.latestPatrol,
    publicStatusBefore: before.publicStatus,
    actions: [],
    errors: []
  };

  if (applyApproved) {
    try {
      const applyOutput = await runApplyApproved(true);
      summary.actions.push({
        step: "apply-approved",
        result: "EXECUTED"
      });
      summary.applyApprovedOutput = applyOutput.trim();
    } catch (err) {
      summary.errors.push("apply-approved failed: " + err.message);
    }
  } else {
    summary.actions.push({
      step: "apply-approved",
      result: "SKIPPED",
      reason: "manual gate; use --apply-approved after review"
    });
  }

  if (publishStatus) {
    const statusResult = syncPublicStatusFromLatestPatrol();
    summary.actions.push({
      step: "publish-status",
      result: statusResult.saved ? "UPDATED" : "SKIPPED",
      detail: statusResult
    });

    if (!statusResult.saved) {
      summary.errors.push("status publish skipped: " + (statusResult.reason || "unknown"));
    } else {
      try {
        execSync("node scripts/static-build.js", { stdio: "pipe" });
        summary.actions.push({ step: "static-build", result: "PASS" });
      } catch (err) {
        summary.errors.push("static build failed after status publish");
      }
    }
  } else {
    summary.actions.push({
      step: "publish-status",
      result: "SKIPPED",
      reason: "use --publish-status to sync data/public/status.json"
    });
  }

  const after = inspectPublishPipeline();
  summary.publicStatusAfter = after.publicStatus;
  summary.snapshots = after.snapshots;

  console.log("=== Publish Patrol Pipeline ===");
  console.log(JSON.stringify(summary, null, 2));

  if (summary.errors.length) {
    process.exit(1);
  }

  console.log("PATROL_PUBLISH_PIPELINE_READY");
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
