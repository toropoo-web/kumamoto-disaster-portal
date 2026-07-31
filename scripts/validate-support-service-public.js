#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");

const {
  buildSupportServiceApplyQueue,
  applySupportServicePublicUpdates,
  applySupportServiceQueueItem,
  buildApplyQueueItemFromReviewItem,
  validateSupportServiceApplyQueue,
  validatePublicSupportInformation,
  createEmptyApplyQueue,
  createEmptyPublicSupportInformation,
  toPublicInformationEntry,
  AUTO_PUBLISH
} = require(path.join(ROOT, "monitor", "support-service-public-apply"));

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

const PHASE1_FILES = ["data/public/phase1_updates.json"];

function hashFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function baseInformation(overrides) {
  return Object.assign(
    {
      information_id: "SSINF-TEST0001",
      source_id: "SSRC-TEST0001",
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
      source_url: "https://example.invalid/support-service/test"
    },
    overrides || {}
  );
}

function baseReviewItem(overrides) {
  return Object.assign(
    {
      review_id: "SSREV-TEST0001",
      queue_id: "SSREV-TEST0001",
      change_id: "SSCHG-TEST0001",
      information_id: "SSINF-TEST0001",
      category: "SUPPORT_SERVICE",
      change_type: "NEW",
      status: "APPROVED",
      source_id: "SSRC-TEST0001",
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
      auto_publish: false,
      reviewer: "fixture-reviewer",
      reviewed_at: "2026-07-31T03:00:00.000Z",
      review_note: "fixture approved"
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
    "monitor/support-service-public-apply.js",
    "data/support_service_discovery/support_service_apply_queue.json",
    "data/public/support_information.json",
    "scripts/build-support-service-apply-queue.js",
    "scripts/apply-support-service-public.js"
  ].forEach(function (file) {
    const exists = fs.existsSync(path.join(ROOT, file));
    checks.push({ check: "file exists: " + file, pass: exists });
    if (!exists) {
      errors.push("Missing file: " + file);
    }
  });

  const publicHashesBefore = {};
  PUBLIC_WATER_FILES.concat(PHASE1_FILES).forEach(function (file) {
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

  const case1 = runFixtureCase("case1 approved add", function () {
    const publicPayload = createEmptyPublicSupportInformation();
    const reviewQueue = { items: [baseReviewItem({ information_id: "SSINF-ADD0001" })] };
    reviewQueue.items[0].after.title = "新規支援拠点";
    const applyQueue = createEmptyApplyQueue();
    applyQueue.items.push(
      buildApplyQueueItemFromReviewItem(reviewQueue.items[0], {
        approvedSourcePrefix: "fixture:case1"
      })
    );
    const informationLookup = {
      "SSINF-ADD0001": baseInformation({
        information_id: "SSINF-ADD0001",
        source_id: "SSRC-ADD0001",
        title: "新規支援拠点"
      })
    };
    const result = applySupportServiceQueueItem(
      applyQueue.items[0],
      publicPayload,
      reviewQueue,
      informationLookup
    );
    return {
      pass:
        result.ok === true &&
        publicPayload.informations.length === 1 &&
        publicPayload.informations[0].title === "新規支援拠点",
      detail: result
    };
  });
  checks.push(case1);
  if (!case1.pass) {
    errors.push("case1 failed: APPROVED + ADD must add public information");
  }

  const case2 = runFixtureCase("case2 approved update", function () {
    const publicPayload = createEmptyPublicSupportInformation();
    publicPayload.informations.push(
      toPublicInformationEntry(
        baseInformation({
          information_id: "SSINF-UPD0001",
          title: "旧タイトル"
        })
      )
    );
    const reviewQueue = {
      items: [
        baseReviewItem({
          queue_id: "SSCRQ-UPD0001",
          information_id: "SSINF-UPD0001",
          change_type: "UPDATED",
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
    const informationLookup = {
      "SSINF-UPD0001": baseInformation({
        information_id: "SSINF-UPD0001",
        title: "旧タイトル"
      })
    };
    const result = applySupportServiceQueueItem(
      applyQueue.items[0],
      publicPayload,
      reviewQueue,
      informationLookup
    );
    return {
      pass:
        result.ok === true &&
        publicPayload.informations[0].title === "更新タイトル" &&
        publicPayload.informations[0].available_until === "2026-08-02",
      detail: result
    };
  });
  checks.push(case2);
  if (!case2.pass) {
    errors.push("case2 failed: APPROVED + UPDATE must update public information");
  }

  const case3 = runFixtureCase("case3 approved expire", function () {
    const publicPayload = createEmptyPublicSupportInformation();
    publicPayload.informations.push(
      toPublicInformationEntry(
        baseInformation({
          information_id: "SSINF-EXP0001",
          status: "ACTIVE"
        })
      )
    );
    const reviewQueue = {
      items: [
        baseReviewItem({
          queue_id: "SSCRQ-EXP0001",
          information_id: "SSINF-EXP0001",
          change_type: "ENDED",
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
    const informationLookup = {
      "SSINF-EXP0001": baseInformation({
        information_id: "SSINF-EXP0001",
        status: "ACTIVE"
      })
    };
    const result = applySupportServiceQueueItem(
      applyQueue.items[0],
      publicPayload,
      reviewQueue,
      informationLookup
    );
    return {
      pass:
        result.ok === true &&
        publicPayload.informations.length === 1 &&
        publicPayload.informations[0].status === "EXPIRED",
      detail: result
    };
  });
  checks.push(case3);
  if (!case3.pass) {
    errors.push("case3 failed: APPROVED + EXPIRE must retain EXPIRED status");
  }

  const case4 = runFixtureCase("case4 reviewing not applied", function () {
    const publicPayload = createEmptyPublicSupportInformation();
    const reviewQueue = {
      items: [
        baseReviewItem({
          information_id: "SSINF-REV0001",
          status: "REVIEWING"
        })
      ]
    };
    const applyQueue = createEmptyApplyQueue();
    applyQueue.items.push(
      buildApplyQueueItemFromReviewItem(
        Object.assign({}, reviewQueue.items[0], { status: "APPLIED" }),
        { approvedSourcePrefix: "fixture:case4" }
      )
    );
    applyQueue.items[0].queue_id = reviewQueue.items[0].queue_id;
    const result = applySupportServiceQueueItem(
      applyQueue.items[0],
      publicPayload,
      reviewQueue,
      {
        "SSINF-REV0001": baseInformation({ information_id: "SSINF-REV0001" })
      }
    );
    return {
      pass: result.ok === false && publicPayload.informations.length === 0,
      detail: result
    };
  });
  checks.push(case4);
  if (!case4.pass) {
    errors.push("case4 failed: REVIEWING must not apply");
  }

  const case5 = runFixtureCase("case5 rejected not applied", function () {
    const publicPayload = createEmptyPublicSupportInformation();
    const reviewQueue = {
      items: [
        baseReviewItem({
          information_id: "SSINF-REJ0001",
          status: "REJECTED"
        })
      ]
    };
    const applyQueue = createEmptyApplyQueue();
    applyQueue.items.push(
      buildApplyQueueItemFromReviewItem(
        Object.assign({}, reviewQueue.items[0], { status: "APPLIED" }),
        { approvedSourcePrefix: "fixture:case5" }
      )
    );
    applyQueue.items[0].queue_id = reviewQueue.items[0].queue_id;
    const result = applySupportServiceQueueItem(
      applyQueue.items[0],
      publicPayload,
      reviewQueue,
      {
        "SSINF-REJ0001": baseInformation({ information_id: "SSINF-REJ0001" })
      }
    );
    return {
      pass: result.ok === false && publicPayload.informations.length === 0,
      detail: result
    };
  });
  checks.push(case5);
  if (!case5.pass) {
    errors.push("case5 failed: REJECTED must not apply");
  }

  const applyQueueFromReview = buildSupportServiceApplyQueue({
    items: [
      baseReviewItem({ status: "APPLIED" }),
      baseReviewItem({ queue_id: "SSCRQ-REV0002", status: "REVIEWING" }),
      baseReviewItem({ queue_id: "SSCRQ-REJ0002", status: "REJECTED" })
    ]
  });
  checks.push({
    check: "apply queue only includes apply-ready review items",
    pass:
      applyQueueFromReview.item_count === 1 &&
      applyQueueFromReview.items[0].action === "ADD"
  });
  if (applyQueueFromReview.item_count !== 1) {
    errors.push("apply queue must include only apply-ready review items");
  }

  const applyQueueErrors = validateSupportServiceApplyQueue(applyQueueFromReview);
  checks.push({
    check: "apply queue schema valid",
    pass: applyQueueErrors.length === 0,
    errors: applyQueueErrors
  });
  errors.push.apply(errors, applyQueueErrors);

  const publicPayload = JSON.parse(
    fs.readFileSync(path.join(ROOT, "data", "public", "support_information.json"), "utf8")
  );
  const publicErrors = validatePublicSupportInformation(publicPayload);
  checks.push({
    check: "public support information schema valid",
    pass: publicErrors.length === 0,
    errors: publicErrors
  });
  errors.push.apply(errors, publicErrors);

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

  PUBLIC_WATER_FILES.concat(PHASE1_FILES).forEach(function (file) {
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
    pass: AUTO_PUBLISH === false && applyQueueFromReview.AUTO_PUBLISH === false
  });
  if (AUTO_PUBLISH !== false) {
    errors.push("AUTO_PUBLISH must remain false");
  }

  const output = {
    SUPPORT_SERVICE_PUBLIC_APPLY_VALIDATION: errors.length === 0 ? "PASS" : "FAIL",
    AUTO_PUBLISH: false,
    indexCategoriesBefore: categoriesBefore,
    indexCategoriesAfter: categoriesAfter,
    checks: checks,
    errors: errors
  };

  console.log("=== SUPPORT_SERVICE Public Apply Validation ===");
  console.log(JSON.stringify(output, null, 2));

  if (errors.length) {
    process.exit(1);
  }

  console.log("PHASE13_SUPPORT_SERVICE_PUBLIC_APPLY_COMPLETE");
}

main();
