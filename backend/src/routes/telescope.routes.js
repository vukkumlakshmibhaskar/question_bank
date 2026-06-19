const express = require("express");
const jwt = require("jsonwebtoken");
const telescopeController = require("../controllers/telescope.controller");
const authenticate = require("../middleware/auth.middleware");
const checkPermission = require("../middleware/rbac.middleware");

const router = express.Router();
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || "default_access_secret_123!@#";

const requireAdmin = (req, res, next) => {
  if (req.user?.role !== "ADMIN") {
    return res.status(403).json({ error: "Admin access is required for Telescope." });
  }
  return next();
};

const optionalAuthenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) return next();

  try {
    req.user = jwt.verify(authHeader.split(" ")[1], JWT_ACCESS_SECRET);
  } catch {
    // Frontend telemetry must still be accepted when the auth failure itself is the error.
  }

  return next();
};

router.post(
  "/frontend-errors",
  optionalAuthenticate,
  telescopeController.recordFrontendError.bind(telescopeController)
);

router.use(authenticate);
router.use(checkPermission("audit:read"));
router.use(requireAdmin);

router.get("/summary", telescopeController.getSummary.bind(telescopeController));
router.get("/requests", telescopeController.getRequests.bind(telescopeController));
router.get("/requests/:id", telescopeController.getRequestDetail.bind(telescopeController));
router.get("/errors", telescopeController.getErrors.bind(telescopeController));
router.get("/errors/:id", telescopeController.getErrorDetail.bind(telescopeController));
router.get("/jobs", telescopeController.getJobs.bind(telescopeController));
router.get("/services", telescopeController.getServices.bind(telescopeController));
router.get("/data-health", telescopeController.getDataHealth.bind(telescopeController));
router.get("/audit-logs", telescopeController.getAuditLogs.bind(telescopeController));
router.post("/extraction/import", telescopeController.importExtractionReview.bind(telescopeController));
router.post("/lb/import", telescopeController.importExtractionReview.bind(telescopeController));
router.get("/diagnostics/export", telescopeController.exportDiagnostics.bind(telescopeController));

module.exports = router;
