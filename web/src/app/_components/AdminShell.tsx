"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Layout, Menu, Space, Typography } from "antd";
import { SettingOutlined, PictureOutlined } from "@ant-design/icons";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

type AdminShellProps = {
  children: ReactNode;
  defaultSelectedKey: string;
  headerTitle?: string;
};

export default function AdminShell({ children, defaultSelectedKey, headerTitle }: AdminShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { Header, Content, Sider } = Layout;
  const [me, setMe] = useState<{ userId: string; username: string } | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  const nextPath = useMemo(() => {
    const p = String(pathname || "").trim();
    return p || "/configs";
  }, [pathname]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch("/api/auth/me", { method: "GET" });
        const data = await res.json().catch(() => null);
        if (!mounted) return;
        if (!res.ok || !data?.ok) {
          setMe(null);
          setAuthChecked(true);
          router.replace(`/login?next=${encodeURIComponent(nextPath)}`);
          return;
        }
        setMe(data.user || null);
        setAuthChecked(true);
      } catch {
        if (!mounted) return;
        setMe(null);
        setAuthChecked(true);
        router.replace(`/login?next=${encodeURIComponent(nextPath)}`);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [nextPath, router]);

  const onLogout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
    } finally {
      setMe(null);
      router.replace("/login");
    }
  }, [router]);

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider width={200} style={{ background: "#fff" }}>
        <Menu
          mode="inline"
          selectedKeys={[pathname || defaultSelectedKey]}
          style={{ height: "100%", borderRight: 0 }}
          items={[
            // { key: "/", icon: <HomeOutlined />, label: <Link href="/">首页</Link> },
            { key: "/reference", icon: <PictureOutlined />, label: <Link href="/reference">参考图库</Link> },
            { key: "/configs", icon: <SettingOutlined />, label: <Link href="/configs">配置管理</Link> },
            { key: "/batch", icon: <PictureOutlined />, label: <Link href="/batch">批量生图</Link> },
            { key: "/gallery", icon: <PictureOutlined />, label: <Link href="/gallery">图片广场</Link> },
            { key: "/crop", icon: <PictureOutlined />, label: <Link href="/crop">素材库</Link> },
          ]}
        />
      </Sider>
      <Layout>
        <Header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#001529" }}>
          <Typography.Title level={4} style={{ color: "#fff", margin: 0 }}>
            {headerTitle || "批量生成图片 - 内部后台"}
          </Typography.Title>
          <Space size={10}>
            {me?.username ? <Typography.Text style={{ color: "rgba(255,255,255,0.85)" }}>{me.username}</Typography.Text> : null}
            <Button size="small" onClick={onLogout} disabled={!authChecked}>
              退出登录
            </Button>
          </Space>
        </Header>
        <Content style={{ padding: 16 }}>{children}</Content>
      </Layout>
    </Layout>
  );
}

