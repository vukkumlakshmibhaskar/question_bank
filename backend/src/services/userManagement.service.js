const bcrypt = require("bcrypt");
const userManagementRepository = require("../repositories/userManagement.repository");
const userRepository = require("../repositories/user.repository");

const ALLOWED_ROLES = new Set(["ADMIN", "TEACHER"]);

class UserManagementService {
  formatUser(u) {
    if (!u) return null;
    const roles = u.userRoles?.map((ur) => ur.role?.name).filter(Boolean) || [];
    const subjects = (u.assignedSubjects || [])
      .map((assignment) => assignment.subject)
      .filter(Boolean);
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      roles,
      subjectIds: subjects.map((subject) => subject.id),
      subjects,
      isActive: u.isActive,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
    };
  }

  async getAllUsers() {
    const users = await userManagementRepository.getAll();
    return users.map((u) => this.formatUser(u));
  }

  async getAuthorsList() {
    return userManagementRepository.getAuthors();
  }

  async getUserById(userId) {
    const user = await userManagementRepository.findById(userId);
    if (!user) {
      const err = new Error("User not found");
      err.statusCode = 404;
      throw err;
    }
    return this.formatUser(user);
  }

  normalizeRole(role = "TEACHER") {
    const normalizedRole = String(role || "TEACHER").trim().toUpperCase();
    if (!ALLOWED_ROLES.has(normalizedRole)) {
      const err = new Error("Role must be ADMIN or TEACHER.");
      err.statusCode = 400;
      throw err;
    }
    return normalizedRole;
  }

  normalizeSubjectIds(subjectIds = []) {
    if (!Array.isArray(subjectIds)) return [];
    return [...new Set(
      subjectIds
        .map((id) => parseInt(id))
        .filter((id) => Number.isInteger(id) && id > 0)
    )];
  }

  async validateTeacherSubjects(role, subjectIds) {
    if (role !== "TEACHER") return [];

    const normalizedSubjectIds = this.normalizeSubjectIds(subjectIds);
    if (normalizedSubjectIds.length === 0) {
      const err = new Error("At least one subject must be assigned to a teacher.");
      err.statusCode = 400;
      throw err;
    }

    const existingCount = await userManagementRepository.countActiveSubjectsByIds(normalizedSubjectIds);
    if (existingCount !== normalizedSubjectIds.length) {
      const err = new Error("One or more selected subjects are unavailable.");
      err.statusCode = 400;
      throw err;
    }

    return normalizedSubjectIds;
  }

  async createUserByAdmin({ name, email, password, role = "TEACHER", subjectIds = [] }) {
    const normalizedRole = this.normalizeRole(role);
    const teacherSubjectIds = await this.validateTeacherSubjects(normalizedRole, subjectIds);

    const existingUser = await userRepository.findByEmail(email);
    if (existingUser) {
      const err = new Error("Email is already registered");
      err.statusCode = 400;
      throw err;
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await userRepository.create(
      { name, email, password: hashedPassword },
      normalizedRole
    );

    if (normalizedRole === "TEACHER") {
      await userManagementRepository.setUserSubjects(newUser.id, teacherSubjectIds);
    }

    const fullUser = await userManagementRepository.findById(newUser.id);
    return this.formatUser(fullUser);
  }

  async updateUserProfile(userId, { name, email, password, subjectIds }) {
    const user = await userManagementRepository.findById(userId);
    if (!user) {
      const err = new Error("User not found");
      err.statusCode = 404;
      throw err;
    }

    let teacherSubjectIds = null;
    if (subjectIds !== undefined) {
      const roles = user.userRoles?.map((ur) => ur.role?.name).filter(Boolean) || [];
      if (!roles.includes("TEACHER")) {
        const err = new Error("Subjects can only be assigned to teacher accounts.");
        err.statusCode = 400;
        throw err;
      }

      teacherSubjectIds = await this.validateTeacherSubjects("TEACHER", subjectIds);
    }

    const updateData = {};
    if (name) updateData.name = name;
    if (email) {
      if (email !== user.email) {
        const check = await userRepository.findByEmail(email);
        if (check) {
          const err = new Error("Email already in use");
          err.statusCode = 400;
          throw err;
        }
      }
      updateData.email = email;
    }

    if (password) {
      updateData.password = await bcrypt.hash(password, 10);
    }

    if (Object.keys(updateData).length > 0) {
      await userManagementRepository.updateUser(userId, updateData);
    }

    if (teacherSubjectIds !== null) {
      await userManagementRepository.setUserSubjects(userId, teacherSubjectIds);
    }

    const updatedUser = await userManagementRepository.findById(userId);
    return this.formatUser(updatedUser);
  }

  async disableUser(userId) {
    const user = await userManagementRepository.findById(userId);
    if (!user) {
      const err = new Error("User not found");
      err.statusCode = 404;
      throw err;
    }
    await userManagementRepository.disableUser(userId);
    const fullUser = await userManagementRepository.findById(userId);
    return this.formatUser(fullUser);
  }

  async activateUser(userId) {
    const user = await userRepository.findById(userId);
    if (!user) {
      const err = new Error("User not found");
      err.statusCode = 404;
      throw err;
    }
    await userManagementRepository.activateUser(userId);
    const fullUser = await userManagementRepository.findById(userId);
    return this.formatUser(fullUser);
  }

  async assignRole(userId, roleName) {
    const normalizedRole = this.normalizeRole(roleName);
    const user = await userManagementRepository.findById(userId);
    if (!user) {
      const err = new Error("User not found");
      err.statusCode = 404;
      throw err;
    }
    await userManagementRepository.assignRole(userId, normalizedRole);
    const fullUser = await userManagementRepository.findById(userId);
    return this.formatUser(fullUser);
  }

  async removeRole(userId, roleName) {
    const normalizedRole = this.normalizeRole(roleName);
    const user = await userManagementRepository.findById(userId);
    if (!user) {
      const err = new Error("User not found");
      err.statusCode = 404;
      throw err;
    }
    await userManagementRepository.removeRole(userId, normalizedRole);
    const fullUser = await userManagementRepository.findById(userId);
    return this.formatUser(fullUser);
  }

  async deleteUser(userId) {
    const user = await userManagementRepository.findById(userId);
    if (!user) {
      const err = new Error("User not found");
      err.statusCode = 404;
      throw err;
    }
    await userManagementRepository.delete(userId);
    return { success: true };
  }
}

module.exports = new UserManagementService();
