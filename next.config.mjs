/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "50mb",
    },
    // Helps large POST bodies in some deployment/proxy paths (see Next.js docs)
    proxyClientMaxBodySize: "50mb",
  },
};

export default nextConfig;
