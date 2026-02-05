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

//背景与主体有对比色凸显主体。
//图片中只能出现一张图不能是多张图拼接而成的。
export function getAppAdsDesignerPrompt({ appName, lang, prompt, aspectRatio }: { appName?: string; lang?: string; prompt?: string; aspectRatio?: string;[key: string]: any }) {
  const appDesc = appName ? `${appName}应用` : '目标应用（请根据参考图或上下文推断）';
  const langDesc = lang || '参考图中使用的语言';
  
  return `1、你是一个精通app推广的广告设计师，这是你过去制作的广告图片，参考图仅作为风格参考，你需要调整构图、修改元素、背景等避免跟参考图过于相似。好的广告设计应遵循以下原则：
    - 应用图标必须在核心位置，尺寸要大且显眼（建议占画面至少15-20%）
    - 图片的视觉层次要分明：主体（图标+核心文案）> 辅助元素 > 背景
    - 使用对比色或光影效果突出主体元素
    - 推广文案要简洁明了，加起来不能超过3条，单条文案长度不超过10个字符
    - 整体构图要有呼吸感，避免元素过于拥挤
  2、【关键】图片将用于${appDesc}推广：
    - 如果参考图中已有该应用图标，必须严格保持图标的样式、颜色、设计完全一致，不要修改或重新设计
    - 如果参考图中是其他应用的图标，需要替换为${appDesc}的图标，并保持该图标的原始设计风格
  3、【语言要求】图片内出现的所有可见文字必须 100% 为${langDesc}，包括：
    - 广告文案、按钮文字、标语
    - 手机屏幕、UI界面中的文字
    - 背景装饰文字、标牌、广告牌等任何可见文字
    - 禁止出现任何其他语言 
  4、【格式要求】生成一张${getRatioDesc(aspectRatio)}，图片中只能是单张完整的广告图，不能是多张图拼接组合。
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
  return `生成一张${getRatioDesc(aspectRatio)}，严格保持参考图中${appDesc}图标样式、颜色和设计不变，提取应用图标或者应用图标和文字组合的构图，增加图标的大小使其更加显眼并保留部分背景，不要修改图标的外观，其他元素不需要了。`;
}

export function getCutOtherFinalPrompt({ appName, lang, prompt, aspectRatio }: { appName?: string; lang?: string; prompt?: string; aspectRatio?: string;[key: string]: any }) {
  const appDesc = appName ? `${appName}应用` : '参考图中的应用（请根据参考图自行推断应用名称）';
  return `生成一张${getRatioDesc(aspectRatio)}，提取除了${appDesc}图标以外的一个最大占比元素与文字的组合构图，需要保留部分背景；
  若最终只能提取到文字或背景（缺少明确主体元素），可以在画面核心位置新增/补全并突出${appDesc}图标，同时添加 1 个辅助元素作为视觉主体的一部分。
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
  return `
  # Role: AI Creative Director & UI Designer
  
  # Project: "${appName}" Ad Campaign (Fresh Design)
  - Target Language: ${lang}
  - Core Concept: "${prompt}"
  
  # CRITICAL CONSTRAINT: NO LAYOUT CLONING
  The user explicitly hates it when the result looks like the reference image.
  - The Reference Image is ONLY for: Color palette, UI button style, and lighting vibe.
  - The Reference Image is FORBIDDEN for: Composition, camera angle, object placement, and layout structure.
  - **You MUST create a completely NEW composition based on "${prompt}".**
  
  # Reasoning Logic (Structure vs. Style)
  1. Deconstruct Reference:
     - Extract the "Style DNA" (e.g., uses flat design, uses blue/white colors, rounded corners).
     - Ignore the "Structural DNA" (e.g., ignore that the map is on the right, or the phone is in the center).
  2. Plan New Scene:
     - Read the user prompt: "${prompt}".
     - Visualize this prompt from scratch. Do NOT look at the reference image for this step.
     - Example: If reference shows a "Map", but prompt says "Person holding phone", DRAW A PERSON, do not draw a map just because the reference has one.
  3. Apply Style:
     - Apply the extracted "Style DNA" to the "New Scene".
  
  # Generation Directives
  
  ## 1. Composition (Derived from Prompt ONLY)
  - Strictly follow the user description: "${prompt}".
  - Change the camera angle and perspective to be DIFFERENT from the reference image.
  - If the reference is a close-up, try a wide shot (unless prompt says otherwise).
  - Create a fresh, unique layout.
  
  ## 2. Visual Style (Derived from Reference)
  - Use the color scheme and UI aesthetic from the reference image.
  - Maintain the brand identity of "${appName}".
  
  ## 3. Text & Localization (ABSOLUTE REQUIREMENT)
  - **CRITICAL**: ALL visible text in the image MUST be 100% in ${lang} language. NO exceptions.
  - This includes:
    * Headline and slogans
    * UI buttons and labels
    * Background text or ambient typography
    * Text on phones, screens, or billboards in the scene
    * Any watermarks or decorative text elements
  - If the reference image contains text in another language, you MUST translate it to ${lang}.
  - If you cannot write proper ${lang} text, use abstract lines or shapes instead - NEVER use random or mixed languages.
  - Text should be concise (max 3 text elements, each under 10 characters).
  
  # Final Generation Instruction
  Generate a FRESH image following these rules:
  1. Concept: "${prompt}" (composition must be NEW and DIFFERENT from reference)
  2. Style: Match the reference's color scheme and design aesthetic
  3. Text Language: 100% ${lang} ONLY - no other language permitted
  4. Brand: Feature "${appName}" app icon prominently
  `;
}