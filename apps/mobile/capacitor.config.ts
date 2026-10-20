import type { CapacitorConfig } from "@capacitor/cli";

// The shell loads the live site, so web releases reach the apps at once (see docs/RELEASE-POLICY.md).
// NEO_FM_SHELL_URL points a debug build at a preview deployment.
const url = process.env.NEO_FM_SHELL_URL ?? "https://www.neo-fm.com";

const config: CapacitorConfig = {
  appId: "com.neofm.app",
  appName: "neo-fm",
  webDir: "www",
  server: { url, cleartext: false, errorPath: "index.html", allowNavigation: ["www.neo-fm.com", "neo-fm.com", "*.supabase.co"] },
  // appendUserAgent is read by the web app (lib/native/app-shell.ts) to hide purchase UI inside the stores' apps; it only
  // takes effect under the platform sections.
  android: { allowMixedContent: false, appendUserAgent: "NeoFmApp/0.1.0 (android)" },
  ios: { appendUserAgent: "NeoFmApp/0.1.0 (ios)" },
  plugins: {
    // Android 15+ draws edge to edge; MainActivity pads the WebView itself so the page never sits under the system bars.
    SystemBars: { insetsHandling: "disable", style: "DARK" },
    SplashScreen: { launchAutoHide: true, backgroundColor: "#0a0612" },
  },
};

export default config;
