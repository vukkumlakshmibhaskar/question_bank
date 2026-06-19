const prisma = require("../config/prisma");
const { paginatedResponse } = require("../utils/pagination");

const baseTestPaperInclude = {
  subject: true,
  chapter: true,
  concept: true,
  template: {
    select: {
      id: true,
      name: true,
      status: true,
    },
  },
  createdBy: {
    select: {
      id: true,
      name: true,
      email: true,
    },
  },
  _count: {
    select: {
      testPaperQuestions: true,
      sets: true,
    },
  },
  blueprintSections: {
    orderBy: {
      sectionOrder: "asc",
    },
  },
};

const testPaperDetailInclude = {
  ...baseTestPaperInclude,
  sets: {
    include: {
      questions: {
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
        orderBy: {
          displayOrder: "asc",
        },
      },
    },
    orderBy: {
      label: "asc",
    },
  },
};

class TestPaperRepository {
  async findMany(where, pagination = null) {
    const query = {
      where,
      include: baseTestPaperInclude,
      orderBy: {
        updatedAt: "desc",
      },
    };

    if (!pagination?.wantsPagination) {
      return prisma.testPaper.findMany(query);
    }

    const [total, rows] = await Promise.all([
      prisma.testPaper.count({ where }),
      prisma.testPaper.findMany({
        ...query,
        skip: pagination.skip,
        take: pagination.take,
      }),
    ]);

    return paginatedResponse(rows, total, pagination);
  }

  async findById(id) {
    return prisma.testPaper.findUnique({
      where: { id: parseInt(id) },
      include: testPaperDetailInclude,
    });
  }

  async findAuditLogsForTestPaper(id) {
    return prisma.auditLog.findMany({
      where: {
        entityType: "TestPaper",
        entityId: parseInt(id),
      },
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 25,
    });
  }

  async findQuestionBanksByIds(ids) {
    const parsedIds = [...new Set((ids || []).map((id) => parseInt(id)).filter((id) => Number.isInteger(id)))];
    if (parsedIds.length === 0) return [];

    return prisma.questionBank.findMany({
      where: { id: { in: parsedIds } },
      select: {
        id: true,
        name: true,
        academicYear: true,
        sscClass: true,
        jobRole: true,
        subjectCode: true,
        subjectName: true,
        _count: {
          select: {
            bankQuestions: true,
          },
        },
      },
      orderBy: {
        name: "asc",
      },
    });
  }

  async create(data) {
    return prisma.testPaper.create({
      data,
      include: testPaperDetailInclude,
    });
  }

  async update(id, data) {
    return prisma.testPaper.update({
      where: { id: parseInt(id) },
      data,
      include: testPaperDetailInclude,
    });
  }

  async replaceBlueprintSections(testPaperId, sections) {
    const parsedTestPaperId = parseInt(testPaperId);

    return prisma.$transaction(async (tx) => {
      await tx.assessmentBlueprintSection.deleteMany({
        where: { testPaperId: parsedTestPaperId },
      });

      if (sections.length > 0) {
        await tx.assessmentBlueprintSection.createMany({
          data: sections.map((section) => ({
            testPaperId: parsedTestPaperId,
            sectionName: section.sectionName,
            sectionOrder: section.sectionOrder,
            startsAtQuestion: section.startsAtQuestion,
            endsAtQuestion: section.endsAtQuestion,
            requiredCount: section.requiredCount,
            optionalCount: section.optionalCount,
            marksPerQuestion: section.marksPerQuestion,
            questionType: section.questionType,
            difficultyMix: section.difficultyMix,
            objectiveMix: section.objectiveMix,
            subpartRule: section.subpartRule,
            sourceBankIds: section.sourceBankIds,
            validationStatus: section.validationStatus,
          })),
        });
      }

      return tx.testPaper.findUnique({
        where: { id: parsedTestPaperId },
        include: testPaperDetailInclude,
      });
    });
  }

  async delete(id) {
    return prisma.testPaper.delete({
      where: { id: parseInt(id) },
    });
  }

  async findSubjectById(id) {
    return prisma.subject.findFirst({
      where: {
        id: parseInt(id),
        isDeleted: false,
      },
    });
  }

  async findChapterById(id) {
    return prisma.chapter.findFirst({
      where: {
        id: parseInt(id),
        isDeleted: false,
      },
    });
  }

  async findConceptById(id) {
    return prisma.concept.findFirst({
      where: {
        id: parseInt(id),
        isDeleted: false,
      },
      include: {
        chapter: true,
      },
    });
  }

  async findAccessibleQuestionBanksWithQuestions(bankIds, user, assignedSubjectIds = null) {
    const parsedIds = bankIds.map((id) => parseInt(id));
    const where = {
      id: { in: parsedIds },
    };
    const subjectFilter = Array.isArray(assignedSubjectIds)
      ? assignedSubjectIds.length > 0 ? { in: assignedSubjectIds } : { in: [-1] }
      : null;

    if (user.role !== "ADMIN") {
      where.OR = [
        { isPublic: true },
        { createdById: parseInt(user.id) },
      ];
      where.bankQuestions = {
        some: {
          question: {
            concept: {
              chapter: {
                subjectId: subjectFilter,
              },
            },
          },
        },
      };
    }

    return prisma.questionBank.findMany({
      where,
      include: {
        createdBy: {
          select: { id: true, name: true, email: true },
        },
        bankQuestions: {
          ...(subjectFilter
            ? {
                where: {
                  question: {
                    concept: {
                      chapter: {
                        subjectId: subjectFilter,
                      },
                    },
                  },
                },
              }
            : {}),
          include: {
            question: true,
          },
          orderBy: {
            sortOrder: "asc",
          },
        },
      },
      orderBy: {
        name: "asc",
      },
    });
  }

  async updateQuestionSectionMappings(mappings) {
    if (!Array.isArray(mappings) || mappings.length === 0) {
      return [];
    }

    return prisma.$transaction(
      mappings.map((mapping) =>
        prisma.question.update({
          where: { id: parseInt(mapping.questionId) },
          data: {
            sectionName: mapping.sectionName,
            sectionOrder: mapping.sectionOrder,
            sectionConfidence: mapping.sectionConfidence,
            sectionEvidence: mapping.sectionEvidence,
          },
          select: {
            id: true,
            sectionName: true,
            sectionOrder: true,
            sourceQuestionNo: true,
            questionNo: true,
          },
        })
      )
    );
  }

  async replaceGeneratedSets(testPaperId, setsData, replaceExisting = true) {
    const parsedTestPaperId = parseInt(testPaperId);

    return prisma.$transaction(async (tx) => {
      if (replaceExisting) {
        await tx.testPaperQuestion.deleteMany({
          where: { testPaperId: parsedTestPaperId },
        });

        await tx.testPaperSet.deleteMany({
          where: { testPaperId: parsedTestPaperId },
        });
      }

      for (const setData of setsData) {
        await tx.testPaperSet.create({
          data: {
            testPaperId: parsedTestPaperId,
            label: setData.label,
            generationMode: setData.generationMode,
            sourceBankIds: setData.sourceBankIds,
            questionCount: setData.questionCount,
            totalMarks: setData.totalMarks,
            easyCount: setData.easyCount,
            mediumCount: setData.mediumCount,
            hardCount: setData.hardCount,
            questions: {
              create: setData.questions.map((question) => ({
                testPaperId: parsedTestPaperId,
                questionId: question.questionId,
                marks: question.marks,
                displayOrder: question.displayOrder,
                sectionName: question.sectionName,
                sectionOrder: question.sectionOrder,
                sectionDisplayOrder: question.sectionDisplayOrder,
                sourceQuestionNo: question.sourceQuestionNo,
                isOptional: Boolean(question.isOptional),
                choiceGroupKey: question.choiceGroupKey,
                generationSnapshot: question.generationSnapshot,
              })),
            },
          },
        });
      }

      return tx.testPaper.findUnique({
        where: { id: parsedTestPaperId },
        include: testPaperDetailInclude,
      });
    });
  }

  async findSetById(id) {
    return prisma.testPaperSet.findUnique({
      where: { id: parseInt(id) },
      include: {
        testPaper: true,
        questions: {
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
          orderBy: {
            displayOrder: "asc",
          },
        },
      },
    });
  }

  async deleteSet(id) {
    return prisma.testPaperSet.delete({
      where: { id: parseInt(id) },
    });
  }
}

module.exports = new TestPaperRepository();
