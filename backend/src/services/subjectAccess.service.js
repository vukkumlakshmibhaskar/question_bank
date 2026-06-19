const prisma = require("../config/prisma");

const parseUserId = (user) => parseInt(user?.id);

class SubjectAccessService {
  isAdmin(user) {
    return user?.role === "ADMIN";
  }

  async getAssignedSubjectIds(user) {
    if (this.isAdmin(user)) return null;

    const userId = parseUserId(user);
    if (!Number.isInteger(userId)) return [];

    const assignments = await prisma.userSubject.findMany({
      where: {
        userId,
        subject: {
          isDeleted: false,
          isActive: true,
        },
      },
      select: { subjectId: true },
    });

    return assignments.map((assignment) => assignment.subjectId);
  }

  async getAssignedSubjectNames(user) {
    if (this.isAdmin(user)) return null;

    const userId = parseUserId(user);
    if (!Number.isInteger(userId)) return [];

    const assignments = await prisma.userSubject.findMany({
      where: {
        userId,
        subject: {
          isDeleted: false,
          isActive: true,
        },
      },
      select: {
        subject: {
          select: { name: true },
        },
      },
    });

    return assignments
      .map((assignment) => assignment.subject?.name)
      .filter(Boolean);
  }

  async canAccessSubject(user, subjectId) {
    if (this.isAdmin(user)) return true;

    const parsedSubjectId = parseInt(subjectId);
    const userId = parseUserId(user);

    if (!Number.isInteger(userId) || !Number.isInteger(parsedSubjectId)) {
      return false;
    }

    const assignment = await prisma.userSubject.findUnique({
      where: {
        userId_subjectId: {
          userId,
          subjectId: parsedSubjectId,
        },
      },
      select: { userId: true },
    });

    return Boolean(assignment);
  }

  async requireSubjectAccess(user, subjectId) {
    const allowed = await this.canAccessSubject(user, subjectId);
    if (!allowed) {
      const err = new Error("Forbidden: This subject is not assigned to this teacher.");
      err.statusCode = 403;
      throw err;
    }
  }

  assignedSubjectFilter(subjectIds) {
    if (subjectIds === null) return null;
    return subjectIds.length > 0 ? { in: subjectIds } : { in: [-1] };
  }
}

module.exports = new SubjectAccessService();
