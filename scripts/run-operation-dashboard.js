#!/usr/bin/env node
"use strict";

const { writeOperationDashboard } = require("../monitor/dashboard/dashboard-aggregator");

function main() {
  const result = writeOperationDashboard();
  const dashboard = result.dashboard;

  console.log("=== Disaster Portal Operation Dashboard ===");
  console.log(JSON.stringify({
    timestamp: dashboard.timestamp,
    status_layer: dashboard.status_layer,
    municipalities: dashboard.municipalities,
    patrol_status: dashboard.patrol_status,
    diff_count: dashboard.diff_count,
    classification_count: dashboard.classification_count,
    review_pending_count: dashboard.review_pending_count,
    approved_count: dashboard.approved_count,
    rejected_count: dashboard.rejected_count,
    public_update_count: dashboard.public_update_count,
    gate_status: dashboard.gate_status,
    incident_count: dashboard.incident_count,
    categories: dashboard.categories.map(function (item) {
      return {
        category: item.category,
        pending_count: item.pending_count,
        municipality_count: item.municipality_count
      };
    }),
    audit_traces: {
      total: dashboard.audit_traces.total,
      complete_count: dashboard.audit_traces.complete_count
    },
    output: result.outputPath
  }, null, 2));
}

main();
