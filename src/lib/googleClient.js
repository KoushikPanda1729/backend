import { google } from "googleapis";
import { prisma } from "./prisma.js";

const SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/userinfo.email",
];

export function newOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

export function getAuthUrl() {
  const client = newOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent select_account",
    scope: SCOPES,
  });
}

// Exchanges the OAuth code and upserts by email — connecting the same account again just refreshes its tokens,
// connecting a different Google account adds a new row alongside the existing ones.
export async function saveTokensFromCode(code) {
  const client = newOAuthClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  const oauth2 = google.oauth2({ auth: client, version: "v2" });
  const { data: profile } = await oauth2.userinfo.get();
  if (!profile.email) throw new Error("Could not read the Google account's email");

  await prisma.googleAuth.upsert({
    where: { email: profile.email },
    create: {
      email: profile.email,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiryDate: BigInt(tokens.expiry_date || 0),
    },
    update: {
      accessToken: tokens.access_token,
      // Google only sends refresh_token on first consent — keep the existing one on re-auth.
      ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
      expiryDate: BigInt(tokens.expiry_date || 0),
    },
  });

  return profile.email;
}

export async function listAccounts() {
  const rows = await prisma.googleAuth.findMany({ select: { id: true, email: true }, orderBy: { createdAt: "asc" } });
  return rows;
}

export async function disconnectAccount(id) {
  await prisma.googleAuth.delete({ where: { id } }).catch(() => {});
}

// Returns a live, valid access token for one connected account — refreshes and persists if expired.
export async function getValidAccessToken(accountId) {
  const row = await prisma.googleAuth.findUnique({ where: { id: accountId } });
  if (!row) throw new Error("That Google account is not connected");

  const client = newOAuthClient();
  client.setCredentials({ access_token: row.accessToken, refresh_token: row.refreshToken, expiry_date: Number(row.expiryDate) });

  const isExpired = Number(row.expiryDate) < Date.now() + 60_000;
  if (isExpired) {
    const { credentials } = await client.refreshAccessToken();
    await prisma.googleAuth.update({
      where: { id: accountId },
      data: { accessToken: credentials.access_token, expiryDate: BigInt(credentials.expiry_date || 0) },
    });
    return credentials.access_token;
  }
  return row.accessToken;
}

export async function getAuthorizedClient(accountId) {
  const accessToken = await getValidAccessToken(accountId);
  const client = newOAuthClient();
  client.setCredentials({ access_token: accessToken });
  return client;
}
