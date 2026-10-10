import { measuredRoute } from "@/lib/perf";
import { preflight, submitWebForm } from "@/lib/intake/web-form";

type RouteContext = { params: Promise<{ key: string }> };

export const OPTIONS = measuredRoute("OPTIONS /api/intake/forms/:key", async (request: Request, context: RouteContext) =>
  preflight(request, (await context.params).key),
);

export const POST = measuredRoute("POST /api/intake/forms/:key", async (request: Request, context: RouteContext) =>
  submitWebForm(request, (await context.params).key),
);
