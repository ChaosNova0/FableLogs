// OAuth 2 authorization-code flow with PKCE, so no client secret lives in the page.
import { CONFIG } from './config.js';
import { store } from './store.js';

const TOKEN_KEY = 'fl.token';
const CLIENT_KEY = 'fl.clientId';
const PENDING_KEY = 'fl.pkce';

export function getClientId() {
  return CONFIG.clientId || store.get(CLIENT_KEY, '');
}

export function setClientId(id) {
  store.set(CLIENT_KEY, id.trim());
}

// Must match the redirect URL registered on the Warcraft Logs client exactly.
export function redirectUri() {
  return location.origin + location.pathname.replace(/index\.html$/, '');
}

export function getToken() {
  const t = store.get(TOKEN_KEY);
  if (!t || !t.access) return null;
  if (t.expires && Date.now() > t.expires - 60_000) { logout(); return null; }
  return t.access;
}

export function logout() {
  store.remove(TOKEN_KEY);
}

function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function login(returnHash = location.hash) {
  const clientId = getClientId();
  if (!clientId) throw new Error('Set your Warcraft Logs client ID in Settings first.');

  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({ verifier, state, returnHash }));
  } catch {
    throw new Error('This browser is blocking session storage, which login needs.');
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    state,
    code_challenge: b64url(new Uint8Array(digest)),
    code_challenge_method: 'S256',
  });
  location.assign(`${CONFIG.authorizeUrl}?${params}`);
}

// Completes a login if this page load is the OAuth redirect. Returns true when a token was stored.
export async function handleRedirect() {
  const q = new URLSearchParams(location.search);
  if (!q.has('code') && !q.has('error')) return false;

  let pending = null;
  try {
    pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null');
    sessionStorage.removeItem(PENDING_KEY);
  } catch { /* ignore */ }
  history.replaceState(null, '', redirectUri() + (pending?.returnHash || ''));

  // Only act on a callback this tab started. Otherwise a crafted link could show its own "error" text on the
  // page, or try to sign the visitor into someone else's account (login CSRF).
  if (!pending) return false;
  if (pending.state !== q.get('state')) throw new Error('Login state did not match. Please try connecting again.');
  if (q.has('error')) throw new Error(q.get('error') === 'access_denied' ? 'Warcraft Logs login was cancelled.' : `Warcraft Logs login failed (${q.get('error')}).`);

  const res = await fetch(CONFIG.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: getClientId(),
      redirect_uri: redirectUri(),
      code_verifier: pending.verifier,
      code: q.get('code'),
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new Error(body.error_description || body.error || `Token request failed (${res.status}).`);
  }
  store.set(TOKEN_KEY, {
    access: body.access_token,
    expires: body.expires_in ? Date.now() + body.expires_in * 1000 : null,
  });
  return true;
}
