const apiSnapshotService = require("../services/apiSnapshot.service");

class ApiSnapshotController {
  async getQuestionBankSnapshot(req, res, next) {
    try {
      const snapshot = await apiSnapshotService.getQuestionBankSnapshot(req.user);
      return res.status(200).json(snapshot);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new ApiSnapshotController();
