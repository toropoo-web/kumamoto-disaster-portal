(function () {
  "use strict";

  var OPERATOR_VIEW_URL =
    "../../data/review/support_service/support_service_operator_view.json";
  var state = {
    view: null,
    selectedReviewId: null
  };

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatDate(value) {
    if (!value) {
      return "UNKNOWN";
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

  function renderStatusSummary(view) {
    var container = document.getElementById("review-status-summary");
    if (!container) {
      return;
    }

    var summary = view.status_summary || {};
    var labels = ["NEW", "REVIEWING", "APPROVED", "REJECTED", "APPLIED"];
    container.innerHTML = labels
      .map(function (status) {
        return (
          '<div class="support-service-review__summary-card">' +
          '<div class="support-service-review__summary-label">' +
          escapeHtml(status) +
          "</div>" +
          '<div class="support-service-review__summary-value">' +
          escapeHtml(summary[status] || 0) +
          "</div>" +
          "</div>"
        );
      })
      .join("");
  }

  function renderAlerts(view) {
    var container = document.getElementById("review-alert-list");
    if (!container) {
      return;
    }

    var alerts = view.alerts || [];
    if (!alerts.length) {
      container.innerHTML = '<p class="support-service-review__empty">確認対象アラートはありません。</p>';
      return;
    }

    container.innerHTML =
      '<table class="support-service-review__table" aria-label="アラート一覧">' +
      "<thead><tr>" +
      "<th>Alert ID</th><th>Change Type</th><th>作成日時</th><th>Status</th>" +
      "</tr></thead><tbody>" +
      alerts
        .map(function (alert) {
          return (
            "<tr>" +
            "<td>" +
            escapeHtml(alert.alert_id) +
            "</td>" +
            "<td>" +
            escapeHtml(alert.change_type) +
            "</td>" +
            "<td>" +
            escapeHtml(formatDate(alert.created_at)) +
            "</td>" +
            "<td>" +
            escapeHtml(alert.status) +
            "</td>" +
            "</tr>"
          );
        })
        .join("") +
      "</tbody></table>";
  }

  function renderReviewList(view) {
    var container = document.getElementById("review-list");
    if (!container) {
      return;
    }

    var reviews = view.reviews || [];
    if (!reviews.length) {
      container.innerHTML = '<p class="support-service-review__empty">確認対象の変更はありません。</p>';
      return;
    }

    container.innerHTML =
      '<table class="support-service-review__table" aria-label="変更確認一覧">' +
      "<thead><tr>" +
      "<th>Review ID</th><th>Change Type</th><th>タイトル</th><th>施設名</th><th>地域</th><th>情報提供元</th><th>検出日時</th><th>Status</th>" +
      "</tr></thead><tbody>" +
      reviews
        .map(function (review) {
          return (
            "<tr>" +
            '<td><button type="button" class="support-service-review__row-button" data-review-id="' +
            escapeHtml(review.review_id) +
            '">' +
            escapeHtml(review.review_id) +
            "</button></td>" +
            "<td>" +
            escapeHtml(review.change_type) +
            "</td>" +
            "<td>" +
            escapeHtml(review.title) +
            "</td>" +
            "<td>" +
            escapeHtml(review.facility_name) +
            "</td>" +
            "<td>" +
            escapeHtml(review.municipality) +
            "</td>" +
            "<td>" +
            escapeHtml((review.source && review.source.source_name) || "UNKNOWN") +
            "</td>" +
            "<td>" +
            escapeHtml(formatDate(review.detected_at)) +
            "</td>" +
            '<td><span class="support-service-review__status support-service-review__status--' +
            escapeHtml(review.status) +
            '">' +
            escapeHtml(review.status) +
            "</span></td>" +
            "</tr>"
          );
        })
        .join("") +
      "</tbody></table>";

    container.querySelectorAll("[data-review-id]").forEach(function (button) {
      button.addEventListener("click", function () {
        selectReview(button.getAttribute("data-review-id"));
      });
    });
  }

  function renderMetaItem(label, value) {
    return (
      '<div class="support-service-review__meta-item">' +
      '<div class="support-service-review__meta-label">' +
      escapeHtml(label) +
      "</div>" +
      "<div>" +
      escapeHtml(value) +
      "</div>" +
      "</div>"
    );
  }

  function renderDiff(review) {
    if (!review.diff || !review.diff.has_diff) {
      return '<p class="support-service-review__empty">差分はありません。</p>';
    }

    return (
      '<table class="support-service-review__diff-table" aria-label="差分表示">' +
      "<thead><tr><th>項目</th><th>Before</th><th>After</th></tr></thead><tbody>" +
      review.diff.fields
        .map(function (field) {
          return (
            "<tr>" +
            "<td>" +
            escapeHtml(field.field) +
            "</td>" +
            "<td>" +
            escapeHtml(field.before) +
            "</td>" +
            "<td>" +
            escapeHtml(field.after) +
            "</td>" +
            "</tr>"
          );
        })
        .join("") +
      "</tbody></table>"
    );
  }

  function renderLogs(review) {
    var logs = review.logs || [];
    if (!logs.length) {
      return '<p class="support-service-review__empty">確認履歴はありません。</p>';
    }

    return (
      '<div class="support-service-review__logs">' +
      logs
        .map(function (log) {
          return (
            '<div class="support-service-review__log-item">' +
            escapeHtml(log.action) +
            " / " +
            escapeHtml(formatDate(log.timestamp)) +
            " / " +
            escapeHtml(log.reviewer || "UNKNOWN") +
            "</div>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  function buildOperationCommand(reviewId, action) {
    return (
      "npm run review:support-service-change -- --review-id=" +
      reviewId +
      " --action=" +
      action +
      " --reviewer=担当者名"
    );
  }

  function renderOperations(review) {
    var command = document.getElementById("review-operation-command");
    var panel = document.getElementById("review-operations");
    if (!command || !panel || !review) {
      return;
    }

    var actions = review.available_actions || [];
    var buttons =
      actions.length > 0
        ? '<div class="support-service-review__action-buttons">' +
          actions
            .map(function (action) {
              return (
                '<button type="button" class="support-service-review__action-button" data-action="' +
                escapeHtml(action) +
                '">' +
                escapeHtml(action) +
                "</button>"
              );
            })
            .join("") +
          "</div>"
        : '<p class="support-service-review__empty">実行可能な操作はありません。</p>';

    panel.innerHTML =
      '<p class="support-service-review__note">操作は CLI で実行してください（自動承認・自動公開は行いません）。</p>' +
      buttons +
      '<pre id="review-operation-command" class="support-service-review__command"></pre>';

    var commandNode = document.getElementById("review-operation-command");
    var defaultAction = actions[0] || "START";
    commandNode.textContent = buildOperationCommand(review.review_id, defaultAction);

    panel.querySelectorAll("[data-action]").forEach(function (button) {
      button.addEventListener("click", function () {
        commandNode.textContent = buildOperationCommand(
          review.review_id,
          button.getAttribute("data-action")
        );
      });
    });
  }

  function renderReviewDetail(review) {
    var container = document.getElementById("review-detail");
    if (!container || !review) {
      return;
    }

    var source = review.source || {};
    container.innerHTML =
      '<div class="support-service-review__meta-grid">' +
      renderMetaItem("Review ID", review.review_id) +
      renderMetaItem("Change Type", review.change_type) +
      renderMetaItem("Status", review.status) +
      renderMetaItem("タイトル", review.title) +
      renderMetaItem("施設名", review.facility_name) +
      renderMetaItem("地域", review.municipality) +
      renderMetaItem("検出日時", formatDate(review.detected_at)) +
      renderMetaItem("情報提供元", source.source_name || "UNKNOWN") +
      renderMetaItem("URL", source.url || "UNKNOWN") +
      renderMetaItem("Account", source.account || "") +
      renderMetaItem("Area", source.area || "UNKNOWN") +
      renderMetaItem("Categories", (source.categories || []).join(", ") || "UNKNOWN") +
      "</div>" +
      "<h3>差分（Before → After）</h3>" +
      renderDiff(review) +
      "<h3>確認履歴</h3>" +
      renderLogs(review);

    renderOperations(review);
  }

  function selectReview(reviewId) {
    state.selectedReviewId = reviewId;
    var review = (state.view.reviews || []).find(function (entry) {
      return entry.review_id === reviewId;
    });
    renderReviewDetail(review);
  }

  function renderPage(view) {
    state.view = view;
    renderStatusSummary(view);
    renderAlerts(view);
    renderReviewList(view);

    if (state.selectedReviewId) {
      selectReview(state.selectedReviewId);
    } else if ((view.reviews || []).length) {
      selectReview(view.reviews[0].review_id);
    }
  }

  function renderError(message) {
    var container = document.getElementById("review-list");
    if (container) {
      container.innerHTML =
        '<p class="support-service-review__empty">読み込みに失敗しました: ' +
        escapeHtml(message) +
        "</p>";
    }
  }

  loadJson(OPERATOR_VIEW_URL)
    .then(function (view) {
      renderPage(view);
    })
    .catch(function (error) {
      renderError(error.message);
    });
})();
