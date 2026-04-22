import { RecoverableError, UpstreamError, UserInputError } from "../errors/index.js";

export function browserNotLoggedIn(platform: string, actionType: string): UserInputError {
  return new UserInputError({
    code: "browser.not_logged_in",
    message: `${platform} session is not authenticated for ${actionType}.`,
    context: { platform, actionType },
  });
}

export function browserSelectorDrift(
  platform: string,
  actionType: string,
  selectorKey: string,
): UpstreamError {
  return new UpstreamError({
    code: "browser.selector_drift",
    message: `${platform} selector set did not expose ${selectorKey} for ${actionType}.`,
    context: { platform, actionType, selectorKey },
  });
}

export function browserVerificationFailed(
  platform: string,
  actionType: string,
  expectation: string,
): RecoverableError {
  return new RecoverableError({
    code: "browser.verification_failed",
    message: `${platform} ${actionType} did not pass verification: ${expectation}.`,
    context: { platform, actionType, expectation },
  });
}
