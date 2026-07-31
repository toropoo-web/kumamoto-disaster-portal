#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");

const ROOT = path.join(__dirname, "..");

const {
  runSupportServicePatrol,
  loadSupportServicePatrolLog,
  validateSupportServicePatrolLog
} = require(path.join(ROOT, "monitor", "support-service-patrol-engine"));

const {
  compareSupportInformationChanges
} = require(path.join(ROOT, "monitor", "support-service-diff-engine"));

const {
  buildSupportServiceChangeQueue,
  validateSupportServiceChangeQueue
} = require(path.join(ROOT, "monitor", "support-service-change-queue"));

const {
  loadSupportServiceSourceRegistry,
  validateSupportServiceSourceRegistry
} = require(path.join(ROOT, "monitor", "support-service-source-registry"));

const {
  buildDisasterSearchIndex
} = require(path.join(ROOT, "monitor", "disaster-search-index-engine"));

const WORKFLOW_FILE = path.join(ROOT, ".github", "workflows", "support-service-patrol.yml");
const PATROL_LOG_FILE = path.join(
  ROOT,
  "data",
  "support_service_discovery",
  "support_service_patrol_log.json"
);
const CHANGE_QUEUE_FILE = path.join(
  ROOT,
  "data",
  "support_service_discovery",
  "support_service_change_queue.json"
);

const PUBLIC_WATER_FILES = [
  "data/water_search_index.json",
  "data/public/water_search_index.json",
  "data/water_cross_view.json",
  "data/public/water_cross_view.json"
];

const FORBIDDEN_WORKFLOW_COMMANDS = [
  "apply:support-service-public",
  "git push",
  "git commit",
  "auto-merge",
  "auto merge"
];

function hashFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function baseInformation(overrides) {
  return Object.assign(
    {
      information_id: "SSINF-CIPATROL01",
      source_id: "SSRC-7E2F4A91B0",
      category: "SUPPORT_SERVICE",
      subcategory: "BATH",
      subcategory_detail: "SHOWER",
      title: "無料シャワー",
      facility_name: "熊本市総合体育館",
      address: "熊本県熊本市中央区",
      municipality: "熊本市",
      opening_type: "FREE_OPEN",
      published_at: "2026-07-28",
      available_from: "2026-07-28",
      available_until: "UNKNOWN",
      checked_at: "2026-07-31T03:00:00.000Z",
      status: "ACTIVE"
    },
    overrides || {}
  );
}

function main() {
  const errors = [];
  const checks = [];

  const publicHashesBefore = {};
  PUBLIC_WATER_FILES.forEach(function (file) {
    const fullPath = path.join(ROOT, file);
    if (fs.existsSync(fullPath)) {
      publicHashesBefore[file] = hashFile(fullPath);
    }
  });

  const indexBefore = buildDisasterSearchIndex();
  const categoriesBefore = {};
  indexBefore.index.forEach(function (entry) {
    categoriesBefore[entry.category] = (categoriesBefore[entry.category] || 0) + 1;
  });

  checks.push({
    check: "case1 workflow file exists",
    pass: fs.existsSync(WORKFLOW_FILE)
  });
  if (!fs.existsSync(WORKFLOW_FILE)) {
    errors.push("case1 failed: missing .github/workflows/support-service-patrol.yml");
  }

  let workflowContent = "";
  if (fs.existsSync(WORKFLOW_FILE)) {
    workflowContent = fs.readFileSync(WORKFLOW_FILE, "utf8");
  }

  checks.push({
    check: "case1 workflow runs patrol:support-service",
    pass: /npm run patrol:support-service/.test(workflowContent)
  });
  if (!/npm run patrol:support-service/.test(workflowContent)) {
    errors.push("case1 failed: workflow must run npm run patrol:support-service");
  }

  checks.push({
    check: "case1 workflow runs npm test",
    pass: /npm test/.test(workflowContent)
  });
  if (!/npm test/.test(workflowContent)) {
    errors.push("case1 failed: workflow must run npm test");
  }

  const scheduleMatches = workflowContent.match(/cron:\s*"([^"]+)"/g) || [];
  checks.push({
    check: "case1 workflow schedule configured",
    pass: scheduleMatches.length >= 3,
    scheduleCount: scheduleMatches.length
  });
  if (scheduleMatches.length < 3) {
    errors.push("case1 failed: expected 3 scheduled cron entries");
  }

  const forbiddenHits = FORBIDDEN_WORKFLOW_COMMANDS.filter(function (command) {
    return workflowContent.toLowerCase().indexOf(command.toLowerCase()) !== -1;
  });
  checks.push({
    check: "case1 workflow blocks auto publish commands",
    pass: forbiddenHits.length === 0,
    forbiddenHits: forbiddenHits
  });
  forbiddenHits.forEach(function (command) {
    errors.push("case1 failed: forbidden workflow command detected: " + command);
  });

  checks.push({
    check: "case1 workflow artifact paths configured",
    pass:
      /support_service_patrol_log\.json/.test(workflowContent) &&
      /support_service_change_queue\.json/.test(workflowContent) &&
      /support_service_candidates\.json/.test(workflowContent)
  });
  if (
    !/support_service_patrol_log\.json/.test(workflowContent) ||
    !/support_service_change_queue\.json/.test(workflowContent) ||
    !/support_service_candidates\.json/.test(workflowContent)
  ) {
    errors.push("case1 failed: workflow artifact paths incomplete");
  }

  const sourceRegistry = loadSupportServiceSourceRegistry();
  const registryErrors = validateSupportServiceSourceRegistry(sourceRegistry);
  checks.push({
    check: "source registry valid for CI patrol",
    pass: registryErrors.length === 0,
    errors: registryErrors
  });
  errors.push.apply(errors, registryErrors);

  const tempDir = path.join(ROOT, "data", "support_service_discovery", "ci_patrol_temp");
  fs.mkdirSync(tempDir, { recursive: true });
  const tempLogPath = path.join(tempDir, "support_service_patrol_log.json");
  const tempChangeQueuePath = path.join(tempDir, "support_service_change_queue.json");
  const tempCandidatesPath = path.join(tempDir, "support_service_candidates.json");

  const patrolResult = runSupportServicePatrol({
    fixture: true,
    referenceDate: "2026-07-31",
    write: true,
    appendLog: false,
    logPath: tempLogPath,
    changeQueuePath: tempChangeQueuePath,
    candidatesOutputPath: tempCandidatesPath,
    currentInformation: {
      informations: []
    }
  });

  checks.push({
    check: "case2 patrol command execution",
    pass: patrolResult.status === "SUCCESS",
    status: patrolResult.status
  });
  if (patrolResult.status !== "SUCCESS") {
    errors.push("case2 failed: patrol command did not succeed");
  }

  const tempLog = loadSupportServicePatrolLog({ logPath: tempLogPath });
  const tempLogErrors = validateSupportServicePatrolLog(tempLog);
  const latestRun = (tempLog.runs || [])[(tempLog.runs || []).length - 1] || null;
  checks.push({
    check: "case2 patrol log generated",
    pass:
      tempLogErrors.length === 0 &&
      latestRun &&
      latestRun.run_id &&
      latestRun.executed_at &&
      latestRun.status === "SUCCESS",
    latestRun: latestRun
  });
  errors.push.apply(errors, tempLogErrors);
  if (!latestRun || !latestRun.run_id) {
    errors.push("case2 failed: patrol log missing run entry");
  }

  checks.push({
    check: "case3 new information creates change queue",
    pass:
      fs.existsSync(tempChangeQueuePath) &&
      patrolResult.change_count > 0 &&
      patrolResult.change_type_summary &&
      patrolResult.change_type_summary.NEW > 0,
    changeCount: patrolResult.change_count,
    changeTypeSummary: patrolResult.change_type_summary
  });
  if (!fs.existsSync(tempChangeQueuePath) || patrolResult.change_count <= 0) {
    errors.push("case3 failed: expected change queue generation for new information");
  }

  if (fs.existsSync(tempChangeQueuePath)) {
    const changeQueue = JSON.parse(fs.readFileSync(tempChangeQueuePath, "utf8"));
    const changeQueueErrors = validateSupportServiceChangeQueue(changeQueue);
    checks.push({
      check: "case3 change queue schema valid",
      pass: changeQueueErrors.length === 0,
      errors: changeQueueErrors
    });
    errors.push.apply(errors, changeQueueErrors);
    checks.push({
      check: "case3 AUTO_PUBLISH false in change queue",
      pass: changeQueue.AUTO_PUBLISH === false && changeQueue.auto_publish === false
    });
    if (changeQueue.AUTO_PUBLISH !== false) {
      errors.push("case3 failed: change queue AUTO_PUBLISH must be false");
    }
  }

  const unchangedEntry = baseInformation({ information_id: "SSINF-CIUNCHANGED1" });
  const unchangedDiff = compareSupportInformationChanges(
    [unchangedEntry],
    [Object.assign({}, unchangedEntry)]
  );
  const unchangedQueue = buildSupportServiceChangeQueue(
    [unchangedEntry],
    [Object.assign({}, unchangedEntry)]
  );
  checks.push({
    check: "case4 unchanged diff type",
    pass:
      unchangedDiff.changes.length === 1 && unchangedDiff.changes[0].change_type === "UNCHANGED"
  });
  checks.push({
    check: "case4 unchanged stored only",
    pass:
      unchangedQueue.change_type_summary.UNCHANGED === 1 &&
      unchangedQueue.reviewable_change_count === 0
  });
  if (unchangedDiff.changes[0] && unchangedDiff.changes[0].change_type !== "UNCHANGED") {
    errors.push("case4 failed: expected UNCHANGED diff");
  }
  if (unchangedQueue.reviewable_change_count !== 0) {
    errors.push("case4 failed: UNCHANGED must not enter reviewable queue");
  }

  let packageJson = {};
  try {
    packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  } catch (err) {
    errors.push("package.json read failed: " + err.message);
  }
  checks.push({
    check: "package patrol command exists",
    pass:
      packageJson.scripts &&
      typeof packageJson.scripts["patrol:support-service"] === "string" &&
      packageJson.scripts["patrol:support-service"].indexOf("run-support-service-patrol.js") !== -1
  });
  if (!packageJson.scripts || !packageJson.scripts["patrol:support-service"]) {
    errors.push("package.json missing patrol:support-service script");
  }

  if (fs.existsSync(PATROL_LOG_FILE)) {
    const committedLog = loadSupportServicePatrolLog();
    const committedLogErrors = validateSupportServicePatrolLog(committedLog);
    checks.push({
      check: "committed patrol log schema valid",
      pass: committedLogErrors.length === 0,
      errors: committedLogErrors
    });
    errors.push.apply(errors, committedLogErrors);
  }

  if (fs.existsSync(CHANGE_QUEUE_FILE)) {
    const committedQueue = JSON.parse(fs.readFileSync(CHANGE_QUEUE_FILE, "utf8"));
    const committedQueueErrors = validateSupportServiceChangeQueue(committedQueue);
    checks.push({
      check: "committed change queue schema valid",
      pass: committedQueueErrors.length === 0,
      errors: committedQueueErrors
    });
    errors.push.apply(errors, committedQueueErrors);
  }

  try {
    execSync("node scripts/run-support-service-patrol.js --fixture", {
      cwd: ROOT,
      stdio: "pipe",
      encoding: "utf8"
    });
    checks.push({
      check: "case2 patrol CLI command runnable",
      pass: true
    });
  } catch (err) {
    checks.push({
      check: "case2 patrol CLI command runnable",
      pass: false,
      stderr: String(err.stderr || err.message || "")
    });
    errors.push("case2 failed: patrol CLI command execution failed");
  }

  const indexAfter = buildDisasterSearchIndex();
  const categoriesAfter = {};
  indexAfter.index.forEach(function (entry) {
    categoriesAfter[entry.category] = (categoriesAfter[entry.category] || 0) + 1;
  });

  checks.push({
    check: "case5 WATER index count unchanged",
    pass: categoriesBefore.WATER === categoriesAfter.WATER,
    waterBefore: categoriesBefore.WATER,
    waterAfter: categoriesAfter.WATER
  });
  checks.push({
    check: "case5 VOLUNTEER index count unchanged",
    pass: categoriesBefore.VOLUNTEER === categoriesAfter.VOLUNTEER,
    volunteerBefore: categoriesBefore.VOLUNTEER,
    volunteerAfter: categoriesAfter.VOLUNTEER
  });
  if (categoriesBefore.WATER !== categoriesAfter.WATER) {
    errors.push("case5 failed: WATER index count changed");
  }
  if (categoriesBefore.VOLUNTEER !== categoriesAfter.VOLUNTEER) {
    errors.push("case5 failed: VOLUNTEER index count changed");
  }

  PUBLIC_WATER_FILES.forEach(function (file) {
    const fullPath = path.join(ROOT, file);
    if (!fs.existsSync(fullPath) || !publicHashesBefore[file]) {
      return;
    }
    const after = hashFile(fullPath);
    const pass = after === publicHashesBefore[file];
    checks.push({ check: "case5 water file unchanged: " + file, pass: pass });
    if (!pass) {
      errors.push("case5 failed: water file changed during validation: " + file);
    }
  });

  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch (cleanupError) {
    // ignore cleanup errors
  }

  const output = {
    SUPPORT_SERVICE_PATROL_CI_VALIDATION: errors.length === 0 ? "PASS" : "FAIL",
    AUTO_PUBLISH: false,
    workflowFile: ".github/workflows/support-service-patrol.yml",
    scheduleCount: scheduleMatches.length,
    patrolCandidateCount: patrolResult.candidate_count,
    patrolChangeCount: patrolResult.change_count,
    indexCategoriesBefore: categoriesBefore,
    indexCategoriesAfter: categoriesAfter,
    checks: checks,
    errors: errors
  };

  console.log("=== SUPPORT_SERVICE Patrol CI Validation (Phase21) ===");
  console.log(JSON.stringify(output, null, 2));

  if (errors.length) {
    process.exit(1);
  }

  console.log("PHASE21_SUPPORT_SERVICE_PATROL_CI_COMPLETE");
}

main();
