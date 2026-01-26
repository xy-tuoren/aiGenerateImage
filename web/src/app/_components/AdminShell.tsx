"use client";

import type { ReactNode } from "react";
import { Layout, Menu, Typography } from "antd";
import { HomeOutlined, SettingOutlined, PictureOutlined } from "@ant-design/icons";
import Link from "next/link";
import { usePathname } from "next/navigation";

type AdminShellProps = {
  children: ReactNode;
  defaultSelectedKey: string;
  headerTitle?: string;
};

export default function AdminShell({ children, defaultSelectedKey, headerTitle }: AdminShellProps) {
  const pathname = usePathname();
  const { Header, Content, Sider } = Layout;

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider width={200} style={{ background: "#fff" }}>
        <Menu
          mode="inline"
          selectedKeys={[pathname || defaultSelectedKey]}
          style={{ height: "100%", borderRight: 0 }}
          items={[
            { key: "/", icon: <HomeOutlined />, label: <Link href="/">首页</Link> },
            { key: "/configs", icon: <SettingOutlined />, label: <Link href="/configs">配置管理</Link> },
            { key: "/batch", icon: <PictureOutlined />, label: <Link href="/batch">批量生图</Link> },
            { key: "/gallery", icon: <PictureOutlined />, label: <Link href="/gallery">图片展示</Link> },
            { key: "/crop", icon: <PictureOutlined />, label: <Link href="/crop">裁图展示</Link> },
          ]}
        />
      </Sider>
      <Layout>
        <Header style={{ display: "flex", alignItems: "center", background: "#001529" }}>
          <Typography.Title level={4} style={{ color: "#fff", margin: 0 }}>
            {headerTitle || "批量生成图片 - 内部后台"}
          </Typography.Title>
        </Header>
        <Content style={{ padding: 24 }}>{children}</Content>
      </Layout>
    </Layout>
  );
}

