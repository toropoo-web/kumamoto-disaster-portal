#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..");
const APP_JS = path.join(ROOT, "js", "app.js");
const SOCIAL_INDEX_FILE = path.join(ROOT, "data", "public", "disaster_social_index.json");
const SOCIAL_SOURCES_FILE = path.join(ROOT, "data", "public", "disaster_social_sources.json");
const SERVE_URL = process.env.SERVE_URL || "http://localhost:3030";

const {
  resolveExternalUrl,
  resolveSocialEntryUrl,
  auditSocialUrlFields,
  containsBlockedPublicUrl
} = require(path.join(ROOT, "monitor", "disaster-social-url"));

function pickEntryWithUrl(entries) {
  return entries.find(function (entry) {
    return Boolean(resolveSocialEntryUrl(entry));
  });
}

function pickEntryWithoutUrl(entries) {
  return entries.find(function (entry) {
    return !resolveSocialEntryUrl(entry);
  });
}

function mainStatic(indexPayload, sourcesPayload) {
  const errors = [];
  const checks = [];
  const entries = indexPayload.entries || [];
  const appJs = fs.readFileSync(APP_JS, "utf8");
  const urlAudit = auditSocialUrlFields(indexPayload, sourcesPayload);

  checks.push({
    check: "url audit index entries",
    pass: urlAudit.index_entries.total > 0,
    audit: urlAudit
  });

  const withUrlEntry = pickEntryWithUrl(entries);
  const withoutUrlEntry = pickEntryWithoutUrl(entries);

  if (!withUrlEntry) {
    checks.push({
      check: "publishable entry url available",
      pass: true,
      note: "no publishable entry urls currently registered"
    });
  }
  if (!withoutUrlEntry) {
    errors.push("no index entry without url found");
  }

  if (withUrlEntry) {
    const expectedUrl = resolveSocialEntryUrl(withUrlEntry);
    checks.push({
      check: "registered url resolves for link display",
      pass: /^https?:\/\//i.test(expectedUrl),
      entry_id: withUrlEntry.id,
      registered_url: withUrlEntry.url || "",
      registered_source_url: withUrlEntry.source_url || "",
      registered_link: withUrlEntry.link || "",
      resolved_url: expectedUrl
    });
    if (!/^https?:\/\//i.test(expectedUrl)) {
      errors.push("registered url must resolve to http(s) for " + withUrlEntry.id);
    }
  }

  if (withoutUrlEntry) {
    checks.push({
      check: "empty url entry does not resolve",
      pass: !resolveSocialEntryUrl(withoutUrlEntry),
      entry_id: withoutUrlEntry.id,
      registered_url: withoutUrlEntry.url || ""
    });
    if (resolveSocialEntryUrl(withoutUrlEntry)) {
      errors.push("empty url entry must not resolve: " + withoutUrlEntry.id);
    }
  }

  const invalidCases = [
    { label: "javascript scheme", value: "javascript:alert(1)" },
    { label: "ftp scheme", value: "ftp://example.com/post" },
    { label: "protocol-relative", value: "//example.com/post" },
    { label: "plain text", value: "example.com/post" },
    { label: "whitespace", value: "   " },
    { label: "example.local", value: "https://example.local/yatsushiro-board/water" },
    { label: "localhost", value: "http://localhost:3000/post" }
  ];
  invalidCases.forEach(function (testCase) {
    const pass = resolveExternalUrl(testCase.value) === "";
    checks.push({
      check: "invalid url hidden: " + testCase.label,
      pass: pass,
      value: testCase.value
    });
    if (!pass) {
      errors.push("invalid url must not resolve: " + testCase.label);
    }
  });

  checks.push({
    check: "public data has no blocked urls",
    pass: !containsBlockedPublicUrl(indexPayload) && !containsBlockedPublicUrl(sourcesPayload)
  });
  if (containsBlockedPublicUrl(indexPayload) || containsBlockedPublicUrl(sourcesPayload)) {
    errors.push("public social data contains blocked urls");
  }

  [
    { name: "blocked hostname guard", pattern: /isBlockedExternalHostname/ },
    { name: "http(s) only resolver", pattern: /function resolveExternalUrl/ },
    { name: "entry fields only resolver", pattern: /resolveExternalUrl\(item\.url\)/ },
    { name: "link target blank", pattern: /resolveSocialEntryUrl\(item\)[\s\S]*setAttribute\("target", "_blank"\)/ },
    { name: "link rel noopener", pattern: /resolveSocialEntryUrl\(item\)[\s\S]*setAttribute\("rel", "noopener"\)/ }
  ].forEach(function (item) {
    const pass = item.invert ? !item.pattern.test(appJs) : item.pattern.test(appJs);
    checks.push({ check: "app.js: " + item.name, pass: pass });
    if (!pass) {
      errors.push("app.js check failed: " + item.name);
    }
  });

  return { checks: checks, errors: errors, urlAudit: urlAudit, withUrlEntry: withUrlEntry, withoutUrlEntry: withoutUrlEntry };
}

async function mainBrowser(withUrlEntry, withoutUrlEntry) {
  const errors = [];
  const checks = [];
  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    await page.goto(SERVE_URL, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForSelector("#disaster-social-search", { timeout: 30000 });
    await page.locator("#disaster-social-search").scrollIntoViewIfNeeded();

    if (withUrlEntry) {
      const expectedUrl = resolveSocialEntryUrl(withUrlEntry);
      await page.locator("#disaster-social-search-region").fill(withUrlEntry.municipality || "");
      await page.locator("#disaster-social-search-category").fill("");
      await page.locator(".disaster-social-search__form button[type='submit']").click();
      await page.waitForSelector("#disaster-social-search-results .disaster-search__card", {
        timeout: 10000
      });

      const withUrlCard = page
        .locator("#disaster-social-search-results .disaster-search__card")
        .filter({ hasText: withUrlEntry.title });
      const withUrlCardCount = await withUrlCard.count();
      const withUrlLink = withUrlCard.locator(".disaster-search__official-link");
      const withUrlLinkCount = withUrlCardCount ? await withUrlLink.count() : 0;
      const href = withUrlLinkCount ? await withUrlLink.getAttribute("href") : "";

      checks.push({
        check: "registered url shows link",
        pass: withUrlCardCount > 0 && withUrlLinkCount === 1 && href === expectedUrl,
        entry_id: withUrlEntry.id,
        expected_href: expectedUrl,
        actual_href: href || ""
      });
      if (!withUrlCardCount || withUrlLinkCount !== 1 || href !== expectedUrl) {
        errors.push("registered url link display failed for " + withUrlEntry.id);
      }
    } else {
      checks.push({
        check: "registered url shows link",
        pass: true,
        note: "skipped: no publishable entry urls in public index"
      });
    }

    await page.locator("#disaster-social-search-region").fill(withoutUrlEntry.municipality || "");
    await page.locator("#disaster-social-search-category").fill("");
    await page.locator(".disaster-social-search__form button[type='submit']").click();
    await page.waitForSelector("#disaster-social-search-results .disaster-search__card", {
      timeout: 10000
    });

    const withoutUrlCard = page
      .locator("#disaster-social-search-results .disaster-search__card")
      .filter({ hasText: withoutUrlEntry.title });
    const withoutUrlCardCount = await withoutUrlCard.count();
    const withoutUrlLinkCount = withoutUrlCardCount
      ? await withoutUrlCard.locator(".disaster-search__official-link").count()
      : 0;

    checks.push({
      check: "missing url hides link",
      pass: withoutUrlCardCount > 0 && withoutUrlLinkCount === 0,
      entry_id: withoutUrlEntry.id,
      registered_url: withoutUrlEntry.url || "",
      link_count: withoutUrlLinkCount
    });
    if (!withoutUrlCardCount || withoutUrlLinkCount !== 0) {
      errors.push("missing url must hide link for " + withoutUrlEntry.id);
    }
  } finally {
    await browser.close();
  }

  return { checks: checks, errors: errors };
}

async function main() {
  const indexPayload = JSON.parse(fs.readFileSync(SOCIAL_INDEX_FILE, "utf8"));
  const sourcesPayload = JSON.parse(fs.readFileSync(SOCIAL_SOURCES_FILE, "utf8"));
  const staticResult = mainStatic(indexPayload, sourcesPayload);
  const errors = staticResult.errors.slice();
  const checks = staticResult.checks.slice();

  if (staticResult.withoutUrlEntry) {
    try {
      const browserResult = await mainBrowser(staticResult.withUrlEntry, staticResult.withoutUrlEntry);
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
  }

  const output = {
    DISASTER_SEARCH_DATA_SOURCE_LINK_VALIDATION: errors.length === 0 ? "PASS" : "FAIL",
    serve_url: SERVE_URL,
    url_audit: staticResult.urlAudit,
    checks: checks,
    errors: errors
  };

  console.log("=== Disaster Search Data Source Link Validation ===");
  console.log(JSON.stringify(output, null, 2));

  if (errors.length) {
    process.exit(1);
  }

  console.log("DISASTER_SEARCH_DATA_SOURCE_LINK_VALIDATION_COMPLETE");
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
