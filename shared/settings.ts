import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

// A workspace without an entry is linked automatically; an empty list means "no worktree".
export const linkSettings = defineSettings({
  id: "links",
  scope: "host",
  version: 1,
  schema: z.object({
    overrides: z.record(z.string(), z.object({ worktrees: z.array(z.string()) })).default({}),
  }),
});
export type LinkSettings = z.infer<typeof linkSettings.schema>;
