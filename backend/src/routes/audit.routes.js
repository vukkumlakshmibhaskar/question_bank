const express = require("express");
const router = express.Router();
const auditController = require("../controllers/audit.controller");
const authenticate = require("../middleware/auth.middleware");
const checkPermission = require("../middleware/rbac.middleware");

router.use(authenticate);

router.get(
  "/",
  checkPermission("audit:read"),
  auditController.getAuditLogs.bind(auditController)
);

module.exports = router;
