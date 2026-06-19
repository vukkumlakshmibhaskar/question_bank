const express = require("express");
const router = express.Router();
const dashboardController = require("../controllers/dashboard.controller");
const authenticate = require("../middleware/auth.middleware");

router.use(authenticate);

router.get("/", dashboardController.getDashboard.bind(dashboardController));

module.exports = router;
