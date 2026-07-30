#!/usr/bin/env node
"use strict";

const { runAutoApply } = require("../monitor/auto-apply-engine");
const { runPostApplyValidation } = require("../monitor/post-apply-validation");
const { runPublicDataBuild } = require("../monitor/public-data-build");

async function main() {
  const apply = process.argv.includes("--apply");
  const result = await runAutoApply({ apply });

  const output = Object.assign({}, result, {
    POST_APPLY_VALIDATION: null,
    BUILD: null
  });

  if (result.APPLIED) {
    const appliedUrls = (result.applied || []).map(function (entry) {
      return entry.url;
    });
    const validationResult = await runPostApplyValidation({ appliedUrls });
    output.POST_APPLY_VALIDATION = validationResult.POST_APPLY_VALIDATION;
    output.postApplyChecks = validationResult.checks;
    output.errors = (output.errors || []).concat(validationResult.errors || []);

    try {
      runPublicDataBuild();
      output.BUILD = "PASS";
    } catch (err) {
      output.BUILD = "FAIL";
      output.errors.push("Build failed after auto-apply");
    }
  }

  console.log("=== Auto Apply Candidates ===");
  console.log(JSON.stringify(output, null, 2));

  if (output.errors && output.errors.length) {
    process.exit(1);
  }

  if (!apply) {
    console.log("AUTO_APPLY_PREVIEW_COMPLETE");
  } else {
    console.log("AUTO_APPLY_COMPLETE");
  }
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
