"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, Form, Input, Space, Typography, message } from "antd";
import { useRouter, useSearchParams } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [messageApi, contextHolder] = message.useMessage();
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();

  const nextPath = String(searchParams.get("next") || "").trim() || "/configs";

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/auth/me", {
          method: "GET",
          cache: "no-store",
          credentials: "include"
        });
        const data = await res.json().catch(() => null);
        if (res.ok && data?.ok) {
          router.replace(nextPath);
        }
      } catch {}
    })();
  }, [nextPath, router]);

  const onSubmit = useCallback(async () => {
    const values = await form.validateFields();
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: values.username,
          password: values.password
        })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        messageApi.error(data?.error || "登录失败");
        return;
      }
      router.replace(nextPath);
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [form, messageApi, nextPath, router]);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        background: "#f5f5f5"
      }}
    >
      {contextHolder}
      <Card style={{ width: 420 }}>
        <Space orientation="vertical" size={12} style={{ width: "100%" }}>
          <div>
            <Typography.Title level={4} style={{ marginBottom: 4 }}>
              登录
            </Typography.Title>
            <Typography.Text type="secondary">
              批量生成图片 - 内部后台
            </Typography.Text>
          </div>
          <Form
            form={form}
            layout="vertical"
            requiredMark={false}
            onFinish={onSubmit}
          >
            <Form.Item
              name="username"
              label="账号"
              rules={[{ required: true, message: "请输入账号" }]}
            >
              <Input autoFocus placeholder="username" autoComplete="username" />
            </Form.Item>
            <Form.Item
              name="password"
              label="密码"
              rules={[{ required: true, message: "请输入密码" }]}
            >
              <Input.Password
                placeholder="password"
                autoComplete="current-password"
              />
            </Form.Item>
            <Button type="primary" htmlType="submit" block loading={loading}>
              登录
            </Button>
          </Form>
        </Space>
      </Card>
    </div>
  );
}
