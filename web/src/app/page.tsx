"use client";

import { Button, Typography, message } from "antd";
import AdminShell from "@/app/_components/AdminShell";
import { useState } from "react";

export default function Home() {
  const [loading, setLoading] = useState(false);

  const onClick = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/reference-images", { method: "GET" });
      const json = (await res.json().catch(() => null)) as { success?: boolean; total?: number; message?: string } | null;
      if (!res.ok || !json || json.success !== true) throw new Error(json?.message || `请求失败：${res.status}`);
      message.success(`调用成功，总数：${typeof json.total === "number" ? json.total : 0}`);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "调用失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AdminShell defaultSelectedKey="/">
      <Typography.Title level={2}>欢迎使用批量生成图片系统</Typography.Title>
      <Button type="primary" onClick={onClick} loading={loading}>
        调用 getReferenceImages
      </Button>
    </AdminShell>
  );
}
