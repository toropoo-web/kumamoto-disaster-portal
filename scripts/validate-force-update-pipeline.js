#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const X_FEED_ROOT = path.join(ROOT, "..", "kumamoto-disaster-x-feed");

const PORTAL_WORKFLOWS = {
  x_feed_sync: path.join(ROOT, ".github", "workflows", "x-feed-sync.yml"),
  ci: path.join(ROOT, ".github", "workflows", "ci.yml")
};

const X_FEED_WORKFLOWS = {
  fetch: path.join(X_FEED_ROOT, ".github", "workflows", "fetch-x-posts.yml"),
  ci: path.join(X_FEED_ROOT, ".github", "workflows", "ci.yml")
};

function readText(filePath) {
  if (!fs.existsSync(filePath)) {
    return "";
  }
  return fs.readFileSync(filePath, "utf8");
}

function check(name, status, reason) {
  return { check: name, status: status, reason: reason || null };
}

function auditPortalWorkflows() {
  const checks = [];
  const sync = readText(PORTAL_WORKFLOWS.x_feed_sync);

  checks.push(check("portal.x_feed_sync.exists", sync ? "PASS" : "FAIL"));
  if (!sync) {
    return checks;
  }

  checks.push(check("portal.schedule_backup", /cron:\s*"15,45 \* \* \* \*"/.test(sync) ? "PASS" : "FAIL"));
  checks.push(check("portal.workflow_dispatch", /workflow_dispatch:/.test(sync) ? "PASS" : "FAIL"));
  checks.push(check("portal.repository_dispatch", /repository_dispatch:/.test(sync) && /x-feed-updated/.test(sync) ? "PASS" : "FAIL"));
  checks.push(check("portal.sync_script", /npm run sync:x-feed/.test(sync) ? "PASS" : "FAIL"));
  checks.push(check("portal.fail_open_env", /X_FEED_FAIL_OPEN:\s*"true"/.test(sync) ? "PASS" : "FAIL"));
  checks.push(check("portal.sync_job_split", /sync-x-feed:/.test(sync) && /publish-x-feed-preview:/.test(sync) ? "PASS" : "FAIL"));
  checks.push(check("portal.validate_script", /validate:x-feed/.test(sync) ? "PASS" : "FAIL"));
  checks.push(check("portal.build_step", /npm run build/.test(sync) ? "PASS" : "FAIL"));
  checks.push(check("portal.commit_push", /git push/.test(sync) ? "PASS" : "FAIL"));
  checks.push(check("portal.render_autodeploy_check", /autoDeploy: true/.test(sync) ? "PASS" : "FAIL"));
  checks.push(check("portal.staging_guard", /verify-public-commit-staging/.test(sync) ? "PASS" : "FAIL"));
  checks.push(check("portal.no_pc_dependency", !/localhost|127\.0\.0\.1/.test(sync) ? "PASS" : "FAIL"));

  const render = readText(path.join(ROOT, "render.yaml"));
  checks.push(check("portal.render_yaml", /autoDeploy:\s*true/.test(render) ? "PASS" : "FAIL"));

  return checks;
}

function auditXFeedWorkflows() {
  const checks = [];
  const fetch = readText(X_FEED_WORKFLOWS.fetch);

  checks.push(check("xfeed.fetch_workflow.exists", fetch ? "PASS" : "FAIL"));
  if (!fetch) {
    checks.push(check("xfeed.repo_present", "WARN", "kumamoto-disaster-x-feed not found at sibling path"));
    return checks;
  }

  checks.push(check("xfeed.schedule_30min", /\*\/30 \* \* \* \*/.test(fetch) ? "PASS" : "FAIL"));
  checks.push(check("xfeed.workflow_dispatch", /workflow_dispatch:/.test(fetch) ? "PASS" : "FAIL"));
  checks.push(check("xfeed.schedule_before_dispatch", fetch.indexOf("schedule:") < fetch.indexOf("workflow_dispatch:") ? "PASS" : "WARN"));
  checks.push(check("xfeed.fetch_script", /npm run fetch:x/.test(fetch) ? "PASS" : "FAIL"));
  checks.push(check("xfeed.build_step", /npm run build/.test(fetch) ? "PASS" : "FAIL"));
  checks.push(check("xfeed.commit_push", /git push/.test(fetch) ? "PASS" : "FAIL"));
  checks.push(check("xfeed.portal_dispatch_job", /dispatch-portal:/.test(fetch) ? "PASS" : "FAIL"));
  checks.push(check("xfeed.portal_dispatch_token", /PORTAL_DISPATCH_TOKEN/.test(fetch) ? "PASS" : "FAIL"));
  checks.push(check("xfeed.dispatch_non_blocking", /PORTAL_DISPATCH_SKIPPED=true/.test(fetch) ? "PASS" : "FAIL"));
  checks.push(check("xfeed.repository_dispatch_event", /event_type=x-feed-updated/.test(fetch) ? "PASS" : "FAIL"));
  checks.push(check("xfeed.no_pc_dependency", !/localhost|127\.0\.0\.1/.test(fetch) ? "PASS" : "FAIL"));

  return checks;
}

function auditPcDependencyRisks() {
  const checks = [];
  const risks = [];

  const sync = readText(PORTAL_WORKFLOWS.x_feed_sync);
  if (sync && !/schedule:/.test(sync)) {
    risks.push("portal missing schedule trigger");
  }

  const fetch = readText(X_FEED_WORKFLOWS.fetch);
  if (!fetch) {
    risks.push("x-feed repo not available for local audit");
  } else if (!/\*\/30 \* \* \* \*/.test(fetch)) {
    risks.push("x-feed fetch missing */30 cron");
  }

  checks.push(check("risk.scheduled_triggers_present", risks.length === 0 ? "PASS" : "FAIL", risks.join("; ") || null));
  checks.push(check("risk.manual_only_fetch", fetch && /schedule:/.test(fetch) ? "PASS" : "WARN", "fetch must not be workflow_dispatch only"));

  return checks;
}

function sectionStatus(checks) {
  if (checks.some(function (item) { return item.status === "FAIL"; })) {
    return "FAIL";
  }
  if (checks.some(function (item) { return item.status === "WARN"; })) {
    return "WARN";
  }
  return "PASS";
}

function main() {
  const sections = {
    portal_workflows: { checks: auditPortalWorkflows(), status: "PENDING" },
    xfeed_workflows: { checks: auditXFeedWorkflows(), status: "PENDING" },
    pc_dependency_risks: { checks: auditPcDependencyRisks(), status: "PENDING" }
  };

  const failures = [];
  const warnings = [];

  Object.keys(sections).forEach(function (key) {
    sections[key].status = sectionStatus(sections[key].checks);
    sections[key].checks.forEach(function (item) {
      if (item.status === "FAIL") {
        failures.push(key + ": " + item.check + (item.reason ? " (" + item.reason + ")" : ""));
      } else if (item.status === "WARN") {
        warnings.push(key + ": " + item.check + (item.reason ? " (" + item.reason + ")" : ""));
      }
    });
  });

  const finalStatus = sections.portal_workflows.status === "FAIL" ||
    sections.xfeed_workflows.status === "FAIL" ||
    sections.pc_dependency_risks.status === "FAIL"
    ? "FAIL"
    : (warnings.length > 0 ? "WARNING" : "PASS");

  const output = {
    PHASE28_FORCE_UPDATE_PIPELINE: finalStatus === "FAIL" ? "FAIL" : "PASS",
    final_status: finalStatus,
    generatedAt: new Date().toISOString(),
    pipeline: [
      "kumamoto-disaster-x-feed: Fetch X Posts (*/30 UTC cron)",
      "kumamoto-disaster-x-feed: commit data/posts.json",
      "kumamoto-disaster-x-feed: repository_dispatch -> portal (non-blocking when token missing)",
      "kumamoto-disaster-portal: sync-x-feed job (fail-open, retains stale preview)",
      "kumamoto-disaster-portal: publish-x-feed-preview job (validate/build/commit)",
      "Render: autoDeploy on main push"
    ],
    required_secrets: {
      "kumamoto-disaster-x-feed": ["X_API_BEARER_TOKEN", "PORTAL_DISPATCH_TOKEN"],
      "kumamoto-disaster-portal": ["GITHUB_TOKEN (default)"]
    },
    sections: sections,
    warnings: warnings,
    failures: failures
  };

  const outDir = path.join(ROOT, "data", "operation");
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  fs.writeFileSync(
    path.join(outDir, "phase28-pipeline-audit.json"),
    JSON.stringify(output, null, 2) + "\n",
    "utf8"
  );

  console.log("=== PHASE28 Force Update Pipeline Audit ===");
  console.log(JSON.stringify(output, null, 2));

  if (finalStatus === "FAIL") {
    process.exit(1);
  }
}

main();
