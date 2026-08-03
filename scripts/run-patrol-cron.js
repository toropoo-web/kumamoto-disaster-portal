#!/usr/bin/env node
"use strict";

const { execSync } = require("child_process");
const path = require("path");

const ROOT = path.join(__dirname, "..");

function runStep(label, command) {
  const startedAt = new Date().toISOString();
  console.log("[patrol-cron] " + label + " ...");
  try {
    execSync(command, {
      cwd: ROOT,
      stdio: "inherit",
      encoding: "utf8"
    });
    console.log("[patrol-cron] " + label + " OK (" + startedAt + ")");
    return { step: label, status: "PASS", startedAt };
  } catch (err) {
    console.error("[patrol-cron] " + label + " FAIL: " + err.message);
    throw err;
  }
}

function main() {
  const steps = [];
  steps.push(runStep("auto-patrol", "node scripts/run-monitor.js"));
  steps.push(runStep("water-patrol", "node scripts/run-water-patrol.js"));
  steps.push(runStep("public-index-build", "npm run build"));

  console.log(
    JSON.stringify(
      {
        PATROL_CRON: "PASS",
        completedAt: new Date().toISOString(),
        steps: steps.map(function (s) {
          return { step: s.step, status: s.status };
        })
      },
      null,
      2
    )
  );
}

main();
