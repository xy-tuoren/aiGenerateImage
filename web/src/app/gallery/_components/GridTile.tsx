"use client";

import { Image } from "antd";
import { memo, useCallback } from "react";

import type { GridImage } from "../_lib/types";

export const GridTile = memo(
  function GridTile(props: {
    img: GridImage;
    idx: number;
    selected: boolean;
    onTogglePick: (k: string) => void;
    onOpenPreview: (idx: number) => void;
    onOpenMeta: (img: GridImage) => void;
  }) {
    const { img, idx, selected, onTogglePick, onOpenPreview, onOpenMeta } =
      props;

    const onContextMenu = useCallback(
      (e: any) => {
        e.preventDefault();
        onTogglePick(img.key);
      },
      [img.key, onTogglePick]
    );

    const onClick = useCallback(() => {
      onOpenPreview(idx);
    }, [idx, onOpenPreview]);

    const onMouseDown = useCallback(
      (e: any) => {
        if (e.button !== 1) return;
        e.preventDefault();
        e.stopPropagation();
        onOpenMeta(img);
      },
      [img, onOpenMeta]
    );

    return (
      <div
        data-grid-key={img.key}
        style={{
          position: "relative",
          cursor: "default",
          width: "100%",
          aspectRatio: "16 / 9",
          overflow: "hidden",
          borderRadius: 10,
          border: selected
            ? "3px solid #1677ff"
            : "1px solid rgba(0,0,0,0.06)",
          boxShadow: selected ? "0 0 0 3px rgba(22,119,255,0.22)" : undefined,
        }}
        onContextMenu={onContextMenu}
        onClick={onClick}
        onMouseDown={onMouseDown}
      >
        <Image
          width="100%"
          height="100%"
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
          preview={false}
          src={img.url}
          alt={img.url}
          loading="lazy"
          decoding="async"
        />
        {selected ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(22,119,255,0.16)",
              pointerEvents: "none",
            }}
          />
        ) : null}
        {selected ? (
          <div
            style={{
              position: "absolute",
              top: 8,
              left: 8,
              width: 26,
              height: 26,
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.85)",
              background: "#1677ff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontSize: 16,
              fontWeight: 700,
              userSelect: "none",
            }}
          >
            ✓
          </div>
        ) : null}
      </div>
    );
  },
  (a, b) =>
    a.img === b.img &&
    a.idx === b.idx &&
    a.selected === b.selected &&
    a.onTogglePick === b.onTogglePick &&
    a.onOpenPreview === b.onOpenPreview &&
    a.onOpenMeta === b.onOpenMeta
);

