import crypto from "crypto";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const privateKey = process.env.IMAGEKIT_PRIVATE_KEY;
  const publicKey = process.env.IMAGEKIT_PUBLIC_KEY;

  if (!privateKey || !publicKey) {
    return NextResponse.json(
      { error: "Kle ImageKit yo pa konfigire sou sèvè a" },
      { status: 500 }
    );
  }

  const token = crypto.randomUUID();
  const expire = Math.floor(Date.now() / 1000) + 30 * 60;
  const signature = crypto
    .createHmac("sha1", privateKey)
    .update(token + expire)
    .digest("hex");

  return NextResponse.json({ token, expire, signature, publicKey });
}