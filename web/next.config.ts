import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Proxy API requests to the backend server
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: 'http://localhost:3100/api/v1/:path*',
      },
    ];
  },
};

export default nextConfig;
