#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PATROL_WORKFLOW = path.join(ROOT, ".github", "workflows", "patrol.yml");
const PACKAGE_JSON = path.join(ROOT, "package.json");

function extractWorkflowStep(workflow, stepName) {
  const marker = "- name: " + stepName;
  const start = workflow.indexOf(marker);
  if (start === -1) {
    return "";
  }
  const next = workflow.indexOf("\n      - name:", start + marker.length);
  return next === -1 ? workflow.slice(start) : workflow.slice(start, next);
}

function main() {
  const errors = [];
  const checks = [];
  const workflow = fs.readFileSync(PATROL_WORKFLOW, "utf8");
  const packageJson = fs.readFileSync(PACKAGE_JSON, "utf8");

  const syncIndex = workflow.indexOf("Sync public status from patrol report");
  const buildIndex = workflow.indexOf("Build public search indices");
  const officialValidationIndex = workflow.indexOf("Run official info publication validation");
  const publishIndex = workflow.indexOf("Publish official public data");
  const xValidationIndex = workflow.indexOf("Run X cross-search validation");

  const publishStep = extractWorkflowStep(workflow, "Publish official public data");
  const xValidationStep = extractWorkflowStep(workflow, "Run X cross-search validation");

  checks.push({
    check: "package.json defines validate:official-info",
    pass: /"validate:official-info":\s*"node scripts\/validate-official-info-layer\.js"/.test(packageJson)
  });
  if (!/"validate:official-info":\s*"node scripts\/validate-official-info-layer\.js"/.test(packageJson)) {
    errors.push("package.json must define validate:official-info");
  }

  checks.push({
    check: "package.json defines validate:x-cross-search",
    pass: /"validate:x-cross-search":\s*"node scripts\/validate-x-cross-search-layer\.js"/.test(packageJson)
  });
  if (!/"validate:x-cross-search":\s*"node scripts\/validate-x-cross-search-layer\.js"/.test(packageJson)) {
    errors.push("package.json must define validate:x-cross-search");
  }

  checks.push({
    check: "official validation runs before publish and after sync",
    pass:
      syncIndex !== -1 &&
      officialValidationIndex > syncIndex &&
      publishIndex > officialValidationIndex
  });
  if (
    syncIndex === -1 ||
    officialValidationIndex <= syncIndex ||
    publishIndex <= officialValidationIndex
  ) {
    errors.push("patrol.yml must validate official info before publishing");
  }

  checks.push({
    check: "build runs before official validation when auto-apply is enabled",
    pass: buildIndex !== -1 && buildIndex < officialValidationIndex
  });
  if (buildIndex === -1 || buildIndex >= officialValidationIndex) {
    errors.push("patrol.yml must build public indices before official validation");
  }

  checks.push({
    check: "x-cross-search validation runs after official publish",
    pass: xValidationIndex !== -1 && xValidationIndex > publishIndex
  });
  if (xValidationIndex === -1 || xValidationIndex <= publishIndex) {
    errors.push("patrol.yml must run x-cross-search validation after official publish");
  }

  checks.push({
    check: "x-cross-search validation does not block workflow",
    pass: /continue-on-error:\s*true/.test(xValidationStep)
  });
  if (!/continue-on-error:\s*true/.test(xValidationStep)) {
    errors.push("x-cross-search validation must use continue-on-error: true");
  }

  checks.push({
    check: "official publish always stages status.json",
    pass: /git add data\/public\/status\.json/.test(publishStep)
  });
  if (!/git add data\/public\/status\.json/.test(publishStep)) {
    errors.push("official publish must stage data/public/status.json");
  }

  checks.push({
    check: "official publish can stage phase1_updates when auto-apply is enabled",
    pass: /phase1_updates\.json/.test(publishStep)
  });
  if (!/phase1_updates\.json/.test(publishStep)) {
    errors.push("official publish must stage phase1_updates for auto-apply");
  }

  checks.push({
    check: "patrol workflow no longer gates official publish on npm test",
    pass: !/Run publication validation[\s\S]*npm test/.test(workflow)
  });
  if (/Run publication validation[\s\S]*npm test/.test(workflow)) {
    errors.push("patrol.yml must not gate official publish on npm test");
  }

  const result = {
    PATROL_STATUS_PUBLISH_GATE_VALIDATION: errors.length === 0 ? "PASS" : "FAIL",
    checks: checks,
    errors: errors
  };

  console.log(JSON.stringify(result, null, 2));
  if (errors.length) {
    process.exit(1);
  }
  console.log("PATROL_STATUS_PUBLISH_GATE_SEPARATION_COMPLETE");
}

main();
