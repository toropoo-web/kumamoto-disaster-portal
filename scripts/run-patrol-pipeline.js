#!/usr/bin/env node
"use strict";

const { execSync } = require("child_process");
const path = require("path");

const ROOT = path.join(__dirname, "..");

function runStep(label, command) {
  const output = execSync(command, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  return {
    step: label,
    command: command,
    status: "PASS",
    output: output.trim()
  };
}

function main() {
  const dryRun = process.argv.indexOf("--dry-run") >= 0;
  const steps = [];

  try {
    if (!dryRun) {
      steps.push(runStep("patrol", "node scripts/run-monitor.js"));
    } else {
      steps.push({ step: "patrol", status: "SKIPPED", reason: "dry-run" });
    }

    steps.push(runStep("classification", "node scripts/classify-patrol-diffs.js"));
    steps.push(runStep("review_queue", "node scripts/build-patrol-review-queue.js"));
    steps.push({
      step: "apply_confirm",
      status: "SKIPPED",
      reason: "manual Confirm only; use scripts/apply-public-updates.js after gate PASS"
    });

    console.log("=== Patrol Pipeline Run ===");
    console.log(
      JSON.stringify(
        {
          PATROL_PIPELINE_RUN: "PASS",
          dryRun: dryRun,
          auto_publish: false,
          apply_confirm: false,
          steps: steps.map(function (item) {
            return {
              step: item.step,
              status: item.status,
              reason: item.reason || null
            };
          })
        },
        null,
        2
      )
    );
  } catch (err) {
    console.log("=== Patrol Pipeline Run ===");
    console.log(
      JSON.stringify(
        {
          PATROL_PIPELINE_RUN: "FAIL",
          error: err.message,
          stdout: err.stdout || "",
          stderr: err.stderr || "",
          completed_steps: steps
        },
        null,
        2
      )
    );
    process.exit(1);
  }
}

main();
