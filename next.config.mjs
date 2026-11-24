/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  basePath: "/chemical-register",
  trailingSlash: true,
  images: {
    unoptimized: true
  }
};

export default nextConfig;
