import { defineConfig } from "vitepress";

export default defineConfig({
  title: "his-and-hers",
  description: "Two agents. Separate machines. One command to wire them.",
  lang: "en-US",
  base: "/",

  head: [
    ["link", { rel: "icon", href: "/favicon.ico" }],
    ["meta", { name: "theme-color", content: "#f97316" }], // orange, fire
  ],

  themeConfig: {
    logo: "/logo.svg",
    siteTitle: "his-and-hers",

    nav: [
      { text: "Guide", link: "/guide/what-is-his-and-hers" },
      { text: "Reference", link: "/reference/cli" },
      { text: "Protocol", link: "/protocol/overview" },
      { text: "Hardware", link: "/hardware/overview" },
      { text: "Future", link: "/docs/future" },
      {
        text: "Links",
        items: [
          { text: "GitHub", link: "https://github.com/CalciferFriend/his-and-hers" },
          { text: "npm", link: "https://www.npmjs.com/package/his-and-hers" },
          { text: "Community Discord", link: "https://discord.gg/his-and-hers" },
        ],
      },
    ],

    sidebar: {
      "/guide/": [
        {
          text: "Getting Started",
          items: [
            { text: "What is his-and-hers?", link: "/guide/what-is-his-and-hers" },
            { text: "Quickstart (5 minutes)", link: "/guide/quickstart" },
            { text: "How it works", link: "/guide/how-it-works" },
            { text: "H1 vs H2", link: "/guide/roles" },
          ],
        },
        {
          text: "Installation",
          items: [
            { text: "Prerequisites", link: "/guide/prerequisites" },
            { text: "Linux / Mac (H1)", link: "/guide/install-linux" },
            { text: "Windows (H2)", link: "/guide/install-windows" },
            { text: "Docker", link: "/guide/docker" },
          ],
        },
        {
          text: "Configuration",
          items: [
            { text: "LLM providers", link: "/guide/providers" },
            { text: "Wake-on-LAN", link: "/guide/wol" },
            { text: "Tailscale pairing", link: "/guide/tailscale" },
            { text: "Gateway config", link: "/guide/gateway" },
          ],
        },
        {
          text: "Usage",
          items: [
            { text: "Sending tasks", link: "/guide/sending-tasks" },
            { text: "Budget tracking", link: "/guide/budget" },
            { text: "Capability routing", link: "/guide/capabilities" },
            { text: "Multi-H2", link: "/guide/multi-h2" },
          ],
        },
      ],

      "/reference/": [
        {
          text: "CLI Reference",
          items: [
            { text: "hh (overview)", link: "/reference/cli" },
            { text: "hh onboard", link: "/reference/onboard" },
            { text: "hh send", link: "/reference/send" },
            { text: "hh status", link: "/reference/status" },
            { text: "hh wake", link: "/reference/wake" },
            { text: "hh logs", link: "/reference/logs" },
            { text: "hh budget", link: "/reference/budget" },
            { text: "hh capabilities", link: "/reference/capabilities" },
            { text: "hh discover", link: "/reference/discover" },
            { text: "hh publish", link: "/reference/publish" },
            { text: "hh pair", link: "/reference/pair" },
          ],
        },
      ],

      "/protocol/": [
        {
          text: "Protocol",
          items: [
            { text: "Overview", link: "/protocol/overview" },
            { text: "HHMessage", link: "/protocol/hhmessage" },
            { text: "HHHandoff", link: "/protocol/hhhandoff" },
            { text: "HHHeartbeat", link: "/protocol/hhheartbeat" },
            { text: "Capability registry", link: "/protocol/capabilities" },
          ],
        },
      ],

      "/hardware/": [
        {
          text: "Hardware Profiles",
          items: [
            { text: "Overview", link: "/hardware/overview" },
            { text: "Raspberry Pi 5", link: "/hardware/pi5" },
            { text: "RTX 3070 Ti", link: "/hardware/rtx-3070-ti" },
            { text: "RTX 4090", link: "/hardware/rtx-4090" },
            { text: "M2 / M3 Mac", link: "/hardware/m2-mac" },
          ],
        },
      ],

      "/docs/": [
        {
          text: "Research & Vision",
          items: [
            { text: "Future: Beyond Text", link: "/docs/future" },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: "github", link: "https://github.com/CalciferFriend/his-and-hers" },
      { icon: "discord", link: "https://discord.gg/his-and-hers" },
    ],

    footer: {
      message: "Released under the MIT License.",
      copyright: "Built by Calcifer 🔥 and GLaDOS 🤖",
    },

    search: {
      provider: "local",
    },

    editLink: {
      pattern: "https://github.com/CalciferFriend/his-and-hers/edit/main/docs-site/:path",
      text: "Edit this page on GitHub",
    },
  },
});
