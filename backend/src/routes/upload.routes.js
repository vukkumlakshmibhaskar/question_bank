const express = require("express");
const router = express.Router();
const uploadController = require("../controllers/upload.controller");
const upload = require("../middleware/upload.middleware");
const authenticate = require("../middleware/auth.middleware");
const checkPermission = require("../middleware/rbac.middleware");

router.use(authenticate);

router.post(
  "/",
  checkPermission("uploads:write"),
  upload.single("file"),
  uploadController.uploadFile.bind(uploadController)
);

router.post(
  "/media",
  checkPermission("uploads:write"),
  upload.single("file"),
  uploadController.uploadMedia.bind(uploadController)
);

router.post(
  "/import-pdf",
  checkPermission("uploads:write"),
  upload.single("file"),
  uploadController.importPdf.bind(uploadController)
);

router.get(
  "/jobs",
  checkPermission("uploads:write"),
  uploadController.getJobs.bind(uploadController)
);

router.get(
  "/jobs/:jobId",
  checkPermission("uploads:write"),
  uploadController.getJobStatus.bind(uploadController)
);

router.get(
  "/",
  checkPermission("uploads:write"),
  uploadController.getFiles.bind(uploadController)
);

router.get(
  "/:fileId/processed/download",
  checkPermission("uploads:write"),
  uploadController.downloadProcessedFile.bind(uploadController)
);

module.exports = router;
