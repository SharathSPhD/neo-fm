/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Do not advertise the framework version.
  poweredByHeader: false,
  // WebP only: no AVIF encoder in the image optimizer (it was the surface of the Next image-optimizer RCE advisories).
  images: { formats: ["image/webp"] },
  // harfbuzzjs loads its wasm from disk; keep it out of the webpack bundle.
  serverExternalPackages: ["harfbuzzjs"],
  // Font files are read at runtime by the OG image route; make sure
  // the serverless bundle ships them.
  outputFileTracingIncludes: {
    "/s/[publicId]/opengraph-image": ["./lib/share/fonts/*.ttf"],
    "/api/recap/image": ["./lib/share/fonts/*.ttf"],
    "/c/[publicId]/opengraph-image": ["./lib/share/fonts/*.ttf"],
  },
  transpilePackages: ["@neo-fm/song-doc"],
};

export default nextConfig;
