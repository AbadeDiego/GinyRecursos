import { openDatabase } from '../../../server/database.mjs';
import { createApplication } from '../../../server/application.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
let app: ReturnType<typeof createApplication>;
function handle(request: Request) {
  app ||= createApplication(openDatabase());
  return app(request);
}
export { handle as GET, handle as POST, handle as PATCH, handle as DELETE };
