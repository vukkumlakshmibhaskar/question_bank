const path = require("path");
const fs = require("fs");
const prisma = require("../config/prisma");
const googleDriveService = require("../services/googleDrive.service");
const processingService = require("../services/processing.service");

class GoogleDriveController {
  async getAuthUrl(req, res, next) {
    try {
      const url = googleDriveService.getAuthUrl();
      return res.status(200).json({ url });
    } catch (error) {
      next(error);
    }
  }

  async callback(req, res, next) {
    try {
      const { code } = req.query;
      if (!code) {
        return res.status(400).json({ error: "Code query parameter is required." });
      }

      const tokens = await googleDriveService.getTokensFromCode(code);

      // Redirect back to frontend dashboard with credentials
      const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
      const redirectUrl = new URL(frontendUrl);
      redirectUrl.pathname = "/dashboard";
      redirectUrl.searchParams.set("google_access_token", tokens.access_token || "");
      redirectUrl.searchParams.set("google_refresh_token", tokens.refresh_token || "");

      return res.redirect(redirectUrl.toString());
    } catch (error) {
      next(error);
    }
  }

  async listFiles(req, res, next) {
    try {
      const accessToken = req.headers["x-google-access-token"];
      const refreshToken = req.headers["x-google-refresh-token"];

      let authClient = null;
      if (googleDriveService.oauth2Client) {
        if (!accessToken) {
          return res.status(401).json({ error: "Missing x-google-access-token header." });
        }
        authClient = googleDriveService.getClient(accessToken, refreshToken);
      }

      const files = await googleDriveService.listPdfFiles(authClient);
      return res.status(200).json(files);
    } catch (error) {
      next(error);
    }
  }

  async importFile(req, res, next) {
    try {
      const { fileId, conceptId } = req.body;
      if (!fileId) {
        return res.status(400).json({ error: "fileId is required in request body." });
      }

      const accessToken = req.headers["x-google-access-token"];
      const refreshToken = req.headers["x-google-refresh-token"];

      let authClient = null;
      if (googleDriveService.oauth2Client) {
        if (!accessToken) {
          return res.status(401).json({ error: "Missing x-google-access-token header." });
        }
        authClient = googleDriveService.getClient(accessToken, refreshToken);
      }

      const uploadDir = path.join(__dirname, "../../public/uploads");
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      const filename = `${uniqueSuffix}.pdf`;
      const destPath = path.join(uploadDir, filename);

      // Download file to disk
      const fileMetadata = await googleDriveService.downloadFile(authClient, fileId, destPath);

      // Create local file upload record
      const fileRecord = await prisma.uploadFile.create({
        data: {
          fileName: fileMetadata.name || "google-drive-import.pdf",
          filePath: `/uploads/${filename}`,
          fileSize: fileMetadata.size || 0,
          mimeType: fileMetadata.mimeType || "application/pdf",
          processedDriveFileId: fileId,
          uploadedById: req.user.id,
        },
      });

      // Create a background job for parsing
      const jobRecord = await processingService.createJob(req.user.id, fileRecord.id);

      // Trigger the background processing asynchronously
      processingService.startPdfProcessing(
        jobRecord.id,
        fileRecord.id,
        req.user.id,
        conceptId ? parseInt(conceptId) : null
      );

      return res.status(202).json({
        message: "Google Drive file download and parse initiated.",
        file: fileRecord,
        job: jobRecord,
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new GoogleDriveController();
