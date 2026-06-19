const express = require("express");
const router = express.Router();
const testPaperController = require("../controllers/testPaper.controller");
const authenticate = require("../middleware/auth.middleware");
const checkPermission = require("../middleware/rbac.middleware");

router.use(authenticate);

router.get(
  "/",
  checkPermission("questions:read"),
  testPaperController.getTestPapers.bind(testPaperController)
);

router.get(
  "/:id/summary",
  checkPermission("questions:read"),
  testPaperController.getAssessmentSummary.bind(testPaperController)
);

router.get(
  "/:id/marks",
  checkPermission("questions:read"),
  testPaperController.getAssessmentMarks.bind(testPaperController)
);

router.get(
  "/:id/blueprint",
  checkPermission("questions:read"),
  testPaperController.getBlueprint.bind(testPaperController)
);

router.put(
  "/:id/blueprint",
  checkPermission("questions:write"),
  testPaperController.updateBlueprint.bind(testPaperController)
);

router.post(
  "/:id/validate-generation",
  checkPermission("questions:read"),
  testPaperController.validateBlueprintGeneration.bind(testPaperController)
);

router.post(
  "/:id/apply-section-map",
  checkPermission("questions:write"),
  testPaperController.applyBlueprintSectionMapping.bind(testPaperController)
);

router.get(
  "/:id",
  checkPermission("questions:read"),
  testPaperController.getTestPaperById.bind(testPaperController)
);

router.post(
  "/:id/sets/generate",
  checkPermission("questions:write"),
  testPaperController.generateQuestionPaperSets.bind(testPaperController)
);

router.delete(
  "/:id/sets/:setId",
  checkPermission("questions:write"),
  testPaperController.deleteQuestionPaperSet.bind(testPaperController)
);

router.post(
  "/",
  checkPermission("questions:write"),
  testPaperController.createTestPaper.bind(testPaperController)
);

router.put(
  "/:id",
  checkPermission("questions:write"),
  testPaperController.updateTestPaper.bind(testPaperController)
);

router.patch(
  "/:id/status",
  checkPermission("questions:write"),
  testPaperController.updateTestPaperStatus.bind(testPaperController)
);

router.delete(
  "/:id",
  checkPermission("questions:write"),
  testPaperController.deleteTestPaper.bind(testPaperController)
);

module.exports = router;
