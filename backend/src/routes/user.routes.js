const express = require("express");
const router = express.Router();
const userManagementController = require("../controllers/userManagement.controller");
const authenticate = require("../middleware/auth.middleware");
const checkPermission = require("../middleware/rbac.middleware");

// Require JWT authentication for all user management operations
router.use(authenticate);

// Get all active user authors for question filtering
router.get(
  "/authors",
  userManagementController.getAuthors.bind(userManagementController)
);

// 1. Get all users
router.get(
  "/",
  checkPermission("USER_VIEW"),
  userManagementController.getAll.bind(userManagementController)
);

// 2. Get user by ID
router.get(
  "/:id",
  checkPermission("USER_VIEW"),
  userManagementController.getById.bind(userManagementController)
);

// 3. Create user
router.post(
  "/",
  checkPermission("USER_CREATE"),
  userManagementController.create.bind(userManagementController)
);

// 4. Update profile info
router.put(
  "/:id",
  checkPermission("USER_UPDATE"),
  userManagementController.update.bind(userManagementController)
);

// 5. Disable user account
router.patch(
  "/:id/disable",
  checkPermission("USER_UPDATE"),
  userManagementController.disable.bind(userManagementController)
);

// 6. Activate user account
router.patch(
  "/:id/activate",
  checkPermission("USER_UPDATE"),
  userManagementController.activate.bind(userManagementController)
);

// 7. Assign new role to user
router.post(
  "/:id/roles",
  checkPermission("USER_UPDATE"),
  userManagementController.assignRole.bind(userManagementController)
);

// 8. Remove a role from user
router.delete(
  "/:id/roles/:roleName",
  checkPermission("USER_UPDATE"),
  userManagementController.removeRole.bind(userManagementController)
);

// 9. Soft delete user account
router.delete(
  "/:id",
  checkPermission("USER_DELETE"),
  userManagementController.delete.bind(userManagementController)
);

module.exports = router;
