const prisma = require("../config/prisma");

const startOfToday = () => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
};

const daysAgo = (days) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
};

class DashboardRepository {
  async getCounts(user) {
    const userId = parseInt(user.id);
    const isAdmin = user.role === "ADMIN";
    const weekStart = daysAgo(7);
    const todayStart = startOfToday();

    const questionWhere = isAdmin ? {} : { createdById: userId };
    const bankWhere = isAdmin
      ? {}
      : {
          OR: [
            { isPublic: true },
            { createdById: userId },
          ],
        };
    const ownedBankWhere = isAdmin ? {} : { createdById: userId };
    const testPaperWhere = isAdmin ? {} : { createdById: userId };
    const reviewWhere = isAdmin ? {} : { uploadFile: { uploadedById: userId } };
    const jobWhere = isAdmin ? {} : { createdById: userId };
    const auditWhere = isAdmin ? {} : { userId };

    const [
      activeUsers,
      newUsersThisWeek,
      totalQuestions,
      questionsThisWeek,
      approvedQuestions,
      draftQuestions,
      questionBanks,
      ownedQuestionBanks,
      totalTestPapers,
      publishedTestPapers,
      testPapersThisWeek,
      generatedSets,
      pendingReviews,
      approvedReviews,
      failedJobs,
      runningJobs,
      jobsToday,
      auditLogsToday,
      subjects,
      chapters,
      concepts,
    ] = await Promise.all([
      prisma.user.count({ where: { isActive: true, isDeleted: false } }),
      prisma.user.count({ where: { isActive: true, isDeleted: false, createdAt: { gte: weekStart } } }),
      prisma.question.count({ where: questionWhere }),
      prisma.question.count({ where: { ...questionWhere, createdAt: { gte: weekStart } } }),
      prisma.question.count({ where: { ...questionWhere, status: "APPROVED" } }),
      prisma.question.count({ where: { ...questionWhere, status: "DRAFT" } }),
      prisma.questionBank.count({ where: bankWhere }),
      prisma.questionBank.count({ where: ownedBankWhere }),
      prisma.testPaper.count({ where: testPaperWhere }),
      prisma.testPaper.count({ where: { ...testPaperWhere, status: "POSTED" } }),
      prisma.testPaper.count({ where: { ...testPaperWhere, createdAt: { gte: weekStart } } }),
      prisma.testPaperSet.count({
        where: isAdmin ? {} : { testPaper: { createdById: userId } },
      }),
      prisma.extractionReview.count({ where: { ...reviewWhere, status: "PENDING" } }),
      prisma.extractionReview.count({ where: { ...reviewWhere, status: "APPROVED" } }),
      prisma.processingJob.count({ where: { ...jobWhere, status: "FAILED" } }),
      prisma.processingJob.count({ where: { ...jobWhere, status: { in: ["PENDING", "PROCESSING"] } } }),
      prisma.processingJob.count({ where: { ...jobWhere, startedAt: { gte: todayStart } } }),
      prisma.auditLog.count({ where: { ...auditWhere, createdAt: { gte: todayStart } } }),
      prisma.subject.count({ where: { isDeleted: false } }),
      prisma.chapter.count({ where: { isDeleted: false } }),
      prisma.concept.count({ where: { isDeleted: false } }),
    ]);

    return {
      activeUsers,
      newUsersThisWeek,
      totalQuestions,
      questionsThisWeek,
      approvedQuestions,
      draftQuestions,
      questionBanks,
      ownedQuestionBanks,
      totalTestPapers,
      publishedTestPapers,
      testPapersThisWeek,
      generatedSets,
      pendingReviews,
      approvedReviews,
      failedJobs,
      runningJobs,
      jobsToday,
      auditLogsToday,
      subjects,
      chapters,
      concepts,
    };
  }

  async getRecentAuditLogs(user, take = 6) {
    const where = user.role === "ADMIN" ? {} : { userId: parseInt(user.id) };

    return prisma.auditLog.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            userRoles: {
              include: {
                role: {
                  select: { name: true },
                },
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      take,
    });
  }
}

module.exports = new DashboardRepository();
