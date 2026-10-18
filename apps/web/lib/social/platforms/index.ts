import type { Platform } from "../config";
import { facebookAdapter, instagramAdapter } from "./meta";
import { tiktok } from "./tiktok";
import type { Adapter } from "./types";
import { youtube } from "./youtube";

export const ADAPTERS: Record<Platform, Adapter> = { youtube, instagram: instagramAdapter, facebook: facebookAdapter, tiktok };
