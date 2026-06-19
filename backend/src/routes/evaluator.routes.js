const express = require("express");
const router = express.Router();
const evaluatorController = require("../controllers/evaluator.controller");
const authenticate = require("../middleware/auth.middleware");
const upload = require("../middleware/upload.middleware");

const requireAdmin = (req, res, next) => {
  if (req.user?.role !== "ADMIN") {
    return res.status(403).json({ error: "Evaluator Bulk Upload is available to admins only." });
  }
  next();
};

router.use(authenticate, requireAdmin);

router.get("/", evaluatorController.list.bind(evaluatorController));
router.get("/template", evaluatorController.downloadTemplate.bind(evaluatorController));
router.post(
  "/bulk-upload",
  upload.fields([
    { name: "excel", maxCount: 1 },
    { name: "documents", maxCount: 30 },
  ]),
  evaluatorController.bulkUpload.bind(evaluatorController)
);
router.get("/:id/documents", evaluatorController.getDocuments.bind(evaluatorController));
router.get("/documents/:documentId/download", evaluatorController.downloadDocument.bind(evaluatorController));

module.exports = router;
