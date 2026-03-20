import { defineConfig } from "vitepress";

export default defineConfig({
  title: "cofounder",
  description: "Two agents. Separate machines. One command to wire them.",
  lang: "en-US",
  // In CI (GitHub Pages) VITE_DOCS_BASE is set to /cofounder/
  // For a custom domain deployment, set VITE_DOCS_BASE=/ (or leave unset locally)
  base: process.env.VITE_DOCS_BASE ?? "/",

  head: [
    ["link", { rel: "icon", href: "/favicon.ico" }],
    ["meta", { name: "theme-color", content: "#f97316" }], // orange, fire
  ],

  themeConfig: {
    logo: "/logo.svg",
    siteTitle: "cofounder",

    nav: [
      { text: "Guide", link: "/guide/what-is-cofounder" },
      { text: "Reference", link: "/reference/cli" },
      { text: "Protocol", link: "/protocol/overview" },
      { text: "Hardware", link: "/hardware/overview" },
      { text: "Future", link: "/docs/future" },
      {
        text: "Links",
        items: [
          { text: "GitHub", link: "https://github.com/CalciferFriend/cofounder" },
          { text: "npm", link: "https://www.npmjs.com/package/cofounder" },
          { text: "Community Discord", link: "https://discord.gg/cofounder" },
        ],
      },
    ],

    sidebar: {
      "/guide/": [
        {
          text: "Getting Started",
          items: [
            { text: "What is cofounder?", link: "/guide/what-is-cofounder" },
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
            { text: "Live streaming", link: "/guide/streaming" },
            { text: "Persistent notifications", link: "/guide/notifications" },
            { text: "Scheduling recurring tasks", link: "/guide/scheduling" },
            { text: "Budget tracking", link: "/guide/budget" },
            { text: "Capability routing", link: "/guide/capabilities" },
            { text: "Multi-H2", link: "/guide/multi-h2" },
          ],
        },
        {
          text: "Help",
          items: [
            { text: "Troubleshooting", link: "/guide/troubleshooting" },
          ],
        },
      ],

      "/reference/": [
        {
          text: "CLI Reference",
          items: [
            { text: "cofounder (overview)", link: "/reference/cli" },
            { text: "cofounder onboard", link: "/reference/onboard" },
            { text: "cofounder send", link: "/reference/send" },
            { text: "cofounder status", link: "/reference/status" },
            { text: "cofounder monitor", link: "/reference/monitor" },
            { text: "cofounder wake", link: "/reference/wake" },
            { text: "cofounder logs", link: "/reference/logs" },
            { text: "cofounder budget", link: "/reference/budget" },
            { text: "cofounder capabilities", link: "/reference/capabilities" },
            { text: "cofounder notify", link: "/reference/notify" },
            { text: "cofounder schedule", link: "/reference/schedule" },
            { text: "cofounder discover", link: "/reference/discover" },
            { text: "cofounder publish", link: "/reference/publish" },
            { text: "cofounder pair", link: "/reference/pair" },
            { text: "cofounder config", link: "/reference/config" },
            { text: "cofounder test", link: "/reference/test" },
            { text: "cofounder result", link: "/reference/result" },
            { text: "cofounder watch", link: "/reference/watch" },
            { text: "cofounder heartbeat", link: "/reference/heartbeat" },
            { text: "cofounder peers", link: "/reference/peers" },
            { text: "cofounder replay", link: "/reference/replay" },
            { text: "cofounder cancel", link: "/reference/cancel" },
            { text: "cofounder doctor", link: "/reference/doctor" },
            { text: "cofounder upgrade", link: "/reference/upgrade" },
            { text: "cofounder template", link: "/reference/template" },
            { text: "cofounder prune", link: "/reference/prune" },
            { text: "cofounder export", link: "/reference/export" },
            { text: "cofounder chat", link: "/reference/chat" },
            { text: "cofounder completion", link: "/reference/completion" },
            { text: "cofounder web", link: "/reference/web" },
            { text: "cofounder broadcast", link: "/reference/broadcast" },
            { text: "cofounder sync", link: "/reference/sync" },
            { text: "cofounder cluster", link: "/reference/cluster" },
            { text: "cofounder pipeline", link: "/reference/pipeline" },
            { text: "cofounder workflow", link: "/reference/workflow" },
            { text: "cofounder run", link: "/reference/run" },
            { text: "cofounder alias", link: "/reference/alias" },
            { text: "cofounder trace", link: "/reference/trace" },
            { text: "cofounder health-report", link: "/reference/health-report" },
            { text: "cofounder tag", link: "/reference/tag" },
          ],
        },
        {
          text: "SDK",
          items: [
            { text: "@cofounder/sdk", link: "/reference/sdk" },
          ],
        },
      ],

      "/protocol/": [
        {
          text: "Protocol",
          items: [
            { text: "Overview", link: "/protocol/overview" },
            { text: "CofounderMessage", link: "/protocol/cofoundermessage" },
            { text: "CofounderHandoff", link: "/protocol/cofounderhandoff" },
            { text: "CofounderHeartbeat", link: "/protocol/cofounderheartbeat" },
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
            { text: "Latent Communication Guide", link: "/docs/latent-communication" },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: "github", link: "https://github.com/CalciferFriend/cofounder" },
      { icon: "discord", link: "https://discord.gg/cofounder" },
    ],

    footer: {
      message: "Released under the MIT License.",
      copyright: "Built by Calcifer 🔥 and GLaDOS 🤖",
    },

    search: {
      provider: "local",
    },

    editLink: {
      pattern: "https://github.com/CalciferFriend/cofounder/edit/main/docs-site/:path",
      text: "Edit this page on GitHub",
    },
  },
});
