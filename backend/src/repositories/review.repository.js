const prisma = require("../config/prisma");
const { parsePagination, paginatedResponse } = require("../utils/pagination");

const reviewListSelect = {
  id: true,
  uploadFileId: true,
  version: true,
  status: true,
  reviewedById: true,
  createdAt: true,
  updatedAt: true,
  uploadFile: {
    select: {
      id: true,
      fileName: true,
      filePath: true,
      fileSize: true,
      mimeType: true,
      processingStatus: true,
      createdAt: true,
    },
  },
  reviewedBy: {
    select: { id: true, name: true, email: true },
  },
};

class ReviewRepository {
  async create(uploadFileId, extractedData, promptUsed = null, geminiResponse = null) {
    const lastReview = await prisma.extractionReview.findFirst({
      where: { uploadFileId: parseInt(uploadFileId) },
      orderBy: { version: "desc" },
    });
    const nextVersion = lastReview ? lastReview.version + 1 : 1;

    return prisma.extractionReview.create({
      data: {
        uploadFileId: parseInt(uploadFileId),
        extractedData: extractedData,
        promptUsed: promptUsed,
        geminiResponse: geminiResponse,
        version: nextVersion,
      },
      include: {
        uploadFile: true,
      },
    });
  }

  async findById(id) {
    return prisma.extractionReview.findUnique({
      where: { id: parseInt(id) },
      include: {
        uploadFile: true,
        reviewedBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });
  }

  async update(id, extractedData) {
    return prisma.extractionReview.update({
      where: { id: parseInt(id) },
      data: {
        extractedData: extractedData,
      },
      include: {
        uploadFile: true,
      },
    });
  }

  async updateStatus(id, status, reviewedById) {
    return prisma.extractionReview.update({
      where: { id: parseInt(id) },
      data: {
        status: status,
        reviewedById: parseInt(reviewedById),
      },
      include: {
        uploadFile: true,
      },
    });
  }

  async getReviewsList(filters = {}) {
    const whereClause = {};
    if (filters.status && filters.status !== "ALL") {
      whereClause.status = filters.status;
    }

    if (Array.isArray(filters.assignedSubjectIds)) {
      const subjectIds = filters.assignedSubjectIds.length > 0 ? filters.assignedSubjectIds : [-1];
      whereClause.AND = [
        ...(whereClause.AND || []),
        {
          OR: subjectIds.flatMap((subjectId) => [
            { extractedData: { path: "$.subjectId", equals: subjectId } },
            { extractedData: { path: "$.subjectId", equals: String(subjectId) } },
          ]),
        },
      ];
    }

    const pagination = parsePagination(filters);
    const query = {
      where: whereClause,
      select: reviewListSelect,
      orderBy: {
        id: "desc",
      },
    };

    if (!pagination.wantsPagination) {
      return prisma.extractionReview.findMany(query);
    }

    const [total, rows] = await Promise.all([
      prisma.extractionReview.count({ where: whereClause }),
      prisma.extractionReview.findMany({
        ...query,
        skip: pagination.skip,
        take: pagination.take,
      }),
    ]);

    return paginatedResponse(rows, total, pagination);
  }
}

module.exports = new ReviewRepository();
