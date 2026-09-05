import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourceDir = path.resolve(__dirname, "../node_modules/.prisma/client");
const targetDir = path.resolve(__dirname, "../node_modules/@prisma/client");

if (fs.existsSync(sourceDir) && fs.existsSync(targetDir)) {
  const filesToCopy = ["index.d.ts", "default.d.ts", "edge.d.ts", "client.d.ts"];
  for (const file of filesToCopy) {
    const src = path.join(sourceDir, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(targetDir, file));
      if (file === "index.d.ts") {
        fs.copyFileSync(src, path.join(targetDir, "default.d.ts"));
      }
    }
  }
  console.log("✓ Successfully synchronized generated Prisma types to @prisma/client");
}
