const express = require("express");
const router = express.Router();
const questionController = require("../controllers/question.controller");
const apiSnapshotController = require("../controllers/apiSnapshot.controller");
const authenticate = require("../middleware/auth.middleware");
const checkPermission = require("../middleware/rbac.middleware");
const upload = require("../middleware/upload.middleware");

router.use(authenticate);

router.get(
  "/",
  checkPermission("questions:read"),
  questionController.getBanks.bind(questionController)
);

router.get(
  "/template/latest/info",
  checkPermission("questions:read"),
  questionController.getLatestExcelTemplateInfo.bind(questionController)
);

router.get(
  "/template/latest/download",
  checkPermission("questions:read"),
  questionController.downloadLatestExcelTemplate.bind(questionController)
);

router.post(
  "/import/excel/preview",
  checkPermission("questions:write"),
  upload.single("file"),
  questionController.previewExcelImport.bind(questionController)
);

router.post(
  "/import/excel/commit",
  checkPermission("questions:write"),
  questionController.commitExcelImport.bind(questionController)
);

router.get(
  "/api-snapshot",
  checkPermission("questions:read"),
  apiSnapshotController.getQuestionBankSnapshot.bind(apiSnapshotController)
);

router.get(
  "/:id",
  checkPermission("questions:read"),
  questionController.getBankById.bind(questionController)
);

router.post(
  "/",
  checkPermission("questions:write"),
  questionController.createBank.bind(questionController)
);

router.put(
  "/:id",
  checkPermission("questions:write"),
  questionController.updateBank.bind(questionController)
);

router.delete(
  "/:id",
  checkPermission("questions:write"),
  questionController.deleteBank.bind(questionController)
);

// Link/Unlink questions inside banks
router.post(
  "/:bankId/questions",
  checkPermission("questions:write"),
  questionController.addQuestionToBank.bind(questionController)
);

router.delete(
  "/:bankId/questions/:questionId",
  checkPermission("questions:write"),
  questionController.removeQuestionFromBank.bind(questionController)
);

router.post(
  "/:bankId/questions/bulk-unlink",
  checkPermission("questions:write"),
  questionController.removeQuestionsFromBank.bind(questionController)
);

module.exports = router;
