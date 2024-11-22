/** @type {import('next').NextConfig} */
const nextConfig = {
    webpack: (config, { isServer }) => {
      if (!isServer) {
        config.resolve.fallback = {
          ...config.resolve.fallback,
          fs: false,
          encoding: false,
          crypto: false,
        };
      }
      return config;
    },
  };
  
  module.exports = nextConfig;