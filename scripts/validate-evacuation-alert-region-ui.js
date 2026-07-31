#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const APP_JS = path.join(ROOT, "js", "app.js");
const STYLES_CSS = path.join(ROOT, "css", "styles.css");
const REGION_FILE = path.join(ROOT, "data", "public", "evacuation_alert_region.json");
const NAVIGATION_FILE = path.join(ROOT, "data", "public", "phase1_navigation.json");

const EXPECTED_MUNICIPALITIES = [
  "熊本市",
  "八代市",
  "水俣市",
  "宇土市",
  "上天草市",
  "宇城市",
  "天草市",
  "美里町",
  "甲佐町",
  "芦北町",
  "津奈木町",
  "苓北町",
  "益城町",
  "御船町",
  "嘉島町",
  "人吉市",
  "菊陽町",
  "菊池市",
  "合志市",
  "氷川町",
  "阿蘇市",
  "南阿蘇村",
  "霧島市"
];

function main() {
  const errors = [];
  const checks = [];
  const appJs = fs.readFileSync(APP_JS, "utf8");
  const css = fs.readFileSync(STYLES_CSS, "utf8");
  const regionPayload = JSON.parse(fs.readFileSync(REGION_FILE, "utf8"));
  const navigation = JSON.parse(fs.readFileSync(NAVIGATION_FILE, "utf8"));
  const municipalities = Array.isArray(regionPayload.municipalities)
    ? regionPayload.municipalities
    : [];

  checks.push({
    check: "23自治体表示 PASS",
    pass: municipalities.length === 23,
    municipality_count: municipalities.length
  });
  if (municipalities.length !== 23) {
    errors.push("evacuation_alert_region.json must define exactly 23 municipalities");
  }

  EXPECTED_MUNICIPALITIES.forEach(function (name, index) {
    const pass = municipalities[index] === name;
    checks.push({ check: name, pass: pass });
    if (!pass) {
      errors.push("unexpected municipality at index " + index + ": " + municipalities[index]);
    }
  });

  ["霧島市", "阿蘇市", "南阿蘇村"].forEach(function (name) {
    const pass = municipalities.indexOf(name) !== -1;
    checks.push({ check: name + " PASS", pass: pass });
    if (!pass) {
      errors.push(name + " must be included in evacuation_alert_region.json");
    }
  });

  [
    { name: "検索連携 PASS", pattern: /input\.value = municipalityName[\s\S]*runSearch\(\)/ },
    { name: "load evacuation alert region json", pattern: /loadEvacuationAlertRegion/ },
    { name: "evacuation alert region json path", pattern: /evacuation_alert_region\.json/ },
    { name: "evacuation alert municipalities option", pattern: /evacuationAlertMunicipalities/ },
    { name: "hardcoded evacuation array removed", pattern: /var EVACUATION_ALERT_REGION_MUNICIPALITIES/, invert: true },
    { name: "evacuation alert region render block", pattern: /evacuation-alert-region/ },
    { name: "evacuation alert region buttons", pattern: /evacuation-alert-region__btn/ },
    { name: "official post only scope", pattern: /categoryKey === "OFFICIAL_POST"[\s\S]*evacuation-alert-region/ },
    { name: "既存ナビ影響なし PASS", pattern: /renderPageNavigation\(page, navigation, publicRecords\)/ }
  ].forEach(function (item) {
    const pass = item.invert ? !item.pattern.test(appJs) : item.pattern.test(appJs);
    checks.push({ check: item.name, pass: pass });
    if (!pass) {
      errors.push("JS check failed: " + item.name);
    }
  });

  checks.push({
    check: "evacuation alert region styles",
    pass: /\.evacuation-alert-region__btn/.test(css)
  });
  if (!/\.evacuation-alert-region__btn/.test(css)) {
    errors.push("CSS check failed: evacuation alert region styles");
  }

  const navigationNames = navigation.map(function (item) {
    return item.name;
  });
  checks.push({
    check: "phase1_navigation count preserved",
    pass: navigationNames.length === 23,
    navigation_count: navigationNames.length
  });
  if (navigationNames.length !== 23) {
    errors.push("phase1_navigation.json must remain unchanged (23 entries)");
  }

  const output = {
    EVACUATION_ALERT_REGION_FINAL_SCOPE_UPDATE_VALIDATION: errors.length === 0 ? "PASS" : "FAIL",
    municipality_count: municipalities.length,
    checks: checks,
    errors: errors
  };

  console.log("=== Evacuation Alert Region Final Scope Update Validation ===");
  console.log(JSON.stringify(output, null, 2));

  if (errors.length) {
    process.exit(1);
  }

  console.log("EVACUATION_ALERT_REGION_FINAL_SCOPE_UPDATE_COMPLETE");
}

main();
