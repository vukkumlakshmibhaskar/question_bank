const express = require("express");
const swaggerUi = require("swagger-ui-express");
const openApiSpec = require("../docs/openapi");

const router = express.Router();

const swaggerOptions = {
  explorer: true,
  swaggerOptions: {
    persistAuthorization: true,
    displayRequestDuration: true,
    docExpansion: "none",
    filter: true,
    tryItOutEnabled: true,
  },
  customSiteTitle: "QBank Platform API Docs",
};

router.get("/api-docs.json", (req, res) => {
  res.json(openApiSpec);
});

router.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openApiSpec, swaggerOptions));

module.exports = router;
