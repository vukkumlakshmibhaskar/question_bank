const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const userRepository = require("../repositories/user.repository");

const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || "default_access_secret_123!@#";
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "default_refresh_secret_456$%^";
const JWT_ACCESS_EXPIRY = process.env.JWT_ACCESS_EXPIRY || "15m";
const JWT_REFRESH_EXPIRY = process.env.JWT_REFRESH_EXPIRY || "7d";

class AuthService {
  // Flat-extract role and permissions from nested user structure
  extractRoleAndPermissions(user) {
    const roles = (user.userRoles || [])
      .map((userRole) => userRole.role?.name)
      .filter(Boolean);
    const rolePriority = ["ADMIN", "TEACHER"];
    const role = rolePriority.find((roleName) => roles.includes(roleName)) || roles[0] || "TEACHER";
    const permissions = [];
    
    user.userRoles?.forEach((ur) => {
      ur.role?.rolePermissions?.forEach((rp) => {
        if (rp.permission && !permissions.includes(rp.permission.name)) {
          permissions.push(rp.permission.name);
        }
      });
    });

    return { role, permissions };
  }

  generateTokens(user) {
    const { role, permissions } = this.extractRoleAndPermissions(user);
    const subjectIds = (user.assignedSubjects || [])
      .map((assignment) => assignment.subjectId || assignment.subject?.id)
      .filter(Boolean);

    const payload = {
      id: user.id,
      email: user.email,
      role,
      permissions,
      name: user.name,
      subjectIds,
    };

    const accessToken = jwt.sign(payload, JWT_ACCESS_SECRET, {
      expiresIn: JWT_ACCESS_EXPIRY,
    });

    const refreshToken = jwt.sign({ id: user.id }, JWT_REFRESH_SECRET, {
      expiresIn: JWT_REFRESH_EXPIRY,
    });

    return { accessToken, refreshToken };
  }

  async register({ name, email, password, role = "TEACHER" }) {
    const existingUser = await userRepository.findByEmail(email);
    if (existingUser) {
      const err = new Error("Email is already registered");
      err.statusCode = 400;
      throw err;
    }

    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Save to DB and map roles/permissions in transaction
    const newUser = await userRepository.create({
      name,
      email,
      password: hashedPassword,
    }, role);

    const { accessToken, refreshToken } = this.generateTokens(newUser);
    await userRepository.updateRefreshToken(newUser.id, refreshToken);

    const { role: userRole, permissions } = this.extractRoleAndPermissions(newUser);
    const subjects = (newUser.assignedSubjects || [])
      .map((assignment) => assignment.subject)
      .filter(Boolean);

    return {
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        role: userRole,
        permissions,
        subjectIds: subjects.map((subject) => subject.id),
        subjects,
        createdAt: newUser.createdAt,
      },
      accessToken,
      refreshToken,
    };
  }

  async login(email, password) {
    const user = await userRepository.findByEmail(email);
    if (!user) {
      const err = new Error("Invalid email or password");
      err.statusCode = 401;
      throw err;
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      const err = new Error("Invalid email or password");
      err.statusCode = 401;
      throw err;
    }

    if (!user.isActive) {
      const err = new Error("Your account has been deactivated. Please contact an administrator.");
      err.statusCode = 403;
      throw err;
    }

    const { accessToken, refreshToken } = this.generateTokens(user);
    await userRepository.updateRefreshToken(user.id, refreshToken);

    const { role, permissions } = this.extractRoleAndPermissions(user);
    const subjects = (user.assignedSubjects || [])
      .map((assignment) => assignment.subject)
      .filter(Boolean);

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role,
        permissions,
        subjectIds: subjects.map((subject) => subject.id),
        subjects,
        createdAt: user.createdAt,
      },
      accessToken,
      refreshToken,
    };
  }

  async logout(userId) {
    await userRepository.clearRefreshToken(userId);
    return { success: true };
  }

  async refresh(refreshToken) {
    if (!refreshToken) {
      const err = new Error("Refresh token required");
      err.statusCode = 400;
      throw err;
    }

    try {
      const decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
      const user = await userRepository.findById(decoded.id);

      if (!user) {
        const err = new Error("User not found");
        err.statusCode = 401;
        throw err;
      }

      if (!user.isActive) {
        const err = new Error("Your account has been deactivated.");
        err.statusCode = 403;
        throw err;
      }

      if (user.refreshToken !== refreshToken) {
        const err = new Error("Invalid or revoked refresh token");
        err.statusCode = 401;
        throw err;
      }

      const tokens = this.generateTokens(user);
      await userRepository.updateRefreshToken(user.id, tokens.refreshToken);

      const { role, permissions } = this.extractRoleAndPermissions(user);
      const subjects = (user.assignedSubjects || [])
        .map((assignment) => assignment.subject)
        .filter(Boolean);

      return {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role,
          permissions,
          subjectIds: subjects.map((subject) => subject.id),
          subjects,
        },
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      };
    } catch (error) {
      const err = new Error(error.message || "Invalid refresh token");
      err.statusCode = 401;
      throw err;
    }
  }
}

module.exports = new AuthService();
