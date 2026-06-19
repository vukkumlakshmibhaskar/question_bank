const checkPermission = (requiredPermission) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized. Please authenticate first." });
    }

    const { permissions } = req.user;

    if (!permissions || !Array.isArray(permissions)) {
      return res.status(403).json({ error: "Access denied. No permissions associated with user." });
    }

    // Admins always bypass permission restrictions
    if (permissions.includes("all") || req.user.role === "ADMIN") {
      return next();
    }

    if (!permissions.includes(requiredPermission)) {
      return res.status(403).json({
        error: `Access denied. You do not have the required permission: '${requiredPermission}'`,
      });
    }

    next();
  };
};

module.exports = checkPermission;
