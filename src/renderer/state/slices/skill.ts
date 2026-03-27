import type { StateCreator } from "zustand";
import type { AppState } from "../store";
import type { SkillRecord } from "@shared/types";

export interface SkillSlice {
  skills: SkillRecord[];
  setSkills: (skills: SkillRecord[]) => void;
  selectedSkillId: string | null;
  setSelectedSkillId: (id: string | null) => void;
  selectedSkillFilePath: string;
  setSelectedSkillFilePath: (path: string) => void;
  skillImportModalOpen: boolean;
  setSkillImportModalOpen: (open: boolean) => void;
}

export const createSkillSlice: StateCreator<
  AppState,
  [["zustand/immer", never]],
  [],
  SkillSlice
> = (set) => ({
  skills: [],
  setSkills: (skills) =>
    set((state) => {
      state.skills = skills;
    }),
  selectedSkillId: null,
  setSelectedSkillId: (id) =>
    set((state) => {
      state.selectedSkillId = id;
    }),
  selectedSkillFilePath: "SKILL.md",
  setSelectedSkillFilePath: (path) =>
    set((state) => {
      state.selectedSkillFilePath = path;
    }),
  skillImportModalOpen: false,
  setSkillImportModalOpen: (open) =>
    set((state) => {
      state.skillImportModalOpen = open;
    }),
});
