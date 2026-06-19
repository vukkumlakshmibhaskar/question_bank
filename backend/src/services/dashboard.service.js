const dashboardRepository = require("../repositories/dashboard.repository");

const numberFormatter = new Intl.NumberFormat("en-US");

const ACTION_LABELS = {
  UPLOAD_FILE: "Uploaded file",
  UPLOAD_FILE_IMPORT: "Uploaded PDF import",
  EDIT_REVIEW: "Edited extraction review",
  APPROVE_REVIEW: "Approved extraction review",
  REJECT_REVIEW: "Rejected extraction review",
  CREATE_TEST_PAPER: "Created test paper",
  UPDATE_TEST_PAPER: "Updated test paper",
  SAVE_TEST_PAPER: "Saved assessment",
  SAVE_TEST_SETTINGS_TEMPLATE: "Saved test settings template",
  CHANGE_TEST_PAPER_STATUS: "Changed test paper status",
  POST_TEST_PAPER: "Posted assessment",
  DELETE_TEST_PAPER: "Deleted test paper",
  GENERATE_TEST_PAPER_SETS: "Generated question paper sets",
  GENERATE_TEST_PAPER_QUESTIONS: "Generated assessment questions",
  DELETE_TEST_PAPER_SET: "Deleted question paper set",
};

const ROLE_PRIORITY = ["ADMIN", "TEACHER"];

class DashboardService {
  async getDashboard(user) {
    const [counts, auditLogs] = await Promise.all([
      dashboardRepository.getCounts(user),
      dashboardRepository.getRecentAuditLogs(user),
    ]);

    return {
      metrics: this.buildMetrics(user.role, counts),
      recentActivities: auditLogs.map((log) => this.formatAuditLog(log, user.role)),
      quickActions: this.buildQuickActions(user.role, counts),
      counts,
      generatedAt: new Date().toISOString(),
    };
  }

  buildMetrics(role, counts) {
    if (role === "ADMIN") {
      return [
        {
          title: "Total Active Users",
          value: this.formatNumber(counts.activeUsers),
          trend: `${this.formatNumber(counts.newUsersThisWeek)} joined this week`,
          isUp: true,
        },
        {
          title: "Questions in Database",
          value: this.formatNumber(counts.totalQuestions),
          trend: `${this.formatNumber(counts.approvedQuestions)} approved`,
          isUp: true,
        },
        {
          title: "Pending Extraction Reviews",
          value: this.formatNumber(counts.pendingReviews),
          trend: counts.pendingReviews > 0 ? "Needs review" : "Review queue clear",
          isUp: counts.pendingReviews === 0,
        },
        {
          title: "Test Papers",
          value: this.formatNumber(counts.totalTestPapers),
          trend: `${this.formatNumber(counts.publishedTestPapers)} posted`,
          isUp: true,
        },
      ];
    }

    return [
      {
        title: "My Questions Created",
        value: this.formatNumber(counts.totalQuestions),
        trend: `${this.formatNumber(counts.questionsThisWeek)} added this week`,
        isUp: true,
      },
      {
        title: "My Question Banks",
        value: this.formatNumber(counts.ownedQuestionBanks),
        trend: `${this.formatNumber(counts.questionBanks)} accessible`,
        isUp: true,
      },
      {
        title: "My Test Papers",
        value: this.formatNumber(counts.totalTestPapers),
        trend: `${this.formatNumber(counts.generatedSets)} generated sets`,
        isUp: true,
      },
      {
        title: "My Pending Reviews",
        value: this.formatNumber(counts.pendingReviews),
        trend: counts.pendingReviews > 0 ? "Awaiting approval" : "No pending reviews",
        isUp: counts.pendingReviews === 0,
      },
    ];
  }

  buildQuickActions(role, counts) {
    if (role === "ADMIN") {
      return [
        { label: "Create Question", route: "/questions", variant: "primary" },
        { label: "Create Test Paper", route: "/test-papers", variant: "secondary" },
        { label: "Manage Users", route: "/admin/users", variant: "secondary" },
        {
          label: "Review Audit Logs",
          route: "/admin/audit-logs",
          variant: "secondary",
          badge: this.formatNumber(counts.auditLogsToday),
        },
      ];
    }

    return [
      { label: "Create New Question", route: "/questions", variant: "primary" },
      { label: "Import PDF Questions", route: "/questions", variant: "secondary" },
      { label: "Assemble Test Paper", route: "/test-papers", variant: "secondary" },
      {
        label: "Review Extractions",
        route: "/reviews",
        variant: "secondary",
        badge: this.formatNumber(counts.pendingReviews),
      },
    ];
  }

  formatAuditLog(log, fallbackRole) {
    const entityName = this.getEntityName(log);
    const title = `${ACTION_LABELS[log.action] || this.humanize(log.action)}${entityName ? `: ${entityName}` : ""}`;
    const actor = log.user?.name || log.user?.email || "System";
    const actorRole = this.getActorRole(log.user, fallbackRole);

    return {
      id: log.id,
      title,
      user: actor,
      email: log.user?.email || null,
      type: actorRole.toLowerCase(),
      action: log.action,
      entityType: log.entityType,
      entityId: log.entityId,
      createdAt: log.createdAt,
    };
  }

  getActorRole(user, fallbackRole = "TEACHER") {
    const roles = (user?.userRoles || [])
      .map((userRole) => userRole.role?.name)
      .filter(Boolean);

    return ROLE_PRIORITY.find((role) => roles.includes(role)) || fallbackRole || "TEACHER";
  }

  getEntityName(log) {
    const data = log.newValue || log.oldValue || {};
    if (data.fileName) return data.fileName;
    if (data.title) return data.title;
    if (data.name) return data.name;
    if (data.status) return `${log.entityType} #${log.entityId} (${data.status})`;
    return `${log.entityType} #${log.entityId}`;
  }

  humanize(value) {
    return String(value || "Activity")
      .toLowerCase()
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  formatNumber(value) {
    return numberFormatter.format(value || 0);
  }
}

module.exports = new DashboardService();
