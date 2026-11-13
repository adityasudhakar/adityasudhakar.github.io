import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { jwt } from "better-auth/plugins";
import { mcp } from "@better-auth/mcp";
import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { Pool } from "pg";

const baseUrl = process.env.PUBLIC_BASE_URL;
const resource = `${baseUrl}/mcp`;
const ownerEmail = (process.env.MCP_OWNER_EMAIL || "").trim().toLowerCase();
const authPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false },
  options: "-c search_path=auth",
  max: 4
});

export const auth = betterAuth({
  appName: "Aditya Site Analytics",
  baseURL: `${baseUrl}/api/auth`,
  basePath: "/api/auth",
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: [baseUrl],
  database: authPool,
  disabledPaths: ["/token"],
  emailAndPassword: { enabled: false },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
      scope: ["openid", "email", "profile"]
    }
  },
  account: {
    accountLinking: { enabled: true, trustedProviders: ["google"] }
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          if (!ownerEmail || user.email?.trim().toLowerCase() !== ownerEmail) {
            throw new APIError("FORBIDDEN", { message: "This analytics MCP is restricted to its owner." });
          }
          return { data: user };
        }
      }
    }
  },
  plugins: [
    jwt({ disableSettingJwtHeader: true }),
    mcp({
      loginPage: "/sign-in",
      consentPage: "/consent",
      resource,
      scopes: ["openid", "profile", "email", "offline_access", "mcp:read"]
    }),
    cimd({
      fetchClientMetadataResource,
      metadataProfile: "mcp-2026-07-28"
    })
  ]
});

export const mcpResource = resource;
