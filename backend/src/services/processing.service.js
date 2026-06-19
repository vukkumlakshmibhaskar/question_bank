const path = require("path");
const fs = require("fs");
const prisma = require("../config/prisma");
const reviewRepository = require("../repositories/review.repository");
const geminiService = require("./gemini.service");
const googleDriveService = require("./googleDrive.service");

class ProcessingService {
  async createJob(userId, uploadFileId = null) {
    return prisma.processingJob.create({
      data: {
        uploadFileId: uploadFileId ? parseInt(uploadFileId) : null,
        status: "PENDING",
        createdById: userId,
      },
    });
  }

  async getJobById(jobId) {
    return prisma.processingJob.findUnique({
      where: { id: parseInt(jobId) },
      include: {
        createdBy: {
          select: { id: true, name: true, email: true },
        },
        uploadFile: true,
      },
    });
  }

  // Asynchronously process PDF parsing via Gemini
  async startPdfProcessing(jobId, fileId, userId, conceptId = null) {
    // 1. Update status to PROCESSING
    await prisma.$transaction([
      prisma.processingJob.update({
        where: { id: jobId },
        data: { status: "PROCESSING" },
      }),
      prisma.uploadFile.update({
        where: { id: fileId },
        data: { processingStatus: "PROCESSING" },
      }),
    ]);

    console.log(`[Job #${jobId}] Async PDF processing started for File ID #${fileId}...`);

    // Run background processing
    (async () => {
      try {
        // Retrieve the file record
        const fileRecord = await prisma.uploadFile.findUnique({
          where: { id: fileId },
        });
        if (!fileRecord) {
          throw new Error(`UploadFile record with ID ${fileId} not found.`);
        }

        const absolutePath = path.join(__dirname, "../../public", fileRecord.filePath);
        if (!fs.existsSync(absolutePath)) {
          throw new Error(`File not found on disk at: ${absolutePath}`);
        }

        const fileBuffer = fs.readFileSync(absolutePath);

        // Find concept to link questions to
        let targetConceptId = conceptId ? parseInt(conceptId) : null;
        let subjectId = null;

        if (targetConceptId) {
          const concept = await prisma.concept.findUnique({
            where: { id: targetConceptId },
            include: {
              chapter: {
                select: { subjectId: true }
              }
            }
          });
          if (concept) {
            subjectId = concept.chapter.subjectId;
          }
        }

        if (!subjectId) {
          const defaultSubject = await prisma.subject.findFirst();
          if (!defaultSubject) {
            throw new Error("No subjects exist. Create a Subject taxonomy first.");
          }
          subjectId = defaultSubject.id;
        }

        // Call Gemini Service for extraction
        const result = await geminiService.extractQuestionsFromDoc(fileBuffer, fileRecord.mimeType);

        if (!result || (!result.chapters && !result.questions)) {
          throw new Error("Invalid structure returned from Gemini Service.");
        }

        // Standardize structure to chapters -> concepts -> questions
        let chapters = result.chapters;
        if (!chapters && result.questions) {
          // Fallback if Gemini returned a flat structure
          let defaultChapterName = "Extracted Chapter";
          let defaultConceptName = "Extracted Concept";
          if (targetConceptId) {
            const concept = await prisma.concept.findUnique({
              where: { id: targetConceptId },
              include: { chapter: true }
            });
            if (concept) {
              defaultConceptName = concept.name;
              defaultChapterName = concept.chapter.name;
            }
          }
          chapters = [{
            name: defaultChapterName,
            description: "Automatically grouped from flat question extraction.",
            concepts: [{
              name: defaultConceptName,
              description: "Automatically grouped concept.",
              questions: result.questions
            }]
          }];
        }

        const extractedData = {
          subjectId: subjectId,
          chapters: chapters || []
        };

        const promptUsed = "Extract all questions and their answer options (flagging which is correct) from the uploaded document. Do NOT generate explanations (set explanation to null or an empty string). Keep the chapters and concepts concise. Focus strictly on extracting all questions and answers correctly. Respond strictly matching the requested JSON schema.";
        await reviewRepository.create(fileId, extractedData, promptUsed, result);

        // Compute total question count for confirmation message
        let questionCount = 0;
        (chapters || []).forEach(ch => {
          (ch.concepts || []).forEach(co => {
            questionCount += (co.questions || []).length;
          });
        });

        let cleanupResult = { localDeleted: false, driveDeleted: false };
        if (questionCount > 0) {
          cleanupResult = await this.cleanupUploadedPdfAfterExtraction(jobId, fileRecord, absolutePath);
        } else {
          console.warn(`[Job #${jobId}] Extraction returned zero questions. Keeping uploaded PDF for review.`);
        }

        const cleanupMessage = questionCount > 0
          ? ` Uploaded PDF cleanup: local ${cleanupResult.localDeleted ? "deleted" : "not found"}, raw Drive ${cleanupResult.driveDeleted ? "deleted" : "not configured"}.`
          : " Uploaded PDF kept because no questions were extracted.";

        // 3. Update job as COMPLETED
        await prisma.$transaction([
          prisma.processingJob.update({
            where: { id: jobId },
            data: {
              status: "COMPLETED",
              completedAt: new Date(),
              errorMessage: `Successfully extracted ${questionCount} questions to review queue.${cleanupMessage}`,
            },
          }),
          prisma.uploadFile.update({
            where: { id: fileId },
            data: {
              processingStatus: "COMPLETED",
              ...(cleanupResult.driveDeleted ? { driveFileId: null } : {}),
            },
          }),
        ]);
        console.log(`[Job #${jobId}] PDF processing completed successfully.`);
      } catch (err) {
        // 4. Update job as FAILED
        await prisma.$transaction([
          prisma.processingJob.update({
            where: { id: jobId },
            data: {
              status: "FAILED",
              completedAt: new Date(),
              errorMessage: err.message || "An unknown error occurred during PDF parsing.",
            },
          }),
          prisma.uploadFile.update({
            where: { id: fileId },
            data: { processingStatus: "FAILED" },
          }),
        ]);
        console.error(`[Job #${jobId}] PDF processing failed: ${err.message}`);
      }
    })();
  }

  async cleanupUploadedPdfAfterExtraction(jobId, fileRecord, absolutePath) {
    const uploadRoot = path.resolve(__dirname, "../../public/uploads");
    const resolvedPath = path.resolve(absolutePath);
    const result = {
      localDeleted: false,
      driveDeleted: false,
    };

    if (!resolvedPath.startsWith(uploadRoot + path.sep)) {
      console.warn(`[Job #${jobId}] Skipping local PDF cleanup outside uploads directory: ${resolvedPath}`);
      return result;
    }

    try {
      if (fs.existsSync(resolvedPath)) {
        fs.unlinkSync(resolvedPath);
        result.localDeleted = true;
        console.log(`[Job #${jobId}] Deleted uploaded PDF from local storage: ${resolvedPath}`);
      }
    } catch (cleanupErr) {
      console.error(`[Job #${jobId}] Failed to delete local uploaded PDF:`, cleanupErr.message);
    }

    if (fileRecord.driveFileId) {
      try {
        await googleDriveService.deleteAppFile(fileRecord.driveFileId);
        result.driveDeleted = true;
        console.log(`[Job #${jobId}] Deleted RAW uploaded PDF from Drive: ${fileRecord.driveFileId}`);
      } catch (driveCleanupErr) {
        console.error(`[Job #${jobId}] Failed to delete RAW Drive PDF:`, driveCleanupErr.message);
      }
    }

    return result;
  }
}

module.exports = new ProcessingService();
