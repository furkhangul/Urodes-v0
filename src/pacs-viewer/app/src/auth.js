const USERINFO_PATH = "/oauth2/userinfo";

export function logout() {
  const origin = window.location.origin;
  const appReturn = `${origin}/pacs-viewer/`;
  const signInUrl = `${origin}/oauth2/sign_in?rd=${encodeURIComponent(appReturn)}`;
  window.location.replace(
    `${origin}/oauth2/sign_out?rd=${encodeURIComponent(signInUrl)}`
  );
}

export async function fetchUserInfo() {
  const response = await fetch(USERINFO_PATH, { credentials: "include" });
  if (!response.ok) {
    return null;
  }
  return response.json();
}

export function resolveRoleLabel(groups = []) {
  if (groups.includes("pacs-admin")) {
    return { label: "admin", className: "role-admin" };
  }
  if (groups.includes("pacs-viewer")) {
    return { label: "viewer", className: "role-viewer" };
  }
  return { label: "user", className: "role-viewer" };
}
