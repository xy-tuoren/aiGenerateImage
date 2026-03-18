"use client";

import { Image } from "antd";
import { StarFilled } from "@ant-design/icons";
import { memo, useCallback, useRef } from "react";

import type { GridImage } from "../_lib/types";

export const GridTile = memo(
  function GridTile(props: {
    img: GridImage;
    idx: number;
    displayUrl?: string;
    selected: boolean;
    favorited: boolean;
    onTogglePick: (k: string) => void;
    onToggleFavorite: () => void;
    onOpenPreview: (idx: number) => void;
    onOpenMeta: (img: GridImage) => void;
  }) {
    const {
      img,
      idx,
      displayUrl,
      selected,
      favorited,
      onTogglePick,
      onToggleFavorite,
      onOpenPreview,
      onOpenMeta
    } = props;
    const src = displayUrl ?? img.url;
    const clickTimerRef = useRef<number | null>(null);

    const onContextMenu = useCallback(
      (e: any) => {
        e.preventDefault();
        onTogglePick(img.key);
      },
      [img.key, onTogglePick]
    );

    const onClick = useCallback(() => {
      if (clickTimerRef.current) window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = window.setTimeout(() => {
        clickTimerRef.current = null;
        onOpenPreview(idx);
      }, 220);
    }, [idx, onOpenPreview]);

    const onDoubleClick = useCallback(
      (e: any) => {
        if (clickTimerRef.current) {
          window.clearTimeout(clickTimerRef.current);
          clickTimerRef.current = null;
        }
        e.preventDefault();
        e.stopPropagation();
        onToggleFavorite();
      },
      [onToggleFavorite]
    );

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
          border: selected ? "3px solid #1677ff" : "1px solid rgba(0,0,0,0.06)",
          boxShadow: selected ? "0 0 0 3px rgba(22,119,255,0.22)" : undefined
        }}
        onContextMenu={onContextMenu}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onMouseDown={onMouseDown}
      >
        <Image
          width="100%"
          height="100%"
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
          preview={false}
          src={src}
          alt={img.url}
          loading="lazy"
          decoding="async"
        />
        {favorited ? (
          <div
            style={{
              position: "absolute",
              top: 6,
              right: 6,
              width: 24,
              height: 24,
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.85)",
              background: "rgba(255,215,0,0.85)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "rgba(0,0,0,0.75)",
              fontSize: 14,
              userSelect: "none",
              boxShadow: "0 6px 14px rgba(0,0,0,0.18)"
            }}
            title="已收藏（双击切换）"
          >
            <StarFilled />
          </div>
        ) : null}
        {selected ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(22,119,255,0.16)",
              pointerEvents: "none"
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
              userSelect: "none"
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
    a.displayUrl === b.displayUrl &&
    a.selected === b.selected &&
    a.favorited === b.favorited &&
    a.onTogglePick === b.onTogglePick &&
    a.onToggleFavorite === b.onToggleFavorite &&
    a.onOpenPreview === b.onOpenPreview &&
    a.onOpenMeta === b.onOpenMeta
);
