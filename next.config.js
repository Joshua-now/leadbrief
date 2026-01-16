/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['drizzle-orm', 'pg'],
  },
  typescript: {
    ignoreBuildErrors: false,
  },
}

module.exports = nextConfig
