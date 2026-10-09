/** What a pick imported, in order, and each picked file that could not be imported, with why. */
export interface ImportedFiles {
  fileIds: string[];
  failures: Array<{ name: string; reason: string }>;
}

export interface ImportFileInput {
  orgId: string;
  /** The conversation the file is attached in; a direct or restricted one keeps the file to its members. */
  spaceId?: string;
}

export interface OpenFileInput {
  orgId: string;
  fileId: string;
}

export interface SetFilePinnedInput {
  orgId: string;
  fileId: string;
  pinned: boolean;
}

export interface NativeDialogResult {
  canceled: boolean;
  filePaths: string[];
}
