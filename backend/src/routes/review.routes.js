const express = require("express");
const router = express.Router();
const reviewController = require("../controllers/review.controller");
const authenticate = require("../middleware/auth.middleware");
const checkPermission = require("../middleware/rbac.middleware");

router.use(authenticate);

router.get(
  "/",
  checkPermission("questions:read"),
  reviewController.getReviewsList.bind(reviewController)
);

router.post(
  "/extraction/import",
  checkPermission("questions:write"),
  reviewController.importExtractionReview.bind(reviewController)
);

router.post(
  "/lb-workflow/import",
  checkPermission("questions:write"),
  reviewController.importExtractionReview.bind(reviewController)
);

router.get(
  "/:id/section-map",
  checkPermission("questions:read"),
  reviewController.getSectionMap.bind(reviewController)
);

router.post(
  "/:id/normalize-sections",
  checkPermission("questions:write"),
  reviewController.normalizeSections.bind(reviewController)
);

router.get(
  "/:id/section-workbook",
  checkPermission("questions:read"),
  reviewController.exportSectionWorkbook.bind(reviewController)
);

router.get(
  "/:id",
  checkPermission("questions:read"),
  reviewController.getReviewById.bind(reviewController)
);

router.put(
  "/:id",
  checkPermission("questions:write"),
  reviewController.updateReview.bind(reviewController)
);

router.post(
  "/:id/approve",
  checkPermission("questions:approve"),
  reviewController.approveReview.bind(reviewController)
);

router.post(
  "/:id/reject",
  checkPermission("questions:approve"),
  reviewController.rejectReview.bind(reviewController)
);

module.exports = router;
