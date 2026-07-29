#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const STATUS_PATH = path.join(ROOT, "data", "public", "status.json");

const { readPublicStatus, validatePublicStatus } = require("../monitor/public-status");

function main() {
  const errors = [];
  const status = readPublicStatus();

  if (!fs.existsSync(STATUS_PATH)) {
    errors.push("Missing data/public/status.json");
  }

  if (!status) {
    errors.push("status.json parse failed");
  } else {
    errors.push.apply(errors, validatePublicStatus(status));
  }

  const appJs = fs.readFileSync(path.join(ROOT, "js", "app.js"), "utf8");
  if (!appJs.includes('loadJson("status.json")')) {
    errors.push("app.js does not load status.json");
  }
  if (appJs.includes("getLatestCollectedAt")) {
    errors.push("app.js still uses getLatestCollectedAt for header");
  }
  if (!appJs.includes("publicStatus.last_patrol_at")) {
    errors.push("app.js does not use publicStatus.last_patrol_at");
  }

  const result = {
    STATUS_JSON: errors.length === 0 ? "PASS" : "FAIL",
    HEADER_TIME_SOURCE: "status.json",
    CARD_UPDATE_SOURCE: "displayed_updated_at",
    AUTO_PUBLICATION: false,
    status: status || null,
    errors
  };

  console.log("=== Public Status Validation ===");
  console.log(JSON.stringify(result, null, 2));

  if (errors.length > 0) {
    process.exit(1);
  }
}

main();
