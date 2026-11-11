import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Task Hub",
    short_name: "Task Hub",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f6fa",
    theme_color: "#4f46e5",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
