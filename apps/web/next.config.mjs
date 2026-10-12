/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Do not advertise the framework version.
  poweredByHeader: false,
  // WebP only: the Next 14 AVIF image-optimizer advisories (GHSA-2xp9-vwfh-vxw4) are not reachable.
  images: { formats: ["image/webp"] },
  experimental: {
    // harfbuzzjs loads its wasm from disk; keep it out of the webpack bundle.
    serverComponentsExternalPackages: ["harfbuzzjs"],
    // Font files are read at runtime by the OG image route; make sure
    // the serverless bundle ships them.
    outputFileTracingIncludes: {
      "/s/[publicId]/opengraph-image": ["./lib/share/fonts/*.ttf"],
      "/c/[publicId]/opengraph-image": ["./lib/share/fonts/*.ttf"],
    },
  },
  transpilePackages: ["@neo-fm/song-doc"],
};

export default nextConfig;
