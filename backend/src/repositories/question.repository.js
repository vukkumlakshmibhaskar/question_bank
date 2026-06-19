const prisma = require("../config/prisma");
const { paginatedResponse } = require("../utils/pagination");

const questionInclude = {
  answers: true,
  concept: {
    include: {
      chapter: {
        include: {
          subject: true,
        },
      },
    },
  },
  sourceFile: {
    select: { id: true, fileName: true, mimeType: true, fileSize: true },
  },
  attachments: {
    select: { id: true, fileName: true, mimeType: true, fileSize: true },
  },
  bankQuestions: {
    include: {
      bank: {
        select: { id: true, name: true },
      },
    },
    orderBy: { sortOrder: "asc" },
  },
};

const bankInclude = {
  createdBy: {
    select: { id: true, name: true, email: true },
  },
  _count: {
    select: { bankQuestions: true },
  },
};

class QuestionRepository {
  // --- Question Queries ---
  async createQuestion(questionData, answersData) {
    return prisma.$transaction(async (tx) => {
      // 1. Create Question
      const question = await tx.question.create({
        data: {
          content: questionData.content,
          imageUrl: questionData.imageUrl,
          type: questionData.type,
          questionNo: questionData.questionNo,
          questionHeader: questionData.questionHeader,
          sectionName: questionData.sectionName,
          sectionOrder: questionData.sectionOrder,
          sourceQuestionNo: questionData.sourceQuestionNo,
          sourcePageNo: questionData.sourcePageNo,
          sectionConfidence: questionData.sectionConfidence,
          sectionEvidence: questionData.sectionEvidence,
          subpartCount: questionData.subpartCount,
          choiceGroupKey: questionData.choiceGroupKey,
          questionTypeLabel: questionData.questionTypeLabel,
          objectiveType: questionData.objectiveType,
          marks: questionData.marks,
          sourceFileName: questionData.sourceFileName,
          sourceReference: questionData.sourceReference,
          sourceType: questionData.sourceType,
          importJobId: questionData.importJobId ? parseInt(questionData.importJobId) : null,
          extractionReviewId: questionData.extractionReviewId ? parseInt(questionData.extractionReviewId) : null,
          difficulty: questionData.difficulty,
          status: questionData.status || "DRAFT",
          explanation: questionData.explanation,
          createdById: parseInt(questionData.createdById),
          conceptId: parseInt(questionData.conceptId),
          sourceFileId: questionData.sourceFileId ? parseInt(questionData.sourceFileId) : null,
        },
      });

      // 2. Create Answers
      if (answersData && answersData.length > 0) {
        await tx.answer.createMany({
          data: answersData.map((ans) => ({
            questionId: question.id,
            content: ans.content,
            imageUrl: ans.imageUrl,
            isCorrect: Boolean(ans.isCorrect),
            explanation: ans.explanation,
          })),
        });
      }

      return tx.question.findUnique({
        where: { id: question.id },
        include: { answers: true },
      });
    });
  }

  async updateQuestion(id, questionData, answersData) {
    return prisma.$transaction(async (tx) => {
      // 1. Update Question
      const question = await tx.question.update({
        where: { id: parseInt(id) },
        data: {
          content: questionData.content,
          imageUrl: questionData.imageUrl,
          type: questionData.type,
          questionNo: questionData.questionNo,
          questionHeader: questionData.questionHeader,
          sectionName: questionData.sectionName,
          sectionOrder:
            questionData.sectionOrder !== undefined
              ? questionData.sectionOrder
                ? parseInt(questionData.sectionOrder)
                : null
              : undefined,
          sourceQuestionNo: questionData.sourceQuestionNo,
          sourcePageNo:
            questionData.sourcePageNo !== undefined
              ? questionData.sourcePageNo
                ? parseInt(questionData.sourcePageNo)
                : null
              : undefined,
          sectionConfidence: questionData.sectionConfidence,
          sectionEvidence: questionData.sectionEvidence,
          subpartCount:
            questionData.subpartCount !== undefined
              ? questionData.subpartCount
                ? parseInt(questionData.subpartCount)
                : null
              : undefined,
          choiceGroupKey: questionData.choiceGroupKey,
          questionTypeLabel: questionData.questionTypeLabel,
          objectiveType: questionData.objectiveType,
          marks: questionData.marks,
          sourceFileName: questionData.sourceFileName,
          sourceReference: questionData.sourceReference,
          sourceType: questionData.sourceType,
          importJobId:
            questionData.importJobId !== undefined
              ? questionData.importJobId
                ? parseInt(questionData.importJobId)
                : null
              : undefined,
          extractionReviewId:
            questionData.extractionReviewId !== undefined
              ? questionData.extractionReviewId
                ? parseInt(questionData.extractionReviewId)
                : null
              : undefined,
          difficulty: questionData.difficulty,
          status: questionData.status,
          explanation: questionData.explanation,
          conceptId: questionData.conceptId ? parseInt(questionData.conceptId) : undefined,
          sourceFileId:
            questionData.sourceFileId !== undefined
              ? questionData.sourceFileId
                ? parseInt(questionData.sourceFileId)
                : null
              : undefined,
        },
      });

      // 2. Refresh Answers if new list is provided
      if (answersData) {
        await tx.answer.deleteMany({
          where: { questionId: parseInt(id) },
        });

        if (answersData.length > 0) {
          await tx.answer.createMany({
            data: answersData.map((ans) => ({
              questionId: question.id,
              content: ans.content,
              imageUrl: ans.imageUrl,
              isCorrect: Boolean(ans.isCorrect),
              explanation: ans.explanation,
            })),
          });
        }
      }

      return tx.question.findUnique({
        where: { id: question.id },
        include: { answers: true },
      });
    });
  }

  async deleteQuestion(id) {
    return prisma.question.delete({
      where: { id: parseInt(id) },
    });
  }

  async deleteQuestions(ids) {
    return prisma.question.deleteMany({
      where: {
        id: {
          in: ids.map((id) => parseInt(id)),
        },
      },
    });
  }

  async findQuestionById(id) {
    return prisma.question.findUnique({
      where: { id: parseInt(id) },
      include: {
        createdBy: {
          select: { id: true, name: true, email: true },
        },
        ...questionInclude,
      },
    });
  }

  async findConceptScope(id) {
    return prisma.concept.findFirst({
      where: { id: parseInt(id), isDeleted: false },
      include: {
        chapter: {
          include: {
            subject: true,
          },
        },
      },
    });
  }

  async findQuestions(whereClause, pagination = null) {
    const query = {
      where: whereClause,
      include: questionInclude,
      orderBy: { createdAt: "desc" },
    };

    if (!pagination?.wantsPagination) {
      return prisma.question.findMany(query);
    }

    const [total, rows] = await Promise.all([
      prisma.question.count({ where: whereClause }),
      prisma.question.findMany({
        ...query,
        skip: pagination.skip,
        take: pagination.take,
      }),
    ]);

    return paginatedResponse(rows, total, pagination);
  }

  async findQuestionMetadataValues() {
    return prisma.question.findMany({
      select: {
        questionTypeLabel: true,
        objectiveType: true,
        questionHeader: true,
      },
      orderBy: { updatedAt: "desc" },
    });
  }

  async updateQuestionMetadata(id, data) {
    return prisma.question.update({
      where: { id: parseInt(id) },
      data,
      include: {
        answers: true,
        concept: {
          include: {
            chapter: {
              include: {
                subject: true,
              },
            },
          },
        },
        sourceFile: {
          select: { id: true, fileName: true, mimeType: true, fileSize: true },
        },
        bankQuestions: {
          include: {
            bank: {
              select: { id: true, name: true },
            },
          },
          orderBy: { sortOrder: "asc" },
        },
      },
    });
  }

  // --- QuestionBank Queries ---
  async createBank(bankData) {
    return prisma.questionBank.create({
      data: {
        name: bankData.name,
        description: bankData.description,
        isPublic: Boolean(bankData.isPublic),
        academicYear: bankData.academicYear,
        sscClass: bankData.sscClass,
        jobRole: bankData.jobRole,
        subjectCode: bankData.subjectCode,
        subjectName: bankData.subjectName,
        createdById: parseInt(bankData.createdById),
      },
    });
  }

  async findBankById(id) {
    return prisma.questionBank.findUnique({
      where: { id: parseInt(id) },
      include: {
        createdBy: {
          select: { id: true, name: true, email: true },
        },
        bankQuestions: {
          include: {
            question: {
              include: {
                answers: true,
                concept: {
                  include: {
                    chapter: {
                      include: {
                        subject: true,
                      },
                    },
                  },
                },
              },
            },
          },
          orderBy: { sortOrder: "asc" },
        },
      },
    });
  }

  async findBanks(whereClause, pagination = null) {
    const query = {
      where: whereClause,
      include: bankInclude,
      orderBy: { createdAt: "desc" },
    };

    if (!pagination?.wantsPagination) {
      return prisma.questionBank.findMany(query);
    }

    const [total, rows] = await Promise.all([
      prisma.questionBank.count({ where: whereClause }),
      prisma.questionBank.findMany({
        ...query,
        skip: pagination.skip,
        take: pagination.take,
      }),
    ]);

    return paginatedResponse(rows, total, pagination);
  }

  async updateBank(id, bankData) {
    return prisma.questionBank.update({
      where: { id: parseInt(id) },
      data: {
        name: bankData.name,
        description: bankData.description,
        isPublic: Boolean(bankData.isPublic),
        academicYear: bankData.academicYear,
        sscClass: bankData.sscClass,
        jobRole: bankData.jobRole,
        subjectCode: bankData.subjectCode,
        subjectName: bankData.subjectName,
      },
    });
  }

  async deleteBank(id) {
    return prisma.questionBank.delete({
      where: { id: parseInt(id) },
    });
  }

  // --- Junction Queries (BankQuestion) ---
  async addQuestionToBank(bankId, questionId, sortOrder = 0) {
    return prisma.bankQuestion.upsert({
      where: {
        bankId_questionId: {
          bankId: parseInt(bankId),
          questionId: parseInt(questionId),
        },
      },
      update: { sortOrder: parseInt(sortOrder) },
      create: {
        bankId: parseInt(bankId),
        questionId: parseInt(questionId),
        sortOrder: parseInt(sortOrder),
      },
    });
  }

  async addQuestionsToBank(bankId, questionIds, sortOrder = 0) {
    const parsedBankId = parseInt(bankId);
    const parsedSortOrder = parseInt(sortOrder);

    return prisma.$transaction(
      questionIds.map((questionId, index) =>
        prisma.bankQuestion.upsert({
          where: {
            bankId_questionId: {
              bankId: parsedBankId,
              questionId: parseInt(questionId),
            },
          },
          update: { sortOrder: parsedSortOrder + index },
          create: {
            bankId: parsedBankId,
            questionId: parseInt(questionId),
            sortOrder: parsedSortOrder + index,
          },
        })
      )
    );
  }

  async removeQuestionFromBank(bankId, questionId) {
    return prisma.bankQuestion.delete({
      where: {
        bankId_questionId: {
          bankId: parseInt(bankId),
          questionId: parseInt(questionId),
        },
      },
    });
  }

  async removeQuestionsFromBank(bankId, questionIds) {
    return prisma.bankQuestion.deleteMany({
      where: {
        bankId: parseInt(bankId),
        questionId: {
          in: questionIds.map((questionId) => parseInt(questionId)),
        },
      },
    });
  }
}

module.exports = new QuestionRepository();
