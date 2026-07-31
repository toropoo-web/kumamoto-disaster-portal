#!/usr/bin/env node
"use strict";

const adapter = require("../js/communication-display-adapter");

const errors = [];
const checks = [];

function check(name, pass, detail) {
  checks.push({ check: name, pass: pass, detail: detail || null });
  if (!pass) {
    errors.push(name + (detail ? ": " + detail : ""));
  }
}

const docomo = adapter.adaptCommunicationProvider({
  provider_name: "NTTドコモ",
  status: "PARTIAL_OUTAGE",
  status_label: "一部地域（第6報）",
  areas: ["八代市", "宇城市"],
  last_checked: "2026-07-29T19:00:00+09:00",
  source_url: "https://example.com/docomo"
});

check("docomo status PARTIAL", docomo.status === "PARTIAL");
check("docomo status_label", docomo.status_label === "🟡 一部地域で利用可能");
check("docomo areas", docomo.areas.join("・") === "八代市・宇城市");
check("docomo carrier", docomo.carrier === "NTTドコモ");
check("docomo checked_at", docomo.checked_at.length > 0);

const softbank = adapter.adaptCommunicationProvider({
  provider_name: "SoftBank",
  status: "CHECK_OFFICIAL",
  status_label: "公式情報を確認",
  areas: [],
  last_checked: "2026-07-29T15:00:00+09:00"
});

check("softbank status UNKNOWN", softbank.status === "UNKNOWN");
check("softbank status_label", softbank.status_label === "⚪ 情報確認中");
check("softbank areas empty", softbank.areas.length === 0);

const partialNoAreas = adapter.adaptCommunicationProvider({
  provider_name: "Example",
  status: "PARTIAL_OUTAGE",
  status_label: "一部地域",
  areas: []
});

check("partial without areas keeps PARTIAL", partialNoAreas.status === "PARTIAL");
check("partial without areas empty list", partialNoAreas.areas.length === 0);

const available = adapter.adaptCommunicationService({
  service_name: "00000JAPAN",
  status: "AVAILABLE",
  last_checked: "2026-07-28T19:45:00+09:00"
});

check("wifi status AVAILABLE", available.status === "AVAILABLE");
check("wifi status_label", available.status_label === "🟢 利用可能");

const outage = adapter.adaptCommunicationProvider({
  provider_name: "Carrier",
  status: "OUTAGE",
  areas: ["八代市"]
});

check("outage status UNAVAILABLE", outage.status === "UNAVAILABLE");
check("outage status_label", outage.status_label === "🔴 利用困難");
check("outage areas from official field", outage.areas.join("") === "八代市");

const unknown = adapter.adaptCommunicationProvider({
  provider_name: "Carrier",
  status: "PENDING"
});

check("pending status UNKNOWN", unknown.status === "UNKNOWN");

const result = {
  COMMUNICATION_DISPLAY_ADAPTER: errors.length === 0 ? "PASS" : "FAIL",
  checks: checks,
  errors: errors
};

console.log("=== Communication Display Adapter Validation ===");
console.log(JSON.stringify(result, null, 2));

if (errors.length > 0) {
  process.exit(1);
}
