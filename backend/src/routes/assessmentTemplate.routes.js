const express = require("express");
const router = express.Router();
const assessmentTemplateController = require("../controllers/assessmentTemplate.controller");
const authenticate = require("../middleware/auth.middleware");
const checkPermission = require("../middleware/rbac.middleware");

router.use(authenticate);

router.get(
  "/",
  checkPermission("questions:read"),
  assessmentTemplateController.getTemplates.bind(assessmentTemplateController)
);

router.get(
  "/:id",
  checkPermission("questions:read"),
  assessmentTemplateController.getTemplateById.bind(assessmentTemplateController)
);

router.post(
  "/",
  checkPermission("questions:write"),
  assessmentTemplateController.createTemplate.bind(assessmentTemplateController)
);

router.put(
  "/:id",
  checkPermission("questions:write"),
  assessmentTemplateController.updateTemplate.bind(assessmentTemplateController)
);

router.patch(
  "/:id/archive",
  checkPermission("questions:write"),
  assessmentTemplateController.archiveTemplate.bind(assessmentTemplateController)
);

router.patch(
  "/:id/restore",
  checkPermission("questions:write"),
  assessmentTemplateController.restoreTemplate.bind(assessmentTemplateController)
);

module.exports = router;
