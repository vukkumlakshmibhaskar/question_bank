const packageJson = require("../../package.json");

const bearerSecurity = [{ bearerAuth: [] }];

const jsonBody = (description, schema = { type: "object", additionalProperties: true }) => ({
  required: true,
  content: {
    "application/json": {
      schema,
    },
  },
  description,
});

const multipartBody = (description, properties, required = []) => ({
  required: true,
  content: {
    "multipart/form-data": {
      schema: {
        type: "object",
        required,
        properties,
      },
    },
  },
  description,
});

const ok = (description = "Successful response") => ({
  description,
  content: {
    "application/json": {
      schema: {
        type: "object",
        additionalProperties: true,
      },
    },
  },
});

const fileResponse = (description = "File download") => ({
  description,
  content: {
    "application/octet-stream": {
      schema: {
        type: "string",
        format: "binary",
      },
    },
  },
});

const idParam = (name = "id", description = "Record ID") => ({
  name,
  in: "path",
  required: true,
  schema: {
    type: "integer",
  },
  description,
});

const stringPathParam = (name, description) => ({
  name,
  in: "path",
  required: true,
  schema: {
    type: "string",
  },
  description,
});

const paginationParams = [
  {
    name: "page",
    in: "query",
    schema: { type: "integer", minimum: 1 },
    description: "Page number",
  },
  {
    name: "limit",
    in: "query",
    schema: { type: "integer", minimum: 1 },
    description: "Rows per page",
  },
  {
    name: "search",
    in: "query",
    schema: { type: "string" },
    description: "Search term",
  },
];

const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "QBank Platform API",
    version: packageJson.version || "1.0.0",
    description:
      "Interactive Swagger documentation for the QBank Platform Express API. Protected APIs require a Bearer token from the login response.",
  },
  servers: [
    {
      url: "/",
      description: "Current host",
    },
  ],
  tags: [
    { name: "Health", description: "Basic service health" },
    { name: "Auth", description: "Authentication and session endpoints" },
    { name: "Users", description: "User and role management" },
    { name: "Subjects", description: "Subject, chapter, and concept hierarchy" },
    { name: "Uploads", description: "File upload, PDF import, and job tracking" },
    { name: "Google Drive", description: "Google Drive import flow" },
    { name: "Questions", description: "Question repository management" },
    { name: "Question Banks", description: "Question bank and linking APIs" },
    { name: "Multi Questions", description: "Multi-question review and header management" },
    { name: "Extraction Reviews", description: "Extraction moderation and section workflow" },
    { name: "Audit Logs", description: "Audit log inspection" },
    { name: "Test Papers", description: "Assessment and generated set workflow" },
    { name: "Assessment Templates", description: "Reusable assessment templates" },
    { name: "Dashboard", description: "Dashboard summary" },
    { name: "Evaluators", description: "Evaluator bulk upload" },
    { name: "Extraction", description: "Extraction service status and proxy" },
    { name: "Telescope", description: "Application observability APIs" },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
      },
    },
    schemas: {
      ErrorResponse: {
        type: "object",
        properties: {
          error: { type: "string" },
          message: { type: "string" },
        },
      },
      LoginRequest: {
        type: "object",
        required: ["email", "password"],
        properties: {
          email: { type: "string", format: "email", example: "admin@example.com" },
          password: { type: "string", format: "password", example: "password" },
        },
      },
      RegisterRequest: {
        type: "object",
        required: ["name", "email", "password"],
        properties: {
          name: { type: "string", example: "Admin User" },
          email: { type: "string", format: "email", example: "admin@example.com" },
          password: { type: "string", format: "password", example: "password" },
          role: { type: "string", example: "ADMIN" },
        },
      },
      GenericJson: {
        type: "object",
        additionalProperties: true,
      },
    },
    responses: {
      Unauthorized: {
        description: "Authentication is required or the token is invalid.",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
          },
        },
      },
      Forbidden: {
        description: "The authenticated user does not have permission.",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
          },
        },
      },
      NotFound: {
        description: "Record was not found.",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
          },
        },
      },
    },
  },
  paths: {
    "/": {
      get: {
        tags: ["Health"],
        summary: "API health message",
        responses: {
          200: {
            description: "API is running",
            content: {
              "text/plain": {
                schema: { type: "string", example: "Question Bank API Running" },
              },
            },
          },
        },
      },
    },
    "/api/auth/register": {
      post: {
        tags: ["Auth"],
        summary: "Register a new user",
        requestBody: jsonBody("Registration payload", { $ref: "#/components/schemas/RegisterRequest" }),
        responses: { 201: ok("User registered"), 400: { $ref: "#/components/responses/Forbidden" } },
      },
    },
    "/api/auth/login": {
      post: {
        tags: ["Auth"],
        summary: "Login and receive access tokens",
        requestBody: jsonBody("Login credentials", { $ref: "#/components/schemas/LoginRequest" }),
        responses: { 200: ok("Login successful"), 401: { $ref: "#/components/responses/Unauthorized" } },
      },
    },
    "/api/auth/refresh": {
      post: {
        tags: ["Auth"],
        summary: "Refresh an access token",
        requestBody: jsonBody("Refresh token payload"),
        responses: { 200: ok("Token refreshed"), 401: { $ref: "#/components/responses/Unauthorized" } },
      },
    },
    "/api/auth/logout": {
      post: {
        tags: ["Auth"],
        summary: "Logout current user",
        security: bearerSecurity,
        responses: { 200: ok("Logged out"), 401: { $ref: "#/components/responses/Unauthorized" } },
      },
    },
    "/api/users/authors": {
      get: {
        tags: ["Users"],
        summary: "List active author users for filters",
        security: bearerSecurity,
        responses: { 200: ok(), 401: { $ref: "#/components/responses/Unauthorized" } },
      },
    },
    "/api/users": {
      get: {
        tags: ["Users"],
        summary: "List users",
        security: bearerSecurity,
        parameters: paginationParams,
        responses: { 200: ok(), 403: { $ref: "#/components/responses/Forbidden" } },
      },
      post: {
        tags: ["Users"],
        summary: "Create user",
        security: bearerSecurity,
        requestBody: jsonBody("User payload"),
        responses: { 201: ok("User created"), 403: { $ref: "#/components/responses/Forbidden" } },
      },
    },
    "/api/users/{id}": {
      get: {
        tags: ["Users"],
        summary: "Get user by ID",
        security: bearerSecurity,
        parameters: [idParam()],
        responses: { 200: ok(), 404: { $ref: "#/components/responses/NotFound" } },
      },
      put: {
        tags: ["Users"],
        summary: "Update user",
        security: bearerSecurity,
        parameters: [idParam()],
        requestBody: jsonBody("User update payload"),
        responses: { 200: ok(), 404: { $ref: "#/components/responses/NotFound" } },
      },
      delete: {
        tags: ["Users"],
        summary: "Soft delete user",
        security: bearerSecurity,
        parameters: [idParam()],
        responses: { 200: ok(), 404: { $ref: "#/components/responses/NotFound" } },
      },
    },
    "/api/users/{id}/disable": {
      patch: {
        tags: ["Users"],
        summary: "Disable user account",
        security: bearerSecurity,
        parameters: [idParam()],
        responses: { 200: ok() },
      },
    },
    "/api/users/{id}/activate": {
      patch: {
        tags: ["Users"],
        summary: "Activate user account",
        security: bearerSecurity,
        parameters: [idParam()],
        responses: { 200: ok() },
      },
    },
    "/api/users/{id}/roles": {
      post: {
        tags: ["Users"],
        summary: "Assign role to user",
        security: bearerSecurity,
        parameters: [idParam()],
        requestBody: jsonBody("Role assignment payload"),
        responses: { 200: ok() },
      },
    },
    "/api/users/{id}/roles/{roleName}": {
      delete: {
        tags: ["Users"],
        summary: "Remove role from user",
        security: bearerSecurity,
        parameters: [idParam(), stringPathParam("roleName", "Role name")],
        responses: { 200: ok() },
      },
    },
    "/api/subjects": {
      get: {
        tags: ["Subjects"],
        summary: "Get subject hierarchy",
        security: bearerSecurity,
        responses: { 200: ok() },
      },
      post: {
        tags: ["Subjects"],
        summary: "Create subject",
        security: bearerSecurity,
        requestBody: jsonBody("Subject payload"),
        responses: { 201: ok() },
      },
    },
    "/api/subjects/{id}": {
      put: {
        tags: ["Subjects"],
        summary: "Update subject",
        security: bearerSecurity,
        parameters: [idParam()],
        requestBody: jsonBody("Subject update payload"),
        responses: { 200: ok() },
      },
      delete: {
        tags: ["Subjects"],
        summary: "Delete subject",
        security: bearerSecurity,
        parameters: [idParam()],
        responses: { 200: ok() },
      },
    },
    "/api/subjects/{subjectId}/chapters": {
      post: {
        tags: ["Subjects"],
        summary: "Create chapter under a subject",
        security: bearerSecurity,
        parameters: [idParam("subjectId", "Subject ID")],
        requestBody: jsonBody("Chapter payload"),
        responses: { 201: ok() },
      },
    },
    "/api/subjects/chapters/{id}": {
      put: {
        tags: ["Subjects"],
        summary: "Update chapter",
        security: bearerSecurity,
        parameters: [idParam()],
        requestBody: jsonBody("Chapter update payload"),
        responses: { 200: ok() },
      },
      delete: {
        tags: ["Subjects"],
        summary: "Delete chapter",
        security: bearerSecurity,
        parameters: [idParam()],
        responses: { 200: ok() },
      },
    },
    "/api/subjects/chapters/{chapterId}/concepts": {
      post: {
        tags: ["Subjects"],
        summary: "Create concept under a chapter",
        security: bearerSecurity,
        parameters: [idParam("chapterId", "Chapter ID")],
        requestBody: jsonBody("Concept payload"),
        responses: { 201: ok() },
      },
    },
    "/api/subjects/concepts/{id}": {
      put: {
        tags: ["Subjects"],
        summary: "Update concept",
        security: bearerSecurity,
        parameters: [idParam()],
        requestBody: jsonBody("Concept update payload"),
        responses: { 200: ok() },
      },
      delete: {
        tags: ["Subjects"],
        summary: "Delete concept",
        security: bearerSecurity,
        parameters: [idParam()],
        responses: { 200: ok() },
      },
    },
    "/api/uploads": {
      get: {
        tags: ["Uploads"],
        summary: "List uploaded files",
        security: bearerSecurity,
        responses: { 200: ok() },
      },
      post: {
        tags: ["Uploads"],
        summary: "Upload a file",
        security: bearerSecurity,
        requestBody: multipartBody("Upload file", { file: { type: "string", format: "binary" } }, ["file"]),
        responses: { 201: ok() },
      },
    },
    "/api/uploads/media": {
      post: {
        tags: ["Uploads"],
        summary: "Upload media for questions or options",
        security: bearerSecurity,
        requestBody: multipartBody("Upload media file", { file: { type: "string", format: "binary" } }, ["file"]),
        responses: { 201: ok() },
      },
    },
    "/api/uploads/import-pdf": {
      post: {
        tags: ["Uploads"],
        summary: "Import a PDF for extraction",
        security: bearerSecurity,
        requestBody: multipartBody("PDF import payload", { file: { type: "string", format: "binary" } }, ["file"]),
        responses: { 202: ok("Import job created") },
      },
    },
    "/api/uploads/jobs": {
      get: {
        tags: ["Uploads"],
        summary: "List upload processing jobs",
        security: bearerSecurity,
        responses: { 200: ok() },
      },
    },
    "/api/uploads/jobs/{jobId}": {
      get: {
        tags: ["Uploads"],
        summary: "Get upload job status",
        security: bearerSecurity,
        parameters: [stringPathParam("jobId", "Processing job ID")],
        responses: { 200: ok() },
      },
    },
    "/api/uploads/{fileId}/processed/download": {
      get: {
        tags: ["Uploads"],
        summary: "Download processed file",
        security: bearerSecurity,
        parameters: [stringPathParam("fileId", "Uploaded file ID")],
        responses: { 200: fileResponse() },
      },
    },
    "/api/uploads/drive/callback": {
      get: {
        tags: ["Google Drive"],
        summary: "Google Drive OAuth callback",
        parameters: [
          { name: "code", in: "query", schema: { type: "string" } },
          { name: "state", in: "query", schema: { type: "string" } },
        ],
        responses: { 200: ok("OAuth callback handled") },
      },
    },
    "/api/uploads/drive/auth-url": {
      get: {
        tags: ["Google Drive"],
        summary: "Get Google Drive OAuth URL",
        security: bearerSecurity,
        responses: { 200: ok() },
      },
    },
    "/api/uploads/drive/files": {
      get: {
        tags: ["Google Drive"],
        summary: "List Google Drive files",
        security: bearerSecurity,
        responses: { 200: ok() },
      },
    },
    "/api/uploads/drive/import": {
      post: {
        tags: ["Google Drive"],
        summary: "Import a Google Drive file",
        security: bearerSecurity,
        requestBody: jsonBody("Drive import payload"),
        responses: { 202: ok("Drive import started") },
      },
    },
    "/api/questions": {
      get: {
        tags: ["Questions"],
        summary: "List questions",
        security: bearerSecurity,
        parameters: paginationParams,
        responses: { 200: ok() },
      },
      post: {
        tags: ["Questions"],
        summary: "Create question",
        security: bearerSecurity,
        requestBody: jsonBody("Question payload"),
        responses: { 201: ok() },
      },
    },
    "/api/questions/bulk-delete": {
      post: {
        tags: ["Questions"],
        summary: "Bulk delete questions",
        security: bearerSecurity,
        requestBody: jsonBody("Question IDs payload"),
        responses: { 200: ok() },
      },
    },
    "/api/questions/{id}": {
      get: {
        tags: ["Questions"],
        summary: "Get question by ID",
        security: bearerSecurity,
        parameters: [idParam()],
        responses: { 200: ok(), 404: { $ref: "#/components/responses/NotFound" } },
      },
      put: {
        tags: ["Questions"],
        summary: "Update question",
        security: bearerSecurity,
        parameters: [idParam()],
        requestBody: jsonBody("Question update payload"),
        responses: { 200: ok() },
      },
      delete: {
        tags: ["Questions"],
        summary: "Delete question",
        security: bearerSecurity,
        parameters: [idParam()],
        responses: { 200: ok() },
      },
    },
    "/api/question-banks": {
      get: {
        tags: ["Question Banks"],
        summary: "List question banks",
        security: bearerSecurity,
        parameters: paginationParams,
        responses: { 200: ok() },
      },
      post: {
        tags: ["Question Banks"],
        summary: "Create question bank",
        security: bearerSecurity,
        requestBody: jsonBody("Question bank payload"),
        responses: { 201: ok() },
      },
    },
    "/api/question-banks/template/latest/info": {
      get: {
        tags: ["Question Banks"],
        summary: "Get latest Excel template info",
        security: bearerSecurity,
        responses: { 200: ok() },
      },
    },
    "/api/question-banks/template/latest/download": {
      get: {
        tags: ["Question Banks"],
        summary: "Download latest Excel template",
        security: bearerSecurity,
        responses: { 200: fileResponse("Excel template download") },
      },
    },
    "/api/question-banks/import/excel/preview": {
      post: {
        tags: ["Question Banks"],
        summary: "Preview Excel question import",
        security: bearerSecurity,
        requestBody: multipartBody("Excel workbook", { file: { type: "string", format: "binary" } }, ["file"]),
        responses: { 200: ok() },
      },
    },
    "/api/question-banks/import/excel/commit": {
      post: {
        tags: ["Question Banks"],
        summary: "Commit Excel question import",
        security: bearerSecurity,
        requestBody: jsonBody("Validated import payload"),
        responses: { 200: ok() },
      },
    },
    "/api/question-banks/api-snapshot": {
      get: {
        tags: ["Question Banks"],
        summary: "Get question bank API snapshot",
        security: bearerSecurity,
        responses: { 200: ok() },
      },
    },
    "/api/question-banks/{id}": {
      get: {
        tags: ["Question Banks"],
        summary: "Get question bank by ID",
        security: bearerSecurity,
        parameters: [idParam()],
        responses: { 200: ok() },
      },
      put: {
        tags: ["Question Banks"],
        summary: "Update question bank",
        security: bearerSecurity,
        parameters: [idParam()],
        requestBody: jsonBody("Question bank update payload"),
        responses: { 200: ok() },
      },
      delete: {
        tags: ["Question Banks"],
        summary: "Delete question bank",
        security: bearerSecurity,
        parameters: [idParam()],
        responses: { 200: ok() },
      },
    },
    "/api/question-banks/{bankId}/questions": {
      post: {
        tags: ["Question Banks"],
        summary: "Link a question to a bank",
        security: bearerSecurity,
        parameters: [idParam("bankId", "Question bank ID")],
        requestBody: jsonBody("Question link payload"),
        responses: { 200: ok() },
      },
    },
    "/api/question-banks/{bankId}/questions/{questionId}": {
      delete: {
        tags: ["Question Banks"],
        summary: "Unlink a question from a bank",
        security: bearerSecurity,
        parameters: [idParam("bankId", "Question bank ID"), idParam("questionId", "Question ID")],
        responses: { 200: ok() },
      },
    },
    "/api/question-banks/{bankId}/questions/bulk-unlink": {
      post: {
        tags: ["Question Banks"],
        summary: "Bulk unlink questions from a bank",
        security: bearerSecurity,
        parameters: [idParam("bankId", "Question bank ID")],
        requestBody: jsonBody("Question IDs payload"),
        responses: { 200: ok() },
      },
    },
    "/api/multi-questions/settings": {
      get: {
        tags: ["Multi Questions"],
        summary: "Get multi-question settings",
        security: bearerSecurity,
        responses: { 200: ok() },
      },
    },
    "/api/multi-questions": {
      get: {
        tags: ["Multi Questions"],
        summary: "List multi questions",
        security: bearerSecurity,
        parameters: paginationParams,
        responses: { 200: ok() },
      },
    },
    "/api/multi-questions/{id}/header": {
      patch: {
        tags: ["Multi Questions"],
        summary: "Update multi-question header",
        security: bearerSecurity,
        parameters: [idParam()],
        requestBody: jsonBody("Header update payload"),
        responses: { 200: ok() },
      },
    },
    "/api/reviews": {
      get: {
        tags: ["Extraction Reviews"],
        summary: "List extraction reviews",
        security: bearerSecurity,
        parameters: paginationParams,
        responses: { 200: ok() },
      },
    },
    "/api/reviews/extraction/import": {
      post: {
        tags: ["Extraction Reviews"],
        summary: "Import extraction data into review",
        security: bearerSecurity,
        requestBody: jsonBody("Extraction import payload"),
        responses: { 201: ok() },
      },
    },
    "/api/reviews/lb-workflow/import": {
      post: {
        tags: ["Extraction Reviews"],
        summary: "Legacy extraction workflow import alias",
        security: bearerSecurity,
        requestBody: jsonBody("Extraction import payload"),
        responses: { 201: ok() },
      },
    },
    "/api/reviews/{id}": {
      get: {
        tags: ["Extraction Reviews"],
        summary: "Get extraction review by ID",
        security: bearerSecurity,
        parameters: [idParam()],
        responses: { 200: ok() },
      },
      put: {
        tags: ["Extraction Reviews"],
        summary: "Update extraction review draft",
        security: bearerSecurity,
        parameters: [idParam()],
        requestBody: jsonBody("Review update payload"),
        responses: { 200: ok() },
      },
    },
    "/api/reviews/{id}/section-map": {
      get: {
        tags: ["Extraction Reviews"],
        summary: "Get detected section map",
        security: bearerSecurity,
        parameters: [idParam()],
        responses: { 200: ok() },
      },
    },
    "/api/reviews/{id}/normalize-sections": {
      post: {
        tags: ["Extraction Reviews"],
        summary: "Normalize extracted section metadata",
        security: bearerSecurity,
        parameters: [idParam()],
        responses: { 200: ok() },
      },
    },
    "/api/reviews/{id}/section-workbook": {
      get: {
        tags: ["Extraction Reviews"],
        summary: "Export section-aware review workbook",
        security: bearerSecurity,
        parameters: [idParam()],
        responses: { 200: fileResponse("Section workbook download") },
      },
    },
    "/api/reviews/{id}/approve": {
      post: {
        tags: ["Extraction Reviews"],
        summary: "Approve review and import questions",
        security: bearerSecurity,
        parameters: [idParam()],
        responses: { 200: ok() },
      },
    },
    "/api/reviews/{id}/reject": {
      post: {
        tags: ["Extraction Reviews"],
        summary: "Reject extraction review",
        security: bearerSecurity,
        parameters: [idParam()],
        responses: { 200: ok() },
      },
    },
    "/api/audit-logs": {
      get: {
        tags: ["Audit Logs"],
        summary: "List audit logs",
        security: bearerSecurity,
        parameters: paginationParams,
        responses: { 200: ok() },
      },
    },
    "/api/test-papers": {
      get: {
        tags: ["Test Papers"],
        summary: "List test papers",
        security: bearerSecurity,
        parameters: paginationParams,
        responses: { 200: ok() },
      },
      post: {
        tags: ["Test Papers"],
        summary: "Create test paper",
        security: bearerSecurity,
        requestBody: jsonBody("Test paper payload"),
        responses: { 201: ok() },
      },
    },
    "/api/test-papers/{id}": {
      get: {
        tags: ["Test Papers"],
        summary: "Get test paper by ID",
        security: bearerSecurity,
        parameters: [idParam()],
        responses: { 200: ok() },
      },
      put: {
        tags: ["Test Papers"],
        summary: "Update test paper",
        security: bearerSecurity,
        parameters: [idParam()],
        requestBody: jsonBody("Test paper update payload"),
        responses: { 200: ok() },
      },
      delete: {
        tags: ["Test Papers"],
        summary: "Delete test paper",
        security: bearerSecurity,
        parameters: [idParam()],
        responses: { 200: ok() },
      },
    },
    "/api/test-papers/{id}/summary": {
      get: {
        tags: ["Test Papers"],
        summary: "Get assessment summary",
        security: bearerSecurity,
        parameters: [idParam()],
        responses: { 200: ok() },
      },
    },
    "/api/test-papers/{id}/marks": {
      get: {
        tags: ["Test Papers"],
        summary: "Get assessment marks summary",
        security: bearerSecurity,
        parameters: [idParam()],
        responses: { 200: ok() },
      },
    },
    "/api/test-papers/{id}/blueprint": {
      get: {
        tags: ["Test Papers"],
        summary: "Get section blueprint",
        security: bearerSecurity,
        parameters: [idParam()],
        responses: { 200: ok() },
      },
      put: {
        tags: ["Test Papers"],
        summary: "Update section blueprint",
        security: bearerSecurity,
        parameters: [idParam()],
        requestBody: jsonBody("Blueprint payload"),
        responses: { 200: ok() },
      },
    },
    "/api/test-papers/{id}/validate-generation": {
      post: {
        tags: ["Test Papers"],
        summary: "Validate section-wise generation readiness",
        security: bearerSecurity,
        parameters: [idParam()],
        requestBody: jsonBody("Generation validation payload"),
        responses: { 200: ok() },
      },
    },
    "/api/test-papers/{id}/apply-section-map": {
      post: {
        tags: ["Test Papers"],
        summary: "Apply blueprint section metadata to selected question pools",
        security: bearerSecurity,
        parameters: [idParam()],
        responses: { 200: ok() },
      },
    },
    "/api/test-papers/{id}/sets/generate": {
      post: {
        tags: ["Test Papers"],
        summary: "Generate question paper sets",
        security: bearerSecurity,
        parameters: [idParam()],
        requestBody: jsonBody("Generation payload"),
        responses: { 200: ok() },
      },
    },
    "/api/test-papers/{id}/sets/{setId}": {
      delete: {
        tags: ["Test Papers"],
        summary: "Delete a generated set",
        security: bearerSecurity,
        parameters: [idParam(), idParam("setId", "Generated set ID")],
        responses: { 200: ok() },
      },
    },
    "/api/test-papers/{id}/status": {
      patch: {
        tags: ["Test Papers"],
        summary: "Update test paper status",
        security: bearerSecurity,
        parameters: [idParam()],
        requestBody: jsonBody("Status update payload"),
        responses: { 200: ok() },
      },
    },
    "/api/assessment-templates": {
      get: {
        tags: ["Assessment Templates"],
        summary: "List assessment templates",
        security: bearerSecurity,
        responses: { 200: ok() },
      },
      post: {
        tags: ["Assessment Templates"],
        summary: "Create assessment template",
        security: bearerSecurity,
        requestBody: jsonBody("Assessment template payload"),
        responses: { 201: ok() },
      },
    },
    "/api/assessment-templates/{id}": {
      get: {
        tags: ["Assessment Templates"],
        summary: "Get assessment template by ID",
        security: bearerSecurity,
        parameters: [idParam()],
        responses: { 200: ok() },
      },
      put: {
        tags: ["Assessment Templates"],
        summary: "Update assessment template",
        security: bearerSecurity,
        parameters: [idParam()],
        requestBody: jsonBody("Assessment template update payload"),
        responses: { 200: ok() },
      },
    },
    "/api/assessment-templates/{id}/archive": {
      patch: {
        tags: ["Assessment Templates"],
        summary: "Archive assessment template",
        security: bearerSecurity,
        parameters: [idParam()],
        responses: { 200: ok() },
      },
    },
    "/api/assessment-templates/{id}/restore": {
      patch: {
        tags: ["Assessment Templates"],
        summary: "Restore assessment template",
        security: bearerSecurity,
        parameters: [idParam()],
        responses: { 200: ok() },
      },
    },
    "/api/dashboard": {
      get: {
        tags: ["Dashboard"],
        summary: "Get dashboard summary",
        security: bearerSecurity,
        responses: { 200: ok() },
      },
    },
    "/api/evaluators": {
      get: {
        tags: ["Evaluators"],
        summary: "List evaluator uploads",
        security: bearerSecurity,
        responses: { 200: ok() },
      },
    },
    "/api/evaluators/template": {
      get: {
        tags: ["Evaluators"],
        summary: "Download evaluator bulk upload template",
        security: bearerSecurity,
        responses: { 200: fileResponse("Evaluator template download") },
      },
    },
    "/api/evaluators/bulk-upload": {
      post: {
        tags: ["Evaluators"],
        summary: "Bulk upload evaluator documents",
        security: bearerSecurity,
        requestBody: multipartBody(
          "Evaluator Excel plus documents",
          {
            excel: { type: "string", format: "binary" },
            documents: {
              type: "array",
              items: { type: "string", format: "binary" },
            },
          },
          ["excel"]
        ),
        responses: { 201: ok() },
      },
    },
    "/api/evaluators/{id}/documents": {
      get: {
        tags: ["Evaluators"],
        summary: "List documents for evaluator upload",
        security: bearerSecurity,
        parameters: [idParam()],
        responses: { 200: ok() },
      },
    },
    "/api/evaluators/documents/{documentId}/download": {
      get: {
        tags: ["Evaluators"],
        summary: "Download evaluator document",
        security: bearerSecurity,
        parameters: [idParam("documentId", "Evaluator document ID")],
        responses: { 200: fileResponse("Evaluator document download") },
      },
    },
    "/api/extraction/targets": {
      get: {
        tags: ["Extraction"],
        summary: "Get extraction service targets",
        security: bearerSecurity,
        responses: { 200: ok() },
      },
    },
    "/api/extraction/status": {
      get: {
        tags: ["Extraction"],
        summary: "Get extraction service status",
        security: bearerSecurity,
        responses: { 200: ok() },
      },
    },
    "/api/extraction/{service}": {
      get: {
        tags: ["Extraction"],
        summary: "Proxy GET request to an extraction service",
        security: bearerSecurity,
        parameters: [stringPathParam("service", "Configured extraction service key")],
        responses: { 200: ok() },
      },
      post: {
        tags: ["Extraction"],
        summary: "Proxy POST request to an extraction service",
        security: bearerSecurity,
        parameters: [stringPathParam("service", "Configured extraction service key")],
        requestBody: jsonBody("Proxy payload"),
        responses: { 200: ok() },
      },
    },
    "/api/lb-workflow/{service}": {
      get: {
        tags: ["Extraction"],
        summary: "Legacy extraction workflow proxy alias",
        security: bearerSecurity,
        parameters: [stringPathParam("service", "Configured extraction service key")],
        responses: { 200: ok() },
      },
    },
    "/api/telescope/frontend-errors": {
      post: {
        tags: ["Telescope"],
        summary: "Record a frontend exception",
        requestBody: jsonBody("Frontend error payload"),
        responses: { 201: ok("Frontend error recorded") },
      },
    },
    "/api/telescope/summary": {
      get: {
        tags: ["Telescope"],
        summary: "Get Telescope summary",
        security: bearerSecurity,
        responses: { 200: ok() },
      },
    },
    "/api/telescope/requests": {
      get: {
        tags: ["Telescope"],
        summary: "List captured API requests",
        security: bearerSecurity,
        parameters: paginationParams,
        responses: { 200: ok() },
      },
    },
    "/api/telescope/requests/{id}": {
      get: {
        tags: ["Telescope"],
        summary: "Get request log detail",
        security: bearerSecurity,
        parameters: [idParam()],
        responses: { 200: ok() },
      },
    },
    "/api/telescope/errors": {
      get: {
        tags: ["Telescope"],
        summary: "List captured backend/frontend errors",
        security: bearerSecurity,
        parameters: paginationParams,
        responses: { 200: ok() },
      },
    },
    "/api/telescope/errors/{id}": {
      get: {
        tags: ["Telescope"],
        summary: "Get error detail",
        security: bearerSecurity,
        parameters: [idParam()],
        responses: { 200: ok() },
      },
    },
    "/api/telescope/jobs": {
      get: {
        tags: ["Telescope"],
        summary: "Get job diagnostics",
        security: bearerSecurity,
        responses: { 200: ok() },
      },
    },
    "/api/telescope/services": {
      get: {
        tags: ["Telescope"],
        summary: "Get service health diagnostics",
        security: bearerSecurity,
        responses: { 200: ok() },
      },
    },
    "/api/telescope/data-health": {
      get: {
        tags: ["Telescope"],
        summary: "Get data health diagnostics",
        security: bearerSecurity,
        responses: { 200: ok() },
      },
    },
    "/api/telescope/audit-logs": {
      get: {
        tags: ["Telescope"],
        summary: "Get audit logs through Telescope",
        security: bearerSecurity,
        responses: { 200: ok() },
      },
    },
    "/api/telescope/extraction/import": {
      post: {
        tags: ["Telescope"],
        summary: "Import extraction review through Telescope",
        security: bearerSecurity,
        requestBody: jsonBody("Extraction import payload"),
        responses: { 201: ok() },
      },
    },
    "/api/telescope/lb/import": {
      post: {
        tags: ["Telescope"],
        summary: "Legacy Telescope extraction import alias",
        security: bearerSecurity,
        requestBody: jsonBody("Extraction import payload"),
        responses: { 201: ok() },
      },
    },
    "/api/telescope/diagnostics/export": {
      get: {
        tags: ["Telescope"],
        summary: "Export Telescope diagnostics",
        security: bearerSecurity,
        responses: { 200: fileResponse("Diagnostics export") },
      },
    },
  },
};

module.exports = openApiSpec;
