const express = require("express");
const extractionController = require("../controllers/extraction.controller");
const authenticate = require("../middleware/auth.middleware");

const router = express.Router();

const attachAccessTokenFromQuery = (req, res, next) => {
  const token = Array.isArray(req.query.access_token)
    ? req.query.access_token[0]
    : req.query.access_token;

  if (token && !req.headers.authorization) {
    req.headers.authorization = `Bearer ${token}`;
  }

  next();
};

router.get("/targets", authenticate, extractionController.getTargets.bind(extractionController));
router.get("/status", authenticate, extractionController.getStatus.bind(extractionController));

router.use(
  "/:service",
  attachAccessTokenFromQuery,
  authenticate,
  extractionController.proxy.bind(extractionController)
);

module.exports = router;
