const validateEmail = (email) => {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(String(email).toLowerCase());
};

const validateRegister = (req, res, next) => {
  const { name, email, password, role } = req.body;

  if (!name || typeof name !== "string" || name.trim() === "") {
    return res.status(400).json({ error: "Name is required and must be a valid string." });
  }

  if (!email || !validateEmail(email)) {
    return res.status(400).json({ error: "A valid email address is required." });
  }

  if (!password || typeof password !== "string" || password.length < 6) {
    return res.status(400).json({ error: "Password is required and must be at least 6 characters long." });
  }

  if (role && !["ADMIN", "TEACHER"].includes(role.toUpperCase())) {
    return res.status(400).json({ error: "Role must be ADMIN or TEACHER." });
  }

  next();
};

const validateLogin = (req, res, next) => {
  const { email, password } = req.body;

  if (!email || !validateEmail(email)) {
    return res.status(400).json({ error: "A valid email address is required." });
  }

  if (!password || typeof password !== "string" || password.trim() === "") {
    return res.status(400).json({ error: "Password is required." });
  }

  next();
};

module.exports = {
  validateRegister,
  validateLogin,
};
