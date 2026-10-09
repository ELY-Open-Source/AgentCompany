import { dialog, type BrowserWindow } from "electron";

let unsaved = false;

/** The renderer reports whether any typed input would be lost; closing asks first while it is. */
export function setUnsavedInput(value: boolean): void {
  unsaved = value;
}

/** True when closing may go ahead: nothing is unsaved, or the user chose to discard it. */
export function confirmDiscardOnClose(win: BrowserWindow, language: "en" | "zh"): boolean {
  if (!unsaved) return true;
  const zh = language === "zh";
  const choice = dialog.showMessageBoxSync(win, {
    type: "warning",
    buttons: [zh ? "放弃并关闭" : "Discard and close", zh ? "留下" : "Stay"],
    defaultId: 1,
    cancelId: 1,
    message: zh ? "有尚未保存或发送的内容。" : "Some of what you typed is not saved or sent.",
    detail: zh ? "关闭应用会丢失这些内容。" : "Closing the app discards it.",
  });
  if (choice !== 0) {
    console.info("[app] close cancelled: unsaved input kept");
    return false;
  }
  unsaved = false;
  console.info("[app] closing with unsaved input discarded");
  return true;
}
