import { defineConfig } from "vitepress";
import { version } from "../../package.json";

export default defineConfig({
  title: "Three.js Water Pro",
  description: "FFT-based ocean simulation for Three.js WebGPU",

  markdown: {
    lineNumbers: true,
  },

  head: [
    ["link", { rel: "icon", type: "image/x-icon", href: "/favicon.ico" }],
    [
      "link",
      {
        rel: "icon",
        type: "image/png",
        sizes: "32x32",
        href: "/favicon-32x32.png",
      },
    ],
    [
      "link",
      {
        rel: "icon",
        type: "image/png",
        sizes: "16x16",
        href: "/favicon-16x16.png",
      },
    ],
  ],

  themeConfig: {
    logo: "/logo.png",
    outline: [2, 3],

    nav: [
      { text: "Guide", link: "/guide/installation" },
      { text: "API", link: "/api/water-system" },
      { text: `v${version}`, link: "/changelog" },
    ],

    sidebar: {
      "/guide/": [
        {
          text: "Guide",
          items: [
            { text: "Installation", link: "/guide/installation" },
            { text: "Basic Example", link: "/guide/basic-example" },
            { text: "Presets", link: "/guide/presets" },
            { text: "Quality Levels", link: "/guide/quality-levels" },
          ],
        },
        {
          text: "How-To",
          items: [
            { text: "Custom Sky", link: "/guide/custom-sky" },
            { text: "Floating Objects", link: "/guide/floating-objects" },
            { text: "Multiplayer", link: "/guide/multiplayer" },
            { text: "Post-Processing", link: "/guide/post-processing" },
            { text: "Spray", link: "/guide/spray" },
            { text: "Transparent Objects", link: "/guide/transparent-objects" },
            { text: "Wake", link: "/guide/wake" },
            { text: "Water Masking", link: "/guide/water-masking" },
            { text: "Wave Tuning", link: "/guide/wave-tuning" },
          ],
        },
        {
          text: "Migration",
          items: [
            { text: "v2 → v3", link: "/guide/migrating-from-v2" },
          ],
        },
      ],
      "/api/": [
        {
          text: "WaterSystem",
          items: [
            { text: "Overview", link: "/api/water-system" },
            { text: "Properties", link: "/api/water-system#properties" },
            { text: "Methods", link: "/api/water-system#methods" },
          ],
        },
        {
          text: "Surface",
          items: [
            { text: "Color & Transparency", link: "/api/color" },
            { text: "Foam", link: "/api/foam" },
            { text: "Gerstner Waves", link: "/api/gerstner" },
            { text: "Reflections (SSR)", link: "/api/ssr" },
            { text: "Sparkle", link: "/api/sparkle" },
            { text: "Subsurface Scattering", link: "/api/sss" },
            { text: "Wake", link: "/api/wake" },
            { text: "Waterline", link: "/api/waterline" },
            { text: "Waves", link: "/api/waves" },
          ],
        },
        {
          text: "Underwater",
          items: [
            { text: "Ambient Particles", link: "/api/particles" },
            { text: "Fog & Distortion", link: "/api/underwater" },
            { text: "Ocean Floor", link: "/api/ocean-floor" },
            { text: "Sun Shafts", link: "/api/sun-shafts" },
          ],
        },
        {
          text: "Environment",
          items: [
            { text: "Atmospheric Fog", link: "/api/fog" },
            { text: "Sun & Lighting", link: "/api/sun" },
          ],
        },
        {
          text: "Weather & Particles",
          items: [
            { text: "Rain", link: "/api/rain" },
            { text: "Spray", link: "/api/spray" },
          ],
        },
        {
          text: "Physics & Geometry",
          items: [
            { text: "Buoyancy", link: "/api/buoyancy" },
            { text: "Masking", link: "/api/masking" },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: "github", link: "https://github.com/dgreenheck/webgpu-water" },
    ],

    footer: {
      message: "Commercial License - All Rights Reserved.",
      copyright: "Copyright © 2025 DRG Software Solutions LLC",
    },

    search: {
      provider: "local",
    },
  },
});
