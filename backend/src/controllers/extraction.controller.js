const extractionProxyService = require("../services/extractionProxy.service");

class ExtractionController {
  async getStatus(req, res, next) {
    try {
      const status = await extractionProxyService.getStatus();
      return res.status(200).json(status);
    } catch (error) {
      next(error);
    }
  }

  getTargets(req, res) {
    const targets = extractionProxyService.getTargets();
    return res.status(200).json({
      services: Object.keys(targets).map((service) => ({
        service,
        target: targets[service],
      })),
    });
  }

  async proxy(req, res, next) {
    try {
      const [proxyPath = "", rawQuery = ""] = req.url.split("?");
      await extractionProxyService.proxy({
        req,
        res,
        service: req.params.service,
        proxyPath,
        rawQuery,
      });
    } catch (error) {
      if (error.name === "TimeoutError") {
        error.statusCode = 504;
        error.message = "Extraction backend timed out.";
      } else if (error.cause?.code === "ECONNREFUSED" || error.code === "ECONNREFUSED") {
        error.statusCode = 502;
        error.message = "Extraction backend is not reachable.";
      }
      next(error);
    }
  }
}

module.exports = new ExtractionController();
