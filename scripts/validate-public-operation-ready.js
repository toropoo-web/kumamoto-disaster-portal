#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OUTPUT_DIR = path.join(ROOT, "data", "operation");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "final-readiness-report.json");

const X_FEED_ROOT = path.join(ROOT, "..", "kumamoto-disaster-x-feed");

const PRIOR_GATES = [
  { field: "DISASTER_PORTAL_PUBLIC_OPERATION_READY", file: OUTPUT_FILE },
  { field: "DISASTER_PORTAL_OPERATION_READY", file: path.join(ROOT, "data", "operation_audit", "latest-report.json") },
  { field: "DISASTER_PORTAL_OPERATION_MONITORING_READY", file: path.join(ROOT, "data", "operation_monitor", "monitoring-ready-report.json") },
  { field: "DISASTER_PORTAL_OPERATION_DASHBOARD_READY", file: path.join(ROOT, "monitor", "dashboard", "dashboard-ready-report.json") }
];

const OPERATION_DOCS = [
  "docs/operation_manual.md",
  "docs/review_flow.md",
  "docs/incident_response.md",
  "docs/PHASE28_WORKFLOW_AUDIT.md"
];

const { rollbackPublicUpdateApply } = require("../monitor/public-update-apply-engine");

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readText(filePath) {
  if (!fs.existsSync(filePath)) {
    return "";
  }
  return fs.readFileSync(filePath, "utf8");
}

function check(name, status, reason) {
  return { check: name, status: status, reason: reason || null };
}

function sectionStatus(checks) {
  if (checks.some(function (c) { return c.status === "FAIL"; })) {
    return "FAIL";
  }
  if (checks.some(function (c) { return c.status === "WARN"; })) {
    return "WARN";
  }
  return "PASS";
}

function validatePipelineIntegrity() {
  const checks = [];
  const files = [
    ["monitor/sources.json", path.join(ROOT, "monitor", "sources.json")],
    ["snapshots.json", path.join(ROOT, "monitor", "reports", "snapshots.json")],
    ["change-log/", path.join(ROOT, "monitor", "change-log")],
    ["review_queue", path.join(ROOT, "data", "review_queue", "patrol_review_queue.json")],
    ["decision_log", path.join(ROOT, "data", "review_queue", "patrol_review_decision_log.json")],
    ["public_update_queue", path.join(ROOT, "data", "public_update_queue", "patrol_public_update_queue.json")],
    ["validation_gate", path.join(ROOT, "data", "public_update_gate", "patrol_public_update_gate.json")],
    ["apply_history", path.join(ROOT, "data", "public_update_apply", "apply_history.json")],
    ["rollback_dir", path.join(ROOT, "data", "patrol_production", "rollback")]
  ];

  files.forEach(function (item) {
    checks.push(check("pipeline." + item[0], fs.existsSync(item[1]) ? "PASS" : "FAIL"));
  });

  const sync = readText(path.join(ROOT, ".github", "workflows", "x-feed-sync.yml"));
  checks.push(check("pipeline.x_feed_sync_workflow", sync ? "PASS" : "FAIL"));
  checks.push(check("pipeline.x_feed_autonomous_schedule", /cron:\s*"15,45/.test(sync) ? "PASS" : "FAIL"));
  checks.push(check("pipeline.x_feed_build_on_publish", /npm run build/.test(sync) ? "PASS" : "FAIL"));

  const fetch = readText(path.join(X_FEED_ROOT, ".github", "workflows", "fetch-x-posts.yml"));
  checks.push(check("pipeline.x_feed_fetch_workflow", fetch ? "PASS" : "WARN", fetch ? null : "sibling repo not found"));
  checks.push(check("pipeline.x_feed_fetch_schedule", /\*\/30 \* \* \* \*/.test(fetch) ? "PASS" : "FAIL"));

  checks.push(check("pipeline.rollback_function", typeof rollbackPublicUpdateApply === "function" ? "PASS" : "FAIL"));

  return checks;
}

function validateAutonomousPublish() {
  const checks = [];
  const render = readText(path.join(ROOT, "render.yaml"));
  const sync = readText(path.join(ROOT, ".github", "workflows", "x-feed-sync.yml"));
  const fetch = readText(path.join(X_FEED_ROOT, ".github", "workflows", "fetch-x-posts.yml"));

  checks.push(check("autonomous.render_autodeploy", /autoDeploy:\s*true/.test(render) ? "PASS" : "FAIL"));
  checks.push(check("autonomous.portal_repository_dispatch", /repository_dispatch:/.test(sync) ? "PASS" : "FAIL"));
  checks.push(check("autonomous.portal_workflow_dispatch", /workflow_dispatch:/.test(sync) ? "PASS" : "FAIL"));
  checks.push(check("autonomous.portal_git_push", /git push/.test(sync) ? "PASS" : "FAIL"));
  checks.push(check("autonomous.xfeed_dispatch_job", /dispatch-portal:/.test(fetch) ? "PASS" : "WARN"));
  checks.push(check("autonomous.xfeed_portal_token", /PORTAL_DISPATCH_TOKEN/.test(fetch) ? "PASS" : "WARN"));
  checks.push(check("autonomous.no_localhost", !/localhost/.test(sync + fetch) ? "PASS" : "FAIL"));

  return checks;
}

function validateGovernance() {
  const checks = [];
  const review = readJson(path.join(ROOT, "data", "review_queue", "patrol_review_queue.json"), {});
  const publicQueue = readJson(path.join(ROOT, "data", "public_update_queue", "patrol_public_update_queue.json"), {});

  checks.push(check("governance.auto_publish_false", (review.autoPublish === false || review.auto_publish === false) && (publicQueue.autoPublish === false || publicQueue.auto_publish === false) ? "PASS" : "FAIL"));
  checks.push(check("governance.rollback_available", typeof rollbackPublicUpdateApply === "function" ? "PASS" : "FAIL"));

  return checks;
}

function validateOperationDocs() {
  return OPERATION_DOCS.map(function (doc) {
    return check("docs." + path.basename(doc), fs.existsSync(path.join(ROOT, doc)) ? "PASS" : "FAIL");
  });
}

function main() {
  const sections = {
    pipeline_integrity: { checks: validatePipelineIntegrity(), status: "PENDING" },
    autonomous_publish: { checks: validateAutonomousPublish(), status: "PENDING" },
    governance: { checks: validateGovernance(), status: "PENDING" },
    operation_docs: { checks: validateOperationDocs(), status: "PENDING" }
  };

  const warnings = [];
  const failures = [];

  Object.keys(sections).forEach(function (key) {
    sections[key].status = sectionStatus(sections[key].checks);
    sections[key].checks.forEach(function (item) {
      if (item.status === "FAIL") {
        failures.push(key + ": " + item.check);
      } else if (item.status === "WARN") {
        warnings.push(key + ": " + item.check);
      }
    });
  });

  const priorPublic = readJson(OUTPUT_FILE, null);
  const reviewPending = readJson(path.join(ROOT, "data", "review_queue", "patrol_review_queue.json"), { items: [] });
  const pendingCount = (reviewPending.items || []).filter(function (i) { return i.status === "PENDING"; }).length;

  if (pendingCount > 0) {
    warnings.push("operational: " + pendingCount + " review items pending (does not block public portal)");
  }

  const finalStatus = failures.length > 0 ? "FAIL" : (warnings.length > 0 ? "WARNING" : "PASS");

  const output = {
    DISASTER_PORTAL_PUBLIC_OPERATION_READY: finalStatus === "FAIL" ? "FAIL" : "PASS",
    final_status: finalStatus,
    verdict: {
      PASS: "公開運用可能",
      WARNING: "運用可能だが確認事項あり",
      FAIL: "修正必要"
    }[finalStatus],
    generatedAt: new Date().toISOString(),
    timestamp: new Date().toISOString(),
    autonomous_pipeline: {
      x_feed_cron: "*/30 * * * * (UTC)",
      portal_sync_cron: "15,45 * * * * (UTC backup)",
      render_deploy: "autoDeploy on push to main",
      pc_required: false
    },
    summary: {
      review_pending_count: pendingCount,
      prior_public_gate: priorPublic ? priorPublic.DISASTER_PORTAL_PUBLIC_OPERATION_READY : null
    },
    sections: sections,
    warnings: warnings,
    failures: failures
  };

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2) + "\n", "utf8");

  console.log("=== Disaster Portal Public Operation Final Gate ===");
  console.log(JSON.stringify(output, null, 2));

  if (finalStatus === "FAIL") {
    process.exit(1);
  }
}

main();
