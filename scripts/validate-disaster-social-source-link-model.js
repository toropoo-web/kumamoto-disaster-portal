#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..");
const APP_JS = path.join(ROOT, "js", "app.js");
const INDEX_FILE = path.join(ROOT, "data", "public", "disaster_social_index.json");
const SOURCES_FILE = path.join(ROOT, "data", "public", "disaster_social_sources.json");
const SERVE_URL = process.env.SERVE_URL || "http://localhost:3030";

const {
  resolveSocialEntryUrl,
  containsBlockedPublicUrl
} = require(path.join(ROOT, "monitor", "disaster-social-url"));
const {
  resolveSocialSourceTypeLabel,
  buildSocialSourceLookupFromPayload
} = require(path.join(ROOT, "monitor", "disaster-social-source-display"));

function mainStatic() {
  const errors = [];
  const checks = [];
  const appJs = fs.readFileSync(APP_JS, "utf8");
  const indexPayload = JSON.parse(fs.readFileSync(INDEX_FILE, "utf8"));
  const sourcesPayload = JSON.parse(fs.readFileSync(SOURCES_FILE, "utf8"));
  const entries = indexPayload.entries || [];
  const sourceLookup = buildSocialSourceLookupFromPayload(sourcesPayload);

  [
    { name: "source type labels", pattern: /SOCIAL_SOURCE_TYPE_LABELS/ },
    { name: "append social source display", pattern: /function appendSocialSourceDisplay/ },
    { name: "link label 情報を見る", pattern: /情報を見る/ },
    { name: "source type always shown", pattern: /disaster-social-search__source-type[\s\S]*情報を見る/ },
    { name: "removed 情報元を見る label", pattern: /情報元を見る/, invert: true },
    { name: "removed URLを開く label", pattern: /URLを開く/, invert: true },
    { name: "sources use source_url field", pattern: /source_url/ }
  ].forEach(function (item) {
    const pass = item.invert ? !item.pattern.test(appJs) : item.pattern.test(appJs);
    checks.push({ check: item.name, pass: pass });
    if (!pass) {
      errors.push("app.js check failed: " + item.name);
    }
  });

  const requiredFields = ["source", "source_type", "captured_at", "url"];
  const missingFieldEntries = entries.filter(function (entry) {
    return requiredFields.some(function (field) {
      return typeof entry[field] !== "string";
    });
  });
  checks.push({
    check: "index entries keep source fields",
    pass: missingFieldEntries.length === 0,
    entry_count: entries.length,
    missing_count: missingFieldEntries.length
  });
  if (missingFieldEntries.length) {
    errors.push("index entries missing required source fields");
  }

  checks.push({
    check: "dummy url count zero",
    pass: !containsBlockedPublicUrl(indexPayload) && !/example\.local/i.test(fs.readFileSync(INDEX_FILE, "utf8")),
    entry_count: entries.length
  });
  if (containsBlockedPublicUrl(indexPayload)) {
    errors.push("public index contains blocked urls");
  }

  const sourcesWithSourceUrl = (sourcesPayload.sources || []).filter(function (source) {
    return typeof source.source_url === "string";
  });
  checks.push({
    check: "sources define source_url",
    pass: sourcesWithSourceUrl.length === (sourcesPayload.sources || []).length,
    source_count: (sourcesPayload.sources || []).length
  });

  const syntheticWithUrl = {
    source: "SOC-LOCAL-001",
    source_type: "X",
    url: "https://x.com/"
  };
  const syntheticWithoutUrl = {
    source: "SOC-LOCAL-002",
    source_type: "WEB",
    url: ""
  };
  checks.push({
    check: "url present resolves for link display",
    pass: resolveSocialEntryUrl(syntheticWithUrl) === "https://x.com/",
    resolved: resolveSocialEntryUrl(syntheticWithUrl)
  });
  checks.push({
    check: "url absent does not resolve",
    pass: !resolveSocialEntryUrl(syntheticWithoutUrl),
    label: resolveSocialSourceTypeLabel(syntheticWithoutUrl, sourceLookup[syntheticWithoutUrl.source])
  });
  if (!resolveSocialEntryUrl(syntheticWithUrl)) {
    errors.push("publishable entry url must resolve");
  }
  if (resolveSocialEntryUrl(syntheticWithoutUrl)) {
    errors.push("empty entry url must not resolve");
  }

  checks.push({
    check: "information not deleted",
    pass: entries.length === 57,
    entry_count: entries.length
  });
  if (entries.length !== 57) {
    errors.push("community layer entry count changed");
  }

  const toiletTitles = [
    "宇城市 仮設トイレの場所共有",
    "宇土市 仮設トイレ設置場所",
    "上天草市 仮設トイレ設置情報",
    "大津町 仮設トイレ設置"
  ];
  toiletTitles.forEach(function (title) {
    const entry = entries.find(function (item) {
      return item.title === title;
    });
    const pass = Boolean(
      entry &&
        entry.url === "" &&
        !entry.source_url &&
        !entry.link &&
        !resolveSocialEntryUrl(entry)
    );
    checks.push({
      check: "toilet entry url state: " + title,
      pass: pass,
      entry_id: entry && entry.id,
      url: entry && entry.url,
      source_type: entry && entry.source_type
    });
    if (!pass) {
      errors.push("toilet entry url state invalid: " + title);
    }
  });

  return { checks: checks, errors: errors, entries: entries, sourceLookup: sourceLookup };
}

async function mainBrowser(entries, sourceLookup) {
  const errors = [];
  const checks = [];
  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    await page.goto(SERVE_URL, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForSelector("#disaster-social-search", { timeout: 30000 });
    await page.locator("#disaster-social-search").scrollIntoViewIfNeeded();

    await page.locator("#disaster-social-search-region").fill("八代市");
    await page.locator(".disaster-social-search__form button[type='submit']").click();
    await page.waitForSelector("#disaster-social-search-results .disaster-search__card", {
      timeout: 10000
    });

    const sourceTypeCount = await page.locator(".disaster-social-search__source-type").count();
    const openLinkCount = await page.locator("#disaster-social-search-results .disaster-search__official-link").count();
    const sourceTypeText = sourceTypeCount
      ? await page.locator(".disaster-social-search__source-type").first().innerText()
      : "";

    checks.push({
      check: "no-url shows source type",
      pass: sourceTypeCount > 0 && /情報元：/.test(sourceTypeText),
      source_type_count: sourceTypeCount,
      sample_text: sourceTypeText
    });
    checks.push({
      check: "no dummy open-link labels",
      pass: openLinkCount === 0,
      open_link_count: openLinkCount
    });

    if (!sourceTypeCount || !/情報元：/.test(sourceTypeText)) {
      errors.push("no-url source type display failed");
    }
    if (openLinkCount !== 0) {
      errors.push("unexpected open links when entries have no publishable url");
    }

    await page.locator("#disaster-social-search-region").fill("");
    await page.locator("#disaster-social-search-category").fill("トイレ");
    await page.locator(".disaster-social-search__form button[type='submit']").click();
    await page.waitForSelector("#disaster-social-search-results .disaster-search__card", {
      timeout: 10000
    });
    const toiletCardCount = await page.locator("#disaster-social-search-results .disaster-search__card").count();
    const toiletSourceTypeCount = await page.locator(".disaster-social-search__source-type").count();
    const toiletLinkCount = await page.locator(".disaster-social-search__info-link").count();
    checks.push({
      check: "toilet search shows source only",
      pass: toiletCardCount >= 4 && toiletSourceTypeCount >= 4 && toiletLinkCount === 0,
      card_count: toiletCardCount,
      source_type_count: toiletSourceTypeCount,
      link_count: toiletLinkCount
    });
    if (toiletCardCount < 4 || toiletSourceTypeCount < 4 || toiletLinkCount !== 0) {
      errors.push("toilet entries must show source type without info link");
    }

    const withUrlEntry = entries.find(function (entry) {
      return Boolean(resolveSocialEntryUrl(entry));
    });
    if (withUrlEntry) {
      await page.locator("#disaster-social-search-region").fill(withUrlEntry.municipality || "");
      await page.locator("#disaster-social-search-category").fill("");
      await page.locator(".disaster-social-search__form button[type='submit']").click();
      await page.waitForSelector("#disaster-social-search-results .disaster-search__card", {
        timeout: 10000
      });
      const card = page
        .locator("#disaster-social-search-results .disaster-search__card")
        .filter({ hasText: withUrlEntry.title });
      const sourceTypeOnCard = await card.locator(".disaster-social-search__source-type").count();
      const link = card.locator(".disaster-social-search__info-link");
      const linkText = await link.innerText();
      const href = await link.getAttribute("href");
      checks.push({
        check: "url present shows source and 情報を見る",
        pass:
          sourceTypeOnCard === 1 &&
          linkText === "情報を見る" &&
          href === resolveSocialEntryUrl(withUrlEntry),
        entry_id: withUrlEntry.id,
        href: href || ""
      });
      if (sourceTypeOnCard !== 1 || linkText !== "情報を見る" || href !== resolveSocialEntryUrl(withUrlEntry)) {
        errors.push("url present link display failed");
      }
    } else {
      checks.push({
        check: "url present shows source and 情報を見る",
        pass: true,
        note: "skipped: no publishable entry urls in public index"
      });
    }
  } finally {
    await browser.close();
  }

  return { checks: checks, errors: errors };
}

async function main() {
  const staticResult = mainStatic();
  const errors = staticResult.errors.slice();
  const checks = staticResult.checks.slice();

  try {
    const browserResult = await mainBrowser(staticResult.entries, staticResult.sourceLookup);
    checks.push.apply(
      checks,
      browserResult.checks.map(function (item) {
        return Object.assign({}, item, { scope: "browser" });
      })
    );
    errors.push.apply(errors, browserResult.errors);
  } catch (err) {
    errors.push("browser validation failed: " + err.message);
  }

  const output = {
    DISASTER_SEARCH_EXTERNAL_SOURCE_LINK_MODEL_VALIDATION: errors.length === 0 ? "PASS" : "FAIL",
    serve_url: SERVE_URL,
    checks: checks,
    errors: errors
  };

  console.log("=== Disaster Social Source Link Model Validation ===");
  console.log(JSON.stringify(output, null, 2));

  if (errors.length) {
    process.exit(1);
  }

  console.log("DISASTER_SEARCH_EXTERNAL_SOURCE_LINK_MODEL_UPDATE_COMPLETE");
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
