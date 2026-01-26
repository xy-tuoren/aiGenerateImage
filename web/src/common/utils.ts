export function getRatioDesc(aspectRatio?: string): string {
  if (!aspectRatio) return '';
  const ratio = aspectRatio.trim();
  if (ratio === '1:1') return '1:1的方图';
  if (ratio === '4:5') return '4:5的竖图';
  if (ratio === '16:9') return '16:9的长图';
  if (ratio === '9:16') return '9:16的竖图';
  return `${ratio}比例的图片`;
}