import { createAuthClient } from "better-auth/client";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";

window.siteAuthClient = createAuthClient({
  baseURL: `${window.location.origin}/api/auth`,
  plugins: [oauthProviderClient()]
});
