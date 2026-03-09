import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Proxy API requests to the backend server
  async rewrites() {
    const apiUrl = process.env.API_URL || 'http://localhost:3100';
    return [
      {
        source: '/api/v1/:path*',
        destination: `${apiUrl}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
