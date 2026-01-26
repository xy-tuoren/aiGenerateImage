"use client";

import { useEffect, useState } from "react";
import { Button, Card, Image, Select, Space, Table, Tabs, Typography, message } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import AdminShell from "@/app/_components/AdminShell";
import { ASPECT_RATIO_OPTIONS } from "@/common/constants";

type CutRecordItem = {
  id: string;
  jobId: string;
  sourceUrl: string;
  outputUrl?: string;
  ratio: string;
  templateName: string;
  status: string;
  error?: string;
  createdAt?: string;
};

export default function CropPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [records, setRecords] = useState<CutRecordItem[]>([]);
  const [ratioFilter, setRatioFilter] = useState<string>("16:9");
  const [activeTab, setActiveTab] = useState<"records">("records");

  const fetchRecords = async () => {
    setRecordsLoading(true);
    try {
      const qs = new URLSearchParams();
      qs.set("limit", "5000");
      if (ratioFilter) qs.set("ratio", ratioFilter);
      const res = await fetch(`/api/cut-records?${qs.toString()}`, { method: "GET" });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        messageApi.error(data?.error || "获取裁图记录失败");
        return;
      }
      const arr = Array.isArray(data.items) ? data.items : [];
      setRecords(arr);
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : String(e));
    } finally {
      setRecordsLoading(false);
    }
  };

  useEffect(() => {
    fetchRecords();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ratioFilter]);

  return (
    <AdminShell defaultSelectedKey="/crop" headerTitle="裁图展示">
      {contextHolder}
      <Space orientation="vertical" size={12} style={{ width: "100%" }}>
        <Card styles={{ body: { padding: 0 } }}>
          <Tabs
            activeKey={activeTab}
            onChange={(k) => setActiveTab((k as any) || "records")}
            tabBarStyle={{ paddingLeft: 12, paddingRight: 12, marginBottom: 0 }}
            items={[
              {
                key: "records",
                label: "裁图记录",
                children: (
                  <div style={{ padding: 12 }}>
                    <Space wrap style={{ marginBottom: 12 }}>
                      <Typography.Text strong>比例：</Typography.Text>
                      <Select
                        style={{ width: 140 }}
                        value={ratioFilter || undefined}
                        options={ASPECT_RATIO_OPTIONS}
                        onChange={(v) => setRatioFilter(String(v || ""))}
                      />
                      <Button size="small" icon={<ReloadOutlined />} onClick={fetchRecords} loading={recordsLoading}>
                        刷新
                      </Button>
                      <Typography.Text type="secondary">{recordsLoading ? "加载中..." : `${records.length} 条`}</Typography.Text>
                    </Space>
                    <Table
                      rowKey="id"
                      loading={recordsLoading}
                      dataSource={records}
                      pagination={{ pageSize: 10, showSizeChanger: true, pageSizeOptions: ["10", "20", "50", "100"] }}
                      columns={[
                        {
                          title: "时间",
                          dataIndex: "createdAt",
                          key: "createdAt",
                          width: 180,
                          render: (v) => {
                            const s = v ? String(v) : "";
                            if (!s) return <Typography.Text type="secondary">-</Typography.Text>;
                            const d = new Date(s);
                            return <Typography.Text>{Number.isNaN(d.getTime()) ? s : d.toLocaleString()}</Typography.Text>;
                          },
                        },
                        { title: "状态", dataIndex: "status", key: "status", width: 110 },
                        { title: "比例", dataIndex: "ratio", key: "ratio", width: 90 },
                        { title: "模板", dataIndex: "templateName", key: "templateName", width: 220, ellipsis: true },
                        {
                          title: "原图",
                          dataIndex: "sourceUrl",
                          key: "sourceUrl",
                          width: 120,
                          render: (v) => {
                            const s = v ? String(v) : "";
                            return s ? <Image width={80} height={80} style={{ objectFit: "cover" }} src={s} alt={s} /> : <Typography.Text type="secondary">-</Typography.Text>;
                          },
                        },
                        {
                          title: "裁后图",
                          dataIndex: "outputUrl",
                          key: "outputUrl",
                          width: 120,
                          render: (v) => {
                            const s = v ? String(v) : "";
                            return s ? <Image width={80} height={80} style={{ objectFit: "cover" }} src={s} alt={s} /> : <Typography.Text type="secondary">-</Typography.Text>;
                          },
                        },
                        {
                          title: "任务",
                          dataIndex: "jobId",
                          key: "jobId",
                          width: 260,
                          render: (v) => {
                            const s = v ? String(v) : "";
                            return s ? (
                              <Typography.Link href={`/batch?jobId=${encodeURIComponent(s)}`} target="_blank">
                                {s}
                              </Typography.Link>
                            ) : (
                              <Typography.Text type="secondary">-</Typography.Text>
                            );
                          },
                        },
                        {
                          title: "错误",
                          dataIndex: "error",
                          key: "error",
                          ellipsis: true,
                          render: (v) => (v ? <Typography.Text type="danger">{String(v)}</Typography.Text> : <Typography.Text type="secondary">-</Typography.Text>),
                        },
                      ]}
                    />
                  </div>
                ),
              },
            ]}
          />
        </Card>
      </Space>
    </AdminShell>
  );
}

