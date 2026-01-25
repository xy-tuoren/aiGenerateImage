"use client";

import { Layout, Spin } from "antd";

const { Header, Content, Sider } = Layout;

export default function Loading() {
  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider width={200} style={{ background: "#fff" }} />
      <Layout>
        <Header style={{ display: "flex", alignItems: "center", background: "#001529" }} />
        <Content style={{ padding: 24, display: "flex", justifyContent: "center", alignItems: "center" }}>
          <Spin size="large" />
        </Content>
      </Layout>
    </Layout>
  );
}

