const jwt = require("jsonwebtoken");
const { recordTelescopeError } = require("./telescope.middleware");

const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || "default_access_secret_123!@#";

const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    const error = new Error("Access token required. Format: Bearer <token>");
    error.statusCode = 401;
    error.name = "AuthenticationError";
    recordTelescopeError(error, req, 401, {
      sourceLayer: "AUTH",
      confidence: "HIGH",
      classificationReason: "Request missed a Bearer access token.",
    });
    return res.status(401).json({ error: "Access token required. Format: Bearer <token>" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, JWT_ACCESS_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      recordTelescopeError(error, req, 401, {
        sourceLayer: "AUTH",
        confidence: "HIGH",
        classificationReason: "JWT access token has expired.",
      });
      return res.status(401).json({ error: "Access token has expired." });
    }
    recordTelescopeError(error, req, 401, {
      sourceLayer: "AUTH",
      confidence: "HIGH",
      classificationReason: "JWT access token verification failed.",
    });
    return res.status(401).json({ error: "Invalid access token." });
  }
};

module.exports = authenticate;
