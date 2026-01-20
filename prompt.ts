
export function getAppDefaultPrompt({ appName, lang, prompt, aspectRatio }: { appName?: string; lang?: string; prompt?: string; aspectRatio?: string;[key: string]: any }) {
  return `1、你是一个精通app推广的广告设计师，这是你过去制作的广告图片，为了进一步推广产品，你需要制作更多的广告图片，你应该使用相同风格制作新的广告，但请注意新的广告与现有广告不应过度相似，需要调整背景以及构图。
  2、图片将用于${appName}应用推广，所以参考图无论是什么应用图标一定要是${appName}的图标。
  3、图片内出现的所有可见文字必须 100% 为${lang}语言，禁止出现任何其他语言/字母。若出现任意非${lang}文字则视为失败，必须重新生成。
  4、图片中只能出现一张图不能是多张图拼接而成的。
  6、按钮颜色不为红色。
  7、${prompt}
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

export function getAppAdsDesignerPrompt({ appName, lang, prompt, aspectRatio }: { appName?: string; lang?: string; prompt?: string; aspectRatio?: string;[key: string]: any }) {
  return `1、你是一个精通app推广的广告设计师，这是你过去制作的广告图片，参考图仅作为创意的来源，你需要调整构图修改图中元素、背景。好的图片设计有几个原则:
    - 推广应用的图标以及文字一定要在核心位置并且图标以及要大一些。
    - 背景与主体有对比色凸显主体但是要简洁一些。
    - 图片的元素层次要分明。
    - 文字要简明了图中所有文字加起来不能超过3条。
    - 单条文字长度必须简短参照参考图文字长度不能乱改。
  2、图片将用于${appName}应用推广，所以参考图无论是什么应用图标一定要是${appName}的图标。
  3、图片内出现的所有可见文字必须 100% 为${lang}语言，禁止出现任何其他语言/字母。
  4、图片中只能出现一张图不能是多张图拼接而成的。
  5、生成一张${getRatioDesc(aspectRatio)}的图片。
  6、${prompt}
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
  return `1、生成一张新图片，将参考图中的文字翻译为${lang}语言,你只需要翻译图中的文字但是不添加其他文字。
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
  `;
}

export function getCutOtherPrompt({ appName, lang, prompt, aspectRatio }: { appName?: string; lang?: string; prompt?: string; aspectRatio?: string;[key: string]: any }) {
  return `1、找到参考图中除了应用图标以及文字之外的一个元素裁剪出来放到新图的中心位置适当缩放调整以适应新的构图，其他残缺元素以及字体可以丢弃掉，背景保留裁剪部分。
  2、${prompt}
  `;
}

export function getCentralPositionPrompt({ appName, lang, prompt, aspectRatio }: { appName?: string; lang?: string; prompt?: string; aspectRatio?: string;[key: string]: any }) {
  return `1、将图中除了背景以外的所有元素缩小放到中心位置，图片边缘跟元素之间需要有一些内边距，残缺的文字、元素需要智能补全或者去掉。
  2、logo元素放大需要显眼一些。
  3、${prompt}
  `;
}

function getRatioDesc(aspectRatio?: string): string {
  if (!aspectRatio) return '';
  const ratio = aspectRatio.trim();
  if (ratio === '1:1') return '1:1的方图';
  if (ratio === '4:5') return '4:5的竖图';
  if (ratio === '16:9') return '16:9的长图';
  return `${ratio}比例的图片`;
}


export function getCutLogoFinalPrompt({ appName, lang, prompt, aspectRatio }: { appName?: string; lang?: string; prompt?: string; aspectRatio?: string;[key: string]: any }) {
  return `生成一张${getRatioDesc(aspectRatio)}，提取${appName}应用图标和文字组合的构图，增加图标的大小使其更加显眼并保留部分背景，其他元素不需要了。`;
}

export function getCutOtherFinalPrompt({ appName, lang, prompt, aspectRatio }: { appName?: string; lang?: string; prompt?: string; aspectRatio?: string;[key: string]: any }) {
  return `生成一张${getRatioDesc(aspectRatio)}，提取除了${appName}应用图标以外的一个关键占比元素以及文字组合的构图需要保留部分背景，其他元素不需要了。`;
}

export function getCutScaleFinalPrompt({ appName, lang, prompt, aspectRatio }: { appName?: string; lang?: string; prompt?: string; aspectRatio?: string;[key: string]: any }) {
  return `生成一张${getRatioDesc(aspectRatio)}，需要重新调整构图并且${appName}应用图标更加显眼需要保留背景。`;
}