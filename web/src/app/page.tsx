"use client";

import { Layout, Typography, Menu } from "antd";
import { HomeOutlined, SettingOutlined } from "@ant-design/icons";
import Link from "next/link";
import { usePathname } from "next/navigation";

const { Header, Content, Sider } = Layout;

export default function Home() {
  const pathname = usePathname();

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider width={200} style={{ background: "#fff" }}>
        <Menu
          mode="inline"
          selectedKeys={[pathname || "/"]}
          style={{ height: "100%", borderRight: 0 }}
          items={[
            {
              key: "/",
              icon: <HomeOutlined />,
              label: <Link href="/">首页</Link>,
            },
            {
              key: "/configs",
              icon: <SettingOutlined />,
              label: <Link href="/configs">配置管理</Link>,
            },
          ]}
        />
      </Sider>
      <Layout>
        <Header style={{ display: "flex", alignItems: "center", background: "#001529" }}>
          <Typography.Title level={4} style={{ color: "#fff", margin: 0 }}>
            批量生成图片 - 内部后台
          </Typography.Title>
        </Header>
        <Content style={{ padding: 24 }}>
          <Typography.Title level={2}>欢迎使用批量生成图片系统</Typography.Title>
        </Content>
      </Layout>
    </Layout>
  );
}
