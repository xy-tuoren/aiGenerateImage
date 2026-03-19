export type HistoryItem = {
  id?: string;
  jobId: string;
  configId: string;
  sourceConfigId?: string;
  index: number;
  status: string;
  prompt?: string;
  error?: string;
  url?: string;
  createdAt?: string;
  appName?: string;
  lang?: string;
  referenceImages?: string[];
  adjustParams?: {
    brightness: number;
    contrast: number;
    saturation: number;
    hue: number;
    temperature: number;
  };
  configMeta?: {
    appName?: string;
    lang?: string;
    batchFun?: string;
    aspectRatio?: string;
    prompt?: string;
    referenceImages?: string[];
  };
};

export type GridImage = {
  key: string;
  url: string;
  jobId: string;
  configId: string;
  sourceConfigId?: string;
  index: number;
  createdAt?: string;
  appName?: string;
  lang?: string;
  prompt?: string;
  referenceImages?: string[];
  adjustParams?: {
    brightness: number;
    contrast: number;
    saturation: number;
    hue: number;
    temperature: number;
  };
};

