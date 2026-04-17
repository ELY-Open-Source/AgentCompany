function normalizeBaseUrl(url) {
  return url.replace(/\/+$/, "");
}

function normalizePublishPath(targetPath) {
  return targetPath.replace(/^\/+|\/+$/g, "");
}

export function prepareBuildEnv(sourceEnv, extraArgs) {
  const env = { ...sourceEnv };
  const noDeprecationFlag = "--no-deprecation";
  const requestedUpdateUrl = env.AGENTCOMPANY_UPDATE_URL?.trim() ?? "";
  const strictRelease = env.AGENTCOMPANY_STRICT_RELEASE === "true";
  const hasMacSigningMaterial = Boolean(
    env.CSC_LINK?.trim() ||
    env.CSC_NAME?.trim() ||
    env.APPLE_API_KEY?.trim(),
  );
  const isDirBuild = extraArgs.includes("--dir");
  const r2AccountId = env.AGENTCOMPANY_R2_ACCOUNT_ID?.trim() ?? env.R2_ACCOUNT_ID?.trim() ?? "";
  const r2Bucket = env.AGENTCOMPANY_R2_BUCKET?.trim() ?? env.R2_BUCKET?.trim() ?? "";
  const r2PublicUrl = env.AGENTCOMPANY_R2_PUBLIC_URL?.trim() ?? env.R2_PUBLIC_BASE_URL?.trim() ?? "";
  const r2Path = env.AGENTCOMPANY_R2_PATH?.trim() ?? env.AGENTCOMPANY_RELEASE_PREFIX?.trim() ?? "desktop";
  const r2Region = env.AGENTCOMPANY_R2_REGION?.trim() || "auto";
  const r2Endpoint = env.AGENTCOMPANY_R2_ENDPOINT?.trim() || (r2AccountId ? `https://${r2AccountId}.r2.cloudflarestorage.com` : "");

  const resolvedUpdateUrl = (() => {
    if (requestedUpdateUrl && !requestedUpdateUrl.includes("example.invalid")) {
      return normalizeBaseUrl(requestedUpdateUrl);
    }
    if (!r2PublicUrl) return "";
    const baseUrl = normalizeBaseUrl(r2PublicUrl);
    const publishPath = normalizePublishPath(r2Path);
    return publishPath ? `${baseUrl}/${publishPath}` : baseUrl;
  })();

  const hasR2PublishConfig = Boolean(
    r2Bucket &&
    r2Endpoint &&
    resolvedUpdateUrl &&
    (env.AGENTCOMPANY_R2_ACCESS_KEY_ID?.trim() || env.R2_ACCESS_KEY_ID?.trim() || env.AWS_ACCESS_KEY_ID?.trim()) &&
    (env.AGENTCOMPANY_R2_SECRET_ACCESS_KEY?.trim() || env.R2_SECRET_ACCESS_KEY?.trim() || env.AWS_SECRET_ACCESS_KEY?.trim()),
  );

  if (!env.AWS_ACCESS_KEY_ID && (env.AGENTCOMPANY_R2_ACCESS_KEY_ID?.trim() || env.R2_ACCESS_KEY_ID?.trim())) {
    env.AWS_ACCESS_KEY_ID = env.AGENTCOMPANY_R2_ACCESS_KEY_ID?.trim() || env.R2_ACCESS_KEY_ID?.trim();
  }
  if (!env.AWS_SECRET_ACCESS_KEY && (env.AGENTCOMPANY_R2_SECRET_ACCESS_KEY?.trim() || env.R2_SECRET_ACCESS_KEY?.trim())) {
    env.AWS_SECRET_ACCESS_KEY = env.AGENTCOMPANY_R2_SECRET_ACCESS_KEY?.trim() || env.R2_SECRET_ACCESS_KEY?.trim();
  }
  if (!env.AWS_REGION) env.AWS_REGION = r2Region;
  if (!env.AWS_DEFAULT_REGION) env.AWS_DEFAULT_REGION = env.AWS_REGION;
  if (!env.AWS_EC2_METADATA_DISABLED) env.AWS_EC2_METADATA_DISABLED = "true";
  if (!env.AGENTCOMPANY_UPDATE_URL && resolvedUpdateUrl) {
    env.AGENTCOMPANY_UPDATE_URL = resolvedUpdateUrl;
  }

  if (env.CSC_IDENTITY_AUTO_DISCOVERY === undefined) {
    env.CSC_IDENTITY_AUTO_DISCOVERY = hasMacSigningMaterial ? "true" : "false";
  }

  const existingNodeOptions = env.NODE_OPTIONS?.trim();
  if (!existingNodeOptions) {
    env.NODE_OPTIONS = noDeprecationFlag;
  } else if (!existingNodeOptions.includes(noDeprecationFlag)) {
    env.NODE_OPTIONS = `${existingNodeOptions} ${noDeprecationFlag}`;
  }

  return {
    env,
    resolvedUpdateUrl,
    hasR2PublishConfig,
    hasMacSigningMaterial,
    strictRelease,
    isDirBuild,
    explicitElectronDistPath: env.AGENTCOMPANY_ELECTRON_DIST?.trim() || "",
    r2: { bucket: r2Bucket, endpoint: r2Endpoint, region: r2Region, path: normalizePublishPath(r2Path) },
  };
}

export function resolvePublishMode(env) {
  const allowedPublishModes = new Set(["always", "never", "onTag", "onTagOrDraft"]);
  const requested = env.AGENTCOMPANY_ELECTRON_PUBLISH?.trim();
  if (!requested) return "never";
  if (!allowedPublishModes.has(requested)) {
    console.warn(
      `[build-desktop] Ignoring invalid AGENTCOMPANY_ELECTRON_PUBLISH="${requested}". ` +
      "Falling back to --publish never.",
    );
    return "never";
  }
  return requested;
}
