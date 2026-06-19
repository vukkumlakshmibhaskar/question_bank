const express = require("express");
const router = express.Router();
const subjectController = require("../controllers/subject.controller");
const authenticate = require("../middleware/auth.middleware");
const checkPermission = require("../middleware/rbac.middleware");

// All subject routes require authentication
router.use(authenticate);

// --- Subject Routes ---
router.get(
  "/",
  checkPermission("subjects:read"),
  subjectController.getHierarchy.bind(subjectController)
);

router.post(
  "/",
  checkPermission("subjects:write"),
  subjectController.createSubject.bind(subjectController)
);

router.put(
  "/:id",
  checkPermission("subjects:write"),
  subjectController.updateSubject.bind(subjectController)
);

router.delete(
  "/:id",
  checkPermission("subjects:write"),
  subjectController.deleteSubject.bind(subjectController)
);

// --- Chapter Routes ---
router.post(
  "/:subjectId/chapters",
  checkPermission("subjects:write"),
  subjectController.createChapter.bind(subjectController)
);

router.put(
  "/chapters/:id",
  checkPermission("subjects:write"),
  subjectController.updateChapter.bind(subjectController)
);

router.delete(
  "/chapters/:id",
  checkPermission("subjects:write"),
  subjectController.deleteChapter.bind(subjectController)
);

// --- Concept Routes ---
router.post(
  "/chapters/:chapterId/concepts",
  checkPermission("subjects:write"),
  subjectController.createConcept.bind(subjectController)
);

router.put(
  "/concepts/:id",
  checkPermission("subjects:write"),
  subjectController.updateConcept.bind(subjectController)
);

router.delete(
  "/concepts/:id",
  checkPermission("subjects:write"),
  subjectController.deleteConcept.bind(subjectController)
);

module.exports = router;
