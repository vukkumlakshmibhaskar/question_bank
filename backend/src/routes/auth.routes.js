const express = require("express");
const router = express.Router();
const authController = require("../controllers/auth.controller");
const authenticate = require("../middleware/auth.middleware");
const { validateRegister, validateLogin } = require("../validators/auth.validator");

// Public routes
router.post("/register", validateRegister, authController.register.bind(authController));
router.post("/login", validateLogin, authController.login.bind(authController));
router.post("/refresh", authController.refresh.bind(authController));

// Protected routes
router.post("/logout", authenticate, authController.logout.bind(authController));

module.exports = router;
