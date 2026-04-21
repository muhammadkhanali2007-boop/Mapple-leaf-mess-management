/**
 * Role for client-side routing: prefers persisted user object, falls back to JWT payload.
 * JWTs use base64url; browser atob() needs standard base64 (+ padding).
 */
function parseJwtPayload(token) {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    let b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    return JSON.parse(atob(b64));
  } catch {
    return null;
  }
}

export function getStoredRole() {
  try {
    const raw = localStorage.getItem("user");
    if (raw) {
      const role = JSON.parse(raw)?.role;
      if (role) return role;
    }
  } catch {
    /* ignore */
  }
  const token = localStorage.getItem("token");
  if (!token) return null;
  const payload = parseJwtPayload(token);
  return payload?.role ?? null;
}
