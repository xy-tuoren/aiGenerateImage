import { NextRequest } from "next/server";
import { requireApiAccess } from "@/lib/server/auth";
import {
  CUT_SETTING_MAX_TEMPLATE_PER_RATIO,
  CUT_SETTING_RATIOS,
  getCutSettingsForUser,
  listBuiltInCutTemplateNames,
  normalizeCutSettings,
  saveCutSettingsForUser,
} from "@/lib/server/cutSettings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const guard = requireApiAccess(req);
  if (!guard.ok) {
    return Response.json({ ok: false, error: guard.error }, { status: guard.status });
  }
  const settings = await getCutSettingsForUser(guard.user.userId);
  const builtInTemplateNames = listBuiltInCutTemplateNames();
  return Response.json({
    ok: true,
    settings,
    builtInTemplateNames,
    ratios: CUT_SETTING_RATIOS,
    maxTemplatesPerRatio: CUT_SETTING_MAX_TEMPLATE_PER_RATIO,
  });
}

export async function PUT(req: NextRequest) {
  const guard = requireApiAccess(req);
  if (!guard.ok) {
    return Response.json({ ok: false, error: guard.error }, { status: guard.status });
  }
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ ok: false, error: "body 必须是 JSON 对象" }, { status: 400 });
  }

  const normalized = normalizeCutSettings({
    byAppRatio: (body as any).byAppRatio,
    customTemplatePrompts: (body as any).customTemplatePrompts,
    customTemplateThinkingLevels: (body as any).customTemplateThinkingLevels,
  });

  const builtIn = new Set(listBuiltInCutTemplateNames());
  const customNames = new Set(Object.keys(normalized.customTemplatePrompts || {}));
  for (const [appName, byRatio] of Object.entries(normalized.byAppRatio || {})) {
    for (const ratio of CUT_SETTING_RATIOS) {
      const list = Array.isArray(byRatio?.[ratio]) ? byRatio[ratio]! : [];
      if (list.length > CUT_SETTING_MAX_TEMPLATE_PER_RATIO) {
        return Response.json(
          {
            ok: false,
            error: `${appName} ${ratio} 最多允许 ${CUT_SETTING_MAX_TEMPLATE_PER_RATIO} 个模板`,
          },
          { status: 400 }
        );
      }
      for (const name of list) {
        if (!builtIn.has(name) && !customNames.has(name)) {
          return Response.json(
            {
              ok: false,
              error: `模板不存在: ${name}（请先在“函数提示词设置”里新增）`,
            },
            { status: 400 }
          );
        }
      }
    }
  }

  const saved = await saveCutSettingsForUser(guard.user.userId, guard.user.username, normalized);
  return Response.json({
    ok: true,
    settings: saved,
    builtInTemplateNames: listBuiltInCutTemplateNames(),
    ratios: CUT_SETTING_RATIOS,
    maxTemplatesPerRatio: CUT_SETTING_MAX_TEMPLATE_PER_RATIO,
  });
}
