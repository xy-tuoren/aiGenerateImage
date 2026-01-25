"use client";

import { Layout, Typography, Space, Button, Card, message } from "antd";
import { PlayCircleOutlined, ApiOutlined } from "@ant-design/icons";

const { Header, Content } = Layout;

export default function Home() {
  const [messageApi, contextHolder] = message.useMessage();

  const callHealth = async () => {
    const res = await fetch("/api/health", { method: "GET" });
    const data = await res.json();
    messageApi.success(`health: ${data?.ok ? "ok" : "fail"}`);
  };

  const runJob = async () => {
    const res = await fetch("/api/run", { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      messageApi.error(data?.error || "run failed");
      return;
    }
    messageApi.success(`已触发: ${data?.id || ""}`);
  };

  return (
    <Layout style={{ minHeight: "100vh" }}>
      {contextHolder}
      <Header style={{ display: "flex", alignItems: "center" }}>
        <Typography.Title level={4} style={{ color: "#fff", margin: 0 }}>
          批量生成图片 - 内部后台
        </Typography.Title>
      </Header>
      <Content style={{ padding: 24 }}>
        <Space orientation="vertical" size={16} style={{ width: "100%" }}>
          <Card>
            <Typography.Paragraph style={{ marginBottom: 0 }}>
              这是最小版本：先提供 UI + HTTP API（health / run）。下一步再把 /api/run 接到你现有的批处理逻辑。
            </Typography.Paragraph>
          </Card>
          <Space wrap>
            <Button icon={<ApiOutlined />} onClick={callHealth}>
              健康检查
            </Button>
            <Button type="primary" icon={<PlayCircleOutlined />} onClick={runJob}>
              触发运行（占位）
            </Button>
          </Space>
        </Space>
      </Content>
    </Layout>
  );
}
