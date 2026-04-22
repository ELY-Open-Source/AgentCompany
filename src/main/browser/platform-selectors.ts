export interface PlatformSelectors {
  authenticated: readonly string[];
  composerOpen: readonly string[];
  editor: readonly string[];
  submit: readonly string[];
  replyEditor: readonly string[];
  replySubmit: readonly string[];
  likeButton: readonly string[];
  likedButton: readonly string[];
  followButton: readonly string[];
  followingButton: readonly string[];
  feedItems: readonly string[];
  searchItems: readonly string[];
}

const GENERIC_SELECTORS: PlatformSelectors = {
  authenticated: [
    "[data-testid='AppTabBar_Profile_Link']",
    "a[href*='/in/']",
    "img[alt*='profile' i]",
    "[aria-label*='profile' i]",
  ],
  composerOpen: [
    "button[aria-label*='post' i]",
    "button[aria-label*='compose' i]",
    "button.share-box-feed-entry__trigger",
  ],
  editor: [
    "[role='textbox'][contenteditable='true']",
    "textarea",
    ".ql-editor[contenteditable='true']",
  ],
  submit: [
    "button[type='submit']",
    "button[aria-label*='post' i]",
    "button[aria-label*='send' i]",
  ],
  replyEditor: [
    "[role='textbox'][contenteditable='true']",
    "textarea",
  ],
  replySubmit: [
    "button[type='submit']",
    "button[aria-label*='reply' i]",
    "button[aria-label*='send' i]",
  ],
  likeButton: [
    "button[aria-label*='like' i]",
    "[role='button'][aria-label*='like' i]",
  ],
  likedButton: [
    "button[aria-pressed='true'][aria-label*='like' i]",
    "[data-testid='unlike']",
  ],
  followButton: [
    "button[aria-label*='follow' i]",
    "[role='button'][aria-label*='follow' i]",
  ],
  followingButton: [
    "button[aria-label*='following' i]",
    "button[aria-label*='requested' i]",
  ],
  feedItems: ["article", "[role='article']", ".feed-shared-update-v2"],
  searchItems: ["article", "[role='article']", ".search-result", ".feed-shared-update-v2"],
};

const PLATFORM_SELECTORS: Record<string, Partial<PlatformSelectors>> = {
  twitter: {
    authenticated: [
      "[data-testid='AppTabBar_Profile_Link']",
      "[data-testid='SideNav_AccountSwitcher_Button']",
      "a[aria-label*='Profile']",
    ],
    editor: [
      "[data-testid='tweetTextarea_0']",
      "[role='textbox'][contenteditable='true']",
    ],
    submit: [
      "[data-testid='tweetButton']",
      "[data-testid='tweetButtonInline']",
    ],
    replyEditor: [
      "[data-testid='tweetTextarea_0']",
      "[role='textbox'][contenteditable='true']",
    ],
    replySubmit: [
      "[data-testid='tweetButton']",
      "[data-testid='tweetButtonInline']",
      "button[type='submit']",
    ],
    likeButton: ["[data-testid='like']", "button[aria-label*='Like']"],
    likedButton: ["[data-testid='unlike']", "button[aria-label*='Unlike']"],
    feedItems: ["article", "[data-testid='tweet']"],
    searchItems: ["article", "[data-testid='tweet']"],
  },
  linkedin: {
    authenticated: [
      "a[href*='/in/']",
      "img.global-nav__me-photo",
      "button.global-nav__primary-link-me-menu-trigger",
    ],
    composerOpen: [
      "button.share-box-feed-entry__trigger",
      "button.artdeco-button--muted",
    ],
    editor: [
      "[role='textbox'][contenteditable='true']",
      ".ql-editor[contenteditable='true']",
    ],
    submit: [
      "button.share-actions__primary-action",
      "button.artdeco-button--primary[type='submit']",
    ],
    feedItems: [".feed-shared-update-v2", "article", ".update-components-text"],
    searchItems: [".reusable-search__result-container", ".feed-shared-update-v2", "article"],
  },
};

export function getPlatformSelectors(platform: string): PlatformSelectors {
  const overrides = PLATFORM_SELECTORS[platform] ?? {};
  return {
    authenticated: overrides.authenticated ?? GENERIC_SELECTORS.authenticated,
    composerOpen: overrides.composerOpen ?? GENERIC_SELECTORS.composerOpen,
    editor: overrides.editor ?? GENERIC_SELECTORS.editor,
    submit: overrides.submit ?? GENERIC_SELECTORS.submit,
    replyEditor: overrides.replyEditor ?? overrides.editor ?? GENERIC_SELECTORS.replyEditor,
    replySubmit: overrides.replySubmit ?? overrides.submit ?? GENERIC_SELECTORS.replySubmit,
    likeButton: overrides.likeButton ?? GENERIC_SELECTORS.likeButton,
    likedButton: overrides.likedButton ?? GENERIC_SELECTORS.likedButton,
    followButton: overrides.followButton ?? GENERIC_SELECTORS.followButton,
    followingButton: overrides.followingButton ?? GENERIC_SELECTORS.followingButton,
    feedItems: overrides.feedItems ?? GENERIC_SELECTORS.feedItems,
    searchItems: overrides.searchItems ?? overrides.feedItems ?? GENERIC_SELECTORS.searchItems,
  };
}
