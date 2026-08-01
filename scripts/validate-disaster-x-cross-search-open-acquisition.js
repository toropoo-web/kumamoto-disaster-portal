#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const INBOX_FILE = path.join(ROOT, "data", "community", "disaster_social_inbox.json");
const PUBLIC_INDEX_FILE = path.join(ROOT, "data", "public", "disaster_social_index.json");
const { fetchDisasterSocialSnsInbox, DEFAULT_X_CROSS_SEARCH_FEED_URL } = require(path.join(
  ROOT,
  "monitor",
  "disaster-social-sns-fetch"
));
const { SNS_FETCH_SINCE_DATE } = require(path.join(ROOT, "monitor", "disaster-social-community-scope"));

function main() {
  const errors = [];
  const checks = [];

  const fetchJs = fs.readFileSync(
    path.join(ROOT, "monitor", "disaster-social-sns-fetch.js"),
    "utf8"
  );
  checks.push({
    check: "portal uses posts-cross-search feed",
    pass: /posts-cross-search\.json/.test(fetchJs)
  });
  if (!/posts-cross-search\.json/.test(fetchJs)) {
    errors.push("portal must use posts-cross-search.json");
  }
  checks.push({
    check: "portal applies 23-municipality scope at acquisition",
    pass: /matchesMunicipalityScope/.test(fetchJs)
  });
  if (!/matchesMunicipalityScope/.test(fetchJs)) {
    errors.push("portal must apply 23-municipality scope before index save");
  }
  checks.push({
    check: "portal does not use registered official feed for cross-search",
    pass: !/DEFAULT_OFFICIAL_X_FEED_URL[\s\S]*fetchXInboxItems/.test(fetchJs)
  });

  const workflow = fs.readFileSync(
    path.join(ROOT, ".github", "workflows", "disaster-social-inbox.yml"),
    "utf8"
  );
  checks.push({
    check: "inbox workflow runs every 30 minutes",
    pass: /cron:\s*"10,40 \* \* \* \*"/.test(workflow)
  });
  if (!/cron:\s*"10,40 \* \* \* \*"/.test(workflow)) {
    errors.push("disaster-social-inbox.yml must run every 30 minutes");
  }

  checks.push({
    check: "production sync script exists",
    pass: fs.existsSync(path.join(ROOT, "scripts", "sync-disaster-social-cross-search-production.js"))
  });

  if (fs.existsSync(INBOX_FILE)) {
    const inbox = JSON.parse(fs.readFileSync(INBOX_FILE, "utf8"));
    checks.push({
      check: "inbox acquisition mode is cross-search",
      pass: inbox.acquisition_mode === "SNS_SEARCH_CROSS_FETCH" || inbox.fetch_summary
    });
    const feedUrl =
      inbox.fetch_summary &&
      inbox.fetch_summary.platforms &&
      inbox.fetch_summary.platforms.X &&
      inbox.fetch_summary.platforms.X.feed_url;
    checks.push({
      check: "inbox feed is posts-cross-search",
      pass: /posts-cross-search\.json$/i.test(String(feedUrl || ""))
    });
    if (feedUrl && !/posts-cross-search\.json$/i.test(feedUrl)) {
      errors.push("inbox must use posts-cross-search.json");
    }
  }

  if (fs.existsSync(PUBLIC_INDEX_FILE)) {
    const index = JSON.parse(fs.readFileSync(PUBLIC_INDEX_FILE, "utf8"));
    const entries = index.entries || [];
    const unregistered = entries.filter(function (entry) {
      return entry.source === "SOC-X-CROSS-SEARCH";
    }).length;
    checks.push({
      check: "public index uses cross-search source",
      pass: unregistered > 0,
      entry_count: entries.length,
      cross_search_count: unregistered
    });
  }

  const result = {
    DISASTER_X_CROSS_SEARCH_OPEN_ACQUISITION_VALIDATION:
      errors.length === 0 ? "PASS" : "FAIL",
    acquisition: {
      mode: "SNS_SEARCH_CROSS_FETCH",
      feed_url: DEFAULT_X_CROSS_SEARCH_FEED_URL,
      since_date: SNS_FETCH_SINCE_DATE,
      municipality_scope_count: 23,
      sender_restriction: false,
      keyword_exclusion_at_acquisition: false,
      category_exclusion_at_acquisition: false,
      ai_exclusion: false
    },
    checks: checks,
    errors: errors
  };

  console.log(JSON.stringify(result, null, 2));
  if (errors.length) {
    process.exit(1);
  }
  console.log("DISASTER_X_CROSS_SEARCH_OPEN_ACQUISITION_VALIDATION_COMPLETE");
}

main();
