#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");

const ROOT = path.join(__dirname, "..");

const {
  applySupportServicePublicUpdates,
  applySupportServiceQueueItem,
  buildApplyQueueItemFromReviewItem,
  createEmptyApplyQueue,
  createEmptyPublicSupportInformation,
  toPublicInformationEntry,
  AUTO_PUBLISH
} = require(path.join(ROOT, "monitor", "support-service-public-apply"));

const {
  recordApplyAuditEntry,
  resolveApplyTraceChain,
  validateAuditLog,
  validatePublicVersion,
  createEmptyAuditLog,
  createEmptyPublicVersion,
  writeAuditLog,
  writePublicVersion,
  loadAuditLog,
  loadPublicVersion
} = require(path.join(ROOT, "monitor", "support-service-public-audit"));

const {
  buildDisasterSearchIndex,
  searchDisasterIndex
} = require(path.join(ROOT, "monitor", "disaster-search-index-engine"));

const PUBLIC_WATER_FILES = [
  "data/water_search_index.json",
  "data/public/water_search_index.json",
  "data/water_cross_view.json",
  "data/public/water_cross_view.json"
];

function hashFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ss-audit-"));
}

function writeTempJson(dir, name, data) {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
  return filePath;
}

function baseInformation(overrides) {
  return Object.assign(
    {
      information_id: "SSINF-AUD0001",
      source_id: "SSRC-AUD0001",
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
      status: "ACTIVE",
      source_url: "https://example.invalid/support-service/audit"
    },
    overrides || {}
  );
}

function baseReviewItem(overrides) {
  return Object.assign(
    {
      review_id: "SSREV-AUD0001",
      queue_id: "SSREV-AUD0001",
      change_id: "SSCHG-AUD0001",
      information_id: "SSINF-AUD0001",
      category: "SUPPORT_SERVICE",
      change_type: "NEW",
      status: "APPROVED",
      source_id: "SSRC-AUD0001",
      before: {},
      after: {
        title: "無料シャワー",
        subcategory: "BATH",
        facility_name: "熊本市総合体育館",
        address: "熊本県熊本市中央区",
        opening_type: "FREE_OPEN",
        available_from: "2026-07-28",
        available_until: "UNKNOWN",
        status: "ACTIVE"
      },
      detected_at: "2026-07-31T03:00:00.000Z",
      reviewer: "fixture-reviewer",
      reviewed_at: "2026-07-31T03:00:00.000Z"
    },
    overrides || {}
  );
}

function runFixtureCase(name, fn) {
  const result = fn();
  return {
    case: name,
    pass: result.pass,
    detail: result.detail || null
  };
}

function main() {
  const errors = [];
  const checks = [];

  [
    "monitor/support-service-public-audit.js",
    "monitor/support-service-public-apply.js",
    "data/support_service_discovery/support_service_public_audit_log.json",
    "data/support_service_discovery/support_service_public_version.json"
  ].forEach(function (file) {
    const exists = fs.existsSync(path.join(ROOT, file));
    checks.push({ check: "file exists: " + file, pass: exists });
    if (!exists) {
      errors.push("Missing file: " + file);
    }
  });

  const publicHashesBefore = {};
  PUBLIC_WATER_FILES.forEach(function (file) {
    const fullPath = path.join(ROOT, file);
    if (fs.existsSync(fullPath)) {
      publicHashesBefore[file] = hashFile(fullPath);
    }
  });

  const waterSearchIndex = JSON.parse(
    fs.readFileSync(path.join(ROOT, "data", "public", "water_search_index.json"), "utf8")
  );
  const indexBefore = buildDisasterSearchIndex();
  const categoriesBefore = {};
  indexBefore.index.forEach(function (entry) {
    categoriesBefore[entry.category] = (categoriesBefore[entry.category] || 0) + 1;
  });

  const case1 = runFixtureCase("case1 add apply audit", function () {
    const tempDir = makeTempDir();
    const publicPath = writeTempJson(tempDir, "support_information.json", createEmptyPublicSupportInformation());
    const auditPath = writeTempJson(tempDir, "audit_log.json", createEmptyAuditLog());
    const versionPath = writeTempJson(tempDir, "version.json", createEmptyPublicVersion());
    const reviewQueue = {
      items: [
        baseReviewItem({
          information_id: "SSINF-ADDAUD1",
          queue_id: "SSREV-ADDAUD1",
          change_id: "SSCHG-ADDAUD1",
          source_id: "SSRC-ADDAUD1"
        })
      ]
    };
    const applyQueue = createEmptyApplyQueue();
    applyQueue.items.push(
      buildApplyQueueItemFromReviewItem(reviewQueue.items[0], {
        approvedSourcePrefix: "fixture:case1"
      })
    );
    applyQueue.item_count = applyQueue.items.length;
    const applyQueuePath = writeTempJson(tempDir, "apply_queue.json", applyQueue);

    const result = applySupportServicePublicUpdates({
      inputPath: publicPath,
      outputPath: publicPath,
      auditLogPath: auditPath,
      publicVersionPath: versionPath,
      applyQueuePath: applyQueuePath,
      reviewQueuePath: writeTempJson(tempDir, "review_queue.json", reviewQueue),
      candidatesPath: writeTempJson(tempDir, "candidates.json", {
        informations: [
          baseInformation({
            information_id: "SSINF-ADDAUD1",
            source_id: "SSRC-ADDAUD1"
          })
        ]
      })
    });

    const auditLog = loadAuditLog({ inputPath: auditPath });
    const auditEntry = auditLog.audit_entries[0];
    const publicPayload = JSON.parse(fs.readFileSync(publicPath, "utf8"));

    return {
      pass:
        result.ok === true &&
        result.auditEntryCount === 1 &&
        auditEntry &&
        auditEntry.action === "ADD" &&
        auditEntry.status === "SUCCESS" &&
        publicPayload.informations.length === 1 &&
        publicPayload.informations[0].apply_trace &&
        publicPayload.informations[0].apply_trace.apply_id === auditEntry.apply_id,
      detail: {
        result: result,
        auditEntry: auditEntry
      }
    };
  });
  checks.push(case1);
  if (!case1.pass) {
    errors.push("case1 failed: ADD apply must generate audit entry");
  }

  const case2 = runFixtureCase("case2 update apply before after", function () {
    const tempDir = makeTempDir();
    const publicPayload = createEmptyPublicSupportInformation();
    publicPayload.informations.push(
      toPublicInformationEntry(
        baseInformation({
          information_id: "SSINF-UPDAUD1",
          title: "旧タイトル",
          available_until: "UNKNOWN"
        })
      )
    );
    const publicPath = writeTempJson(tempDir, "support_information.json", publicPayload);
    const auditPath = writeTempJson(tempDir, "audit_log.json", createEmptyAuditLog());
    const versionPath = writeTempJson(tempDir, "version.json", createEmptyPublicVersion());
    const reviewQueue = {
      items: [
        baseReviewItem({
          queue_id: "SSREV-UPDAUD1",
          review_id: "SSREV-UPDAUD1",
          change_id: "SSCHG-UPDAUD1",
          information_id: "SSINF-UPDAUD1",
          change_type: "UPDATED",
          source_id: "SSRC-UPDAUD1",
          before: {
            available_until: "UNKNOWN"
          },
          after: {
            title: "更新タイトル",
            subcategory: "BATH",
            facility_name: "熊本市総合体育館",
            address: "熊本県熊本市中央区",
            opening_type: "FREE_OPEN",
            available_from: "2026-07-28",
            available_until: "2026-08-02",
            status: "ACTIVE"
          }
        })
      ]
    };
    const applyQueue = createEmptyApplyQueue();
    applyQueue.items.push(
      buildApplyQueueItemFromReviewItem(reviewQueue.items[0], {
        approvedSourcePrefix: "fixture:case2"
      })
    );
    applyQueue.item_count = applyQueue.items.length;
    const applyQueuePath = writeTempJson(tempDir, "apply_queue.json", applyQueue);

    const result = applySupportServicePublicUpdates({
      inputPath: publicPath,
      outputPath: publicPath,
      auditLogPath: auditPath,
      publicVersionPath: versionPath,
      applyQueuePath: applyQueuePath,
      reviewQueuePath: writeTempJson(tempDir, "review_queue.json", reviewQueue),
      candidatesPath: writeTempJson(tempDir, "candidates.json", {
        informations: [
          baseInformation({
            information_id: "SSINF-UPDAUD1",
            source_id: "SSRC-UPDAUD1",
            title: "旧タイトル"
          })
        ]
      })
    });

    const auditLog = loadAuditLog({ inputPath: auditPath });
    const auditEntry = auditLog.audit_entries[0];

    return {
      pass:
        result.ok === true &&
        auditEntry &&
        auditEntry.action === "UPDATE" &&
        auditEntry.before.available_until === "UNKNOWN" &&
        auditEntry.after.available_until === "2026-08-02",
      detail: auditEntry
    };
  });
  checks.push(case2);
  if (!case2.pass) {
    errors.push("case2 failed: UPDATE apply must preserve before/after");
  }

  const case3 = runFixtureCase("case3 expire apply history", function () {
    const tempDir = makeTempDir();
    const publicPayload = createEmptyPublicSupportInformation();
    publicPayload.informations.push(
      toPublicInformationEntry(
        baseInformation({
          information_id: "SSINF-EXPAUD1",
          status: "ACTIVE"
        })
      )
    );
    const publicPath = writeTempJson(tempDir, "support_information.json", publicPayload);
    const auditPath = writeTempJson(tempDir, "audit_log.json", createEmptyAuditLog());
    const versionPath = writeTempJson(tempDir, "version.json", createEmptyPublicVersion());
    const reviewQueue = {
      items: [
        baseReviewItem({
          queue_id: "SSREV-EXPAUD1",
          review_id: "SSREV-EXPAUD1",
          change_id: "SSCHG-EXPAUD1",
          information_id: "SSINF-EXPAUD1",
          change_type: "ENDED",
          source_id: "SSRC-EXPAUD1",
          before: {
            status: "ACTIVE",
            available_until: "UNKNOWN"
          },
          after: {
            title: "無料シャワー",
            subcategory: "BATH",
            facility_name: "熊本市総合体育館",
            address: "熊本県熊本市中央区",
            opening_type: "FREE_OPEN",
            available_from: "2026-07-28",
            available_until: "2026-07-30",
            status: "EXPIRED"
          }
        })
      ]
    };
    const applyQueue = createEmptyApplyQueue();
    applyQueue.items.push(
      buildApplyQueueItemFromReviewItem(reviewQueue.items[0], {
        approvedSourcePrefix: "fixture:case3"
      })
    );
    applyQueue.item_count = applyQueue.items.length;
    const applyQueuePath = writeTempJson(tempDir, "apply_queue.json", applyQueue);

    const result = applySupportServicePublicUpdates({
      inputPath: publicPath,
      outputPath: publicPath,
      auditLogPath: auditPath,
      publicVersionPath: versionPath,
      applyQueuePath: applyQueuePath,
      reviewQueuePath: writeTempJson(tempDir, "review_queue.json", reviewQueue),
      candidatesPath: writeTempJson(tempDir, "candidates.json", {
        informations: [
          baseInformation({
            information_id: "SSINF-EXPAUD1",
            source_id: "SSRC-EXPAUD1",
            status: "ACTIVE"
          })
        ]
      })
    });

    const auditLog = loadAuditLog({ inputPath: auditPath });
    const auditEntry = auditLog.audit_entries[0];
    const updatedPublic = JSON.parse(fs.readFileSync(publicPath, "utf8"));

    return {
      pass:
        result.ok === true &&
        auditEntry &&
        auditEntry.action === "EXPIRE" &&
        auditEntry.before.status === "ACTIVE" &&
        auditEntry.after.status === "EXPIRED" &&
        updatedPublic.informations[0].status === "EXPIRED",
      detail: auditEntry
    };
  });
  checks.push(case3);
  if (!case3.pass) {
    errors.push("case3 failed: EXPIRE apply must preserve expire history");
  }

  const case4 = runFixtureCase("case4 failed apply public unchanged", function () {
    const tempDir = makeTempDir();
    const publicPayload = createEmptyPublicSupportInformation();
    const publicPath = writeTempJson(tempDir, "support_information.json", publicPayload);
    const auditPath = writeTempJson(tempDir, "audit_log.json", createEmptyAuditLog());
    const versionPath = writeTempJson(tempDir, "version.json", createEmptyPublicVersion());
    const reviewQueue = {
      items: [
        baseReviewItem({
          information_id: "SSINF-FAILAUD1",
          queue_id: "SSREV-FAILAUD1",
          change_id: "SSCHG-FAILAUD1",
          source_id: "SSRC-FAILAUD1",
          status: "REVIEWING"
        })
      ]
    };
    const applyQueue = createEmptyApplyQueue();
    applyQueue.items.push(
      buildApplyQueueItemFromReviewItem(
        Object.assign({}, reviewQueue.items[0], { status: "APPROVED" }),
        { approvedSourcePrefix: "fixture:case4" }
      )
    );
    applyQueue.items[0].queue_id = reviewQueue.items[0].queue_id;
    applyQueue.item_count = applyQueue.items.length;
    const applyQueuePath = writeTempJson(tempDir, "apply_queue.json", applyQueue);
    const publicBefore = fs.readFileSync(publicPath, "utf8");

    const result = applySupportServicePublicUpdates({
      inputPath: publicPath,
      outputPath: publicPath,
      auditLogPath: auditPath,
      publicVersionPath: versionPath,
      applyQueuePath: applyQueuePath,
      reviewQueuePath: writeTempJson(tempDir, "review_queue.json", reviewQueue),
      candidatesPath: writeTempJson(tempDir, "candidates.json", {
        informations: [
          baseInformation({
            information_id: "SSINF-FAILAUD1",
            source_id: "SSRC-FAILAUD1"
          })
        ]
      })
    });

    const auditLog = loadAuditLog({ inputPath: auditPath });
    const auditEntry = auditLog.audit_entries[0];
    const publicAfter = fs.readFileSync(publicPath, "utf8");

    return {
      pass:
        result.failedCount === 1 &&
        auditEntry &&
        auditEntry.status === "FAILED" &&
        publicAfter === publicBefore &&
        JSON.parse(publicAfter).informations.length === 0,
      detail: {
        result: result,
        auditEntry: auditEntry
      }
    };
  });
  checks.push(case4);
  if (!case4.pass) {
    errors.push("case4 failed: FAILED apply must not change public data");
  }

  const case5 = runFixtureCase("case5 trace to source", function () {
    const auditLog = createEmptyAuditLog();
    const queueItem = {
      apply_id: "SSAPL-TRACE0001",
      information_id: "SSINF-TRACE01",
      action: "UPDATE",
      approved_source: "fixture:case5",
      approved_at: "2026-07-31T03:00:00.000Z",
      status: "PENDING",
      queue_id: "SSREV-TRACE01",
      change_id: "SSCHG-TRACE01"
    };
    const reviewItem = baseReviewItem({
      review_id: "SSREV-TRACE01",
      queue_id: "SSREV-TRACE01",
      change_id: "SSCHG-TRACE01",
      information_id: "SSINF-TRACE01",
      source_id: "SSRC-TRACE01",
      change_type: "UPDATED",
      status: "APPROVED",
      after: {
        title: "更新タイトル",
        subcategory: "BATH",
        facility_name: "熊本市総合体育館",
        address: "熊本県熊本市中央区",
        opening_type: "FREE_OPEN",
        available_from: "2026-07-28",
        available_until: "2026-08-02",
        status: "ACTIVE"
      }
    });
    const publicPayload = createEmptyPublicSupportInformation();
    publicPayload.informations.push(
      toPublicInformationEntry(
        baseInformation({
          information_id: "SSINF-TRACE01",
          source_id: "SSRC-TRACE01"
        })
      )
    );
    const applyResult = applySupportServiceQueueItem(
      queueItem,
      publicPayload,
      { items: [reviewItem] },
      {
        "SSINF-TRACE01": baseInformation({
          information_id: "SSINF-TRACE01",
          source_id: "SSRC-TRACE01"
        })
      }
    );
    recordApplyAuditEntry({
      auditLog: auditLog,
      queueItem: queueItem,
      reviewItem: reviewItem,
      applyResult: applyResult,
      publicPayload: createEmptyPublicSupportInformation()
    });

    const chain = resolveApplyTraceChain(auditLog, "SSINF-TRACE01");
    const trace = chain[0];

    return {
      pass:
        applyResult.ok === true &&
        trace &&
        trace.apply_id === "SSAPL-TRACE0001" &&
        trace.review_id === "SSREV-TRACE01" &&
        trace.change_id === "SSCHG-TRACE01" &&
        trace.source_id === "SSRC-TRACE01",
      detail: trace
    };
  });
  checks.push(case5);
  if (!case5.pass) {
    errors.push("case5 failed: trace chain must reach source_id");
  }

  const committedAuditLog = loadAuditLog();
  const committedVersion = loadPublicVersion();
  const auditErrors = validateAuditLog(committedAuditLog);
  const versionErrors = validatePublicVersion(committedVersion);
  checks.push({
    check: "committed audit log schema valid",
    pass: auditErrors.length === 0,
    errors: auditErrors
  });
  checks.push({
    check: "committed public version schema valid",
    pass: versionErrors.length === 0,
    errors: versionErrors
  });
  errors.push.apply(errors, auditErrors);
  errors.push.apply(errors, versionErrors);

  const indexAfter = buildDisasterSearchIndex();
  const categoriesAfter = {};
  indexAfter.index.forEach(function (entry) {
    categoriesAfter[entry.category] = (categoriesAfter[entry.category] || 0) + 1;
  });

  checks.push({
    check: "case6 WATER index count preserved",
    pass: categoriesAfter.WATER === waterSearchIndex.item_count,
    waterCount: categoriesAfter.WATER,
    expectedWaterCount: waterSearchIndex.item_count
  });
  checks.push({
    check: "case6 VOLUNTEER index count preserved",
    pass: categoriesAfter.VOLUNTEER === 20,
    volunteerCount: categoriesAfter.VOLUNTEER
  });
  checks.push({
    check: "case6 SUPPORT_SERVICE search preserved",
    pass: categoriesAfter.SUPPORT_SERVICE === 5,
    supportServiceCount: categoriesAfter.SUPPORT_SERVICE
  });

  if (categoriesAfter.WATER !== waterSearchIndex.item_count) {
    errors.push("case6 failed: WATER count changed");
  }
  if (categoriesAfter.VOLUNTEER !== 20) {
    errors.push("case6 failed: VOLUNTEER count changed");
  }
  if (categoriesAfter.SUPPORT_SERVICE !== 5) {
    errors.push("case6 failed: SUPPORT_SERVICE count changed");
  }

  const supportShowerResults = searchDisasterIndex(indexAfter, "シャワー", {
    category: "SUPPORT_SERVICE"
  });
  checks.push({
    check: "case6 SUPPORT_SERVICE shower search preserved",
    pass: supportShowerResults.length > 0,
    showerCount: supportShowerResults.length
  });
  if (!supportShowerResults.length) {
    errors.push("case6 failed: SUPPORT_SERVICE shower search broken");
  }

  PUBLIC_WATER_FILES.forEach(function (file) {
    const fullPath = path.join(ROOT, file);
    if (!fs.existsSync(fullPath) || !publicHashesBefore[file]) {
      return;
    }
    const pass = hashFile(fullPath) === publicHashesBefore[file];
    checks.push({ check: "case6 untouched file: " + file, pass: pass });
    if (!pass) {
      errors.push("case6 failed: protected file changed during validation: " + file);
    }
  });

  checks.push({
    check: "AUTO_PUBLISH false",
    pass:
      AUTO_PUBLISH === false &&
      committedAuditLog.AUTO_PUBLISH === false &&
      committedVersion.AUTO_PUBLISH === false
  });
  if (AUTO_PUBLISH !== false) {
    errors.push("AUTO_PUBLISH must remain false");
  }

  const output = {
    SUPPORT_SERVICE_PUBLIC_AUDIT_VALIDATION: errors.length === 0 ? "PASS" : "FAIL",
    AUTO_PUBLISH: false,
    indexCategoriesBefore: categoriesBefore,
    indexCategoriesAfter: categoriesAfter,
    checks: checks,
    errors: errors
  };

  console.log("=== SUPPORT_SERVICE Public Audit Validation (Phase24) ===");
  console.log(JSON.stringify(output, null, 2));

  if (errors.length) {
    process.exit(1);
  }

  console.log("PHASE24_SUPPORT_SERVICE_PUBLIC_AUDIT_COMPLETE");
}

main();
