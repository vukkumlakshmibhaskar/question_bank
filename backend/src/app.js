require("dotenv").config();
const dns = require("node:dns");
dns.setDefaultResultOrder("ipv4first");

const express = require("express");
const cors = require("cors");
const path = require("path");
const authRoutes = require("./routes/auth.routes");
const userRoutes = require("./routes/user.routes");
const subjectRoutes = require("./routes/subject.routes");
const uploadRoutes = require("./routes/upload.routes");
const googleDriveRoutes = require("./routes/googleDrive.routes");
const questionRoutes = require("./routes/question.routes");
const questionBankRoutes = require("./routes/questionBank.routes");
const multiQuestionRoutes = require("./routes/multiQuestion.routes");
const reviewRoutes = require("./routes/review.routes");
const auditRoutes = require("./routes/audit.routes");
const testPaperRoutes = require("./routes/testPaper.routes");
const assessmentTemplateRoutes = require("./routes/assessmentTemplate.routes");
const dashboardRoutes = require("./routes/dashboard.routes");
const evaluatorRoutes = require("./routes/evaluator.routes");
const extractionRoutes = require("./routes/extraction.routes");
const telescopeRoutes = require("./routes/telescope.routes");
const swaggerRoutes = require("./routes/swagger.routes");
const errorHandler = require("./middleware/error.middleware");
const { telescopeRequestLogger } = require("./middleware/telescope.middleware");

const app = express();

// Middlewares
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// Serve uploads statically
app.use("/uploads", express.static(path.join(__dirname, "../public/uploads")));
if (process.env.SWAGGER_ENABLED !== "false") {
  app.use("/", swaggerRoutes);
}
app.use(telescopeRequestLogger);

// Routes
app.get("/", (req, res) => {
  res.send("Question Bank API Running");
});

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/subjects", subjectRoutes);
app.use("/api/uploads/drive", googleDriveRoutes);
app.use("/api/uploads", uploadRoutes);
app.use("/api/questions", questionRoutes);
app.use("/api/question-banks", questionBankRoutes);
app.use("/api/multi-questions", multiQuestionRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/audit-logs", auditRoutes);
app.use("/api/test-papers", testPaperRoutes);
app.use("/api/assessment-templates", assessmentTemplateRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/evaluators", evaluatorRoutes);
app.use("/api/extraction", extractionRoutes);
app.use("/api/lb-workflow", extractionRoutes);
app.use("/api/telescope", telescopeRoutes);

// Global Error Handler
app.use(errorHandler);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
