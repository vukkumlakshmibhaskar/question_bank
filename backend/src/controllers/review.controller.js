const reviewService = require("../services/review.service");
const extractionReviewImportService = require("../services/extractionReviewImport.service");
const sectionReviewWorkbookService = require("../services/sectionReviewWorkbook.service");

class ReviewController {
  async getReviewsList(req, res, next) {
    try {
      const reviews = await reviewService.getReviewsList(req.query, req.user);
      return res.status(200).json(reviews);
    } catch (error) {
      next(error);
    }
  }

  async getReviewById(req, res, next) {
    try {
      const { id } = req.params;
      const review = await reviewService.getReviewById(id, req.user);
      return res.status(200).json(review);
    } catch (error) {
      next(error);
    }
  }

  async importExtractionReview(req, res, next) {
    try {
      const result = await extractionReviewImportService.importRows(req.body, req.user);
      return res.status(result.updated ? 200 : 201).json(result);
    } catch (error) {
      next(error);
    }
  }

  async updateReview(req, res, next) {
    try {
      const { id } = req.params;
      const { extractedData } = req.body;
      const review = await reviewService.updateReview(id, extractedData, req.user);
      return res.status(200).json({ message: "Review updated successfully", review });
    } catch (error) {
      next(error);
    }
  }

  async getSectionMap(req, res, next) {
    try {
      const { id } = req.params;
      const result = await reviewService.getSectionMap(id, req.user);
      return res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  async normalizeSections(req, res, next) {
    try {
      const { id } = req.params;
      const result = await reviewService.normalizeSections(id, req.user);
      return res.status(200).json({
        message: "Review sections normalized successfully",
        ...result,
      });
    } catch (error) {
      next(error);
    }
  }

  async exportSectionWorkbook(req, res, next) {
    try {
      const { id } = req.params;
      const review = await reviewService.getReviewById(id, req.user);
      const buffer = sectionReviewWorkbookService.buildReviewWorkbookBuffer(review);
      const fileName = `extraction-review-${id}-section-workbook.xlsx`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      return res.status(200).send(buffer);
    } catch (error) {
      next(error);
    }
  }

  async approveReview(req, res, next) {
    try {
      const { id } = req.params;
      const { extractedData } = req.body || {};
      const review = await reviewService.approveReview(id, req.user, extractedData);
      return res.status(200).json({ message: "Review approved and data successfully imported", review });
    } catch (error) {
      next(error);
    }
  }

  async rejectReview(req, res, next) {
    try {
      const { id } = req.params;
      const review = await reviewService.rejectReview(id, req.user);
      return res.status(200).json({ message: "Review rejected successfully", review });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new ReviewController();
