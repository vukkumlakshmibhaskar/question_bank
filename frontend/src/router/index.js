import { createRouter, createWebHistory } from "vue-router";
import { useAuthStore } from "../stores/auth";

import Login from "../views/Login.vue";
import ForgotPassword from "../views/ForgotPassword.vue";
import Dashboard from "../views/Dashboard.vue";
import UserManagement from "../views/admin/UserManagement.vue";
import SubjectManagement from "../views/SubjectManagement.vue";
import QuestionBank from "../views/QuestionBank.vue";
import ManageQuestions from "../views/ManageQuestions.vue";
import ManageMultiQuestions from "../views/ManageMultiQuestions.vue";
import EvaluatorBulkUpload from "../views/EvaluatorBulkUpload.vue";
import ReviewList from "../views/ReviewList.vue";
import ReviewDetail from "../views/ReviewDetail.vue";
import AuditLogs from "../views/admin/AuditLogs.vue";
import TestPapers from "../views/TestPapers.vue";
import AssessmentBuilder from "../views/AssessmentBuilder.vue";
import Extraction from "../views/Extraction.vue";
import Telescope from "../views/admin/Telescope.vue";

const routes = [
  {
    path: "/",
    redirect: "/dashboard",
  },
  {
    path: "/login",
    name: "login",
    component: Login,
    meta: { requiresGuest: true },
  },
  {
    path: "/forgot-password",
    name: "forgot-password",
    component: ForgotPassword,
    meta: { requiresGuest: true },
  },
  {
    path: "/dashboard",
    name: "dashboard",
    component: Dashboard,
    meta: { requiresAuth: true },
  },
  {
    path: "/questions",
    name: "question-bank",
    component: QuestionBank,
    meta: { requiresAuth: true, roles: ["ADMIN", "TEACHER"] },
  },
  {
    path: "/manage-questions",
    name: "manage-questions",
    component: ManageQuestions,
    meta: { requiresAuth: true, roles: ["ADMIN", "TEACHER"] },
  },
  {
    path: "/manage-multi-questions",
    name: "manage-multi-questions",
    component: ManageMultiQuestions,
    meta: { requiresAuth: true, roles: ["ADMIN", "TEACHER"] },
  },
  {
    path: "/extraction",
    name: "extraction",
    component: Extraction,
    meta: { requiresAuth: true, roles: ["ADMIN", "TEACHER"] },
  },
  {
    path: "/lb-workflow-shell",
    redirect: "/extraction",
  },
  {
    path: "/evaluator-bulk-upload",
    name: "evaluator-bulk-upload",
    component: EvaluatorBulkUpload,
    meta: { requiresAuth: true, roles: ["ADMIN"] },
  },
  {
    path: "/subjects",
    name: "subject-management",
    component: SubjectManagement,
    meta: { requiresAuth: true, roles: ["ADMIN", "TEACHER"] },
  },
  {
    path: "/test-papers",
    name: "test-papers",
    component: TestPapers,
    meta: { requiresAuth: true, roles: ["ADMIN", "TEACHER"] },
  },
  {
    path: "/assessment-builder",
    name: "assessment-builder",
    component: AssessmentBuilder,
    meta: { requiresAuth: true, roles: ["ADMIN", "TEACHER"] },
  },
  {
    path: "/reviews",
    name: "review-list",
    component: ReviewList,
    meta: { requiresAuth: true, roles: ["ADMIN", "TEACHER"] },
  },
  {
    path: "/reviews/:id",
    name: "review-detail",
    component: ReviewDetail,
    meta: { requiresAuth: true, roles: ["ADMIN", "TEACHER"] },
  },
  {
    path: "/admin/users",
    name: "user-management",
    component: UserManagement,
    meta: { requiresAuth: true, roles: ["ADMIN"] },
  },
  {
    path: "/admin/audit-logs",
    name: "audit-logs",
    component: AuditLogs,
    meta: { requiresAuth: true, roles: ["ADMIN"] },
  },
  {
    path: "/telescope",
    name: "telescope",
    component: Telescope,
    meta: { requiresAuth: true, roles: ["ADMIN"] },
  },
  {
    path: "/:pathMatch(.*)*",
    redirect: "/dashboard",
  },
];

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
});

router.beforeEach(async (to) => {
  // Extract google tokens from query params if present
  if (to.query.google_access_token) {
    localStorage.setItem("google_access_token", to.query.google_access_token);
    if (to.query.google_refresh_token) {
      localStorage.setItem("google_refresh_token", to.query.google_refresh_token);
    }
    const query = { ...to.query };
    delete query.google_access_token;
    delete query.google_refresh_token;
    return { path: to.path, query };
  }

  const authStore = useAuthStore();
  if (authStore.isAuthenticated) {
    authStore.hydrateUserFromToken();
  }

  const isAuthenticated = authStore.isAuthenticated;
  let userRole = authStore.userRole;

  if (to.meta.requiresAuth && !isAuthenticated) {
    return { name: "login" };
  }

  if (to.meta.requiresGuest && isAuthenticated) {
    return { name: "dashboard" };
  }

  if (to.meta.roles && isAuthenticated && !userRole && authStore.refreshTokenValue) {
    try {
      await authStore.refreshSession();
      authStore.hydrateUserFromToken();
      userRole = authStore.userRole;
    } catch {
      return { name: "login" };
    }
  }

  // Check role limits
  const allowedRoles = to.meta.roles?.map((role) => role.toUpperCase());
  if (allowedRoles && !allowedRoles.includes(userRole)) {
    // If not authorized, redirect back to dashboard
    return { name: "dashboard" };
  }

  return true;
});

export default router;
