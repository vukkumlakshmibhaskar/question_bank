import { defineStore } from "pinia";
import api from "../services/api";

const parseStoredUser = () => {
  try {
    return JSON.parse(localStorage.getItem("user")) || null;
  } catch {
    localStorage.removeItem("user");
    return null;
  }
};

const decodeTokenPayload = (token) => {
  if (!token) return null;

  try {
    const payload = token.split(".")[1];
    if (!payload) return null;

    const normalizedPayload = payload.replace(/-/g, "+").replace(/_/g, "/");
    const paddedPayload = normalizedPayload.padEnd(
      normalizedPayload.length + ((4 - (normalizedPayload.length % 4)) % 4),
      "="
    );
    const json = atob(paddedPayload);
    return JSON.parse(json);
  } catch {
    return null;
  }
};

const normalizeRole = (role) => {
  if (!role) return null;
  if (typeof role === "object") return normalizeRole(role.name);
  return String(role).trim().toUpperCase();
};

const getUserRole = (user) => {
  return normalizeRole(
    user?.role ||
      user?.roleName ||
      user?.userRole ||
      user?.roles?.[0]?.name ||
      user?.roles?.[0] ||
      user?.userRoles?.[0]?.role?.name
  );
};

const normalizeUser = (user, tokenPayload = null) => {
  const baseUser = user || tokenPayload;
  if (!baseUser) return null;

  const role = getUserRole(baseUser) || getUserRole(tokenPayload);
  const permissions = baseUser.permissions || tokenPayload?.permissions || [];

  return {
    ...baseUser,
    ...(role ? { role } : {}),
    permissions: Array.isArray(permissions) ? permissions : [],
  };
};

export const useAuthStore = defineStore("auth", {
  state: () => ({
    user: normalizeUser(parseStoredUser(), decodeTokenPayload(localStorage.getItem("accessToken"))),
    accessToken: localStorage.getItem("accessToken") || null,
    refreshTokenValue: localStorage.getItem("refreshToken") || null,
    loading: false,
    error: null,
  }),

  getters: {
    isAuthenticated: (state) => !!state.accessToken,
    userRole: (state) => getUserRole(state.user) || getUserRole(decodeTokenPayload(state.accessToken)),
  },

  actions: {
    clearSession() {
      this.user = null;
      this.accessToken = null;
      this.refreshTokenValue = null;
      this.error = null;

      localStorage.removeItem("user");
      localStorage.removeItem("accessToken");
      localStorage.removeItem("refreshToken");
    },

    hydrateUserFromToken() {
      const tokenPayload = decodeTokenPayload(this.accessToken);
      const normalizedUser = normalizeUser(this.user, tokenPayload);

      if (normalizedUser) {
        this.user = normalizedUser;
        localStorage.setItem("user", JSON.stringify(normalizedUser));
      }
    },

    async login(email, password) {
      this.loading = true;
      this.error = null;
      try {
        const response = await api.post("/auth/login", { email, password });
        const { user, accessToken, refreshToken } = response.data;
        const normalizedUser = normalizeUser(user, decodeTokenPayload(accessToken));

        this.user = normalizedUser;
        this.accessToken = accessToken;
        this.refreshTokenValue = refreshToken;

        // Persist session tokens
        localStorage.setItem("user", JSON.stringify(normalizedUser));
        localStorage.setItem("accessToken", accessToken);
        localStorage.setItem("refreshToken", refreshToken);

        return user;
      } catch (err) {
        this.error = err.response?.data?.error || "Login failed. Please try again.";
        throw err;
      } finally {
        this.loading = false;
      }
    },

    async logout() {
      this.loading = true;
      const accessToken = this.accessToken;
      const userId = this.user?.id;
      this.clearSession();

      try {
        // Call backend logout endpoint with the token saved before local cleanup.
        if (accessToken) {
          await api.post(
            "/auth/logout",
            { userId },
            {
              headers: {
                Authorization: `Bearer ${accessToken}`,
              },
              skipAuthRefresh: true,
            }
          );
        }
      } catch (err) {
        console.error("Logout API failed after client session clear:", err);
      } finally {
        this.loading = false;
      }
    },

    async refreshSession() {
      if (!this.refreshTokenValue) {
        throw new Error("No refresh token available");
      }

      try {
        const response = await api.post("/auth/refresh", {
          refreshToken: this.refreshTokenValue,
        });
        const { user, accessToken, refreshToken } = response.data;
        const normalizedUser = normalizeUser(user, decodeTokenPayload(accessToken));

        this.user = normalizedUser;
        this.accessToken = accessToken;
        this.refreshTokenValue = refreshToken;

        localStorage.setItem("user", JSON.stringify(normalizedUser));
        localStorage.setItem("accessToken", accessToken);
        localStorage.setItem("refreshToken", refreshToken);

        return accessToken;
      } catch (err) {
        this.clearSession();
        throw err;
      }
    },

    async forgotPassword(email) {
      this.loading = true;
      this.error = null;
      try {
        // Send reset request to api (mocked or actual server endpoint)
        // Since we are simulating standard recovery behavior:
        await api.post("/auth/forgot-password", { email }).catch((err) => {
          // If the endpoint is not yet defined on the backend, mock success for demonstration
          if (err.response && err.response.status === 404) {
            return new Promise((resolve) => setTimeout(resolve, 800));
          }
          throw err;
        });
      } catch (err) {
        this.error = err.response?.data?.error || "Reset password request failed.";
        throw err;
      } finally {
        this.loading = false;
      }
    },
  },
});
