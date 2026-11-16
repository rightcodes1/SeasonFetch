import { spawn } from "node:child_process";

const env = { ...process.env, PORT: "3001" };
const children = [
  spawn(process.execPath, ["server/app.js"], { env, stdio: "inherit" }),
  spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "0.0.0.0", "--port", "3000"], {
    env: process.env,
    stdio: "inherit"
  })
];

function shutdown(code = 0) {
  for (const child of children) child.kill("SIGTERM");
  process.exit(code);
}

for (const child of children) child.on("exit", code => code && shutdown(code));
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
