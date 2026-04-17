import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { extname } from "node:path";

async function runCommand(command, args, capture = false) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
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

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(stderr || stdout || `${command} failed with exit code ${code ?? 1}`));
    });
  });
}

async function runCodesign(args) {
  await runCommand("/usr/bin/codesign", args, false);
}

function buildCodesignArgs(targetPath, identity, keychain, fileOptions = {}) {
  const args = [
    "--sign", identity,
    "--force",
  ];

  if (keychain) {
    args.push("--keychain", keychain);
  }
  if (fileOptions.timestamp !== false) {
    args.push("--timestamp");
  }
  if (fileOptions.hardenedRuntime) {
    args.push("--options", "runtime");
  }
  if (fileOptions.entitlements) {
    args.push("--entitlements", fileOptions.entitlements);
  }
  if (Array.isArray(fileOptions.additionalArguments) && fileOptions.additionalArguments.length > 0) {
    args.push(...fileOptions.additionalArguments);
  }

  args.push(targetPath);
  return args;
}

async function isMachBinary(filePath) {
  const extension = extname(filePath);
  if (extension === ".dylib" || extension === ".node") {
    return true;
  }

  const { stdout } = await runCommand("/usr/bin/file", ["-b", filePath], true);
  return stdout.includes("Mach-O");
}

async function collectSignTargets(rootPath) {
  const bundleTargets = [];
  const binaryTargets = [];

  async function walk(currentPath) {
    const entries = await readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = `${currentPath}/${entry.name}`;

      if (entry.isSymbolicLink()) {
        continue;
      }

      if (entry.isDirectory()) {
        if (
          entry.name.endsWith(".app") ||
          entry.name.endsWith(".framework") ||
          entry.name.endsWith(".xpc") ||
          entry.name.endsWith(".appex") ||
          entry.name.endsWith(".plugin")
        ) {
          bundleTargets.push(fullPath);
        }
        await walk(fullPath);
        continue;
      }

      if (await isMachBinary(fullPath)) {
        binaryTargets.push(fullPath);
      }
    }
  }

  await walk(rootPath);

  bundleTargets.sort((left, right) => right.length - left.length);
  binaryTargets.sort((left, right) => right.length - left.length);

  return { bundleTargets, binaryTargets };
}

async function signTarget(targetPath, context) {
  const fileOptions = context.optionsForFile?.(targetPath) ?? {};
  const args = buildCodesignArgs(targetPath, context.identity, context.keychain, fileOptions);
  await runCodesign(args);
}

export default async function sign(context) {
  const { bundleTargets, binaryTargets } = await collectSignTargets(context.app);

  for (const target of binaryTargets) {
    await signTarget(target, context);
  }

  for (const target of bundleTargets) {
    await signTarget(target, context);
  }

  await signTarget(context.app, context);
}
