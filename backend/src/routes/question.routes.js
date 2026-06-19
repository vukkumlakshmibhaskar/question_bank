const express = require("express");
const router = express.Router();
const questionController = require("../controllers/question.controller");
const authenticate = require("../middleware/auth.middleware");
const checkPermission = require("../middleware/rbac.middleware");

router.use(authenticate);

router.get(
  "/",
  checkPermission("questions:read"),
  questionController.getQuestions.bind(questionController)
);

router.post(
  "/bulk-delete",
  checkPermission("questions:write"),
  questionController.bulkDeleteQuestions.bind(questionController)
);

router.get(
  "/:id",
  checkPermission("questions:read"),
  questionController.getQuestionById.bind(questionController)
);

router.post(
  "/",
  checkPermission("questions:write"),
  questionController.createQuestion.bind(questionController)
);

router.put(
  "/:id",
  checkPermission("questions:write"),
  questionController.updateQuestion.bind(questionController)
);

router.delete(
  "/:id",
  checkPermission("questions:write"),
  questionController.deleteQuestion.bind(questionController)
);

module.exports = router;
