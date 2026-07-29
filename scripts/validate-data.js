#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data", "public");

const EXPECTED_AREA_COUNT = 14;
const EXPECTED_PUBLIC_CARD_COUNT = 19;

const ALLOWED_CATEGORIES = new Set([
  "EMERGENCY", "SHELTER", "WATER", "LIFELINE",
  "ROAD", "CERTIFICATE", "IMPACT", "SUPPORT"
]);

const EXCLUDED_STATUSES = new Set([
  "REQUIRES_MANUAL_REVIEW", "NOT_FOUND", "NOT_APPLICABLE",
  "ARCHIVED", "SUPERSEDED", "ACCESS_ERROR", "VERIFIED_NO_CURRENT_INFORMATION"
]);

const INCIDENT_SCOPE = "2026_KUMAMOTO_EARTHQUAKE";

const AREA_RULES = {
  KM000: { allowed: ["EMERGENCY", "IMPACT", "ROAD", "LIFELINE", "SUPPORT"], blocked: ["SHELTER", "WATER", "CERTIFICATE"] },
  KM001: { allowed: ["EMERGENCY", "SHELTER", "WATER", "LIFELINE", "CERTIFICATE", "SUPPORT"], blocked: ["ROAD"] },
  KM002: { allowed: ["EMERGENCY", "SHELTER", "WATER", "CERTIFICATE", "IMPACT"], blocked: ["ROAD", "LIFELINE"], blockedHeadlines: ["宇土市の被害状況"] },
  KM003: { allowed: ["EMERGENCY", "SHELTER", "WATER"], blocked: ["ROAD", "CERTIFICATE", "IMPACT", "SUPPORT"] },
  KM004: { allowed: [], requireDirectVerification: true },
  KM005: { allowed: ["EMERGENCY", "SHELTER", "WATER", "SUPPORT"], blocked: ["ROAD", "CERTIFICATE", "IMPACT", "LIFELINE"] },
  KM006: { allowed: ["EMERGENCY", "SHELTER", "WATER", "SUPPORT"], blocked: ["ROAD", "CERTIFICATE", "IMPACT", "LIFELINE"] },
  KM007: { allowed: ["EMERGENCY", "SHELTER", "WATER", "SUPPORT"], blocked: ["ROAD", "CERTIFICATE", "IMPACT", "LIFELINE"] },
  KM008: { allowed: ["EMERGENCY", "SHELTER", "WATER", "SUPPORT"], blocked: ["ROAD", "CERTIFICATE", "IMPACT", "LIFELINE"] },
  KM009: { allowed: ["EMERGENCY", "SHELTER", "WATER", "SUPPORT"], blocked: ["ROAD", "CERTIFICATE", "IMPACT", "LIFELINE"] },
  KM010: { allowed: ["EMERGENCY", "SHELTER", "WATER", "SUPPORT"], blocked: ["ROAD", "CERTIFICATE", "IMPACT", "LIFELINE"] },
  KM011: { allowed: ["EMERGENCY", "SHELTER", "WATER", "SUPPORT"], blocked: ["ROAD", "CERTIFICATE", "IMPACT", "LIFELINE"] },
  KM012: { allowed: ["EMERGENCY", "SHELTER", "WATER", "SUPPORT"], blocked: ["ROAD", "CERTIFICATE", "IMPACT", "LIFELINE"] },
  KM013: { allowed: ["EMERGENCY", "SHELTER", "WATER", "SUPPORT"], blocked: ["ROAD", "CERTIFICATE", "IMPACT", "LIFELINE"] }
};

const CONTAMINATION_PATTERNS = [/2016/, /平成28/, /H28/];

function readJson(filename) {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, filename), "utf8"));
}

function isPublicRecord(record) {
  if (record.verification_status !== "VERIFIED") return false;
  if (record.incident_scope !== INCIDENT_SCOPE) return false;
  if (!record.source_url || !record.headline) return false;
  return true;
}

function isAllowedForArea(record) {
  const rules = AREA_RULES[record.area_id];
  if (!rules) return false;
  if (rules.blockedHeadlines && rules.blockedHeadlines.includes(record.headline)) return false;
  if (rules.requireDirectVerification) return false;
  if (rules.allowed.length === 0) return false;
  if (rules.blocked.includes(record.public_category_id)) return false;
  return rules.allowed.includes(record.public_category_id);
}

function isValidUrlFormat(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function main() {
  const areas = readJson("phase1_areas.json");
  const navigation = readJson("phase1_navigation.json");
  const updates = readJson("phase1_updates.json");

  const errors = [];
  const areaIds = new Set();
  const updateIds = new Set();

  if (areas.length !== EXPECTED_AREA_COUNT) {
    errors.push(`公開地域数: ${areas.length} (期待値: ${EXPECTED_AREA_COUNT})`);
  }

  areas.forEach((area, i) => {
    if (!area.area_id || !area.name || !area.anchor) {
      errors.push(`地域 index ${i}: 必須フィールド欠落`);
    }
    if (areaIds.has(area.area_id)) {
      errors.push(`地域ID重複: ${area.area_id}`);
    }
    areaIds.add(area.area_id);
  });

  if (navigation.length !== EXPECTED_AREA_COUNT) {
    errors.push(`ナビゲーション数: ${navigation.length} (期待値: ${EXPECTED_AREA_COUNT})`);
  }

  navigation.forEach((item, i) => {
    const area = areas[i];
    if (!area || item.area_id !== area.area_id || item.name !== area.name || item.anchor !== area.anchor) {
      errors.push(`ナビゲーション不一致: index ${i}`);
    }
  });

  updates.forEach((record, i) => {
    const key = `${record.area_id}|${record.headline}|${record.source_url}`;
    if (updateIds.has(key)) {
      errors.push(`レコード重複: index ${i}`);
    }
    updateIds.add(key);

    if (!AREA_RULES[record.area_id] && record.area_id !== "KM004") {
      errors.push(`レコード${i}: 未定義 area_id=${record.area_id}`);
    }
    if (!ALLOWED_CATEGORIES.has(record.public_category_id)) {
      errors.push(`レコード${i}: 公開8カテゴリ以外 category=${record.public_category_id}`);
    }
    if (record.incident_scope && record.incident_scope !== INCIDENT_SCOPE) {
      errors.push(`レコード${i}: incident_scope不一致 (${record.incident_scope})`);
    }
    if (EXCLUDED_STATUSES.has(record.verification_status)) {
      errors.push(`レコード${i}: 除外ステータス (${record.verification_status})`);
    }

    const text = JSON.stringify(record);
    if (CONTAMINATION_PATTERNS.some((p) => p.test(text))) {
      errors.push(`レコード${i}: 2016年情報混入の疑い`);
    }
  });

  const publicRecords = updates.filter(isPublicRecord).filter(isAllowedForArea);
  const urlCounts = new Map();

  publicRecords.forEach((record, i) => {
    const label = record.headline || `index ${i}`;

    if (!record.source_url) {
      errors.push(`レコード「${label}」: source_url 欠落`);
    } else if (!isValidUrlFormat(record.source_url)) {
      errors.push(`レコード「${label}」: URL形式不正 (${record.source_url})`);
    }

    if (!record.headline || record.headline.trim() === "") {
      errors.push(`レコード${i}: 空見出し`);
    }

    if (!record.summary || record.summary.trim() === "") {
      errors.push(`レコード「${label}」: 空summary`);
    }

    if (record.source_url) {
      const normalized = record.source_url.split("#")[0];
      urlCounts.set(normalized, (urlCounts.get(normalized) || 0) + 1);
    }
  });

  urlCounts.forEach((count, url) => {
    if (count > 1) {
      errors.push(`source_url重複 (fragment除く): ${url} (${count}件)`);
    }
  });

  if (publicRecords.length !== EXPECTED_PUBLIC_CARD_COUNT) {
    errors.push(`公開カード数: ${publicRecords.length} (期待値: ${EXPECTED_PUBLIC_CARD_COUNT})`);
  }

  const result = {
    AREA_COUNT: areas.length,
    PUBLIC_CARD_COUNT: publicRecords.length,
    DUPLICATE_MUNICIPALITY_ID: areaIds.size === areas.length ? 0 : 1,
    DUPLICATE_URL_COUNT: [...urlCounts.values()].filter((c) => c > 1).length,
    DATA_2016_CONTAMINATION: errors.some((e) => e.includes("2016")) ? "FOUND" : "NONE",
    DATA_VALIDATION: errors.length === 0 ? "PASS" : "FAIL",
    errors
  };

  console.log("=== Phase3 Data Validation ===");
  console.log(JSON.stringify(result, null, 2));

  if (errors.length > 0) {
    process.exit(1);
  }
}

main();
