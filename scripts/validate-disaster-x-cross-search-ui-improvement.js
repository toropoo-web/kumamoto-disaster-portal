#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..");
const PUBLIC_SOCIAL_INDEX = path.join(ROOT, "data", "public", "disaster_social_index.json");
const PUBLIC_SEARCH_INDEX = path.join(ROOT, "data", "public", "disaster_search_index.json");
const PUBLIC_WATER_INDEX = path.join(ROOT, "data", "public", "water_search_index.json");
const SERVE_URL = process.env.SERVE_URL || "http://localhost:3030";

const {
  searchDisasterSocialIndex,
  buildAndWriteDisasterSocialIndex
} = require(path.join(ROOT, "monitor", "disaster-social-index-engine"));
const {
  buildAndWriteDisasterSearchIndex,
  searchDisasterIndex
} = require(path.join(ROOT, "monitor", "disaster-search-index-engine"));
const { isXPostUrl, resolveSocialEntryUrl } = require(path.join(ROOT, "monitor", "disaster-social-url"));

const EXPECTED_DESCRIPTION =
  "23自治体のX投稿から、熊本地震関連情報を横断検索できます。";
const EXPECTED_EXAMPLE = "迷子猫　無料シャワー　車中泊";
const EXPECTED_HELP_EXAMPLES = [
  "迷子猫",
  "迷子犬",
  "無料シャワー",
  "車中泊",
  "炊き出し",
  "支援物資",
  "給水",
  "井戸水",
  "風呂",
  "Wi-Fi",
  "避難所",
  "無料開放"
];

async function main() {
  const errors = [];
  const checks = [];

  buildAndWriteDisasterSocialIndex();
  const searchPayload = buildAndWriteDisasterSearchIndex();
  const socialIndex = JSON.parse(fs.readFileSync(PUBLIC_SOCIAL_INDEX, "utf8"));
  const entries = socialIndex.entries || [];
  const appJs = fs.readFileSync(path.join(ROOT, "js", "app.js"), "utf8");
  const css = fs.readFileSync(path.join(ROOT, "css", "styles.css"), "utf8");

  [
    { name: "official info promo title", pattern: /OFFICIAL_INFO_PROMO/ },
    { name: "official info note", pattern: /disaster-search__official-note/ },
    { name: "x cross search help", pattern: /X_CROSS_SEARCH_HELP/ },
    { name: "x cross search help ui", pattern: /disaster-social-search__help/ },
    { name: "x cross search description", pattern: /X_CROSS_SEARCH_DESCRIPTION/ },
    { name: "x cross search example", pattern: /X_CROSS_SEARCH_EXAMPLE/ },
    { name: "x cross search example ui", pattern: /disaster-social-search__example/ },
    { name: "latest section removed", pattern: /renderDisasterSocialLatest/, invert: true },
    { name: "latest info title removed", pattern: /disaster-social-search-latest/, invert: true }
  ].forEach(function (check) {
    const pass = check.invert ? !check.pattern.test(appJs) : check.pattern.test(appJs);
    checks.push({ check: "JS: " + check.name, pass: pass });
    if (!pass) {
      errors.push("JS check failed: " + check.name);
    }
  });

  [
    { name: "official info promo styles", pattern: /\.portal-quick-access__lead/ },
    { name: "x cross search help styles", pattern: /\.disaster-social-search__help-trigger/ },
    { name: "x cross search example styles", pattern: /\.disaster-social-search__example/ },
    { name: "official info note styles", pattern: /\.disaster-search__official-note/ }
  ].forEach(function (check) {
    const pass = check.pattern.test(css);
    checks.push({ check: "CSS: " + check.name, pass: pass });
    if (!pass) {
      errors.push("CSS check failed: " + check.name);
    }
  });

  const waterCount = (searchPayload.index || []).filter(function (item) {
    return item.category === "WATER";
  }).length;
  const volunteerCount = (searchPayload.index || []).filter(function (item) {
    return item.category === "VOLUNTEER";
  }).length;
  const waterIndex = JSON.parse(fs.readFileSync(PUBLIC_WATER_INDEX, "utf8"));
  checks.push({
    check: "official water layer preserved",
    pass: waterCount > 0 && waterCount === waterIndex.item_count,
    water_count: waterCount
  });
  checks.push({
    check: "official volunteer layer preserved",
    pass: volunteerCount > 0,
    volunteer_count: volunteerCount
  });
  if (!waterCount) {
    errors.push("official WATER search layer must be preserved");
  }
  if (!volunteerCount) {
    errors.push("official VOLUNTEER search layer must be preserved");
  }

  const keywordResults = searchDisasterSocialIndex(socialIndex, { categoryQuery: "給水" });
  checks.push({
    check: "x cross search keyword preserved",
    pass: keywordResults.length > 0,
    count: keywordResults.length
  });
  if (!keywordResults.length) {
    errors.push("x cross search keyword 給水 must remain searchable");
  }

  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    await page.goto(SERVE_URL + "?ui-validate=" + Date.now(), {
      waitUntil: "networkidle",
      timeout: 90000
    });
    await page.waitForSelector("#portal-quick-access-title", { timeout: 30000 });
    const promoTitle = await page.locator("#portal-quick-access-title").innerText();
    checks.push({
      check: "browser: official info promo title",
      pass: promoTitle === "公式情報を探す"
    });
    if (promoTitle !== "公式情報を探す") {
      errors.push("promo title must be 公式情報を探す");
    }

    await page.waitForSelector("#disaster-social-search", { timeout: 30000 });
    await page.locator("#disaster-social-search").scrollIntoViewIfNeeded();

    const latestCount = await page.locator("#disaster-social-search-latest").count();
    checks.push({
      check: "browser: latest posts removed",
      pass: latestCount === 0,
      latest_section_count: latestCount
    });
    if (latestCount !== 0) {
      errors.push("latest posts section must not be displayed");
    }

    const descriptionText = await page
      .locator("#disaster-social-search .disaster-search__guide-text")
      .innerText();
    checks.push({
      check: "browser: description text",
      pass: descriptionText === EXPECTED_DESCRIPTION,
      description: descriptionText
    });
    if (descriptionText !== EXPECTED_DESCRIPTION) {
      errors.push("description text must be " + EXPECTED_DESCRIPTION);
    }

    await page.waitForSelector(
      "#disaster-social-search .disaster-social-search__example",
      { timeout: 30000 }
    );
    const exampleText = await page
      .locator("#disaster-social-search .disaster-social-search__example")
      .innerText();
    checks.push({
      check: "browser: search example visible",
      pass: exampleText === "例：" + EXPECTED_EXAMPLE,
      example: exampleText
    });
    if (exampleText !== "例：" + EXPECTED_EXAMPLE) {
      errors.push("search example must show 例：" + EXPECTED_EXAMPLE);
    }

    await page.locator("#disaster-social-search .disaster-social-search__help-trigger").click();
    const helpExampleTexts = await page
      .locator(".disaster-social-search__help-example")
      .allInnerTexts();
    const helpExamplesOk = EXPECTED_HELP_EXAMPLES.every(function (example) {
      return helpExampleTexts.indexOf(example) !== -1;
    });
    checks.push({
      check: "browser: search help examples",
      pass: helpExamplesOk && helpExampleTexts.length >= EXPECTED_HELP_EXAMPLES.length,
      example_count: helpExampleTexts.length,
      examples: helpExampleTexts
    });
    if (!helpExamplesOk) {
      errors.push("search help must list all searchable examples");
    }

    await page.locator("#disaster-social-search-region").fill("八代市");
    await page.locator("#disaster-social-search-category").fill("炊き出し");
    await page.locator(".disaster-social-search__form button[type='submit']").click();
    await page.waitForSelector("#disaster-social-search-results .disaster-search__card", {
      timeout: 20000
    });
    const sourceText = await page.locator(".disaster-social-search__source-type").first().innerText();
    const searchHref = await page
      .locator("#disaster-social-search-results .disaster-social-search__post-link")
      .first()
      .getAttribute("href");
    checks.push({
      check: "browser: x cross search still works",
      pass: sourceText === "情報元：X" && isXPostUrl(searchHref),
      source_text: sourceText,
      href: searchHref || null
    });
    if (sourceText !== "情報元：X" || !isXPostUrl(searchHref)) {
      errors.push("x cross search must still return X posts after UI changes");
    }

    const officialNoteCount = await page.locator(".disaster-search__official-note").count();
    checks.push({
      check: "browser: official info note shown",
      pass: officialNoteCount >= 3,
      note_count: officialNoteCount
    });
    if (officialNoteCount < 3) {
      errors.push("official info note must appear in public info search sections");
    }
  } finally {
    await browser.close();
  }

  const result = {
    PHASE_RESULT: errors.length === 0 ? "PASS" : "FAIL",
    DISASTER_X_CROSS_SEARCH_UI_IMPROVEMENT_VALIDATION: errors.length === 0 ? "PASS" : "FAIL",
    x_count: entries.length,
    keyword_count_給水: keywordResults.length,
    checks: checks,
    errors: errors
  };
  console.log(JSON.stringify(result, null, 2));
  if (errors.length) {
    process.exit(1);
  }
  console.log("DISASTER_X_CROSS_SEARCH_UI_IMPROVEMENT_COMPLETE");
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
