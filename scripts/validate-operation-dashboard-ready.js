#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const {
  writeOperationDashboard,
  validateDashboardSchema,
  DASHBOARD_OUTPUT_FILE,
  DASHBOARD_CATEGORIES,
  EXPECTED_MUNICIPALITY_COUNT
} = require("../monitor/dashboard/dashboard-aggregator");

function check(name, pass, reason) {
  return { check: name, status: pass ? "PASS" : "FAIL", reason: reason || null };
}

function statusFrom(checks) {
  return checks.some(function (item) {
    return item.status === "FAIL";
  })
    ? "FAIL"
    : "PASS";
}

function validateInfrastructure() {
  const checks = [];
  const required = [
    "monitor/dashboard/dashboard-aggregator.js",
    "scripts/run-operation-dashboard.js",
    "monitor/operation-monitor.js"
  ];

  required.forEach(function (file) {
    checks.push(check("infra." + file.replace(/[\\/]/g, "."), fs.existsSync(path.join(ROOT, file))));
  });

  return checks;
}

function validateStatusLayer(dashboard) {
  const checks = [];

  checks.push(check("status_layer.present", ["GREEN", "YELLOW", "RED"].indexOf(dashboard.status_layer) >= 0));

  if (dashboard.incident_count > 0 || dashboard.gate_status === "FAIL") {
    checks.push(check("status_layer.RED_on_incident_or_gate_fail", dashboard.status_layer === "RED"));
  } else if (dashboard.review_pending_count > 0) {
    checks.push(check("status_layer.YELLOW_on_pending", dashboard.status_layer === "YELLOW"));
  } else {
    checks.push(check("status_layer.GREEN_when_clear", dashboard.status_layer === "GREEN"));
  }

  return checks;
}

function validateMunicipalityStatus(dashboard) {
  const checks = [];
  const items = dashboard.municipality_status || [];

  checks.push(check("municipality_status.count", items.length === EXPECTED_MUNICIPALITY_COUNT));

  const areaIds = items.map(function (item) {
    return item.area_id;
  });
  const unique = new Set(areaIds);
  checks.push(check("municipality_status.area_id_unique", unique.size === areaIds.length));

  const requiredFields = ["area_id", "municipality", "patrol", "water", "shelter", "pending", "last_update"];
  const allFields = items.every(function (item) {
    return requiredFields.every(function (field) {
      return Object.prototype.hasOwnProperty.call(item, field);
    });
  });
  checks.push(check("municipality_status.fields", allFields));

  return checks;
}

function validateCategoryStatus(dashboard) {
  const checks = [];
  const categories = dashboard.categories || [];

  checks.push(check("category_status.count", categories.length === DASHBOARD_CATEGORIES.length));

  DASHBOARD_CATEGORIES.forEach(function (category) {
    const item = categories.find(function (entry) {
      return entry.category === category;
    });
    checks.push(check("category_status." + category, Boolean(item)));
    if (item) {
      checks.push(check(
        "category_status." + category + ".fields",
        typeof item.pending_count === "number" &&
        item.source_status &&
        typeof item.municipality_count === "number"
      ));
    }
  });

  return checks;
}

function validateAuditTraces(dashboard) {
  const checks = [];
  const traces = dashboard.audit_traces || {};

  checks.push(check("audit_traces.total", typeof traces.total === "number" && traces.total > 0));
  checks.push(check("audit_traces.complete_count", traces.complete_count === traces.total));
  checks.push(check("audit_traces.items_array", Array.isArray(traces.items)));

  const sample = (traces.items || [])[0];
  if (sample) {
    const chainFields = [
      "source_id", "change_log", "classification_id", "queue_id", "decision"
    ];
    chainFields.forEach(function (field) {
      checks.push(check("audit_traces.sample." + field, Object.prototype.hasOwnProperty.call(sample, field)));
    });
  }

  return checks;
}

function validatePublicDataIntegrity(dashboard) {
  const checks = [];
  checks.push(check("public_data_hash.baseline_recorded", dashboard.public_data_hash.baseline_recorded === true));
  checks.push(check("public_data_hash.unchanged", dashboard.public_data_hash.unchanged === true));
  return checks;
}

function main() {
  const errors = [];
  const sections = {};
  const writeResult = writeOperationDashboard();
  const dashboard = writeResult.dashboard;

  const schemaErrors = validateDashboardSchema(dashboard);
  sections.schema = {
    checks: schemaErrors.length === 0
      ? [check("dashboard.schema", true)]
      : schemaErrors.map(function (msg) {
        return check("dashboard.schema", false, msg);
      }),
    status: schemaErrors.length === 0 ? "PASS" : "FAIL"
  };

  sections.infrastructure = {
    checks: validateInfrastructure(),
    status: "PENDING"
  };
  sections.status_layer = {
    checks: validateStatusLayer(dashboard),
    status: "PENDING"
  };
  sections.municipality_status = {
    checks: validateMunicipalityStatus(dashboard),
    status: "PENDING"
  };
  sections.category_status = {
    checks: validateCategoryStatus(dashboard),
    status: "PENDING"
  };
  sections.audit_traces = {
    checks: validateAuditTraces(dashboard),
    status: "PENDING"
  };
  sections.public_data_integrity = {
    checks: validatePublicDataIntegrity(dashboard),
    status: "PENDING"
  };
  sections.output = {
    checks: [
      check("dashboard.file_written", fs.existsSync(writeResult.outputPath)),
      check("dashboard.path", writeResult.outputPath.indexOf("operation-dashboard.json") >= 0)
    ],
    status: "PENDING"
  };

  Object.keys(sections).forEach(function (key) {
    if (sections[key].status === "PENDING") {
      sections[key].status = statusFrom(sections[key].checks);
    }
    sections[key].checks.forEach(function (item) {
      if (item.status === "FAIL") {
        errors.push(key + ": " + item.check + (item.reason ? " (" + item.reason + ")" : ""));
      }
    });
  });

  schemaErrors.forEach(function (msg) {
    errors.push("schema: " + msg);
  });

  const overallPass = errors.length === 0;
  const output = {
    DISASTER_PORTAL_OPERATION_DASHBOARD_READY: overallPass ? "PASS" : "FAIL",
    generatedAt: new Date().toISOString(),
    dashboard_file: path.relative(ROOT, DASHBOARD_OUTPUT_FILE),
    dashboard_snapshot: {
      timestamp: dashboard.timestamp,
      status_layer: dashboard.status_layer,
      municipalities: dashboard.municipalities,
      review_pending_count: dashboard.review_pending_count,
      incident_count: dashboard.incident_count,
      gate_status: dashboard.gate_status
    },
    sections: sections,
    errors: Array.from(new Set(errors))
  };

  fs.writeFileSync(
    path.join(ROOT, "monitor", "dashboard", "dashboard-ready-report.json"),
    JSON.stringify(output, null, 2) + "\n",
    "utf8"
  );

  const summaryPath = path.join(ROOT, "monitor", "dashboard", "operation-dashboard-summary.json");
  fs.writeFileSync(
    summaryPath,
    JSON.stringify({
      DISASTER_PORTAL_OPERATION_DASHBOARD_READY: output.DISASTER_PORTAL_OPERATION_DASHBOARD_READY,
      timestamp: dashboard.timestamp,
      status_layer: dashboard.status_layer,
      municipalities: dashboard.municipalities,
      review_pending_count: dashboard.review_pending_count,
      incident_count: dashboard.incident_count,
      gate_status: dashboard.gate_status
    }, null, 2) + "\n",
    "utf8"
  );

  console.log("=== Operation Dashboard Ready Validation ===");
  console.log(JSON.stringify(output, null, 2));

  if (!overallPass) {
    process.exit(1);
  }
}

main();
