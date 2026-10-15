/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import "./src/env.js";

/** @type {import("next").NextConfig} */
const config = {
  images: {
    // A property's photos are served from Dropbox (doc §3.10, Media) and made
    // web-sized on the way — a phone photo is several megabytes.
    remotePatterns: [{ protocol: "https", hostname: "dl.dropboxusercontent.com" }],
  },
};

export default config;
