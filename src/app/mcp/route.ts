import { forward } from "@/lib/cafe";
export const dynamic = "force-dynamic";
export const GET = (req: Request) => forward(req, "/mcp");
export const POST = (req: Request) => forward(req, "/mcp");
export const DELETE = (req: Request) => forward(req, "/mcp");
export const OPTIONS = (req: Request) => forward(req, "/mcp");
