import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const privateKey = process.env.IMAGEKIT_PRIVATE_KEY;
  if (!privateKey) {
    return NextResponse.json(
      { error: "Kle ImageKit la pa konfigire sou sèvè a" },
      { status: 500 }
    );
  }

  let fileId: unknown;
  try {
    ({ fileId } = await req.json());
  } catch {
    return NextResponse.json({ error: "Demann envalid" }, { status: 400 });
  }
  if (!fileId || typeof fileId !== "string") {
    return NextResponse.json({ error: "fileId manke" }, { status: 400 });
  }

  const auth = Buffer.from(`${privateKey}:`).toString("base64");
  const r = await fetch(
    `https://api.imagekit.io/v1/files/${encodeURIComponent(fileId)}`,
    { method: "DELETE", headers: { Authorization: `Basic ${auth}` } }
  );

  const ok = r.status === 204 || r.status === 404;
  return NextResponse.json({ ok }, { status: ok ? 200 : 502 });
}