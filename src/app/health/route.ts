import { forward } from "@/lib/cafe";
export const dynamic = "force-dynamic";
export const GET = (req: Request) => forward(req, "/health");
export const OPTIONS = (req: Request) => forward(req, "/health");
