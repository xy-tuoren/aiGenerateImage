"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AutoComplete,
  Button,
  Card,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tabs,
  Typography,
  message
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import AdminShell from "@/app/_components/AdminShell";

type RatioKey = "1:1" | "4:5";
type ThinkingLevel = "High" | "minimal";
type AppRatioConfig = Partial<Record<RatioKey, string[]>>;
type AppRow = { key: string; appName: string; cfg: AppRatioConfig };

type CutSettingsResponse = {
  ok: boolean;
  settings?: {
    byAppRatio?: Record<string, AppRatioConfig>;
    customTemplatePrompts?: Record<string, string>;
    customTemplateThinkingLevels?: Record<string, string>;
  };
  builtInTemplateNames?: string[];
  ratios?: RatioKey[];
  maxTemplatesPerRatio?: number;
  error?: string;
};

const DEFAULT_RATIOS: RatioKey[] = ["1:1", "4:5"];
const DISABLED_TEMPLATE_BY_RATIO: Partial<Record<RatioKey, string[]>> = {
  "4:5": ["stitchLongImage1024"]
};

function normalizeTemplateList(input: unknown, maxCount: number): string[] {
  const list = Array.isArray(input) ? input : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const it of list) {
    const s = String(it || "").trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= maxCount) break;
  }
  return out;
}

function normalizeTemplateListForRatio(
  ratio: RatioKey,
  input: unknown,
  maxCount: number
): string[] {
  const blocked = new Set(DISABLED_TEMPLATE_BY_RATIO[ratio] || []);
  return normalizeTemplateList(input, maxCount).filter(
    (name) => !blocked.has(name)
  );
}

export default function CutSettingsPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [loading, setLoading] = useState(false);
  const [autoSaving, setAutoSaving] = useState(false);
  const [maxPerRatio, setMaxPerRatio] = useState(4);
  const [ratios, setRatios] = useState<RatioKey[]>(DEFAULT_RATIOS);
  const [builtInTemplateNames, setBuiltInTemplateNames] = useState<string[]>(
    []
  );
  const [appNameOptions, setAppNameOptions] = useState<
    Array<{ label: string; value: string }>
  >([]);
  const [byAppRatio, setByAppRatio] = useState<Record<string, AppRatioConfig>>(
    {}
  );
  const [customTemplatePrompts, setCustomTemplatePrompts] = useState<
    Record<string, string>
  >({});
  const [customTemplateThinkingLevels, setCustomTemplateThinkingLevels] =
    useState<Record<string, ThinkingLevel>>({});
  const [newAppName, setNewAppName] = useState("");
  const [newAppRatioConfig, setNewAppRatioConfig] = useState<AppRatioConfig>({
    "1:1": [],
    "4:5": []
  });
  const [newTemplateName, setNewTemplateName] = useState("");
  const [newTemplatePrompt, setNewTemplatePrompt] = useState("");
  const [newTemplateThinkingLevel, setNewTemplateThinkingLevel] =
    useState<ThinkingLevel>("High");
  const [addTemplateModalOpen, setAddTemplateModalOpen] = useState(false);
  const [addAppModalOpen, setAddAppModalOpen] = useState(false);
  const [activeTabKey, setActiveTabKey] = useState("template-table");
  const settingsReadyRef = useRef(false);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchAppNames = useCallback(async () => {
    try {
      const res = await fetch("/api/app-names", { method: "GET" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok || !Array.isArray(data.items)) return;
      setAppNameOptions(
        data.items.map((x: unknown) => {
          const v = String(x || "").trim();
          return { label: v, value: v };
        })
      );
    } catch {
      //
    }
  }, []);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/cut-settings", { method: "GET" });
      const data = (await res
        .json()
        .catch(() => null)) as CutSettingsResponse | null;
      if (!res.ok || !data?.ok) {
        messageApi.error(data?.error || "读取裁图设置失败");
        return;
      }
      const nextRatios = (
        Array.isArray(data.ratios) ? data.ratios : DEFAULT_RATIOS
      ).filter((x): x is RatioKey => x === "1:1" || x === "4:5");
      const nextMax = Number(data.maxTemplatesPerRatio);
      const maxCount =
        Number.isFinite(nextMax) && nextMax > 0 ? Math.floor(nextMax) : 4;
      const srcByApp =
        data.settings?.byAppRatio &&
        typeof data.settings.byAppRatio === "object"
          ? data.settings.byAppRatio
          : {};
      const normalizedByApp: Record<string, AppRatioConfig> = {};
      for (const [appNameRaw, cfgRaw] of Object.entries(srcByApp)) {
        const appName = String(appNameRaw || "")
          .trim()
          .toLowerCase();
        if (!appName) continue;
        const cfg = cfgRaw && typeof cfgRaw === "object" ? cfgRaw : {};
        const row: AppRatioConfig = {};
        for (const ratio of nextRatios) {
          row[ratio] = normalizeTemplateListForRatio(
            ratio,
            (cfg as any)[ratio],
            maxCount
          );
        }
        normalizedByApp[appName] = row;
      }
      const srcPrompts =
        data.settings?.customTemplatePrompts &&
        typeof data.settings.customTemplatePrompts === "object"
          ? data.settings.customTemplatePrompts
          : {};
      const normalizedPrompts: Record<string, string> = {};
      for (const [nameRaw, promptRaw] of Object.entries(srcPrompts)) {
        const name = String(nameRaw || "").trim();
        const prompt = String(promptRaw || "").trim();
        if (!name || !prompt) continue;
        normalizedPrompts[name] = prompt;
      }
      const srcThinkingLevels =
        data.settings?.customTemplateThinkingLevels &&
        typeof data.settings.customTemplateThinkingLevels === "object"
          ? data.settings.customTemplateThinkingLevels
          : {};
      const normalizedThinkingLevels: Record<string, ThinkingLevel> = {};
      for (const name of Object.keys(normalizedPrompts)) {
        const raw = String((srcThinkingLevels as any)[name] || "").trim();
        normalizedThinkingLevels[name] = raw === "minimal" ? "minimal" : "High";
      }
      setRatios(nextRatios.length ? nextRatios : DEFAULT_RATIOS);
      setMaxPerRatio(maxCount);
      setBuiltInTemplateNames(
        Array.isArray(data.builtInTemplateNames)
          ? data.builtInTemplateNames
              .map((x) => String(x || "").trim())
              .filter(Boolean)
          : []
      );
      setByAppRatio(normalizedByApp);
      setCustomTemplatePrompts(normalizedPrompts);
      setCustomTemplateThinkingLevels(normalizedThinkingLevels);
      settingsReadyRef.current = true;
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [messageApi]);

  useEffect(() => {
    void fetchAppNames();
    void fetchSettings();
  }, [fetchAppNames, fetchSettings]);

  const templateOptions = useMemo(() => {
    const set = new Set<string>();
    for (const n of builtInTemplateNames) set.add(n);
    for (const n of Object.keys(customTemplatePrompts || {})) set.add(n);
    return [...set]
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({ label: name, value: name }));
  }, [builtInTemplateNames, customTemplatePrompts]);

  const templateOptionsByRatio = useMemo(
    () =>
      ratios.reduce<
        Record<
          RatioKey,
          Array<{ label: string; value: string; disabled?: boolean }>
        >
      >(
        (acc, ratio) => {
          const blocked = new Set(DISABLED_TEMPLATE_BY_RATIO[ratio] || []);
          acc[ratio] = templateOptions.map((opt) => ({
            ...opt,
            disabled: blocked.has(opt.value)
          }));
          return acc;
        },
        { "1:1": [], "4:5": [] }
      ),
    [ratios, templateOptions]
  );

  const appRows = useMemo<AppRow[]>(
    () =>
      Object.keys(byAppRatio || {})
        .map((x) => String(x || "").trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b))
        .map((appName) => ({
          key: appName,
          appName,
          cfg: byAppRatio[appName] || {}
        })),
    [byAppRatio]
  );

  const appColumns = useMemo<ColumnsType<AppRow>>(
    () => [
      {
        title: "appName",
        dataIndex: "appName",
        key: "appName",
        width: 220,
        align: "center"
      },
      ...ratios.map((ratio) => ({
        title: ratio,
        key: ratio,
        width: 280,
        align: "center" as const,
        render: (_v: unknown, row: AppRow) => {
          const current = normalizeTemplateListForRatio(
            ratio,
            row.cfg?.[ratio],
            maxPerRatio
          );
          return (
            <Select
              mode="multiple"
              allowClear
              style={{ width: "100%" }}
              value={current}
              options={templateOptionsByRatio[ratio]}
              placeholder={`最多 ${maxPerRatio} 个`}
              onChange={(vals: string[]) => {
                const next = normalizeTemplateListForRatio(
                  ratio,
                  vals,
                  maxPerRatio
                );
                if (Array.isArray(vals) && vals.length > maxPerRatio) {
                  messageApi.warning(`最多选择 ${maxPerRatio} 个函数`);
                }
                if (
                  ratio === "4:5" &&
                  Array.isArray(vals) &&
                  vals.includes("stitchLongImage1024")
                ) {
                  messageApi.warning("4:5 比例不支持 stitchLongImage1024");
                }
                setByAppRatio((prev) => ({
                  ...prev,
                  [row.appName]: {
                    ...(prev[row.appName] || {}),
                    [ratio]: next
                  }
                }));
              }}
            />
          );
        }
      })),
      {
        title: "操作",
        key: "actions",
        width: 100,
        align: "center",
        render: (_v: unknown, row: AppRow) => (
          <Button
            danger
            size="small"
            icon={<DeleteOutlined />}
            onClick={() =>
              setByAppRatio((prev) => {
                const next = { ...prev };
                delete next[row.appName];
                return next;
              })
            }
          >
            删除
          </Button>
        )
      }
    ],
    [maxPerRatio, messageApi, ratios, templateOptionsByRatio]
  );

  const customPromptRows = useMemo(
    () =>
      Object.keys(customTemplatePrompts || {})
        .sort((a, b) => a.localeCompare(b))
        .map((name) => ({
          key: name,
          name,
          prompt: String(customTemplatePrompts[name] || ""),
          thinkingLevel: customTemplateThinkingLevels[name] || "High"
        })),
    [customTemplatePrompts, customTemplateThinkingLevels]
  );

  const handleAddTemplate = useCallback(() => {
    const name = String(newTemplateName || "").trim();
    const prompt = String(newTemplatePrompt || "").trim();
    if (!name) {
      messageApi.warning("请先输入函数名");
      return;
    }
    if (!prompt) {
      messageApi.warning("请先输入提示词");
      return;
    }
    setCustomTemplatePrompts((prev) => ({
      ...prev,
      [name]: prompt
    }));
    setCustomTemplateThinkingLevels((prev) => ({
      ...prev,
      [name]: newTemplateThinkingLevel
    }));
    setNewTemplateName("");
    setNewTemplatePrompt("");
    setNewTemplateThinkingLevel("High");
    setAddTemplateModalOpen(false);
  }, [
    messageApi,
    newTemplateName,
    newTemplatePrompt,
    newTemplateThinkingLevel
  ]);

  const handleAddApp = useCallback(() => {
    const appName = String(newAppName || "")
      .trim()
      .toLowerCase();
    if (!appName) {
      messageApi.warning("请先输入 appName");
      return;
    }
    if (byAppRatio[appName]) {
      messageApi.warning("该 appName 已存在");
      return;
    }
    const initialCfg: AppRatioConfig = {};
    for (const ratio of ratios) {
      initialCfg[ratio] = normalizeTemplateListForRatio(
        ratio,
        newAppRatioConfig[ratio],
        maxPerRatio
      );
    }
    setByAppRatio((prev) => ({ ...prev, [appName]: initialCfg }));
    setNewAppName("");
    setNewAppRatioConfig({ "1:1": [], "4:5": [] });
    setAddAppModalOpen(false);
  }, [
    byAppRatio,
    maxPerRatio,
    messageApi,
    newAppName,
    newAppRatioConfig,
    ratios
  ]);

  useEffect(() => {
    if (!settingsReadyRef.current) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(async () => {
      setAutoSaving(true);
      try {
        const payload = {
          byAppRatio,
          customTemplatePrompts,
          customTemplateThinkingLevels
        };
        const res = await fetch("/api/cut-settings", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload)
        });
        const data = (await res
          .json()
          .catch(() => null)) as CutSettingsResponse | null;
        if (!res.ok || !data?.ok) {
          messageApi.error(data?.error || "自动保存失败");
          return;
        }
      } catch (e) {
        messageApi.error(e instanceof Error ? e.message : String(e));
      } finally {
        setAutoSaving(false);
      }
    }, 500);
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
  }, [
    byAppRatio,
    customTemplatePrompts,
    customTemplateThinkingLevels,
    messageApi
  ]);

  return (
    <AdminShell defaultSelectedKey="/cut-settings" headerTitle="裁图设置">
      {contextHolder}
      <Space orientation="vertical" size={12} style={{ width: "100%" }}>
        <Card title="函数提示词与 appName 配置（账户内）">
          <Space orientation="vertical" size={4} style={{ width: "100%" }}>
            <Typography.Text
              type="secondary"
              style={{ display: "block", margin: 0, lineHeight: 1 }}
            >
              每个 app 的每个比例最多 {maxPerRatio} 个函数；未配置 appName
              时走系统默认裁图模板。
              {autoSaving ? " 自动保存中..." : " 修改后自动保存。"}
            </Typography.Text>
            <Tabs
              activeKey={activeTabKey}
              onChange={setActiveTabKey}
              tabBarExtraContent={
                activeTabKey === "app-table" ? (
                  <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    onClick={() => {
                      setNewAppName("");
                      setNewAppRatioConfig({ "1:1": [], "4:5": [] });
                      setAddAppModalOpen(true);
                    }}
                  >
                    新增 appName
                  </Button>
                ) : (
                  <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    onClick={() => {
                      setNewTemplateName("");
                      setNewTemplatePrompt("");
                      setNewTemplateThinkingLevel("High");
                      setAddTemplateModalOpen(true);
                    }}
                  >
                    新增函数
                  </Button>
                )
              }
              items={[
                {
                  key: "template-table",
                  label: "函数提示词",
                  children: (
                    <Space
                      orientation="vertical"
                      size={8}
                      style={{ width: "100%" }}
                    >
                      <Table
                        size="small"
                        rowKey="key"
                        loading={loading}
                        dataSource={customPromptRows}
                        pagination={false}
                        columns={[
                          {
                            title: "函数名",
                            dataIndex: "name",
                            key: "name",
                            width: 240,
                            align: "center"
                          },
                          {
                            title: "提示词",
                            key: "prompt",
                            render: (_v, row) => (
                              <Input.TextArea
                                rows={3}
                                value={String(row.prompt || "")}
                                onChange={(e) =>
                                  setCustomTemplatePrompts((prev) => ({
                                    ...prev,
                                    [row.name]: e.target.value
                                  }))
                                }
                              />
                            )
                          },
                          {
                            title: "思考等级",
                            key: "thinkingLevel",
                            width: 100,
                            align: "center",
                            render: (_v, row) => (
                              <Select
                                style={{ width: "100%" }}
                                value={row.thinkingLevel || "High"}
                                options={[
                                  { label: "High", value: "High" },
                                  { label: "minimal", value: "minimal" }
                                ]}
                                onChange={(v: ThinkingLevel) =>
                                  setCustomTemplateThinkingLevels((prev) => ({
                                    ...prev,
                                    [row.name]: v
                                  }))
                                }
                              />
                            )
                          },
                          {
                            title: "操作",
                            key: "actions",
                            width: 100,
                            align: "center",
                            render: (_v, row) => (
                              <Button
                                danger
                                size="small"
                                icon={<DeleteOutlined />}
                                onClick={() => {
                                  setCustomTemplatePrompts((prev) => {
                                    const next = { ...prev };
                                    delete next[row.name];
                                    return next;
                                  });
                                  setCustomTemplateThinkingLevels((prev) => {
                                    const next = { ...prev };
                                    delete next[row.name];
                                    return next;
                                  });
                                }}
                              >
                                删除
                              </Button>
                            )
                          }
                        ]}
                      />
                    </Space>
                  )
                },
                {
                  key: "app-table",
                  label: "appName 配置",
                  children: (
                    <Space
                      orientation="vertical"
                      size={8}
                      style={{ width: "100%" }}
                    >
                      <Table
                        size="small"
                        rowKey="key"
                        loading={loading}
                        dataSource={appRows}
                        pagination={false}
                        tableLayout="fixed"
                        columns={appColumns}
                      />
                    </Space>
                  )
                }
              ]}
            />
          </Space>
        </Card>
      </Space>

      <Modal
        title="新增函数"
        open={addTemplateModalOpen}
        okText="确认新增"
        cancelText="取消"
        onOk={handleAddTemplate}
        onCancel={() => {
          setNewTemplateName("");
          setNewTemplatePrompt("");
          setNewTemplateThinkingLevel("High");
          setAddTemplateModalOpen(false);
        }}
      >
        <Space orientation="vertical" size={8} style={{ width: "100%" }}>
          <Input
            placeholder="新函数名（例如：myCutTemplateA）"
            value={newTemplateName}
            onChange={(e) => setNewTemplateName(e.target.value)}
          />
          <Input.TextArea
            rows={4}
            placeholder="新函数提示词，可用变量：{{appName}} {{lang}}（系统会自动补充比例描述）"
            value={newTemplatePrompt}
            onChange={(e) => setNewTemplatePrompt(e.target.value)}
          />
          <Select
            value={newTemplateThinkingLevel}
            style={{ minWidth: 100 }}
            options={[
              { label: "High", value: "High" },
              { label: "minimal", value: "minimal" }
            ]}
            onChange={(v: ThinkingLevel) => setNewTemplateThinkingLevel(v)}
            placeholder="思考等级"
          />
        </Space>
      </Modal>

      <Modal
        title="新增 appName"
        open={addAppModalOpen}
        okText="确认新增"
        cancelText="取消"
        onOk={handleAddApp}
        onCancel={() => {
          setNewAppName("");
          setNewAppRatioConfig({ "1:1": [], "4:5": [] });
          setAddAppModalOpen(false);
        }}
      >
        <Space orientation="vertical" size={10} style={{ width: "100%" }}>
          <AutoComplete
            value={newAppName}
            options={appNameOptions}
            onChange={(v) => setNewAppName(v)}
            style={{ width: "100%" }}
            placeholder="输入或选择 appName"
            filterOption={(input, option) =>
              String(option?.value || "")
                .toLowerCase()
                .includes(String(input || "").toLowerCase())
            }
          />
          {ratios.map((ratio) => (
            <Select
              key={ratio}
              mode="multiple"
              allowClear
              style={{ width: "100%" }}
              value={normalizeTemplateListForRatio(
                ratio,
                newAppRatioConfig[ratio],
                maxPerRatio
              )}
              options={templateOptionsByRatio[ratio]}
              placeholder={`${ratio} 选择函数（最多 ${maxPerRatio} 个）`}
              onChange={(vals: string[]) => {
                const next = normalizeTemplateListForRatio(
                  ratio,
                  vals,
                  maxPerRatio
                );
                if (Array.isArray(vals) && vals.length > maxPerRatio) {
                  messageApi.warning(`最多选择 ${maxPerRatio} 个函数`);
                }
                if (
                  ratio === "4:5" &&
                  Array.isArray(vals) &&
                  vals.includes("stitchLongImage1024")
                ) {
                  messageApi.warning("4:5 比例不支持 stitchLongImage1024");
                }
                setNewAppRatioConfig((prev) => ({
                  ...prev,
                  [ratio]: next
                }));
              }}
            />
          ))}
        </Space>
      </Modal>
    </AdminShell>
  );
}
