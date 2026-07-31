#!/usr/bin/env node
"use strict";

const path = require("path");

const {
  loadDisasterSocialInbox,
  validateDisasterSocialInbox,
  AUTO_PUBLISH
} = require(path.join(__dirname, "..", "monitor", "disaster-social-pipeline"));

function main() {
  const inbox = loadDisasterSocialInbox();
  const errors = validateDisasterSocialInbox(inbox);

  console.log("=== Disaster Social Inbox Schema Validation ===");
  console.log(
    JSON.stringify(
      {
        DISASTER_SOCIAL_INBOX_SCHEMA_VALIDATION: errors.length === 0 ? "PASS" : "FAIL",
        inbox_item_count: (inbox.items || []).length,
        AUTO_PUBLISH: AUTO_PUBLISH,
        errors: errors
      },
      null,
      2
    )
  );

  if (errors.length) {
    process.exit(1);
  }

  console.log("DISASTER_SOCIAL_INBOX_SCHEMA_VALIDATION_COMPLETE");
}

main();
