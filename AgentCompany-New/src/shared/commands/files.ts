export interface ImportFileInput {
  orgId: string;
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
