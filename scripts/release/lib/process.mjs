import { spawn } from "node:child_process";

export function createRunner(rootDir) {
  return function run(command, args, options = {}) {
    const {
      cwd = rootDir,
      env = process.env,
      input = null,
      capture = false,
    } = options;

    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        env,
        stdio: capture ? ["pipe", "pipe", "pipe"] : ["pipe", "inherit", "inherit"],
        shell: process.platform === "win32",
      });

      let stdout = "";
      let stderr = "";
      if (capture) {
        child.stdout.on("data", (chunk) => {
          stdout += chunk.toString();
        });
        child.stderr.on("data", (chunk) => {
          stderr += chunk.toString();
        });
      }

      if (input) {
        child.stdin.write(input);
      }
      child.stdin.end();

      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) {
          resolve({ stdout, stderr });
          return;
        }
        reject(new Error(stderr || stdout || `${command} ${args.join(" ")} failed with exit code ${code ?? 1}`));
      });
    });
  };
}
