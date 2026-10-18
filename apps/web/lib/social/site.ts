export const siteBase = (env: NodeJS.ProcessEnv = process.env): string =>
  (env.NEXT_PUBLIC_APP_URL?.trim() || "https://neo-fm-web.vercel.app").replace(/\/$/, "");
