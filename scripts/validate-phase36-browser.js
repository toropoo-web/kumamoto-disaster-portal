#!/usr/bin/env node
"use strict";

const { chromium } = require("playwright");

const SERVE_URL = process.env.SERVE_URL || "http://localhost:3000";

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${y}年${m}月${d}日 ${h}:${min}`;
}

async function main() {
  const errors = [];
  const checks = [];

  const [waterIndexRes, disasterIndexRes, updatesRes] = await Promise.all([
    fetch(`${SERVE_URL}/data/public/water_search_index.json`),
    fetch(`${SERVE_URL}/data/public/disaster_search_index.json`),
    fetch(`${SERVE_URL}/data/public/phase1_updates.json`)
  ]);

  const waterIndex = await waterIndexRes.json();
  const disasterIndex = await disasterIndexRes.json();
  const updates = await updatesRes.json();

  checks.push({
    check: "water index count",
    pass: waterIndex.item_count === 43,
    count: waterIndex.item_count
  });
  if (waterIndex.item_count !== 43) {
    errors.push("WATER item_count must remain 43");
  }

  const volunteerCount = disasterIndex.index.filter(function (item) {
    return item.category === "VOLUNTEER";
  }).length;
  checks.push({
    check: "volunteer index count",
    pass: volunteerCount === 20,
    count: volunteerCount
  });
  if (volunteerCount !== 20) {
    errors.push("VOLUNTEER count must remain 20");
  }

  const yatsushiroWater = waterIndex.items.find(function (item) {
    return item.municipality === "八代市" && item.item_kind === "location";
  });
  const volunteerPref = disasterIndex.index.find(function (item) {
    return item.category === "VOLUNTEER" && item.source_url === "https://www.fukushi-kumamoto.or.jp/kvc/";
  });
  const latestRecord = Array.isArray(updates) ? updates[0] : null;

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(SERVE_URL, { waitUntil: "networkidle" });
  await page.waitForFunction(() => !!document.getElementById("water-search"), { timeout: 20000 });

  const latestChecks = await page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll(".latest-updates__timestamp-label")).map(function (el) {
      return el.textContent.trim();
    });
    return {
      hasOfficial: labels.indexOf("公式更新") !== -1,
      hasChecked: labels.indexOf("確認日時") !== -1,
      labelCount: labels.length
    };
  });

  checks.push({
    check: "LATEST official update label",
    pass: latestChecks.hasOfficial
  });
  checks.push({
    check: "LATEST checked at label",
    pass: latestChecks.hasChecked
  });
  if (!latestChecks.hasOfficial) {
    errors.push("LATEST section missing 公式更新 label");
  }
  if (!latestChecks.hasChecked) {
    errors.push("LATEST section missing 確認日時 label");
  }

  const officialCardChecks = await page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll(".official-info-card__meta dt")).map(function (el) {
      return el.textContent.trim();
    });
    return {
      officialCount: labels.filter(function (label) { return label === "公式更新"; }).length,
      checkedCount: labels.filter(function (label) { return label === "確認日時"; }).length
    };
  });

  checks.push({
    check: "official cards official update label",
    pass: officialCardChecks.officialCount > 0,
    count: officialCardChecks.officialCount
  });
  checks.push({
    check: "official cards checked at label",
    pass: officialCardChecks.checkedCount > 0,
    count: officialCardChecks.checkedCount
  });

  if (latestRecord && latestRecord.source_updated_at) {
    const expectedLatestOfficial = formatDateTime(latestRecord.source_updated_at);
    const latestOfficialText = await page.evaluate(() => {
      const label = Array.from(document.querySelectorAll(".latest-updates__timestamp-label")).find(function (el) {
        return el.textContent.trim() === "公式更新";
      });
      return label && label.parentElement ? label.parentElement.textContent : "";
    });
    checks.push({
      check: "LATEST official update value",
      pass: latestOfficialText.indexOf(expectedLatestOfficial) !== -1,
      expected: expectedLatestOfficial,
      actual: latestOfficialText
    });
  }

  await page.fill("#water-search-input", "八代 給水");
  await page.click(".water-search__button");
  await page.waitForSelector(".water-search__card", { timeout: 10000 });

  const waterCardText = await page.evaluate(() => {
    const card = document.querySelector(".water-search__card");
    return card ? card.textContent : "";
  });

  const waterHasOfficial = /公式更新：/.test(waterCardText);
  const waterHasChecked = /確認日時：/.test(waterCardText);
  const waterShowsUnavailable = /公式更新：確認できません/.test(waterCardText);

  checks.push({
    check: "WATER card official update label",
    pass: waterHasOfficial
  });
  checks.push({
    check: "WATER card checked at label",
    pass: waterHasChecked
  });

  if (yatsushiroWater && yatsushiroWater.source_updated_at) {
    const expectedWaterOfficial = formatDateTime(yatsushiroWater.source_updated_at);
    checks.push({
      check: "WATER card official update value",
      pass: waterCardText.indexOf(expectedWaterOfficial) !== -1,
      expected: expectedWaterOfficial
    });
    if (waterCardText.indexOf(expectedWaterOfficial) === -1) {
      errors.push("WATER card missing propagated source_updated_at");
    }
  }

  if (yatsushiroWater && yatsushiroWater.checked_at) {
    const expectedWaterChecked = formatDateTime(yatsushiroWater.checked_at);
    checks.push({
      check: "WATER card checked at value",
      pass: waterCardText.indexOf(expectedWaterChecked) !== -1,
      expected: expectedWaterChecked
    });
    if (waterCardText.indexOf(expectedWaterChecked) === -1) {
      errors.push("WATER card missing propagated checked_at");
    }
  }

  if (!waterHasOfficial || !waterHasChecked) {
    errors.push("WATER search card missing timestamp labels");
  }

  await page.fill("#disaster-search-volunteer-input", "熊本 ボランティア");
  await page.click("#disaster-search-volunteer .disaster-search__button");
  await page.waitForSelector("#disaster-search-volunteer .disaster-search__card", { timeout: 10000 });

  const volunteerCardText = await page.evaluate(() => {
    const card = document.querySelector("#disaster-search-volunteer .disaster-search__card");
    return card ? card.textContent : "";
  });

  const volunteerHasOfficial = /公式更新：/.test(volunteerCardText);
  const volunteerHasChecked = /確認日時：/.test(volunteerCardText);

  checks.push({
    check: "VOLUNTEER card official update label",
    pass: volunteerHasOfficial
  });
  checks.push({
    check: "VOLUNTEER card checked at label",
    pass: volunteerHasChecked
  });

  if (volunteerPref && volunteerPref.source_updated_at) {
    const expectedVolunteerOfficial = formatDateTime(volunteerPref.source_updated_at);
    checks.push({
      check: "VOLUNTEER card official update value",
      pass: volunteerCardText.indexOf(expectedVolunteerOfficial) !== -1,
      expected: expectedVolunteerOfficial
    });
  } else {
    checks.push({
      check: "VOLUNTEER card official update unavailable branch",
      pass: /公式更新：確認できません/.test(volunteerCardText),
      note: "source_updated_at absent in index"
    });
    if (!/公式更新：確認できません/.test(volunteerCardText)) {
      errors.push("VOLUNTEER card should show 確認できません when source_updated_at missing");
    }
  }

  if (volunteerPref && volunteerPref.checked_at) {
    const expectedVolunteerChecked = formatDateTime(volunteerPref.checked_at);
    checks.push({
      check: "VOLUNTEER card checked at value",
      pass: volunteerCardText.indexOf(expectedVolunteerChecked) !== -1,
      expected: expectedVolunteerChecked
    });
    if (volunteerCardText.indexOf(expectedVolunteerChecked) === -1) {
      errors.push("VOLUNTEER card missing propagated checked_at");
    }
  }

  if (!volunteerHasOfficial || !volunteerHasChecked) {
    errors.push("VOLUNTEER search card missing timestamp labels");
  }

  await browser.close();

  const result = {
    PHASE36_BROWSER_VALIDATION: errors.length === 0 ? "PASS" : "FAIL",
    SERVE_URL: SERVE_URL,
    checks: checks,
    errors: errors
  };

  console.log("=== PHASE36 Browser Validation ===");
  console.log(JSON.stringify(result, null, 2));

  if (errors.length) {
    process.exit(1);
  }

  console.log("PHASE36_PUBLIC_DATA_REFRESH_AND_UI_VERIFY_COMPLETE");
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
