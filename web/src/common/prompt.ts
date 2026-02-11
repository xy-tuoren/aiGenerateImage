import { getRatioDesc } from "@/common/utils";

export function getAppDefaultPrompt({ appName, lang, prompt, aspectRatio }: { appName?: string; lang?: string; prompt?: string; aspectRatio?: string;[key: string]: any }) {
  return `1、你是一个精通app推广的广告设计师，这是你过去制作的广告图片，为了进一步推广产品，你需要制作更多的广告图片，你应该使用相同风格制作新的广告，但请注意新的广告与现有广告不应过度相似，需要调整背景以及构图。
  2、图片将用于${appName}应用推广，所以参考图无论是什么应用图标一定要是${appName}的图标。
  3、图片内出现的所有可见文字必须 100% 为${lang}语言，禁止出现任何其他语言。
  4、图片中只能出现一张图不能是多张图拼接而成的。
  5、${prompt}
  `;
}

export function getAppDefaultPrompt2({ appName, lang, prompt, aspectRatio }: { appName?: string; lang?: string; prompt?: string; aspectRatio?: string;[key: string]: any }) {
  return `1、你围绕示例图片中${appName}应用主题,生成用于${lang}语言的广告图片,我需要你生成的图片保持示例图片风格，并有所创新不能有任何科幻风格，排版足够精致但是不要太像ai生成。
  2、图中文字要简洁明了加起来不能超过3条重点为:应用名字、下载、更新、免费
  3、图片将用于${appName}应用推广，所以参考图无论是什么应用图标一定要是${appName}的图标。
  4、${prompt}
  `;
}

export function getAppDefaultPrompt3({ appName, lang, prompt, aspectRatio }: { appName?: string; lang?: string; prompt?: string; aspectRatio?: string;[key: string]: any }) {
  return `1、你是一个专业的广告设计师，这是你之前为${appName}设计的广告，你现在需要已这个风格再制作一些${appName}广告，要求每个广告跟原图有差异，而不是看上去就像同一个广告。
  2、图中文字要简洁明了加起来不能超过3条单条文字长度不能超过10个字符。
  3、文字的语言必须为${lang}语言。
  4、${prompt}
  `;
}

//使用对比色或光影效果突出主体元素
//图片中只能出现一张图不能是多张图拼接而成的。
export function getAppAdsDesignerPrompt({ appName, lang, prompt, aspectRatio }: { appName?: string; lang?: string; prompt?: string; aspectRatio?: string;[key: string]: any }) {
  const appDesc = appName ? `${appName}应用` : '目标应用（请根据参考图或上下文推断）';
  const langDesc = lang || '参考图中使用的语言';
  
  return `1、你是一个精通app推广的广告设计师，这是你过去制作的广告图片，参考图仅作为图片风格参考，你需要调整构图、修改元素、背景等避免跟参考图过于相似。好的广告设计应遵循以下原则：
    - 应用图标必须在核心位置，尺寸要大且显眼（建议占画面至少15-20%）
    - 图片的视觉层次要分明：主体（图标+核心文案）> 辅助元素 > 背景
    - 所有元素之间不能有堆叠现象
    - 推广文案尽量贴近参考图的文案内容 可沿用关键词/短语/标点/行数，仅做极小幅变化（如少量同义替换、1-2 个字微调）；同时加起来不能超过3条，单条文案长度不超过10个字符
  2、【关键】图片将用于${appDesc}推广：
    - 如果参考图中已有该应用图标，必须严格保持图标的样式、颜色、设计完全一致，不要修改或重新设计
    - 如果参考图中是其他应用的图标，需要替换为${appDesc}的图标，并保持该图标的原始设计风格
  3、【语言要求】图片内出现的所有可见文字必须 100% 为${langDesc}，包括：
    - 广告文案、按钮文字、标语
    - 手机屏幕、UI界面中的文字
    - 背景装饰文字、标牌、广告牌等任何可见文字
    - 禁止出现任何其他语言 
  4、图中不要出现具体月份/日
  5、${prompt}
  `;
}

//参考图与生成图比例不一样
export function getReferencePrompt({ appName, lang, prompt, aspectRatio }: { appName?: string; lang?: string; prompt?: string; aspectRatio?: string;[key: string]: any }) {
  return `1、你是一个精通app推广的广告设计师，这是你过去制作的广告图片，仔细分析参考图的艺术风格、色调、光影效果、主体内容和整体氛围。生成一张全新尺寸比例的图片，但保留参考图的核心视觉元素和风格特征。
  2、【严禁拉伸变形】绝对禁止对参考图进行任何形式的拉伸、扭曲、变形或压缩。所有元素必须保持其原始比例和形状，不能出现任何视觉上的拉伸痕迹。
  3、当参考图与目标尺寸比例不同时，必须通过智能重新构图来适应新尺寸，可以通过重新排列元素布局来适应新比例。绝不能对任何现有内容进行拉伸或变形处理。
  4、保持原图的色彩风格、光影效果、艺术风格和整体氛围，确保新尺寸图片与原图在视觉上高度一致，只是尺寸比例不同。所有元素都应该看起来是自然生成的，而不是被拉伸变形的。
  5、图片将用于${appName}应用推广，所以参考图无论是什么应用图标一定要是${appName}的图标。
  6、图片语言必须为${lang}语言。
  7、${prompt}
  `;
}

// 2、如果参考图中有当地语言标志性建筑或者风景在翻译为其他语言的时候需要修改标志性建筑或者风景，但修改时应该尽量保持与原图相似：选择风格、类型、视觉效果相近的地标建筑或风景，保持原图的整体构图、色调、氛围和视觉风格，确保修改后的图片与原图差距尽可能小。
export function getTextTranslatePrompt({ lang, prompt, aspectRatio }: { lang?: string; prompt?: string; aspectRatio?: string;[key: string]: any }) {
  return `1、生成一张新图片，将参考图中的文字翻译为${lang}语言,注意参考图中任何元素中的文字如(手机中的文字、背景的文字、提示文字、地铁站、广告牌文字、logo文字等)都需要翻译，不要遗漏。
  2、${prompt}
  `;
}

export function getCutImagePrompt({ lang, prompt, aspectRatio }: { lang?: string; prompt?: string; aspectRatio?: string;[key: string]: any }) {
  return `1、基于上传的参考图片保持原图的高级广告摄影风格，可以对图片主体有适当缩放微调，以适应新的构图，主体要整体缩放不能有拉伸变形的情况，主体必须与参考图看起来没有太多变化属于同一个广告系列，如果参考图有文本，则需要保留文本，并且语言必须与参考图一致。
  2、${prompt}
  `;
}

export function getCutLogoPrompt({ appName, lang, prompt, aspectRatio }: { appName?: string; lang?: string; prompt?: string; aspectRatio?: string;[key: string]: any }) {
  return `1、找到参考图中的应用图标以及文字裁剪出来放到新图的中心位置适当缩放调整以适应新的构图，其他残缺元素以及字体可以丢弃掉。
  2、背景保留裁剪部分背景的。
  3、语言必须跟参考图一致
  `;
}

export function getCutOtherPrompt({ appName, lang, prompt, aspectRatio }: { appName?: string; lang?: string; prompt?: string; aspectRatio?: string;[key: string]: any }) {
  return `1、找到参考图中除了应用图标以及文字之外的一个元素裁剪出来放到新图的中心位置适当缩放调整以适应新的构图，其他残缺元素以及字体可以丢弃掉，背景保留裁剪部分。
  2、${prompt}
  3、语言必须跟参考图一致
  `;
}

export function getCentralPositionPrompt({ appName, lang, prompt, aspectRatio }: { appName?: string; lang?: string; prompt?: string; aspectRatio?: string;[key: string]: any }) {
  return `1、将图中除了背景以外的所有元素缩小放到中心位置，图片边缘跟元素之间需要有一些内边距，残缺的文字、元素需要智能补全或者去掉。
  2、logo元素放大需要显眼一些。
  3、${prompt}
  `;
}

export function getCutLogoFinalPrompt({ appName, lang, prompt, aspectRatio }: { appName?: string; lang?: string; prompt?: string; aspectRatio?: string;[key: string]: any }) {
  const appDesc = appName ? `${appName}应用的` : '参考图中应用的（请根据参考图自行推断应用名称）';
  return `生成一张${getRatioDesc(aspectRatio)}。从参考图中提取${appDesc}图标与推广文字，作为唯一主体放在画面中心。
【构图】主体（图标+文案）占画面约 65%-85%。
【层级】图标最大最醒目；文案仅 1-2 行短语（可以适当精简文案内容），清晰可读。
【背景处理】保留裁剪区域的背景质感。
【严格限制】应用图标外观必须与参考图 100% 一致（形状/颜色/细节不改、不重绘、不变形）；文字语言必须与参考图一致；其他无关元素一律丢弃。`;
}

export function getCutOtherFinalPrompt({ appName, lang, prompt, aspectRatio }: { appName?: string; lang?: string; prompt?: string; aspectRatio?: string;[key: string]: any }) {
  const appDesc = appName ? `${appName}应用` : '参考图中的应用（请根据参考图自行推断应用名称）';

  const pickOne = <T,>(items: T[]) => items[Math.floor(Math.random() * items.length)];

  // 控制角标出现概率
  const badgeProbability = 0.45;
  const showBadge = Math.random() < badgeProbability;
  // 用重复元素保留原概率：0.4/0.4/0.2
  const badgeContent = pickOne([
    "“免费”",
    "“免费”",
    "“最新”",
    "“最新”",
    "一个与应用/场景相关的小 icon（如礼物、下载、手机、Android等，风格需与参考图一致）",
  ]);

  const badgePrompt = showBadge
    ? `
【可选角标】在画面角落添加一个角标（badge）：
- 角标内容：${badgeContent}；若参考图语言非中文，“免费/最新”必须翻译为参考图同语言。
- 角标底色随机，但必须与画面整体色调/材质融合（可用同色系高饱和点缀或互补色小面积强调），并保证角标文字/图形与底色对比清晰可读。
- 角标尺寸不喧宾夺主，但要清晰可见，边缘不要被裁切。`
    : ""; 

  // 若参考图无按钮，可选生成按钮（仅在无按钮时生效）
  const buttonProbability = 0.35;
  const showButton = Math.random() < buttonProbability;
  const buttonText = pickOne([
    "“下载”",
    "“需要更新”",
    "“点击更新”",
    "“更新”",
    "“立即更新”",
  ]);

  const buttonPrompt = showButton
    ? `
【可选按钮】仅当参考图中没有按钮（CTA button）时，才允许添加一个按钮：
- 按钮文案：${buttonText}（或同义的“更新/下载”相关短语）；若参考图语言非中文，按钮文案必须翻译为参考图同语言。
- 按钮形态：清晰的圆角矩形/胶囊按钮，带轻微投影/高光（是否需要取决于参考图风格），整体材质与参考图一致（扁平/3D/玻璃/拟物等保持一致）。
- 布局：放在主要文案附近作为行动引导，不要遮挡图标与关键文案；尺寸适中、清晰可读，边缘不要被裁切。`
    : "";

  return `生成一张${getRatioDesc(aspectRatio)}。提取除了${appDesc}图标以外的一个最大占比元素与文字的组合构图，需要保留裁剪部分的背景。
【构图要求】整体画面要“铺满感”，主体+文字区域尽量占满画面的高度；禁止出现明显的大面积上/下只有背景的纯色空洞。必要时可通过重新排版、适度放大主体、调整元素位置，或用同风格背景延展/补全来填满画面边缘。
若最终只能提取到文字或背景（缺少明确主体元素），可以在画面核心位置新增/补全并突出${appDesc}图标，同时添加 1 个辅助元素作为视觉主体的一部分（辅助元素需与参考图风格一致且与应用功能/场景强相关）。
${badgePrompt}
${buttonPrompt}
  【重要】关于应用图标的要求：
  - 如果需要使用应用图标，必须严格保持参考图中原图标的样式、颜色、设计和外观完全一致
  - 不要修改、重新设计或变形图标，必须与参考图中的图标完全相同
  【重要】辅助元素必须严格遵循以下原则：
  - 首先深入分析参考图的整体风格（设计语言、色调、光影、质感、艺术风格）和应用的功能特性
  - 辅助元素必须与该应用的功能、用途、使用场景直接相关，能够帮助传达应用的核心价值和卖点
  - 辅助元素的视觉风格、材质质感、色彩搭配必须与参考图高度一致
  - 元素类型应从参考图中提取灵感（如参考图是扁平风就用扁平图标，是3D风就用3D元素，是摄影风就用实物拍摄效果）
  - 避免添加与参考图风格冲突或与应用功能无关的元素
  - 辅助元素应具有广告推广的吸引力，能够激发用户下载使用的兴趣
  - 文字的语言要跟参考图一致
`;
}

export function getCutScaleFinalPrompt({ appName, lang, prompt, aspectRatio }: { appName?: string; lang?: string; prompt?: string; aspectRatio?: string;[key: string]: any }) {
  const appDesc = appName ? `${appName}应用` : '参考图中的应用（请根据参考图自行推断应用名称）';
  return `生成一张${getRatioDesc(aspectRatio)}，需要重新调整构图适应新尺寸并且${appDesc}图标更加显眼需要保留背景。`;
}

export function getCutVerticalCollagePrompt({ appName, lang, prompt, aspectRatio }: { appName?: string; lang?: string; prompt?: string; aspectRatio?: string;[key: string]: any }) {
  return `1、生成一张${getRatioDesc(aspectRatio)}，上下结构且上下都为原图的组合图。
  2、上下两部分应该是参考图的完整视觉呈现，确保图片内容自然协调，没有被挤压或拉伸的痕迹。
  3、${prompt}
  `;
}

export function getBackgroundPrompt({ appName, lang, prompt, aspectRatio }: { appName?: string; lang?: string; prompt?: string; aspectRatio?: string;[key: string]: any }) {
  return `生成一张新图更换背景其他不变`;
}

export function getAppAdsDesignerGemini3Prompt({
  appName,
  lang,
  prompt,
  aspectRatio
}: {
  appName?: string;
  lang?: string;
  prompt?: string;
  aspectRatio?: string;
  [key: string]: any
}) {
  return `你是一名专业的广告设计师，为"${appName}"应用创作高质量的${lang}推广广告。

# 核心创意要求
根据以下概念创作："${prompt}"

参考图仅用于获取灵感：
- 可以借鉴：色彩风格、设计美学、光影氛围
- 必须原创：构图布局、视角、元素摆放、整体结构
- 自由发挥你的创意，不要复制参考图的构图

# 必须遵守的限制
1. **语言要求**：所有可见文字必须100%使用${lang}语言，包括标题、UI文字、背景文字等
2. **禁止日期**：不要出现具体月份/日期（如"12/1"、"1月31日"），可以用"限定"、"新登場"、"今すぐ"等无时效性词语
3. **品牌识别必须强**（重要）：
   - "${appName}"的App图标/Logo必须是画面最醒目的主视觉元素（建议占画面面积的15%-25%），不要做成角落小图标
   - "${appName}"应用名必须作为主标题或核心文案，字号足够大，缩略图/远看也能一眼读清
   - 通过对比色、留白、光影或背景虚化确保Logo与应用名清晰突出，避免被复杂背景淹没
   - 画面中不要出现其他品牌Logo/水印/平台标识（如YouTube等），避免让人误判广告主体

# 创作建议
- 追求专业的商业广告质量
- 保持画面简洁有力，文字不超过3条且每条不超过8个字符
- 让创意自然流动，根据概念自由选择表现手法（可以包含设备、抽象元素、场景等任何合适的方式）
- 避免过度科幻或赛博朋克风格，除非概念明确需要

现在请根据"${prompt}"创作一张高质量的广告图片。`;
}