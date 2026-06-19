const prisma = require("../config/prisma");

class UserManagementRepository {
  async getAll() {
    return prisma.user.findMany({
      where: { isDeleted: false },
      select: {
        id: true,
        name: true,
        email: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        userRoles: {
          where: { isDeleted: false },
          include: {
            role: true,
          },
        },
        assignedSubjects: {
          include: {
            subject: {
              select: { id: true, name: true },
            },
          },
        },
      },
    });
  }

  async getAuthors() {
    return prisma.user.findMany({
      where: { isDeleted: false, isActive: true },
      select: {
        id: true,
        name: true,
        email: true,
      },
      orderBy: { name: "asc" },
    });
  }

  async findById(id) {
    return prisma.user.findFirst({
      where: { id: parseInt(id), isDeleted: false },
      select: {
        id: true,
        name: true,
        email: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        userRoles: {
          where: { isDeleted: false },
          include: {
            role: true,
          },
        },
        assignedSubjects: {
          include: {
            subject: {
              select: { id: true, name: true },
            },
          },
        },
      },
    });
  }

  async countActiveSubjectsByIds(subjectIds) {
    return prisma.subject.count({
      where: {
        id: { in: subjectIds },
        isDeleted: false,
        isActive: true,
      },
    });
  }

  async setUserSubjects(userId, subjectIds = []) {
    const parsedUserId = parseInt(userId);
    const parsedSubjectIds = [...new Set(
      (subjectIds || [])
        .map((id) => parseInt(id))
        .filter((id) => Number.isInteger(id) && id > 0)
    )];

    return prisma.$transaction(async (tx) => {
      await tx.userSubject.deleteMany({
        where: { userId: parsedUserId },
      });

      if (parsedSubjectIds.length > 0) {
        await tx.userSubject.createMany({
          data: parsedSubjectIds.map((subjectId) => ({
            userId: parsedUserId,
            subjectId,
          })),
          skipDuplicates: true,
        });
      }
    });
  }

  async delete(id) {
    // Soft delete
    return prisma.user.update({
      where: { id: parseInt(id) },
      data: {
        isDeleted: true,
        deletedAt: new Date(),
        isActive: false,
      },
    });
  }

  async updateUser(id, updateData) {
    return prisma.user.update({
      where: { id: parseInt(id) },
      data: updateData,
      select: {
        id: true,
        name: true,
        email: true,
      },
    });
  }

  async disableUser(id) {
    return prisma.user.update({
      where: { id: parseInt(id) },
      data: { isActive: false },
    });
  }

  async activateUser(id) {
    return prisma.user.update({
      where: { id: parseInt(id) },
      data: { isActive: true },
    });
  }

  async assignRole(userId, roleName) {
    const roleObj = await prisma.role.findUnique({
      where: { name: roleName.toUpperCase() },
    });

    if (!roleObj) {
      throw new Error(`Role '${roleName}' does not exist.`);
    }

    return prisma.userRole.upsert({
      where: {
        userId_roleId: {
          userId: parseInt(userId),
          roleId: roleObj.id,
        },
      },
      update: { isDeleted: false, deletedAt: null, isActive: true },
      create: {
        userId: parseInt(userId),
        roleId: roleObj.id,
      },
    });
  }

  async removeRole(userId, roleName) {
    const roleObj = await prisma.role.findUnique({
      where: { name: roleName.toUpperCase() },
    });

    if (!roleObj) {
      throw new Error(`Role '${roleName}' does not exist.`);
    }

    // Soft delete on the join table relation
    return prisma.userRole.update({
      where: {
        userId_roleId: {
          userId: parseInt(userId),
          roleId: roleObj.id,
        },
      },
      data: {
        isDeleted: true,
        deletedAt: new Date(),
        isActive: false,
      },
    });
  }
}

module.exports = new UserManagementRepository();
