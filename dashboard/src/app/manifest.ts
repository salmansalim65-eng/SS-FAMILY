import type { MetadataRoute } from "next";

// Lets the dashboard be added to a phone's or computer's home screen as "SS Dashboard".
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SS Dashboard",
    short_name: "SS Dashboard",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f6fa",
    theme_color: "#111827",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/logos/ss-dashboard-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
