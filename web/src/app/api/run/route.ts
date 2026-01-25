export async function POST() {
  const id = `${Date.now()}`;
  return Response.json({
    ok: true,
    id,
    note: "最小版本占位：后续把这里接到你根目录 main.ts 的批处理入口（建议改成后台队列/子进程）。",
  });
}

