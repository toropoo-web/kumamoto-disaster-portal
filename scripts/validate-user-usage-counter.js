#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const {
  COUNTER_FILE,
  EVENT_LOG_FILE,
  USAGE_EVENTS,
  recordUsageEvent,
  validateUserUsageCounter,
  writeUserUsageCounter,
  buildUserUsageCounter,
  getJstDateString
} = require("../monitor/user-usage-counter");
const { createPortalServer } = require("../server/portal-server");

function check(name, pass, detail, errors, checks) {
  checks.push({ check: name, pass: pass, detail: detail || null });
  if (!pass) {
    errors.push(name + (detail ? ": " + detail : ""));
  }
}

function main() {
  const errors = [];
  const checks = [];
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "user-usage-counter-"));
  const tempLog = path.join(tempDir, "user-usage-event-log.json");
  const tempCounter = path.join(tempDir, "user-usage-counter.json");

  check(
    "engine file exists",
    fs.existsSync(path.join(ROOT, "monitor", "user-usage-counter.js")),
    null,
    errors,
    checks
  );
  check(
    "beacon file exists",
    fs.existsSync(path.join(ROOT, "js", "user-usage-beacon.js")),
    null,
    errors,
    checks
  );
  check(
    "portal server exists",
    fs.existsSync(path.join(ROOT, "server", "portal-server.js")),
    null,
    errors,
    checks
  );

  const appJs = fs.readFileSync(path.join(ROOT, "js", "app.js"), "utf8");
  check("page_view hook", /trackUsage\("page_view"\)/.test(appJs), null, errors, checks);
  check("search_water hook", /trackUsage\("search_water"\)/.test(appJs), null, errors, checks);
  check("view_water_detail hook", /trackUsage\("view_water_detail"\)/.test(appJs), null, errors, checks);
  check("search_volunteer hook", /trackUsage\("search_volunteer"\)/.test(appJs), null, errors, checks);
  check(
    "search_support_service hook",
    /trackUsage\("search_support_service"\)/.test(appJs),
    null,
    errors,
    checks
  );
  check(
    "view_communication hook",
    /trackUsage\("view_communication"\)/.test(appJs),
    null,
    errors,
    checks
  );
  check(
    "view_official_info hook",
    /trackUsage\("view_official_info"\)/.test(appJs),
    null,
    errors,
    checks
  );

  const indexHtml = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  check(
    "beacon loaded in index",
    indexHtml.indexOf("user-usage-beacon.js") !== -1,
    null,
    errors,
    checks
  );

  const adminHtml = fs.readFileSync(path.join(ROOT, "admin", "internal-operation", "index.html"), "utf8");
  check("admin usage section", adminHtml.indexOf("利用実績") !== -1, null, errors, checks);

  Object.keys(USAGE_EVENTS).forEach(function (eventName) {
    const result = recordUsageEvent(eventName, {
      logPath: tempLog,
      counterPath: tempCounter,
      recordedAt: "2026-07-31T13:00:00.000Z"
    });
    check("event fires: " + eventName, result.ok, result.error || null, errors, checks);
  });

  const report = buildUserUsageCounter({ logPath: tempLog, generatedAt: "2026-07-31T13:00:00.000Z" });
  check("page_views counted", report.page_views === 1, "expected 1 got " + report.page_views, errors, checks);
  check(
    "water_search counted",
    report.events.water_search === 1,
    "expected 1 got " + report.events.water_search,
    errors,
    checks
  );
  check(
    "volunteer_search counted",
    report.events.volunteer_search === 1,
    null,
    errors,
    checks
  );
  check("last_access_at present", Boolean(report.last_access_at), null, errors, checks);
  check(
    "today_key uses JST",
    getJstDateString(new Date("2026-07-31T16:00:00.000Z")) === "2026-08-01",
    null,
    errors,
    checks
  );
  check(
    "today_views uses JST boundary",
    buildUserUsageCounter({
      logPath: tempLog,
      generatedAt: "2026-07-31T16:00:00.000Z"
    }).today_key === "2026-08-01",
    null,
    errors,
    checks
  );

  const server = createPortalServer();
  server.listen(0, function () {
    const port = server.address().port;
    const counterUrl = "http://127.0.0.1:" + port + "/api/usage-counter";
    const eventUrl = "http://127.0.0.1:" + port + "/api/usage-event";

    fetch(eventUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "page_view" })
    })
      .then(function (response) {
        check("usage-event API", response.ok, "status " + response.status, errors, checks);
        return fetch(counterUrl, { cache: "no-store" });
      })
      .then(function (response) {
        check("usage-counter API", response.ok, "status " + response.status, errors, checks);
        return response.json();
      })
      .then(function (payload) {
        check(
          "usage-counter API schema",
          payload && payload.view_type === "USER_USAGE_COUNTER",
          null,
          errors,
          checks
        );
        server.close(finish);
      })
      .catch(function (err) {
        check("usage-counter API", false, err.message, errors, checks);
        server.close(finish);
      });
  });

  function finish() {
    const schemaErrors = validateUserUsageCounter(report);
  check("counter schema", schemaErrors.length === 0, schemaErrors.join("; "), errors, checks);
  check("no cookies flag", report.constraints && report.constraints.no_cookies === true, null, errors, checks);
  check("no ip storage flag", report.constraints && report.constraints.no_ip_storage === true, null, errors, checks);

  const writeResult = writeUserUsageCounter({ logPath: tempLog, counterPath: tempCounter });
  check("counter write", writeResult.ok, (writeResult.errors || []).join("; "), errors, checks);

  const productionWrite = writeUserUsageCounter();
  check("production counter file", fs.existsSync(COUNTER_FILE), null, errors, checks);

  const requiredScripts = [
    "validate-x-feed-fail-open.js",
    "validate-x-feed-preview.js",
    "validate-water-search.js",
    "validate-patrol.js"
  ];

  requiredScripts.forEach(function (scriptName) {
    const result = spawnSync(process.execPath, [path.join(ROOT, "scripts", scriptName)], {
      cwd: ROOT,
      encoding: "utf8"
    });
    check(scriptName + " PASS", result.status === 0, null, errors, checks);
  });

  const buildResult = spawnSync(process.execPath, [path.join(ROOT, "scripts", "static-build.js")], {
    cwd: ROOT,
    encoding: "utf8"
  });
  check("npm run build PASS", buildResult.status === 0, null, errors, checks);

  const output = {
    PHASE39B2_USER_USAGE_COUNTER: errors.length === 0 ? "PASS" : "FAIL",
    page_views: report.page_views,
    today_views: report.today_views,
    events: report.events,
    checks: checks,
    errors: errors
  };

  console.log("=== User Usage Counter Validation ===");
  console.log(JSON.stringify(output, null, 2));

  if (errors.length > 0) {
    process.exit(1);
  }

  console.log("PHASE39B2_USER_USAGE_COUNTER_VALIDATION_COMPLETE");
  }
}

main();
