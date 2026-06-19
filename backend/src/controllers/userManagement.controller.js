const userManagementService = require("../services/userManagement.service");

class UserManagementController {
  async getAll(req, res, next) {
    try {
      const users = await userManagementService.getAllUsers();
      return res.status(200).json(users);
    } catch (error) {
      next(error);
    }
  }

  async getAuthors(req, res, next) {
    try {
      const authors = await userManagementService.getAuthorsList();
      return res.status(200).json(authors);
    } catch (error) {
      next(error);
    }
  }

  async getById(req, res, next) {
    try {
      const { id } = req.params;
      const user = await userManagementService.getUserById(id);
      return res.status(200).json(user);
    } catch (error) {
      next(error);
    }
  }

  async create(req, res, next) {
    try {
      const { name, email, password, role, subjectIds } = req.body;
      if (!name || !email || !password) {
        return res.status(400).json({ error: "Name, email, and password are required." });
      }

      const user = await userManagementService.createUserByAdmin({
        name,
        email,
        password,
        role,
        subjectIds,
      });

      return res.status(201).json({
        message: "User created successfully",
        user,
      });
    } catch (error) {
      next(error);
    }
  }

  async update(req, res, next) {
    try {
      const { id } = req.params;
      const { name, email, password, subjectIds } = req.body;

      const user = await userManagementService.updateUserProfile(id, {
        name,
        email,
        password,
        subjectIds,
      });

      return res.status(200).json({
        message: "User updated successfully",
        user,
      });
    } catch (error) {
      next(error);
    }
  }

  async disable(req, res, next) {
    try {
      const { id } = req.params;
      // Prevent self-disabling
      if (parseInt(id) === req.user.id) {
        return res.status(400).json({ error: "Self-disabling is forbidden." });
      }

      const user = await userManagementService.disableUser(id);
      return res.status(200).json({
        message: "User deactivated successfully",
        user,
      });
    } catch (error) {
      next(error);
    }
  }

  async activate(req, res, next) {
    try {
      const { id } = req.params;
      const user = await userManagementService.activateUser(id);
      return res.status(200).json({
        message: "User activated successfully",
        user,
      });
    } catch (error) {
      next(error);
    }
  }

  async assignRole(req, res, next) {
    try {
      const { id } = req.params;
      const { role } = req.body;

      if (!role) {
        return res.status(400).json({ error: "Role name is required in body." });
      }

      const user = await userManagementService.assignRole(id, role);
      return res.status(200).json({
        message: `Role '${role}' assigned successfully.`,
        user,
      });
    } catch (error) {
      next(error);
    }
  }

  async removeRole(req, res, next) {
    try {
      const { id, roleName } = req.params;

      if (!roleName) {
        return res.status(400).json({ error: "Role name parameter is required." });
      }

      const user = await userManagementService.removeRole(id, roleName);
      return res.status(200).json({
        message: `Role '${roleName}' removed successfully.`,
        user,
      });
    } catch (error) {
      next(error);
    }
  }

  async delete(req, res, next) {
    try {
      const { id } = req.params;

      // Prevent self-deletion
      if (parseInt(id) === req.user.id) {
        return res.status(400).json({ error: "Self-deletion is forbidden." });
      }

      await userManagementService.deleteUser(id);
      return res.status(200).json({ message: "User deleted successfully" });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new UserManagementController();
