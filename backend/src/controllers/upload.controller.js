const prisma = require("../config/prisma");
const processingService = require("../services/processing.service");
const auditService = require("../services/audit.service");
const googleDriveService = require("../services/googleDrive.service");
const fs = require("fs");

const IMPORT_DEDUP_TTL_MS = 5 * 60 * 1000;
const pdfImportRequests = new Map();

const buildProcessedDownloadName = (fileName) => {
  const safeName = (fileName || "extracted-data")
    .replace(/\.[^.]+$/, "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_");

  return `processed_${safeName || "extracted-data"}.json`;
};

const cleanupUploadedRequestFile = (file) => {
  if (!file?.path) return;

  try {
    if (fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
  } catch (error) {
    console.error(`Failed to remove duplicate upload file at ${file.path}:`, error.message);
  }
};

const isImageFile = (file) => {
  const extension = String(file?.originalname || "").toLowerCase().match(/\.[^.]+$/)?.[0];
  return String(file?.mimetype || "").startsWith("image/") ||
    [".jpg", ".jpeg", ".png", ".gif"].includes(extension);
};

const pruneExpiredPdfImports = () => {
  const now = Date.now();
  for (const [key, entry] of pdfImportRequests.entries()) {
    if (entry.expiresAt <= now) {
      pdfImportRequests.delete(key);
    }
  }
};

const getPdfImportIdempotencyKey = (req) => {
  const rawKey = Array.isArray(req.headers["x-idempotency-key"])
    ? req.headers["x-idempotency-key"][0]
    : req.headers["x-idempotency-key"];
  const key = String(rawKey || "").trim();

  return key ? `${req.user.id}:${key}` : null;
};

class UploadController {
  async uploadMedia(req, res, next) {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No image was uploaded." });
      }

      if (!isImageFile(req.file)) {
        cleanupUploadedRequestFile(req.file);
        return res.status(400).json({ error: "Only JPG, PNG, and GIF images are supported here." });
      }

      const { originalname, filename, size, mimetype } = req.file;
      const relativePath = `/uploads/${filename}`;

      const dbFile = await prisma.uploadFile.create({
        data: {
          fileName: originalname,
          filePath: relativePath,
          fileSize: size,
          mimeType: mimetype,
          uploadedById: req.user.id,
          processingStatus: "COMPLETED",
        },
      });

      await auditService.log({
        userId: req.user.id,
        action: "UPLOAD_MEDIA",
        entityType: "UploadFile",
        entityId: dbFile.id,
        newValue: { fileName: dbFile.fileName, filePath: dbFile.filePath, mimeType: dbFile.mimeType }
      });

      return res.status(201).json({
        message: "Image uploaded successfully",
        file: dbFile,
      });
    } catch (error) {
      next(error);
    }
  }

  async uploadFile(req, res, next) {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file was uploaded." });
      }

      const { originalname, filename, size, mimetype } = req.file;
      const questionId = req.body.questionId ? parseInt(req.body.questionId) : null;

      const relativePath = `/uploads/${filename}`;
      const absolutePath = req.file.path;
      
      const driveFileId = await googleDriveService.uploadAppFile(absolutePath, originalname, mimetype, 'RAW');

      const dbFile = await prisma.uploadFile.create({
        data: {
          fileName: originalname,
          filePath: relativePath,
          fileSize: size,
          mimeType: mimetype,
          driveFileId: driveFileId,
          uploadedById: req.user.id,
          questionId: questionId,
        },
      });

      await auditService.log({
        userId: req.user.id,
        action: "UPLOAD_FILE",
        entityType: "UploadFile",
        entityId: dbFile.id,
        newValue: { fileName: dbFile.fileName, filePath: dbFile.filePath }
      });

      return res.status(201).json({
        message: "File uploaded successfully",
        file: dbFile,
      });
    } catch (error) {
      next(error);
    }
  }

  async importPdf(req, res, next) {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No PDF file uploaded." });
      }

      if (req.file.mimetype !== "application/pdf") {
        cleanupUploadedRequestFile(req.file);
        return res.status(400).json({ error: "Only PDF documents are supported for bulk question imports." });
      }

      const conceptId = req.body.conceptId ? parseInt(req.body.conceptId) : null;
      const importKey = getPdfImportIdempotencyKey(req);
      pruneExpiredPdfImports();

      if (importKey && pdfImportRequests.has(importKey)) {
        cleanupUploadedRequestFile(req.file);
        const existingPayload = await pdfImportRequests.get(importKey).promise;

        return res.status(202).json({
          ...existingPayload,
          duplicateIgnored: true,
          message: "This PDF import is already queued. Reusing the existing background job.",
        });
      }

      const importPromise = this.queuePdfImport(req, conceptId);
      if (importKey) {
        pdfImportRequests.set(importKey, {
          promise: importPromise,
          expiresAt: Date.now() + IMPORT_DEDUP_TTL_MS,
        });
      }

      const payload = await importPromise;
      return res.status(202).json(payload);
    } catch (error) {
      const importKey = getPdfImportIdempotencyKey(req);
      if (importKey) {
        pdfImportRequests.delete(importKey);
      }
      next(error);
    }
  }

  async queuePdfImport(req, conceptId) {
    const { originalname, filename, size, mimetype } = req.file;
    const relativePath = `/uploads/${filename}`;
    const absolutePath = req.file.path;

    const driveFileId = await googleDriveService.uploadAppFile(absolutePath, originalname, mimetype, 'RAW');

    // 1. Save File metadata
    const fileRecord = await prisma.uploadFile.create({
      data: {
        fileName: originalname,
        filePath: relativePath,
        fileSize: size,
        mimeType: mimetype,
        driveFileId: driveFileId,
        uploadedById: req.user.id,
      },
    });

    await auditService.log({
      userId: req.user.id,
      action: "UPLOAD_FILE_IMPORT",
      entityType: "UploadFile",
      entityId: fileRecord.id,
      newValue: { fileName: fileRecord.fileName, filePath: fileRecord.filePath }
    });

    // 2. Register Background Job
    const jobRecord = await processingService.createJob(req.user.id, fileRecord.id);

    // 3. Trigger async parsing (Without await so request responds instantly)
    processingService.startPdfProcessing(jobRecord.id, fileRecord.id, req.user.id, conceptId);

    return {
      message: "File uploaded. Bulk question parsing job registered.",
      file: fileRecord,
      job: jobRecord,
    };
  }

  async getJobStatus(req, res, next) {
    try {
      const { jobId } = req.params;
      const job = await processingService.getJobById(jobId);

      if (!job) {
        return res.status(404).json({ error: "Processing job not found." });
      }

      return res.status(200).json(job);
    } catch (error) {
      next(error);
    }
  }

  async getJobs(req, res, next) {
    try {
      const jobs = await prisma.processingJob.findMany({
        where: {
          createdById: req.user.id,
        },
        orderBy: {
          startedAt: "desc",
        },
      });
      return res.status(200).json(jobs);
    } catch (error) {
      next(error);
    }
  }

  async getFiles(req, res, next) {
    try {
      const files = await prisma.uploadFile.findMany({
        where: {
          uploadedById: req.user.id,
        },
        orderBy: {
          createdAt: "desc",
        },
      });
      return res.status(200).json(files);
    } catch (error) {
      next(error);
    }
  }

  async downloadProcessedFile(req, res, next) {
    try {
      const { fileId } = req.params;

      const parsedFileId = parseInt(fileId, 10);
      if (Number.isNaN(parsedFileId)) {
        return res.status(400).json({ error: "Invalid file ID." });
      }

      const latestReview = await prisma.extractionReview.findFirst({
        where: { uploadFileId: parsedFileId },
        orderBy: [
          { version: "desc" },
          { createdAt: "desc" },
        ],
        include: {
          uploadFile: {
            select: {
              id: true,
              fileName: true,
              mimeType: true,
              fileSize: true,
              processingStatus: true,
              createdAt: true,
            },
          },
          reviewedBy: {
            select: { id: true, name: true, email: true },
          },
        },
      });

      if (!latestReview) {
        return res.status(404).json({ error: "Processed extraction data not found in the database." });
      }

      const payload = {
        file: latestReview.uploadFile,
        review: {
          id: latestReview.id,
          version: latestReview.version,
          status: latestReview.status,
          promptUsed: latestReview.promptUsed,
          reviewedBy: latestReview.reviewedBy,
          createdAt: latestReview.createdAt,
          updatedAt: latestReview.updatedAt,
        },
        extractedData: latestReview.extractedData,
        geminiResponse: latestReview.geminiResponse,
      };

      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${buildProcessedDownloadName(latestReview.uploadFile?.fileName)}"`
      );

      return res.status(200).send(JSON.stringify(payload, null, 2));
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new UploadController();
