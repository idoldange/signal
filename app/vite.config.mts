import react from "@vitejs/plugin-react"
import path from "path"
import { defineConfig, loadEnv } from "vite"
import checker from "vite-plugin-checker"
import svgr from "vite-plugin-svgr"

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.join(process.cwd(), ".."), "FIREBASE_")

  return {
    plugins: [
      checker({
        typescript: true,
      }),
      react(),
      svgr({
        include: "**/*.svg",
        svgrOptions: {
          plugins: ["@svgr/plugin-svgo", "@svgr/plugin-jsx"],
          exportType: "default",
        },
      }),
    ],
    build: {
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, "edit.html"),
        },
      },
      minify: false,
      sourcemap: true,
    },
    publicDir: "public",
    server: {
      port: 3000,
      open: "/edit",
    },
    resolve: {
      alias: {
        react: path.resolve(__dirname, "node_modules/react"),
      },
      dedupe: [
        "react",
        "react-dom",
      ],
    },
    envDir: "..",
    define: {
      "process.env": env,
    },
  }
})
