const prisma = require("../config/prisma");
const reviewRepository = require("../repositories/review.repository");
const auditService = require("./audit.service");
const subjectAccessService = require("./subjectAccess.service");
const sectionNormalizerService = require("./sectionNormalizer.service");

const parseOptionalInt = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : null;
};

const truncateForColumn = (value, maxLength, fallback = null) => {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  if (!text) return fallback;
  return text.length > maxLength ? text.slice(0, maxLength) : text;
};

const toQuestionContent = (question) => {
  const content = String(question?.content || "").trim();
  if (content) return content;
  if (question?.imageUrl || question?.questionImageUrl) return "[Image question]";
  return truncateForColumn(question?.questionHeader, 1000, "Untitled extracted question");
};

const cleanMediaUrl = (value) => truncateForColumn(value, 500);

const toReviewPayload = (extractedData = {}) => {
  if (!extractedData || typeof extractedData !== "object") return extractedData;
  const shouldNormalize =
    extractedData.sectionWorkflow?.enabled ||
    extractedData.source === "EXTRACTION" ||
    Boolean(extractedData.sectionMap);

  if (!shouldNormalize) return extractedData;
  return sectionNormalizerService.normalizeExtractionData(extractedData, { enabled: true }).extractedData;
};

const toSectionEvidence = (value) => {
  if (!value || typeof value !== "object") return null;
  return value;
};

const toAnswerContent = (answer) => {
  const content = String(answer?.content || "").trim();
  if (content) return content;
  if (answer?.imageUrl || answer?.optionImageUrl) return "[Image option]";
  return "";
};

class ReviewService {
  async getReviewsList(filters = {}, user = null) {
    const assignedSubjectIds = await subjectAccessService.getAssignedSubjectIds(user);
    return reviewRepository.getReviewsList({
      ...filters,
      ...(Array.isArray(assignedSubjectIds) ? { assignedSubjectIds } : {}),
    });
  }

  async getReviewById(id, user = null) {
    const review = await reviewRepository.findById(id);
    if (!review) {
      const err = new Error("Review record not found");
      err.statusCode = 404;
      throw err;
    }
    await this.ensureReviewSubjectAccess(review, user);
    return review;
  }

  async updateReview(id, extractedData, user) {
    const review = await reviewRepository.findById(id);
    if (!review) {
      const err = new Error("Review record not found");
      err.statusCode = 404;
      throw err;
    }
    if (review.status !== "PENDING") {
      const err = new Error(`Cannot modify a review with status '${review.status}'`);
      err.statusCode = 400;
      throw err;
    }
    await this.ensureReviewSubjectAccess(review, user);
    if (extractedData?.subjectId) {
      await subjectAccessService.requireSubjectAccess(user, extractedData.subjectId);
    }
    const normalizedData = toReviewPayload(extractedData);
    const updated = await reviewRepository.update(id, normalizedData);
    await auditService.log({
      userId: user.id,
      action: "EDIT_REVIEW",
      entityType: "ExtractionReview",
      entityId: id,
      oldValue: review.extractedData,
      newValue: normalizedData
    });
    return updated;
  }

  async getSectionMap(id, user) {
    const review = await this.getReviewById(id, user);
    const { sectionMap, issues } = sectionNormalizerService.normalizeExtractionData(review.extractedData, {
      enabled: Boolean(review.extractedData?.sectionWorkflow?.enabled),
    });

    return {
      reviewId: review.id,
      status: review.status,
      sectionMap,
      issues,
    };
  }

  async normalizeSections(id, user) {
    const review = await reviewRepository.findById(id);
    if (!review) {
      const err = new Error("Review record not found");
      err.statusCode = 404;
      throw err;
    }
    if (review.status !== "PENDING") {
      const err = new Error(`Cannot normalize a review with status '${review.status}'`);
      err.statusCode = 400;
      throw err;
    }
    await this.ensureReviewSubjectAccess(review, user);

    const { extractedData, sectionMap, issues } = sectionNormalizerService.normalizeExtractionData(review.extractedData, {
      enabled: true,
    });
    const updated = await reviewRepository.update(id, extractedData);

    await auditService.log({
      userId: user.id,
      action: "NORMALIZE_REVIEW_SECTIONS",
      entityType: "ExtractionReview",
      entityId: id,
      oldValue: review.extractedData?.sectionMap || null,
      newValue: sectionMap,
    });

    return {
      review: updated,
      sectionMap,
      issues,
    };
  }

  async approveReview(id, user, extractedDataOverride = null) {
    const review = await reviewRepository.findById(id);
    if (!review) {
      const err = new Error("Review record not found");
      err.statusCode = 404;
      throw err;
    }

    if (review.status !== "PENDING") {
      const err = new Error(`Cannot approve a review with status '${review.status}'`);
      err.statusCode = 400;
      throw err;
    }
    await this.ensureReviewSubjectAccess(review, user);

    const data = toReviewPayload(extractedDataOverride || review.extractedData);
    if (!data || !data.subjectId) {
      const err = new Error("Invalid extracted data structure: subjectId is required");
      err.statusCode = 400;
      throw err;
    }
    if (data.sectionWorkflow?.enabled) {
      const validation = sectionNormalizerService.validateForGeneration(data);
      if (!validation.valid) {
        const err = new Error("Section metadata must be corrected before approval.");
        err.statusCode = 400;
        err.details = {
          issues: validation.issues,
        };
        throw err;
      }
    }
    if (extractedDataOverride?.subjectId) {
      await subjectAccessService.requireSubjectAccess(user, extractedDataOverride.subjectId);
      await reviewRepository.update(id, data);
      await auditService.log({
        userId: user.id,
        action: "EDIT_REVIEW",
        entityType: "ExtractionReview",
        entityId: id,
        oldValue: review.extractedData,
        newValue: data
      });
    }

    const subjectId = parseInt(data.subjectId, 10);
    const sourceJob = await prisma.processingJob.findFirst({
      where: { uploadFileId: review.uploadFileId },
      orderBy: { startedAt: "desc" },
    });
    const sourceType = review.uploadFile?.processedDriveFileId || review.uploadFile?.driveFileId
      ? "DRIVE"
      : "PDF";

    // Verify subject exists
    const subject = await prisma.subject.findFirst({
      where: { id: subjectId, isDeleted: false },
    });
    if (!subject) {
      const err = new Error(`Target Subject ID #${subjectId} does not exist or has been deleted.`);
      err.statusCode = 400;
      throw err;
    }

    // Insert chapters, concepts, questions, and answers in a transactional scope
    await prisma.$transaction(async (tx) => {
      const chapters = data.chapters || [];
      for (const ch of chapters) {
        const chapterName = truncateForColumn(ch.name, 191, "Extracted Chapter");
        // Find or create Chapter
        let chapter = await tx.chapter.findFirst({
          where: { name: chapterName, subjectId: subjectId, isDeleted: false },
        });
        if (!chapter) {
          chapter = await tx.chapter.create({
            data: {
              name: chapterName,
              description: ch.description || "",
              subjectId: subjectId,
            },
          });
        }

        const concepts = ch.concepts || [];
        for (const co of concepts) {
          const conceptName = truncateForColumn(co.name, 191, "Extracted Concept");
          // Find or create Concept
          let concept = await tx.concept.findFirst({
            where: { name: conceptName, chapterId: chapter.id, isDeleted: false },
          });
          if (!concept) {
            concept = await tx.concept.create({
              data: {
                name: conceptName,
                description: co.description || "",
                chapterId: chapter.id,
              },
            });
          }

          const questions = co.questions || [];
          for (const q of questions) {
            // Create Question
            const createdQuestion = await tx.question.create({
              data: {
                content: toQuestionContent(q),
                imageUrl: cleanMediaUrl(q.imageUrl || q.questionImageUrl),
                type: q.type || "MCQ",
                questionNo: truncateForColumn(q.questionNo, 80),
                questionHeader: truncateForColumn(q.questionHeader, 255),
                sectionName: truncateForColumn(q.sectionName, 120),
                sectionOrder: parseOptionalInt(q.sectionOrder),
                sourceQuestionNo: truncateForColumn(q.sourceQuestionNo || q.questionNo, 80),
                sourcePageNo: parseOptionalInt(q.sourcePageNo || q.pageNo),
                sectionConfidence: truncateForColumn(q.sectionConfidence, 20),
                sectionEvidence: toSectionEvidence(q.sectionEvidence),
                subpartCount: parseOptionalInt(q.subpartCount),
                choiceGroupKey: truncateForColumn(q.choiceGroupKey, 120),
                questionTypeLabel: truncateForColumn(q.questionTypeLabel, 120),
                objectiveType: truncateForColumn(q.objectiveType, 80),
                marks: parseOptionalInt(q.marks),
                difficulty: q.difficulty || "MEDIUM",
                status: "APPROVED",
                explanation: q.explanation || "",
                createdById: parseInt(user.id),
                conceptId: concept.id,
                sourceFileId: review.uploadFileId,
                sourceFileName: truncateForColumn(review.uploadFile?.fileName, 255),
                sourceReference: truncateForColumn(q.sourceReference, 255),
                sourceType: truncateForColumn(sourceType, 40, "PDF"),
                importJobId: sourceJob?.id || null,
                extractionReviewId: review.id,
              },
            });

            // Create Answers
            const answers = q.answers || [];
            if (answers.length > 0) {
              await tx.answer.createMany({
                data: answers.map((a) => ({
                  questionId: createdQuestion.id,
                  content: toAnswerContent(a),
                  imageUrl: cleanMediaUrl(a.imageUrl || a.optionImageUrl),
                  isCorrect: Boolean(a.isCorrect),
                  explanation: a.explanation || "",
                })),
              });
            }
          }
        }
      }
    });

    // Update review status
    const updated = await reviewRepository.updateStatus(id, "APPROVED", user.id);
    await auditService.log({
      userId: user.id,
      action: "APPROVE_REVIEW",
      entityType: "ExtractionReview",
      entityId: id,
      newValue: { status: "APPROVED" }
    });
    return updated;
  }

  async rejectReview(id, user) {
    const review = await reviewRepository.findById(id);
    if (!review) {
      const err = new Error("Review record not found");
      err.statusCode = 404;
      throw err;
    }

    if (review.status !== "PENDING") {
      const err = new Error(`Cannot reject a review with status '${review.status}'`);
      err.statusCode = 400;
      throw err;
    }
    await this.ensureReviewSubjectAccess(review, user);

    const updated = await reviewRepository.updateStatus(id, "REJECTED", user.id);
    await auditService.log({
      userId: user.id,
      action: "REJECT_REVIEW",
      entityType: "ExtractionReview",
      entityId: id,
      newValue: { status: "REJECTED" }
    });
    return updated;
  }

  async ensureReviewSubjectAccess(review, user) {
    const subjectId = review?.extractedData?.subjectId;
    await subjectAccessService.requireSubjectAccess(user, subjectId);
  }
}

module.exports = new ReviewService();
