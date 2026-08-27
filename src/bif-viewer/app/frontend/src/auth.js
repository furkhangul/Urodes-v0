const USERINFO_PATH = "/oauth2/userinfo";

let authState = {
  user: "unknown",
  email: null,
  groups: [],
};

const tokenRefreshListeners = new Set();

export async function initAuth() {
  const response = await fetch(USERINFO_PATH, { credentials: "include" });
  if (!response.ok) {
    window.location.assign(`/oauth2/sign_in?rd=${encodeURIComponent(window.location.href)}`);
    return null;
  }

  const info = await response.json();
  authState = normalizeUserInfo(info);
  installFetchInterceptor();
  return authState;
}

export function onTokenRefresh(listener) {
  tokenRefreshListeners.add(listener);
  return () => tokenRefreshListeners.delete(listener);
}

function installFetchInterceptor() {
  const originalFetch = window.fetch.bind(window);
  window.fetch = (url, options = {}) => {
    const urlStr =
      typeof url === "string"
        ? url
        : url instanceof URL
          ? url.toString()
          : url?.url ?? "";
    if (urlStr.startsWith("/api/") || urlStr.startsWith("/bif-viewer/api/")) {
      options = {
        credentials: "same-origin",
        ...options,
        headers: {
          ...(options.headers || {}),
        },
      };
    }
    return originalFetch(url, options);
  };
}

function normalizeUserInfo(info = {}) {
  const groups = Array.isArray(info.groups)
    ? info.groups.map((g) => String(g).replace(/^\//, ""))
    : [];
  return {
    user:
      info.preferred_username ??
      info.user ??
      info.email ??
      info.sub ??
      "unknown",
    email: info.email ?? null,
    groups,
  };
}

export function getUserInfo() {
  return {
    username: authState.user,
    email: authState.email,
    roles: authState.groups,
  };
}

export function hasRole(role) {
  const normalized = String(role).replace(/^ROLE_/, "").toLowerCase();
  if (normalized === "master") {
    return authState.groups.includes("bif-master") || authState.groups.includes("gateway-admin");
  }
  if (normalized === "viewer") {
    return authState.groups.includes("bif-viewer") || authState.groups.includes("bif-master") || authState.groups.includes("gateway-admin");
  }
  return authState.groups.includes(normalized);
}

export function getAccessToken() {
  // Gateway-centered auth: browser does not manage an access token.
  return "";
}

export function logout() {
  const redirectUri = `${window.location.origin}/bif-viewer/`;
  window.location.assign(`/oauth2/sign_out?rd=${encodeURIComponent(redirectUri)}`);
}

export default {
  get token() {
    return "";
  },
  get tokenParsed() {
    return {
      preferred_username: authState.user,
      email: authState.email,
      realm_access: { roles: authState.groups },
    };
  },
  hasRealmRole: hasRole,
};
