import axios from "axios";
import { useAuthStore } from "../stores/auth";
import { createTraceId, getCurrentClientRoute, reportApiNetworkError } from "./telescopeClient";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:5000/api",
  headers: {
    "Content-Type": "application/json",
  },
});

// Request Interceptor: Attach access token & google tokens
api.interceptors.request.use(
  (config) => {
    const authStore = useAuthStore();
    config.headers = config.headers || {};
    const traceId = config.headers?.["x-trace-id"] || createTraceId();
    const clientRoute = getCurrentClientRoute();

    config.metadata = {
      ...(config.metadata || {}),
      traceId,
      clientRoute,
      startedAt: Date.now(),
    };

    config.headers["x-trace-id"] = traceId;
    config.headers["x-client-route"] = clientRoute;

    if (authStore.accessToken) {
      config.headers.Authorization = `Bearer ${authStore.accessToken}`;
    }
    
    const googleAccess = localStorage.getItem("google_access_token");
    const googleRefresh = localStorage.getItem("google_refresh_token");
    if (googleAccess) {
      config.headers["x-google-access-token"] = googleAccess;
    }
    if (googleRefresh) {
      config.headers["x-google-refresh-token"] = googleRefresh;
    }
    
    return config;
  },
  (error) => Promise.reject(error)
);

// Response Interceptor: Handle token expiration
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    const isTelemetryRequest = originalRequest?.url?.includes("/telescope/frontend-errors");
    
    if (!error.response && !isTelemetryRequest) {
      reportApiNetworkError(error);
    }

    const isAuthRequest = originalRequest?.url && (
      originalRequest.url.includes("/auth/login") ||
      originalRequest.url.includes("/auth/refresh") ||
      originalRequest.url.includes("/auth/forgot-password") ||
      originalRequest.url.includes("/auth/logout")
    );
    
    if (
      error.response &&
      error.response.status === 401 &&
      !originalRequest._retry &&
      !isAuthRequest &&
      !originalRequest.skipAuthRefresh
    ) {
      originalRequest._retry = true;
      const authStore = useAuthStore();
      
      try {
        await authStore.refreshSession();
        originalRequest.headers.Authorization = `Bearer ${authStore.accessToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        authStore.clearSession();
        window.location.href = "/login?expired=true";
        return Promise.reject(refreshError);
      }
    }
    
    return Promise.reject(error);
  }
);

export default api;
