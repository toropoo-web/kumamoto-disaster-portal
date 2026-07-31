(function () {
  "use strict";

  var COUNTER_URL = "../../data/operation_monitor/internal-operation-counter.json";
  var USAGE_COUNTER_URL = "../../data/operation_monitor/user-usage-counter.json";

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatDate(value) {
    if (!value) {
      return "—";
    }
    return String(value).replace("T", " ").replace("Z", " UTC");
  }

  function loadJson(url) {
    return fetch(url).then(function (response) {
      if (!response.ok) {
        throw new Error("Failed to load " + url);
      }
      return response.json();
    });
  }

  function renderSummary(report) {
    var container = document.getElementById("counter-summary");
    if (!container) {
      return;
    }

    var cards = [
      { label: "情報面数", value: report.page_view_count },
      { label: "運用レポート生成回数", value: report.operator_report_count },
      { label: "最終アクセス相当", value: formatDate(report.last_access_time) },
      { label: "生成日時", value: formatDate(report.generated_at) }
    ];

    container.innerHTML = cards
      .map(function (card) {
        return (
          '<div class="internal-operation-counter__summary-card">' +
          '<div class="internal-operation-counter__summary-label">' +
          escapeHtml(card.label) +
          "</div>" +
          '<div class="internal-operation-counter__summary-value">' +
          escapeHtml(card.value) +
          "</div>" +
          "</div>"
        );
      })
      .join("");
  }

  function renderUsageSummary(report) {
    var container = document.getElementById("usage-summary");
    if (!container) {
      return;
    }

    if (!report) {
      container.innerHTML = '<p class="internal-operation-counter__empty">利用実績データがありません。</p>';
      return;
    }

    var cards = [
      { label: "累計訪問数", value: report.page_views },
      { label: "本日の訪問数", value: report.today_views },
      { label: "最終訪問時刻", value: formatDate(report.last_access_at) },
      { label: "集計日", value: report.today_key || "—" }
    ];

    container.innerHTML = cards
      .map(function (card) {
        return (
          '<div class="internal-operation-counter__summary-card">' +
          '<div class="internal-operation-counter__summary-label">' +
          escapeHtml(card.label) +
          "</div>" +
          '<div class="internal-operation-counter__summary-value">' +
          escapeHtml(card.value) +
          "</div>" +
          "</div>"
        );
      })
      .join("");
  }

  function renderUsageEvents(report) {
    var container = document.getElementById("usage-events");
    if (!container) {
      return;
    }

    if (!report || !report.events) {
      container.innerHTML = '<p class="internal-operation-counter__empty">利用アクションがありません。</p>';
      return;
    }

    var labels = {
      water_search: "WATER検索回数",
      water_detail_view: "給水情報表示回数",
      volunteer_search: "VOLUNTEER検索回数",
      support_service_search: "SUPPORT_SERVICE検索回数",
      communication_view: "通信情報表示回数",
      official_info_view: "公式情報カード表示回数"
    };

    var keys = Object.keys(labels);
    container.innerHTML =
      '<table class="internal-operation-counter__table" aria-label="利用アクション一覧">' +
      "<thead><tr><th>アクション</th><th>回数</th></tr></thead><tbody>" +
      keys
        .map(function (key) {
          return (
            "<tr><td>" +
            escapeHtml(labels[key]) +
            "</td><td>" +
            escapeHtml(report.events[key] || 0) +
            "</td></tr>"
          );
        })
        .join("") +
      "</tbody></table>";
  }

  function renderCategoryUsage(report) {
    var container = document.getElementById("category-usage");
    if (!container) {
      return;
    }

    var counts = report.category_usage_count || {};
    var keys = Object.keys(counts).sort();
    if (!keys.length) {
      container.innerHTML = '<p class="internal-operation-counter__empty">カテゴリ件数がありません。</p>';
      return;
    }

    container.innerHTML =
      '<table class="internal-operation-counter__table" aria-label="カテゴリ件数一覧">' +
      "<thead><tr><th>カテゴリ</th><th>件数</th></tr></thead><tbody>" +
      keys
        .map(function (key) {
          return (
            "<tr><td>" +
            escapeHtml(key) +
            "</td><td>" +
            escapeHtml(counts[key]) +
            "</td></tr>"
          );
        })
        .join("") +
      "</tbody></table>";
  }

  function renderPatrolSummary(report) {
    var container = document.getElementById("patrol-summary");
    if (!container) {
      return;
    }

    var summary = report.patrol_status_summary || {};
    var rows = [
      ["system_status", summary.system_status],
      ["source_count", summary.source_count],
      ["sources_checked", summary.sources_checked],
      ["changes_detected", summary.changes_detected],
      ["last_patrol_at", formatDate(summary.last_patrol_at)],
      ["last_success_at", formatDate(summary.last_success_at)],
      ["last_validation_at", formatDate(summary.last_validation_at)]
    ];

    container.innerHTML =
      '<dl class="internal-operation-counter__meta">' +
      rows
        .map(function (row) {
          return (
            "<dt>" +
            escapeHtml(row[0]) +
            "</dt><dd>" +
            escapeHtml(row[1]) +
            "</dd>"
          );
        })
        .join("") +
      "</dl>";
  }

  function renderError(message) {
    var page = document.getElementById("internal-operation-counter-page");
    if (!page) {
      return;
    }
    var wrap = document.createElement("div");
    wrap.className = "container load-error";
    wrap.setAttribute("role", "alert");
    wrap.innerHTML = '<p class="load-error__message">' + escapeHtml(message) + "</p>";
    page.innerHTML = "";
    page.appendChild(wrap);
  }

  function init() {
    Promise.all([
      loadJson(COUNTER_URL),
      loadJson(USAGE_COUNTER_URL).catch(function () {
        return null;
      })
    ])
      .then(function (results) {
        var report = results[0];
        var usageReport = results[1];
        renderSummary(report);
        renderUsageSummary(usageReport);
        renderUsageEvents(usageReport);
        renderCategoryUsage(report);
        renderPatrolSummary(report);
      })
      .catch(function (err) {
        renderError("内部カウンターを読み込めませんでした。npm run counter:internal-operation を実行してください。");
        if (window.console && console.error) {
          console.error(err);
        }
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
