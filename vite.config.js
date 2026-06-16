import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base: './' makes all asset paths relative, so the build works under
// https://<user>.github.io/<repo>/ no matter what the repo is named.
export default defineConfig({
  base: "./",
  plugins: [react()],
});
