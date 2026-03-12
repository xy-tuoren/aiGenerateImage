"use client";

import { useState, useRef, useEffect } from "react";
import { Image as AntImage, message } from "antd";
import AdminShell from "@/app/_components/AdminShell";
import {
  buildWelcomeMessage,
  DEFAULT_IMAGE_GENERATION_SETTINGS,
  NEW_CONVERSATION_SETTINGS_KEY,
  type ConversationItem,
  type ImageGenerationSettings,
  type Message,
  type PendingImage
} from "./_lib/types";
import { ConversationSidebar } from "./_components/ConversationSidebar";
import { MessagePanel } from "./_components/MessagePanel";
import { ComposerPanel } from "./_components/ComposerPanel";
import { GallerySaveModal } from "./_components/GallerySaveModal";

export default function MakeImagePage() {
  const MAKE_IMAGE_PAGE_CACHE_KEY = "make-image-page-cache-v1";
  const [messages, setMessages] = useState<Message[]>([buildWelcomeMessage()]);
  const [inputValue, setInputValue] = useState("");
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeGeneratingConversationId, setActiveGeneratingConversationId] =
    useState<string | null>(null);
  const [enableImageSettings, setEnableImageSettings] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<string | undefined>(undefined);
  const [imageSize, setImageSize] = useState<string | undefined>(undefined);
  const [thinkingLevel, setThinkingLevel] = useState<"high" | "minimal">(
    "minimal"
  );
  const [temperature, setTemperature] = useState<0.5 | 1 | 1.5 | 2>(1);
  const [outputCount, setOutputCount] = useState<number>(1);
  const [conversationItems, setConversationItems] = useState<
    ConversationItem[]
  >([]);
  const [conversationListLoading, setConversationListLoading] = useState(false);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [conversationListCollapsed, setConversationListCollapsed] =
    useState(false);
  const [currentConversationId, setCurrentConversationId] = useState<
    string | null
  >(null);
  const [conversationSettingsMap, setConversationSettingsMap] = useState<
    Record<string, ImageGenerationSettings>
  >({});
  const [gallerySaveModalOpen, setGallerySaveModalOpen] = useState(false);
  const [gallerySaveMessageId, setGallerySaveMessageId] = useState<string>("");
  const [galleryAppName, setGalleryAppName] = useState("");
  const [galleryLang, setGalleryLang] = useState("");
  const [galleryAppNameOptions, setGalleryAppNameOptions] = useState<
    Array<{ value: string; label: string }>
  >([]);
  const [gallerySaving, setGallerySaving] = useState(false);
  const [gallerySaveIndices, setGallerySaveIndices] = useState<number[]>([]);
  const [conversationPreviewVisible, setConversationPreviewVisible] =
    useState(false);
  const [conversationPreviewCurrent, setConversationPreviewCurrent] =
    useState(0);
  const [editTarget, setEditTarget] = useState<{
    messageId: string;
    indices: number[];
  } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const generationAbortRef = useRef<AbortController | null>(null);
  const leftWhileGeneratingRef = useRef(false);
  const didAutoOpenFirstConversationRef = useRef(false);
  const shouldAutoOpenLatestOnMountRef = useRef(true);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const conversationListPollTimerRef = useRef<ReturnType<
    typeof setInterval
  > | null>(null);
  const isGeneratingRef = useRef(false);
  const [storageReady, setStorageReady] = useState(false);
  const conversationSettingsMapRef = useRef<
    Record<string, ImageGenerationSettings>
  >({});
  const normalizePendingImages = (items: any): PendingImage[] => {
    if (!Array.isArray(items)) return [];
    return items
      .map((item: any) => {
        const mimeType =
          String(item?.mimeType || "image/png").trim() || "image/png";
        const base64 = String(item?.base64 || "").trim();
        if (!base64) return null;
        const rawUrl = String(item?.url || "").trim();
        const url =
          rawUrl || `data:${mimeType};base64,${base64.split(",")[1] || base64}`;
        return {
          url,
          base64,
          mimeType
        } as PendingImage;
      })
      .filter((x: PendingImage | null): x is PendingImage => Boolean(x));
  };
  const normalizeMessages = (items: any): Message[] => {
    if (!Array.isArray(items)) return [];
    return items.map(
      (item: any, index: number): Message => ({
        id: String(item?.id || `restored-${index}`),
        role:
          item?.role === "user" ? ("user" as const) : ("assistant" as const),
        content: item?.content ? String(item.content) : "",
        imageBase64: item?.imageBase64 ? String(item.imageBase64) : undefined,
        imageUrl: item?.imageUrl ? String(item.imageUrl) : undefined,
        imageMimeType: item?.imageMimeType
          ? String(item.imageMimeType)
          : undefined,
        loading: Boolean(item?.loading),
        generatedImages: Array.isArray(item?.generatedImages)
          ? item.generatedImages
              .map((x: any) => ({
                imageBase64: x?.imageBase64 ? String(x.imageBase64) : undefined,
                imageUrl: x?.imageUrl ? String(x.imageUrl) : undefined,
                imageMimeType: String(x?.imageMimeType || "image/jpeg")
              }))
              .filter((x: any) => x.imageBase64 || x.imageUrl)
          : undefined,
        referenceImages: normalizePendingImages(item?.referenceImages)
      })
    );
  };
  const normalizeServerGenerationSettings = (
    input: any
  ): ImageGenerationSettings | undefined => {
    if (!input || typeof input !== "object") return undefined;
    const rawThinkingLevel = (() => {
      if (!("thinkingLevel" in input)) return "minimal";
      const s = String((input as any).thinkingLevel || "")
        .trim()
        .toLowerCase();
      return s === "minimal" ? "minimal" : "high";
    })();
    const rawTemperature = Number(input.temperature);
    const temperature: 0.5 | 1 | 1.5 | 2 =
      rawTemperature === 0.5 ||
      rawTemperature === 1 ||
      rawTemperature === 1.5 ||
      rawTemperature === 2
        ? (rawTemperature as 0.5 | 1 | 1.5 | 2)
        : 1;
    const rawOutputCount = Number(input.outputCount);
    const outputCount = Number.isFinite(rawOutputCount)
      ? Math.max(1, Math.min(4, Math.floor(rawOutputCount)))
      : 1;
    const aspectRatioRaw = String(input.aspectRatio || "").trim();
    const imageSizeRaw = String(input.imageSize || "").trim();
    return {
      enableImageSettings: Boolean(input.enableImageSettings),
      aspectRatio: aspectRatioRaw || undefined,
      imageSize: imageSizeRaw || undefined,
      thinkingLevel: rawThinkingLevel,
      temperature,
      outputCount
    };
  };
  const applyGenerationSettings = (settings?: ImageGenerationSettings) => {
    const resolved = settings || DEFAULT_IMAGE_GENERATION_SETTINGS;
    setEnableImageSettings(resolved.enableImageSettings);
    setAspectRatio(resolved.aspectRatio);
    setImageSize(resolved.imageSize);
    setThinkingLevel(resolved.thinkingLevel);
    setTemperature(resolved.temperature);
    setOutputCount(resolved.outputCount);
  };
  const mapReferenceImagesFromApi = (m: any): PendingImage[] | undefined => {
    if (!Array.isArray(m?.referenceImages)) return undefined;
    const refs = m.referenceImages
      .map((x: any) => {
        const mimeType = String(x?.imageMimeType || "image/png") || "image/png";
        const pureBase64 = String(x?.imageBase64 || "").trim();
        const imageUrl = String(x?.imageUrl || "").trim();
        if (!pureBase64 && !imageUrl) return null;
        const dataUrl = pureBase64
          ? `data:${mimeType};base64,${pureBase64}`
          : imageUrl;
        return {
          url: dataUrl,
          base64: dataUrl,
          mimeType
        } as PendingImage;
      })
      .filter((x: PendingImage | null): x is PendingImage => Boolean(x));
    return refs.length > 0 ? refs : undefined;
  };
  const bindSettingsToConversation = (conversationId: string) => {
    if (!conversationId) return;
    setConversationSettingsMap((prev) => {
      if (prev[conversationId]) return prev;
      const draft = prev[NEW_CONVERSATION_SETTINGS_KEY];
      return {
        ...prev,
        [conversationId]: draft || {
          enableImageSettings,
          aspectRatio,
          imageSize,
          thinkingLevel,
          temperature,
          outputCount
        }
      };
    });
  };
  const currentConversationKey =
    currentConversationId || NEW_CONVERSATION_SETTINGS_KEY;
  const isCurrentConversationGenerating =
    isGenerating && activeGeneratingConversationId === currentConversationKey;

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, pendingImages]);

  useEffect(() => {
    const settingsKey = currentConversationId || NEW_CONVERSATION_SETTINGS_KEY;
    setConversationSettingsMap((prev) => ({
      ...prev,
      [settingsKey]: {
        enableImageSettings,
        aspectRatio,
        imageSize,
        thinkingLevel,
        temperature,
        outputCount
      }
    }));
  }, [
    currentConversationId,
    enableImageSettings,
    aspectRatio,
    imageSize,
    thinkingLevel,
    temperature,
    outputCount
  ]);

  useEffect(() => {
    conversationSettingsMapRef.current = conversationSettingsMap;
  }, [conversationSettingsMap]);
  useEffect(() => {
    isGeneratingRef.current = isGenerating;
  }, [isGenerating]);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(MAKE_IMAGE_PAGE_CACHE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw || "{}");
      const restoredMessages = normalizeMessages(parsed?.messages);
      const restoredPendingImages = normalizePendingImages(
        parsed?.pendingImages
      );
      const restoredInput = String(parsed?.inputValue || "");
      const restoredConversationId = parsed?.currentConversationId
        ? String(parsed.currentConversationId)
        : null;
      if (restoredMessages.length > 0) setMessages(restoredMessages);
      if (restoredPendingImages.length > 0)
        setPendingImages(restoredPendingImages);
      if (restoredInput) setInputValue(restoredInput);
      if (restoredConversationId)
        setCurrentConversationId(restoredConversationId);
      if (typeof parsed?.conversationListCollapsed === "boolean") {
        setConversationListCollapsed(Boolean(parsed.conversationListCollapsed));
      }
      if (
        parsed?.generationSettings &&
        typeof parsed.generationSettings === "object"
      ) {
        const restoredSettings = normalizeServerGenerationSettings(
          parsed.generationSettings
        );
        if (restoredSettings) {
          applyGenerationSettings(restoredSettings);
        }
      }
      if (
        parsed?.conversationSettingsMap &&
        typeof parsed.conversationSettingsMap === "object"
      ) {
        setConversationSettingsMap(parsed.conversationSettingsMap);
      }
    } catch {
    } finally {
      setStorageReady(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!storageReady) return;
    try {
      const payload = {
        messages: messages.map((msg) => ({
          id: msg.id,
          role: msg.role,
          content: msg.content || "",
          loading: Boolean(msg.loading),
          imageBase64: msg.imageBase64,
          imageUrl: msg.imageUrl,
          imageMimeType: msg.imageMimeType,
          generatedImages: msg.generatedImages,
          referenceImages: (msg.referenceImages || []).map((img) => ({
            url: img.url,
            base64: img.base64,
            mimeType: img.mimeType
          }))
        })),
        inputValue,
        pendingImages: pendingImages.map((img) => ({
          url: img.url,
          base64: img.base64,
          mimeType: img.mimeType
        })),
        currentConversationId,
        conversationListCollapsed,
        generationSettings: {
          enableImageSettings,
          aspectRatio,
          imageSize,
          thinkingLevel,
          temperature,
          outputCount
        },
        conversationSettingsMap
      };
      sessionStorage.setItem(
        MAKE_IMAGE_PAGE_CACHE_KEY,
        JSON.stringify(payload)
      );
    } catch {}
  }, [
    storageReady,
    messages,
    inputValue,
    pendingImages,
    currentConversationId,
    conversationListCollapsed,
    enableImageSettings,
    aspectRatio,
    imageSize,
    thinkingLevel,
    temperature,
    outputCount,
    conversationSettingsMap
  ]);

  const hasLoadingMessage = messages.some((m) => Boolean(m.loading));
  useEffect(() => {
    if (!currentConversationId) return;
    if (!hasLoadingMessage) return;
    // While local streaming is active, NDJSON events already drive message updates.
    if (isGeneratingRef.current) return;
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    const cid = currentConversationId;
    pollTimerRef.current = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/image-edit/chat?conversationId=${encodeURIComponent(cid)}`,
          { method: "GET", cache: "no-store" }
        );
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok) return;
        const apiMessages = Array.isArray(data.messages) ? data.messages : [];
        const mappedMessages: Message[] = apiMessages.map(
          (m: any, i: number) => ({
            id: String(m.id || `${cid}-${i}`),
            role: m.role === "user" ? "user" : "assistant",
            content: String(m.text || ""),
            loading: Boolean(m.loading),
            imageBase64: m.imageBase64 ? String(m.imageBase64) : undefined,
            imageUrl: m.imageUrl ? String(m.imageUrl) : undefined,
            imageMimeType: m.imageMimeType
              ? String(m.imageMimeType)
              : undefined,
            referenceImages: mapReferenceImagesFromApi(m),
            generatedImages: Array.isArray(m.generatedImages)
              ? m.generatedImages
                  .map((x: any) => ({
                    imageBase64: x?.imageBase64
                      ? String(x.imageBase64)
                      : undefined,
                    imageUrl: x?.imageUrl ? String(x.imageUrl) : undefined,
                    imageMimeType: String(x?.imageMimeType || "image/jpeg")
                  }))
                  .filter((x: any) => x.imageBase64 || x.imageUrl)
              : undefined
          })
        );
        setMessages(
          mappedMessages.length > 0 ? mappedMessages : [buildWelcomeMessage()]
        );
        const stillLoading = mappedMessages.some((x) => Boolean(x.loading));
        if (!stillLoading && pollTimerRef.current) {
          clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
        }
      } catch {}
    }, 3000);
    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [currentConversationId, hasLoadingMessage, isGenerating]);

  const hasGeneratingConversation = conversationItems.some((x) =>
    Boolean(x?.isGenerating)
  );
  useEffect(() => {
    if (!hasGeneratingConversation) {
      if (conversationListPollTimerRef.current) {
        clearInterval(conversationListPollTimerRef.current);
        conversationListPollTimerRef.current = null;
      }
      return;
    }
    if (isGenerating) return;
    if (conversationListPollTimerRef.current) {
      clearInterval(conversationListPollTimerRef.current);
    }
    conversationListPollTimerRef.current = setInterval(() => {
      void refreshConversationList();
    }, 5000);
    return () => {
      if (conversationListPollTimerRef.current) {
        clearInterval(conversationListPollTimerRef.current);
        conversationListPollTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasGeneratingConversation]);

  const refreshConversationList = async (preferConversationId?: string) => {
    setConversationListLoading(true);
    try {
      const res = await fetch("/api/image-edit/chat", {
        method: "GET",
        cache: "no-store"
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "加载会话列表失败");
      }
      const items = Array.isArray(data.items) ? data.items : [];
      setConversationItems(items);
      if (items.length > 0) {
        setConversationSettingsMap((prev) => {
          const next = { ...prev };
          for (const item of items) {
            const cid = String(item?.id || "").trim();
            if (!cid) continue;
            const parsed = normalizeServerGenerationSettings(
              item?.generationSettings
            );
            if (parsed) next[cid] = parsed;
          }
          return next;
        });
      }
      if (
        !preferConversationId &&
        shouldAutoOpenLatestOnMountRef.current &&
        items.length > 0
      ) {
        shouldAutoOpenLatestOnMountRef.current = false;
        didAutoOpenFirstConversationRef.current = true;
        await openConversation(items[0].id);
        return;
      }
      if (preferConversationId) {
        applyGenerationSettings(
          conversationSettingsMapRef.current[preferConversationId] ||
            DEFAULT_IMAGE_GENERATION_SETTINGS
        );
        setCurrentConversationId(preferConversationId);
        didAutoOpenFirstConversationRef.current = true;
      } else if (
        !currentConversationId &&
        items.length > 0 &&
        !didAutoOpenFirstConversationRef.current
      ) {
        didAutoOpenFirstConversationRef.current = true;
        await openConversation(items[0].id);
      }
    } catch (e: any) {
      message.error(e?.message || "加载会话列表失败");
    } finally {
      setConversationListLoading(false);
    }
  };

  const openConversation = async (conversationId: string) => {
    if (!conversationId) return;
    setConversationLoading(true);
    try {
      if (isGenerating) leftWhileGeneratingRef.current = true;
      setEditTarget(null);
      const res = await fetch(
        `/api/image-edit/chat?conversationId=${encodeURIComponent(
          conversationId
        )}`,
        {
          method: "GET",
          cache: "no-store"
        }
      );
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "加载会话失败");
      }
      const apiMessages = Array.isArray(data.messages) ? data.messages : [];
      const mappedMessages: Message[] = apiMessages.map(
        (m: any, i: number) => ({
          id: String(m.id || `${conversationId}-${i}`),
          role: m.role === "user" ? "user" : "assistant",
          content: String(m.text || ""),
          loading: Boolean(m.loading),
          imageBase64: m.imageBase64 ? String(m.imageBase64) : undefined,
          imageUrl: m.imageUrl ? String(m.imageUrl) : undefined,
          imageMimeType: m.imageMimeType ? String(m.imageMimeType) : undefined,
          referenceImages: mapReferenceImagesFromApi(m),
          generatedImages: Array.isArray(m.generatedImages)
            ? m.generatedImages
                .map((x: any) => ({
                  imageBase64: x?.imageBase64
                    ? String(x.imageBase64)
                    : undefined,
                  imageUrl: x?.imageUrl ? String(x.imageUrl) : undefined,
                  imageMimeType: String(x?.imageMimeType || "image/jpeg")
                }))
                .filter((x: any) => x.imageBase64 || x.imageUrl)
            : undefined
        })
      );
      setMessages(
        mappedMessages.length > 0 ? mappedMessages : [buildWelcomeMessage()]
      );
      const serverSettings = normalizeServerGenerationSettings(
        data?.conversation?.generationSettings
      );
      const finalSettings =
        serverSettings ||
        conversationSettingsMapRef.current[conversationId] ||
        DEFAULT_IMAGE_GENERATION_SETTINGS;
      applyGenerationSettings(finalSettings);
      if (serverSettings) {
        setConversationSettingsMap((prev) => ({
          ...prev,
          [conversationId]: serverSettings
        }));
      }
      setCurrentConversationId(conversationId);
      setInputValue("");
      setPendingImages([]);
    } catch (e: any) {
      message.error(e?.message || "加载会话失败");
    } finally {
      setConversationLoading(false);
    }
  };

  useEffect(() => {
    if (!storageReady) return;
    refreshConversationList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageReady]);

  useEffect(() => {
    const loadAppNames = async () => {
      try {
        const res = await fetch("/api/app-names", { method: "GET" });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok || !Array.isArray(data?.items)) return;
        const options = data.items
          .map((x: any) => String(x || "").trim())
          .filter(Boolean)
          .map((x: string) => ({ label: x, value: x }));
        setGalleryAppNameOptions(options);
      } catch {}
    };
    loadAppNames();
  }, []);

  const fileToPendingImage = (file: File): Promise<PendingImage> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const base64Data = String(e.target?.result || "");
        resolve({
          url: URL.createObjectURL(file),
          file,
          base64: base64Data,
          mimeType: file.type || "image/png"
        });
      };
      reader.onerror = () => reject(new Error("读取图片失败"));
      reader.readAsDataURL(file);
    });

  const urlToPendingImage = async (url: string): Promise<PendingImage> => {
    const u = String(url || "").trim();
    if (!u) throw new Error("empty url");
    if (u.startsWith("data:")) {
      const m = u.match(/^data:([^;]+);base64,/i);
      const mimeType = String(m?.[1] || "image/png").trim() || "image/png";
      return { url: u, base64: u, mimeType };
    }
    const res = await fetch(u, { method: "GET", cache: "no-store" });
    if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
    const blob = await res.blob();
    const mimeType = String(blob.type || "").trim() || "image/png";
    const base64Data: string = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(String(e.target?.result || ""));
      reader.onerror = () => reject(new Error("read blob failed"));
      reader.readAsDataURL(blob);
    });
    return {
      url: u,
      base64: base64Data,
      mimeType
    };
  };

  const addReferenceImagesFromUrls = async (urls: string[]) => {
    const list = Array.isArray(urls) ? urls : [];
    const cleaned = list.map((x) => String(x || "").trim()).filter(Boolean);
    if (!cleaned.length) return;
    const pending = await Promise.all(
      cleaned.map((u) => urlToPendingImage(u).catch(() => null))
    );
    const imgs = pending.filter((x: PendingImage | null): x is PendingImage =>
      Boolean(x)
    );
    if (!imgs.length) {
      message.error("未识别到可用的图片拖拽内容");
      return;
    }
    setPendingImages((prev) => {
      const existing = new Set(prev.map((p) => p.base64));
      const next = [...prev];
      for (const img of imgs) {
        if (existing.has(img.base64)) continue;
        existing.add(img.base64);
        next.push(img);
      }
      return next;
    });
  };

  const handleUpload = (file: File) => {
    fileToPendingImage(file)
      .then((img) => {
        setPendingImages((prev) => [...prev, img]);
      })
      .catch(() => {
        message.error("读取图片失败");
      });
    return false; // Prevent default upload behavior
  };

  const removePendingImage = (index: number) => {
    setPendingImages((prev) => {
      const newImgs = [...prev];
      URL.revokeObjectURL(newImgs[index].url);
      newImgs.splice(index, 1);
      return newImgs;
    });
  };

  const sendMessage = async (
    prompt: string,
    referenceImages: PendingImage[]
  ) => {
    if (
      (!prompt.trim() && referenceImages.length === 0) ||
      isCurrentConversationGenerating ||
      conversationLoading
    )
      return;
    if (isGenerating && !isCurrentConversationGenerating) {
      message.warning("当前有其他会话正在生成，请稍候再发送");
      return;
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: prompt,
      referenceImages: [...referenceImages]
    };

    const safeOutputCount = Math.max(1, Math.min(4, Number(outputCount) || 1));
    const assistantMessageId = `${Date.now()}-assistant`;
    const activeEditTarget =
      editTarget?.messageId && editTarget.indices.length ? editTarget : null;
    const assistantMessage: Message = {
      id: assistantMessageId,
      role: "assistant",
      content:
        safeOutputCount > 1
          ? `正在思考与生成中... (1/${safeOutputCount})`
          : "正在思考与生成中...",
      loading: true
    };

    setMessages((prev) => [...prev, userMessage, assistantMessage]);
    setInputValue("");
    setPendingImages([]);
    setActiveGeneratingConversationId(currentConversationKey);
    setIsGenerating(true);

    try {
      try {
        generationAbortRef.current?.abort();
      } catch {}
      const abortController = new AbortController();
      generationAbortRef.current = abortController;
      leftWhileGeneratingRef.current = false;

      // Build history
      const history = messages
        .filter((m) => !m.loading && m.id !== "welcome")
        .map((m) => ({
          role: m.role,
          text: m.content,
          imageBase64: m.imageBase64,
          imageMimeType: m.imageMimeType
        }));

      // Add current user message to history, wait, we don't need to add it to history,
      // the endpoint takes `prompt` and `referenceImageInline` directly for the current turn.
      const referenceImageInline = userMessage.referenceImages?.map((img) => {
        // Remove 'data:image/png;base64,' prefix
        const base64Clean = img.base64.split(",")[1] || img.base64;
        return {
          data: base64Clean,
          mimeType: img.mimeType
        };
      });

      let latestConversationId = currentConversationId || undefined;
      const generatedImages: Array<{
        imageBase64?: string;
        imageUrl?: string;
        imageMimeType: string;
      }> = [];
      let lastAssistantText = "";
      let assistantMessageIdFromServer = "";
      const shouldProgressivelyRender =
        safeOutputCount > 1 && !activeEditTarget;
      const requestCount = shouldProgressivelyRender ? safeOutputCount : 1;

      for (let reqIndex = 0; reqIndex < requestCount; reqIndex += 1) {
        if (!leftWhileGeneratingRef.current) {
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMessageId
                ? {
                    ...msg,
                    loading: true,
                    content: shouldProgressivelyRender
                      ? `正在思考与生成中... (${
                          reqIndex + 1
                        }/${safeOutputCount})`
                      : msg.content,
                    imageBase64: generatedImages[0]?.imageBase64,
                    imageMimeType:
                      generatedImages[0]?.imageMimeType || "image/jpeg",
                    generatedImages: [...generatedImages]
                  }
                : msg
            )
          );
        }

        const res = await fetch("/api/image-edit/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          signal: abortController.signal,
          body: JSON.stringify({
            prompt: userMessage.content || "请参考图片进行处理",
            referenceImageInline,
            history,
            thinkingLevel,
            temperature,
            enableImageSettings,
            outputCount: shouldProgressivelyRender ? 1 : safeOutputCount,
            ...(enableImageSettings && aspectRatio ? { aspectRatio } : {}),
            ...(enableImageSettings && imageSize ? { imageSize } : {}),
            conversationId: latestConversationId,
            ...(activeEditTarget
              ? {
                  targetMessageId: activeEditTarget.messageId,
                  targetImageIndices: activeEditTarget.indices
                }
              : {})
          })
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          throw new Error(data.error || "请求失败");
        }

        if (Array.isArray(data.generatedImages)) {
          generatedImages.push(
            ...data.generatedImages
              .map((x: any) => ({
                imageBase64: x?.imageBase64 ? String(x.imageBase64) : undefined,
                imageUrl: x?.imageUrl ? String(x.imageUrl) : undefined,
                imageMimeType: String(x?.imageMimeType || "image/jpeg")
              }))
              .filter((x: any) => x.imageBase64 || x.imageUrl)
          );
        } else if (data.imageBase64) {
          generatedImages.push({
            imageBase64: String(data.imageBase64),
            imageMimeType: String(data.mimeType || "image/jpeg")
          });
        } else if (data.imageUrl) {
          generatedImages.push({
            imageUrl: String(data.imageUrl),
            imageMimeType: String(data.mimeType || "image/jpeg")
          });
        }
        lastAssistantText =
          String(data?.assistantText || "").trim() || lastAssistantText;
        if (!assistantMessageIdFromServer) {
          assistantMessageIdFromServer = String(
            data.assistantMessageId || ""
          ).trim();
        }
        if (data.conversationId) {
          latestConversationId = String(data.conversationId);
          setCurrentConversationId(String(data.conversationId));
          bindSettingsToConversation(String(data.conversationId));
          setActiveGeneratingConversationId(String(data.conversationId));
        }

        if (!leftWhileGeneratingRef.current && shouldProgressivelyRender) {
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMessageId
                ? {
                    ...msg,
                    loading: true,
                    content:
                      generatedImages.length > 0
                        ? `已生成 ${generatedImages.length}/${safeOutputCount} 张`
                        : `正在思考与生成中... (${
                            reqIndex + 1
                          }/${safeOutputCount})`,
                    imageBase64: generatedImages[0]?.imageBase64,
                    imageUrl: generatedImages[0]?.imageUrl,
                    imageMimeType:
                      generatedImages[0]?.imageMimeType || "image/jpeg",
                    generatedImages: [...generatedImages]
                  }
                : msg
            )
          );
        }
      }

      if (!leftWhileGeneratingRef.current) {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessageId
              ? {
                  ...msg,
                  ...(shouldProgressivelyRender
                    ? {}
                    : assistantMessageIdFromServer
                    ? { id: assistantMessageIdFromServer }
                    : {}),
                  loading: false,
                  content:
                    generatedImages.length > 0
                      ? lastAssistantText || ""
                      : "抱歉，生成失败：未成功生成图片",
                  imageBase64: generatedImages[0]?.imageBase64,
                  imageUrl: generatedImages[0]?.imageUrl,
                  imageMimeType:
                    generatedImages[0]?.imageMimeType || "image/jpeg",
                  generatedImages
                }
              : msg
          )
        );
      }

      await refreshConversationList(
        leftWhileGeneratingRef.current ? undefined : latestConversationId
      );
    } catch (error: any) {
      if (error?.name === "AbortError") return;
      const errText = String(error?.message || "生成图片时发生错误");
      if (!leftWhileGeneratingRef.current) {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessageId
              ? {
                  ...msg,
                  loading: false,
                  content: `抱歉，生成失败：${errText}`
                }
              : msg
          )
        );
      }
      message.error(errText);
    } finally {
      setEditTarget(null);
      setActiveGeneratingConversationId(null);
      setIsGenerating(false);
      generationAbortRef.current = null;
    }
  };

  const onToggleEditTarget = (messageId: string, index: number) => {
    const mid = String(messageId || "").trim();
    const idx = Number(index);
    if (!mid || !Number.isFinite(idx) || idx < 0) return;
    setEditTarget((prev) => {
      if (!prev || prev.messageId !== mid) {
        return { messageId: mid, indices: [idx] };
      }
      const set = new Set(prev.indices);
      if (set.has(idx)) set.delete(idx);
      else set.add(idx);
      const indices = Array.from(set).sort((a, b) => a - b);
      return indices.length ? { messageId: mid, indices } : null;
    });
  };

  const handleSend = async () => {
    await sendMessage(inputValue, pendingImages);
  };

  const handleRegenerate = async (assistantMessageId: string) => {
    const assistantIndex = messages.findIndex(
      (msg) => msg.id === assistantMessageId
    );
    if (assistantIndex <= 0) {
      message.warning("未找到可重新生成的提示词");
      return;
    }
    let sourceUserMessage: Message | undefined;
    for (let i = assistantIndex - 1; i >= 0; i -= 1) {
      if (messages[i].role === "user") {
        sourceUserMessage = messages[i];
        break;
      }
    }
    if (!sourceUserMessage) {
      message.warning("未找到可重新生成的提示词");
      return;
    }
    const prompt = sourceUserMessage.content || "";
    const referenceImages = sourceUserMessage.referenceImages || [];
    if (!prompt.trim() && referenceImages.length === 0) {
      message.warning("当前消息缺少可重新生成的内容");
      return;
    }
    setInputValue(prompt);
    setPendingImages(referenceImages);
    await sendMessage(prompt, referenceImages);
  };

  const handleDownload = async (msg: Message, indices?: number[]) => {
    const imgs =
      msg.generatedImages && msg.generatedImages.length > 0
        ? msg.generatedImages
        : msg.imageBase64
        ? [
            {
              imageBase64: msg.imageBase64,
              imageMimeType: msg.imageMimeType || "image/jpeg"
            }
          ]
        : [];
    if (!imgs.length) return;

    const list =
      Array.isArray(indices) && indices.length
        ? indices.map((i) => imgs[i]).filter(Boolean)
        : imgs;

    // 多图：按序触发多次下载（避免引入 zip 依赖）
    for (let i = 0; i < list.length; i += 1) {
      const targetImage = list[i];
      const mimeType = targetImage?.imageMimeType || "image/jpeg";
      const ext = mimeType.includes("png")
        ? "png"
        : mimeType.includes("webp")
        ? "webp"
        : "jpg";
      let href = "";
      if (targetImage?.imageBase64) {
        href = `data:${mimeType};base64,${targetImage.imageBase64}`;
      } else if (targetImage?.imageUrl) {
        href = targetImage.imageUrl;
      }
      if (!href) continue;
      const link = document.createElement("a");
      link.href = href;
      link.download = `generated-${Date.now()}-${i + 1}.${ext}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const openGallerySaveModal = (messageId: string, indices?: number[]) => {
    setGallerySaveMessageId(messageId);
    setGallerySaveIndices(Array.isArray(indices) ? indices : []);
    setGalleryAppName("");
    setGalleryLang("");
    setGallerySaveModalOpen(true);
  };

  const handleSaveToGallery = async () => {
    const appName = galleryAppName.trim();
    const lang = galleryLang.trim();
    if (!appName) {
      message.warning("请选择或输入 appName");
      return;
    }
    if (!lang) {
      message.warning("请选择语言");
      return;
    }
    const targetIndex = messages.findIndex(
      (m) => m.id === gallerySaveMessageId
    );
    const targetMessage = targetIndex >= 0 ? messages[targetIndex] : undefined;
    const imgs =
      targetMessage?.generatedImages && targetMessage.generatedImages.length > 0
        ? targetMessage.generatedImages
        : targetMessage?.imageBase64
        ? [
            {
              imageBase64: targetMessage.imageBase64,
              imageMimeType: targetMessage.imageMimeType || "image/jpeg"
            }
          ]
        : [];
    const list =
      gallerySaveIndices.length > 0
        ? gallerySaveIndices.map((i) => imgs[i]).filter(Boolean)
        : imgs;
    if (!list.length) {
      message.error("未找到要入库的图片");
      return;
    }
    const sourcePrompt = (() => {
      for (let i = targetIndex - 1; i >= 0; i -= 1) {
        if (messages[i].role === "user") return messages[i].content || "";
      }
      return "";
    })();
    setGallerySaving(true);
    try {
      for (let i = 0; i < list.length; i += 1) {
        const targetImage = list[i];
        let imageBase64 = String(targetImage?.imageBase64 || "").trim();
        let imageMimeType = String(targetImage?.imageMimeType || "image/jpeg");
        if (!imageBase64 && targetImage?.imageUrl) {
          const hydrated = await urlToPendingImage(targetImage.imageUrl).catch(
            () => null
          );
          if (hydrated?.base64) {
            imageBase64 = hydrated.base64.split(",")[1] || hydrated.base64;
            imageMimeType = hydrated.mimeType || imageMimeType;
          }
        }
        if (!imageBase64) continue;
        const res = await fetch("/api/image-edit/save", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            imageBase64,
            mimeType: imageMimeType || "image/jpeg",
            mode: "new",
            appName,
            lang,
            aspectRatio: "16:9",
            ...(sourcePrompt.trim() ? { prompt: sourcePrompt.trim() } : {})
          })
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok) {
          throw new Error(data?.error || "入库失败");
        }
      }
      message.success(`已入库到图片广场（${list.length} 张）`);
      setGallerySaveModalOpen(false);
    } catch (e: any) {
      message.error(e?.message || "入库失败");
    } finally {
      setGallerySaving(false);
    }
  };

  const startNewConversation = () => {
    if (isGenerating) leftWhileGeneratingRef.current = true;
    const lastSettings = (() => {
      const map = conversationSettingsMapRef.current || {};
      if (currentConversationId && map[currentConversationId]) {
        return map[currentConversationId];
      }
      const mostRecentId = String(conversationItems?.[0]?.id || "").trim();
      if (mostRecentId && map[mostRecentId]) return map[mostRecentId];
      if (map[NEW_CONVERSATION_SETTINGS_KEY])
        return map[NEW_CONVERSATION_SETTINGS_KEY];
      return DEFAULT_IMAGE_GENERATION_SETTINGS;
    })();
    setCurrentConversationId(null);
    applyGenerationSettings(lastSettings);
    setMessages([buildWelcomeMessage()]);
    setInputValue("");
    setPendingImages([]);
    setEditTarget(null);
  };

  const deleteConversation = async (conversationId: string) => {
    const cid = String(conversationId || "").trim();
    if (!cid) return;
    const isCurrent = currentConversationId === cid;
    const msgKey = `deleteConversation:${cid}`;
    setConversationItems((prev) => prev.filter((x) => String(x?.id) !== cid));
    setConversationSettingsMap((prev) => {
      if (!prev[cid]) return prev;
      const next = { ...prev };
      delete next[cid];
      return next;
    });
    if (isCurrent) startNewConversation();
    message.open({
      type: "loading",
      content: "正在后台删除会话...",
      duration: 0,
      key: msgKey
    });
    try {
      const res = await fetch(
        `/api/image-edit/chat?conversationId=${encodeURIComponent(cid)}`,
        { method: "DELETE" }
      );
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "删除会话失败");
      }
      message.success({ content: "已删除会话", key: msgKey });
    } catch (e: any) {
      message.error({ content: e?.message || "删除会话失败", key: msgKey });
      await refreshConversationList();
    }
  };

  const conversationGeneratedImageItems: string[] = [];
  const conversationGeneratedImageIndexByMessageId = new Map<string, number>();
  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    const msgImages =
      msg.generatedImages && msg.generatedImages.length > 0
        ? msg.generatedImages
        : msg.imageBase64 || msg.imageUrl
        ? [
            {
              imageBase64: msg.imageBase64,
              imageUrl: msg.imageUrl,
              imageMimeType: msg.imageMimeType || "image/jpeg"
            }
          ]
        : [];
    if (msgImages.length === 0) continue;
    const idx = conversationGeneratedImageItems.length;
    conversationGeneratedImageItems.push(
      ...msgImages
        .map((item) =>
          item.imageBase64
            ? `data:${item.imageMimeType};base64,${item.imageBase64}`
            : item.imageUrl || ""
        )
        .filter(Boolean)
    );
    conversationGeneratedImageIndexByMessageId.set(msg.id, idx);
  }

  return (
    <AdminShell
      defaultSelectedKey="/make-image"
      headerTitle="制作图片 - 对话式生成"
    >
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          height: "calc(100vh - 120px)",
          width: "100%",
          backgroundColor: "#fff",
          borderRadius: 16,
          boxShadow: "0 4px 12px rgba(0,0,0,0.05)"
        }}
      >
        <ConversationSidebar
          conversationListCollapsed={conversationListCollapsed}
          setConversationListCollapsed={setConversationListCollapsed}
          conversationItems={conversationItems}
          currentConversationId={currentConversationId}
          openConversation={openConversation}
          deleteConversation={deleteConversation}
          startNewConversation={startNewConversation}
          conversationListLoading={conversationListLoading}
          isGenerating={isGenerating}
          activeGeneratingConversationId={activeGeneratingConversationId}
          conversationLoading={conversationLoading}
        />

        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <MessagePanel
            conversationLoading={conversationLoading}
            messages={messages}
            editTarget={editTarget}
            onToggleEditTarget={onToggleEditTarget}
            isGenerating={isCurrentConversationGenerating}
            onRegenerate={handleRegenerate}
            onDownload={handleDownload}
            onOpenGallerySaveModal={openGallerySaveModal}
            conversationGeneratedImageIndexByMessageId={
              conversationGeneratedImageIndexByMessageId
            }
            setConversationPreviewCurrent={setConversationPreviewCurrent}
            setConversationPreviewVisible={setConversationPreviewVisible}
            messagesEndRef={messagesEndRef}
          />

          <ComposerPanel
            pendingImages={pendingImages}
            removePendingImage={removePendingImage}
            handleUpload={handleUpload}
            inputValue={inputValue}
            setInputValue={setInputValue}
            handleSend={handleSend}
            onPasteImageFiles={async (files) => {
              const pastedImages = await Promise.all(
                files.map((file) => fileToPendingImage(file))
              );
              setPendingImages((prev) => [...prev, ...pastedImages]);
            }}
            onDropImageUrls={async (urls) => {
              await addReferenceImagesFromUrls(urls);
            }}
            isGenerating={isCurrentConversationGenerating}
            conversationLoading={conversationLoading}
            enableImageSettings={enableImageSettings}
            setEnableImageSettings={setEnableImageSettings}
            outputCount={outputCount}
            setOutputCount={setOutputCount}
            thinkingLevel={thinkingLevel}
            setThinkingLevel={setThinkingLevel}
            temperature={temperature}
            setTemperature={setTemperature}
            aspectRatio={aspectRatio}
            setAspectRatio={setAspectRatio}
            imageSize={imageSize}
            setImageSize={setImageSize}
          />
        </div>
      </div>
      <GallerySaveModal
        open={gallerySaveModalOpen}
        saving={gallerySaving}
        appName={galleryAppName}
        lang={galleryLang}
        appNameOptions={galleryAppNameOptions}
        setAppName={setGalleryAppName}
        setLang={setGalleryLang}
        onCancel={() => {
          if (gallerySaving) return;
          setGallerySaveModalOpen(false);
        }}
        onOk={handleSaveToGallery}
      />
      <div style={{ display: "none" }}>
        <AntImage.PreviewGroup
          items={conversationGeneratedImageItems}
          preview={{
            open: conversationPreviewVisible,
            current: conversationPreviewCurrent,
            onOpenChange: (open) => setConversationPreviewVisible(open),
            onChange: (current) => setConversationPreviewCurrent(current)
          }}
        />
      </div>
      <style jsx global>{`
        .make-image-scroll-area {
          scrollbar-width: thin;
          scrollbar-color: rgba(148, 163, 184, 0.9) transparent;
        }
        .make-image-scroll-area::-webkit-scrollbar {
          width: 5px;
        }
        .make-image-scroll-area::-webkit-scrollbar-track {
          background: transparent;
        }
        .make-image-scroll-area::-webkit-scrollbar-thumb {
          background: rgba(148, 163, 184, 0.85);
          border-radius: 999px;
          border: 1px solid transparent;
          background-clip: padding-box;
        }
        .make-image-scroll-area::-webkit-scrollbar-thumb:hover {
          background: rgba(100, 116, 139, 0.9);
        }
        .make-image-scroll-area::-webkit-scrollbar-thumb:active {
          background: rgba(71, 85, 105, 0.95);
        }
        .make-image-scroll-area::-webkit-scrollbar-corner {
          background: transparent;
        }
        .make-image-conversation-scroll {
          scrollbar-width: thin;
          scrollbar-color: #d0d7e2 transparent;
        }
        .make-image-conversation-scroll::-webkit-scrollbar {
          width: 6px;
        }
        .make-image-conversation-scroll::-webkit-scrollbar-track {
          background: transparent;
        }
        .make-image-conversation-scroll::-webkit-scrollbar-thumb {
          background: #d0d7e2;
          border-radius: 999px;
        }
      `}</style>
    </AdminShell>
  );
}
