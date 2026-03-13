"use client";

import type { ReactNode } from "react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState
} from "react";
import { Button, Layout, Menu, Space, Typography } from "antd";
import { SettingOutlined, PictureOutlined } from "@ant-design/icons";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
``;
type AdminShellProps = {
  children: ReactNode;
  defaultSelectedKey: string;
  headerTitle?: string;
};

export default function AdminShell({
  children,
  defaultSelectedKey,
  headerTitle
}: AdminShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { Header, Content, Sider } = Layout;
  const [me, setMe] = useState<{
    userId: string;
    username: string;
    role?: string;
    isSuperAdmin?: boolean;
    permissions?: Record<string, boolean>;
  } | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  const nextPath = useMemo(() => {
    const p = String(pathname || "").trim();
    return p || "/configs";
  }, [pathname]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch("/api/auth/me", {
          method: "GET",
          cache: "no-store",
          credentials: "include"
        });
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
      await fetch("/api/auth/logout", {
        method: "POST",
        cache: "no-store",
        credentials: "include"
      });
    } catch {
    } finally {
      setMe(null);
      window.location.replace("/login");
    }
  }, [router]);

  const can = useCallback(
    (permKey: string) => {
      if (!permKey) return true;
      if (me?.isSuperAdmin) return true;
      const perms =
        me?.permissions && typeof me.permissions === "object"
          ? me.permissions
          : {};
      if ((perms as any)["*"] === true) return true;
      return (perms as any)[permKey] === true;
    },
    [me]
  );

  const menuItems = useMemo(() => {
    const all = [
      {
        key: "/reference",
        icon: <PictureOutlined />,
        label: <Link href="/reference">参考图库</Link>,
        uiPerm: "ui:/reference",
        apiPerm: "api:reference-images:read"
      },
      {
        key: "/configs",
        icon: <SettingOutlined />,
        label: <Link href="/configs">配置管理</Link>,
        uiPerm: "ui:/configs",
        apiPerm: "api:configs:read"
      },
      {
        key: "/batch",
        icon: <PictureOutlined />,
        label: <Link href="/batch">批量生图</Link>,
        uiPerm: "ui:/batch",
        apiPerm: "api:batch-jobs:read"
      },
      {
        key: "/gallery",
        icon: <PictureOutlined />,
        label: <Link href="/gallery">图片广场</Link>,
        uiPerm: "ui:/gallery",
        apiPerm: "api:generation-records:read"
      },
      {
        key: "/crop",
        icon: <PictureOutlined />,
        label: <Link href="/crop">素材库</Link>,
        uiPerm: "ui:/crop",
        apiPerm: "api:cut-records:read"
      },
      {
        key: "/cut-settings",
        icon: <SettingOutlined />,
        label: <Link href="/cut-settings">裁图设置</Link>,
        uiPerm: "ui:/cut-settings",
        apiPerm: "api:cut-settings:write"
      },
      {
        key: "/make-image",
        icon: <PictureOutlined />,
        label: <Link href="/make-image">制作图片</Link>,
        uiPerm: "ui:/make-image",
        apiPerm: "api:make-image:read"
      }
    ];
    const perms =
      me?.permissions && typeof me.permissions === "object"
        ? me.permissions
        : {};
    const hasAnyUiPerm = Object.keys(perms).some((k) =>
      String(k || "").startsWith("ui:")
    );
    return all
      .filter((x) =>
        hasAnyUiPerm ? can(x.uiPerm) : can(x.uiPerm) || can(x.apiPerm)
      )
      .map((x) => ({ key: x.key, icon: x.icon, label: x.label }));
  }, [can, me?.permissions]);

  const uiAccess = useMemo(() => {
    if (!authChecked || !me)
      return { status: "pending" as const, redirectTo: "" };
    const perms =
      me?.permissions && typeof me.permissions === "object"
        ? me.permissions
        : {};
    const hasAnyUiPerm = Object.keys(perms).some((k) =>
      String(k || "").startsWith("ui:")
    );
    if (!hasAnyUiPerm) return { status: "allowed" as const, redirectTo: "" };

    const p = String(pathname || "").trim() || "/";
    const rules = [
      { prefix: "/reference", uiPerm: "ui:/reference" },
      { prefix: "/configs", uiPerm: "ui:/configs" },
      { prefix: "/batch", uiPerm: "ui:/batch" },
      { prefix: "/gallery", uiPerm: "ui:/gallery" },
      { prefix: "/crop", uiPerm: "ui:/crop" },
      { prefix: "/cut-settings", uiPerm: "ui:/cut-settings" },
      { prefix: "/make-image", uiPerm: "ui:/make-image" }
    ];
    const hit = rules.find(
      (r) => p === r.prefix || p.startsWith(`${r.prefix}/`)
    );
    if (!hit) return { status: "allowed" as const, redirectTo: "" };
    if (can(hit.uiPerm)) return { status: "allowed" as const, redirectTo: "" };

    const fallback = rules.find((r) => can(r.uiPerm));
    const target = fallback?.prefix || "/login";
    return { status: "blocked" as const, redirectTo: target };
  }, [authChecked, can, me, pathname]);

  useLayoutEffect(() => {
    if (uiAccess.status !== "blocked") return;
    const p = String(pathname || "").trim() || "/";
    const target = String(uiAccess.redirectTo || "").trim() || "/login";
    if (target && target !== p) router.replace(target);
  }, [pathname, router, uiAccess.redirectTo, uiAccess.status]);

  if (uiAccess.status !== "allowed") {
    return (
      <div style={{ minHeight: "100vh", background: "#fff" }}>
        <div style={{ display: "none" }}>{children}</div>
      </div>
    );
  }

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider width={200} style={{ background: "#fff" }}>
        <Menu
          mode="inline"
          selectedKeys={[pathname || defaultSelectedKey]}
          style={{ height: "100%", borderRight: 0 }}
          items={menuItems}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "#001529"
          }}
        >
          <Typography.Title level={4} style={{ color: "#fff", margin: 0 }}>
            {headerTitle || "批量生成图片 - 内部后台"}
          </Typography.Title>
          <Space size={10}>
            {me?.username ? (
              <Typography.Text style={{ color: "rgba(255,255,255,0.85)" }}>
                {me.username}
              </Typography.Text>
            ) : null}
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
