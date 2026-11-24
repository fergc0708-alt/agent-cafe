import { forward } from "@/lib/cafe";
export const dynamic = "force-dynamic";
export const GET = (req: Request) => forward(req);
export const POST = (req: Request) => forward(req);
export const OPTIONS = (req: Request) => forward(req);
