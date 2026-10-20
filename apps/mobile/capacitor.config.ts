import type { CapacitorConfig } from "@capacitor/cli";

// The shell loads the live site, so web releases reach the apps at once (see docs/RELEASE-POLICY.md).
// NEO_FM_SHELL_URL points a debug build at a preview deployment.
const url = process.env.NEO_FM_SHELL_URL ?? "https://www.neo-fm.com";

const config: CapacitorConfig = {
  appId: "com.neofm.app",
  appName: "neo-fm",
  webDir: "www",
  // Read by the web app (lib/native/app-shell.ts) to hide purchase UI inside the stores' apps.
  appendUserAgent: "NeoFmApp/0.1.0",
  server: { url, cleartext: false, errorPath: "index.html", allowNavigation: ["www.neo-fm.com", "neo-fm.com", "*.supabase.co"] },
  android: { allowMixedContent: false },
  plugins: { SplashScreen: { launchAutoHide: true, backgroundColor: "#0a0612" } },
};

export default config;
