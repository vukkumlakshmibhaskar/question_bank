const trimTrailingSlash = (value = '') => value.replace(/\/+$/, '');

export const qbankApiBase = () => trimTrailingSlash(
  import.meta.env.VITE_QBANK_API_URL ||
  window.__QBANK_API_BASE__ ||
  'http://localhost:5000/api'
);

export const qbankWorkflowBase = (service) => `${qbankApiBase()}/extraction/${service}`;

const getAccessToken = () => {
  try {
    return window.localStorage.getItem('accessToken') || '';
  } catch {
    return '';
  }
};

export const withQBankAccessToken = (url) => {
  const token = getAccessToken();
  if (!token) return url;

  const nextUrl = new URL(url, window.location.origin);
  nextUrl.searchParams.set('access_token', token);
  return nextUrl.toString();
};

export const qbankApiAssetUrl = (apiBase, pathOrUrl) => {
  const apiRoot = trimTrailingSlash(apiBase);
  if (!pathOrUrl) return withQBankAccessToken(apiRoot);

  let normalizedPath = String(pathOrUrl);
  try {
    const parsedPath = new URL(normalizedPath, window.location.origin);
    normalizedPath = `${parsedPath.pathname}${parsedPath.search}${parsedPath.hash}`;
  } catch {
    normalizedPath = String(pathOrUrl);
  }

  try {
    const apiRootPath = new URL(apiRoot, window.location.origin).pathname.replace(/\/+$/, '');
    if (normalizedPath === apiRootPath) {
      normalizedPath = '';
    } else if (normalizedPath.startsWith(`${apiRootPath}/`)) {
      normalizedPath = normalizedPath.slice(apiRootPath.length);
    }
  } catch {
    // If apiBase is unusual, keep the original path and still add the token below.
  }

  if (normalizedPath && !normalizedPath.startsWith('/')) {
    normalizedPath = `/${normalizedPath}`;
  }

  return withQBankAccessToken(`${apiRoot}${normalizedPath}`);
};

export const withQBankAuth = (options = {}) => {
  const token = getAccessToken();
  if (!token) return options;

  const headers = new Headers(options.headers || {});
  if (!headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  return {
    ...options,
    headers,
  };
};

export const qbankFetch = (url, options = {}) => fetch(url, withQBankAuth(options));

export const installQBankAxiosAuth = (axiosInstance) => {
  if (axiosInstance.__qbankAuthInstalled) return;

  axiosInstance.interceptors.request.use((config) => {
    const token = getAccessToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  });

  axiosInstance.__qbankAuthInstalled = true;
};
