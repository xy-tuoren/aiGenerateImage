"use client";

import { Image } from "antd";
import type React from "react";

import type { GridImage } from "../_lib/types";
import { GridTile } from "./GridTile";

export function GalleryGrid(props: {
  gridWrapRef: React.RefObject<HTMLDivElement | null>;
  dragBox: { active: boolean; x: number; y: number; w: number; h: number };
  previewOpen: boolean;
  onGridMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;

  previewItems: string[];
  previewConfig: any;

  images: GridImage[];
  displayUrls?: string[];
  selectedKeySet: Set<string>;
  togglePick: (k: string) => void;
  favoriteUrlSet: Set<string>;
  onToggleFavorite: (img: GridImage) => void;
  onOpenPreviewAt: (idx: number) => void;
  onOpenMeta: (img: GridImage) => void;
}) {
  const {
    gridWrapRef,
    dragBox,
    previewOpen,
    onGridMouseDown,
    previewItems,
    previewConfig,
    images,
    displayUrls,
    selectedKeySet,
    togglePick,
    favoriteUrlSet,
    onToggleFavorite,
    onOpenPreviewAt,
    onOpenMeta
  } = props;

  return (
    <Image.PreviewGroup items={previewItems} preview={previewConfig}>
      <div
        ref={gridWrapRef}
        style={{
          position: "relative",
          display: "grid",
          gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
          gap: 12,
          width: "100%",
          userSelect: dragBox.active ? "none" : undefined,
          cursor: dragBox.active ? "crosshair" : undefined
        }}
        onMouseDown={(e) => {
          if (previewOpen) return;
          onGridMouseDown(e);
        }}
      >
        {dragBox.active ? (
          <div
            style={{
              position: "absolute",
              left: Math.min(dragBox.x, dragBox.x + dragBox.w),
              top: Math.min(dragBox.y, dragBox.y + dragBox.h),
              width: Math.abs(dragBox.w),
              height: Math.abs(dragBox.h),
              background: "rgba(0,160,255,0.22)",
              border: "2px solid rgba(0,160,255,0.95)",
              boxShadow:
                "0 0 0 2px rgba(255,255,255,0.65) inset, 0 8px 20px rgba(0,160,255,0.25)",
              outline: "1px dashed rgba(0,0,0,0.25)",
              borderRadius: 6,
              pointerEvents: "none",
              zIndex: 10
            }}
          />
        ) : null}

        {images.map((img, idx) => (
          <GridTile
            key={img.key}
            img={img}
            idx={idx}
            displayUrl={displayUrls?.[idx]}
            selected={selectedKeySet.has(img.key)}
            favorited={favoriteUrlSet.has(img.url)}
            onTogglePick={togglePick}
            onToggleFavorite={() => onToggleFavorite(img)}
            onOpenPreview={onOpenPreviewAt}
            onOpenMeta={onOpenMeta}
          />
        ))}
      </div>
    </Image.PreviewGroup>
  );
}
