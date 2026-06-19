const os = require("os");
const prisma = require("../config/prisma");
const auditService = require("./audit.service");

const nonEmptyCount = (rows, field) => {
  return rows.filter((row) => String(row[field] || "").trim()).length;
};

class ApiSnapshotService {
  async getQuestionBankSnapshot(user) {
    const [
      languageRows,
      skillRows,
      subjectCount,
      onlineTests,
      onlineModeRows,
      authorizationRows,
    ] = await Promise.all([
      prisma.questionBank.findMany({
        distinct: ["subjectName"],
        select: { subjectName: true },
        where: { subjectName: { not: null } },
      }),
      prisma.questionBank.findMany({
        distinct: ["jobRole"],
        select: { jobRole: true },
        where: { jobRole: { not: null } },
      }),
      prisma.subject.count({ where: { isDeleted: false } }),
      prisma.testPaper.count(),
      prisma.testPaper.findMany({
        distinct: ["examNature"],
        select: { examNature: true },
        where: { examNature: { not: null } },
      }),
      prisma.rolePermission.count({ where: { isDeleted: false } }),
    ]);

    const snapshot = {
      refreshedAt: new Date().toISOString(),
      instanceId: process.env.INSTANCE_ID || process.env.APP_INSTANCE_ID || os.hostname(),
      userId: parseInt(user.id),
      counts: {
        languages: nonEmptyCount(languageRows, "subjectName"),
        skills: nonEmptyCount(skillRows, "jobRole"),
        subjects: subjectCount,
        onlineTests,
        onlineModes: nonEmptyCount(onlineModeRows, "examNature"),
        authorizationRows,
      },
      labels: {
        languages: languageRows.map((row) => row.subjectName).filter(Boolean).sort(),
        skills: skillRows.map((row) => row.jobRole).filter(Boolean).sort(),
        onlineModes: onlineModeRows.map((row) => row.examNature).filter(Boolean).sort(),
      },
    };

    await auditService.log({
      userId: user.id,
      action: "REFRESH_QB_API_SNAPSHOT",
      entityType: "QuestionBankApiSnapshot",
      entityId: user.id,
      newValue: {
        counts: snapshot.counts,
        instanceId: snapshot.instanceId,
        refreshedAt: snapshot.refreshedAt,
      },
    });

    return snapshot;
  }
}

module.exports = new ApiSnapshotService();
