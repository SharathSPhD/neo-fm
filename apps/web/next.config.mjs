/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // harfbuzzjs loads its wasm from disk; keep it out of the webpack bundle.
  serverExternalPackages: ["harfbuzzjs"],
  // Font files are read at runtime by the OG image route; make sure
  // the serverless bundle ships them.
  outputFileTracingIncludes: {
    "/s/[publicId]/opengraph-image": ["./lib/share/fonts/*.ttf"],
  },
  transpilePackages: ["@neo-fm/song-doc"],
};

export default nextConfig;
