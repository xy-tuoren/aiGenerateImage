import { getMongoDb } from "@/lib/server/mongodb";
import * as promptFns from "@/common/prompt";
import {
  CUT_TEMPLATES_BY_APP_RATIO,
  getCutTemplatesForAppRatio,
} from "@/lib/server/utils";

export const CUT_SETTING_RATIOS = ["1:1", "4:5"] as const;
export type CutSettingRatio = (typeof CUT_SETTING_RATIOS)[number];
export const CUT_SETTING_MAX_TEMPLATE_PER_RATIO = 4;
const DISALLOWED_TEMPLATES_BY_RATIO: Partial<Record<CutSettingRatio, string[]>> = {
  "4:5": ["stitchLongImage1024"],
};

type CutTemplateSettingsDoc = {
  userId: string;
  username?: string;
  byAppRatio?: Record<string, Partial<Record<CutSettingRatio, string[]>>>;
  customTemplatePrompts?: Record<string, string>;
  customTemplateThinkingLevels?: Record<string, string>;
  createdAt?: Date;
  updatedAt?: Date;
};

export type NormalizedCutTemplateSettings = {
  byAppRatio: Record<string, Partial<Record<CutSettingRatio, string[]>>>;
  customTemplatePrompts: Record<string, string>;
  customTemplateThinkingLevels: Record<string, string>;
};

const BUILTIN_SPECIAL_TEMPLATES = ["stitchLongImage1024"];

const uniqTrim = (arr: unknown): string[] => {
  const list = Array.isArray(arr) ? arr : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const it of list) {
    const s = String(it || "").trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
};

const normalizeAppKey = (appName: unknown) => String(appName || "").trim().toLowerCase();

const isSupportedRatio = (ratio: unknown): ratio is CutSettingRatio =>
  CUT_SETTING_RATIOS.includes(String(ratio || "").trim() as CutSettingRatio);

const filterDisallowedByRatio = (ratio: CutSettingRatio, list: string[]): string[] => {
  const blocked = new Set(DISALLOWED_TEMPLATES_BY_RATIO[ratio] || []);
  return list.filter((name) => !blocked.has(name));
};

export function listBuiltInCutTemplateNames(): string[] {
  const set = new Set<string>();
  for (const byRatio of Object.values(CUT_TEMPLATES_BY_APP_RATIO || {})) {
    if (!byRatio || typeof byRatio !== "object") continue;
    for (const arr of Object.values(byRatio as Record<string, string[]>)) {
      for (const name of uniqTrim(arr)) set.add(name);
    }
  }
  for (const name of Object.keys(promptFns || {})) {
    if (typeof (promptFns as Record<string, unknown>)[name] === "function") {
      set.add(name);
    }
  }
  for (const name of BUILTIN_SPECIAL_TEMPLATES) set.add(name);
  return [...set].sort((a, b) => a.localeCompare(b));
}

function normalizeByAppRatio(input: unknown): Record<string, Partial<Record<CutSettingRatio, string[]>>> {
  const src = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const out: Record<string, Partial<Record<CutSettingRatio, string[]>>> = {};
  for (const [appRaw, cfg] of Object.entries(src)) {
    const appKey = normalizeAppKey(appRaw);
    if (!appKey) continue;
    const obj = cfg && typeof cfg === "object" ? (cfg as Record<string, unknown>) : {};
    const row: Partial<Record<CutSettingRatio, string[]>> = {};
    for (const ratio of CUT_SETTING_RATIOS) {
      const list = filterDisallowedByRatio(
        ratio,
        uniqTrim(obj[ratio]).slice(0, CUT_SETTING_MAX_TEMPLATE_PER_RATIO)
      );
      if (list.length) row[ratio] = list;
    }
    if ((row["1:1"]?.length || 0) + (row["4:5"]?.length || 0) > 0) {
      out[appKey] = row;
    }
  }
  return out;
}

function normalizeCustomTemplatePrompts(input: unknown): Record<string, string> {
  const src = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const out: Record<string, string> = {};
  for (const [nameRaw, promptRaw] of Object.entries(src)) {
    const name = String(nameRaw || "").trim();
    const prompt = String(promptRaw || "").trim();
    if (!name || !prompt) continue;
    out[name] = prompt;
  }
  return out;
}

function normalizeCustomTemplateThinkingLevels(
  input: unknown,
  customTemplatePrompts: Record<string, string>
): Record<string, string> {
  const src =
    input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const out: Record<string, string> = {};
  for (const [nameRaw, levelRaw] of Object.entries(src)) {
    const name = String(nameRaw || "").trim();
    if (!name || !customTemplatePrompts[name]) continue;
    const level = String(levelRaw || "").trim();
    out[name] = level || "High";
  }
  return out;
}

export function normalizeCutSettings(input: {
  byAppRatio?: unknown;
  customTemplatePrompts?: unknown;
  customTemplateThinkingLevels?: unknown;
}): NormalizedCutTemplateSettings {
  const customTemplatePrompts = normalizeCustomTemplatePrompts(
    input?.customTemplatePrompts
  );
  return {
    byAppRatio: normalizeByAppRatio(input?.byAppRatio),
    customTemplatePrompts,
    customTemplateThinkingLevels: normalizeCustomTemplateThinkingLevels(
      input?.customTemplateThinkingLevels,
      customTemplatePrompts
    )
  };
}

export async function getCutSettingsForUser(userId: string): Promise<NormalizedCutTemplateSettings> {
  const uid = String(userId || "").trim();
  if (!uid)
    return {
      byAppRatio: {},
      customTemplatePrompts: {},
      customTemplateThinkingLevels: {}
    };
  const db = await getMongoDb();
  const col = db.collection<CutTemplateSettingsDoc>("cut_template_settings");
  const doc = await col.findOne({ userId: uid });
  return normalizeCutSettings({
    byAppRatio: doc?.byAppRatio,
    customTemplatePrompts: doc?.customTemplatePrompts,
    customTemplateThinkingLevels: doc?.customTemplateThinkingLevels
  });
}

export async function saveCutSettingsForUser(
  userId: string,
  username: string,
  payload: {
    byAppRatio?: unknown;
    customTemplatePrompts?: unknown;
    customTemplateThinkingLevels?: unknown;
  }
): Promise<NormalizedCutTemplateSettings> {
  const uid = String(userId || "").trim();
  if (!uid) throw new Error("userId 不能为空");
  const normalized = normalizeCutSettings(payload || {});
  const db = await getMongoDb();
  const col = db.collection<CutTemplateSettingsDoc>("cut_template_settings");
  const now = new Date();
  await col.updateOne(
    { userId: uid },
    {
      $set: {
        userId: uid,
        username: String(username || "").trim() || undefined,
        byAppRatio: normalized.byAppRatio,
        customTemplatePrompts: normalized.customTemplatePrompts,
        customTemplateThinkingLevels: normalized.customTemplateThinkingLevels,
        updatedAt: now,
      } as any,
      $setOnInsert: { createdAt: now } as any,
    } as any,
    { upsert: true } as any
  );
  return normalized;
}

export function resolveCutTemplatesForAppRatio(
  appName: unknown,
  ratio: unknown,
  settings?: NormalizedCutTemplateSettings
): string[] {
  const ratioKey = String(ratio || "").trim();
  if (!isSupportedRatio(ratioKey)) return getCutTemplatesForAppRatio(appName, ratioKey);
  const appKey = normalizeAppKey(appName);
  const byApp = settings?.byAppRatio || {};
  const picked = uniqTrim(byApp[appKey]?.[ratioKey]).slice(0, CUT_SETTING_MAX_TEMPLATE_PER_RATIO);
  if (picked.length) return picked;

  // 其次做 startsWith 前缀匹配（不区分大小写）；多个命中时取最长前缀（更具体）
  if (appKey) {
    let bestPrefix = "";
    let bestCfg: Partial<Record<CutSettingRatio, string[]>> | undefined;
    for (const [key, cfg] of Object.entries(byApp)) {
      const prefix = normalizeAppKey(key);
      if (!prefix || prefix === "*") continue;
      if (!appKey.startsWith(prefix)) continue;
      if (prefix.length <= bestPrefix.length) continue;
      bestPrefix = prefix;
      bestCfg = cfg;
    }
    const prefixPicked = uniqTrim(bestCfg?.[ratioKey]).slice(0, CUT_SETTING_MAX_TEMPLATE_PER_RATIO);
    if (prefixPicked.length) return prefixPicked;
  }

  const pickedGlobal = uniqTrim(byApp["*"]?.[ratioKey]).slice(0, CUT_SETTING_MAX_TEMPLATE_PER_RATIO);
  if (pickedGlobal.length) return pickedGlobal;
  return getCutTemplatesForAppRatio(appName, ratioKey);
}

export function resolveCustomCutTemplatePrompt(
  templateName: unknown,
  settings?: NormalizedCutTemplateSettings
): string | undefined {
  const key = String(templateName || "").trim();
  if (!key) return undefined;
  const value = settings?.customTemplatePrompts?.[key];
  const prompt = String(value || "").trim();
  return prompt || undefined;
}

export function resolveCustomCutTemplateThinkingLevel(
  templateName: unknown,
  settings?: NormalizedCutTemplateSettings
): string | undefined {
  const key = String(templateName || "").trim();
  if (!key) return undefined;
  const value = settings?.customTemplateThinkingLevels?.[key];
  const level = String(value || "").trim();
  return level || undefined;
}
