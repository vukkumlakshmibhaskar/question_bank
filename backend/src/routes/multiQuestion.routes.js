const express = require("express");
const router = express.Router();
const multiQuestionController = require("../controllers/multiQuestion.controller");
const authenticate = require("../middleware/auth.middleware");
const checkPermission = require("../middleware/rbac.middleware");

router.use(authenticate);

router.get(
  "/settings",
  checkPermission("questions:read"),
  multiQuestionController.getSettings.bind(multiQuestionController)
);

router.get(
  "/",
  checkPermission("questions:read"),
  multiQuestionController.getQuestions.bind(multiQuestionController)
);

router.patch(
  "/:id/header",
  checkPermission("questions:write"),
  multiQuestionController.updateHeader.bind(multiQuestionController)
);

module.exports = router;
