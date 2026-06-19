const dashboardService = require("../services/dashboard.service");

class DashboardController {
  async getDashboard(req, res, next) {
    try {
      const dashboard = await dashboardService.getDashboard(req.user);
      return res.status(200).json(dashboard);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new DashboardController();
