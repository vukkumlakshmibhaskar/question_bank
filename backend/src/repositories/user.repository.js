const prisma = require("../config/prisma");

class UserRepository {
  async findByEmail(email) {
    return prisma.user.findUnique({
      where: { email },
      include: {
        userRoles: {
          where: { isDeleted: false, isActive: true },
          include: {
            role: {
              include: {
                rolePermissions: {
                  include: {
                    permission: true,
                  },
                },
              },
            },
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

  async findById(id) {
    return prisma.user.findUnique({
      where: { id: parseInt(id) },
      include: {
        userRoles: {
          where: { isDeleted: false, isActive: true },
          include: {
            role: {
              include: {
                rolePermissions: {
                  include: {
                    permission: true,
                  },
                },
              },
            },
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

  async create(userData, roleName = "TEACHER") {
    // Standardize roleName to uppercase
    const uppercaseRole = roleName.toUpperCase();
    
    const roleObj = await prisma.role.findUnique({
      where: { name: uppercaseRole },
    });

    if (!roleObj) {
      const err = new Error(`Role '${uppercaseRole}' does not exist.`);
      err.statusCode = 400;
      throw err;
    }

    return prisma.$transaction(async (tx) => {
      // 1. Create User
      const newUser = await tx.user.create({
        data: {
          name: userData.name,
          email: userData.email,
          password: userData.password,
        },
      });

      // 2. Link to Role
      await tx.userRole.create({
        data: {
          userId: newUser.id,
          roleId: roleObj.id,
        },
      });

      // 3. Return full user details
      return tx.user.findUnique({
        where: { id: newUser.id },
        include: {
          userRoles: {
            where: { isDeleted: false, isActive: true },
            include: {
              role: {
                include: {
                  rolePermissions: {
                    include: {
                      permission: true,
                    },
                  },
                },
              },
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
    });
  }

  async updateRefreshToken(id, refreshToken) {
    return prisma.user.update({
      where: { id: parseInt(id) },
      data: { refreshToken },
    });
  }

  async clearRefreshToken(id) {
    return prisma.user.update({
      where: { id: parseInt(id) },
      data: { refreshToken: null },
    });
  }
}

module.exports = new UserRepository();
