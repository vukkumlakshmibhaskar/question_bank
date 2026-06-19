const express = require("express");
const router = express.Router();
const googleDriveController = require("../controllers/googleDrive.controller");
const authenticate = require("../middleware/auth.middleware");
const checkPermission = require("../middleware/rbac.middleware");

// Public callback handler that Google redirects to
router.get("/callback", googleDriveController.callback.bind(googleDriveController));

// Protected routes (requires user authentication & uploads:write or appropriate permission)
router.use(authenticate);

router.get(
  "/auth-url",
  checkPermission("uploads:write"),
  googleDriveController.getAuthUrl.bind(googleDriveController)
);

router.get(
  "/files",
  checkPermission("uploads:write"),
  googleDriveController.listFiles.bind(googleDriveController)
);

router.post(
  "/import",
  checkPermission("uploads:write"),
  googleDriveController.importFile.bind(googleDriveController)
);

module.exports = router;
