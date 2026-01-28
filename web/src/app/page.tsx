"use client";

import { Typography } from "antd";
import AdminShell from "@/app/_components/AdminShell";

export default function Home() {
  return (
    <AdminShell defaultSelectedKey="/">
      <Typography.Title level={2}>欢迎使用批量生成图片系统</Typography.Title>
    </AdminShell>
  );
}
