const authService = require("../services/auth.service");

class AuthController {
  async register(req, res) {
    try {
      const { name, email, password, role } = req.body;
      const result = await authService.register({ name, email, password, role });

      // In production, you might also set the refresh token as an HttpOnly cookie:
      // res.cookie('refreshToken', result.refreshToken, { httpOnly: true, secure: true, sameSite: 'strict' });

      return res.status(201).json({
        message: "User registered successfully",
        user: result.user,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken, // Included in body for flexible client integration
      });
    } catch (error) {
      const statusCode = error.statusCode || 500;
      return res.status(statusCode).json({ error: error.message || "Internal server error" });
    }
  }

  async login(req, res) {
    try {
      const { email, password } = req.body;
      const result = await authService.login(email, password);

      return res.status(200).json({
        message: "Login successful",
        user: result.user,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
      });
    } catch (error) {
      const statusCode = error.statusCode || 500;
      return res.status(statusCode).json({ error: error.message || "Internal server error" });
    }
  }

  async logout(req, res) {
    try {
      // The user ID can come from the authenticated request object (via auth middleware)
      // or we can decode the refresh token if they pass it.
      const userId = req.user?.id || req.body.userId;
      
      if (!userId) {
        return res.status(400).json({ error: "User ID is required for logging out." });
      }

      await authService.logout(userId);

      return res.status(200).json({
        message: "Logged out successfully",
      });
    } catch (error) {
      const statusCode = error.statusCode || 500;
      return res.status(statusCode).json({ error: error.message || "Internal server error" });
    }
  }

  async refresh(req, res) {
    try {
      const { refreshToken } = req.body;
      
      if (!refreshToken) {
        return res.status(400).json({ error: "Refresh token is required." });
      }

      const result = await authService.refresh(refreshToken);

      return res.status(200).json({
        message: "Token refreshed successfully",
        user: result.user,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
      });
    } catch (error) {
      const statusCode = error.statusCode || 500;
      return res.status(statusCode).json({ error: error.message || "Internal server error" });
    }
  }
}

module.exports = new AuthController();
